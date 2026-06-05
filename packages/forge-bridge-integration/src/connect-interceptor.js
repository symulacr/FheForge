/* ──────────────────────────────────────────────
   ConnectInterceptor — Simplified connect flow orchestrator.

   Exposes startConnectFlow(connectorId) which chains:
     1. bridge.wallet.connect(connectorId)  →  wallet:connected
     2. bridge.wallet.login()               →  wallet:authenticated
     3. bridge.fhe.permitGrant()            →  permit:granted

   BridgeBus events are emitted at each stage for external state
   management.  SessionStorage persists wallet choice for refresh
   resilience.
   ────────────────────────────────────────────── */

import getBridge from "./get-bridge.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Session storage key for persisting wallet connector choice */
const SESSION_STORAGE_CONNECTOR_KEY = "fheforge:connect:connector";

/** Arbitrum Sepolia chain ID */
const REQUIRED_CHAIN_ID = 421614;

// ─── Module State ────────────────────────────────────────────────────────────

/** @type {boolean} Whether a connect flow is currently in progress */
let connectFlowInProgress = false;

/** @type {Object|null} Reference to BridgeBus */
let bus = null;

/** @type {boolean} Whether BridgeBus listeners are registered */
let listenersRegistered = false;

/** @type {Object|null} DataFetcherV2 instance for authenticated polling lifecycle */
let _dataFetcherV2Instance = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the global object (window in browser, globalThis in any environment).
 * @returns {typeof globalThis}
 */
function getGlobal() {
	return typeof window !== "undefined" ? window : globalThis;
}

/**
 * Get sessionStorage if available.
 * @returns {Storage|null}
 */
function getSessionStorage() {
	try {
		return getGlobal().sessionStorage || null;
	} catch {
		console.warn("[ConnectInterceptor] sessionStorage not available");
		return null;
	}
}

/**
 * Get or lazily create the DataFetcherV2 instance for authenticated polling.
 * @returns {Object|null}
 */
function getDataFetcherV2() {
	if (_dataFetcherV2Instance) return _dataFetcherV2Instance;

	const g = getGlobal();
	if (g.DataFetcherV2 && g.__bridgeBus) {
		try {
			_dataFetcherV2Instance = new g.DataFetcherV2({ bus: g.__bridgeBus });
		} catch (err) {
			console.warn("[ConnectInterceptor] Failed to create DataFetcherV2:", err.message || err);
			return null;
		}
	}
	return _dataFetcherV2Instance;
}

// ─── Network Mismatch Detection ─────────────────────────────────────────────

/**
 * Check the chainId and switch if needed.
 * @param {number} chainId
 * @returns {Promise<void>}
 */
function checkAndSwitchNetwork(chainId) {
	if (!chainId || chainId === REQUIRED_CHAIN_ID) return Promise.resolve();

	console.warn(
		"[ConnectInterceptor] Network mismatch: chain " +
			chainId +
			" !== " +
			REQUIRED_CHAIN_ID +
			". Attempting switch.",
	);

	return getBridge()
		.then((bridge) => bridge.wallet.switchNetwork(REQUIRED_CHAIN_ID))
		.catch((switchErr) => {
			console.warn("[ConnectInterceptor] Network switch failed:", switchErr.message || switchErr);
			throw new Error(
				"Network mismatch. Please switch to Arbitrum Sepolia (chain ID 421614) in your wallet.",
			);
		});
}

// ─── Bridge Bus Emitters ────────────────────────────────────────────────────

/**
 * Emit wallet:connected on BridgeBus.
 * @param {string} address
 * @param {number} chainId
 */
function emitWalletConnected(address, chainId) {
	if (!bus) return;
	bus.set("wallet:connected", { connected: true, address, chainId });
}

/**
 * Emit permit:granted on BridgeBus.
 * @param {boolean} unlocked
 * @param {number} secondsLeft
 */
function emitPermitGranted(unlocked, secondsLeft) {
	if (!bus) return;
	bus.set("permit:granted", { unlocked, secondsLeft });
}

/**
 * Emit error:connect on BridgeBus.
 * @param {string} step
 * @param {Error|string} err
 */
function emitError(step, err) {
	if (!bus) return;
	const message = err && err.message ? err.message : String(err);
	bus.set("error:connect", { step, message, timestamp: new Date().toISOString() });
}

// ─── Step Helpers ────────────────────────────────────────────────────────────

/**
 * Connect wallet via bridge.wallet.connect(connectorId).
 * @param {string} connectorId
 * @returns {Promise<{address: string, chainId: number}>}
 */
function executeWalletConnect(connectorId) {
	return getBridge()
		.then((bridge) => bridge.wallet.connect(connectorId))
		.then(() => getBridge())
		.then((bridge) => {
			const address = bridge.wallet.getAccount();
			const chainId = bridge.wallet.getChainId();
			if (!address) throw new Error("Wallet connection failed: no account returned");
			return { address, chainId };
		});
}

/**
 * Perform JWT wallet login: nonce → signMessage → POST /auth/wallet-login.
 * @returns {Promise<{accessToken: string, userId: string, walletAddress: string}>}
 */
function executeJwtLogin() {
	return getBridge().then((bridge) => bridge.wallet.login());
}

/**
 * Grant FHE permit via bridge.fhe.permitGrant().
 * @returns {Promise<{unlocked: boolean, secondsLeft: number}>}
 */
function executePermitGrant() {
	return getBridge()
		.then((bridge) => bridge.fhe.permitGrant())
		.then((permitResult) => ({
			unlocked: permitResult ? permitResult.unlocked !== false : true,
			secondsLeft:
				permitResult && permitResult.secondsLeft != null ? permitResult.secondsLeft : 900,
		}));
}

// ─── startConnectFlow ───────────────────────────────────────────────────────

/**
 * Run the full connect → login → permit chain.
 *
 * @param {string} [connectorId] - Wallet connector ID (defaults to saved choice or 'metaMask')
 * @returns {Promise<void>}
 */
function startConnectFlow(connectorId) {
	if (connectFlowInProgress) return Promise.resolve();
	connectFlowInProgress = true;

	// Resolve connector ID
	const ss = getSessionStorage();
	if (!connectorId && ss) {
		try {
			connectorId = ss.getItem(SESSION_STORAGE_CONNECTOR_KEY) || "metaMask";
		} catch {
			connectorId = "metaMask";
		}
	}
	if (!connectorId) connectorId = "metaMask";

	// Persist wallet choice
	if (ss) {
		try {
			ss.setItem(SESSION_STORAGE_CONNECTOR_KEY, connectorId);
		} catch {
			console.warn("[ConnectInterceptor] Failed to persist connector choice");
		}
	}

	// Step 1: Connect
	return executeWalletConnect(connectorId)
		.then((result) =>
			checkAndSwitchNetwork(result.chainId)
				.then(() => result)
				.catch((networkErr) => {
					console.warn("[ConnectInterceptor] Network switch failed — aborting connect flow");
					emitError("network", networkErr);
					throw networkErr;
				}),
		)
		.then((result) => {
			emitWalletConnected(result.address, result.chainId);
			bus?.set("connect:phase", { phase: "connected" });

			// Step 2: Sign + JWT login
			bus?.set("connect:phase", { phase: "signing" });
			return executeJwtLogin().then(() => result);
		})
		.then((result) => {
			bus?.set("wallet:authenticated", { address: result.address });
			bus?.set("connect:phase", { phase: "authenticated" });

			// Step 3: FHE permit
			bus?.set("connect:phase", { phase: "permitting" });
			const permitTimeout = new Promise((_, rej) =>
				setTimeout(() => rej(new Error("Permit timed out")), 30000),
			);
			return Promise.race([executePermitGrant(), permitTimeout]);
		})
		.then((permitResult) => {
			emitPermitGranted(permitResult.unlocked, permitResult.secondsLeft);
			bus?.set("connect:phase", { phase: "done" });
			bus?.enableAuthenticated?.();

			// Start authenticated polling
			const fetcher = getDataFetcherV2();
			if (fetcher) fetcher.startAuthenticatedPolling();

			connectFlowInProgress = false;
		})
		.catch((err) => {
			console.error("[ConnectInterceptor] startConnectFlow failed:", err.message || err);
			emitError("connect_flow", err);
			connectFlowInProgress = false;
			throw err;
		});
}

// ─── Disconnect Handler ─────────────────────────────────────────────────────

/**
 * Handle wallet disconnect: clear auth state, stop polling.
 */
function handleDisconnect() {
	const ss = getSessionStorage();
	if (ss) {
		try {
			ss.removeItem(SESSION_STORAGE_CONNECTOR_KEY);
		} catch {
			console.warn("[ConnectInterceptor] Failed to clear sessionStorage on disconnect");
		}
	}

	const fetcher = getDataFetcherV2();
	if (fetcher) fetcher.stopAuthenticatedPolling();

	if (bus) {
		bus.set("wallet:disconnected", { connected: false, address: null, chainId: null });
		bus.set("permit:expired", { unlocked: false, secondsLeft: 0 });
		if (bus.disableAuthenticated) bus.disableAuthenticated();
	}

	connectFlowInProgress = false;
}

// ─── BridgeBus Event Handlers ───────────────────────────────────────────────

/**
 * Called when BridgeBus emits wallet:disconnected.
 */
function onWalletDisconnected() {
	handleDisconnect();
}

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the ConnectInterceptor.
 * Sets up BridgeBus listeners.
 */
function init() {
	const g = getGlobal();

	if (g.__bridgeBus) bus = g.__bridgeBus;

	if (bus && !listenersRegistered) {
		listenersRegistered = true;
		bus.on("wallet:disconnected", onWalletDisconnected);
		bus.on("error:auth", () => {
			console.warn("[ConnectInterceptor] Auth failure — auto-disconnecting");
			handleDisconnect();
		});
	}
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** @returns {{ flowInProgress: boolean }} */
function getState() {
	return { flowInProgress: connectFlowInProgress };
}

/** Reset internal state (testing only). */
function _resetForTest() {
	connectFlowInProgress = false;
	_dataFetcherV2Instance = null;
}

/** Set BridgeBus instance (testing only). */
function _setBridgeBus(bridgeBus) {
	bus = bridgeBus;
}

export { init, startConnectFlow, handleDisconnect, checkAndSwitchNetwork, getState };

// ─── Self-Initialize ────────────────────────────────────────────────────────

const g = getGlobal();
if (!g.__ConnectInterceptor) {
	g.__ConnectInterceptor = {
		init,
		startConnectFlow,
		handleDisconnect,
		getState,
		_resetForTest,
		_setBridgeBus,
	};

	if (typeof document !== "undefined") {
		if (document.readyState === "complete" || document.readyState === "interactive") {
			init();
		} else {
			document.addEventListener("DOMContentLoaded", () => init());
		}
	}
}
