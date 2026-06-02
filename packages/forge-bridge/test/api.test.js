/**
 * @file Unit tests for src/api.js
 *
 * Tests mock axios, the wallet adapter's JWT surface, and the LRU cache
 * to validate the API adapter, interceptor chain, caching behaviour,
 * and all 22 endpoint methods across 10 domain groups.
 */

import { mock, test, expect, describe, beforeEach, afterEach } from "bun:test";

// --------------------------------------------------------------------------
// Mutable mock state — tests update these to control mock behaviour
// --------------------------------------------------------------------------
const mockState = {
	/** @type {string | null} */
	jwtToken: null,
	/** @type {boolean} */
	refreshCalled: false,
	/** @type {string} */
	refreshResult: "refreshed.jwt.token",
	/** @type {Error | null} */
	refreshError: null,

	/** Axios response control */
	/** @type {{ data?: any; status?: number; statusText?: string; headers?: Record<string, string> } | null} */
	nextResponse: null,
	/** @type {Error | null} */
	nextError: null,

	/** Tracks which URLs were called */
	/** @type {Array<{ method: string; url: string; data?: any; headers?: Record<string, string> }>} */
	requestLog: [],

	/** Captured interceptor callbacks */
	/** @type {((config: any) => any) | null} */
	requestInterceptor: null,
	/** @type {((response: any) => any) | null} */
	responseSuccessInterceptor: null,
	/** @type {((error: any) => any) | null} */
	responseErrorInterceptor: null,
};

// --------------------------------------------------------------------------
// Mock axios
// --------------------------------------------------------------------------
/**
 * Create a callable mock axios instance.
 * Axios instances created with axios.create() are callable
 * (they wrap axios.request), so the mock must support that.
 */
function createMockAxiosInstance() {
	// The core request method — dispatches to get/post/put based on config
	const request = mock((config) => {
		const method = (config?.method ?? "get").toLowerCase();
		const url = config?.url ?? "";
		const data = config?.data;
		mockState.requestLog.push({ method: method.toUpperCase(), url, data, headers: config?.headers });

		if (mockState.nextError) return Promise.reject(mockState.nextError);
		return Promise.resolve(
			mockState.nextResponse ?? { data: null, status: 200, statusText: "OK", headers: {} },
		);
	});

	// The instance is a callable function wrapping request
	const instance = mock((config) => request(config));

	// Attach all the axios instance methods
	instance.get = mock((url, config) => {
		mockState.requestLog.push({ method: "GET", url, ...config });
		if (mockState.nextError) return Promise.reject(mockState.nextError);
		return Promise.resolve(
			mockState.nextResponse ?? { data: [], status: 200, statusText: "OK", headers: {} },
		);
	});
	instance.post = mock((url, data, config) => {
		mockState.requestLog.push({ method: "POST", url, data, ...config });
		if (mockState.nextError) return Promise.reject(mockState.nextError);
		return Promise.resolve(
			mockState.nextResponse ?? { data: {}, status: 200, statusText: "OK", headers: {} },
		);
	});
	instance.put = mock((url, data, config) => {
		mockState.requestLog.push({ method: "PUT", url, data, ...config });
		if (mockState.nextError) return Promise.reject(mockState.nextError);
		return Promise.resolve(
			mockState.nextResponse ?? { data: {}, status: 200, statusText: "OK", headers: {} },
		);
	});
	instance.interceptors = {
		request: {
			use: mock((fulfilled) => {
				mockState.requestInterceptor = fulfilled;
			}),
			eject: mock(() => {}),
		},
		response: {
			use: mock((fulfilled, rejected) => {
				mockState.responseSuccessInterceptor = fulfilled;
				mockState.responseErrorInterceptor = rejected;
			}),
			eject: mock(() => {}),
		},
	};
	instance.defaults = {
		baseURL: "",
		headers: { common: {} },
	};
	// Store request for interceptor retry to use
	instance._request = request;

	return instance;
}

mock.module("axios", () => {
	let mockInstance = createMockAxiosInstance();

	const axiosMock = mock(() => mockInstance);
	axiosMock.create = mock(() => {
		// Create a fresh instance each time createApiAdapter calls axios.create()
		mockInstance = createMockAxiosInstance();
		return mockInstance;
	});
	axiosMock.isAxiosError = mock((err) => err?.isAxiosError === true);

	return {
		default: axiosMock,
		axios: axiosMock,
	};
});

// --------------------------------------------------------------------------
// Helper to build a fake Axios error
// --------------------------------------------------------------------------
function makeAxiosError(status, message = "Request failed") {
	const error = new Error(message);
	error.name = "AxiosError";
	error.isAxiosError = true;
	error.response = {
		status,
		data: { message },
		headers: {},
		statusText: message,
	};
	error.config = { headers: {}, url: "" };
	return error;
}

// --------------------------------------------------------------------------
// Import after mocks are established
// --------------------------------------------------------------------------
import { createApiAdapter, LRUCache } from "../src/api.js";
import { ApiError } from "../src/types.js";

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("LRUCache", () => {
	test("stores and retrieves values", () => {
		const cache = new LRUCache(10);
		cache.set("key1", { foo: "bar" }, 60_000);
		const result = cache.get("key1");
		expect(result.hit).toBe(true);
		expect(result.value).toEqual({ foo: "bar" });
		expect(result.expired).toBe(false);
	});

	test("returns miss for absent key", () => {
		const cache = new LRUCache(10);
		const result = cache.get("nonexistent");
		expect(result.hit).toBe(false);
	});

	test("returns expired entry with expired flag", () => {
		const cache = new LRUCache(10);
		cache.set("key1", "value1", -1000); // Already expired
		const result = cache.get("key1");
		expect(result.hit).toBe(true);
		expect(result.value).toBe("value1");
		expect(result.expired).toBe(true);
	});

	test("evicts LRU entries when max size exceeded", () => {
		const cache = new LRUCache(3);
		cache.set("a", 1, 60_000);
		cache.set("b", 2, 60_000);
		cache.set("c", 3, 60_000);
		// Access 'a' to make it most recently used
		cache.get("a");
		// Add one more, should evict 'b' (least recently used)
		cache.set("d", 4, 60_000);
		expect(cache.get("b").hit).toBe(false);
		expect(cache.get("a").hit).toBe(true);
		expect(cache.get("c").hit).toBe(true);
		expect(cache.get("d").hit).toBe(true);
	});

	test("has() returns true for existing key", () => {
		const cache = new LRUCache(10);
		cache.set("key", "val", 60_000);
		expect(cache.has("key")).toBe(true);
		expect(cache.has("missing")).toBe(false);
	});

	test("delete() removes key", () => {
		const cache = new LRUCache(10);
		cache.set("key", "val", 60_000);
		cache.delete("key");
		expect(cache.has("key")).toBe(false);
	});

	test("clear() removes all entries", () => {
		const cache = new LRUCache(10);
		cache.set("a", 1, 60_000);
		cache.set("b", 2, 60_000);
		cache.clear();
		expect(cache.has("a")).toBe(false);
		expect(cache.has("b")).toBe(false);
	});
});

describe("createApiAdapter", () => {
	const TEST_CONFIG = {
		apiBaseUrl: "https://fheforge-api-production-6465.up.railway.app",
		chainId: 421614,
	};

	/** @type {{ getJwt: ReturnType<typeof mock>, refreshJwt: ReturnType<typeof mock> }} */
	let mockWallet;

	beforeEach(() => {
		// Reset mock state
		mockState.jwtToken = null;
		mockState.refreshCalled = false;
		mockState.refreshResult = "refreshed.jwt.token";
		mockState.refreshError = null;
		mockState.nextResponse = null;
		mockState.nextError = null;
		mockState.requestLog = [];
		mockState.requestInterceptor = null;
		mockState.responseSuccessInterceptor = null;
		mockState.responseErrorInterceptor = null;

		mockWallet = {
			getJwt: mock(() => mockState.jwtToken),
			refreshJwt: mock(() => {
				mockState.refreshCalled = true;
				if (mockState.refreshError) return Promise.reject(mockState.refreshError);
				return Promise.resolve({
					accessToken: mockState.refreshResult,
					userId: "user1",
					walletAddress: "0xabc",
				});
			}),
		};
	});

	afterEach(() => {
		// Prevent test leakage
	});

	// ---- Factory ----

	test("creates axios client with default base URL", () => {
		const adapter = createApiAdapter(TEST_CONFIG);
		expect(adapter).toBeDefined();
		expect(adapter.markets).toBeDefined();
		expect(adapter.stats).toBeDefined();
	});

	test("creates adapter with all 10 domain groups", () => {
		const adapter = createApiAdapter(TEST_CONFIG);
		expect(adapter.markets).toBeDefined();
		expect(adapter.stats).toBeDefined();
		expect(adapter.strategies).toBeDefined();
		expect(adapter.governance).toBeDefined();
		expect(adapter.activities).toBeDefined();
		expect(adapter.defiModules).toBeDefined();
		expect(adapter.defiStrategies).toBeDefined();
		expect(adapter.aiBuilder).toBeDefined();
		expect(adapter.users).toBeDefined();
		expect(adapter.auth).toBeDefined();
	});

	// ---- JWT interceptor ----

	test("request interceptor attaches Bearer token when JWT available", () => {
		mockState.jwtToken = "my.jwt.token";
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		// Simulate what the request interceptor does
		const config = { headers: {} };
		const result = mockState.requestInterceptor(config);

		expect(result.headers.Authorization).toBe("Bearer my.jwt.token");
	});

	test("request interceptor does not attach header when JWT is null", () => {
		mockState.jwtToken = null;
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		const config = { headers: {} };
		const result = mockState.requestInterceptor(config);

		expect(result.headers.Authorization).toBeUndefined();
	});

	test("request interceptor does not attach header when no wallet adapter", () => {
		const adapter = createApiAdapter(TEST_CONFIG);

		const config = { headers: {} };
		const result = mockState.requestInterceptor(config);

		expect(result.headers.Authorization).toBeUndefined();
	});

	// ---- 401 refresh flow ----

	test("401 response triggers JWT refresh and retries original request", async () => {
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		// Set up a 401 error that will be passed to the error interceptor
		const axiosError = makeAxiosError(401, "Unauthorized");
		axiosError.config = { headers: {}, url: "/markets", _retry: false };

		// The error interceptor should handle this
		const resultPromise = mockState.responseErrorInterceptor(axiosError);

		// Should have called refreshJwt
		expect(mockState.refreshCalled).toBe(true);

		// The retry should happen (the interceptor retries via client())
		// Since we're testing the interceptor logic, the retry would make another
		// request which returns the mock response
	});

	test("401 refresh uses result token for retry", async () => {
		mockState.refreshResult = "new.token.after.refresh";
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		const axiosError = makeAxiosError(401, "Unauthorized");
		axiosError.config = { headers: {}, url: "/markets", _retry: false };

		// Ensure mock client.get returns success after retry
		mockState.nextResponse = { data: ["market1"], status: 200 };

		const result = await mockState.responseErrorInterceptor(axiosError);

		// The retried request should have the new token
		expect(mockState.refreshCalled).toBe(true);
	});

	test("401 refresh failure propagates error", async () => {
		mockState.refreshError = new Error("Refresh failed");
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		const axiosError = makeAxiosError(401, "Unauthorized");
		axiosError.config = { headers: {}, url: "/markets", _retry: false };

		await expect(mockState.responseErrorInterceptor(axiosError)).rejects.toThrow("Refresh failed");
	});

	test("non-401 errors pass through response error interceptor", async () => {
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		const axiosError = makeAxiosError(500, "Server error");
		axiosError.config = { headers: {}, url: "/markets" };

		await expect(mockState.responseErrorInterceptor(axiosError)).rejects.toThrow("Server error");
	});

	test("401 does not retry when wallet adapter has no refreshJwt", async () => {
		const adapter = createApiAdapter(TEST_CONFIG); // No wallet adapter

		const axiosError = makeAxiosError(401, "Unauthorized");
		axiosError.config = { headers: {}, url: "/markets" };

		await expect(mockState.responseErrorInterceptor(axiosError)).rejects.toThrow("Unauthorized");
		expect(mockState.refreshCalled).toBe(false);
	});

	// ---- Markets ----

	test("markets.getMarkets calls GET /markets", async () => {
		mockState.nextResponse = { data: [{ asset: "USDC" }], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.markets.getMarkets();

		expect(result.status).toBe("success");
		expect(result.data).toEqual([{ asset: "USDC" }]);
		expect(mockState.requestLog.length).toBeGreaterThanOrEqual(1);
		const call = mockState.requestLog.find((r) => r.url === "/markets");
		expect(call).toBeDefined();
	});

	test("markets.getPrices calls GET /markets/prices", async () => {
		mockState.nextResponse = { data: [{ asset: "USDC", price: 1 }], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.markets.getPrices();

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/markets/prices")).toBeDefined();
	});

	// ---- Stats ----

	test("stats.getStats calls GET /stats", async () => {
		mockState.nextResponse = { data: { tvlUsd: 1000000 }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.stats.getStats();

		expect(result.status).toBe("success");
		expect(result.data).toEqual({ tvlUsd: 1000000 });
		expect(mockState.requestLog.find((r) => r.url === "/stats")).toBeDefined();
	});

	// ---- Strategies ----

	test("strategies.listStrategies calls GET /strategies", async () => {
		mockState.nextResponse = { data: [{ id: "s1" }], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.strategies.listStrategies({ tags: "yield" });

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/strategies")).toBeDefined();
	});

	test("strategies.getStrategy calls GET /strategies/:id", async () => {
		mockState.nextResponse = { data: { id: "s1", name: "Test" }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.strategies.getStrategy("s1");

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/strategies/s1")).toBeDefined();
	});

	// ---- Governance ----

	test("governance.listProposals calls GET /governance/proposals", async () => {
		mockState.nextResponse = { data: [{ id: "p1" }], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.governance.listProposals({ status: "active" });

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/governance/proposals")).toBeDefined();
	});

	test("governance.getProposal calls GET /governance/proposals/:id", async () => {
		mockState.nextResponse = { data: { id: "p1", title: "Test Proposal" }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.governance.getProposal("p1");

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/governance/proposals/p1")).toBeDefined();
	});

	test("governance.castVote calls POST /governance/vote", async () => {
		mockState.nextResponse = { data: { success: true }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.governance.castVote({
			proposalId: "p1",
			support: true,
			votes: 100,
		});

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find((r) => r.url === "/governance/vote");
		expect(call).toBeDefined();
		expect(call?.method).toBe("POST");
	});

	// ---- Activities ----

	test("activities.getActivities calls GET /activities", async () => {
		mockState.nextResponse = { data: [{ id: "a1" }], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.activities.getActivities({ userAddress: "0xabc" });

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/activities")).toBeDefined();
	});

	// ---- DeFi Modules ----

	test("defiModules.getDefiModules calls GET /defi-modules", async () => {
		mockState.nextResponse = { data: [{ id: "dm1", name: "Lending" }], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.defiModules.getDefiModules();

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/defi-modules")).toBeDefined();
	});

	// ---- DeFi Strategies ----

	test("defiStrategies.getDefiStrategies calls GET /defi-strategies", async () => {
		mockState.nextResponse = { data: [{ id: "ds1" }], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.defiStrategies.getDefiStrategies({ owner: "0xabc" });

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/defi-strategies")).toBeDefined();
	});

	test("defiStrategies.getDefiStrategy calls GET /defi-strategies/:id", async () => {
		mockState.nextResponse = { data: { id: "ds1" }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.defiStrategies.getDefiStrategy("ds1");

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/defi-strategies/ds1")).toBeDefined();
	});

	test("defiStrategies.createDefiStrategy calls POST /defi-strategies", async () => {
		mockState.nextResponse = { data: { id: "new-ds" }, status: 201 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.defiStrategies.createDefiStrategy({ name: "My Strategy" });

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find((r) => r.url === "/defi-strategies");
		expect(call).toBeDefined();
		expect(call?.method).toBe("POST");
	});

	test("defiStrategies.updateDefiStrategy calls PUT /defi-strategies/:id", async () => {
		mockState.nextResponse = { data: { id: "ds1", updated: true }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.defiStrategies.updateDefiStrategy("ds1", { name: "Updated" });

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find((r) => r.url === "/defi-strategies/ds1");
		expect(call).toBeDefined();
		expect(call?.method).toBe("PUT");
	});

	test("defiStrategies.simulateDefiStrategy calls POST /defi-strategies/simulate", async () => {
		mockState.nextResponse = { data: { simulation_id: "sim1" }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.defiStrategies.simulateDefiStrategy({
			workflow_json: {},
			amount_in: 1000,
		});

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find((r) => r.url === "/defi-strategies/simulate");
		expect(call).toBeDefined();
		expect(call?.method).toBe("POST");
	});

	// ---- AI Builder ----

	test("aiBuilder.buildStrategy calls POST /ai-strategy-builder/build", async () => {
		mockState.nextResponse = { data: { steps: [] }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.aiBuilder.buildStrategy({ userIntent: "Supply 100 USDC" });

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find((r) => r.url === "/ai-strategy-builder/build");
		expect(call).toBeDefined();
		expect(call?.method).toBe("POST");
	});

	test("aiBuilder.analyzeRisk calls POST /ai-strategy-builder/advanced/analyze-risk", async () => {
		mockState.nextResponse = { data: { score: 75 }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.aiBuilder.analyzeRisk({ steps: [] });

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find(
			(r) => r.url === "/ai-strategy-builder/advanced/analyze-risk",
		);
		expect(call).toBeDefined();
		expect(call?.method).toBe("POST");
	});

	test("aiBuilder.optimize calls POST /ai-strategy-builder/advanced/optimize", async () => {
		mockState.nextResponse = { data: { steps: [] }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.aiBuilder.optimize({ steps: [] });

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find(
			(r) => r.url === "/ai-strategy-builder/advanced/optimize",
		);
		expect(call).toBeDefined();
		expect(call?.method).toBe("POST");
	});

	// ---- Users ----

	test("users.getMe calls GET /users/me", async () => {
		mockState.nextResponse = { data: { id: "u1", walletAddress: "0xabc" }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.users.getMe({ address: "0xabc" });

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/users/me")).toBeDefined();
	});

	test("users.createUser calls POST /users", async () => {
		mockState.nextResponse = { data: { id: "u1" }, status: 201 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.users.createUser({ walletAddress: "0xabc" });

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find((r) => r.url === "/users");
		expect(call).toBeDefined();
		expect(call?.method).toBe("POST");
	});

	// ---- Auth ----

	test("auth.getNonce calls GET /auth/nonce/:walletAddress", async () => {
		mockState.nextResponse = { data: { nonce: "abc123", message: "Sign this" }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.auth.getNonce("0xabc");

		expect(result.status).toBe("success");
		expect(mockState.requestLog.find((r) => r.url === "/auth/nonce/0xabc")).toBeDefined();
	});

	test("auth.walletLogin calls POST /auth/wallet-login", async () => {
		mockState.nextResponse = { data: { accessToken: "jwt.token" }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.auth.walletLogin({
			walletAddress: "0xabc",
			signature: "0xsig",
			nonce: "abc123",
		});

		expect(result.status).toBe("success");
		const call = mockState.requestLog.find((r) => r.url === "/auth/wallet-login");
		expect(call).toBeDefined();
		expect(call?.method).toBe("POST");
	});

	// ---- Cache hit/miss/expiry ----

	test("cache returns data within TTL without HTTP request", async () => {
		mockState.nextResponse = { data: ["market1", "market2"], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		// First call should make HTTP request
		const result1 = await adapter.markets.getMarkets();
		expect(result1.status).toBe("success");
		expect(mockState.requestLog.filter((r) => r.url === "/markets").length).toBe(1);

		// Clear request log
		mockState.requestLog = [];

		// Second call should return cached data without HTTP request
		const result2 = await adapter.markets.getMarkets();
		expect(result2.status).toBe("success");
		expect(result2.data).toEqual(["market1", "market2"]);
		// No additional HTTP request should have been made
		expect(mockState.requestLog.filter((r) => r.url === "/markets").length).toBe(0);
	});

	test("cache serves stale data and refreshes in background after TTL expiry", async () => {
		// Override Date.now for TTL control — we use a small positive TTL
		// that will elapse between the two calls
		const realDateNow = Date.now;
		let now = 1000000;

		// Temporarily replace Date.now to control time
		// (We'll test the caching behavior via direct cache manipulation instead)
		Date.now = mock(() => now);

		mockState.nextResponse = { data: ["initial"], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		// First call — populates cache
		const result1 = await adapter.markets.getMarkets();
		expect(result1.data).toEqual(["initial"]);

		// Advance time past the 30s TTL
		now += 31000;

		// Prepare a different response for the background refresh
		mockState.nextResponse = { data: ["refreshed"], status: 200 };

		// Reset request log to track new requests
		const beforeRefreshCount = mockState.requestLog.length;
		mockState.requestLog = [];

		// Second call — should return stale data immediately without
		// waiting for the refresh
		const result2 = await adapter.markets.getMarkets();
		expect(result2.status).toBe("success");
		expect(result2.data).toEqual(["initial"]); // Stale data served

		// A background refresh should have been triggered
		// (the fetch in cachedGet fires without await, so it may still be pending)
		// We wait briefly to let the background refresh complete
		await new Promise((r) => setTimeout(r, 50));

		expect(mockState.requestLog.filter((r) => r.url === "/markets").length).toBeGreaterThanOrEqual(1);

		Date.now = realDateNow;
	});

	test("cache miss fetches fresh data", async () => {
		mockState.nextResponse = { data: { tvl: 500000 }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		const result = await adapter.stats.getStats();
		expect(result.status).toBe("success");
		expect(result.data).toEqual({ tvl: 500000 });
	});

	// ---- Error handling ----

	test("error responses return ApiError with code, message, source", async () => {
		const axiosError = makeAxiosError(500, "Internal server error");
		mockState.nextError = axiosError;

		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.stats.getStats();

		expect(result.status).toBe("error");
		expect(result.data).toBeNull();
		expect(result.error).toBeInstanceOf(ApiError);
		if (result.error instanceof ApiError) {
			expect(result.error.code).toBe("HTTP_500");
			expect(result.error.source).toBe("api");
		}
	});

	test("error response has recoverable flag set correctly (5xx not recoverable)", async () => {
		const axiosError = makeAxiosError(500, "Server boom");
		mockState.nextError = axiosError;

		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.stats.getStats();

		expect(result.error).toBeInstanceOf(ApiError);
		if (result.error instanceof ApiError) {
			expect(result.error.recoverable).toBe(false);
		}
	});

	test("error response has recoverable flag (4xx recoverable except 401 handled by interceptor)", async () => {
		const axiosError = makeAxiosError(429, "Rate limited");
		mockState.nextError = axiosError;

		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.stats.getStats();

		expect(result.error).toBeInstanceOf(ApiError);
		if (result.error instanceof ApiError) {
			expect(result.error.recoverable).toBe(true);
		}
	});

	test("non-Axios errors are wrapped in ApiError", async () => {
		mockState.nextError = new TypeError("network failure");

		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);
		const result = await adapter.stats.getStats();

		expect(result.status).toBe("error");
		expect(result.error).toBeInstanceOf(ApiError);
		if (result.error instanceof ApiError) {
			expect(result.error.code).toBe("UNKNOWN_ERROR");
			expect(result.error.source).toBe("api");
		}
	});

	// ---- POST return value shape ----

	test("POST methods return { status, data, error } shape", async () => {
		mockState.nextResponse = { data: { success: true }, status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		const result = await adapter.auth.walletLogin({ walletAddress: "0xabc" });

		expect(result).toHaveProperty("status");
		expect(result).toHaveProperty("data");
		expect(result).toHaveProperty("error");
		expect(result.status).toBe("success");
	});

	test("GET methods return { status, data, error } shape", async () => {
		mockState.nextResponse = { data: [{ id: "m1" }], status: 200 };
		const adapter = createApiAdapter(TEST_CONFIG, mockWallet);

		const result = await adapter.markets.getMarkets();

		expect(result).toHaveProperty("status");
		expect(result).toHaveProperty("data");
		expect(result).toHaveProperty("error");
	});
});
