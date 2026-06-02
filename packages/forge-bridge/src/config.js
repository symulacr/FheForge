/**
 * @typedef {import('./types.js').BridgeErrorSource} BridgeErrorSource
 */

/**
 * Default bridge configuration.
 */
export const DEFAULT_CONFIG = (() => {
	const config = {
		/** Production NestJS API base URL */
		apiBaseUrl: "https://fheforge-api-production-6465.up.railway.app",
		/** Arbitrum Sepolia chain ID */
		chainId: 421614,
		/** Public Arbitrum Sepolia RPC URL */
		rpcUrl: "https://sepolia-arbitrum-rpc.publicnode.com",
	};
	// Runtime override: window.__FHEFORGE_CONFIG__ takes priority
	if (typeof window !== "undefined" && window.__FHEFORGE_CONFIG__) {
		Object.assign(config, window.__FHEFORGE_CONFIG__);
	}
	return config;
})();

/**
 * @typedef {Object} BridgeConfig
 * @property {string} apiBaseUrl - NestJS API base URL
 * @property {number} chainId - Arbitrum Sepolia chain ID
 * @property {string} rpcUrl - RPC URL for chain interaction
 * @property {string} [walletConnectProjectId] - WalletConnect project ID
 */

/**
 * Creates a merged configuration from defaults and user overrides.
 * @param {Partial<BridgeConfig>} [overrides={}] - User-provided overrides
 * @returns {BridgeConfig} Merged configuration
 */
export function createConfig(overrides = {}) {
	return { ...DEFAULT_CONFIG, ...overrides };
}

export default DEFAULT_CONFIG;
