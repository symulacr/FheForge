# V3 Plan Review — OceanFin Cross-Reference + Naming + Gaps

## 1. OceanFin Architecture (Original Port Source)

OceanFin has **no Solidity contracts** — it's a Polkadot/Hydration app.

**Execution model** (from `strategy-step-service.ts`):
```
buildStepTx(step, userAddress) → switch(step.type)
  JOIN_STRATEGY → swap()
  SWAP           → swap()
  SUPPLY         → supply()
  BORROW         → borrow()
  ENABLE_E_MODE  → setUserEmode()
```

Each step = **one extrinsic**. Steps execute sequentially, 2s delays. No atomic composer.

**What FheForge changed**:
- 4 sequential txs → 1 atomic `openLeveragedStrategy` via Composer
- Added FHE encryption (encryptInputs + setAccount)
- Removed E-Mode (no Aave E-Mode on custom pool)
- Added `EncryptProgress` UI component

---

## 2. Naming Review — Current vs Proposed

### Contract Names

| Current | Issue | Proposed | Rationale |
|---|---|---|---|
| `LendingPool` | Generic, no FHE signal | `ShieldedPool` | Shorter than ShieldedLendingPool; signals FHE |
| `FheForgeComposer` | Inconsistent prefix | `Composer` | All contracts are FheForge; prefix is noise |
| `StrategyVault` | No FHE signal | `ShieldedVault` | Parallel with ShieldedPool |
| `StrategyRegistry` | OK | `StrategyRegistry` | No user-visible FHE state |
| `SwapRouter` | OK | `SwapRouter` | No FHE |
| `PriceOracle` | OK | `PriceOracle` | No FHE |
| `FheForgeGovernor` | Redundant prefix | `Governor` | Already in FheForge namespace |
| `FheForgeTimelock` | Redundant prefix | `Timelock` | Same |

### Function Names — ShieldedPool (was LendingPool)

| Current | Issue | Proposed | Rationale |
|---|---|---|---|
| `supply` | Vague | `shield` | FHERC20 pattern: lock ERC20 → mint encrypted balance |
| `supplyEth` | Unclear | `shieldEth` | ETH variant |
| `withdraw` | Doesn't signal partial vs full | `partialUnshield` | Encrypted subtract + plain transfer = partial exit |
| `supplyToLending` | Confusing POV | `depositFor` | Composer deposits on behalf of user |
| `borrowFromLending` | Inverted POV | `borrowFor` | Composer borrows for user |
| `repayBorrow` | Redundant | `repayFor` | Composer repays for user |
| `requestEmergencyBalance` | Not really emergency | `requestBalanceReveal` | "Reveal" = CoFHE decryption term |
| `emergencyWithdrawWithProof` | Paused-state only | `withdrawPausedWithProof` | More accurate |
| `requestLiquidationCheck` | OK-ish | `requestLiquidityCheck` | More accurate |
| `checkLtvAndBorrow` | LTV check + borrow in one | `borrowWithLtvCheck` | Verb-first |
| `borrowWithOracle` | OK | `borrowWithOracle` | Fine |
| `requestUnshield` | Good | `requestUnshield` | FHERC20 pattern |
| `unshieldWithProof` | Good | `unshieldWithProof` | FHERC20 pattern |
| NO getter | Missing | `getShieldedSupply` | euint128 + allowSender for decryptForView |
| NO getter | Missing | `getShieldedBorrow` | Same |

### Function Names — ShieldedVault (was StrategyVault)

| Current | Proposed | Rationale |
|---|---|---|
| `openPosition` (InEuint128) | REMOVE | Composer uses euint128 only |
| `openPosition` (euint128) | `openPosition` | Clean |
| `addCollateral` (InEuint128) | REMOVE | Same |
| `addCollateral` (euint128) | `addCollateral` | Clean |
| `closePosition` | `closePosition` | Fine — always user-facing |
| `getCollateral` | `getShieldedCollateral` | Signals encrypted return |
| `emergencyWithdraw` | `withdrawPaused` | More accurate |

### Function Names — Registry

| Current | Proposed | Rationale |
|---|---|---|
| `incrementTvl` (InEuint128) | REMOVE | Dead overload |
| `incrementTvl` (euint128) | `increaseTvl` | More natural |
| `decrementTvl` (InEuint128) | REMOVE | Dead overload |
| `decrementTvl` (euint128) | `decreaseTvl` | More natural |
| `getEncryptedTvl` | `getShieldedTvl` | Consistent naming |

### Function Names — Composer

| Current | Proposed | Rationale |
|---|---|---|
| `openLeveragedStrategy` | `openLeveragedPosition` | "Position" = vault's term |
| `rebalance` | `rebalancePosition` | Specific |

### Error Names

| Current | Proposed | Rationale |
|---|---|---|
| `OnlyOwner()` / `NotOwner()` | `Unauthorized()` | One error in FheForgeBase |
| `NotComposer()` | `Unauthorized()` | Same pattern — address in revert data |

---

## 3. Gaps Found — What V3 Plan Misses

### GAP-1: No Claim Helper for asynchronous unshield

FHERC20's unshield is **asynchronous**:
1. `unshield()` → `FHE.allowPublic()` → creates `Claim` struct with `ctHash`
2. Off-chain: `decryptForTx(ctHash)` → plaintext + Threshold Network signature
3. On-chain: `claimUnshielded(ctHash, amount, proof)` → verify → transfer ERC20

FheForge's current model is **synchronous**: `requestUnshield` + `unshieldWithProof` in one call. Works but:
- No batch claiming (FHERC20 has `claimUnshieldedBatch`)
- No partial claims (user must unshield entire position)
- No claim enumeration (user can't list pending claims)

**Recommendation**: Port `FHERC20WrapperClaimHelper` pattern into ShieldedPool. Add:
```
struct Claim { address to; bytes32 ctHash; uint128 requestedAmount; uint128 decryptedAmount; bool claimed; }
mapping(bytes32 => Claim) private _claims;
mapping(address => Bytes32Set) private _userClaims;

function requestUnshield(token) → allowPublic + createClaim
function claimUnshielded(ctHash, amount, proof) → verify + transfer
function claimUnshieldedBatch(ctHashes[], amounts[], proofs[]) → batch
function getUnshieldClaims(user) → Claim[] view
```

### GAP-2: No confidential transfer between users (FHERC20 operator model)

FHERC20 has `confidentialTransfer(to, encryptedAmount)` and `confidentialTransferFrom(from, to, encryptedAmount)` via time-bound operators.

FheForge has NO way to transfer encrypted balances between users without unshielding first. A user with 1000 eUSDC in ShieldedPool cannot send 500 eUSDC to another user privately.

**Recommendation**: Add to ShieldedPool:
```
function transferShielded(token, to, InEuint128 encAmount) → encrypted debit + credit
function transferShieldedFrom(token, from, to, euint128 amount) → operator-based (Composer)
```

### GAP-3: No encrypted total supply / total borrow (protocol-level privacy)

V2 P2 says `totalPlainBorrow` and `liquidReserve` stay plain (protocol-level). This is correct for solvency checks, but:
- `totalPlainBorrow` leaks aggregate user debt — any observer can see total protocol debt
- For a privacy-focused protocol, this is a design tension

**Recommendation**: Keep plain for now (correct per CoFHE docs — "protocol-level state can be public"). But add `getShieldedTotalSupply(token)` and `getShieldedTotalBorrow(token)` that return encrypted totals with `allowSender` for governance/auditor use.

### GAP-4: No FHERC20 integration — reinventing encrypted balances

ShieldedPool and ShieldedVault each independently implement encrypted balance mappings:
```
mapping(address => mapping(address => euint128)) supplyBalances;  // Pool
mapping(address => mapping(bytes32 => Position)) positions;       // Vault
```

FHERC20 already has `mapping(address => euint64) _balances` with full ACL, transfer, operator, and indicator support. If Pool/Vault used FHERC20 tokens internally (one per deposited token), they'd get:
- Confidential transfers between users for free
- Operator model (Composer = operator, no need for `onlyComposer` modifier)
- Indicator system for wallet compatibility
- FHESafeMath overflow protection

**Recommendation**: Long-term (V4), consider making ShieldedPool a FHERC20ERC20Wrapper per token. Each deposited token (WETH, USDC) gets a corresponding `eWETH`, `eUSDC` FHERC20 token minted on shield and burned on unshield. The Pool then becomes a lender of eTokens rather than raw encrypted mappings.

For V3: too large a change. Document as V4 target.

### GAP-5: Composer operator model vs FHERC20 operator model

FHERC20 uses time-bound operators: `setOperator(spender, deadline)`. Composer currently uses `onlyComposer` modifier which is permanent access.

**Issue**: If Composer is compromised or has a bug, it has unlimited access to all user positions. FHERC20 operators expire.

**Recommendation**: Replace `onlyComposer` with operator pattern:
```
mapping(address => uint48) public composerDeadline;
modifier onlyActiveComposer() {
    if (block.timestamp > composerDeadline[msg.sender]) revert ComposerExpired();
    _;
}
function setComposer(address c, uint48 deadline) external onlyOwner
```

### GAP-6: No batch operations (FHERC20 has batch claim/decrypt)

FHERC20 supports:
- `claimUnshieldedBatch(ctHashes[], amounts[], proofs[])`
- `verifyDecryptResultBatch` (CoFHE API)

FheForge has no batch functions. A liquidator unwinding multiple positions or a user unshielding from multiple tokens must call individually.

**Recommendation**: Add batch variants in V3-5:
- `claimUnshieldedBatch` on ShieldedPool
- `liquidateBatch` for multi-position liquidation

### GAP-7: Cross-contract ACL not using `FHE.isAllowed` checks

CoFHE docs: "Always verify ACL before using a handle." Pattern:
```
if (!FHE.isAllowed(amount, address(this))) revert FhePermissionDenied();
```

Registry does this in `_modifyTvl`. Pool does NOT check `isAllowed` in any function. It assumes handles received via `InEuint128` (user-facing) or `euint128` (Composer) are already authorized.

**Risk**: If a handle is passed without proper `allowTransient`, the real coprocessor will revert. On mock coprocessor, it may silently pass with wrong values.

**Recommendation**: Add `FHE.isAllowed` checks in ShieldedPool cross-contract functions:
```
function depositFor(token, amount, euint128 handle, user) external onlyComposer {
    if (!FHE.isAllowed(handle, address(this))) revert FhePermissionDenied();
    ...
}
```

### GAP-8: No indicator system for wallet compatibility

FHERC20 has an indicator system: `balanceOf` returns 7984.xxxx (activity indicator, not real balance). This lets wallets detect balance changes without revealing amounts.

FheForge has no such system. Wallets see 0 balance for all FHE tokens (no ERC20 balance).

**Recommendation**: Add minimal indicator to ShieldedPool (per-token, per-user):
```
mapping(address => mapping(address => uint32)) private _indicatedBalances;
function balanceOf(address token, address account) external view returns (uint256) {
    return uint256(_indicatedBalances[token][account]); // indicator, not real
}
```

### GAP-9: Frontend still uses step-by-step model

OceanFin's execution modal executes steps one-by-one. FheForge's Composer should collapse all steps into one atomic tx, but the `execution-modal.tsx` still renders individual steps (supply, borrow, swap) as separate visual items, then executes them all in one `openLeveragedStrategy` call.

**Issue**: The UI shows 4 steps but only 1 tx fires. This is confusing — steps show "processing" → all jump to "completed" at once. No intermediate state.

**Recommendation**: Redesign execution modal for atomic Composer flow:
1. Step 1: "Encrypt inputs" (client-side, off-chain)
2. Step 2: "Execute strategy" (1 on-chain tx)
3. Step 3: "Confirm receipt" (poll for receipt)

Remove the 4-step breakdown. It's a holdover from OceanFin that doesn't match the Composer architecture.

### GAP-10: No `decryptForView` in frontend for balance display

Users cannot see their encrypted balances in the UI. The current flow:
- `ConfigPanel.tsx` calls `getCollateral` on Vault → gets euint128 → needs `decryptForView`
- No equivalent for Pool supply/borrow balances (no getters exist)

**Recommendation**: Add `decryptForView` flow in V3-7:
```
const supplyBal = await pool.getShieldedSupply(token); // returns euint128 with allowSender
const decrypted = await cofheClient.decryptForView(supplyBal);
```

---

## 4. Revised V3 Plan — Updated Phases

### V3-0: Bug fixes + getters (unchanged)
### V3-1: Shared abstractions (unchanged)
### V3-2: Shield/Unshield + ClaimHelper (expanded)

Add `FHERC20WrapperClaimHelper` pattern:
- `Claim` struct + `_claims` mapping + `_userClaims` set
- `requestUnshield` → `allowPublic` + `_createClaim`
- `claimUnshielded` / `claimUnshieldedBatch`
- `getUnshieldClaims(user)` view

### V3-3: Borrow reveal + operator model (expanded)

Replace `onlyComposer` with time-bound operator:
- `setComposer(address, uint48 deadline)` replaces permanent `composer` address
- `onlyActiveComposer` modifier checks deadline
- Add `requestBorrowReveal` + `repayWithProof`

### V3-4: Remove InEuint128 overloads (unchanged)
### V3-5: FHESafeMath + ACL checks (expanded)

Add `FHE.isAllowed` guards on all cross-contract handle reception:
- `depositFor`, `borrowFor`, `repayFor` in ShieldedPool
- `openPosition`, `addCollateral` in ShieldedVault (euint128 variant)
- `increaseTvl`, `decreaseTvl` in Registry

### V3-6: Interest with enc index (DEFER — unchanged)

### V3-7: Frontend alignment (expanded)

- Drop 4-step OceanFin model → 3-step atomic model (encrypt → execute → confirm)
- Add `decryptForView` for balance display
- Add `claimUnshielded` UI flow
- Add batch liquidation support

### V3-8: Deploy + test (unchanged)

---

## 5. V4 Target (documented, not executed)

- ShieldedPool becomes FHERC20ERC20Wrapper per token (eWETH, eUSDC)
- Confidential transfers between users via FHERC20 `confidentialTransfer`
- Indicator system for wallet compatibility
- P8 integration: AccessControl + UUPS proxy + governance
- Encrypted total supply/borrow for governance auditors

---

*Grounded on: all 6 FheForge contracts (2,081 lines), OceanFin UI source, FHERC20 reference implementation (FHERC20.sol 394 lines, FHERC20ERC20Wrapper.sol 229 lines, FHERC20WrapperClaimHelper.sol 89 lines, FHERC20Errors.sol 29 lines, FHESafeMath.sol 74 lines), CoFHE FHE.sol v0.1.3 API, CoFHE official docs.*
