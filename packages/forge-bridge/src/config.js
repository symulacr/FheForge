/**
 * @typedef {import('./types.js').BridgeErrorSource} BridgeErrorSource
 */

/**
 * Default bridge configuration.
 */
export const DEFAULT_CONFIG = {
	/** Production NestJS API base URL */
	apiBaseUrl: "https://fheforge-api-production-6465.up.railway.app",
	/** Arbitrum Sepolia chain ID */
	chainId: 421614,
	/** Public Arbitrum Sepolia RPC URL */
	rpcUrl: "https://sepolia-arbitrum-rpc.publicnode.com",
};

/**
 * @typedef {Object} BridgeConfig
 * @property {string} apiBaseUrl - NestJS API base URL
 * @property {number} chainId - Arbitrum Sepolia chain ID
 * @property {string} rpcUrl - RPC URL for chain interaction
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
