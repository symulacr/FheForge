import { createApiAdapter } from "./api.js";
import { createConfig } from "./config.js";
import { createContractAdapter } from "./contract.js";
import { createFheAdapter } from "./fhe.js";
import { createWalletAdapter } from "./wallet.js";

/**
 * Creates a fully wired bridge instance.
 * @param {Partial<import('./config.js').BridgeConfig>} [config] - Bridge configuration
 * @returns {{ wallet: ReturnType<typeof createWalletAdapter>, api: ReturnType<typeof createApiAdapter>, contract: ReturnType<typeof createContractAdapter>, fhe: ReturnType<typeof createFheAdapter>, getState: () => object }} Bridge instance
 */
export function createBridge(config) {
	const mergedConfig = createConfig(config);
	const wallet = createWalletAdapter(mergedConfig);
	// Pass wallet adapter to API adapter for JWT lifecycle (token refresh on 401)
	const api = createApiAdapter(mergedConfig, wallet);
	const contract = createContractAdapter(mergedConfig);
	const fhe = createFheAdapter(mergedConfig);

	return {
		wallet,
		api,
		contract,
		fhe,
		/** Returns a snapshot of all adapter states */
		getState: () => ({ wallet, api, contract, fhe }),
	};
}
