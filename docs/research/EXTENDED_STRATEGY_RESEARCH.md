# Extended DeFi Research — 50-200 Step Strategy Flows + Deep Forkwork

**Date**: 2026-05-10 | **Status**: RESEARCH ONLY, NO EDITS | **Addendum to COMPREHENSIVE_DEFI_RESEARCH.md**

---

## 1. 50-200 Step Strategy Architecture

### Problem
Current Composer handles 4-5 step strategies (supply → deposit → borrow → swap). For 50-200 step flows with 10-20 tokens, we need a fundamentally different execution engine.

### Solution: StrategyExecutor with Action Pipeline

```
StrategyExecutor (new contract)
├── ActionRegistry (register action types: SwapAction, BorrowAction, etc.)
├── ActionPipeline (execute ordered list of actions in single tx)
├── FHEStateTracker (track encrypted balances across all steps)
├── GasBudget (enforce gas limit per step, partial completion)
└── EmergencyStop (pause mid-execution on failure)
```

### Core Design: Action Interface

```solidity
interface IStrategyAction {
    function actionType() external pure returns (bytes4);
    function execute(
        address user,
        bytes calldata params,  // encoded action-specific params
        PipelineState calldata state  // running state across actions
    ) external returns (PipelineState memory newState);
}

struct PipelineState {
    mapping(address => uint256) tokenBalances;   // plain token balances in executor
    mapping(address => euint128) encryptedDebt;   // encrypted debt per token
    mapping(address => euint128) encryptedSupply;  // encrypted supply per token
    uint256 gasUsed;
    uint256 gasLimit;
    bool stopped;
}
```

### Action Types

| Action | Contract | FHE? | Gas Est. |
|--------|----------|------|----------|
| `ERC20Transfer` | Direct | No | ~50K |
| `ShieldSupply` | Pool.shield | Yes (eq, add) | ~200K |
| `BorrowWithLtv` | Pool.borrowWithLtvCheck | Yes (gt, select, add) | ~400K |
| `SwapExactInput` | Uniswap V3 | No | ~150K |
| `SwapIntent` | SwapRouter.submitSwapIntent | No | ~100K |
| `RepayDebt` | Pool.repayDebt | Yes (eq, sub) | ~200K |
| `OpenVaultPosition` | Vault.openPosition | Yes (eq, allowTransient) | ~300K |
| `AddCollateral` | Vault.addCollateral | Yes (eq, add) | ~250K |
| `ClosePosition` | Vault.closePosition | Yes (sub) | ~200K |
| `RequestUnshield` | Pool.requestUnshield | Yes (allowPublic) | ~100K |
| `UnshieldWithProof` | Pool.unshieldWithProof | No (verify proof) | ~150K |
| `RequestBorrowReveal` | Pool.requestBorrowReveal | Yes (allowPublic) | ~100K |
| `FlashBorrow` | Pool.flashLoan | No | ~100K |
| `FlashRepay` | Pool (internal) | No | ~50K |
| `WrapEth` | WETH9.deposit | No | ~40K |
| `UnwrapEth` | WETH9.withdraw | No | ~40K |

### Gas Budget Analysis

Arb-Sepolia block gas limit: **~1.125 quadrillion** (1,125,899,906,842,624) — essentially unlimited.
Real constraint: **transaction gas limit** set by wallet/RPC (typically 10-30M gas on L2).

| Strategy Size | Actions | Est. Gas | Feasible? |
|---------------|---------|----------|-----------|
| 10 steps | 10 | ~2M | ✅ Single tx |
| 25 steps | 25 | ~5M | ✅ Single tx |
| 50 steps | 50 | ~10M | ✅ Single tx (L2) |
| 100 steps | 100 | ~20M | ⚠️ Need high gas tx |
| 200 steps | 200 | ~40M | ❌ Split into 2-3 tx |

**For 200-step strategies**: Split into 2-3 sub-pipelines with checkpointing. Each sub-pipeline stores intermediate state in the executor contract. Next tx continues from checkpoint.

### Multi-Step Strategy Examples

#### Example 1: 50-Step Multi-Token Delta Neutral

```
1-5:   Shield WETH, USDC, WBTC, ARB, LINK (5 pool deposits)
6-10:  Borrow USDC against each collateral (5 borrows)
11-15: Swap borrowed USDC to 5 different tokens (5 Uniswap V3 swaps)
16-20: Shield swapped tokens as additional supply (5 deposits)
21-25: Borrow more against new supply (5 borrows)
26-30: Swap again for yield tokens (5 swaps)
31-35: Deposit yield tokens in Vault (5 vault positions)
36-40: Rebalance LTV ratios (5 addCollateral/repayDebt pairs)
41-45: Request unshield for matured positions (5 requestUnshield)
46-50: Execute unshield with proofs (5 unshieldWithProof)
```

#### Example 2: 100-Step Arbitrage Loop (20 Tokens)

```
1-20:  Shield all 20 tokens (20 deposits)
21-40: Borrow against each at 50% LTV (20 borrows)
41-60: Chain swaps: token[i] → WETH → token[i+1] (20 multi-hop swaps)
61-80: Repay debts with swapped tokens (20 repayDebt)
81-100: Unshield profits (20 unshieldWithProof)
```

#### Example 3: 200-Step Deep Forkwork (20 Tokens, Complex)

```
1-20:   Initialize positions (shield all tokens)
21-40:  First leverage loop (borrow + swap + deposit)
41-60:  Second leverage loop (borrow + swap + deposit, higher LTV)
61-80:  Third leverage loop (max LTV)
81-100: Rebalancing phase (repay worst positions, borrow better ones)
101-120: Cross-collateral migration (swap collateral types)
121-140: Yield harvesting (unshield profits, re-deposit)
141-160: Risk reduction (repay to lower LTV ratios)
161-180: Position consolidation (merge small positions)
181-200: Exit phase (unshield + withdraw all positions)
```

---

## 2. Multicall3 on Arb-Sepolia

**FINDING**: Multicall3 is NOT pre-deployed on Arb-Sepolia at any standard address (verified via `eth_getCode`).

**Solution**: Deploy our own Multicall3 or use a custom `StrategyExecutor` contract that handles batching internally.

The Arb-Sepolia block gas limit is ~1.125 quadrillion — essentially unlimited for L2. The real limit is the per-transaction gas cap (wallet defaults to 10-30M).

---

## 3. Uniswap V3 Multi-Hop Swap Path Encoding

For chaining swaps through multiple pools in a single call:

```solidity
// Single hop: WETH → USDC (0.3% fee)
ISwapRouter02.ExactInputSingleParams({
    tokenIn: WETH,
    tokenOut: USDC,
    fee: 3000,
    ...
});

// Multi-hop: USDC → WETH → DAI (0.3% each)
bytes memory path = abi.encodePacked(
    USDC, uint24(3000), WETH, uint24(3000), DAI
);
ISwapRouter02.ExactInputParams({
    path: path,
    recipient: address(this),
    amountIn: 1000e6,
    amountOutMinimum: 0,
    ...
});
```

**Key**: `exactInput` uses `abi.encodePacked(tokenAddr, fee, tokenAddr, fee, ...)` for path encoding. Each token = 20 bytes, each fee = 3 bytes. A 10-hop path = 20 + 9*(3+20) = 227 bytes.

---

## 4. Flash Loan Integration for Atomic Strategies

### Aave-style Flash Loan Pattern (adapted for FheForge)

```solidity
// In LendingPool.sol — add flashLoan function
function flashLoan(
    address token,
    uint256 amount,
    address receiver,
    bytes calldata params
) external whenNotPaused returns (bool) {
    uint256 balanceBefore = IERC20(token).balanceOf(address(this));
    
    // Transfer tokens to receiver
    IERC20(token).safeTransfer(receiver, amount);
    
    // Call receiver's executeOperation
    IFlashLoanReceiver(receiver).executeOperation(token, amount, 0, msg.sender, params);
    
    // Verify repayment
    uint256 balanceAfter = IERC20(token).balanceOf(address(this));
    if (balanceAfter < balanceBefore) revert InsufficientReserve();
    
    return true;
}
```

### Flash Loan Strategy Flow (50 steps in 1 tx)

```
1. Flash borrow 1000 WETH
2-5. Supply as collateral in 4 positions
6-9. Borrow USDC against each
10-13. Swap USDC→WBTC, ARB, LINK, SOL
14-17. Supply swapped tokens
18-21. Borrow more against new supply
22-25. Swap for more tokens
...
46-49. Repay all borrows with profits
50. Repay flash loan (1000 WETH + fee)
```

All atomic. If any step fails, entire tx reverts. No capital risk.

---

## 5. Fork Testing + Strategy Simulation

### Foundry Fork Test on Arb-Sepolia

```solidity
// test-foundry/StrategyForkTest.t.sol
function test_50_step_strategy() public {
    // Fork Arb-Sepolia at current block
    uint256 forkId = vm.createFork("https://sepolia-rollup.arbitrum.io/rpc");
    vm.selectFork(forkId);
    
    // Impersonate deployer with funds
    vm.startPrank(0x485534DE1BB491ed0D624dd9b9c3A89a140E58a8);
    
    // Execute 50-step strategy
    StrategyExecutor executor = new StrategyExecutor(...);
    
    Action[] memory actions = new Action[](50);
    actions[0] = Action({actionType: "SHIELD_SUPPLY", token: WETH, amount: 1e18, ...});
    actions[1] = Action({actionType: "BORROW_LTV", token: USDC, amount: 500e6, ...});
    // ... 48 more actions
    
    executor.executePipeline(actions);
    
    // Verify encrypted state consistency
    euint128 totalSupply = executor.getTotalEncryptedSupply(user, WETH);
    euint128 totalDebt = executor.getTotalEncryptedDebt(user, USDC);
    
    // Health check should pass
    ebool healthy = FHE.gte(
        FHE.mul(totalSupply, WAD),
        FHE.mul(FHE.mul(totalDebt, LTV_BPS), WAD / BPS_DEN)
    );
    // Can't decrypt in testnet — but can verify handle != _ZERO
    
    vm.stopPrank();
}
```

### Tenderly Simulation API

For off-chain strategy validation before on-chain execution:
1. Create fork of Arb-Sepolia via Tenderly
2. Build transaction bundle (50-200 steps)
3. Simulate → get gas estimate, state diffs, revert reasons
4. If all steps pass → submit on-chain

---

## 6. Random Strategy Builder Script Design

### TypeScript Script (`scripts/strategy-builder.ts`)

```typescript
// Strategy builder generates N random strategies with 10-200 steps
// across 20 tokens, tests FHE capabilities, measures friction

interface Action {
  type: 'shield' | 'borrow' | 'swap' | 'repay' | 'unshield' | 
        'deposit_vault' | 'add_collateral' | 'close_position' |
        'flash_borrow' | 'flash_repay' | 'wrap_eth' | 'unwrap_eth';
  token: string;
  amount: bigint;
  targetToken?: string;  // for swaps
  ltvBps?: number;       // for borrows
}

interface Strategy {
  id: string;
  actions: Action[];
  tokenCount: number;
  stepCount: number;
  estimatedGas: bigint;
  frictionScore: number;  // 0-10 (lower = less friction)
}

// Token pool (20 tokens with Pyth feeds)
const TOKENS = [
  { symbol: 'WETH', address: '0x84Bd...', feedId: 'ff6149...', decimals: 18 },
  { symbol: 'USDC', address: '0x1503...', feedId: 'eaa020...', decimals: 6 },
  { symbol: 'WBTC', address: '0xMOCK_WBTC', feedId: 'c9d8b0...', decimals: 8 },
  // ... 17 more tokens with mock ERC20 addresses
];

function generateStrategy(
  tokenCount: number,  // 10-20
  stepCount: number,   // 10-200
  complexity: 'simple' | 'medium' | 'complex' | 'deep'
): Strategy {
  // 1. Randomly select N tokens from pool
  // 2. Generate valid action sequence respecting invariants:
  //    - Must shield before borrow
  //    - Must borrow before swap/repay
  //    - Flash loans must be repaid in same tx
  //    - LTV must be within bounds
  // 3. Calculate estimated gas per action
  // 4. Compute friction score (tx count, gas, latency)
  // 5. Return strategy object
}

async function executeStrategy(strategy: Strategy): Promise<StrategyResult> {
  // 1. Fund deployer with necessary tokens
  // 2. Execute via StrategyExecutor contract
  // 3. Measure actual gas, tx count, latency
  // 4. Verify FHE state consistency
  // 5. Return results
}

async function runBattery(): Promise<void> {
  const results: StrategyResult[] = [];
  
  // Generate 100 random strategies
  for (let i = 0; i < 100; i++) {
    const tokenCount = randomInt(10, 20);
    const stepCount = randomInt(10, 200);
    const strategy = generateStrategy(tokenCount, stepCount, 'deep');
    const result = await executeStrategy(strategy);
    results.push(result);
  }
  
  // Analyze friction
  const avgGas = results.reduce((s, r) => s + r.gasUsed, 0n) / BigInt(results.length);
  const avgTx = results.reduce((s, r) => s + r.txCount, 0) / results.length;
  const avgFriction = results.reduce((s, r) => s + r.frictionScore, 0) / results.length;
  
  console.log(`Avg gas: ${avgGas}, Avg tx: ${avgTx}, Avg friction: ${avgFriction}`);
}
```

### FHE Capability Validation Matrix

For each strategy execution, validate:

| Capability | Test | Expected |
|-----------|------|----------|
| FHE.eq equality | Every shield/borrow/repay | ✅ verified |
| FHE.gt health check | Every borrow | ✅ encrypted LTV enforced |
| FHE.select conditional | Every conditional update | ✅ both branches execute |
| FHESafeMath128 overflow | Large amounts | ✅ tryIncrease/tryDecrease |
| ACL cross-contract | Composer→Pool, Composer→Vault | ✅ allowTransient |
| allowPublic + verifyDecryptResult | Every unshield | ✅ proof verification |
| Encrypted events | All events | ✅ no plain amounts |
| 50-step atomic | 50 actions in 1 tx | ✅ < 10M gas |
| 200-step checkpointed | 200 actions in 2-3 tx | ✅ state persisted |
| Flash loan atomicity | Borrow→use→repay | ✅ all-or-nothing |
| Multi-hop swap | 10-token swap chain | ✅ exactInput path |
| 20-token portfolio | All 20 tokens active | ✅ per-token config |

---

## 7. Token-Agnostic Architecture: TokenRegistry Contract

### Design

```solidity
contract TokenRegistry is FheForgeBase {
    struct TokenInfo {
        address token;           // ERC20 address
        bytes32 pythPriceId;     // Pyth feed ID
        uint8 decimals;          // token decimals
        bool isLendable;         // can be supplied to pool
        bool isBorrowable;       // can be borrowed from pool
        bool isCollateral;       // can be used as vault collateral
        uint256 ltvBps;          // max LTV (7500 = 75%)
        uint256 liquidationBonusBps; // liquidation incentive
        uint256 borrowCap;       // max borrow per token
        uint256 supplyCap;       // max supply per token
        uint256 baseRateBps;     // base interest rate
        uint256 slope1Bps;       // interest rate slope 1
        uint256 slope2Bps;       // interest rate slope 2
        bool enabled;
    }
    
    mapping(address => TokenInfo) public tokens;
    address[] public tokenList;
    
    function registerToken(TokenInfo calldata info) external onlyOwner {
        tokens[info.token] = info;
        tokenList.push(info.token);
        // Also register Pyth feed in PriceOracle
    }
    
    function updateTokenConfig(address token, ...) external onlyOwner { ... }
    function getLendableTokens() external view returns (address[] memory) { ... }
    function getBorrowableTokens() external view returns (address[] memory) { ... }
    function getTokenCount() external view returns (uint256) { ... }
}
```

### Initial Token Set (20 tokens with verified Pyth feeds)

| # | Token | Decimals | LTV | Lendable | Borrowable | Collateral |
|---|-------|----------|-----|----------|------------|------------|
| 1 | WETH | 18 | 75% | ✅ | ✅ | ✅ |
| 2 | USDC | 6 | 80% | ✅ | ✅ | ✅ |
| 3 | WBTC | 8 | 70% | ✅ | ✅ | ✅ |
| 4 | ARB | 18 | 50% | ✅ | ✅ | ✅ |
| 5 | LINK | 18 | 60% | ✅ | ✅ | ✅ |
| 6 | DAI | 18 | 80% | ✅ | ✅ | ✅ |
| 7 | USDT | 6 | 80% | ✅ | ✅ | ✅ |
| 8 | SOL | 18 | 55% | ✅ | ✅ | ✅ |
| 9 | AVAX | 18 | 55% | ✅ | ✅ | ✅ |
| 10 | DOGE | 18 | 40% | ✅ | ⚠️ | ⚠️ |
| 11 | UNI | 18 | 60% | ✅ | ✅ | ✅ |
| 12 | OP | 18 | 55% | ✅ | ✅ | ✅ |
| 13 | AAVE | 18 | 65% | ✅ | ✅ | ✅ |
| 14 | GMX | 18 | 50% | ✅ | ⚠️ | ✅ |
| 15 | CRV | 18 | 45% | ✅ | ⚠️ | ⚠️ |
| 16 | COMP | 18 | 55% | ✅ | ⚠️ | ✅ |
| 17 | SNX | 18 | 40% | ✅ | ⚠️ | ⚠️ |
| 18 | NEAR | 18 | 50% | ✅ | ⚠️ | ⚠️ |
| 19 | DOT | 18 | 50% | ✅ | ⚠️ | ⚠️ |
| 20 | PENDLE | 18 | 35% | ✅ | ❌ | ⚠️ |

⚠️ = limited borrow/collateral use, ❌ = not available for that role

---

## 8. StrategyExecutor Contract Design (50-200 Steps)

```solidity
contract StrategyExecutor is FheForgeBase {
    // Action types
    bytes4 public constant SHIELD_SUPPLY = keccak256("SHIELD_SUPPLY");
    bytes4 public constant BORROW_LTV = keccak256("BORROW_LTV");
    bytes4 public constant SWAP_EXACT = keccak256("SWAP_EXACT");
    bytes4 public constant REPAY_DEBT = keccak256("REPAY_DEBT");
    bytes4 public constant UNSHIELD = keccak256("UNSHIELD");
    bytes4 public constant DEPOSIT_VAULT = keccak256("DEPOSIT_VAULT");
    bytes4 public constant ADD_COLLATERAL = keccak256("ADD_COLLATERAL");
    bytes4 public constant FLASH_BORROW = keccak256("FLASH_BORROW");
    bytes4 public constant FLASH_REPAY = keccak256("FLASH_REPAY");
    
    struct Action {
        bytes4 actionType;
        bytes params;  // ABI-encoded action-specific params
    }
    
    struct Checkpoint {
        uint256 actionIndex;    // where to resume
        bool completed;
    }
    
    // State persists across txs for multi-tx strategies
    mapping(bytes32 => Checkpoint) public checkpoints;
    mapping(bytes32 => mapping(address => uint256)) public heldTokens;
    mapping(bytes32 => mapping(address => euint128)) public encryptedDebt;
    mapping(bytes32 => mapping(address => euint128)) public encryptedSupply;
    
    /// @notice Execute a full pipeline (50-200 steps)
    /// @dev If gas runs out, saves checkpoint for continuation
    function executePipeline(
        bytes32 strategyId,
        Action[] calldata actions,
        uint256 gasLimit
    ) external nonReentrant whenNotPaused returns (bool completed) {
        Checkpoint storage cp = checkpoints[strategyId];
        uint256 startIdx = cp.completed ? 0 : cp.actionIndex;
        uint256 gasStart = gasleft();
        
        for (uint256 i = startIdx; i < actions.length; i++) {
            // Check gas budget
            if (gasleft() < gasLimit - (gasStart - gasleft()) + 100_000) {
                // Save checkpoint for next tx
                cp.actionIndex = i;
                cp.completed = false;
                return false;  // not completed, call again to continue
            }
            
            _executeAction(strategyId, actions[i]);
        }
        
        cp.completed = true;
        return true;
    }
    
    function _executeAction(bytes32 strategyId, Action calldata action) internal {
        if (action.actionType == SHIELD_SUPPLY) {
            _shieldSupply(strategyId, action.params);
        } else if (action.actionType == BORROW_LTV) {
            _borrowLtv(strategyId, action.params);
        } else if (action.actionType == SWAP_EXACT) {
            _swapExact(strategyId, action.params);
        }
        // ... all action types
    }
    
    function _shieldSupply(bytes32 strategyId, bytes calldata params) internal {
        (address token, uint256 amount, InEuint128 enc) = 
            abi.decode(params, (address, uint256, InEuint128));
        
        // Pull tokens from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _ensureApproval(token, address(POOL), amount);
        
        // FHE equality verification
        euint128 incoming = FHE.asEuint128(enc);
        euint128 verified = _verifyEquality(incoming, amount);
        FHE.allowTransient(verified, address(POOL));
        
        // Deposit to pool
        POOL.depositFor(token, amount, verified, msg.sender);
        
        // Track in executor state
        encryptedSupply[strategyId][token] = FHE.add(
            encryptedSupply[strategyId][token], verified
        );
    }
    
    // Similar patterns for all action types...
}
```

---

## 9. Integration with SwapRouter Upgrade

### Hybrid SwapRouter (Intent + Uniswap V3 + 0x)

```solidity
contract SwapRouterV2 is FheForgeBase, TimelockedRotation {
    // Three swap paths:
    // 1. Intent model (current) — executor fills
    // 2. Uniswap V3 direct — exactInputSingle/exactInput
    // 3. 0x/Matcha API — fillQuote(to, value, data)
    
    address public immutable UNISWAP_V3_ROUTER;
    address public immutable ALLOWANCE_HOLDER;  // 0x AllowanceHolder
    
    function submitSwapIntent(...) external returns (bytes32 intentId) { /* current */ }
    
    function swapViaUniswapV3(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external whenNotPaused returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        _ensureApproval(tokenIn, UNISWAP_V3_ROUTER, amountIn);
        
        ISwapRouter02(UNISWAP_V3_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );
    }
    
    function swapViaUniswapV3MultiHop(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external whenNotPaused returns (uint256 amountOut) {
        // Path = abi.encodePacked(tokenA, fee, tokenB, fee, tokenC, ...)
        ISwapRouter02(UNISWAP_V3_ROUTER).exactInput(
            ISwapRouter02.ExactInputParams({
                path: path,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum
            })
        );
    }
    
    function swapVia0x(
        address allowanceTarget,
        address swapTarget,
        uint256 value,
        bytes calldata data
    ) external whenNotPaused {
        // 0x AllowanceHolder pattern
        IERC20(sellToken).safeTransferFrom(msg.sender, address(this), sellAmount);
        IERC20(sellToken).forceApprove(allowanceTarget, sellAmount);
        (bool success,) = swapTarget.call{value: value}(data);
        require(success, "0x swap failed");
    }
}
```

---

## 10. Complete On-Chain Addresses (Arb-Sepolia)

### FheForge Wave24 (Current)

| Contract | Address |
|----------|---------|
| StrategyRegistry | `0xDc57990Cd6aC65f3dc7439800b148FFA54FdD0c0` |
| StrategyVault | `0x333B5fcEbFaCd1EaDcb5E23957313171c502e3f6` |
| FheForgeComposer | `0xD3929079A960ebAa59FAba65a7bE738ADa8bcBbA` |
| LendingPool | `0x5605879F1ad15Cf663A861AbC93BD104709D7AB4` |
| SwapRouter | `0x4242C57920C2c5AA7b18909a5D07E311CF5D6211` |
| PriceOracle | `0xCd18800c5b1ba85eD81A2d201102D37A1B551245` |
| ExecutorContract | `0x8486E8Af266509D937B5241756d0023375504774` |

### Uniswap V3 (Arb-Sepolia)

| Contract | Address |
|----------|---------|
| SwapRouter02 | `0x101F443B4d1b059569D643917553c771E1b9663E` |
| Factory | `0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e` |
| NonfungiblePositionManager | `0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65` |
| QuoterV2 | `0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B` |
| V3Migrator | `0x398f43ef2c67B941147157DA1c5a868E906E043D` |
| UniversalRouter | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| WETH (Uniswap) | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |
| WETH9 (ours) | `0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32` |
| USDC (our mock) | `0x150376EdEbc5AC48771655a61a795d828BeC8Df6` |
| Multicall3 | ❌ NOT deployed (must deploy our own) |

### Pyth Oracle

| Component | Address |
|-----------|---------|
| Pyth contract | `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF` |
| Hermes endpoint | `https://hermes.pyth.network` |

### Deployer

| Component | Value |
|-----------|-------|
| Address | `0x485534DE1BB491ed0D624dd9b9c3A89a140E58a8` |
| Balance | ~0.35 ETH |

---

## 11. Execution Plan Summary (When Edits Approved)

### Phase A: Infrastructure
1. Deploy Multicall3 on Arb-Sepolia (our own instance)
2. Create WETH/USDC Uniswap V3 pool + add liquidity
3. Create pools for 5-10 more token pairs
4. Fix USDC/USD Pyth feed (replace $1 fallback with canonical feed)
5. Add 15+ Pyth feeds to PriceOracle

### Phase B: TokenRegistry + StrategyExecutor
1. Deploy TokenRegistry with 20 token configs
2. Deploy StrategyExecutor with 12 action types
3. Add flash loan support to LendingPool
4. Deploy 20 MockERC20 tokens for testing

### Phase C: SwapRouterV2
1. Add Uniswap V3 exactInputSingle path
2. Add exactInput multi-hop path
3. Keep intent model as fallback
4. Add 0x fillQuote path (mainnet future)

### Phase D: Strategy Builder + Testing
1. Write `strategy-builder.ts` (100+ random strategies)
2. Run friction analysis across all strategy types
3. Fork test 50-200 step strategies
4. Validate FHE capabilities on all 20 tokens
5. Measure gas per action type, build optimization report

### Phase E: Deep Forkwork Validation
1. Tenderly simulation for 200-step strategies
2. Foundry fork tests against live Arb-Sepolia state
3. Stress test: 200-step strategy with 20 tokens
4. FHE state consistency verification across all steps
5. Gas optimization pass based on benchmarks
