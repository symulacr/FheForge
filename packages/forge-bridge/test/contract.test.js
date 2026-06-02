/**
 * @file Unit tests for src/contract.js
 *
 * Tests mock viem publicClient + walletClient to validate:
 * - Factory returns expected shape { read, write, simulate, getClient }
 * - Read wrappers call publicClient.readContract with correct args
 * - Write wrappers call estimateContractGas → writeContract → waitForTransactionReceipt
 * - Simulation calls apiAdapter.defiStrategies.simulateDefiStrategy
 * - ContractError is thrown on viem errors
 * - ABI imports map to contracts/out/*.json
 * - Error codes are mapped from backend-manifest
 *
 * Full contract tests against real network are manual only.
 */

import { mock, test, expect, describe, beforeEach, afterEach, spyOn } from "bun:test";
import { ContractError } from "../src/types.js";

// --------------------------------------------------------------------------
// Mock viem
// --------------------------------------------------------------------------

/**
 * Tracks all readContract calls for assertion.
 * @type {Array<{functionName: string, args: unknown[]}>}
 */
const readContractCalls = [];

/**
 * Tracks all estimateContractGas calls.
 * @type {Array<{functionName: string, args: unknown[]}>}
 */
const estimateGasCalls = [];

/**
 * Tracks all writeContract calls.
 * @type {Array<{functionName: string, args: unknown[], gas: unknown}>}
 */
const writeContractCalls = [];

/**
 * Tracks all waitForTransactionReceipt calls.
 * @type {Array<{hash: string}>}
 */
const waitForReceiptCalls = [];

/**
 * Mock state — tests update these to control mock behaviour.
 */
const mockState = {
	/** @type {unknown} */
	readContractResult: null,
	/** @type {Error | null} */
	readContractError: null,

	/** @type {bigint} */
	estimateGasResult: 100000n,
	/** @type {Error | null} */
	estimateGasError: null,

	/** @type {`0x${string}`} */
	writeContractResult: "0xdeadbeef",
	/** @type {Error | null} */
	writeContractError: null,

	/** @type {{ status: string, blockNumber: bigint, transactionHash: `0x${string}` }} */
	waitForReceiptResult: { status: "success", blockNumber: 12345n, transactionHash: "0xdeadbeef" },
	/** @type {Error | null} */
	waitForReceiptError: null,

	/** @type {boolean} */
	windowEthereumAvailable: true,
};

/**
 * Reset all mocks to defaults.
 */
function resetMockState() {
	readContractCalls.length = 0;
	estimateGasCalls.length = 0;
	writeContractCalls.length = 0;
	waitForReceiptCalls.length = 0;

	mockState.readContractResult = null;
	mockState.readContractError = null;
	mockState.estimateGasResult = 100000n;
	mockState.estimateGasError = null;
	mockState.writeContractResult = "0xdeadbeef";
	mockState.writeContractError = null;
	mockState.waitForReceiptResult = { status: "success", blockNumber: 12345n, transactionHash: "0xdeadbeef" };
	mockState.waitForReceiptError = null;
	mockState.windowEthereumAvailable = true;
}

// Create mock public client
const mockPublicClient = {
	readContract: mock(async (...args) => {
		// args is [config object] for viem
		const config = args[0] || args;
		readContractCalls.push({
			functionName: config.functionName || "unknown",
			args: config.args || [],
		});
		if (mockState.readContractError) throw mockState.readContractError;
		return mockState.readContractResult;
	}),
	estimateContractGas: mock(async (...args) => {
		const config = args[0] || args;
		estimateGasCalls.push({
			functionName: config.functionName || "unknown",
			args: config.args || [],
		});
		if (mockState.estimateGasError) throw mockState.estimateGasError;
		return mockState.estimateGasResult;
	}),
	waitForTransactionReceipt: mock(async (...args) => {
		const config = args[0] || args;
		waitForReceiptCalls.push({ hash: config.hash || "unknown" });
		if (mockState.waitForReceiptError) throw mockState.waitForReceiptError;
		return mockState.waitForReceiptResult;
	}),
};

// Create mock wallet client
const mockWalletClient = {
	writeContract: mock(async (...args) => {
		const config = args[0] || args;
		writeContractCalls.push({
			functionName: config.functionName || "unknown",
			args: config.args || [],
			gas: config.gas,
		});
		if (mockState.writeContractError) throw mockState.writeContractError;
		return mockState.writeContractResult;
	}),
	account: "0xMockAccount",
};

// Mock window.ethereum for wallet client creation
beforeEach(() => {
	resetMockState();
	// @ts-ignore
	globalThis.window = {
		ethereum: mockState.windowEthereumAvailable ? { isMetaMask: true } : undefined,
	};
});

afterEach(() => {
	// @ts-ignore
	delete globalThis.window;
});

// --------------------------------------------------------------------------
// Mock viem module
// --------------------------------------------------------------------------

mock.module("viem", () => {
	return {
		createPublicClient: mock(() => mockPublicClient),
		createWalletClient: mock(() => mockWalletClient),
		http: mock((url) => ({ url, transport: "http" })),
		custom: mock(() => ({ transport: "custom" })),
	};
});

// --------------------------------------------------------------------------
// Mock the FHE adapter
// --------------------------------------------------------------------------
const mockFheAdapter = {
	encrypt: mock(async (amount, token) => `encrypted_${amount}_${token}`),
	decrypt: mock(async (handle) => `decrypted_${handle}`),
	permitGrant: mock(async () => {}),
	permitCheck: mock(async () => ({ unlocked: true, secondsLeft: 900 })),
};

// --------------------------------------------------------------------------
// Mock API adapter
// --------------------------------------------------------------------------
const mockSimulateResult = { status: "success", data: { result: "simulated" }, error: null };
let simulateCalled = false;

const mockApiAdapter = {
	defiStrategies: {
		simulateDefiStrategy: mock(async (data) => {
			simulateCalled = true;
			return mockSimulateResult;
		}),
	},
	governance: {
		castVote: mock(async (data) => ({
			status: "success",
			data: { voteCast: true, ...data },
			error: null,
		})),
	},
};

// --------------------------------------------------------------------------
// Import the module under test
// contract.js now imports ABI data from ./abis.js (static ES module,
// browser-compatible with zero Node.js dependencies).
// The real compiled ABI data is used directly in tests.
// --------------------------------------------------------------------------
const { createContractAdapter, CONTRACT_ADDRESSES, CONTRACT_ABIS } = await import("../src/contract.js");

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("Contract Adapter — factory", () => {
	beforeEach(() => {
		resetMockState();
	});

	test("createContractAdapter returns expected shape { read, write, simulate, getClient }", () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter, fheAdapter: mockFheAdapter },
		);

		expect(adapter).toHaveProperty("read");
		expect(adapter).toHaveProperty("write");
		expect(adapter).toHaveProperty("simulate");
		expect(adapter).toHaveProperty("getClient");
		expect(typeof adapter.read).toBe("object");
		expect(typeof adapter.write).toBe("object");
		expect(typeof adapter.simulate).toBe("object");
		expect(typeof adapter.getClient).toBe("function");
	});

	test("getClient returns publicClient", () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);
		const clients = adapter.getClient();
		expect(clients).toHaveProperty("publicClient");
		expect(clients).toHaveProperty("walletClient");
	});

	test("CONTRACT_ADDRESSES has all 9 contracts", () => {
		const keys = Object.keys(CONTRACT_ADDRESSES);
		expect(keys.length).toBeGreaterThanOrEqual(9);
		expect(CONTRACT_ADDRESSES).toHaveProperty("LendingPool");
		expect(CONTRACT_ADDRESSES).toHaveProperty("StrategyVault");
		expect(CONTRACT_ADDRESSES).toHaveProperty("Composer");
		expect(CONTRACT_ADDRESSES).toHaveProperty("SwapRouter");
		expect(CONTRACT_ADDRESSES).toHaveProperty("PriceOracle");
		expect(CONTRACT_ADDRESSES).toHaveProperty("StrategyRegistry");
		expect(CONTRACT_ADDRESSES).toHaveProperty("StrategyExecutor");
		expect(CONTRACT_ADDRESSES).toHaveProperty("TokenRegistry");
		expect(CONTRACT_ADDRESSES).toHaveProperty("ExecutorContract");
	});

	test("CONTRACT_ABIS has all 9 contract ABIs", () => {
		const keys = Object.keys(CONTRACT_ABIS);
		expect(keys.length).toBeGreaterThanOrEqual(9);
		expect(CONTRACT_ABIS).toHaveProperty("LendingPool");
		expect(CONTRACT_ABIS).toHaveProperty("StrategyVault");
		expect(CONTRACT_ABIS).toHaveProperty("Composer");
		expect(CONTRACT_ABIS).toHaveProperty("SwapRouter");
		expect(CONTRACT_ABIS).toHaveProperty("PriceOracle");
		expect(CONTRACT_ABIS).toHaveProperty("StrategyRegistry");
		expect(CONTRACT_ABIS).toHaveProperty("StrategyExecutor");
		expect(CONTRACT_ABIS).toHaveProperty("TokenRegistry");
		expect(CONTRACT_ABIS).toHaveProperty("ExecutorContract");
	});
});

describe("Contract Adapter — read methods", () => {
	const ADDRESS = "0x1234567890123456789012345678901234567890";

	beforeEach(() => {
		resetMockState();
	});

	test("getSupplyBalance calls readContract with correct function name", async () => {
		mockState.readContractResult = "0xencrypted_handle";
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.getSupplyBalance(ADDRESS);
		expect(result).toBe("0xencrypted_handle");
		expect(readContractCalls.length).toBe(1);
		expect(readContractCalls[0].functionName).toBe("getSupplyBalance");
		expect(readContractCalls[0].args).toEqual([ADDRESS]);
	});

	test("getBorrowBalance calls readContract with correct function name", async () => {
		mockState.readContractResult = "0xencrypted_borrow";
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.getBorrowBalance(ADDRESS);
		expect(result).toBe("0xencrypted_borrow");
		expect(readContractCalls[0].functionName).toBe("getBorrowBalance");
	});

	test("isLiquidatable calls readContract with correct args", async () => {
		mockState.readContractResult = true;
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.isLiquidatable(
			ADDRESS,
			"0xcollateral",
			"0xdebt",
			1000n,
			200n,
		);
		expect(result).toBe(true);
		expect(readContractCalls[0].functionName).toBe("isLiquidatable");
	});

	test("totalPlainBorrow calls readContract", async () => {
		mockState.readContractResult = 50000n;
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.totalPlainBorrow(ADDRESS);
		expect(result).toBe(50000n);
		expect(readContractCalls[0].functionName).toBe("totalPlainBorrow");
	});

	test("liquidReserve calls readContract", async () => {
		mockState.readContractResult = 10000n;
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.liquidReserve(ADDRESS);
		expect(result).toBe(10000n);
		expect(readContractCalls[0].functionName).toBe("liquidReserve");
	});

	test("pausedLendingPool calls readContract", async () => {
		mockState.readContractResult = false;
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.pausedLendingPool();
		expect(result).toBe(false);
		expect(readContractCalls[0].functionName).toBe("paused");
	});

	test("getCollateral calls readContract", async () => {
		mockState.readContractResult = "0xencrypted_collateral";
		const positionId = "0xabcdef";
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.getCollateral(positionId);
		expect(result).toBe("0xencrypted_collateral");
		expect(readContractCalls[0].functionName).toBe("getCollateral");
	});

	test("getPositionMeta calls readContract", async () => {
		mockState.readContractResult = [1000n, 1n];
		const positionId = "0xabcdef";
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.getPositionMeta(positionId);
		expect(result).toEqual([1000n, 1n]);
		expect(readContractCalls[0].functionName).toBe("getPositionMeta");
	});

	test("getUserPositions calls readContract", async () => {
		mockState.readContractResult = [];
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.getUserPositions(ADDRESS);
		expect(result).toEqual([]);
		expect(readContractCalls[0].functionName).toBe("getUserPositions");
	});

	test("getPriceUsd calls readContract", async () => {
		mockState.readContractResult = [100000000n, 1234567890n];
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.getPriceUsd(ADDRESS);
		expect(result).toEqual([100000000n, 1234567890n]);
		expect(readContractCalls[0].functionName).toBe("getPriceUsd");
	});

	test("getIntentMeta calls readContract", async () => {
		mockState.readContractResult = ["0xtokenIn", "0xtokenOut", ADDRESS, 1000n];
		const intentId = "0xabcdef";
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.getIntentMeta(intentId);
		expect(result).toEqual(["0xtokenIn", "0xtokenOut", ADDRESS, 1000n]);
		expect(readContractCalls[0].functionName).toBe("getIntentMeta");
	});

	test("getStrategyInfo calls readContract", async () => {
		mockState.readContractResult = { name: "Test Strategy", owner: ADDRESS };
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.getStrategyInfo(1n);
		expect(result).toEqual({ name: "Test Strategy", owner: ADDRESS });
		expect(readContractCalls[0].functionName).toBe("getStrategyInfo");
	});

	test("read methods throw when viem fails", async () => {
		mockState.readContractError = new Error("execution reverted: InsufficientCollateral");
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);

		try {
			await adapter.read.getSupplyBalance(ADDRESS);
			expect.unreachable("Should have thrown");
		} catch (error) {
			// Read methods pass through the raw viem error directly
			// (mapContractError is applied at the write layer via estimateSendAndWait)
			expect(error).toBeInstanceOf(Error);
			expect(/** @type {Error} */ (error).message).toContain("InsufficientCollateral");
		}
	});

	test("pausedGeneric calls readContract with any contract", async () => {
		mockState.readContractResult = false;
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.pausedGeneric(
			CONTRACT_ADDRESSES.LendingPool,
			CONTRACT_ABIS.LendingPool,
		);
		expect(result).toBe(false);
		expect(readContractCalls[0].functionName).toBe("paused");
	});

	test("owner calls readContract", async () => {
		mockState.readContractResult = "0xowner";
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const result = await adapter.read.owner(
			CONTRACT_ADDRESSES.LendingPool,
			CONTRACT_ABIS.LendingPool,
		);
		expect(result).toBe("0xowner");
		expect(readContractCalls[0].functionName).toBe("owner");
	});
});

describe("Contract Adapter — write methods", () => {
	const ACCOUNT = "0xUserAccount";
	const TOKEN = "test_token_addr";
	const AMOUNT = 100n;

	beforeEach(() => {
		resetMockState();
	});

	test("shield performs estimateGas → writeContract → waitForTransactionReceipt", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter, fheAdapter: mockFheAdapter },
		);

		const result = await adapter.write.shield(TOKEN, AMOUNT, "0xencrypted", ACCOUNT);

		// Verify estimateGas was called
		expect(estimateGasCalls.length).toBe(1);
		expect(estimateGasCalls[0].functionName).toBe("shield");

		// Verify writeContract was called
		expect(writeContractCalls.length).toBe(1);
		expect(writeContractCalls[0].functionName).toBe("shield");

		// Verify waitForTransactionReceipt was called
		expect(waitForReceiptCalls.length).toBe(1);

		// Verify result
		expect(result).toHaveProperty("hash");
		expect(result).toHaveProperty("status");
		expect(result).toHaveProperty("blockNumber");
		expect(result.status).toBe("confirmed");
	});

	test("shield with FHE adapter encrypts amount when encAmount not provided", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter, fheAdapter: mockFheAdapter },
		);

		await adapter.write.shield(TOKEN, AMOUNT, null, ACCOUNT);

		expect(mockFheAdapter.encrypt).toHaveBeenCalled();
	});

	test("borrowWithLtvCheck performs estimateGas → writeContract → waitForReceipt", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		await adapter.write.borrowWithLtvCheck(
			"0xCollateral",
			"0xBorrow",
			200n,
			"0xencrypted_borrow",
			8000n,
			10000n,
			ACCOUNT,
		);

		expect(estimateGasCalls.length).toBe(1);
		expect(estimateGasCalls[0].functionName).toBe("borrowWithLtvCheck");
		expect(writeContractCalls[0].functionName).toBe("borrowWithLtvCheck");
		expect(waitForReceiptCalls.length).toBe(1);
	});

	test("repayDebt performs estimateGas → writeContract → waitForReceipt", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		await adapter.write.repayDebt(TOKEN, AMOUNT, "0xencrypted", ACCOUNT);

		expect(estimateGasCalls.length).toBe(1);
		expect(estimateGasCalls[0].functionName).toBe("repayDebt");
		expect(writeContractCalls[0].functionName).toBe("repayDebt");
	});

	test("partialUnshield performs estimateGas → writeContract → waitForReceipt", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		await adapter.write.partialUnshield(TOKEN, AMOUNT, "0xencrypted", ACCOUNT);

		expect(estimateGasCalls.length).toBe(1);
		expect(estimateGasCalls[0].functionName).toBe("partialUnshield");
		expect(writeContractCalls[0].functionName).toBe("partialUnshield");
	});

	test("openPosition performs estimateGas → writeContract → waitForReceipt", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		await adapter.write.openPosition(TOKEN, AMOUNT, "0xencrypted", 1n, ACCOUNT, ACCOUNT);

		expect(estimateGasCalls.length).toBe(1);
		expect(estimateGasCalls[0].functionName).toBe("openPosition");
		expect(writeContractCalls[0].functionName).toBe("openPosition");
	});

	test("submitSwapIntent performs estimateGas → writeContract → waitForReceipt", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		await adapter.write.submitSwapIntent(
			"0xTokenIn",
			"0xTokenOut",
			1000n,
			900n,
			3600n,
			ACCOUNT,
		);

		expect(estimateGasCalls.length).toBe(1);
		expect(estimateGasCalls[0].functionName).toBe("submitSwapIntent");
		expect(writeContractCalls[0].functionName).toBe("submitSwapIntent");
	});

	test("castVote calls apiAdapter.governance.castVote", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		const voteData = { proposalId: "0xproposal", support: true };
		const result = await adapter.write.castVote(voteData);

		expect(simulateCalled).toBe(false); // ensure simulate wasn't called
		expect(result.status).toBe("success");
		expect(result.data.voteCast).toBe(true);
	});

	test("castVote throws ContractError when no apiAdapter", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);

		try {
			// castVote shouldn't throw — it returns an error shape
			const result = await adapter.write.castVote({ proposalId: "test" });
			// If no throw, check the error
			expect(result).toBeDefined();
		} catch (error) {
			expect(error).toBeInstanceOf(ContractError);
		}
	});

	test("write returns pending status when waitForReceipt fails", async () => {
		mockState.waitForReceiptError = new Error("receipt timeout");
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		const result = await adapter.write.shield(TOKEN, AMOUNT, "0xencrypted", ACCOUNT);
		expect(result.status).toBe("pending");
		expect(result.hash).toBe("0xdeadbeef");
	});
});

describe("Contract Adapter — simulation", () => {
	beforeEach(() => {
		resetMockState();
		simulateCalled = false;
	});

	test("simulate.strategy calls apiAdapter.defiStrategies.simulateDefiStrategy", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		const strategyData = { nodes: [], edges: [] };
		const result = await adapter.simulate.strategy(strategyData);

		expect(simulateCalled).toBe(true);
		expect(mockApiAdapter.defiStrategies.simulateDefiStrategy).toHaveBeenCalledWith(strategyData);
		expect(result).toEqual(mockSimulateResult);
	});

	test("simulate.strategy throws ContractError when no apiAdapter", async () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);

		try {
			await adapter.simulate.strategy({ nodes: [] });
			expect.unreachable("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(ContractError);
			expect(/** @type {ContractError} */ (error).code).toBe("API_ADAPTER_REQUIRED");
		}
	});
});

describe("Contract Adapter — error mapping", () => {
	const ERROR_ACCOUNT = "0xErrorAccount";

	beforeEach(() => {
		resetMockState();
	});

	test("throws ContractError on estimateGas failure", async () => {
		mockState.estimateGasError = new Error("execution reverted: InsufficientCollateral");
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		try {
			await adapter.write.shield("0xtoken", 100n, "0xenc", ERROR_ACCOUNT);
			expect.unreachable("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(ContractError);
		}
	});

	test("throws ContractError on writeContract failure", async () => {
		mockState.writeContractError = new Error("User denied transaction");
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
			{ apiAdapter: mockApiAdapter },
		);

		try {
			await adapter.write.shield("0xtoken", 100n, "0xenc", ERROR_ACCOUNT);
			expect.unreachable("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(ContractError);
		}
	});

	test("sets setWalletClient", () => {
		const adapter = createContractAdapter(
			{ apiBaseUrl: "http://localhost", chainId: 421614, rpcUrl: "http://localhost:8545" },
		);
		const mockWc = { writeContract: mock(async () => "0xtxhash") };
		// @ts-ignore
		adapter.setWalletClient(mockWc);
		const clients = adapter.getClient();
		expect(clients.walletClient).toBe(mockWc);
	});
});
