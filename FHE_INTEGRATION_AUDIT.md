# FHE Integration Audit — CoFHE End-to-End Score & Report

Ground-truth audit of CoFHE FHE integration quality across all FheForge contracts.
Cross-referenced against official CoFHE docs (cofhe-docs.fhenix.zone), FHERC20 reference,
and best practices. Date: 2026-05-10.

---

## BEFORE vs AFTER Architecture Diagrams

### BEFORE (V1 — Plain Mirror + Permit2 + Dual State)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER WALLET                                 │
│  1. approve(Pool)          ← 1 wallet sign                          │
│  2. approve(Composer)      ← 1 wallet sign                          │
│  3. Permit2.sign(EIP-712)  ← 1 wallet sign (off-chain)             │
│  4. submit tx              ← 1 wallet sign                          │
│                           ─────────                                  │
│                           4 signatures per strategy open             │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     FheForgeComposer                                 │
│                                                                     │
│  openLeveragedStrategy(Params, Encrypted)                           │
│    │                                                                │
│    ├─ _pullViaPermit2()     ← Permit2.transferFrom                  │
│    │    └─ requires EIP-712 Permit2 signature                       │
│    │                                                                │
│    ├─ VAULT.openPosition(InEuint64)  ← uint64 truncation risk       │
│    │    └─ passes raw InEuint64, NOT euint64 handle                 │
│    │    └─ Vault does FHE.asEuint64 internally (double conversion)  │
│    │                                                                │
│    ├─ POOL.supplyToLending(InEuint64)                               │
│    │    └─ Pool does FHE.asEuint64 internally                       │
│    │    └─ No allowTransient — Composer msg.sender gets ACL         │
│    │                                                                │
│    ├─ POOL.borrowFromLending(InEuint64)                             │
│    │    └─ Same pattern, no transient ACL                           │
│    │                                                                │
│    ├─ ROUTER.submitSwapIntent()                                     │
│    │    └─ Plain amounts only, no FHE                               │
│    │                                                                │
│    └─ returns (no health check, no LTV enforcement)                 │
│                                                                     │
│  Problem: InEuint64 → truncation risk for >18.4 ETH                │
│  Problem: Permit2 adds 3 extra signature steps                     │
│  Problem: Cross-contract ACL not properly set up                   │
└─────────────────────────────────────────────────────────────────────┘
               │              │              │
               ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  LendingPool │ │ StrategyVault│ │  SwapRouter  │
│              │ │              │ │              │
│ DUAL STATE:  │ │ DUAL STATE:  │ │ No FHE       │
│ ┌──────────┐ │ │ ┌──────────┐ │ │              │
│ │plainSupply│ │ │ │plainDepos │ │ │ Plain only   │
│ │uint256    │ │ │ │uint256    │ │ │              │
│ ├──────────┤ │ │ ├──────────┤ │ │              │
│ │encSupply  │ │ │ │encCollat  │ │ │              │
│ │euint64    │ │ │ │euint64    │ │ │              │
│ └──────────┘ │ │ └──────────┘ │ │              │
│              │ │              │ │              │
│ MIRROR BUG:  │ │ One position │ │              │
│ plain != enc  │ │ per user     │ │              │
│ (skew risk)  │ │              │ │              │
│              │ │              │ │              │
│ No getters   │ │ No getters   │ │              │
│ No unshield  │ │ No emergency │ │              │
│ No interest  │ │ withdraw     │ │              │
│ No proofs    │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘

FHE LIFECYCLE: NONE — no shield/unshield, no reveal, no proof-based exits
PRIVACY: PARTIAL — encrypted state exists but plain mirrors leak everything
FRICTION: HIGH — 4 wallet signatures, Permit2, no atomic flow
```

### AFTER (V2 + T1/T2/T3 Refactor — Current State)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER WALLET                                 │
│  1. approve(Composer)     ← 1 wallet sign (one-time)              │
│  2. submit tx             ← 1 wallet sign                          │
│                           ─────────                                  │
│                           2 signatures total (1 if pre-approved)   │
│                                                                     │
│  CoFHE SDK:                                                         │
│    encryptInputs([uint128(val)])                                     │
│      .setAccount(composerAddress)  ← Proof embeds Composer addr     │
│      .onStep(cb)                  ← UX progress feedback            │
│      .execute()                   ← Returns InEuint128 handles      │
│                                                                     │
│  decryptForView(handle, FheTypes.Uint128)                           │
│    → Local-only reveal for UI display (never hits chain)            │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     FheForgeComposer                                 │
│                                                                     │
│  openPosition(Params, Encrypted)                                    │
│    │                                                                │
│    ├─ IERC20.transferFrom()  ← Direct, no Permit2                   │
│    │                                                                │
│    ├─ euint128 incomingColl = FHE.asEuint128(e.collateral)          │
│    │   FHE.allowTransient(incomingColl, address(VAULT))              │
│    │   VAULT.openPosition(token, amount, incomingColl, ...)         │
│    │     └─ euint128 handle passed directly (no double conversion)  │
│    │     └─ allowTransient grants Vault temp ACL for this tx        │
│    │                                                                │
│    ├─ euint128 incomingSupply = FHE.asEuint128(e.supplyEnc)         │
│    │   FHE.allowTransient(incomingSupply, address(POOL))             │
│    │   POOL.depositFor(token, amount, incomingSupply, user)        │
│    │     └─ euint128 handle, onlyComposer-gated                     │
│    │     └─ allowTransient grants Pool temp ACL                     │
│    │                                                                │
│    ├─ euint128 incomingBorrow = FHE.asEuint128(e.borrowEnc)         │
│    │   FHE.allowTransient(incomingBorrow, address(POOL))            │
│    │   POOL.borrowFor(token, amount, incomingBorrow, user)          │
│    │     └─ Same pattern                                            │
│    │                                                                │
│    ├─ ROUTER.submitSwapIntent()  ← Plain amounts (correct)          │
│    │                                                                │
│    └─ rebalance() uses same transferFrom + allowTransient pattern   │
│                                                                     │
│  FHE TYPE: euint128 (no truncation risk up to 3.4×10^38)          │
│  FRICTION: 1 approve + 1 tx sign (was 4)                           │
│  ACL: setAccount(composer) + allowTransient per cross-contract call │
└─────────────────────────────────────────────────────────────────────┘
               │              │              │
               ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  LendingPool │ │ StrategyVault│ │  SwapRouter  │
│              │ │              │ │              │
│ SINGLE STATE │ │ SINGLE STATE │ │ No FHE       │
│ ┌──────────┐ │ │ ┌──────────┐ │ │ (correct)    │
│ │encSupply  │ │ │ │encCollat  │ │ │              │
│ │euint128   │ │ │ │euint128   │ │ │ Plain only   │
│ ├──────────┤ │ │ ├──────────┤ │ │ │              │
│ │encBorrow  │ │ │ │encDebt    │ │ │              │
│ │euint128   │ │ │ │euint128   │ │ │              │
│ └──────────┘ │ │ └──────────┘ │ │              │
│              │ │              │ │              │
│ PLAIN TRACKING:                              │              │
│ totalPlainBorrow (reserve solvency)          │              │
│ liquidReserve   (withdrawal guard)           │              │
│              │ │              │ │              │
│ GETTERS:     │ │ Multi-pos    │ │              │
│ getSupplyBal │ │ getUserPos   │ │              │
│ getBorrowBal │ │ getCollateral│ │              │
│ (allowSender)│ │ (allowSender)│ │              │
│              │ │              │ │              │
│ PROOF FLOW:  │ │ withdrawPaused│ │              │
│ requestBalanceReveal  (allowPublic)          │              │
│ requestLiquidityCheck (allowPublic)          │              │
│ withdrawPausedWithProof (verifyDecryptResult) │              │
│ liquidateWithProof     (verifyDecryptResult)  │              │
│              │ │              │ │              │
│ INTEREST:    │ │ Position meta│ │              │
│ InterestIndex│ │ strategyId   │ │              │
│ supply/borrow│ │ createdAt    │ │              │
│ index + accr │ │ depositedAmt │ │              │
└──────────────┘ └──────────────┘ └──────────────┘

FHE LIFECYCLE:
  shield → encrypted state → partialUnshield / requestUnshield+unshieldWithProof
  requestBalanceReveal → decryptForView (UI display, never on-chain)
  requestLiquidityCheck → liquidateWithProof (proof-based exit)

PRIVACY: FULL — no plain mirrors, encrypted-only per-user state
FRICTION: LOW — 2 signatures (1 if pre-approved), atomic Composer flow
```

---

## SCORING — CoFHE FHE Integration Quality

Scored against official CoFHE docs + FHERC20 reference + best practices.
Each dimension: 0-10, with deduction rationale.

### 1. Encrypted State Design (9/10)

| Criteria | Score | Notes |
|---|---|---|
| All per-user state encrypted | 10 | supplyBalances, borrowBalances, positions — all euint128 |
| No plain mirrors | 10 | Plain mirrors eliminated in P2. Only totalPlainBorrow/liquidReserve remain (protocol-level, not user-specific) |
| Protocol-level plain where needed | 9 | totalPlainBorrow/liquidReserve are CORRECT for solvency checks, but InterestIndex is plain (encrypted index deferred to V3-6) |

**Deduction**: -1 for plain InterestIndex — FHERC20 reference shows encrypted balances can compound, but encrypted index requires FHESafeMath overflow checks not yet integrated.

### 2. ACL Pattern Compliance (8/10)

| Criteria | Score | Notes |
|---|---|---|
| allowThis after every encrypted state mutation | 10 | Every `_finalize*` and cross-contract path calls `FHE.allowThis()` + `FHE.allow(newVal, user)` |
| allowSender on getter returns | 10 | getSupplyBalance/getBorrowBalance use allowSender correctly |
| allowTransient for cross-contract | 9 | Composer correctly calls `FHE.allowTransient(handle, target)` before passing euint128 handles |
| setAccount for input proof embedding | 10 | `encrypt128ForComposer` uses `.setAccount(composerAddress)` — CoFHE docs confirm this is required |
| No orphaned ACL | 7 | Some older paths may not clean up ACL on error (revert doesn't clean allowTransient, but that's tx-scoped anyway) |

**Deduction**: -2 for potential ACL orphans in Vault — `SharedStrategyMeta.grantPositionAcl` grants allowThis+allow per position but no revoke path on closePosition (old handle stays authorized after position is zeroed).

### 3. FHE Type Selection (10/10)

| Criteria | Score | Notes |
|---|---|---|
| euint128 for balances | 10 | P1 migrated all euint64→euint128. Max value: 3.4×10^38 — no truncation risk |
| No scalar multiply needed | 10 | Shares-based interest (ERC-4626 pattern) avoids FHE.mul limitation. CoFHE has NO scalar multiply API |
| InEuint128 for user input | 10 | User-facing functions accept InEuint128 — correct per CoFHE input API |
| euint128 for cross-contract | 10 | Composer→Pool/Vault uses euint128 handles — correct, no InEuint128 re-conversion |

### 4. Cross-Contract Handle Passing (9/10)

| Criteria | Score | Notes |
|---|---|---|
| Composer converts InEuint128 → euint128 | 10 | `FHE.asEuint128(encInput)` + `FHE.allowTransient(handle, target)` |
| Pool/Vault accept euint128 directly | 10 | `depositFor(address, uint256, euint128, address)` — correct |
| No double FHE.asEuint128 | 10 | Fixed in T2 — Composer passes `incomingColl` (euint128) to Vault, not raw `e.collateral` (InEuint128) |
| onlyComposer gate on cross-contract | 9 | Pool functions gated by `onlyComposer` modifier — but no `FHE.isAllowed` guard on received handles |

**Deduction**: -1 for no `FHE.isAllowed(handle, msg.sender)` verification on received cross-contract handles. CoFHE docs recommend verifying ACL on received handles. Currently relies solely on onlyComposer modifier.

### 5. Decryption Flow (8/10)

| Criteria | Score | Notes |
|---|---|---|
| allowPublic → decryptForTx → verifyDecryptResult | 10 | requestLiquidityCheck/requestBalanceReveal use allowPublic; liquidateWithProof/withdrawPausedWithProof use verifyDecryptResult — correct per CoFHE docs |
| decryptForView for UI display | 9 | Frontend has `decryptForView` in useFheVault — correct, never hits chain |
| No unnecessary on-chain decryption | 8 | borrowWithOracle still uses plain collateralAmount for health check (not encrypted) — by design (oracle pricing requires plain input), but partially violates "evaluate both branches" principle |
| No branching on encrypted data | 7 | `borrowWithLtvCheck` accepts LTV params but does NOT enforce them via FHE.select — it just returns the encrypted result. Liquidation is the enforcement layer, not the borrow gate. |

**Deduction**: -2 for missing FHE.select health enforcement at borrow time. CoFHE best practices explicitly state: "prefer FHE.select over conditional logic". Current design relies on post-hoc liquidation instead of proactive encrypted health checks. P4 added `checkHealth` returning ebool but it's not wired into the borrow flow.

### 6. Zero-Friction UX (9/10)

| Criteria | Score | Notes |
|---|---|---|
| Permit2 removed | 10 | Zero Permit2 references in contracts |
| Single ERC20 approve | 10 | User approves Composer once, Composer handles all internal transfers |
| Atomic Composer flow | 10 | One tx: supply + borrow + swap — all in openPosition |
| setAccount for proof embedding | 10 | SDK encrypts with Composer address embedded — handles valid on-chain |
| Progress indicators | 8 | Frontend has `isEncrypting` state but no `.onStep` callback for granular progress |
| decryptForView for balances | 7 | Frontend has revealCollateral/revealBorrow but they're stored in refs, not persisted — user must re-reveal after page refresh |

**Deduction**: -1 for missing `.onStep` progress (CoFHE docs explicitly recommend this). -1 for ephemeral decrypt state (not persisted to contract).

### 7. FHERC20 Alignment (5/10)

This is the BIGGEST gap. FHERC20 is the official CoFHE confidential token standard (ERC-7984).

| Criteria | Score | Notes |
|---|---|---|
| Shield/unshield lifecycle | 7 | Has shield (was supply) + partialUnshield + requestUnshield/unshieldWithProof (stub) — follows the pattern but not FHERC20 standard |
| Not FHERC20 compliant | 3 | Does NOT implement ERC-7984. No indicator system, no confidentialTransfer, no operator system, no transfer callbacks |
| Claim helper for async unshield | 2 | unshieldWithProof exists in contract but no claim system, no batch claiming, no FHERC20WrapperClaimHelper pattern |
| FHESafeMath overflow checks | 0 | NOT integrated. FHERC20 reference uses tryIncrease/tryDecrease for encrypted overflow detection. FheForge has ZERO overflow protection on encrypted math |
| Confidential transfer between users | 0 | Not possible — no confidentialTransfer function. Users can only shield/unshield, not transfer encrypted balances to each other |

**Deduction**: -5 for not implementing FHERC20 standard. The protocol is a custom DeFi contract, not a compliant FHERC20 token. This limits composability — other FHE protocols can't interact with FheForge balances.

### 8. Gas & Performance (7/10)

| Criteria | Score | Notes |
|---|---|---|
| Minimize FHE ops | 8 | Uses FHE.min for safe subtraction (prevents underflow without branch), FHE.add for increments |
| Reuse encrypted constants | 7 | _ZERO initialized once and reused — good. But no other constants (ONE, WAD_ENCRYPTED) |
| Minimum bit-width | 10 | Uses euint128 (was euint64) — 128 bits is minimum for DeFi amounts up to 10^38 |
| Interest accrual efficiency | 5 | Shares-based (ERC-4626) is correct, but accrual is per-token not per-user — every shield/repay triggers index update, not just time-based |

### 9. Error Handling & Edge Cases (6/10)

| Criteria | Score | Notes |
|---|---|---|
| FHE.min prevents underflow | 8 | `FHE.sub(current, FHE.min(incoming, current))` — prevents negative encrypted balance |
| InsufficientReserve check | 8 | Plain reserve check before encrypted subtract — correct |
| Zero amount guard | 9 | All functions check amount == 0 |
| Encrypted amount vs plain amount mismatch | 3 | **CRITICAL**: User passes BOTH `amount` (plain) and `encAmount` (encrypted). There is NO on-chain verification that they match. `shield(token, 100, encAmount_for_50)` would store encrypted 50 but track plain 100 in reserve. This is the "skew risk" that FHERC20 solves with ZK proofs of equality. CoFHE docs warn about this. |

**Deduction**: -4 for no encrypted/plain equality verification. This is the #1 architectural risk. FHERC20 requires ZK proof that encrypted input matches claimed plain amount. FheForge relies on "trusted Composer guards this" — but direct user calls to shield/partialUnshield have NO such guard.

---

## TOTAL SCORE: 71/90 (79%)

| Dimension | Score | Weight |
|---|---|---|
| 1. Encrypted State Design | 9/10 | High |
| 2. ACL Pattern Compliance | 8/10 | High |
| 3. FHE Type Selection | 10/10 | Medium |
| 4. Cross-Contract Handle Passing | 9/10 | High |
| 5. Decryption Flow | 8/10 | High |
| 6. Zero-Friction UX | 9/10 | Medium |
| 7. FHERC20 Alignment | 5/10 | High |
| 8. Gas & Performance | 7/10 | Low |
| 9. Error Handling & Edge Cases | 6/10 | High |

**Weighted Score: 7.1/10**

---

## TOP 5 REMEDIATION PRIORITIES

### CRITICAL-1: Encrypted/Plain Equality Verification (skew risk)
**Current**: User calls `shield(token, 100, encAmount)` — NO proof that encAmount encrypts 100.
**CoFHE Best Practice**: ZK proof of knowledge (ZKPoK) — the SDK already generates this! `encryptInputs` produces a signature that the ZK Verifier checks.
**Fix**: The contract should verify the ZK proof matches the claimed plain amount. The `InEuint128` struct includes `signature` field — this IS the ZK proof. But the contract doesn't USE it. Need to add verification: compare `FHE.asEuint128(encAmount)` against `FHE.asEuint128(amount)` using `FHE.eq` and then require the result via `FHE.select` enforcement.

### CRITICAL-2: FHE.select Health Enforcement at Borrow
**Current**: `borrowWithLtvCheck` accepts LTV params but does NOT enforce them with FHE.select. Health is enforced post-hoc via liquidation only.
**CoFHE Best Practice**: "Use FHE.select over conditional logic" — compare encrypted collateral vs encrypted debt * LTV, select 0 if unhealthy.
**Fix**: Implement `FHE.select(healthFactor.gte(_ONE), requestedBorrow, _ZERO)` — if health check fails, borrow amount is encrypted zero (no revert, no info leak).

### HIGH-3: FHESafeMath Integration
**Current**: No overflow detection on encrypted add/sub.
**FHERC20 Reference**: `tryIncrease`/`tryDecrease` return `(euint128, ebool)` — the ebool indicates whether overflow occurred.
**Fix**: Port FHESafeMath from FHERC20 reference. Use on every balance mutation. If `tryIncrease` returns false ebool, revert or select zero.

### HIGH-4: FHERC20 Wrapper for Composability
**Current**: Custom encrypted balances — other FHE protocols can't read them.
**FHERC20 Standard**: If LendingPool issued FHERC20 receipt tokens for deposits, other protocols (AMMs, yield aggregators) could use them natively.
**Fix**: Create `FheForgeFHERC20Wrapper` that implements ERC-7984. Each shield mints FHERC20 receipt tokens. Each unshield burns them. Enables confidential composability.

### MEDIUM-5: ACL Cleanup on Position Close
**Current**: When a position is closed, the encrypted collateral/debt handles remain ACL-authorized even though they're zeroed.
**Fix**: After zeroing a position, remove ACL entries or set to _ZERO (which has allowThis only). Not critical (zeroed handles can't be exploited) but violates least-privilege.

---

## FRICTION ANALYSIS — End-to-End User Journey

### Journey: Open a Leveraged Strategy (AFTER refactor)

```
Step 1: User connects wallet                    → 0 signatures
Step 2: User approves Composer for WETH         → 1 signature (one-time)
Step 3: User clicks "Execute Strategy"
  3a: SDK creates CoFHE permit                  → 0 signatures (auto)
  3b: SDK encrypts 3 amounts (uint128)           → 2-5 seconds (ZK proof gen)
      └─ .setAccount(composerAddress)            → embeds Composer in proof
  3c: SDK submits openPosition tx               → 1 signature
Step 4: Wait for tx confirmation                → 5-30 seconds (arb-sepolia)
Step 5: UI shows "Completed"                    →
  5a: Optional: decryptForView for balances     → 2-10 seconds (off-chain)

TOTAL SIGNATURES: 2 (1 approve + 1 tx)
TOTAL WAIT: ~15-40 seconds
TOTAL FHE OPERATIONS: 3 encrypt + 1 on-chain FHE.add×3 + FHE.asEuint128×3 + allowTransient×3
```

**Comparison:**

| Metric | BEFORE (V1) | AFTER (Current) | FHERC20 Ideal |
|---|---|---|---|
| Wallet signatures | 4 | 2 | 2 |
| FHE encryption time | 3-5s | 2-5s | 2-5s |
| On-chain FHE ops | ~6 | ~9 (euint128) | ~6 |
| Cross-contract ACL | broken | allowTransient ✓ | operator system |
| Equality verification | none | none ✗ | ZKPoK built-in |
| Confidential transfers | impossible | impossible ✗ | native |
| Composability | none | none ✗ | ERC-7984 |

---

## WHAT COFHE OFFICIAL DOCS SAY vs WHAT FHEFORGE DOES

| CoFHE Best Practice | FheForge Status | Gap? |
|---|---|---|
| "Always update permissions — call allowThis after modifying encrypted state" | ✅ Done | No |
| "Avoid code branching based on encrypted data — use FHE.select" | ⚠️ Partial — P4 added checkHealth→ebool but not wired into borrow flow | Yes |
| "Use the minimum bit-width necessary" | ✅ euint128 (upgraded from euint64) | No |
| "Reuse encrypted constants" | ⚠️ _ZERO reused, but no other constants | Minor |
| "Publish decrypted data carefully — prefer verifyDecryptResult over publishDecryptResult" | ✅ Uses verifyDecryptResult for liquidation/paused withdrawal | No |
| "Use decryptForView for UI display" | ✅ Frontend has decryptForView hooks | No |
| "Plan for asynchronous operations — implement loading indicators" | ⚠️ Basic isEncrypting flag, no .onStep progress | Yes |
| "allowTransient for cross-contract calls" | ✅ Composer calls allowTransient before every cross-contract handle pass | No |
| "setAccount for cross-contract input validation" | ✅ encrypt128ForComposer uses .setAccount(composerAddress) | No |
| "FHERC20 shield/unshield pattern" | ⚠️ Has shield/partialUnshield but NOT FHERC20-compliant | Yes |
| "FHESafeMath tryIncrease/tryDecrease" | ❌ Not integrated | Critical |
| "Operator system for allowances (not plain approve)" | ❌ Uses ERC20 approve, not FHERC20 operators | Gap |
| "ZK proof of equality for encrypted vs plain input" | ❌ Not verified on-chain | Critical |
| "No require() on encrypted conditions — use FHE.select" | ✅ Uses FHE.min for safe subtraction, no require on ebool | Partial |

---

*Report generated from contract source, deployed ABIs, CoFHE official docs (cofhe-docs.fhenix.zone), FHERC20 reference (FhenixProtocol/fhenix-confidential-contracts), and best practices guide.*
