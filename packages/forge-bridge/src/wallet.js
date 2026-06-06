/**
 * @file Wallet adapter — wagmi v2 with EIP-6963 auto-discovery and WalletConnect
 * JWT lifecycle with httpOnly cookie authentication.
 *
 * @typedef {import('./config.js').BridgeConfig} BridgeConfig
 * @typedef {import('@wagmi/core').ConnectReturnType} ConnectReturnType
 * @typedef {import('@wagmi/core').Config} WagmiConfig
 */

import { walletConnect } from '@wagmi/connectors';
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
} from '@wagmi/core';
import { createPublicClient, http as viemHttp } from 'viem';
import { arbitrumSepolia } from 'viem/chains';

import { WalletError } from './types.js';

/** @type {import('viem').PublicClient | null} */
let _publicClient = null;

/**
 * EIP-3086 chain parameters for Arbitrum Sepolia.
 * Used as fallback when wallet does not have the chain configured.
 */
const ARB_SEPOLIA_CHAIN_PARAMS = {
  chainId: '0x66eee', // 421614 in hex
  chainName: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://sepolia-arbitrum-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.arbiscan.io'],
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
        injected(),
        // Only add WalletConnect if a real projectId is configured
        ...(config.walletConnectProjectId
          ? [walletConnect({ projectId: config.walletConnectProjectId })]
          : []),
      ],
      transports: {
        [arbitrumSepolia.id]: http(config.rpcUrl),
      },
      storage:
        typeof window !== 'undefined' ? createStorage({ storage: window.localStorage }) : undefined,
    });
  }
  return _wagmiConfig;
}

/**
 * Check whether we are running in a browser environment.
 * @returns {boolean}
 */
function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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
 * @typedef {Object} WalletAdapter
 * @property {(id?: string) => Promise<{accounts: ConnectReturnType | undefined}>} connect
 * @property {() => Promise<void>} disconnect @property {() => Promise<any>} getProvider
 * @property {(chainId: number) => Promise<void>} switchNetwork @property {() => string | null} getAccount
 * @property {() => number} getChainId @property {(a?: string) => Promise<bigint>} getBalance
 * @property {() => boolean} isConnected @property {() => string | null} getJwt
 * @property {() => Promise<{accessToken: string, userId: string, walletAddress: string}>} login
 * @property {() => Promise<void>} logout @property {(cb: Function) => (() => void)} onChainChange
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

  /**
   * Re-throw WalletError as-is, wrap other errors.
   * @param {string} code
   * @param {unknown} error
   * @param {string} [fallbackMsg]
   */
  function wrapError(code, error, fallbackMsg) {
    if (error instanceof WalletError) throw error;
    throw new WalletError(code, /** @type {Error} */ (error).message || fallbackMsg || code);
  }

  /**
   * Connect via a resolved connector.
   * @param {import('@wagmi/core').Connector} connector
   */
  async function doConnect(connector) {
    try {
      const result = await wagmiConnect(wagmiConfig, { connector });
      return { accounts: result };
    } catch (error) {
      wrapError('CONNECT_FAILED', error, 'Failed to connect wallet');
    }
  }

  return {
    /**
     * Connect a wallet. If no connectorId is given, tries the first available connector.
     * @param {string} [connectorId] - Optional connector id
     * @returns {Promise<{accounts: ConnectReturnType | undefined}>}
     */
    async connect(connectorId) {
      const connectors = getConnectors(wagmiConfig);

      if (connectorId) {
        const connector = connectors.find((c) => c.id === connectorId);
        if (!connector) {
          throw new WalletError(
            'CONNECTOR_NOT_FOUND',
            `Connector "${connectorId}" not found. Available: ${connectors.map((c) => c.id).join(', ')}`,
          );
        }
        return doConnect(connector);
      }

      return doConnect(connectors[0]);
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
        const needsAdd =
          err.message?.includes('addEthereumChain') ||
          err.code === 4902 ||
          err.name === 'ChainNotConfiguredError';

        if (!needsAdd) {
          throw new WalletError('SWITCH_NETWORK_FAILED', err.message || 'Failed to switch network');
        }

        // Chain not configured — try wallet_addEthereumChain fallback
        const conn = getConnections(wagmiConfig)?.[0];
        const provider = conn?.connector?.getProvider
          ? /** @type {any} */ (await conn.connector.getProvider())
          : null;

        if (!provider?.request) {
          throw new WalletError(
            'SWITCH_NETWORK_FAILED',
            'Network mismatch. Please switch to Arbitrum Sepolia in your wallet.',
          );
        }

        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [ARB_SEPOLIA_CHAIN_PARAMS],
          });
        } catch {
          throw new WalletError(
            'SWITCH_NETWORK_FAILED',
            'Network mismatch. Please switch to Arbitrum Sepolia in your wallet.',
          );
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
        throw new WalletError('NOT_CONNECTED', 'Wallet not connected. Connect wallet first.');
      }
      try {
        return await getPublicClient(config).getBalance({
          address: /** @type {`0x${string}`} */ (targetAddress),
        });
      } catch (error) {
        wrapError('BALANCE_FAILED', error, 'Failed to get wallet balance');
      }
    },

    /**
     * Check whether a wallet is connected.
     * @returns {boolean}
     */
    isConnected() {
      return wagmiGetAccount(wagmiConfig).status === 'connected';
    },

    /**
     * Get the JWT. Not accessible to JS — lives in httpOnly cookie.
     * @returns {string | null}
     */
    getJwt() {
      // JWT is in httpOnly cookie, not accessible to JS
      return null;
    },

    /**
     * Perform wallet-based JWT login:
     * 1. GET /auth/nonce/:address -> { nonce, message }
     * 2. Sign message via wagmi
     * 3. POST /auth/wallet-login with { walletAddress, signature, nonce }
     * 4. Server sets httpOnly JWT cookie
     *
     * @returns {Promise<{accessToken: string, userId: string, walletAddress: string}>}
     */
    async login() {
      const account = this.getAccount();
      if (!account) {
        throw new WalletError('NOT_CONNECTED', 'Wallet not connected. Connect wallet first.');
      }

      const baseUrl = config.apiBaseUrl;

      try {
        // 1. Fetch nonce
        const nonceRes = await fetch(`${baseUrl}/auth/nonce/${account}`, {
          credentials: 'include',
        });
        if (!nonceRes.ok) {
          throw new WalletError('NONCE_FAILED', `Failed to get nonce: ${nonceRes.status}`);
        }
        const { nonce, message } = await nonceRes.json();

        // 2. Sign message via wagmi
        const signature = await wagmiSignMessage(wagmiConfig, { message });

        // 3. POST login
        const chainId = this.getChainId();
        if (!chainId) {
          throw new WalletError('NOT_CONNECTED', 'Wallet chain unavailable. Connect wallet first.');
        }

        const loginRes = await fetch(`${baseUrl}/auth/wallet-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            walletAddress: account,
            signature,
            nonce,
            chainId,
          }),
        });
        if (!loginRes.ok) {
          throw new WalletError('LOGIN_FAILED', `Authentication failed: ${loginRes.status}`);
        }
        const data = await loginRes.json();

        return {
          accessToken: data.accessToken,
          userId: data.userId,
          walletAddress: account,
        };
      } catch (error) {
        wrapError('LOGIN_FAILED', error, 'Login failed');
      }
    },

    /**
     * Logout — clears the server-side httpOnly JWT cookie.
     * @returns {Promise<void>}
     */
    async logout() {
      try {
        await fetch(`${config.apiBaseUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch {
        /* silent */
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
