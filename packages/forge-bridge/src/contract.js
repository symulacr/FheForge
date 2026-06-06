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

import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { CONTRACT_ABIS, CONTRACT_ADDRESSES } from './abis.js';
import { ContractError } from './types.js';

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
    LtvNumeratorZero: 'LTV_NUMERATOR_ZERO',
    LtvDenominatorZero: 'LTV_DENOMINATOR_ZERO',
    LtvExceedsHundredPercent: 'LTV_EXCEEDS_100_PCT',
    InsufficientCollateral: 'INSUFFICIENT_COLLATERAL',
    InsufficientReserve: 'INSUFFICIENT_RESERVE',
    OracleNotSet: 'ORACLE_NOT_SET',
    WethNotSet: 'WETH_NOT_SET',
    LiquidationTooLarge: 'LIQUIDATION_TOO_LARGE',
    NotComposer: 'NOT_COMPOSER',
    InvalidProof: 'INVALID_PROOF',
    FlashLoanNotRepaid: 'FLASH_LOAN_NOT_REPAID',
    FlashLoanUnsupportedToken: 'FLASH_LOAN_UNSUPPORTED_TOKEN',
    CannotSelfLiquidate: 'CANNOT_SELF_LIQUIDATE',
    NotAuthorized: 'NOT_AUTHORIZED',
    RevealCooldown: 'REVEAL_COOLDOWN',
  },
  StrategyVault: {
    PositionNotFound: 'POSITION_NOT_FOUND',
    InvalidStrategyId: 'INVALID_STRATEGY_ID',
    NoPosition: 'NO_POSITION',
    ExceedsDeposit: 'EXCEEDS_DEPOSIT',
    SameBlockClose: 'SAME_BLOCK_CLOSE',
    NotPositionOwner: 'NOT_POSITION_OWNER',
  },
  SwapRouter: {
    SameToken: 'SAME_TOKEN',
    UnknownIntent: 'UNKNOWN_INTENT',
    NotCreator: 'NOT_INTENT_CREATOR',
    NotExecutor: 'NOT_EXECUTOR',
    IntentExpired: 'INTENT_EXPIRED',
    ZeroOutput: 'ZERO_OUTPUT',
    InsufficientOutput: 'INSUFFICIENT_OUTPUT',
    DeadlineTooShort: 'DEADLINE_TOO_SHORT',
    DeadlineTooLong: 'DEADLINE_TOO_LONG',
  },
  PriceOracle: {
    NoPriceAvailable: 'NO_PRICE_AVAILABLE',
  },
  Composer: {
    ZeroAddress: 'ZERO_ADDRESS',
    ZeroAmount: 'ZERO_AMOUNT',
  },
  StrategyExecutor: {
    ZeroAddress: 'ZERO_ADDRESS',
    ZeroAmount: 'ZERO_AMOUNT',
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
  return new RegExp(names.join('|'));
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
  const message = /** @type {Error} */ (error).message || 'Unknown contract error';

  const match = message.match(REVERT_REASON_PATTERN);
  if (match) {
    const reason = match[0];
    for (const map of Object.values(ERROR_CODE_MAP)) {
      if (map[reason]) {
        return new ContractError(map[reason], message, true);
      }
    }
  }

  if (message.includes('User denied') || message.includes('user rejected')) {
    return new ContractError('USER_REJECTED', 'Transaction was rejected by the user', true);
  }
  if (message.includes('insufficient funds')) {
    return new ContractError('INSUFFICIENT_FUNDS', 'Insufficient ETH for gas', false);
  }
  if (
    message.includes('gas required exceeds allowance') ||
    message.includes('intrinsic gas too low')
  ) {
    return new ContractError(
      'GAS_ESTIMATION_FAILED',
      `Gas estimation failed for ${functionName}`,
      true,
    );
  }
  if (message.includes('execution reverted')) {
    return new ContractError('EXECUTION_REVERTED', `Transaction reverted: ${message}`, false);
  }
  if (message.includes('network') && message.includes('timeout')) {
    return new ContractError('NETWORK_TIMEOUT', 'Network timeout. Check your connection.', true);
  }

  return new ContractError('CONTRACT_ERROR', message, false);
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
    throw mapContractError(error, '', functionName);
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
    const bridgeBus =
      typeof window !== 'undefined' ? /** @type {any} */ (window).__bridgeBus : null;
    if (bridgeBus) {
      bridgeBus.set('transaction:submitted', { hash, functionName });
    }
  } catch (error) {
    throw mapContractError(error, '', functionName);
  }

  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } catch (_error) {
    throw new Error(
      `Transaction ${hash} submitted but confirmation timed out. Check block explorer.`,
    );
  }

  const status = receipt.status === 'success' ? 'confirmed' : 'reverted';
  const bridgeBus = typeof window !== 'undefined' ? /** @type {any} */ (window).__bridgeBus : null;
  if (bridgeBus) {
    bridgeBus.set(status === 'confirmed' ? 'transaction:confirmed' : 'transaction:failed', {
      hash,
      functionName,
      status,
    });
  }

  return {
    hash,
    status,
    blockNumber: Number(receipt.blockNumber),
    receipt,
  };
}

// ---------------------------------------------------------------------------
// Default RPC URL
// ---------------------------------------------------------------------------

const DEFAULT_RPC_URL = 'https://sepolia-arbitrum-rpc.publicnode.com';

/** Minimal ERC20 ABI for token reads used by DataFetcher. */
const ERC20_READ_ABI = [
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ContractWriteMethods
 * @property {(params: object, account: `0x${string}`) => Promise<TransactionResult>} composerOpenPosition
 * @property {(tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, minAmountOut: bigint, deadlineOffset: bigint, account: `0x${string}`) => Promise<TransactionResult>} submitSwapIntent
 * @property {(token: `0x${string}`, amount: bigint, account: `0x${string}`) => Promise<TransactionResult & {commitId: string, ctHash: bigint | undefined}>} shieldCommit
 * @property {(token: `0x${string}`, commitId: string, ctHash: string, account: `0x${string}`) => Promise<TransactionResult>} shieldExecute
 * @property {(collateralToken: `0x${string}`, borrowToken: `0x${string}`, amount: bigint, ltvNum: bigint, ltvDen: bigint, account: `0x${string}`) => Promise<TransactionResult & {commitId: string, ctHash: bigint | undefined}>} borrowCommit
 * @property {(commitId: string, ctHash: string, account: `0x${string}`) => Promise<TransactionResult>} borrowExecute
 * @property {(token: `0x${string}`, amount: bigint, account: `0x${string}`) => Promise<TransactionResult & {commitId: string, ctHash: bigint | undefined}>} repayCommit
 * @property {(token: `0x${string}`, commitId: string, ctHash: string, account: `0x${string}`) => Promise<TransactionResult>} repayExecute
 * @property {(token: `0x${string}`, amount: bigint, account: `0x${string}`) => Promise<TransactionResult & {commitId: string, ctHash: bigint | undefined}>} withdrawCommit
 * @property {(token: `0x${string}`, commitId: string, ctHash: string, account: `0x${string}`) => Promise<TransactionResult>} withdrawExecute
 * @property {(account: `0x${string}`) => Promise<{txHash: null, status: 'no-op'}>} settlePosition
 * @property {(borrower: `0x${string}`, collateralToken: `0x${string}`, debtToken: `0x${string}`, debtToCover: bigint, debtHandle: string, supplyHandle: string, account: `0x${string}`) => Promise<TransactionResult>} liquidateWithProof
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
        functionName: 'getSupplyBalance',
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
        functionName: 'getBorrowBalance',
        args: [token],
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
        functionName: 'getCollateral',
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
        functionName: 'getPositionMeta',
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
        functionName: 'getUserPositions',
        args: [user],
      }),

    // ── SwapRouter ──

    // ── TokenRegistry ──

    /**
     * @returns {Promise<any>}
     */
    getLendableTokens: () =>
      publicClient.readContract({
        address: CONTRACT_ADDRESSES.TokenRegistry,
        abi: CONTRACT_ABIS.TokenRegistry,
        functionName: 'getLendableTokens',
        args: [],
      }),

    // ── ERC20 ──

    /**
     * @param {`0x${string}`} token
     * @param {`0x${string}`} owner
     * @param {`0x${string}`} spender
     * @returns {Promise<any>}
     */
    erc20Allowance: (token, owner, spender) =>
      publicClient.readContract({
        address: token,
        abi: ERC20_READ_ABI,
        functionName: 'allowance',
        args: [owner, spender],
      }),
  };

  // ── Write methods ─────────────────────────────────────────────────────

  const write = {
    // ── LendingPool commit-reveal pairs ──────────────────────────────

    /**
     * Commit phase: encrypt amount and call shield(token, encAmount).
     * Returns { ...result, commitId } extracted from receipt logs.
     * @type {(token: `0x${string}`, amount: bigint, account: `0x${string}`) => Promise<TransactionResult & {commitId: string}>}
     */
    shieldCommit: async (token, amount, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError('INVALID_AMOUNT', 'Amount must be greater than zero');
      if (!token || token === '0x0000000000000000000000000000000000000000')
        throw new ContractError('INVALID_TOKEN', 'Invalid token address');
      const encAmount =
        _fheAdapter && typeof _fheAdapter.encrypt === 'function'
          ? await _fheAdapter.encrypt(String(amount), token)
          : undefined;
      const ctHash = encAmount?.ctHash ?? encAmount?.handle ?? undefined;
      if (!ctHash) console.warn('[bridge] encrypt() returned no ctHash/handle:', encAmount);
      const wc = getWc();
      const result = await estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'shield',
        [token, encAmount],
        account,
      );
      let commitId = '';
      if (result.receipt?.logs) {
        for (const log of result.receipt.logs) {
          if (log.topics?.[3]) {
            commitId = log.topics[3];
          }
        }
      }
      return { ...result, commitId, ctHash };
    },

    /**
     * Execute phase: decrypt handle, then call executeShield(token, commitId, plaintext, signature).
     * @type {(token: `0x${string}`, commitId: string, ctHash: string, account: `0x${string}`) => Promise<TransactionResult>}
     */
    shieldExecute: async (token, commitId, ctHash, account) => {
      const { plaintext, signature } = await _fheAdapter.decryptForExecute(ctHash);
      const wc = getWc();
      return estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'executeShield',
        [token, commitId, BigInt(plaintext), signature],
        account,
      );
    },

    /**
     * Commit phase: encrypt amount and call commitBorrow(collateralToken, borrowToken, encAmount, ltvNum, ltvDen).
     * Returns { ...result, commitId } extracted from receipt logs.
     * @type {(collateralToken: `0x${string}`, borrowToken: `0x${string}`, amount: bigint, ltvNum: bigint, ltvDen: bigint, account: `0x${string}`) => Promise<TransactionResult & {commitId: string}>}
     */
    borrowCommit: async (collateralToken, borrowToken, amount, ltvNum, ltvDen, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError('INVALID_AMOUNT', 'Amount must be greater than zero');
      if (!collateralToken || collateralToken === '0x0000000000000000000000000000000000000000')
        throw new ContractError('INVALID_TOKEN', 'Invalid token address');
      const encAmount =
        _fheAdapter && typeof _fheAdapter.encrypt === 'function'
          ? await _fheAdapter.encrypt(String(amount), borrowToken)
          : undefined;
      const ctHash = encAmount?.ctHash ?? encAmount?.handle ?? undefined;
      if (!ctHash) console.warn('[bridge] encrypt() returned no ctHash/handle:', encAmount);
      const wc = getWc();
      const result = await estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'commitBorrow',
        [collateralToken, borrowToken, encAmount, ltvNum, ltvDen],
        account,
      );
      let commitId = '';
      if (result.receipt?.logs) {
        for (const log of result.receipt.logs) {
          if (log.topics?.[3]) {
            commitId = log.topics[3];
          }
        }
      }
      return { ...result, commitId, ctHash };
    },

    /**
     * Execute phase: decrypt handle, then call executeBorrow(commitId, plaintext, signature).
     * @type {(commitId: string, ctHash: string, account: `0x${string}`) => Promise<TransactionResult>}
     */
    borrowExecute: async (commitId, ctHash, account) => {
      const { plaintext, signature } = await _fheAdapter.decryptForExecute(ctHash);
      const wc = getWc();
      return estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'executeBorrow',
        [commitId, BigInt(plaintext), signature],
        account,
      );
    },

    /**
     * Commit phase: encrypt amount and call repay(token, encAmount).
     * Returns { ...result, commitId } extracted from receipt logs.
     * @type {(token: `0x${string}`, amount: bigint, account: `0x${string}`) => Promise<TransactionResult & {commitId: string}>}
     */
    repayCommit: async (token, amount, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError('INVALID_AMOUNT', 'Amount must be greater than zero');
      if (!token || token === '0x0000000000000000000000000000000000000000')
        throw new ContractError('INVALID_TOKEN', 'Invalid token address');
      const encAmount =
        _fheAdapter && typeof _fheAdapter.encrypt === 'function'
          ? await _fheAdapter.encrypt(String(amount), token)
          : undefined;
      const ctHash = encAmount?.ctHash ?? encAmount?.handle ?? undefined;
      if (!ctHash) console.warn('[bridge] encrypt() returned no ctHash/handle:', encAmount);
      const wc = getWc();
      const result = await estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'repay',
        [token, encAmount],
        account,
      );
      let commitId = '';
      if (result.receipt?.logs) {
        for (const log of result.receipt.logs) {
          if (log.topics?.[3]) {
            commitId = log.topics[3];
          }
        }
      }
      return { ...result, commitId, ctHash };
    },

    /**
     * Execute phase: decrypt handle, then call executeRepay(token, commitId, plaintext, signature).
     * @type {(token: `0x${string}`, commitId: string, ctHash: string, account: `0x${string}`) => Promise<TransactionResult>}
     */
    repayExecute: async (token, commitId, ctHash, account) => {
      const { plaintext, signature } = await _fheAdapter.decryptForExecute(ctHash);
      const wc = getWc();
      return estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'executeRepay',
        [token, commitId, BigInt(plaintext), signature],
        account,
      );
    },

    /**
     * Commit phase: encrypt amount and call withdraw(token, encAmount).
     * Returns { ...result, commitId } extracted from receipt logs.
     * @type {(token: `0x${string}`, amount: bigint, account: `0x${string}`) => Promise<TransactionResult & {commitId: string}>}
     */
    withdrawCommit: async (token, amount, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError('INVALID_AMOUNT', 'Amount must be greater than zero');
      if (!token || token === '0x0000000000000000000000000000000000000000')
        throw new ContractError('INVALID_TOKEN', 'Invalid token address');
      const encAmount =
        _fheAdapter && typeof _fheAdapter.encrypt === 'function'
          ? await _fheAdapter.encrypt(String(amount), token)
          : undefined;
      const ctHash = encAmount?.ctHash ?? encAmount?.handle ?? undefined;
      if (!ctHash) console.warn('[bridge] encrypt() returned no ctHash/handle:', encAmount);
      const wc = getWc();
      const result = await estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'withdraw',
        [token, encAmount],
        account,
      );
      let commitId = '';
      if (result.receipt?.logs) {
        for (const log of result.receipt.logs) {
          if (log.topics?.[3]) {
            commitId = log.topics[3];
          }
        }
      }
      return { ...result, commitId, ctHash };
    },

    /**
     * Execute phase: decrypt handle, then call executeWithdraw(token, commitId, plaintext, signature).
     * @type {(token: `0x${string}`, commitId: string, ctHash: string, account: `0x${string}`) => Promise<TransactionResult>}
     */
    withdrawExecute: async (token, commitId, ctHash, account) => {
      const { plaintext, signature } = await _fheAdapter.decryptForExecute(ctHash);
      const wc = getWc();
      return estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'executeWithdraw',
        [token, commitId, BigInt(plaintext), signature],
        account,
      );
    },

    // ── Composer ──

    /**
     * Open a multi-step leveraged strategy via the Composer contract.
     * Orchestrates vault + pool + swap in a single atomic transaction.
     * @param {{strategyName: string, workflowHash: string, collateralAmount: bigint, poolSupplyAmount: bigint, poolBorrowAmount: bigint, swapDeadlineOffset: bigint, strategyId: bigint, swapAmountIn: bigint, swapMinOut: bigint, collateralToken: `0x${string}`, borrowToken: `0x${string}`, swapTokenOut: `0x${string}`, ltvNum: bigint, ltvDen: bigint, useOracleBorrow: boolean, apyTarget: number, loopCount: number}} params
     * @param {`0x${string}`} account
     * @returns {Promise<TransactionResult>}
     */
    composerOpenPosition: async (params, account) => {
      const EMPTY_ENC = { ctHash: 0n, securityZone: 0, utype: 0, signature: '0x' };
      let collateralEnc = EMPTY_ENC;
      let supplyEnc = EMPTY_ENC;
      let borrowEnc = EMPTY_ENC;

      if (_fheAdapter && typeof _fheAdapter.encrypt === 'function') {
        const encPromises = [];
        if (params.collateralAmount > 0n) {
          encPromises.push(
            _fheAdapter
              .encrypt(String(params.collateralAmount), params.collateralToken)
              .then((h) => {
                collateralEnc = h;
              }),
          );
        }
        if (params.poolSupplyAmount > 0n) {
          encPromises.push(
            _fheAdapter
              .encrypt(String(params.poolSupplyAmount), params.collateralToken)
              .then((h) => {
                supplyEnc = h;
              }),
          );
        }
        if (params.poolBorrowAmount > 0n) {
          encPromises.push(
            _fheAdapter.encrypt(String(params.poolBorrowAmount), params.borrowToken).then((h) => {
              borrowEnc = h;
            }),
          );
        }
        await Promise.all(encPromises);
      }

      const wc = getWc();
      return estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.Composer,
        CONTRACT_ABIS.Composer,
        'openPosition',
        [params, { collateral: collateralEnc, supplyEnc, borrowEnc }],
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
        'submitSwapIntent',
        [tokenIn, tokenOut, amountIn, minAmountOut, deadlineOffset],
        account,
      );
    },

    // ── ERC20 ──

    /**
     * Approve a spender for max uint256 on an ERC20 token.
     * @type {(token: `0x${string}`, spender: `0x${string}`, account: `0x${string}`) => Promise<TransactionResult>}
     */
    erc20Approve: async (token, spender, account) => {
      const wc = getWc();
      return estimateSendAndWait(
        publicClient,
        wc,
        token,
        ERC20_READ_ABI,
        'approve',
        [spender, 2n ** 256n - 1n],
        account,
      );
    },

    // ── StrategyVault ──

    /**
     * Deposit into a strategy vault.
     * Encrypts the amount via FHE then calls
     * StrategyVault.openPosition(token, amount, encAmount, strategyId, user).
     *
     * @type {(token: `0x${string}`, amount: bigint, strategyId: bigint, account: `0x${string}`) => Promise<TransactionResult>}
     */
    depositVault: async (token, amount, strategyId, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError('INVALID_AMOUNT', 'Amount must be greater than zero');
      if (!token || token === '0x0000000000000000000000000000000000000000')
        throw new ContractError('INVALID_TOKEN', 'Invalid token address');
      const encAmount =
        _fheAdapter && typeof _fheAdapter.encrypt === 'function'
          ? await _fheAdapter.encrypt(String(amount), token)
          : undefined;
      const wc = getWc();
      return estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.StrategyVault,
        CONTRACT_ABIS.StrategyVault,
        'openPosition',
        [token, amount, encAmount, strategyId, account],
        account,
      );
    },

    // ── Settle (no-op for FHE) ──

    /**
     * No-op settle for FHE. Present so builder-workspace can call
     * bridge.contract.write.settlePosition() without checking existence.
     * @param {`0x${string}`} _account
     * @returns {Promise<{txHash: null, status: 'no-op'}>}
     */
    settlePosition: async (_account) => {
      console.log('[bridge] settlePosition (no-op for FHE)');
      return { txHash: null, status: 'no-op' };
    },

    /**
     * Liquidate an undercollateralized position.
     * Decrypts both the borrower's debt and supply balance handles via CoFHE,
     * then calls LendingPool.liquidateWithProof with the signed proofs.
     *
     * @type {(borrower: `0x${string}`, collateralToken: `0x${string}`, debtToken: `0x${string}`, debtToCover: bigint, debtHandle: string, supplyHandle: string, account: `0x${string}`) => Promise<TransactionResult>}
     */
    liquidateWithProof: async (
      borrower,
      collateralToken,
      debtToken,
      debtToCover,
      debtHandle,
      supplyHandle,
      account,
    ) => {
      if (!borrower || borrower === '0x0000000000000000000000000000000000000000')
        throw new ContractError('INVALID_ADDRESS', 'Invalid borrower address');
      if (!collateralToken || collateralToken === '0x0000000000000000000000000000000000000000')
        throw new ContractError('INVALID_TOKEN', 'Invalid collateral token address');
      if (!debtToken || debtToken === '0x0000000000000000000000000000000000000000')
        throw new ContractError('INVALID_TOKEN', 'Invalid debt token address');
      if (!debtToCover || debtToCover <= 0n)
        throw new ContractError('INVALID_AMOUNT', 'Debt to cover must be greater than zero');
      if (!_fheAdapter || typeof _fheAdapter.decryptForExecute !== 'function')
        throw new ContractError('FHE_ADAPTER_REQUIRED', 'FHE adapter required for liquidation');

      // Decrypt borrower's debt balance to get proof
      const debtProof = await _fheAdapter.decryptForExecute(debtHandle);
      const debtBalanceProof = BigInt(debtProof.plaintext);
      const debtSig = debtProof.signature;

      // Decrypt borrower's supply/collateral balance to get proof
      const supplyProof = await _fheAdapter.decryptForExecute(supplyHandle);
      const supplyBalanceProof = BigInt(supplyProof.plaintext);
      const supplySig = supplyProof.signature;

      const wc = getWc();
      return estimateSendAndWait(
        publicClient,
        wc,
        CONTRACT_ADDRESSES.LendingPool,
        CONTRACT_ABIS.LendingPool,
        'liquidateWithProof',
        [
          borrower,
          collateralToken,
          debtToken,
          debtToCover,
          debtBalanceProof,
          debtSig,
          supplyBalanceProof,
          supplySig,
        ],
        account,
      );
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
          'API_ADAPTER_REQUIRED',
          'API adapter with defiStrategies.simulateDefiStrategy is required for simulation',
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

    const provider =
      (typeof window !== 'undefined' && /** @type {any} */ (window).ethereum
        ? /** @type {any} */ (window).ethereum
        : null);

    if (provider) {
      _walletClient = createWalletClient({
        chain: arbitrumSepolia,
        transport: custom(provider),
      });
      return _walletClient;
    }

    throw new ContractError(
      'WALLET_UNAVAILABLE',
      'No wallet client available. Connect a wallet (MetaMask/Rabby) or provide a wallet client.',
    );
  }

  // ── Multicall batching ───────────────────────────────────────────────

  /**
   * Execute multiple contract read calls in a single RPC multicall.
   *
   * @param {Array<{address: `0x${string}`, abi: import('viem').Abi, functionName: string, args: unknown[]}>} calls
   * @returns {Promise<Array<{success: boolean, result: any, error: Error | null}>>}
   */
  const multicallRead = async (calls) => {
    const results = await publicClient.multicall({
      contracts: calls.map((c) => ({
        address: c.address,
        abi: c.abi,
        functionName: c.functionName,
        args: c.args,
      })),
      allowFailure: true,
    });
    return results.map((r) => ({
      success: r.status === 'success',
      result: r.status === 'success' ? r.result : null,
      error: r.status === 'failure' ? r.error : null,
    }));
  };

  /**
   * Batch-fetch supply + borrow balances for multiple tokens in a single multicall.
   *
   * @param {`0x${string}`[]} tokens - Token addresses
   * @returns {Promise<Array<{success: boolean, result: any, error: Error | null}>>}
   */
  const getAllBalances = async (tokens) => {
    const lp = CONTRACT_ADDRESSES.LendingPool;
    const lpAbi = CONTRACT_ABIS.LendingPool;
    const calls = tokens.flatMap((t) => [
      { address: lp, abi: lpAbi, functionName: 'getSupplyBalance', args: [t] },
      { address: lp, abi: lpAbi, functionName: 'getBorrowBalance', args: [t] },
    ]);
    return multicallRead(calls);
  };

  /**
   * Batch-fetch position metadata + collateral for multiple positions in a single multicall.
   *
   * @param {Array<`0x${string}`>} positionIds - Position IDs
   * @returns {Promise<Array<{success: boolean, result: any, error: Error | null}>>}
   */
  const getAllPositionData = async (positionIds) => {
    const sv = CONTRACT_ADDRESSES.StrategyVault;
    const svAbi = CONTRACT_ABIS.StrategyVault;
    const calls = positionIds.flatMap((pid) => [
      { address: sv, abi: svAbi, functionName: 'getPositionMeta', args: [pid] },
      { address: sv, abi: svAbi, functionName: 'getCollateral', args: [pid] },
    ]);
    return multicallRead(calls);
  };

  return {
    read,
    write,
    simulate,
    multicallRead,
    getAllBalances,
    getAllPositionData,
  };
}
