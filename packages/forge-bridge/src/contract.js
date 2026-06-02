/**
 * @file Contract adapter — viem wrappers for all 9 FheForge smart contracts.
 *
 * Provides:
 * - Read wrappers: typed contract read functions via viem publicClient
 * - Write wrappers: encrypt → estimateGas → send → waitForTransactionReceipt pipeline
 * - Simulation: via API adapter POST /defi-strategies/simulate
 * - Error mapping from backend-manifest error codes
 *
 * @typedef {import('./config.js').BridgeConfig} BridgeConfig
 * @typedef {import('./types.js').ContractError} _ContractErrorForJSDoc
 */

import { createPublicClient, createWalletClient, custom, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { CONTRACT_ABIS, CONTRACT_ADDRESSES } from "./abis.js";
import { ContractError } from "./types.js";

/** Re-export ABI and address maps for external access */
export { CONTRACT_ABIS, CONTRACT_ADDRESSES };

// ---------------------------------------------------------------------------
// Error code mapping (from backend-manifest.json)
// Maps contract revert reasons → ContractError codes
// ---------------------------------------------------------------------------

/**
 * Error code mapping per contract.
 * Key = contract name, Value = map of contract error name → bridge error code.
 * @type {Record<string, Record<string, string>>}
 */
const ERROR_CODE_MAP = {
	LendingPool: {
		LtvNumeratorZero: "LTV_NUMERATOR_ZERO",
		LtvDenominatorZero: "LTV_DENOMINATOR_ZERO",
		LtvExceedsHundredPercent: "LTV_EXCEEDS_100_PCT",
		InsufficientCollateral: "INSUFFICIENT_COLLATERAL",
		InsufficientReserve: "INSUFFICIENT_RESERVE",
		OracleNotSet: "ORACLE_NOT_SET",
		WethNotSet: "WETH_NOT_SET",
		LiquidationTooLarge: "LIQUIDATION_TOO_LARGE",
		NotComposer: "NOT_COMPOSER",
		InvalidProof: "INVALID_PROOF",
		FlashLoanNotRepaid: "FLASH_LOAN_NOT_REPAID",
		FlashLoanUnsupportedToken: "FLASH_LOAN_UNSUPPORTED_TOKEN",
		CannotSelfLiquidate: "CANNOT_SELF_LIQUIDATE",
		NotAuthorized: "NOT_AUTHORIZED",
		RevealCooldown: "REVEAL_COOLDOWN",
	},
	StrategyVault: {
		PositionNotFound: "POSITION_NOT_FOUND",
		InvalidStrategyId: "INVALID_STRATEGY_ID",
		NoPosition: "NO_POSITION",
		ExceedsDeposit: "EXCEEDS_DEPOSIT",
		SameBlockClose: "SAME_BLOCK_CLOSE",
		NotPositionOwner: "NOT_POSITION_OWNER",
	},
	SwapRouter: {
		SameToken: "SAME_TOKEN",
		UnknownIntent: "UNKNOWN_INTENT",
		NotCreator: "NOT_INTENT_CREATOR",
		NotExecutor: "NOT_EXECUTOR",
		IntentExpired: "INTENT_EXPIRED",
		ZeroOutput: "ZERO_OUTPUT",
		InsufficientOutput: "INSUFFICIENT_OUTPUT",
		DeadlineTooShort: "DEADLINE_TOO_SHORT",
		DeadlineTooLong: "DEADLINE_TOO_LONG",
	},
	PriceOracle: {
		NoPriceAvailable: "NO_PRICE_AVAILABLE",
	},
	Composer: {
		ZeroAddress: "ZERO_ADDRESS",
		ZeroAmount: "ZERO_AMOUNT",
	},
	StrategyExecutor: {
		ZeroAddress: "ZERO_ADDRESS",
		ZeroAmount: "ZERO_AMOUNT",
	},
};

/**
 * Build a regex that matches any known Solidity revert reason.
 * @returns {RegExp}
 */
function buildErrorPattern() {
	const names = [];
	for (const map of Object.values(ERROR_CODE_MAP)) {
		names.push(...Object.keys(map));
	}
	names.sort((a, b) => b.length - a.length);
	return new RegExp(names.join("|"));
}

const REVERT_REASON_PATTERN = buildErrorPattern();

/**
 * Map a viem contract error to a ContractError.
 *
 * @param {unknown} error - The caught error
 * @param {string} _contractName - Contract identifier (unused, maps from all contracts)
 * @param {string} functionName - The function being called
 * @returns {ContractError} Mapped ContractError
 */
function mapContractError(error, _contractName, functionName) {
	const message = /** @type {Error} */ (error).message || "Unknown contract error";

	const match = message.match(REVERT_REASON_PATTERN);
	if (match) {
		const reason = match[0];
		for (const map of Object.values(ERROR_CODE_MAP)) {
			if (map[reason]) {
				return new ContractError(map[reason], message, true);
			}
		}
	}

	if (message.includes("User denied") || message.includes("user rejected")) {
		return new ContractError("USER_REJECTED", "Transaction was rejected by the user", true);
	}
	if (message.includes("insufficient funds")) {
		return new ContractError("INSUFFICIENT_FUNDS", "Insufficient ETH for gas", false);
	}
	if (
		message.includes("gas required exceeds allowance") ||
		message.includes("intrinsic gas too low")
	) {
		return new ContractError(
			"GAS_ESTIMATION_FAILED",
			`Gas estimation failed for ${functionName}`,
			true,
		);
	}
	if (message.includes("execution reverted")) {
		return new ContractError("EXECUTION_REVERTED", `Transaction reverted: ${message}`, false);
	}
	if (message.includes("network") && message.includes("timeout")) {
		return new ContractError("NETWORK_TIMEOUT", "Network timeout. Check your connection.", true);
	}

	return new ContractError("CONTRACT_ERROR", message, false);
}

// ---------------------------------------------------------------------------
// Transaction lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TransactionResult
 * @property {`0x${string}`} hash - Transaction hash
 * @property {'pending' | 'confirmed' | 'reverted'} status - Transaction status
 * @property {number} [blockNumber] - Block number (confirmed only)
 * @property {import('viem').TransactionReceipt} [receipt] - Full receipt
 */

/**
 * Estimate gas for a contract write, then send and wait for the receipt.
 *
 * @param {import('viem').PublicClient} publicClient
 * @param {import('viem').WalletClient} walletClient
 * @param {`0x${string}`} address - Contract address
 * @param {import('viem').Abi} abi - Contract ABI
 * @param {string} functionName - Function name
 * @param {unknown[]} args - Function arguments
 * @param {`0x${string}`} account - Sender address
 * @returns {Promise<TransactionResult>}
 */
async function estimateSendAndWait(
	publicClient,
	walletClient,
	address,
	abi,
	functionName,
	args,
	account,
) {
	let gas;
	try {
		gas = await publicClient.estimateContractGas({ address, abi, functionName, args, account });
	} catch (error) {
		throw mapContractError(error, "", functionName);
	}

	let hash;
	try {
		hash = await walletClient.writeContract({
			address,
			abi,
			functionName,
			args,
			gas,
			account,
			chain: arbitrumSepolia,
		});
	} catch (error) {
		throw mapContractError(error, "", functionName);
	}

	let receipt;
	try {
		receipt = await publicClient.waitForTransactionReceipt({ hash });
	} catch (_error) {
		return { hash, status: "pending", receipt: undefined };
	}

	return {
		hash,
		status: receipt.status === "success" ? "confirmed" : "reverted",
		blockNumber: Number(receipt.blockNumber),
		receipt,
	};
}

// ---------------------------------------------------------------------------
// Default RPC URL
// ---------------------------------------------------------------------------

const DEFAULT_RPC_URL = "https://sepolia-arbitrum-rpc.publicnode.com";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ContractWriteMethods
 * @property {(token: `0x${string}`, amount: bigint, encAmount: any, account: `0x${string}`) => Promise<TransactionResult>} shield
 * @property {(collateralToken: `0x${string}`, borrowToken: `0x${string}`, borrowAmount: bigint, encBorrowAmount: any, ltvNum: bigint, ltvDen: bigint, account: `0x${string}`) => Promise<TransactionResult>} borrowWithLtvCheck
 * @property {(token: `0x${string}`, amount: bigint, encAmount: any, account: `0x${string}`) => Promise<TransactionResult>} repayDebt
 * @property {(token: `0x${string}`, amount: bigint, encAmount: any, account: `0x${string}`) => Promise<TransactionResult>} partialUnshield
 * @property {(token: `0x${string}`, amount: bigint, encAmount: any, strategyId: bigint, user: `0x${string}`, account: `0x${string}`) => Promise<TransactionResult>} openPosition
 * @property {(tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, minAmountOut: bigint, deadlineOffset: bigint, account: `0x${string}`) => Promise<TransactionResult>} submitSwapIntent
 * @property {(voteData: any) => Promise<any>} castVote
 */

/**
 * @typedef {Object} ContractSimulateMethods
 * @property {(data: unknown) => Promise<{status: string, data: any, error: import('./types.js').ApiError | null}>} strategy
 */

/**
 * @typedef {Object} ContractAdapter
 * @property {object} read - Typed read function wrappers
 * @property {ContractWriteMethods} write - Typed write function wrappers
 * @property {ContractSimulateMethods} simulate - Simulation via API adapter
 * @property {() => { publicClient: import('viem').PublicClient, walletClient: import('viem').WalletClient | null }} getClient
 * @property {(wc: import('viem').WalletClient) => void} setWalletClient
 */

/**
 * Create a contract adapter with viem publicClient + walletClient,
 * typed read/write wrappers, and simulation support.
 *
 * @param {BridgeConfig} config - Bridge configuration
 * @param {object} [options] - Optional adapters for composition
 * @param {import('./api.js').ApiAdapter} [options.apiAdapter] - API adapter for simulation
 * @param {import('./fhe.js').FheAdapter} [options.fheAdapter] - FHE adapter for encryption
 * @returns {ContractAdapter} Contract adapter
 */
export function createContractAdapter(config, options = {}) {
	const { apiAdapter, fheAdapter: _fheAdapter } = options;
	const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL;

	/** @type {import('viem').PublicClient} */
	const publicClient = createPublicClient({
		chain: arbitrumSepolia,
		transport: http(rpcUrl),
	});

	/** @type {import('viem').WalletClient | null} */
	let _walletClient = null;

	// ── Read methods ──────────────────────────────────────────────────────

	const read = {
		// ── LendingPool ──

		/**
		 * @param {`0x${string}`} token
		 * @returns {Promise<any>}
		 */
		getSupplyBalance: (token) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.LendingPool,
				abi: CONTRACT_ABIS.LendingPool,
				functionName: "getSupplyBalance",
				args: [token],
			}),

		/**
		 * @param {`0x${string}`} token
		 * @returns {Promise<any>}
		 */
		getBorrowBalance: (token) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.LendingPool,
				abi: CONTRACT_ABIS.LendingPool,
				functionName: "getBorrowBalance",
				args: [token],
			}),

		/**
		 * @param {`0x${string}`} user
		 * @param {`0x${string}`} collateralToken
		 * @param {`0x${string}`} debtToken
		 * @param {bigint} collateralAmount
		 * @param {bigint} borrowAmount
		 * @returns {Promise<any>}
		 */
		isLiquidatable: (user, collateralToken, debtToken, collateralAmount, borrowAmount) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.LendingPool,
				abi: CONTRACT_ABIS.LendingPool,
				functionName: "isLiquidatable",
				args: [user, collateralToken, debtToken, collateralAmount, borrowAmount],
			}),

		/**
		 * @param {`0x${string}`} token
		 * @returns {Promise<any>}
		 */
		totalPlainBorrow: (token) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.LendingPool,
				abi: CONTRACT_ABIS.LendingPool,
				functionName: "totalPlainBorrow",
				args: [token],
			}),

		/**
		 * @param {`0x${string}`} token
		 * @returns {Promise<any>}
		 */
		liquidReserve: (token) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.LendingPool,
				abi: CONTRACT_ABIS.LendingPool,
				functionName: "liquidReserve",
				args: [token],
			}),

		/**
		 * @returns {Promise<any>}
		 */
		pausedLendingPool: () =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.LendingPool,
				abi: CONTRACT_ABIS.LendingPool,
				functionName: "paused",
				args: [],
			}),

		// ── StrategyVault ──

		/**
		 * @param {`0x${string}`} positionId
		 * @returns {Promise<any>}
		 */
		getCollateral: (positionId) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.StrategyVault,
				abi: CONTRACT_ABIS.StrategyVault,
				functionName: "getCollateral",
				args: [positionId],
			}),

		/**
		 * @param {`0x${string}`} positionId
		 * @returns {Promise<any>}
		 */
		getPositionMeta: (positionId) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.StrategyVault,
				abi: CONTRACT_ABIS.StrategyVault,
				functionName: "getPositionMeta",
				args: [positionId],
			}),

		/**
		 * @param {`0x${string}`} user
		 * @returns {Promise<any>}
		 */
		getUserPositions: (user) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.StrategyVault,
				abi: CONTRACT_ABIS.StrategyVault,
				functionName: "getUserPositions",
				args: [user],
			}),

		// ── PriceOracle ──

		/**
		 * @param {`0x${string}`} token
		 * @returns {Promise<any>}
		 */
		getPriceUsd: (token) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.PriceOracle,
				abi: CONTRACT_ABIS.PriceOracle,
				functionName: "getPriceUsd",
				args: [token],
			}),

		/**
		 * @param {`0x${string}`} token
		 * @returns {Promise<any>}
		 */
		getPriceWithFallback: (token) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.PriceOracle,
				abi: CONTRACT_ABIS.PriceOracle,
				functionName: "getPriceWithFallback",
				args: [token],
			}),

		/**
		 * @param {`0x${string}`} token
		 * @param {bigint} amount
		 * @returns {Promise<any>}
		 */
		convertToUsd: (token, amount) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.PriceOracle,
				abi: CONTRACT_ABIS.PriceOracle,
				functionName: "convertToUsd",
				args: [token, amount],
			}),

		/**
		 * @param {`0x${string}`} token
		 * @returns {Promise<any>}
		 */
		isTokenSupported: (token) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.PriceOracle,
				abi: CONTRACT_ABIS.PriceOracle,
				functionName: "isSupported",
				args: [token],
			}),

		// ── SwapRouter ──

		/**
		 * @param {`0x${string}`} intentId
		 * @returns {Promise<any>}
		 */
		getIntentMeta: (intentId) =>
			publicClient.readContract({
				address: CONTRACT_ADDRESSES.SwapRouter,
				abi: CONTRACT_ABIS.SwapRouter,
				functionName: "getIntentMeta",
				args: [intentId],
			}),

		// ── StrategyRegistry ──

		/**
		 * @param {bigint} strategyId
		 * @returns {Promise<any>}
		 */
		getStrategyInfo: (strategyId) =>
			publicClient
				.readContract({
					address: CONTRACT_ADDRESSES.StrategyRegistry,
					abi: CONTRACT_ABIS.StrategyRegistry,
					functionName: "getStrategyInfo",
					args: [strategyId],
				})
				.catch(() =>
					publicClient.readContract({
						address: CONTRACT_ADDRESSES.StrategyRegistry,
						abi: CONTRACT_ABIS.StrategyRegistry,
						functionName: "strategies",
						args: [strategyId],
					}),
				),

		/**
		 * @param {bigint} strategyId
		 * @returns {Promise<any>}
		 */
		getStrategyUsers: (strategyId) =>
			publicClient
				.readContract({
					address: CONTRACT_ADDRESSES.StrategyRegistry,
					abi: CONTRACT_ABIS.StrategyRegistry,
					functionName: "getStrategyUsers",
					args: [strategyId],
				})
				.catch(() =>
					publicClient.readContract({
						address: CONTRACT_ADDRESSES.StrategyRegistry,
						abi: CONTRACT_ABIS.StrategyRegistry,
						functionName: "getVaultPositions",
						args: [strategyId],
					}),
				),

		// ── Generic ──

		/**
		 * Check if a specific contract is paused.
		 * @param {`0x${string}`} contractAddress
		 * @param {import('viem').Abi} abi
		 * @returns {Promise<any>}
		 */
		pausedGeneric: (contractAddress, abi) =>
			publicClient.readContract({
				address: contractAddress,
				abi,
				functionName: "paused",
				args: [],
			}),

		/**
		 * Get the owner of a specific contract.
		 * @param {`0x${string}`} contractAddress
		 * @param {import('viem').Abi} abi
		 * @returns {Promise<any>}
		 */
		owner: (contractAddress, abi) =>
			publicClient.readContract({
				address: contractAddress,
				abi,
				functionName: "owner",
				args: [],
			}),
	};

	// ── Write methods ─────────────────────────────────────────────────────

	const write = {
		// ── LendingPool ──

		/**
		 * Supply tokens with encrypted amount.
		 * Tx lifecycle: encrypt (if FHE) → estimateGas → send → waitForReceipt.
		 * @type {(token: `0x${string}`, amount: bigint, encAmount: any, account: `0x${string}`) => Promise<TransactionResult>}
		 */
		shield: async (token, amount, encAmount, account) => {
			let finalEncAmount = encAmount;
			if (!finalEncAmount && _fheAdapter && typeof _fheAdapter.encrypt === "function") {
				finalEncAmount = await _fheAdapter.encrypt(String(amount), token);
			}
			const wc = getWc();
			return estimateSendAndWait(
				publicClient,
				wc,
				CONTRACT_ADDRESSES.LendingPool,
				CONTRACT_ABIS.LendingPool,
				"shield",
				[token, amount, finalEncAmount],
				account,
			);
		},

		/**
		 * Borrow with FHE LTV check computed entirely on ciphertext.
		 * @type {(collateralToken: `0x${string}`, borrowToken: `0x${string}`, borrowAmount: bigint, encBorrowAmount: any, ltvNum: bigint, ltvDen: bigint, account: `0x${string}`) => Promise<TransactionResult>}
		 */
		borrowWithLtvCheck: async (
			collateralToken,
			borrowToken,
			borrowAmount,
			encBorrowAmount,
			ltvNum,
			ltvDen,
			account,
		) => {
			let finalEnc = encBorrowAmount;
			if (!finalEnc && _fheAdapter && typeof _fheAdapter.encrypt === "function") {
				finalEnc = await _fheAdapter.encrypt(String(borrowAmount), borrowToken);
			}
			const wc = getWc();
			return estimateSendAndWait(
				publicClient,
				wc,
				CONTRACT_ADDRESSES.LendingPool,
				CONTRACT_ABIS.LendingPool,
				"borrowWithLtvCheck",
				[collateralToken, borrowToken, borrowAmount, finalEnc, ltvNum, ltvDen],
				account,
			);
		},

		/**
		 * Repay encrypted debt.
		 * @type {(token: `0x${string}`, amount: bigint, encAmount: any, account: `0x${string}`) => Promise<TransactionResult>}
		 */
		repayDebt: async (token, amount, encAmount, account) => {
			let finalEnc = encAmount;
			if (!finalEnc && _fheAdapter && typeof _fheAdapter.encrypt === "function") {
				finalEnc = await _fheAdapter.encrypt(String(amount), token);
			}
			const wc = getWc();
			return estimateSendAndWait(
				publicClient,
				wc,
				CONTRACT_ADDRESSES.LendingPool,
				CONTRACT_ABIS.LendingPool,
				"repayDebt",
				[token, amount, finalEnc],
				account,
			);
		},

		/**
		 * Partial withdrawal of supplied tokens.
		 * @type {(token: `0x${string}`, amount: bigint, encAmount: any, account: `0x${string}`) => Promise<TransactionResult>}
		 */
		partialUnshield: async (token, amount, encAmount, account) => {
			let finalEnc = encAmount;
			if (!finalEnc && _fheAdapter && typeof _fheAdapter.encrypt === "function") {
				finalEnc = await _fheAdapter.encrypt(String(amount), token);
			}
			const wc = getWc();
			return estimateSendAndWait(
				publicClient,
				wc,
				CONTRACT_ADDRESSES.LendingPool,
				CONTRACT_ABIS.LendingPool,
				"partialUnshield",
				[token, amount, finalEnc],
				account,
			);
		},

		// ── StrategyVault ──

		/**
		 * Open a vault position with encrypted collateral.
		 * @type {(token: `0x${string}`, amount: bigint, encAmount: any, strategyId: bigint, user: `0x${string}`, account: `0x${string}`) => Promise<TransactionResult>}
		 */
		openPosition: async (token, amount, encAmount, strategyId, user, account) => {
			let finalEnc = encAmount;
			if (!finalEnc && _fheAdapter && typeof _fheAdapter.encrypt === "function") {
				finalEnc = await _fheAdapter.encrypt(String(amount), token);
			}
			const wc = getWc();
			return estimateSendAndWait(
				publicClient,
				wc,
				CONTRACT_ADDRESSES.StrategyVault,
				CONTRACT_ABIS.StrategyVault,
				"openPosition",
				[token, amount, finalEnc, strategyId, user],
				account,
			);
		},

		// ── SwapRouter ──

		/**
		 * Submit a swap intent (no FHE encryption needed).
		 * @type {(tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, minAmountOut: bigint, deadlineOffset: bigint, account: `0x${string}`) => Promise<TransactionResult>}
		 */
		submitSwapIntent: async (
			tokenIn,
			tokenOut,
			amountIn,
			minAmountOut,
			deadlineOffset,
			account,
		) => {
			const wc = getWc();
			return estimateSendAndWait(
				publicClient,
				wc,
				CONTRACT_ADDRESSES.SwapRouter,
				CONTRACT_ABIS.SwapRouter,
				"submitSwapIntent",
				[tokenIn, tokenOut, amountIn, minAmountOut, deadlineOffset],
				account,
			);
		},

		// ── Governance (via API adapter) ──

		/**
		 * Cast a vote via the governance API.
		 * @type {(voteData: any) => Promise<any>}
		 */
		castVote: async (voteData) => {
			if (!apiAdapter?.governance?.castVote) {
				throw new ContractError(
					"API_ADAPTER_REQUIRED",
					"API adapter with governance.castVote is required for voting",
				);
			}
			return apiAdapter.governance.castVote(voteData);
		},
	};

	// ── Simulation methods ────────────────────────────────────────────────

	const simulate = {
		/**
		 * Simulate a DeFi strategy via the API adapter (POST /defi-strategies/simulate).
		 * @type {(data: unknown) => Promise<{status: string, data: any, error: import('./types.js').ApiError | null}>}
		 */
		strategy: async (data) => {
			if (!apiAdapter?.defiStrategies?.simulateDefiStrategy) {
				throw new ContractError(
					"API_ADAPTER_REQUIRED",
					"API adapter with defiStrategies.simulateDefiStrategy is required for simulation",
				);
			}
			return apiAdapter.defiStrategies.simulateDefiStrategy(data);
		},
	};

	/**
	 * Get or lazily create a wallet client using window.ethereum.
	 * @returns {import('viem').WalletClient}
	 */
	function getWc() {
		if (_walletClient) return _walletClient;
		if (typeof window !== "undefined" && /** @type {any} */ (window).ethereum) {
			_walletClient = createWalletClient({
				chain: arbitrumSepolia,
				transport: custom(/** @type {any} */ (window).ethereum),
			});
			return _walletClient;
		}
		throw new ContractError(
			"WALLET_UNAVAILABLE",
			"No wallet client available. Connect a wallet (MetaMask/Rabby) or provide a wallet client.",
		);
	}

	return {
		read,
		write,
		simulate,

		/** @returns {{ publicClient: import('viem').PublicClient, walletClient: import('viem').WalletClient | null }} */
		getClient: () => ({ publicClient, walletClient: _walletClient }),

		/** @param {import('viem').WalletClient} wc */
		setWalletClient(wc) {
			_walletClient = wc;
		},
	};
}
