/**
 * @file bridge-context.js — ForgeProvider React Context + hooks
 *
 * BridgeContext provides wallet, permit, and data state from BridgeBus
 * to the React component tree. ForgeProvider subscribes to BridgeBus
 * events in useEffect and updates state via useState, triggering React
 * re-renders WITHOUT re-mounting (no dataVersion-as-key pattern).
 *
 * Backward compatibility: domain data is also written to window.__MOCK__
 * so the Babel plugin's mock interceptors still resolve.
 *
 * Browser usage:
 *   ReactDOM.createRoot(document.getElementById('root'))
 *     .render(React.createElement(ForgeProvider, null,
 *       React.createElement(App)
 *     ));
 *
 * In components:
 *   const bridge = useBridge();    // full context
 *   const wallet = useWallet();    // { connected, address, chainId }
 *   const permit = usePermit();    // { unlocked, secondsLeft }
 *   const data = useBridgeData();  // all data arrays
 */

import bridgeBus from './bridge-bus.js';

// ─── Default Context Value ──────────────────────────────────────────────────

/** @type {BridgeContextValue} */
const DEFAULT_CONTEXT_VALUE = {
	wallet: { connected: false, address: null, chainId: null },
	permit: { unlocked: false, secondsLeft: 0 },
	data: {
		ticker: null,
		markets: null,
		activities: null,
		positions: null,
		strategies: null,
		proposals: null,
		community: null,
		nodeTypes: null,
		walletBalance: null,
		portfolioNetValue: null,
		portfolioLTV: null,
	},
	meta: { dataVersion: 0, errors: [] },
};

// ─── Context ────────────────────────────────────────────────────────────────

/**
 * BridgeContext — React Context holding all bridge state.
 *
 * Shape:
 *   { wallet: { connected, address, chainId },
 *     permit: { unlocked, secondsLeft },
 *     data:   { ticker, markets, activities, positions, strategies,
 *               proposals, community, nodeTypes, walletBalance,
 *               portfolioNetValue, portfolioLTV },
 *     meta:   { dataVersion, errors } }
 *
 * @type {React.Context<BridgeContextValue>}
 */
const BridgeContext = React.createContext(DEFAULT_CONTEXT_VALUE);

// ─── Mock Key Map ───────────────────────────────────────────────────────────
// Maps BridgeBus data events to window.__MOCK__ keys for backward compatibility
// with the Babel plugin's mock data interceptors.

const EVENT_TO_MOCK_KEY = {
	"data:ticker": "TICKER_ITEMS",
	"data:markets": "L_MARKETS",
	"data:activities": "D_ACTIVITY",
	"data:positions": "D_POSITIONS",
	"data:strategies": "D_STRATS",
	"data:proposals": "PROPOSALS",
	"data:nodeTypes": "NODE_TYPES",
};

// ─── Data event handler descriptors ─────────────────────────────────────────
// Each entry maps a BridgeBus event to:
//   - stateKey: the key in the `data` state object
//   - mockKey: the window.__MOCK__ key (null = no backward compat write)

const DATA_EVENT_MAP = [
	{ event: "data:ticker", stateKey: "ticker", mockKey: "TICKER_ITEMS" },
	{ event: "data:markets", stateKey: "markets", mockKey: "L_MARKETS" },
	{ event: "data:activities", stateKey: "activities", mockKey: "D_ACTIVITY" },
	{ event: "data:positions", stateKey: "positions", mockKey: "D_POSITIONS" },
	{ event: "data:strategies", stateKey: "strategies", mockKey: "D_STRATS" },
	{ event: "data:proposals", stateKey: "proposals", mockKey: "PROPOSALS" },
	{ event: "data:nodeTypes", stateKey: "nodeTypes", mockKey: "NODE_TYPES" },
	{ event: "data:walletBalance", stateKey: "walletBalance", mockKey: null },
];

// ─── ForgeProvider ──────────────────────────────────────────────────────────

/**
 * ForgeProvider — React Context provider for bridge state.
 *
 * Subscribes to BridgeBus events in useEffect and stores state via useState.
 * On every BridgeBus data/wallet/permit update:
 *   1. Updates local React state (triggers targeted re-render, not re-mount)
 *   2. Writes domain data to window.__MOCK__ (backward compat with Babel plugin)
 *
 * On mount:
 *   - Calls DataFetcherV2.startPublicPolling() to begin public data fetching
 *
 * On unmount:
 *   - Unsubscribes from all BridgeBus events (effect cleanup)
 *
 * No dataVersion-as-key — state updates via Context.Provider value change
 * trigger React re-renders naturally, preserving component state (scroll,
 * selections, form inputs).
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 */
function ForgeProvider({ children }) {
	// ── Wallet state ──────────────────────────────────────────────────
	const [wallet, setWallet] = React.useState({
		connected: false,
		address: null,
		chainId: null,
	});

	// ── Permit state ──────────────────────────────────────────────────
	const [permit, setPermit] = React.useState({
		unlocked: false,
		secondsLeft: 0,
	});

	// ── Data state ────────────────────────────────────────────────────
	const [data, setData] = React.useState({
		ticker: null,
		markets: null,
		activities: null,
		positions: null,
		strategies: null,
		proposals: null,
		community: null,
		nodeTypes: null,
		walletBalance: null,
		portfolioNetValue: null,
		portfolioLTV: null,
	});

	// Track data version for meta updates without deep-cloning state
	const [dataVersion, setDataVersion] = React.useState(0);

	// ── Memoize context value ─────────────────────────────────────────
	// Prevents unnecessary child re-renders when state hasn't changed
	const contextValue = React.useMemo(
		() => ({
			wallet,
			permit,
			data,
			meta: { dataVersion, errors: [] },
		}),
		[wallet, permit, data, dataVersion],
	);

	// ── BridgeBus subscription (mount/unmount effect) ─────────────────
	React.useEffect(() => {
		const unsubFns = [];

		// --- Wallet event subscriptions ---
		// Each handler does a shallow merge into wallet state
		unsubFns.push(
			bridgeBus.on("wallet:connected", (walletData) => {
				setWallet((prev) => ({ ...prev, ...walletData }));
			}),
		);
		unsubFns.push(
			bridgeBus.on("wallet:disconnected", (walletData) => {
				setWallet((prev) => ({ ...prev, ...walletData }));
			}),
		);
		unsubFns.push(
			bridgeBus.on("wallet:networkChanged", (walletData) => {
				setWallet((prev) => ({ ...prev, ...walletData }));
			}),
		);

		// --- Permit event subscriptions ---
		// Each handler does a shallow merge into permit state
		unsubFns.push(
			bridgeBus.on("permit:granted", (permitData) => {
				setPermit((prev) => ({ ...prev, ...permitData }));
			}),
		);
		unsubFns.push(
			bridgeBus.on("permit:expired", (permitData) => {
				setPermit((prev) => ({ ...prev, ...permitData }));
			}),
		);
		unsubFns.push(
			bridgeBus.on("permit:tick", (permitData) => {
				setPermit((prev) => ({ ...prev, ...permitData }));
			}),
		);

		// --- Data event subscriptions ---
		// For each data source: update React state + write to __MOCK__
		DATA_EVENT_MAP.forEach(({ event, stateKey, mockKey }) => {
			unsubFns.push(
				bridgeBus.on(event, (payload) => {
					// 1. Update React state (triggers targeted re-render)
					setData((prev) => ({ ...prev, [stateKey]: payload }));
					setDataVersion((prev) => prev + 1);

					// 2. Write to window.__MOCK__ for backward compatibility
					if (mockKey && typeof window !== "undefined" && window.__MOCK__) {
						window.__MOCK__[mockKey] = payload;
					}
				}),
			);
		});

		// --- Error event subscription (wildcard) ---
		unsubFns.push(
			bridgeBus.on("error:*", () => {
				setDataVersion((prev) => prev + 1);
			}),
		);

		// ── Start public polling on mount ─────────────────────────
		if (typeof window !== "undefined" && window.DataFetcherV2) {
			if (!window.__forgeProvider__pollingStarted) {
				window.__forgeProvider__pollingStarted = true;
				try {
					const fetcher = new window.DataFetcherV2({
						bus: bridgeBus,
					});
					fetcher.startPublicPolling();
					// Also populate all __MOCK__ keys with demo data so the
					// app shows populated values on every screen without
					// requiring wallet connection or real backend API calls.
					if (typeof fetcher.startDemoMode === "function") {
						fetcher.startDemoMode();
					}
				} catch (err) {
					console.warn("[ForgeProvider] Failed to start polling:", err);
				}
			}
		}

		// ── Cleanup: unsubscribe all on unmount ───────────────────
		return function cleanup() {
			unsubFns.forEach(function (fn) {
				fn();
			});
		};
	}, []); // Empty deps = subscribe on mount, cleanup on unmount only

	// ── Render: wrap children in BridgeContext.Provider ───────────────
	return React.createElement(
		BridgeContext.Provider,
		{ value: contextValue },
		children,
	);
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * useBridge — returns the full BridgeContext value.
 *
 * @returns {BridgeContextValue} { wallet, permit, data, meta }
 */
function useBridge() {
	return React.useContext(BridgeContext);
}

/**
 * useWallet — returns wallet connection state.
 *
 * @returns {{ connected: boolean, address: string|null, chainId: number|null }}
 */
function useWallet() {
	const ctx = React.useContext(BridgeContext);
	return ctx.wallet;
}

/**
 * usePermit — returns permit state.
 *
 * @returns {{ unlocked: boolean, secondsLeft: number }}
 */
function usePermit() {
	const ctx = React.useContext(BridgeContext);
	return ctx.permit;
}

/**
 * useBridgeData — returns all data arrays/state.
 *
 * @returns {{
 *   ticker: *,
 *   markets: *,
 *   activities: *,
 *   positions: *,
 *   strategies: *,
 *   proposals: *,
 *   community: *,
 *   nodeTypes: *,
 *   walletBalance: *,
 *   portfolioNetValue: *,
 *   portfolioLTV: *
 * }}
 */
function useBridgeData() {
	const ctx = React.useContext(BridgeContext);
	return ctx.data;
}

// ─── Expose ForgeProvider globally ───────────────────────────────────────────
// The Babel plugin v2 references ForgeProvider as a bare global identifier
// (React.createElement(ForgeProvider, ...)), so it must be available on window.
if (typeof window !== 'undefined') {
	window.ForgeProvider = ForgeProvider;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { BridgeContext, ForgeProvider, useBridge, useWallet, usePermit, useBridgeData };
