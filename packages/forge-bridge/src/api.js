/**
 * @file API adapter — axios NestJS HTTP client with JWT lifecycle, in-memory LRU cache,
 * and all endpoint methods organized by domain.
 *
 * @typedef {import('./config.js').BridgeConfig} BridgeConfig
 * @typedef {import('./types.js').ApiError} _ApiErrorForJSDoc
 */

import axios from "axios";
import { ApiError } from "./types.js";

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
 * Simple in-memory LRU cache with TTL support.
 * Evicts least-recently-used entries when max size is exceeded.
 *
 * @template T
 */
export class LRUCache {
	/** @type {number} */
	maxSize;

	/** @type {Map<string, { value: T, expiry: number }>} */
	#cache;

	/**
	 * @param {number} maxSize - Maximum cache entries (default 200)
	 */
	constructor(maxSize = 200) {
		this.maxSize = maxSize;
		this.#cache = new Map();
	}

	/**
	 * Retrieve a cached value.
	 * Returns `{ hit: false }` if the key is absent.
	 * Returns `{ hit: true, value, expired: boolean }` if the key exists.
	 *
	 * @param {string} key - Cache key
	 * @returns {{ hit: boolean; value?: T; expired?: boolean }}
	 */
	get(key) {
		const entry = this.#cache.get(key);
		if (!entry) return { hit: false };

		// Move to end (most recently used)
		this.#cache.delete(key);
		this.#cache.set(key, entry);

		if (Date.now() < entry.expiry) {
			return { hit: true, value: entry.value, expired: false };
		}
		return { hit: true, value: entry.value, expired: true };
	}

	/**
	 * Store a value with a TTL.
	 *
	 * @param {string} key - Cache key
	 * @param {T} value - Value to cache
	 * @param {number} ttlMs - Time-to-live in milliseconds
	 */
	set(key, value, ttlMs) {
		if (this.#cache.has(key)) {
			this.#cache.delete(key);
		} else if (this.#cache.size >= this.maxSize) {
			// Evict least recently used (first entry)
			const firstKey = this.#cache.keys().next().value;
			if (firstKey !== undefined) this.#cache.delete(firstKey);
		}

		this.#cache.set(key, {
			value,
			expiry: Date.now() + ttlMs,
		});
	}

	/**
	 * Check if a key exists (regardless of expiry).
	 * @param {string} key
	 * @returns {boolean}
	 */
	has(key) {
		return this.#cache.has(key);
	}

	/**
	 * Delete a specific key.
	 * @param {string} key
	 */
	delete(key) {
		this.#cache.delete(key);
	}

	/**
	 * Clear all cached entries.
	 */
	clear() {
		this.#cache.clear();
	}
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
	"markets/prices": 30,
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
	const cache = new LRUCache(200);

	// -----------------------------------------------------------------------
	// Axios client
	// -----------------------------------------------------------------------
	const client = axios.create({
		baseURL,
		timeout: 15000,
		headers: { "Content-Type": "application/json" },
	});

	// -----------------------------------------------------------------------
	// Request interceptor — attach JWT Bearer token
	// -----------------------------------------------------------------------
	client.interceptors.request.use(
		(requestConfig) => {
			if (walletAdapter && typeof walletAdapter.getJwt === "function") {
				const token = walletAdapter.getJwt();
				if (token) {
					requestConfig.headers.Authorization = `Bearer ${token}`;
				}
			}
			return requestConfig;
		},
		(error) => Promise.reject(error),
	);

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
				typeof walletAdapter.refreshJwt === "function"
			) {
				if (isRefreshing) {
					// Queue while refresh is in progress
					return new Promise((resolve, reject) => {
						failedQueue.push({ resolve, reject });
					}).then((token) => {
						originalRequest.headers.Authorization = `Bearer ${token}`;
						return client(originalRequest);
					});
				}

				originalRequest._retry = true;
				isRefreshing = true;

				try {
					const result = await walletAdapter.refreshJwt();
					const newToken = result.accessToken;
					processQueue(null, newToken);
					originalRequest.headers.Authorization = `Bearer ${newToken}`;
					return client(originalRequest);
				} catch (refreshError) {
					processQueue(/** @type {Error} */ (refreshError));
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
		const cleanPath = urlPath.replace(/^\//, "");
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
			return { status: "error", data: null, error };
		}

		if (axios.isAxiosError(error)) {
			const statusCode = error.response?.status;
			const serverMessage = error.response?.data?.message || error.response?.data?.error || "";
			const message = serverMessage || error.message || "Unknown API error";
			// 5xx → not recoverable; 4xx other than 401 (handled by interceptor) → recoverable
			const recoverable = statusCode ? statusCode < 500 : false;
			const apiError = new ApiError(
				`HTTP_${statusCode || "ERROR"}`,
				message,
				statusCode,
				recoverable,
			);
			return { status: "error", data: null, error: apiError };
		}

		const err = /** @type {Error} */ (error);
		const apiError = new ApiError(
			"UNKNOWN_ERROR",
			err.message || "An unknown error occurred",
			undefined,
			false,
		);
		return { status: "error", data: null, error: apiError };
	}

	/**
	 * Execute a cached GET request.
	 *
	 * - Within TTL: returns cached data (no HTTP call).
	 * - After TTL, before refresh: serves stale data and triggers background refresh.
	 * - Cache miss: fetches fresh, caches, returns.
	 *
	 * @param {string} cacheKey
	 * @param {string} url
	 * @param {Record<string, unknown>} [params]
	 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
	 */
	async function cachedGet(cacheKey, url, params = {}) {
		const cached = cache.get(cacheKey);

		// Fresh cache hit
		if (cached.hit && !cached.expired) {
			return { status: "success", data: cached.value, error: null };
		}

		// Stale data — serve it and refresh in background
		if (cached.hit && cached.expired) {
			// Fire-and-forget refresh
			fetchAndCache(cacheKey, url, params).catch(() => {});
			return { status: "success", data: cached.value, error: null };
		}

		// Cache miss
		return fetchAndCache(cacheKey, url, params);
	}

	/**
	 * Fetch data from the API, cache it, and return.
	 * @param {string} cacheKey
	 * @param {string} url
	 * @param {Record<string, unknown>} [params]
	 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
	 */
	async function fetchAndCache(cacheKey, url, params = {}) {
		try {
			const response = await client.get(url, { params });
			const data = response.data;
			const ttl = resolveTtl(url);
			cache.set(cacheKey, data, ttl);
			return { status: "success", data, error: null };
		} catch (error) {
			return normalizeError(error);
		}
	}

	/**
	 * Perform a non-cached GET request.
	 * @param {string} url
	 * @param {Record<string, unknown>} [params]
	 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
	 */
	async function get(url, params = {}) {
		try {
			const response = await client.get(url, { params });
			return { status: "success", data: response.data, error: null };
		} catch (error) {
			return normalizeError(error);
		}
	}

	/**
	 * Perform a POST request.
	 * @param {string} url
	 * @param {unknown} [body]
	 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
	 */
	async function post(url, body) {
		try {
			const response = await client.post(url, body);
			return { status: "success", data: response.data, error: null };
		} catch (error) {
			return normalizeError(error);
		}
	}

	/**
	 * Perform a PUT request.
	 * @param {string} url
	 * @param {unknown} [body]
	 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
	 */
	async function put(url, body) {
		try {
			const response = await client.put(url, body);
			return { status: "success", data: response.data, error: null };
		} catch (error) {
			return normalizeError(error);
		}
	}

	// -----------------------------------------------------------------------
	// Domain methods
	// -----------------------------------------------------------------------

	return {
		/** Markets — public lending market data */
		markets: {
			/**
			 * Get all lending markets with APY, TVL, utilization.
			 * GET /markets  (cached, TTL 30s)
			 * @param {Record<string, unknown>} [params]
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getMarkets: (params) => cachedGet("markets", "/markets", params),

			/**
			 * Get oracle prices for all assets.
			 * GET /markets/prices  (cached, TTL 30s)
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getPrices: () => cachedGet("markets-prices", "/markets/prices"),
		},

		/** Stats — protocol-wide statistics */
		stats: {
			/**
			 * Get overall protocol statistics.
			 * GET /stats  (cached, TTL 30s)
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getStats: () => cachedGet("stats", "/stats"),
		},

		/** Strategies — marketplace strategy listings */
		strategies: {
			/**
			 * List strategies with optional filters.
			 * GET /strategies  (cached, TTL 60s)
			 * @param {Record<string, unknown>} [params] - Filter params (keyword, tags, sortBy, order, limit)
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			listStrategies: (params) => cachedGet("strategies-list", "/strategies", params),

			/**
			 * Get a strategy by its ID.
			 * GET /strategies/:id  (uncached)
			 * @param {string} id
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getStrategy: (id) => get(`/strategies/${id}`),
		},

		/** Governance — proposals and voting */
		governance: {
			/**
			 * List governance proposals.
			 * GET /governance/proposals  (cached, TTL 60s)
			 * @param {Record<string, unknown>} [params] - Optional status filter
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			listProposals: (params) => cachedGet("governance-proposals", "/governance/proposals", params),

			/**
			 * Get a single governance proposal.
			 * GET /governance/proposals/:id  (uncached)
			 * @param {string} id
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getProposal: (id) => get(`/governance/proposals/${id}`),

			/**
			 * Cast a vote on an active proposal.
			 * POST /governance/vote  (uncached, requires JWT)
			 * @param {{ proposalId: string; support: boolean; votes?: number }} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			castVote: (data) => post("/governance/vote", data),
		},

		/** Activities — on-chain transaction history */
		activities: {
			/**
			 * Get paginated on-chain activities.
			 * GET /activities  (cached, TTL 15s)
			 * @param {Record<string, unknown>} [params] - Filter params (strategyId, userAddress, page, limit)
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getActivities: (params) => cachedGet("activities", "/activities", params),
		},

		/** DeFi Modules — available protocol modules */
		defiModules: {
			/**
			 * Get all available DeFi protocol modules.
			 * GET /defi-modules  (cached, TTL 60s)
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getDefiModules: () => cachedGet("defi-modules", "/defi-modules"),
		},

		/** DeFi Strategies — on-chain deployment strategies */
		defiStrategies: {
			/**
			 * Get all DeFi strategies, optionally filtered by owner.
			 * GET /defi-strategies  (cached, TTL 60s)
			 * @param {Record<string, unknown>} [params] - Optional owner filter
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getDefiStrategies: (params) => cachedGet("defi-strategies", "/defi-strategies", params),

			/**
			 * Get a single DeFi strategy by ID.
			 * GET /defi-strategies/:id  (uncached)
			 * @param {string} id
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getDefiStrategy: (id) => get(`/defi-strategies/${id}`),

			/**
			 * Create a new DeFi strategy.
			 * POST /defi-strategies  (uncached, requires JWT)
			 * @param {unknown} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			createDefiStrategy: (data) => post("/defi-strategies", data),

			/**
			 * Update an existing DeFi strategy.
			 * PUT /defi-strategies/:id  (uncached, requires JWT)
			 * @param {string} id
			 * @param {unknown} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			updateDefiStrategy: (id, data) => put(`/defi-strategies/${id}`, data),

			/**
			 * Simulate a DeFi strategy.
			 * POST /defi-strategies/simulate  (uncached, requires JWT)
			 * @param {unknown} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			simulateDefiStrategy: (data) => post("/defi-strategies/simulate", data),
		},

		/** AI Builder — AI-powered strategy building, risk analysis, optimization */
		aiBuilder: {
			/**
			 * Build a DeFi strategy from natural language.
			 * POST /ai-strategy-builder/build  (uncached, requires JWT)
			 * @param {unknown} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			buildStrategy: (data) => post("/ai-strategy-builder/build", data),

			/**
			 * Analyze strategy risk using Gemini AI.
			 * POST /ai-strategy-builder/advanced/analyze-risk  (uncached, requires JWT)
			 * @param {unknown} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			analyzeRisk: (data) => post("/ai-strategy-builder/advanced/analyze-risk", data),

			/**
			 * Optimize a strategy using Gemini AI.
			 * POST /ai-strategy-builder/advanced/optimize  (uncached, requires JWT)
			 * @param {unknown} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			optimize: (data) => post("/ai-strategy-builder/advanced/optimize", data),
		},

		/** Users — user profiles */
		users: {
			/**
			 * Get current user by wallet address.
			 * GET /users/me  (uncached)
			 * @param {Record<string, unknown>} [params] - Optional query params (address)
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getMe: (params) => get("/users/me", params),

			/**
			 * Create a new user.
			 * POST /users  (uncached)
			 * @param {unknown} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			createUser: (data) => post("/users", data),
		},

		/** Auth — wallet-based JWT authentication */
		auth: {
			/**
			 * Get a nonce for wallet authentication.
			 * GET /auth/nonce/:walletAddress  (uncached)
			 * @param {string} walletAddress
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			getNonce: (walletAddress) => get(`/auth/nonce/${walletAddress}`),

			/**
			 * Authenticate with wallet signature.
			 * POST /auth/wallet-login  (uncached)
			 * @param {unknown} data
			 * @returns {Promise<{ status: string; data: any; error: ApiError | null }>}
			 */
			walletLogin: (data) => post("/auth/wallet-login", data),
		},
	};
}

/**
 * @typedef {Object} ApiAdapter
 * @property {object} markets
 * @property {(params?: Record<string, unknown>) => Promise<ApiResult>} markets.getMarkets
 * @property {() => Promise<ApiResult>} markets.getPrices
 * @property {object} stats
 * @property {() => Promise<ApiResult>} stats.getStats
 * @property {object} strategies
 * @property {(params?: Record<string, unknown>) => Promise<ApiResult>} strategies.listStrategies
 * @property {(id: string) => Promise<ApiResult>} strategies.getStrategy
 * @property {object} governance
 * @property {(params?: Record<string, unknown>) => Promise<ApiResult>} governance.listProposals
 * @property {(id: string) => Promise<ApiResult>} governance.getProposal
 * @property {(data: { proposalId: string; support: boolean; votes?: number }) => Promise<ApiResult>} governance.castVote
 * @property {object} activities
 * @property {(params?: Record<string, unknown>) => Promise<ApiResult>} activities.getActivities
 * @property {object} defiModules
 * @property {() => Promise<ApiResult>} defiModules.getDefiModules
 * @property {object} defiStrategies
 * @property {(params?: Record<string, unknown>) => Promise<ApiResult>} defiStrategies.getDefiStrategies
 * @property {(id: string) => Promise<ApiResult>} defiStrategies.getDefiStrategy
 * @property {(data: unknown) => Promise<ApiResult>} defiStrategies.createDefiStrategy
 * @property {(id: string, data: unknown) => Promise<ApiResult>} defiStrategies.updateDefiStrategy
 * @property {(data: unknown) => Promise<ApiResult>} defiStrategies.simulateDefiStrategy
 * @property {object} aiBuilder
 * @property {(data: unknown) => Promise<ApiResult>} aiBuilder.buildStrategy
 * @property {(data: unknown) => Promise<ApiResult>} aiBuilder.analyzeRisk
 * @property {(data: unknown) => Promise<ApiResult>} aiBuilder.optimize
 * @property {object} users
 * @property {(params?: Record<string, unknown>) => Promise<ApiResult>} users.getMe
 * @property {(data: unknown) => Promise<ApiResult>} users.createUser
 * @property {object} auth
 * @property {(walletAddress: string) => Promise<ApiResult>} auth.getNonce
 * @property {(data: unknown) => Promise<ApiResult>} auth.walletLogin
 */

/**
 * @typedef {{ status: string; data: any; error: ApiError | null }} ApiResult
 */
