/**
 * @file Wallet adapter — wagmi v2 integration with MetaMask, Rabby, WalletConnect
 * JWT lifecycle with localStorage persistence and auto-refresh.
 *
 * @typedef {import('./config.js').BridgeConfig} BridgeConfig
 * @typedef {import('@wagmi/core').ConnectReturnType} ConnectReturnType
 * @typedef {import('@wagmi/core').Config} WagmiConfig
 */

import { walletConnect } from "@wagmi/connectors";
import {
	createConfig,
	createStorage,
	getConnections,
	getConnectors,
	http,
	injected,
	connect as wagmiConnect,
	disconnect as wagmiDisconnect,
	getAccount as wagmiGetAccount,
	getChainId as wagmiGetChainId,
	reconnect as wagmiReconnect,
	signMessage as wagmiSignMessage,
	switchChain as wagmiSwitchChain,
	watchAccount,
	watchChainId,
} from "@wagmi/core";
import { arbitrumSepolia } from "viem/chains";

import { WalletError } from "./types.js";

/** localStorage key for the JWT token */
const STORAGE_KEY_JWT = "auth_token";

/**
 * EIP-3086 chain parameters for Arbitrum Sepolia.
 * Used as fallback when wallet does not have the chain configured.
 */
const ARB_SEPOLIA_CHAIN_PARAMS = {
	chainId: "0x66eee", // 421614 in hex
	chainName: "Arbitrum Sepolia",
	nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
	rpcUrls: ["https://sepolia-arbitrum-rpc.publicnode.com"],
	blockExplorerUrls: ["https://sepolia.arbiscan.io"],
};

/** @type {WagmiConfig | null} */
let _wagmiConfig = null;

/**
 * Returns (or creates) the singleton wagmi config.
 * @param {import('./config.js').BridgeConfig} config - Bridge configuration
 * @returns {WagmiConfig} Wagmi config
 */
function getWagmiConfig(config) {
	if (!_wagmiConfig) {
		_wagmiConfig = createConfig({
			chains: [arbitrumSepolia],
			connectors: [
				injected({ target: "metaMask", shimDisconnect: true }),
				injected({
					target: { id: "rabby", name: "Rabby", provider: "isRabby" },
					shimDisconnect: true,
				}),
				walletConnect({
					projectId: config.walletConnectProjectId ?? "00000000000000000000000000000000",
				}),
			],
			transports: {
				[arbitrumSepolia.id]: http(config.rpcUrl),
			},
			storage:
				typeof window !== "undefined" ? createStorage({ storage: window.localStorage }) : undefined,
		});
	}
	return _wagmiConfig;
}

/**
 * Check whether we are running in a browser environment.
 * @returns {boolean}
 */
function isBrowser() {
	return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * Decode a JWT's payload without verifying the signature.
 * @param {string} token - JWT string
 * @returns {Record<string, unknown> | null} Decoded payload or null
 */
function decodeJwtPayload(token) {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		return JSON.parse(atob(parts[1]));
	} catch {
		return null;
	}
}

/**
 * Check whether a JWT token has expired.
 * @param {string} token - JWT string
 * @returns {boolean} true if expired or unreadable
 */
function isTokenExpired(token) {
	const payload = decodeJwtPayload(token);
	if (!payload || typeof payload.exp !== "number") return true;
	return Date.now() >= payload.exp * 1000;
}

/**
 * Retrieve a stored JWT from localStorage, returning null if absent or expired.
 * @returns {string | null}
 */
function getStoredJwt() {
	if (!isBrowser()) return null;
	const token = localStorage.getItem(STORAGE_KEY_JWT);
	if (!token) return null;
	if (isTokenExpired(token)) {
		localStorage.removeItem(STORAGE_KEY_JWT);
		return null;
	}
	return token;
}

/**
 * @typedef {Object} WalletAdapter
 * @property {(connectorId?: string) => Promise<{accounts: ConnectReturnType | undefined}>} connect
 * @property {() => Promise<void>} disconnect
 * @property {(chainId: number) => Promise<void>} switchNetwork
 * @property {() => string | null} getAccount
 * @property {() => number} getChainId
 * @property {() => boolean} isConnected
 * @property {() => string | null} getJwt
 * @property {() => Promise<{accessToken: string, userId: string, walletAddress: string}>} login
 * @property {() => Promise<void>} logout
 * @property {(cb: (data: {chainId?: number, account?: string}) => void) => (() => void)} onChainChange
 * @property {() => Promise<{accessToken: string, userId: string, walletAddress: string}>} refreshJwt
 */

/**
 * Create a wallet adapter wrapping wagmi core v2 actions.
 *
 * @param {import('./config.js').BridgeConfig} config - Bridge configuration
 * @returns {WalletAdapter} Wallet adapter
 */
export function createWalletAdapter(config) {
	const wagmiConfig = getWagmiConfig(config);

	// Attempt auto-reconnect on creation (browser only)
	if (isBrowser()) {
		wagmiReconnect(wagmiConfig).catch(() => {
			/* silent — user will connect manually */
		});
	}

	/** @type {(() => void) | null} */
	let unwatchAccountFn = null;
	/** @type {(() => void) | null} */
	let unwatchChainFn = null;

	return {
		/**
		 * Connect a wallet. If no connectorId is given, tries injected (MetaMask) first.
		 * @param {string} [connectorId] - Optional connector id ("metaMask", "rabby", "walletConnect")
		 * @returns {Promise<{accounts: ConnectReturnType | undefined}>}
		 */
		async connect(connectorId) {
			const connectors = getConnectors(wagmiConfig);

			if (connectorId) {
				const connector = connectors.find((c) => c.id === connectorId);
				if (!connector) {
					throw new WalletError(
						"CONNECTOR_NOT_FOUND",
						`Connector "${connectorId}" not found. Available: ${connectors.map((c) => c.id).join(", ")}`,
					);
				}
				try {
					const result = await wagmiConnect(wagmiConfig, { connector });
					return { accounts: result };
				} catch (error) {
					throw new WalletError(
						"CONNECT_FAILED",
						/** @type {Error} */ (error).message || "Failed to connect wallet",
					);
				}
			}

			// Try the first connector (metaMask injected) by default
			try {
				const result = await wagmiConnect(wagmiConfig, {
					connector: connectors[0],
				});
				return { accounts: result };
			} catch (error) {
				throw new WalletError(
					"CONNECT_FAILED",
					/** @type {Error} */ (error).message || "No wallet detected. Install MetaMask or Rabby.",
				);
			}
		},

		/**
		 * Disconnect the wallet and clear stored JWT.
		 * @returns {Promise<void>}
		 */
		async disconnect() {
			try {
				await wagmiDisconnect(wagmiConfig);
			} catch (_error) {
				// proceed — clean up local state regardless
			}
			if (isBrowser()) {
				localStorage.removeItem(STORAGE_KEY_JWT);
			}
		},

		/**
		 * Switch to a different chain. For unsupported chains, tries
		 * `wallet_addEthereumChain` as a fallback.
		 * @param {number} chainId - Target chain ID (e.g. 421614 for Arbitrum Sepolia)
		 * @returns {Promise<void>}
		 */
		async switchNetwork(chainId) {
			try {
				await wagmiSwitchChain(wagmiConfig, { chainId });
			} catch (error) {
				const err = /** @type {Error & {code?: number}} */ (error);

				// Chain not configured in wallet — try wallet_addEthereumChain
				if (
					err.message?.includes("addEthereumChain") ||
					err.code === 4902 ||
					err.name === "ChainNotConfiguredError"
				) {
					try {
						const connections = getConnections(wagmiConfig);
						const activeConnection = connections?.[0];
						/** @type {{request: (args: {method: string, params: unknown[]}) => Promise<unknown>} | null} */
						let provider = null;
						if (activeConnection?.connector?.getProvider) {
							provider = /** @type {any} */ (await activeConnection.connector.getProvider());
						}
						if (provider?.request) {
							await provider.request({
								method: "wallet_addEthereumChain",
								params: [ARB_SEPOLIA_CHAIN_PARAMS],
							});
						} else {
							throw new WalletError(
								"SWITCH_NETWORK_FAILED",
								"Network mismatch. Please switch to Arbitrum Sepolia in your wallet.",
							);
						}
					} catch (_addError) {
						throw new WalletError(
							"SWITCH_NETWORK_FAILED",
							"Network mismatch. Please switch to Arbitrum Sepolia in your wallet.",
						);
					}
				} else {
					throw new WalletError("SWITCH_NETWORK_FAILED", err.message || "Failed to switch network");
				}
			}
		},

		/**
		 * Get the currently connected account address.
		 * @returns {string | null} Address or null if not connected
		 */
		getAccount() {
			const account = wagmiGetAccount(wagmiConfig);
			return account.address ?? null;
		},

		/**
		 * Get the current chain ID.
		 * @returns {number}
		 */
		getChainId() {
			return wagmiGetChainId(wagmiConfig);
		},

		/**
		 * Check whether a wallet is connected.
		 * @returns {boolean}
		 */
		isConnected() {
			return wagmiGetAccount(wagmiConfig).status === "connected";
		},

		/**
		 * Get the stored JWT from localStorage. Returns null if absent or expired.
		 * @returns {string | null}
		 */
		getJwt() {
			return getStoredJwt();
		},

		/**
		 * Perform wallet-based JWT login:
		 * 1. GET /auth/nonce/:address -> { nonce, message }
		 * 2. Sign message via wagmi
		 * 3. POST /auth/wallet-login with { walletAddress, signature, nonce }
		 * 4. Store accessToken in localStorage
		 *
		 * @returns {Promise<{accessToken: string, userId: string, walletAddress: string}>}
		 */
		async login() {
			const account = this.getAccount();
			if (!account) {
				throw new WalletError("NOT_CONNECTED", "Wallet not connected. Connect wallet first.");
			}

			const baseUrl = config.apiBaseUrl ?? "https://fheforge-api-production-6465.up.railway.app";

			try {
				// 1. Fetch nonce
				const nonceRes = await fetch(`${baseUrl}/auth/nonce/${account}`);
				if (!nonceRes.ok) {
					throw new WalletError("NONCE_FAILED", `Failed to get nonce: ${nonceRes.status}`);
				}
				const { nonce, message } = await nonceRes.json();

				// 2. Sign message via wagmi
				const signature = await wagmiSignMessage(wagmiConfig, { message });

				// 3. POST login
				const loginRes = await fetch(`${baseUrl}/auth/wallet-login`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						walletAddress: account,
						signature,
						nonce,
						chainId: config.chainId ?? 421614,
					}),
				});
				if (!loginRes.ok) {
					throw new WalletError("LOGIN_FAILED", `Authentication failed: ${loginRes.status}`);
				}
				const data = await loginRes.json();

				// 4. Store JWT in localStorage
				if (isBrowser()) {
					localStorage.setItem(STORAGE_KEY_JWT, data.accessToken);
				}

				return {
					accessToken: data.accessToken,
					userId: data.userId,
					walletAddress: account,
				};
			} catch (error) {
				if (error instanceof WalletError) throw error;
				throw new WalletError(
					"LOGIN_FAILED",
					/** @type {Error} */ (error).message || "Login failed",
				);
			}
		},

		/**
		 * Clear the stored JWT from localStorage.
		 * @returns {Promise<void>}
		 */
		async logout() {
			if (isBrowser()) {
				localStorage.removeItem(STORAGE_KEY_JWT);
			}
		},

		/**
		 * Register a callback for chain or account changes.
		 * Returns an unsubscribe function.
		 *
		 * @param {(data: {chainId?: number, account?: string}) => void} cb
		 * @returns {() => void} Unsubscribe function
		 */
		onChainChange(cb) {
			// Clean up previous watchers
			if (unwatchAccountFn) {
				unwatchAccountFn();
				unwatchAccountFn = null;
			}
			if (unwatchChainFn) {
				unwatchChainFn();
				unwatchChainFn = null;
			}

			unwatchAccountFn = watchAccount(wagmiConfig, {
				onChange(account) {
					cb({ account: account.address });
				},
			});

			unwatchChainFn = watchChainId(wagmiConfig, {
				onChange(chainId) {
					cb({ chainId });
				},
			});

			return () => {
				if (unwatchAccountFn) {
					unwatchAccountFn();
					unwatchAccountFn = null;
				}
				if (unwatchChainFn) {
					unwatchChainFn();
					unwatchChainFn = null;
				}
			};
		},

		/**
		 * Silently refresh the JWT by re-executing the login flow.
		 * Used by the API adapter when it receives a 401 response.
		 *
		 * @returns {Promise<{accessToken: string, userId: string, walletAddress: string}>}
		 */
		async refreshJwt() {
			const result = await this.login();
			return result;
		},
	};
}
