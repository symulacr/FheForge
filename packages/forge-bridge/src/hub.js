/**
 * @file Bridge Hub — createBridge(config) factory function.
 *
 * Wires all 4 adapters (wallet, api, contract, fhe) together.
 * Init sequence: validate config → create wallet adapter → create API adapter →
 * create contract adapter → create FHE adapter.
 *
 * On init failure, returns partial state with BridgeError info.
 * On success, returns fully initialized { wallet, api, contract, fhe, getState }.
 *
 * @typedef {import('./config.js').BridgeConfig} BridgeConfig
 * @typedef {import('./wallet.js').WalletAdapter} _WalletAdapter
 * @typedef {import('./api.js').ApiAdapter} _ApiAdapter
 * @typedef {import('./contract.js').ContractAdapter} _ContractAdapter
 * @typedef {import('./fhe.js').FheAdapter} _FheAdapter
 */

import { createApiAdapter } from "./api.js";
import { createConfig } from "./config.js";
import { createContractAdapter } from "./contract.js";
import { createFheAdapter } from "./fhe.js";
import { BridgeError } from "./types.js";
import { createWalletAdapter } from "./wallet.js";

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/**
 * Validate bridge configuration before initialization.
 * @param {import('./config.js').BridgeConfig} config - Merged configuration
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
function validateConfig(config) {
	const errors = [];

	if (!config || typeof config !== "object") {
		errors.push("Config must be an object");
		return { valid: false, errors };
	}

	if (!config.apiBaseUrl || typeof config.apiBaseUrl !== "string") {
		errors.push("apiBaseUrl must be a valid URL string");
	}

	if (!config.chainId || typeof config.chainId !== "number") {
		errors.push("chainId must be a valid chain ID number");
	}

	if (!config.rpcUrl || typeof config.rpcUrl !== "string") {
		errors.push("rpcUrl must be a valid URL string");
	}

	return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Partial result builder
// ---------------------------------------------------------------------------

/**
 * Build a partial bridge result when initialization fails at some step.
 *
 * @param {Object} adapters - Successfully initialized adapters
 * @param {import('./wallet.js').WalletAdapter} [adapters.wallet]
 * @param {import('./api.js').ApiAdapter} [adapters.api]
 * @param {import('./contract.js').ContractAdapter} [adapters.contract]
 * @param {import('./fhe.js').FheAdapter} [adapters.fhe]
 * @param {Record<string, BridgeError>} errors - Map of adapter name → error
 * @param {BridgeConfig} config - Merged configuration
 * @returns {import('./types.js').BridgeResult} Partial bridge instance with error info
 */
function buildPartialResult(adapters, errors, config) {
	const firstError = Object.values(errors).find(Boolean);

	return {
		...(adapters.wallet ? { wallet: adapters.wallet } : {}),
		...(adapters.api ? { api: adapters.api } : {}),
		...(adapters.contract ? { contract: adapters.contract } : {}),
		...(adapters.fhe ? { fhe: adapters.fhe } : {}),
		getState() {
			return {
				status: "error",
				data: {
					wallet: adapters.wallet
						? {
								address: adapters.wallet.getAccount(),
								chainId: adapters.wallet.getChainId(),
								connected: adapters.wallet.isConnected(),
								hasJwt: !!adapters.wallet.getJwt(),
							}
						: null,
					fhe: adapters.fhe
						? {
								permitUnlocked: adapters.fhe.permitCheck().unlocked,
								permitSecondsLeft: adapters.fhe.permitCheck().secondsLeft,
							}
						: null,
					config,
				},
				error: firstError
					? {
							code: firstError.code,
							message: firstError.message,
							source: firstError.source,
							recoverable: firstError.recoverable,
						}
					: null,
			};
		},
		error: firstError,
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} InitResult
 * @property {import('./wallet.js').WalletAdapter} [wallet]
 * @property {import('./api.js').ApiAdapter} [api]
 * @property {import('./contract.js').ContractAdapter} [contract]
 * @property {import('./fhe.js').FheAdapter} [fhe]
 * @property {() => import('./types.js').BridgeState} getState
 * @property {BridgeError} [error]
 */

/**
 * Create a fully wired bridge instance.
 *
 * Initialization sequence:
 *   1. Merge user config with defaults
 *   2. Validate config
 *   3. Create wallet adapter
 *   4. Create API adapter (wired to wallet for JWT lifecycle)
 *   5. Create contract adapter (wired to API for simulation)
 *   6. Create FHE adapter
 *   7. Wire wallet account change → auto-refresh API JWT
 *   8. Return { wallet, api, contract, fhe, getState }
 *
 * If any adapter fails to initialize, the error is wrapped in the
 * appropriate BridgeError subclass and a partial result is returned
 * with error information available via getState() and the error property.
 *
 * @param {Partial<import('./config.js').BridgeConfig>} [config={}] - User-provided configuration overrides
 * @returns {InitResult} Bridge instance (partial on failure)
 */
export function createBridge(config = {}) {
	// 1. Merge user config with defaults
	const mergedConfig = createConfig(config);

	// 2. Validate config
	const validation = validateConfig(mergedConfig);
	if (!validation.valid) {
		const configError = new BridgeError(
			"CONFIG_VALIDATION_FAILED",
			`Invalid bridge configuration: ${validation.errors.join("; ")}`,
			"config",
			false,
		);
		return buildPartialResult({}, { config: configError }, mergedConfig);
	}

	/** @type {{ wallet?: import('./wallet.js').WalletAdapter, api?: import('./api.js').ApiAdapter, contract?: import('./contract.js').ContractAdapter, fhe?: import('./fhe.js').FheAdapter }} */
	const adapters = {};
	/** @type {Record<string, BridgeError>} */
	const initErrors = {};

	// 3. Create wallet adapter
	try {
		adapters.wallet = createWalletAdapter(mergedConfig);
	} catch (err) {
		initErrors.wallet =
			err instanceof BridgeError
				? err
				: new BridgeError(
						"WALLET_INIT_FAILED",
						/** @type {Error} */ (err).message || "Failed to initialize wallet adapter",
						"wallet",
						true,
					);
		return buildPartialResult(adapters, initErrors, mergedConfig);
	}

	// 4. Create API adapter — wired to wallet adapter for JWT lifecycle
	try {
		adapters.api = createApiAdapter(mergedConfig, adapters.wallet);
	} catch (err) {
		initErrors.api =
			err instanceof BridgeError
				? err
				: new BridgeError(
						"API_INIT_FAILED",
						/** @type {Error} */ (err).message || "Failed to initialize API adapter",
						"api",
						false,
					);
		return buildPartialResult(adapters, initErrors, mergedConfig);
	}

	// 5. Create contract adapter — wired to API adapter for simulation
	try {
		adapters.contract = createContractAdapter(mergedConfig, { apiAdapter: adapters.api });
	} catch (err) {
		initErrors.contract =
			err instanceof BridgeError
				? err
				: new BridgeError(
						"CONTRACT_INIT_FAILED",
						/** @type {Error} */ (err).message || "Failed to initialize contract adapter",
						"contract",
						false,
					);
		return buildPartialResult(adapters, initErrors, mergedConfig);
	}

	// 6. Create FHE adapter
	try {
		adapters.fhe = createFheAdapter(mergedConfig);
	} catch (err) {
		initErrors.fhe =
			err instanceof BridgeError
				? err
				: new BridgeError(
						"FHE_INIT_FAILED",
						/** @type {Error} */ (err).message || "Failed to initialize FHE adapter",
						"cofhe",
						true,
					);
		return buildPartialResult(adapters, initErrors, mergedConfig);
	}

	// 7. Wire wallet account change → auto-refresh API JWT
	// When the wallet account changes, the existing JWT (tied to the old account)
	// becomes invalid. We clear it proactively so the next API call gets a 401,
	// which triggers the API adapter's interceptor to call wallet.refreshJwt(),
	// which logs in with the new account.
	try {
		adapters.wallet.onChainChange((/** @type {{ chainId?: number, account?: string }} */ data) => {
			if (data.account) {
				// Clear the old JWT — next API call will 401 and trigger refreshJwt
				adapters.wallet?.logout().catch(() => {
					/* silent — refresh will happen on next 401 */
				});
			}
		});
	} catch (_err) {
		// Non-fatal — bridge still works, JWT will refresh on first 401
	}

	// 8. Return fully initialized bridge
	return {
		wallet: adapters.wallet,
		api: adapters.api,
		contract: adapters.contract,
		fhe: adapters.fhe,

		/**
		 * Returns a snapshot of the current bridge state.
		 * @returns {import('./types.js').BridgeState} Current state
		 */
		getState() {
			// At this point in the execution path, wallet and fhe are guaranteed
			// to be defined (we return early with partial state on any failure).
			const w = /** @type {import('./wallet.js').WalletAdapter} */ (adapters.wallet);
			const f = /** @type {import('./fhe.js').FheAdapter} */ (adapters.fhe);
			return {
				status: "success",
				data: {
					wallet: {
						address: w.getAccount(),
						chainId: w.getChainId(),
						connected: w.isConnected(),
						hasJwt: !!w.getJwt(),
					},
					fhe: {
						permitUnlocked: f.permitCheck().unlocked,
						permitSecondsLeft: f.permitCheck().secondsLeft,
					},
					config: mergedConfig,
				},
				error: null,
			};
		},
	};
}
