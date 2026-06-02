/**
 * @typedef {Object} ContractAdapter
 * @property {(token: string, address: string) => Promise<any>} getSupplyBalance - Get supply balance
 * @property {(token: string, address: string) => Promise<any>} getBorrowBalance - Get borrow balance
 */

/**
 * Creates a contract adapter.
 * @param {import('./config.js').BridgeConfig} _config - Bridge configuration
 * @returns {ContractAdapter} Contract adapter
 */
export function createContractAdapter(_config) {
	return {
		getSupplyBalance: async (_token, _address) => null,
		getBorrowBalance: async (_token, _address) => null,
	};
}
