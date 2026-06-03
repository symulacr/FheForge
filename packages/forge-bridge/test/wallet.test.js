/**
 * @file Unit tests for src/wallet.js
 *
 * Tests mock wagmi core v2 functions, fetch, and localStorage
 * to validate the wallet adapter and JWT lifecycle.
 *
 * Uses mutable mock state so individual tests can change
 * mock return values without re-importing the module.
 */

import { mock, test, expect, describe, beforeEach, afterEach } from "bun:test";

// --------------------------------------------------------------------------
// Mutable mock state — tests update these to change mock behavior
// --------------------------------------------------------------------------
const mockState = {
	account: { address: "0xabc", status: "connected" },
	chainId: 421614,
	connectError: null,
	disconnectError: null,
	signMessageError: null,
	switchChainError: null,
	watchAccountCb: null,
	watchChainIdCb: null,
	getBalanceResult: 123456789n,
	getBalanceError: null,
	connectors: [
		{ id: "metaMask", name: "MetaMask", type: "injected" },
		{ id: "rabby", name: "Rabby", type: "injected" },
		{ id: "walletConnect", name: "WalletConnect", type: "walletConnect" },
	],
};

// Wagmi config object with connectors support
const mockConnectedConnector = {
	connector: {
		getProvider: () => mockState.getProvider(),
	},
};

const wagmiConfig = {};


// --------------------------------------------------------------------------
// Module mocks — delegate to mutable mockState
// --------------------------------------------------------------------------
mock.module("@wagmi/core", () => ({
	createConfig: mock(() => wagmiConfig),
	http: mock(() => "http://mock"),
	connect: mock((_cfg, _params) => {
		if (mockState.connectError) return Promise.reject(mockState.connectError);
		return Promise.resolve({ accounts: ["0xabc"], chainId: 421614 });
	}),
	disconnect: mock(() => {
		if (mockState.disconnectError) return Promise.reject(mockState.disconnectError);
		return Promise.resolve();
	}),
	getAccount: mock(() => mockState.account),
	getChainId: mock(() => mockState.chainId),
	signMessage: mock((_cfg, _params) => {
		if (mockState.signMessageError) return Promise.reject(mockState.signMessageError);
		return Promise.resolve("0xsigned");
	}),
	switchChain: mock((_cfg, _params) => {
		if (mockState.switchChainError) return Promise.reject(mockState.switchChainError);
		return Promise.resolve();
	}),
	reconnect: mock(() => Promise.resolve()),
	watchAccount: mock((_cfg, { onChange }) => {
		mockState.watchAccountCb = onChange;
		return mock(() => {});
	}),
	watchChainId: mock((_cfg, { onChange }) => {
		mockState.watchChainIdCb = onChange;
		return mock(() => {});
	}),
	injected: mock((opts) => ({
		...opts,
		id: typeof opts?.target === "string" ? opts.target : opts?.target?.id ?? "injected",
		type: "injected",
	})),
	createStorage: mock(() => ({})),
	getConnectors: mock(() => mockState.connectors),
	getConnections: mock(() => [mockConnectedConnector]),
}));

mock.module("@wagmi/connectors", () => ({
	walletConnect: mock(() => ({ id: "walletConnect", name: "WalletConnect", type: "walletConnect" })),
}));

mock.module("viem", () => ({
	createPublicClient: mock(() => ({
		getBalance: mock(() => {
			if (mockState.getBalanceError) return Promise.reject(mockState.getBalanceError);
			return Promise.resolve(mockState.getBalanceResult);
		}),
	})),
	http: mock((url) => ({ url, transport: "http" })),
}));

mock.module("viem/chains", () => ({
	arbitrumSepolia: { id: 421614, name: "Arbitrum Sepolia" },
}));

// Import after mocks are established
import { createWalletAdapter } from "../src/wallet.js";
import { WalletError } from "../src/types.js";

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("createWalletAdapter", () => {
	const testConfig = { apiBaseUrl: "https://api.test", chainId: 421614 };

	beforeEach(() => {
		// Reset mock state
		mockState.account = { address: "0xabc", status: "connected" };
		mockState.chainId = 421614;
		mockState.connectError = null;
		mockState.disconnectError = null;
		mockState.signMessageError = null;
		mockState.switchChainError = null;
		mockState.watchAccountCb = null;
		mockState.watchChainIdCb = null;
		mockState.getBalanceResult = 123456789n;
		mockState.getBalanceError = null;

		// Set up fake localStorage
		globalThis.localStorage = {
			store: {},
			getItem(key) {
				return this.store[key] ?? null;
			},
			setItem(key, value) {
				this.store[key] = String(value);
			},
			removeItem(key) {
				delete this.store[key];
			},
			clear() {
				this.store = {};
			},
			get length() {
				return Object.keys(this.store).length;
			},
			key() {
				return null;
			},
		};

		globalThis.window = {
			localStorage: globalThis.localStorage,
			ethereum: { isMetaMask: true },
		};

		// Reset fetch mock
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve({}),
			}),
		);
	});

	afterEach(() => {
		delete globalThis.localStorage;
		delete globalThis.window;
		delete globalThis.fetch;
	});

	// ---- config creation ----

	test("creates wagmi config with injected and walletConnect connectors", () => {
		const adapter = createWalletAdapter(testConfig);
		expect(adapter).toBeDefined();
	});

	// ---- connect ----

	test("connect() calls wagmi and returns accounts", async () => {
		const adapter = createWalletAdapter(testConfig);
		const result = await adapter.connect();
		expect(result.accounts).toBeDefined();
		expect(result.accounts.accounts).toEqual(["0xabc"]);
	});

	test("connect() with connectorId uses that connector", async () => {
		globalThis.window.ethereum = {
			providers: [{ isMetaMask: true }, { isRabby: true }],
		};
		const adapter = createWalletAdapter(testConfig);
		const result = await adapter.connect("rabby");
		expect(result.accounts).toBeDefined();
	});

	test("connect() throws WalletError when connectorId not found", async () => {
		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.connect("nonexistent")).rejects.toThrow(WalletError);
	});

	test("connect() throws PROVIDER_NOT_FOUND before wagmi for missing MetaMask", async () => {
		globalThis.window.ethereum = { isRabby: true };
		const adapter = createWalletAdapter(testConfig);
		try {
			await adapter.connect("metaMask");
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(WalletError);
			if (e instanceof WalletError) {
				expect(e.code).toBe("PROVIDER_NOT_FOUND");
				expect(e.message).toBe(
					"MetaMask provider not found. Install MetaMask or enable it for this site.",
				);
			}
		}
	});

	test("connect() throws PROVIDER_NOT_FOUND before wagmi for missing Rabby", async () => {
		const adapter = createWalletAdapter(testConfig);
		try {
			await adapter.connect("rabby");
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(WalletError);
			if (e instanceof WalletError) {
				expect(e.code).toBe("PROVIDER_NOT_FOUND");
				expect(e.message).toBe("Rabby provider not found. Install Rabby or enable it for this site.");
			}
		}
	});

	test("connect() throws WalletError on connection failure", async () => {
		mockState.connectError = new Error("User rejected");
		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.connect()).rejects.toThrow(WalletError);
	});

	// ---- disconnect ----

	test("disconnect() clears JWT from localStorage", async () => {
		localStorage.setItem("auth_token", "test.jwt.token");
		const adapter = createWalletAdapter(testConfig);
		await adapter.disconnect();
		expect(localStorage.getItem("auth_token")).toBeNull();
	});

	test("disconnect() succeeds even when wagmi disconnect throws", async () => {
		mockState.disconnectError = new Error("Wallet error");
		localStorage.setItem("auth_token", "old.token");
		const adapter = createWalletAdapter(testConfig);
		// Should not throw
		await adapter.disconnect();
		expect(localStorage.getItem("auth_token")).toBeNull();
	});

	// ---- getAccount ----

	test("getAccount() returns connected account address", () => {
		const adapter = createWalletAdapter(testConfig);
		expect(adapter.getAccount()).toBe("0xabc");
	});

	test("getAccount() returns null when not connected", () => {
		mockState.account = { address: null, status: "disconnected" };
		const adapter = createWalletAdapter(testConfig);
		expect(adapter.getAccount()).toBeNull();
	});

	// ---- getChainId ----

	test("getChainId() returns current chain ID", () => {
		const adapter = createWalletAdapter(testConfig);
		expect(adapter.getChainId()).toBe(421614);
	});

	// ---- getBalance ----

	test("getBalance() returns real RPC balance for connected account", async () => {
		const adapter = createWalletAdapter(testConfig);
		const balance = await adapter.getBalance();
		expect(balance).toBe(123456789n);
	});

	test("getBalance(address) returns real RPC balance for supplied address", async () => {
		const adapter = createWalletAdapter(testConfig);
		const balance = await adapter.getBalance("0xdef");
		expect(balance).toBe(123456789n);
	});

	test("getBalance() throws WalletError when disconnected", async () => {
		mockState.account = { address: null, status: "disconnected" };
		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.getBalance()).rejects.toThrow(WalletError);
	});

	// ---- isConnected ----

	test("isConnected() returns true when wallet connected", () => {
		const adapter = createWalletAdapter(testConfig);
		expect(adapter.isConnected()).toBe(true);
	});

	test("isConnected() returns false when disconnected", () => {
		mockState.account = { address: null, status: "disconnected" };
		const adapter = createWalletAdapter(testConfig);
		expect(adapter.isConnected()).toBe(false);
	});

	// ---- getJwt ----

	test("getJwt() returns null when no JWT stored", () => {
		const adapter = createWalletAdapter(testConfig);
		expect(adapter.getJwt()).toBeNull();
	});

	test("getJwt() returns token when valid JWT stored", () => {
		const payload = btoa(
			JSON.stringify({ sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600 }),
		);
		const token = `header.${payload}.signature`;
		localStorage.setItem("auth_token", token);

		const adapter = createWalletAdapter(testConfig);
		expect(adapter.getJwt()).toBe(token);
	});

	test("getJwt() returns null and removes expired JWT", () => {
		const payload = btoa(
			JSON.stringify({ sub: "user1", exp: Math.floor(Date.now() / 1000) - 3600 }),
		);
		const token = `header.${payload}.signature`;
		localStorage.setItem("auth_token", token);

		const adapter = createWalletAdapter(testConfig);
		expect(adapter.getJwt()).toBeNull();
		expect(localStorage.getItem("auth_token")).toBeNull();
	});

	test("getJwt() returns null for malformed JWT", () => {
		localStorage.setItem("auth_token", "not-a-jwt");
		const adapter = createWalletAdapter(testConfig);
		expect(adapter.getJwt()).toBeNull();
		expect(localStorage.getItem("auth_token")).toBeNull();
	});

	// ---- login ----

	test("login() throws WalletError when not connected", async () => {
		mockState.account = { address: null, status: "disconnected" };
		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.login()).rejects.toThrow(WalletError);
	});

	test("login() performs full JWT lifecycle: nonce -> sign -> POST -> store JWT", async () => {
		globalThis.fetch = mock((url) => {
			if (url.includes("/auth/nonce/")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ nonce: "abc123", message: "Sign this message" }),
				});
			}
			if (url.includes("/auth/wallet-login")) {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							accessToken: "jwt.token.here",
							userId: "user1",
							walletAddress: "0xabc",
						}),
				});
			}
			return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
		});

		const adapter = createWalletAdapter(testConfig);
		const result = await adapter.login();

		expect(result.accessToken).toBe("jwt.token.here");
		expect(result.userId).toBe("user1");
		expect(result.walletAddress).toBe("0xabc");
		expect(localStorage.getItem("auth_token")).toBe("jwt.token.here");
	});

	test("login() throws WalletError on nonce fetch failure", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 500,
				json: () => Promise.resolve({}),
			}),
		);

		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.login()).rejects.toThrow(WalletError);
	});

	test("login() throws WalletError on login POST failure (401)", async () => {
		globalThis.fetch = mock((url) => {
			if (url.includes("/auth/nonce/")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ nonce: "abc", message: "Sign this" }),
				});
			}
			return Promise.resolve({
				ok: false,
				status: 401,
				json: () => Promise.resolve({}),
			});
		});

		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.login()).rejects.toThrow(WalletError);
	});

	test("login() throws WalletError when signing fails", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ nonce: "abc", message: "Sign" }),
			}),
		);

		mockState.signMessageError = new Error("User rejected signature");

		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.login()).rejects.toThrow(WalletError);
	});

	// ---- logout ----

	test("logout() clears JWT from localStorage", async () => {
		localStorage.setItem("auth_token", "test.jwt.token");
		const adapter = createWalletAdapter(testConfig);
		await adapter.logout();
		expect(localStorage.getItem("auth_token")).toBeNull();
	});

	// ---- onChainChange ----

	test("onChainChange() registers watchers and returns unsubscribe function", () => {
		const adapter = createWalletAdapter(testConfig);
		const cb = mock(() => {});
		const unsubscribe = adapter.onChainChange(cb);

		expect(typeof unsubscribe).toBe("function");
		// Unsubscribe cleans up
		unsubscribe();
	});

	test("onChainChange callback fires on account change", () => {
		const adapter = createWalletAdapter(testConfig);
		const cb = mock(() => {});
		adapter.onChainChange(cb);

		// Trigger the account watcher callback
		mockState.watchAccountCb?.({ address: "0xdef" });
		expect(cb).toHaveBeenCalledWith({ account: "0xdef" });
	});

	test("onChainChange callback fires on chain change", () => {
		const adapter = createWalletAdapter(testConfig);
		const cb = mock(() => {});
		adapter.onChainChange(cb);

		// Trigger the chain watcher callback
		mockState.watchChainIdCb?.(1);
		expect(cb).toHaveBeenCalledWith({ chainId: 1 });
	});

	// ---- switchNetwork ----

	test("switchNetwork() calls wagmi switchChain for known chain", async () => {
		const adapter = createWalletAdapter(testConfig);
		await adapter.switchNetwork(421614);
	});

	test("switchNetwork() tries wallet_addEthereumChain on failure", async () => {
		let addChainCalled = false;
		mockState.getProvider = () => ({
			request: mock(({ method }) => {
				if (method === "wallet_addEthereumChain") {
					addChainCalled = true;
					return Promise.resolve();
				}
				return Promise.resolve();
			}),
		});

		// Simulate chain not configured error
		const switchError = new Error("Chain not configured");
		switchError.name = "ChainNotConfiguredError";
		switchError.code = 4902;
		mockState.switchChainError = switchError;

		const adapter = createWalletAdapter(testConfig);
		await adapter.switchNetwork(421614);
		expect(addChainCalled).toBe(true);
	});

	test("switchNetwork() throws WalletError on switch failure without fallback", async () => {
		mockState.switchChainError = new Error("User rejected");
		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.switchNetwork(1)).rejects.toThrow(WalletError);
	});

	test("switchNetwork() throws WalletError when wallet_addEthereumChain also fails", async () => {
		mockState.getProvider = () => ({
			request: mock(() => Promise.reject(new Error("Add chain rejected"))),
		});

		const switchError = new Error("Chain not configured");
		switchError.name = "ChainNotConfiguredError";
		mockState.switchChainError = switchError;

		const adapter = createWalletAdapter(testConfig);
		await expect(adapter.switchNetwork(421614)).rejects.toThrow(WalletError);
	});

	// ---- refreshJwt ----

	test("refreshJwt() re-runs login and returns new token", async () => {
		globalThis.fetch = mock((url) => {
			if (url.includes("/auth/nonce/")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ nonce: "abc", message: "Sign" }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve({
						accessToken: "new.jwt.token",
						userId: "user1",
						walletAddress: "0xabc",
					}),
			});
		});

		const adapter = createWalletAdapter(testConfig);
		const result = await adapter.refreshJwt();
		expect(result.accessToken).toBe("new.jwt.token");
	});

	// ---- error types ----

	test("WalletError is thrown with correct code and source", async () => {
		mockState.connectError = new Error("Provider not found");

		const adapter = createWalletAdapter(testConfig);
		try {
			await adapter.connect();
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(WalletError);
			if (e instanceof WalletError) {
				expect(e.code).toBe("CONNECT_FAILED");
				expect(e.source).toBe("wallet");
			}
		}
	});
});
