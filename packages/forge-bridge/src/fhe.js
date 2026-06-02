/**
 * @typedef {Object} FheAdapter
 * @property {() => Promise<void>} permitGrant - Grant CoFHE permit
 * @property {() => Promise<{unlocked: boolean, secondsLeft: number}>} permitCheck - Check permit status
 * @property {(plaintext: number | string, tokenAddress?: string) => Promise<any>} encrypt - Encrypt a value
 * @property {(handle: any) => Promise<string | null>} decrypt - Decrypt a handle
 */

/**
 * Creates an FHE adapter.
 * @param {import('./config.js').BridgeConfig} _config - Bridge configuration
 * @returns {FheAdapter} FHE adapter
 */
export function createFheAdapter(_config) {
	return {
		permitGrant: async () => {},
		permitCheck: async () => ({ unlocked: false, secondsLeft: 0 }),
		encrypt: async (_plaintext, _tokenAddress) => null,
		decrypt: async (_handle) => null,
	};
}
