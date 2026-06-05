/**
 * @file Bridge React hooks — React wrappers around core adapter methods.
 *
 * Provides:
 * - BridgeProvider component for context-based access
 * - useBridge(config) → creates hub and provides React context
 * - useWallet() → wallet state + connect/disconnect/login
 * - usePermit() → permit state + grantPermit
 * - useMarkets() → market list with auto-refresh interval
 * - useStats() → protocol stats
 * - usePositions(address) → user positions (FHE-decrypted if permitted)
 * - useStrategies(filters) → strategy list
 * - useGovernanceProposals(status) → proposal list
 * - useGovernanceVote() → castVote action
 * - useBuilderSimulate() → simulate strategy
 * - useBuilderAI() → AI strategy build
 * - useBuilderDeploy() → deploy strategy
 * - useBuilderEstimate() → estimate operation
 * - useBuilderModules() → DeFi modules list
 * - useFHE() → encrypt/decrypt helpers
 * - useLtvGauge(token) → LTV calculation
 *
 * Each hook manages loading/data/error state and cleans up on unmount.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createBridge } from '../hub.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const BridgeContext = createContext(/** @type {any} */ (null));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve the bridge instance from context.
 * @returns {any}
 */
function useBridgeContext() {
  const bridge = useContext(BridgeContext);
  if (!bridge) {
    throw new Error(
      'Bridge not initialized. Wrap your component tree with <BridgeProvider> or call useBridge(config).',
    );
  }
  return bridge;
}

/**
 * React hook for managing async operation state (loading, data, error).
 * Provides an `execute` function that updates state on completion.
 *
 * @param {Function} asyncFn - The async function to wrap
 * @returns {{ loading: boolean, data: any, error: any, execute: Function }}
 */
function useAsyncAction(asyncFn) {
  const [state, setState] = useState(
    /** @type {{ loading: boolean, data: any, error: any }} */ ({
      loading: false,
      data: null,
      error: null,
    }),
  );
  const mountedRef = useRef(true);
  const fnRef = useRef(asyncFn);
  fnRef.current = asyncFn;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** @type {(...args: any[]) => Promise<any>} */
  const execute = useCallback(async (...args) => {
    setState({ loading: true, data: null, error: null });
    try {
      const data = await fnRef.current(...args);
      if (mountedRef.current) {
        setState({ loading: false, data, error: null });
      }
      return data;
    } catch (err) {
      if (mountedRef.current) {
        setState({ loading: false, data: null, error: err });
      }
      throw err;
    }
  }, []);

  return { ...state, execute };
}

/**
 * React hook that auto-fetches on mount and optionally on a refresh interval.
 *
 * @param {Function} fetchFn - Fetch function
 * @param {number} [intervalMs] - Auto-refresh interval in ms (0 = no auto-refresh)
 * @returns {{ loading: boolean, data: any, error: any, refresh: Function }}
 */
function useAutoFetch(fetchFn, intervalMs) {
  const [state, setState] = useState(
    /** @type {{ loading: boolean, data: any, error: any }} */ ({
      loading: true,
      data: null,
      error: null,
    }),
  );
  const mountedRef = useRef(true);
  const intervalRef = useRef(/** @type {ReturnType<typeof setInterval> | null} */ (null));
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const doFetch = useCallback(async () => {
    try {
      const data = await fetchRef.current();
      if (mountedRef.current) {
        setState({ loading: false, data, error: null });
      }
    } catch (err) {
      if (mountedRef.current) {
        setState({ loading: false, data: null, error: err });
      }
    }
  }, []);

  useEffect(() => {
    setState({ loading: true, data: null, error: null });
    doFetch();

    if (intervalMs && intervalMs > 0) {
      intervalRef.current = setInterval(doFetch, intervalMs);
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [doFetch, intervalMs]);

  const refresh = useCallback(() => {
    doFetch();
  }, [doFetch]);

  return { loading: state.loading, data: state.data, error: state.error, refresh };
}

// ---------------------------------------------------------------------------
// BridgeProvider
// ---------------------------------------------------------------------------

/**
 * React component that provides a bridge instance to its children via context.
 *
 * @param {{ config?: import('../config.js').BridgeConfig, children: any }} props
 * @returns {import('react').ReactElement}
 */
export function BridgeProvider({ config, children }) {
  const bridge = useMemo(() => createBridge(config || {}), [config]);
  return createElement(BridgeContext.Provider, { value: bridge }, children);
}

// ---------------------------------------------------------------------------
// useBridge
// ---------------------------------------------------------------------------

/**
 * Creates or retrieves the bridge hub via createBridge(config).
 *
 * @param {import('../config.js').BridgeConfig} [config] - Optional bridge configuration
 * @returns {any} Bridge hub instance
 */
export function useBridge(config) {
  const ctxBridge = useContext(BridgeContext);
  const standaloneBridge = useMemo(() => {
    if (config && !ctxBridge) return createBridge(config);
    return null;
  }, [config, ctxBridge]);

  if (standaloneBridge) return standaloneBridge;
  if (ctxBridge) return ctxBridge;

  throw new Error(
    'Bridge not initialized. Wrap your app with <BridgeProvider> or pass config to useBridge.',
  );
}

// ---------------------------------------------------------------------------
// useWallet
// ---------------------------------------------------------------------------

/**
 * Tracks wallet connection state and provides connect/disconnect/login actions.
 *
 * @returns {{
 *   loading: boolean,
 *   data: any,
 *   error: any,
 *   connect: Function,
 *   disconnect: Function,
 *   login: Function,
 *   logout: Function,
 *   switchNetwork: Function
 * }}
 */
export function useWallet() {
  const bridge = useBridgeContext();

  const [walletState, setWalletState] = useState(
    /** @type {{ loading: boolean, data: any, error: any }} */ ({
      loading: false,
      data: null,
      error: null,
    }),
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const snapshotWallet = useCallback(() => {
    try {
      const w = bridge.wallet;
      if (!w) {
        return { connected: false, address: null, chainId: 0, hasJwt: false, isConnecting: false };
      }
      return {
        connected: w.isConnected(),
        address: w.getAccount(),
        chainId: w.getChainId(),
        hasJwt: !!w.getJwt(),
        isConnecting: false,
      };
    } catch {
      return { connected: false, address: null, chainId: 0, hasJwt: false, isConnecting: false };
    }
  }, [bridge]);

  /** @type {(connectorId: string) => Promise<any>} */
  const connect = useCallback(
    async (connectorId) => {
      setWalletState({ loading: true, data: null, error: null });
      try {
        const result = await bridge.wallet.connect(connectorId);
        const snap = snapshotWallet();
        if (mountedRef.current) {
          setWalletState({ loading: false, data: snap, error: null });
        }
        return result;
      } catch (err) {
        if (mountedRef.current) {
          setWalletState({ loading: false, data: null, error: err });
        }
        throw err;
      }
    },
    [bridge, snapshotWallet],
  );

  const disconnect = useCallback(async () => {
    try {
      await bridge.wallet.disconnect();
      if (mountedRef.current) {
        setWalletState({ loading: false, data: snapshotWallet(), error: null });
      }
    } catch (err) {
      if (mountedRef.current) {
        setWalletState({ loading: false, data: null, error: err });
      }
      throw err;
    }
  }, [bridge, snapshotWallet]);

  const login = useCallback(async () => {
    setWalletState({ loading: true, data: null, error: null });
    try {
      const result = await bridge.wallet.login();
      const snap = snapshotWallet();
      if (mountedRef.current) {
        setWalletState({ loading: false, data: snap, error: null });
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        setWalletState({ loading: false, data: null, error: err });
      }
      throw err;
    }
  }, [bridge, snapshotWallet]);

  const logout = useCallback(async () => {
    try {
      await bridge.wallet.logout();
      if (mountedRef.current) {
        setWalletState({ loading: false, data: snapshotWallet(), error: null });
      }
    } catch (err) {
      if (mountedRef.current) {
        setWalletState({ loading: false, data: null, error: err });
      }
      throw err;
    }
  }, [bridge, snapshotWallet]);

  /** @type {(chainId: number) => Promise<any>} */
  const switchNetwork = useCallback(
    async (chainId) => {
      try {
        await bridge.wallet.switchNetwork(chainId);
        if (mountedRef.current) {
          setWalletState({ loading: false, data: snapshotWallet(), error: null });
        }
      } catch (err) {
        if (mountedRef.current) {
          setWalletState({ loading: false, data: null, error: err });
        }
        throw err;
      }
    },
    [bridge, snapshotWallet],
  );

  // Listen for chain/account changes
  useEffect(() => {
    /** @type {(() => void) | undefined} */
    let unsub;
    try {
      unsub = bridge.wallet.onChainChange(() => {
        if (mountedRef.current) {
          setWalletState((prev) => ({
            ...prev,
            data: snapshotWallet(),
          }));
        }
      });
    } catch {
      // onChainChange may not be available in all environments
    }

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [bridge, snapshotWallet]);

  // Initial snapshot on mount
  useEffect(() => {
    setWalletState({
      loading: false,
      data: snapshotWallet(),
      error: null,
    });
  }, [snapshotWallet]);

  return {
    loading: walletState.loading,
    data: walletState.data,
    error: walletState.error,
    connect,
    disconnect,
    login,
    logout,
    switchNetwork,
  };
}

// ---------------------------------------------------------------------------
// usePermit
// ---------------------------------------------------------------------------

/**
 * Tracks FHE permit state and provides grantPermit action.
 *
 * @returns {{
 *   loading: boolean,
 *   data: any,
 *   error: any,
 *   grantPermit: Function
 * }}
 */
export function usePermit() {
  const bridge = useBridgeContext();

  const [permitState, setPermitState] = useState(
    /** @type {{ loading: boolean, data: any, error: any }} */ ({
      loading: false,
      data: null,
      error: null,
    }),
  );
  const mountedRef = useRef(true);
  const countdownRef = useRef(/** @type {ReturnType<typeof setInterval> | null} */ (null));

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, []);

  const grantPermit = useCallback(async () => {
    setPermitState({ loading: true, data: null, error: null });
    try {
      const result = await bridge.fhe.permitGrant();
      if (mountedRef.current) {
        setPermitState({ loading: false, data: result, error: null });
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        setPermitState({ loading: false, data: null, error: err });
      }
      throw err;
    }
  }, [bridge]);

  // Initial state + countdown ticker
  useEffect(() => {
    function tick() {
      if (!mountedRef.current) return;
      try {
        const state = bridge.fhe.permitCheck();
        setPermitState({ loading: false, data: state, error: null });
      } catch {
        // ignore
      }
    }

    tick();
    countdownRef.current = setInterval(tick, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [bridge]);

  return {
    loading: permitState.loading,
    data: permitState.data,
    error: permitState.error,
    grantPermit,
  };
}

// ---------------------------------------------------------------------------
// useMarkets
// ---------------------------------------------------------------------------

/**
 * Fetches lending market data with an auto-refresh interval (default 30s).
 *
 * @param {number} [refreshIntervalMs] - Auto-refresh interval in ms (default 30000)
 * @returns {{ loading: boolean, data: any, error: any, refresh: Function }}
 */
export function useMarkets(refreshIntervalMs) {
  const bridge = useBridgeContext();
  const effectiveInterval = refreshIntervalMs !== undefined ? refreshIntervalMs : 30000;
  return useAutoFetch(() => bridge.api.markets.getMarkets(), effectiveInterval);
}

// ---------------------------------------------------------------------------
// useStats
// ---------------------------------------------------------------------------

/**
 * Fetches protocol-wide statistics with an auto-refresh interval (default 30s).
 *
 * @param {number} [refreshIntervalMs] - Auto-refresh interval in ms (default 30000)
 * @returns {{ loading: boolean, data: any, error: any, refresh: Function }}
 */
export function useStats(refreshIntervalMs) {
  const bridge = useBridgeContext();
  const effectiveInterval = refreshIntervalMs !== undefined ? refreshIntervalMs : 30000;
  return useAutoFetch(() => bridge.api.stats.getStats(), effectiveInterval);
}

// ---------------------------------------------------------------------------
// usePositions
// ---------------------------------------------------------------------------

/**
 * Fetches user positions and optionally decrypts them via FHE if a permit is active.
 *
 * @param {string} address - User wallet address
 * @returns {{ loading: boolean, data: any, error: any, refresh: Function }}
 */
export function usePositions(address) {
  const bridge = useBridgeContext();
  const addressRef = useRef(address);
  addressRef.current = address;

  return useAutoFetch(async () => {
    const addr = addressRef.current;
    if (!addr) return [];

    const [supplyResult, borrowResult] = await Promise.all([
      bridge.contract.lendingPool.getSupplyBalance(addr).catch(() => null),
      bridge.contract.lendingPool.getBorrowBalance(addr).catch(() => null),
    ]);

    const rawPositions = [];

    if (supplyResult) {
      rawPositions.push({
        type: 'supply',
        token: addr,
        amount: supplyResult,
        encrypted: true,
      });
    }
    if (borrowResult) {
      rawPositions.push({
        type: 'borrow',
        token: addr,
        amount: borrowResult,
        encrypted: true,
      });
    }

    // Decrypt if FHE permit is unlocked
    try {
      const permitState = bridge.fhe.permitCheck();
      if (permitState.unlocked && rawPositions.length > 0) {
        const decrypted = await Promise.all(
          rawPositions.map(async (pos) => {
            try {
              const plaintext = await bridge.fhe.decrypt(String(pos.amount));
              return { ...pos, amount: plaintext, encrypted: false };
            } catch {
              return pos;
            }
          }),
        );
        return decrypted;
      }
    } catch {
      // Decryption not available
    }

    return rawPositions;
  }, 0);
}

// ---------------------------------------------------------------------------
// useStrategies
// ---------------------------------------------------------------------------

/**
 * Fetches the strategy marketplace list with optional filters.
 *
 * @param {Record<string, unknown>} [filters] - Optional filter params
 * @returns {{ loading: boolean, data: any, error: any, refresh: Function }}
 */
export function useStrategies(filters) {
  const bridge = useBridgeContext();
  const filtersRef = useRef(filters);
  filtersRef.current = filters || {};

  return useAutoFetch(() => bridge.api.strategies.listStrategies(filtersRef.current), 0);
}

// ---------------------------------------------------------------------------
// useGovernanceProposals
// ---------------------------------------------------------------------------

/**
 * Fetches governance proposals, optionally filtered by status.
 *
 * @param {string} [status] - Optional status filter
 * @returns {{ loading: boolean, data: any, error: any, refresh: Function }}
 */
export function useGovernanceProposals(status) {
  const bridge = useBridgeContext();
  const statusRef = useRef(status);
  statusRef.current = status;

  return useAutoFetch(() => {
    const params = statusRef.current ? { status: statusRef.current } : undefined;
    return bridge.api.governance.listProposals(params);
  }, 0);
}

// ---------------------------------------------------------------------------
// useGovernanceVote
// ---------------------------------------------------------------------------

/**
 * Provides an action to cast a governance vote.
 *
 * @returns {{
 *   loading: boolean,
 *   data: any,
 *   error: any,
 *   castVote: Function
 * }}
 */
export function useGovernanceVote() {
  const bridge = useBridgeContext();

  /** @type {(proposalId: string, support: boolean, votes: bigint) => Promise<any>} */
  const castVote = useCallback(
    async (proposalId, support, votes) => {
      return bridge.api.governance.castVote({ proposalId, support, votes });
    },
    [bridge],
  );

  return { ...useAsyncAction(castVote), castVote };
}

// ---------------------------------------------------------------------------
// useBuilderSimulate
// ---------------------------------------------------------------------------

/**
 * Simulates a DeFi strategy from nodes/edges.
 *
 * @returns {{
 *   loading: boolean,
 *   data: any,
 *   error: any,
 *   simulate: Function
 * }}
 */
export function useBuilderSimulate() {
  const bridge = useBridgeContext();

  /** @type {(nodes: any[], edges: any[]) => Promise<any>} */
  const simulate = useCallback(
    async (nodes, edges) => {
      return bridge.api.defiStrategies.simulateDefiStrategy({ nodes, edges });
    },
    [bridge],
  );

  return { ...useAsyncAction(simulate), simulate };
}

// ---------------------------------------------------------------------------
// useBuilderAI
// ---------------------------------------------------------------------------

/**
 * Builds a strategy using AI from a natural language prompt.
 *
 * @returns {{
 *   loading: boolean,
 *   data: any,
 *   error: any,
 *   build: Function
 * }}
 */
export function useBuilderAI() {
  const bridge = useBridgeContext();

  /** @type {(prompt: string) => Promise<any>} */
  const build = useCallback(
    async (prompt) => {
      return bridge.api.aiBuilder.buildStrategy({ userIntent: prompt });
    },
    [bridge],
  );

  return { ...useAsyncAction(build), build };
}

// ---------------------------------------------------------------------------
// useBuilderDeploy
// ---------------------------------------------------------------------------

/**
 * Deploys a strategy (steps) to the blockchain.
 *
 * @returns {{
 *   loading: boolean,
 *   data: any,
 *   error: any,
 *   deploy: Function
 * }}
 */
export function useBuilderDeploy() {
  const bridge = useBridgeContext();

  /** @type {(steps: any[]) => Promise<any>} */
  const deploy = useCallback(
    async (steps) => {
      return bridge.api.defiStrategies.createDefiStrategy({ steps });
    },
    [bridge],
  );

  return { ...useAsyncAction(deploy), deploy };
}

// ---------------------------------------------------------------------------
// useBuilderEstimate
// ---------------------------------------------------------------------------

/**
 * Estimates gas or cost for an operation.
 *
 * @returns {{
 *   loading: boolean,
 *   data: any,
 *   error: any,
 *   estimate: Function
 * }}
 */
export function useBuilderEstimate() {
  const bridge = useBridgeContext();

  /** @type {(operation: any) => Promise<any>} */
  const estimate = useCallback(
    async (operation) => {
      return bridge.api.defiStrategies.simulateDefiStrategy({ operation, estimate: true });
    },
    [bridge],
  );

  return { ...useAsyncAction(estimate), estimate };
}

// ---------------------------------------------------------------------------
// useBuilderModules
// ---------------------------------------------------------------------------

/**
 * Fetches available DeFi protocol modules.
 *
 * @returns {{ loading: boolean, data: any, error: any, refresh: Function }}
 */
export function useBuilderModules() {
  const bridge = useBridgeContext();
  return useAutoFetch(() => bridge.api.defiModules.getDefiModules(), 0);
}

// ---------------------------------------------------------------------------
// useFHE
// ---------------------------------------------------------------------------

/**
 * Provides FHE encrypt/decrypt helpers.
 *
 * @returns {{
 *   loading: boolean,
 *   data: any,
 *   error: any,
 *   encrypt: Function,
 *   decrypt: Function
 * }}
 */
export function useFHE() {
  const bridge = useBridgeContext();

  const [state, setState] = useState(
    /** @type {{ loading: boolean, data: any, error: any }} */ ({
      loading: false,
      data: null,
      error: null,
    }),
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** @type {(plaintext: string | bigint, tokenAddress?: string) => Promise<any>} */
  const encrypt = useCallback(
    async (plaintext, tokenAddress) => {
      setState({ loading: true, data: null, error: null });
      try {
        const result = await bridge.fhe.encrypt(plaintext, tokenAddress);
        if (mountedRef.current) {
          setState({ loading: false, data: result, error: null });
        }
        return result;
      } catch (err) {
        if (mountedRef.current) {
          setState({ loading: false, data: null, error: err });
        }
        throw err;
      }
    },
    [bridge],
  );

  /** @type {(handle: any) => Promise<any>} */
  const decrypt = useCallback(
    async (handle) => {
      setState({ loading: true, data: null, error: null });
      try {
        const result = await bridge.fhe.decrypt(handle);
        if (mountedRef.current) {
          setState({ loading: false, data: result, error: null });
        }
        return result;
      } catch (err) {
        if (mountedRef.current) {
          setState({ loading: false, data: null, error: err });
        }
        throw err;
      }
    },
    [bridge],
  );

  return {
    loading: state.loading,
    data: state.data,
    error: state.error,
    encrypt,
    decrypt,
  };
}

// ---------------------------------------------------------------------------
// useLtvGauge
// ---------------------------------------------------------------------------

/**
 * Fetches LTV (Loan-to-Value) gauge data for a given token.
 *
 * @param {string} token - Token address
 * @returns {{ loading: boolean, data: any, error: any, refresh: Function }}
 */
export function useLtvGauge(token) {
  const bridge = useBridgeContext();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  return useAutoFetch(async () => {
    const t = tokenRef.current;
    if (!t) return null;

    try {
      const [supplyBalance, borrowBalance] = await Promise.all([
        bridge.contract.lendingPool.getSupplyBalance(t).catch(() => '0'),
        bridge.contract.lendingPool.getBorrowBalance(t).catch(() => '0'),
      ]);

      const supply = BigInt(String(supplyBalance || '0'));
      const borrow = BigInt(String(borrowBalance || '0'));
      let ratio = 0;
      if (supply > 0n) {
        ratio = Number((borrow * 10000n) / supply) / 100;
      }

      return {
        token: t,
        supplyBalance: String(supplyBalance),
        borrowBalance: String(borrowBalance),
        ltvRatio: ratio,
        maxLtv: 75,
        health: ratio < 75 ? 'healthy' : ratio < 85 ? 'warning' : 'danger',
      };
    } catch {
      return null;
    }
  }, 30000);
}
