/**
 * @file API adapter — axios NestJS HTTP client with JWT lifecycle and LRU cache.
 *
 * @typedef {import('./config.js').BridgeConfig} BridgeConfig
 * @typedef {import('./types.js').ApiError} _ApiErrorForJSDoc
 * @typedef {{ status: string; data: any; error: ApiError | null }} ApiResult
 */

import axios from 'axios';
import { ApiError } from './types.js';

/**
 * A minimal wallet-adapter interface consumed by the API adapter for JWT lifecycle.
 * @typedef {Object} WalletAdapterLike
 * @property {() => (string | null)} getJwt - Returns the current JWT or null
 * @property {() => Promise<{ accessToken: string }>} refreshJwt - Silently refresh the JWT
 */

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

/**
 * LRU get — returns { hit, value?, expired? }.
 * Moves accessed key to end for LRU ordering.
 * @param {Map<string, {value: any, expiry: number}>} cache
 * @param {string} key
 */
function lruGet(cache, key) {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  cache.delete(key);
  cache.set(key, entry);
  return { hit: true, value: entry.value, expired: Date.now() >= entry.expiry };
}

/**
 * LRU set — evicts oldest entry when full.
 * @param {Map<string, {value: any, expiry: number}>} cache
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs
 * @param {number} max
 */
function lruSet(cache, key, value, ttlMs, max = 200) {
  if (cache.size >= max && !cache.has(key)) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiry: Date.now() + ttlMs });
}

/**
 * Thin LRU cache class — delegates to module-level helpers.
 * Exported for test compatibility; adapter internals use lruGet/lruSet directly.
 */
export class LRUCache {
  /** @type {Map<string, {value: any, expiry: number}>} */
  #cache;
  /** @type {number} */
  #max;

  constructor(maxSize = 200) {
    this.#cache = new Map();
    this.#max = maxSize;
  }

  get(key) { return lruGet(this.#cache, key); }
  set(key, value, ttlMs) { lruSet(this.#cache, key, value, ttlMs, this.#max); }
  has(key) { return this.#cache.has(key); }
  delete(key) { this.#cache.delete(key); }
  clear() { this.#cache.clear(); }
}

// ---------------------------------------------------------------------------
// TTL configuration
// ---------------------------------------------------------------------------

/**
 * Per-endpoint TTL in seconds.
 * Endpoints not listed here default to 60s.
 * @type {Record<string, number>}
 */
const ENDPOINT_TTL = {
  markets: 30,
  'markets/prices': 30,
  stats: 30,
  activities: 15,
};

/** Default TTL for endpoints without a specific TTL override (in seconds). */
const DEFAULT_TTL_SECONDS = 60;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an API adapter with full JWT lifecycle and LRU caching.
 *
 * @param {BridgeConfig} config - Bridge configuration
 * @param {WalletAdapterLike} [walletAdapter] - Wallet adapter providing `getJwt()` and `refreshJwt()`
 * @returns {ApiAdapter} API adapter with all domain methods
 */
export function createApiAdapter(config, walletAdapter) {
  const baseURL = config.apiBaseUrl;
  /** @type {Map<string, {value: any, expiry: number}>} */
  const cache = new Map();
  // -----------------------------------------------------------------------
  // Axios client
  // -----------------------------------------------------------------------
  const client = axios.create({
    baseURL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
    withCredentials: true,
  });

  // -----------------------------------------------------------------------
  // Response interceptor — 401 refresh flow
  // -----------------------------------------------------------------------
  /** @type {boolean} */
  let isRefreshing = false;

  /** @type {Array<{ resolve: (token: string) => void; reject: (err: Error) => void }>} */
  let failedQueue = [];

  /**
   * Drain the queue of pending requests after a token refresh.
   * @param {Error | null} error
   * @param {string} [token]
   */
  function processQueue(error, token) {
    for (const { resolve, reject } of failedQueue) {
      if (error) {
        reject(error);
      } else {
        resolve(/** @type {string} */ (token));
      }
    }
    failedQueue = [];
  }

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;

      // Only attempt refresh on 401, when a wallet adapter with refreshJwt is available,
      // and this request hasn't already been retried.
      if (
        error.response?.status === 401 &&
        !originalRequest._retry &&
        walletAdapter &&
        typeof walletAdapter.refreshJwt === 'function'
      ) {
        if (isRefreshing) {
          // Queue while refresh is in progress
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then((_token) => {
            return client(originalRequest);
          });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const _result = await walletAdapter.refreshJwt();
          processQueue(null, null);
          return client(originalRequest);
        } catch (refreshError) {
          processQueue(/** @type {Error} */ (refreshError));
          try {
            const g = typeof window !== 'undefined' ? window : globalThis;
            if (g.__bridgeBus) {
              g.__bridgeBus.set('error:auth', {
                message: 'JWT refresh failed — session expired',
                timestamp: new Date().toISOString(),
              });
            }
          } catch (_) {
            /* non-critical */
          }
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      return Promise.reject(error);
    },
  );

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve the TTL (in ms) for a URL path.
   * @param {string} urlPath
   * @returns {number}
   */
  function resolveTtl(urlPath) {
    const cleanPath = urlPath.replace(/^\//, '');
    for (const [prefix, ttl] of Object.entries(ENDPOINT_TTL)) {
      if (
        cleanPath === prefix ||
        cleanPath.startsWith(`${prefix}/`) ||
        cleanPath.startsWith(`${prefix}?`)
      ) {
        return ttl * 1000;
      }
    }
    return DEFAULT_TTL_SECONDS * 1000;
  }

  /**
   * Normalize an Axios error into a stable { status, data, error } shape.
   * @param {unknown} error
   * @returns {{ status: string; data: null; error: ApiError }}
   */
  function normalizeError(error) {
    if (error instanceof ApiError) {
      return { status: 'error', data: null, error };
    }

    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status;
      const serverMessage = error.response?.data?.message || error.response?.data?.error || '';
      const message = serverMessage || error.message || 'Unknown API error';
      // 5xx → not recoverable; 4xx other than 401 (handled by interceptor) → recoverable
      const recoverable = statusCode ? statusCode < 500 : false;
      const apiError = new ApiError(
        `HTTP_${statusCode || 'ERROR'}`,
        message,
        statusCode,
        recoverable,
      );
      return { status: 'error', data: null, error: apiError };
    }

    const err = /** @type {Error} */ (error);
    const apiError = new ApiError(
      'UNKNOWN_ERROR',
      err.message || 'An unknown error occurred',
      undefined,
      false,
    );
    return { status: 'error', data: null, error: apiError };
  }

  /**
   * Cached GET — returns fresh or stale-while-revalidate data.
   * @param {string} cacheKey
   * @param {string} url
   * @param {Record<string, unknown>} [params]
   */
  async function cachedGet(cacheKey, url, params = {}) {
    const cached = lruGet(cache, cacheKey);

    // Fresh cache hit
    if (cached.hit && !cached.expired) {
      return { status: 'success', data: cached.value, error: null };
    }

    // Stale data — serve it and refresh in background
    if (cached.hit && cached.expired) {
      fetchAndCache(cacheKey, url, params).catch(() => {});
      return { status: 'success', data: cached.value, error: null };
    }

    // Cache miss
    return fetchAndCache(cacheKey, url, params);
  }

  /**
   * Fetch, cache, and return.
   * @param {string} cacheKey
   * @param {string} url
   * @param {Record<string, unknown>} [params]
   */
  async function fetchAndCache(cacheKey, url, params = {}) {
    try {
      const response = await client.get(url, { params });
      lruSet(cache, cacheKey, response.data, resolveTtl(url));
      return { status: 'success', data: response.data, error: null };
    } catch (error) {
      return normalizeError(error);
    }
  }

  /**
   * Unified HTTP request helper.
   * @param {'get'|'post'} method
   * @param {string} url
   * @param {Record<string, unknown> | unknown} [bodyOrParams]
   */
  async function request(method, url, bodyOrParams) {
    try {
      const response =
        method === 'get'
          ? await client.get(url, { params: bodyOrParams })
          : await client.post(url, bodyOrParams);
      return { status: 'success', data: response.data, error: null };
    } catch (error) {
      return normalizeError(error);
    }
  }

  // -----------------------------------------------------------------------
  // Domain methods
  // -----------------------------------------------------------------------

  return {
    /** System — public backend readiness probes */
    system: {
      /** GET /ready */
      getReady: () => request('get', '/ready'),
    },

    /** Markets — public lending market data */
    markets: {
      /** GET /markets (cached 30s) */
      getMarkets: (params) => cachedGet('markets', '/markets', params),
      /** GET /markets/prices (cached 30s) */
      getPrices: () => cachedGet('markets-prices', '/markets/prices'),
      /** GET /markets/status */
      getStatus: () => request('get', '/markets/status'),
    },

    /** Stats — protocol-wide statistics */
    stats: {
      /** GET /stats (cached 30s) */
      getStats: () => cachedGet('stats', '/stats'),
    },

    /** Strategies — marketplace strategy listings */
    strategies: {
      /** GET /strategies (cached 60s) */
      listStrategies: (params) => cachedGet('strategies-list', '/strategies', params),
    },

    /** Governance — proposals and voting */
    governance: {
      /** GET /governance/proposals (cached 60s) */
      listProposals: (params) => cachedGet('governance-proposals', '/governance/proposals', params),
      /** POST /governance/vote */
      castVote: (data) => request('post', '/governance/vote', data),
    },

    /** Activities — on-chain transaction history */
    activities: {
      /** GET /activities (cached 15s) */
      getActivities: (params) => cachedGet('activities', '/activities', params),
    },

    /** DeFi Modules — available protocol modules */
    defiModules: {
      /** GET /defi-modules (cached 60s) */
      getDefiModules: () => cachedGet('defi-modules', '/defi-modules'),
    },

    /** DeFi Strategies — on-chain deployment strategies */
    defiStrategies: {
      /** GET /defi-strategies (cached 60s) */
      getDefiStrategies: (params) => cachedGet('defi-strategies', '/defi-strategies', params),
      /** POST /defi-strategies */
      createDefiStrategy: (data) => request('post', '/defi-strategies', data),
      /** POST /defi-strategies/simulate */
      simulateDefiStrategy: (data) => request('post', '/defi-strategies/simulate', data),
    },

    /** AI Builder — AI-powered strategy building */
    aiBuilder: {
      /** POST /ai-strategy-builder/build */
      buildStrategy: (data) => request('post', '/ai-strategy-builder/build', data),
    },
  };
}


