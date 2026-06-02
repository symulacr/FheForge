/**
 * @typedef {Object} ApiAdapter
 * @property {() => Promise<{status: string, data: any, error: any}>} getMarkets - Fetch markets
 * @property {() => Promise<{status: string, data: any, error: any}>} getStats - Fetch protocol stats
 * @property {(filters?: object) => Promise<{status: string, data: any, error: any}>} listStrategies - List strategies
 * @property {(id: string) => Promise<{status: string, data: any, error: any}>} getStrategy - Get strategy by ID
 */

/**
 * Creates an API adapter.
 * @param {import('./config.js').BridgeConfig} _config - Bridge configuration
 * @returns {ApiAdapter} API adapter
 */
export function createApiAdapter(_config) {
	return {
		getMarkets: async () => ({ status: "success", data: [], error: null }),
		getStats: async () => ({ status: "success", data: null, error: null }),
		listStrategies: async (_filters) => ({ status: "success", data: [], error: null }),
		getStrategy: async (_id) => ({ status: "success", data: null, error: null }),
	};
}
