/**
 * @typedef {Object} WalletAdapter
 * @property {() => Promise<void>} connect - Connect wallet
 * @property {() => Promise<void>} disconnect - Disconnect wallet
 * @property {() => string | null} getAccount - Get connected account address
 * @property {() => number} getChainId - Get current chain ID
 * @property {() => boolean} isConnected - Check if wallet is connected
 * @property {(cb: (chainId: number) => void) => void} onChainChange - Subscribe to chain changes
 * @property {() => string | null} getJwt - Get stored JWT token
 */

/**
 * Creates a wallet adapter.
 * @param {import('./config.js').BridgeConfig} config - Bridge configuration
 * @returns {WalletAdapter} Wallet adapter
 */
export function createWalletAdapter(config) {
	return {
		connect: async () => {},
		disconnect: async () => {},
		getAccount: () => null,
		getChainId: () => config.chainId,
		isConnected: () => false,
		onChainChange: (_cb) => {},
		getJwt: () => null,
	};
}
