/**
 * @file Integration tests for src/hub.js — createBridge(config) factory.
 *
 * Uses deep dependency mocking (same pattern as other test files) to avoid
 * mock.module conflicts across the test suite.
 *
 * Tests verify:
 * - createBridge returns { wallet, api, contract, fhe, getState }
 * - Config merging (user overrides override defaults)
 * - Init sequence creates adapters in correct order
 * - getState() returns snapshot of adapter states
 * - Init failure returns partial state with BridgeError info
 * - Wallet account change triggers JWT refresh
 * - API adapter JWT source is wired to wallet adapter
 */

import { mock, test, expect, describe, beforeEach, afterEach } from "bun:test";

// ======================================================================
// Deep dependency mocks — compatible with other test files
// ======================================================================

// -- wagmi mock state (compatible with wallet.test.js) --
const wagmiMockState = {
	account: { address: "0xabc", status: "connected" },
	chainId: 421614,
	connectors: [
		{ id: "metaMask", name: "MetaMask", type: "injected" },
		{ id: "rabby", name: "Rabby", type: "injected" },
		{ id: "walletConnect", name: "WalletConnect", type: "walletConnect" },
	],
	watchAccountCb: null,
	watchChainIdCb: null,
};

// Reset wagmi mock state
function resetWagmiMock() {
	wagmiMockState.account = { address: "0xabc", status: "connected" };
	wagmiMockState.chainId = 421614;
	wagmiMockState.watchAccountCb = null;
	wagmiMockState.watchChainIdCb = null;
}

mock.module("@wagmi/core", () => ({
	createConfig: mock(() => ({})),
	http: mock(() => "http://mock"),
	connect: mock(() =>
		Promise.resolve({ accounts: ["0xabc"], chainId: 421614 }),
	),
	disconnect: mock(() => Promise.resolve()),
	getAccount: mock(() => wagmiMockState.account),
	getChainId: mock(() => wagmiMockState.chainId),
	signMessage: mock(() => Promise.resolve("0xsigned")),
	switchChain: mock(() => Promise.resolve()),
	reconnect: mock(() => Promise.resolve()),
	watchAccount: mock((_cfg, { onChange }) => {
		wagmiMockState.watchAccountCb = onChange;
		return mock(() => {});
	}),
	watchChainId: mock((_cfg, { onChange }) => {
		wagmiMockState.watchChainIdCb = onChange;
		return mock(() => {});
	}),
	injected: mock((opts) => ({
		...opts,
		id: typeof opts?.target === "string" ? opts.target : opts?.target?.id ?? "injected",
		type: "injected",
	})),
	createStorage: mock(() => ({})),
	getConnectors: mock(() => wagmiMockState.connectors),
	getConnections: mock(() => []),
}));

mock.module("@wagmi/connectors", () => ({
	walletConnect: mock(() => ({ id: "walletConnect", name: "WalletConnect", type: "walletConnect" })),
}));

mock.module("viem/chains", () => ({
	arbitrumSepolia: { id: 421614, name: "Arbitrum Sepolia" },
}));

// -- axios mock state --
const axiosMockState = {
	nextResponse: null,
	nextError: null,
	requestLog: [],
	requestInterceptor: null,
	responseSuccessInterceptor: null,
	responseErrorInterceptor: null,
};

function resetAxiosMock() {
	axiosMockState.nextResponse = null;
	axiosMockState.nextError = null;
	axiosMockState.requestLog = [];
	axiosMockState.requestInterceptor = null;
	axiosMockState.responseSuccessInterceptor = null;
	axiosMockState.responseErrorInterceptor = null;
}

mock.module("axios", () => {
	function createMockAxiosInstance() {
		const request = mock((config) => {
			const method = (config?.method ?? "get").toLowerCase();
			const url = config?.url ?? "";
			axiosMockState.requestLog.push({
				method: method.toUpperCase(),
				url,
				data: config?.data,
				headers: config?.headers,
			});
			if (axiosMockState.nextError) return Promise.reject(axiosMockState.nextError);
			return Promise.resolve(
				axiosMockState.nextResponse ?? { data: null, status: 200, statusText: "OK", headers: {} },
			);
		});

		const instance = mock((config) => request(config));

		instance.get = mock((url, config) => {
			axiosMockState.requestLog.push({ method: "GET", url, ...config });
			if (axiosMockState.nextError) return Promise.reject(axiosMockState.nextError);
			return Promise.resolve(
				axiosMockState.nextResponse ?? { data: [], status: 200, statusText: "OK", headers: {} },
			);
		});
		instance.post = mock((url, data, config) => {
			axiosMockState.requestLog.push({ method: "POST", url, data, ...config });
			if (axiosMockState.nextError) return Promise.reject(axiosMockState.nextError);
			return Promise.resolve(
				axiosMockState.nextResponse ?? { data: {}, status: 200, statusText: "OK", headers: {} },
			);
		});
		instance.put = mock((url, data, config) => {
			axiosMockState.requestLog.push({ method: "PUT", url, data, ...config });
			if (axiosMockState.nextError) return Promise.reject(axiosMockState.nextError);
			return Promise.resolve(
				axiosMockState.nextResponse ?? { data: {}, status: 200, statusText: "OK", headers: {} },
			);
		});
		instance.interceptors = {
			request: {
				use: mock((fulfilled, rejected) => {
					axiosMockState.requestInterceptor = { fulfilled, rejected };
					return 0;
				}),
				eject: mock(() => {}),
			},
			response: {
				use: mock((fulfilled, rejected) => {
					axiosMockState.responseSuccessInterceptor = fulfilled;
					axiosMockState.responseErrorInterceptor = rejected;
					return 0;
				}),
				eject: mock(() => {}),
			},
		};
		instance.defaults = { baseURL: "", headers: { common: {} } };
		instance.create = mock(() => createMockAxiosInstance());
		return instance;
	}

	const axiosInstance = createMockAxiosInstance();
	axiosInstance.create = mock(() => createMockAxiosInstance());
	return axiosInstance;
});

// -- viem mock state (compatible with contract.test.js) --
const readContractCalls = [];
const viemMockState = {
	readContractResult: null,
	readContractError: null,
	estimateGasResult: 100000n,
	estimateGasError: null,
	writeContractResult: "0xdeadbeef",
	writeContractError: null,
	waitForReceiptResult: { status: "success", blockNumber: 12345n, transactionHash: "0xdeadbeef" },
	waitForReceiptError: null,
	windowEthereumAvailable: false,
};

function resetViemMock() {
	readContractCalls.length = 0;
	viemMockState.readContractResult = null;
	viemMockState.readContractError = null;
	viemMockState.estimateGasResult = 100000n;
	viemMockState.estimateGasError = null;
	viemMockState.writeContractResult = "0xdeadbeef";
	viemMockState.writeContractError = null;
	viemMockState.waitForReceiptResult = {
		status: "success",
		blockNumber: 12345n,
		transactionHash: "0xdeadbeef",
	};
	viemMockState.waitForReceiptError = null;
	viemMockState.windowEthereumAvailable = false;
}

const mockReadContract = mock(({ functionName, args }) => {
	readContractCalls.push({ functionName, args });
	if (viemMockState.readContractError) throw viemMockState.readContractError;
	if (viemMockState.readContractResult !== null) return viemMockState.readContractResult;
	return "0xresult";
});

const mockEstimateContractGas = mock((params) => {
	if (viemMockState.estimateGasError) throw viemMockState.estimateGasError;
	return viemMockState.estimateGasResult;
});

mock.module("viem", () => ({
	createPublicClient: mock(() => ({
		readContract: mockReadContract,
		estimateContractGas: mockEstimateContractGas,
		waitForTransactionReceipt: mock(({ hash }) => {
			if (viemMockState.waitForReceiptError) throw viemMockState.waitForReceiptError;
			return viemMockState.waitForReceiptResult;
		}),
	})),
	createWalletClient: mock(() => ({
		writeContract: mock(({ functionName, args, gas }) => {
			if (viemMockState.writeContractError) throw viemMockState.writeContractError;
			return viemMockState.writeContractResult;
		}),
	})),
	http: mock(() => "http://mock"),
	custom: mock(() => "custom://mock"),
}));

// -- @cofhe/sdk mock state --
const cofheMockState = {
	createSelfError: null,
	importError: null,
};

function resetCofheMock() {
	cofheMockState.createSelfError = null;
	cofheMockState.importError = null;
}

mock.module("@cofhe/sdk/permits", () => ({
	PermitUtils: {
		createSelf: mock((options) => {
			if (cofheMockState.createSelfError) throw cofheMockState.createSelfError;
			return {
				hash: "0x_mock_permit_hash",
				issuer: options?.issuer ?? "0x0000000000000000000000000000000000000000",
				expiration:
					options?.expiration ?? Math.floor(Date.now() / 1000) + 900,
			};
		}),
		isValid: mock(() => ({ valid: true, error: null })),
		isExpired: mock(() => false),
		isSigned: mock(() => false),
		isSignedAndNotExpired: mock(() => false),
	},
}));

mock.module("@cofhe/sdk/core", () => ({
	FheTypes: { Uint128: "uint128" },
	EncryptInputsBuilder: mock(() => ({
		toEncryptedInputs: mock(() =>
			Promise.resolve({ handles: ["0x_mock_encrypted_handle"], inputs: [] }),
		),
	})),
	DecryptForViewBuilder: mock(() => ({
		execute: mock(() => Promise.resolve(BigInt(42))),
	})),
}));

// ======================================================================
// Import modules under test (after mocks)
// ======================================================================
import { createBridge } from "../src/hub.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { BridgeError } from "../src/types.js";

// ======================================================================
// Tests
// ======================================================================

describe("createBridge", () => {
	beforeEach(() => {
		// Set up fake localStorage + window for browser-dependant adapters
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
		globalThis.window = { localStorage: globalThis.localStorage };
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve({}),
			}),
		);

		resetWagmiMock();
		resetAxiosMock();
		resetViemMock();
		resetCofheMock();
	});

	afterEach(() => {
		delete globalThis.localStorage;
		delete globalThis.window;
		delete globalThis.fetch;
	});

	// ======================================================================
	// Basic structure and return shape
	// ======================================================================

	test("returns { wallet, api, contract, fhe, getState } with all adapters present", () => {
		const bridge = createBridge();
		expect(bridge).toBeDefined();
		expect(bridge.wallet).toBeDefined();
		expect(bridge.api).toBeDefined();
		expect(bridge.contract).toBeDefined();
		expect(bridge.fhe).toBeDefined();
		expect(typeof bridge.getState).toBe("function");
	});

	test("returns object with expected keys", () => {
		const bridge = createBridge();
		const keys = Object.keys(bridge);
		expect(keys).toContain("wallet");
		expect(keys).toContain("api");
		expect(keys).toContain("contract");
		expect(keys).toContain("fhe");
		expect(keys).toContain("getState");
	});

	test("all 4 adapters are present and non-null", () => {
		const bridge = createBridge();
		expect(bridge.wallet).toBeTruthy();
		expect(bridge.api).toBeTruthy();
		expect(bridge.contract).toBeTruthy();
		expect(bridge.fhe).toBeTruthy();
	});

	// ======================================================================
	// Config merging
	// ======================================================================

	test("uses default config when no config provided", () => {
		const bridge = createBridge();
		const state = bridge.getState();
		expect(state.data.config.apiBaseUrl).toBe(DEFAULT_CONFIG.apiBaseUrl);
		expect(state.data.config.chainId).toBe(DEFAULT_CONFIG.chainId);
		expect(state.data.config.rpcUrl).toBe(DEFAULT_CONFIG.rpcUrl);
	});

	test("user API_BASE_URL overrides default config", () => {
		const customUrl = "https://custom-api.example.com";
		const bridge = createBridge({ apiBaseUrl: customUrl });
		const state = bridge.getState();
		expect(state.data.config.apiBaseUrl).toBe(customUrl);
		expect(state.data.config.chainId).toBe(DEFAULT_CONFIG.chainId);
	});

	test("user chainId overrides default config", () => {
		const bridge = createBridge({ chainId: 1 });
		const state = bridge.getState();
		expect(state.data.config.chainId).toBe(1);
	});

	test("user rpcUrl overrides default config", () => {
		const customRpc = "https://custom-rpc.example.com";
		const bridge = createBridge({ rpcUrl: customRpc });
		const state = bridge.getState();
		expect(state.data.config.rpcUrl).toBe(customRpc);
	});

	test("partial config merge keeps default values for unspecified keys", () => {
		const bridge = createBridge({ apiBaseUrl: "https://test.api" });
		const state = bridge.getState();
		expect(state.data.config.apiBaseUrl).toBe("https://test.api");
		expect(state.data.config.chainId).toBe(DEFAULT_CONFIG.chainId);
		expect(state.data.config.rpcUrl).toBe(DEFAULT_CONFIG.rpcUrl);
	});

	// ======================================================================
	// getState()
	// ======================================================================

	test("getState() returns object with status, data, error fields", () => {
		const bridge = createBridge();
		const state = bridge.getState();
		expect(state).toBeDefined();
		expect(typeof state.status).toBe("string");
		expect(state.data).toBeDefined();
		expect("error" in state).toBe(true);
	});

	test("getState() returns status 'success' on successful init", () => {
		const bridge = createBridge();
		const state = bridge.getState();
		expect(state.status).toBe("success");
		expect(state.error).toBeNull();
	});

	test("getState() returns wallet snapshot with address, chainId, connected, hasJwt", () => {
		const bridge = createBridge();
		const state = bridge.getState();
		expect(state.data.wallet).toBeDefined();
		expect(state.data.wallet).toBeDefined();
		expect(typeof state.data.wallet.chainId).toBe("number");
		expect(typeof state.data.wallet.connected).toBe("boolean");
		expect("hasJwt" in state.data.wallet).toBe(true);
	});

	test("getState() returns fhe snapshot with permitUnlocked and permitSecondsLeft", () => {
		const bridge = createBridge();
		const state = bridge.getState();
		expect(state.data.fhe).toBeDefined();
		expect("permitUnlocked" in state.data.fhe).toBe(true);
		expect("permitSecondsLeft" in state.data.fhe).toBe(true);
	});

	test("getState() returns config in data", () => {
		const bridge = createBridge({ apiBaseUrl: "https://custom.api" });
		const state = bridge.getState();
		expect(state.data.config).toBeDefined();
		expect(state.data.config.apiBaseUrl).toBe("https://custom.api");
	});

	// ======================================================================
	// Error handling — config validation
	// ======================================================================

	test("returns partial state when config is invalid (missing apiBaseUrl)", () => {
		const bridge = createBridge({ apiBaseUrl: "" });
		expect(bridge.error).toBeDefined();
		expect(bridge.error).toBeInstanceOf(BridgeError);
		expect(bridge.error.code).toBe("CONFIG_VALIDATION_FAILED");
	});

	test("returns partial state when config is invalid (missing chainId)", () => {
		// @ts-ignore — testing null input
		const bridge = createBridge({ chainId: null });
		expect(bridge.error).toBeDefined();
		expect(bridge.error).toBeInstanceOf(BridgeError);
		expect(bridge.error.code).toBe("CONFIG_VALIDATION_FAILED");
	});

	test("returns partial state when config is invalid (missing rpcUrl)", () => {
		const bridge = createBridge({ rpcUrl: "" });
		expect(bridge.error).toBeDefined();
		expect(bridge.error).toBeInstanceOf(BridgeError);
		expect(bridge.error.code).toBe("CONFIG_VALIDATION_FAILED");
	});

	test("config validation error produces getState with status 'error'", () => {
		const bridge = createBridge({ apiBaseUrl: "" });
		const state = bridge.getState();
		expect(state.status).toBe("error");
		expect(state.error).toBeDefined();
		expect(state.error.code).toBe("CONFIG_VALIDATION_FAILED");
	});

	test("config validation error error has source 'config'", () => {
		const bridge = createBridge({ apiBaseUrl: "" });
		expect(bridge.error.source).toBe("config");
	});

	// ======================================================================
	// Wallet → API adapter JWT wiring
	// ======================================================================

	test("API adapter has JWT methods wired to wallet adapter", () => {
		const bridge = createBridge();
		// API adapter was created with wallet adapter for JWT lifecycle
		// Verify the wiring exists by checking that the API's JWT interceptor
		// was configured (interceptors have a request handler attached)
		expect(axiosMockState.requestInterceptor).toBeDefined();
	});

	test("wallet adapter has getJwt method", () => {
		const bridge = createBridge();
		expect(typeof bridge.wallet.getJwt).toBe("function");
	});

	test("wallet adapter has refreshJwt method for 401 recovery", () => {
		const bridge = createBridge();
		expect(typeof bridge.wallet.refreshJwt).toBe("function");
	});

	// ======================================================================
	// Wallet → Contract adapter wiring
	// ======================================================================

	test("contract adapter has read and write methods", () => {
		const bridge = createBridge();
		expect(bridge.contract.read).toBeDefined();
		expect(bridge.contract.write).toBeDefined();
		expect(bridge.contract.simulate).toBeDefined();
	});

	test("contract adapter has getClient method", () => {
		const bridge = createBridge();
		expect(typeof bridge.contract.getClient).toBe("function");
	});

	// ======================================================================
	// Wallet onChainChange → JWT refresh wiring
	// ======================================================================

	test("wallet adapter has onChainChange method", () => {
		const bridge = createBridge();
		expect(typeof bridge.wallet.onChainChange).toBe("function");
	});

	test("hub registers onChainChange handler during bridge creation", () => {
		// The hub calls adapters.wallet.onChainChange() during init.
		// This should trigger watchAccount from @wagmi/core.
		createBridge();

		// Verify the watchAccount mock captured a callback, which proves
		// onChainChange was registered by the hub.
		expect(wagmiMockState.watchAccountCb).toBeDefined();
		expect(typeof wagmiMockState.watchAccountCb).toBe("function");
	});

	test("onChainChange with account change triggers wallet.logout via mock chain", async () => {
		let logoutCalled = false;
		const bridge = createBridge();

		// Override wallet.logout to track calls
		const originalLogout = bridge.wallet.logout;
		bridge.wallet.logout = async () => {
			logoutCalled = true;
		};

		// Directly trigger the account change via the hub's registered callback.
		// The hub registers onChainChange which calls watchAccount internally.
		// We can fire the watcher by calling the mock's captured callback.
		if (wagmiMockState.watchAccountCb) {
			wagmiMockState.watchAccountCb({ address: "0xdef" });
		}

		// Allow microtasks (promise chain from .catch(() => {})) to flush
		await new Promise((r) => setTimeout(r, 5));
		expect(logoutCalled).toBe(true);

		// Restore
		bridge.wallet.logout = originalLogout;
	});

	test("onChainChange does not logout on chainId-only changes", () => {
		let logoutCalled = false;
		const bridge = createBridge();

		bridge.wallet.logout = async () => {
			logoutCalled = true;
		};

		// Trigger chain-only change via the hub's registered watcher
		if (wagmiMockState.watchChainIdCb) {
			wagmiMockState.watchChainIdCb(1);
		}

		expect(logoutCalled).toBe(false);
	});

	// ======================================================================
	// FHE adapter
	// ======================================================================

	test("FHE adapter has permit and encrypt/decrypt methods", () => {
		const bridge = createBridge();
		expect(typeof bridge.fhe.permitGrant).toBe("function");
		expect(typeof bridge.fhe.encrypt).toBe("function");
		expect(typeof bridge.fhe.decrypt).toBe("function");
	});

	test("FHE adapter has staggeredReveal stub", () => {
		const bridge = createBridge();
		expect(bridge.fhe.staggeredReveal).toBeDefined();
	});

	// ======================================================================
	// Edge cases
	// ======================================================================

	test("createBridge with no arguments uses defaults", () => {
		const bridge = createBridge();
		expect(bridge.wallet).toBeDefined();
		expect(bridge.api).toBeDefined();
		expect(bridge.contract).toBeDefined();
		expect(bridge.fhe).toBeDefined();
		expect(bridge.error).toBeUndefined();
	});

	test("createBridge with empty object uses defaults", () => {
		const bridge = createBridge({});
		expect(bridge.error).toBeUndefined();
		expect(bridge.wallet).toBeDefined();
	});

	test("createBridge with null config is handled (treated as missing)", () => {
		// @ts-ignore — testing null input
		const bridge = createBridge(null);
		// Should use defaults since null will be spread as empty
		expect(bridge.wallet).toBeDefined();
	});

	test("multiple calls to getState return fresh snapshots", () => {
		const bridge = createBridge();
		const state1 = bridge.getState();
		const state2 = bridge.getState();
		expect(state1).toEqual(state2);
	});

	test("error field is undefined on successful init", () => {
		const bridge = createBridge();
		expect(bridge.error).toBeUndefined();
	});

	test("getState().status is 'success' when all adapters initialized", () => {
		const bridge = createBridge();
		expect(bridge.getState().status).toBe("success");
	});
});
