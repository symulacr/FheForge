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
import { createPublicClient, http as viemHttp } from "viem";
import { arbitrumSepolia } from "viem/chains";

import { WalletError } from "./types.js";

/** localStorage key for the JWT token */
const STORAGE_KEY_JWT = "auth_token";

/** @type {import('viem').PublicClient | null} */
let _publicClient = null;

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
				injected({
					target: {
						id: "metaMask",
						name: "MetaMask",
						provider: () =>
							findInjectedProvider("metaMask") ?? /** @type {any} */ (window).ethereum,
					},
					shimDisconnect: true,
				}),
				injected({
					target: { id: "rabby", name: "Rabby", provider: () => findInjectedProvider("rabby") },
					shimDisconnect: true,
				}),
				// Only add WalletConnect if a real projectId is configured
				...(config.walletConnectProjectId
					? [walletConnect({ projectId: config.walletConnectProjectId })]
					: []),
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
 * Get the shared viem public client for real chain reads.
 * @param {import('./config.js').BridgeConfig} config
 * @returns {import('viem').PublicClient}
 */
function getPublicClient(config) {
	if (!_publicClient) {
		_publicClient = createPublicClient({
			chain: arbitrumSepolia,
			transport: viemHttp(config.rpcUrl),
		});
	}
	return _publicClient;
}

/**
 * Return injected providers exposed by wallets, including EIP-5749 multi-injected arrays.
 * @returns {Array<any>}
 */
function getInjectedProviders() {
	if (typeof window === "undefined") return [];
	const ethereum = /** @type {any} */ (window).ethereum;
	if (!ethereum) return [];
	if (Array.isArray(ethereum.providers)) return ethereum.providers;
	return [ethereum];
}

/**
 * Find a browser wallet provider by wallet id. Falls back to window.ethereum safely.
 * @param {'metaMask' | 'rabby'} walletId
 * @returns {any | undefined}
 */
function findInjectedProvider(walletId) {
	const providers = getInjectedProviders();
	if (walletId === "rabby") {
		return providers.find((provider) => provider?.isRabby) ?? undefined;
	}
	if (walletId === "metaMask") {
		return providers.find((provider) => provider?.isMetaMask && !provider?.isRabby) ?? undefined;
	}
	return undefined;
}

/**
 * @typedef {Object} InjectedProviderStatus
 * @property {'metaMask' | 'rabby'} walletId - Wallet identifier.
 * @property {string} name - Human-readable wallet name.
 * @property {boolean} available - Whether the wallet's injected provider is present.
 * @property {any | undefined} provider - The discovered injected provider, if present.
 */

const INJECTED_WALLET_NAMES = {
	metaMask: "MetaMask",
	rabby: "Rabby",
};

/**
 * Get readiness status for an injected wallet provider.
 * @param {'metaMask' | 'rabby'} walletId
 * @returns {InjectedProviderStatus}
 */
export function getInjectedProviderStatus(walletId) {
	const provider = findInjectedProvider(walletId);
	return {
		walletId,
		name: INJECTED_WALLET_NAMES[walletId],
		available: Boolean(provider),
		provider,
	};
}

/**
 * Throw a deterministic wallet-specific error when an injected provider is unavailable.
 * @param {'metaMask' | 'rabby'} walletId
 * @returns {void}
 */
function assertInjectedProviderAvailable(walletId) {
	const status = getInjectedProviderStatus(walletId);
	if (!status.available) {
		throw new WalletError(
			"PROVIDER_NOT_FOUND",
			`${status.name} provider not found. Install ${status.name} or enable it for this site.`,
		);
	}
}

/**
 * Return true when a connector id maps to an injected provider with explicit discovery.
 * @param {string | undefined} connectorId
 * @returns {connectorId is 'metaMask' | 'rabby'}
 */
function isInjectedWalletConnectorId(connectorId) {
	return connectorId === "metaMask" || connectorId === "rabby";
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
 * @property {() => Promise<any | null>} getProvider
 * @property {(chainId: number) => Promise<void>} switchNetwork
 * @property {() => string | null} getAccount
 * @property {() => number} getChainId
 * @property {(address?: string) => Promise<bigint>} getBalance
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
				if (isInjectedWalletConnectorId(connectorId)) {
					assertInjectedProviderAvailable(connectorId);
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
			assertInjectedProviderAvailable("metaMask");
			try {
				const result = await wagmiConnect(wagmiConfig, {
					connector: connectors[0],
				});
				return { accounts: result };
			} catch (error) {
				throw new WalletError(
					"CONNECT_FAILED",
					/** @type {Error} */ (error).message || "Failed to connect MetaMask.",
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
		 * Get the provider for the active wagmi connection.
		 * @returns {Promise<any | null>} Active provider or null if disconnected
		 */
		async getProvider() {
			const activeConnection = getConnections(wagmiConfig)?.[0];
			if (activeConnection?.connector?.getProvider) {
				return activeConnection.connector.getProvider();
			}
			return null;
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
		 * Get the native ETH balance for an address using the configured RPC.
		 * @param {string} [address] - Address to query; defaults to connected account.
		 * @returns {Promise<bigint>} Balance in wei
		 */
		async getBalance(address) {
			const targetAddress = address ?? this.getAccount();
			if (!targetAddress) {
				throw new WalletError("NOT_CONNECTED", "Wallet not connected. Connect wallet first.");
			}
			try {
				return await getPublicClient(config).getBalance({
					address: /** @type {`0x${string}`} */ (targetAddress),
				});
			} catch (error) {
				throw new WalletError(
					"BALANCE_FAILED",
					/** @type {Error} */ (error).message || "Failed to get wallet balance",
				);
			}
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

			const baseUrl = config.apiBaseUrl;

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
				const chainId = this.getChainId();
				if (!chainId) {
					throw new WalletError("NOT_CONNECTED", "Wallet chain unavailable. Connect wallet first.");
				}

				const loginRes = await fetch(`${baseUrl}/auth/wallet-login`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						walletAddress: account,
						signature,
						nonce,
						chainId,
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
			/** @type {Array<() => void>} */
			const providerUnsubscribers = [];

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

			for (const provider of getInjectedProviders()) {
				if (!provider?.on || !provider?.removeListener) continue;
				/** @param {unknown} accounts */
				const handleAccountsChanged = (accounts) => {
					const nextAccount = Array.isArray(accounts) ? accounts[0] : undefined;
					cb({ account: nextAccount });
				};
				/** @param {string | number} chainId */
				const handleChainChanged = (chainId) => {
					const parsed =
						typeof chainId === "string" ? Number.parseInt(chainId, 16) : Number(chainId);
					if (!Number.isNaN(parsed)) cb({ chainId: parsed });
				};
				provider.on("accountsChanged", handleAccountsChanged);
				provider.on("chainChanged", handleChainChanged);
				providerUnsubscribers.push(() => {
					provider.removeListener("accountsChanged", handleAccountsChanged);
					provider.removeListener("chainChanged", handleChainChanged);
				});
			}

			return () => {
				if (unwatchAccountFn) {
					unwatchAccountFn();
					unwatchAccountFn = null;
				}
				if (unwatchChainFn) {
					unwatchChainFn();
					unwatchChainFn = null;
				}
				for (const unsubscribeProvider of providerUnsubscribers) {
					unsubscribeProvider();
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
