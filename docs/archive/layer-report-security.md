LAYER REPORT — Security & Formal Verification
================================================================================
files_owned: 9 (5 docs + 4 certora specs) | files_verified: 9/9
entry_points: N/A — audit artifacts, not runtime code

================================================================================
1. SECURITY POSTURE — SUMMARY
================================================================================

Overall Risk: MEDIUM-HIGH (contract-level) / MEDIUM (protocol-level)

| Contract              | Risk Rating    | Key Concern                                          |
|-----------------------|----------------|------------------------------------------------------|
| LendingPool           | Medium-High    | Dual-input gap, composer privilege, oracle dependence|
| StrategyVault         | Low-Medium     | Position owner is Composer, no health check on close |
| SwapRouter            | Medium         | Executor compromise risk, timelocked rotation        |
| PriceOracle           | Medium         | Fallback price centralization, batch timestamp issue |
| StrategyExecutor      | Low-Medium     | Infinite approval pattern, checkpoint reuse          |
| ExecutorContract      | Medium         | Single-owner hot wallet                              |
| FheForgeComposer      | Low-Medium     | Multi-step atomicity, orchestrator privilege         |
| FheForgeBase          | Low            | Custom bitflag guard is non-standard but correct     |
| GovernanceModule      | Low-Medium     | Standard OZ Governor, standard DAO risks             |

The protocol's threat model assumes trust in privileged roles (owner, composer,
executor) and relies on `_verifyEquality` as the sole on-chain gate for the
dual plaintext+encrypted input pattern. FHE privacy is partially compromised
by several public view functions (see §2).

================================================================================
2. KEY FINDINGS — CRITICAL / HIGH
================================================================================

CRIT-1  `_verifyEquality` does not gate token transfers (Dual Input Gap)
        Source: DUAL_INPUT_AUDIT.md (13 call sites, 9 HIGH, 4 MEDIUM)
        All 13 call sites accept both plaintext (uint256) and encrypted
        (euint128/InEuint128) from the caller. `_verifyEquality` checks
        internal consistency, but:
        - 2 sites (shield, repayDebt): token transfer BEFORE equality check
        - Remaining HIGH sites: token transfer AFTER verify but UNCONDITIONAL
        - Failure impacts: user loss, free money (protocol loss), TVL inflation,
          double-withdrawal (closePosition partial close)
        - Attack scenarios documented: ciphertext mismatch on borrow (free
          money), withdraw (drain protocol), closePosition (double-withdrawal)
        - Mitigation planned: CoFHE ZK proof of equality (MC-035, post-MVP)

CRIT-2  `requestLiquidityCheck` has no access control
        Source: PUBLIC_STATE_AUDIT.md (🔴 R3)
        Anyone can call `FHE.allowPublic` on any user's supply and borrow
        balances. No economic barrier (Arbitrum sub-cent gas). Enables mass
        position scrape attack — complete protocol position map.

CRIT-3  `getDepositedAmount` exposes plaintext vault position sizes
        Source: PUBLIC_STATE_AUDIT.md (🔴 R5 — NEW, missed by prior crypto audit)
        Stored as plain `uint256` (private mapping) but returned via public
        view. Combined with `getUserPositions` (🟡 Y4), attacker enumerates
        every user's full vault portfolio. Makes encrypted `euint128` vault
        collateral storage privacy-theater.

CRIT-4  `allowPublic` grants are permanent — no revocation
        Source: PUBLIC_STATE_AUDIT.md (🔴 R1-R4)
        `requestBalanceReveal`, `requestBorrowReveal`, `requestLiquidityCheck`,
        `requestUnshield` all call `FHE.allowPublic`. No mechanism to revoke
        or rotate encryption keys. Once revealed, data is public forever.

HIGH-5  ExecutorContract is a single-owner hot wallet
        Source: security-review.md (§2.6)
        Owner can execute any swap intent, withdraw any token. Only 3 functions,
        all `onlyOwner`. Security relies entirely on owner key management.

HIGH-6  Composer has unchecked borrowing authority
        Source: security-review.md (§2.1)
        `borrowFor()` has no LTV or collateral check. If Composer is
        compromised, user funds can be borrowed against. Immediate `setComposer()`
        with no timelock.

HIGH-7  Fallback price manipulation via owner
        Source: security-review.md (§2.4)
        Owner sets arbitrary fallback prices. If Pyth goes stale, owner can
        set prices that enable liquidation of positions at arbitrary thresholds.

MED-8   `updatePriceFeeds()` marks ALL tokens as fresh
        Source: security-review.md (§2.4) — recommendation R4
        Regardless of which feeds were actually updated, all tokens get
        their `lastPriceUpdate` set to block.timestamp. Minor staleness issue.

MED-9   `swapFlow` in Composer skips `_verifyEquality`
        Source: certora/FheForgeComposer.spec (swapFlow_noVerifyRequired)
        By design — swapAmountIn comes from borrowed amount which is either
        independently verified (useOracleBorrow) or zero. But if borrow
        verification failed, swap could still execute with borrowed tokens.

MED-10  LendingPool events still emit plain amounts
        Source: PUBLIC_STATE_AUDIT.md (P-HIGH-6, confirmed)
        StrategyVault events were fixed (no plain amounts). LendingPool events
        (Supplied, Borrowed, Repaid, Withdrawn, Liquidated) still carry plain
        amounts. Events create a plaintext audit trail mirroring encrypted state.

================================================================================
3. PUBLIC STATE EXPOSURE — PRIVACY LEAKAGE
================================================================================

Heat Map:
  Contract              GREEN  YELLOW  RED   Risk Score
  LendingPool            7      2       3    MEDIUM-HIGH
  StrategyVault          1      1       2    MEDIUM
  StrategyRegistry       7      1       0    LOW
  SwapRouter             5      0       0    LOW
  TokenRegistry          6      0       0    LOW
  PriceOracle           16      0       0    LOW
  StrategyExecutor       1      0       0    LOW
  ExecutorContract       0      0       0    NONE
  FheForgeBase           4      0       0    LOW

  Total (scoped):       47+     5       5    —

🔴 RED Functions (Individual Position Leaked):
  R1  LendingPool.requestBalanceReveal    — Permanent allowPublic on caller's supply
  R2  LendingPool.requestBorrowReveal     — Permanent allowPublic on caller's borrow
  R3  LendingPool.requestLiquidityCheck   — allowPublic on ANY user's balances, no ACL
  R4  LendingPool.requestUnshield          — allowPublic + event with token
  R5  StrategyVault.getDepositedAmount    — Plaintext position size (NEW finding)

🟡 YELLOW Functions (Handle Reuse / Aggregated):
  Y1  LendingPool.getSupplyBalance        — Encrypted handle with allowSender reuse
  Y2  LendingPool.getBorrowBalance        — Same as Y1
  Y3  StrategyVault.getCollateral         — Encrypted handle ACL reuse
  Y4  StrategyVault.getUserPositions      — Enables position enumeration
  Y5  StrategyRegistry.getEncryptedTvl    — Encrypted TVL handle reuse

Privacy Integrity Scorecard:
  Property                                    Status
  Supply balances encrypted in storage        ✅ True
  Supply balances NOT leaked via views        ❌ False (requestLiquidityCheck)
  Borrow balances encrypted in storage        ✅ True
  Borrow balances NOT leaked via views        ❌ False (requestLiquidityCheck)
  Vault collateral encrypted in storage       ✅ True
  Vault collateral size NOT leaked            ❌ False (getDepositedAmount)
  Strategy TVL encrypted and private          ✅ True
  Events do NOT leak plain amounts            ⚠️ Partial (LP events leak; SV fixed)
  Only user can decrypt own data              ❌ False (requestLiquidityCheck)

================================================================================
4. DUAL INPUT / CIPHERTEXT EQUALITY — THE FUNDAMENTAL GAP
================================================================================

`_verifyEquality` is the sole on-chain gate preventing mismatch between
caller-provided plaintext and encrypted values. It uses `FHE.eq` (CoFHE
ciphertext comparison) to check consistency.

The gap: `_verifyEquality` returns either `incoming` (match) or `_ZERO`
(mismatch). The return value ONLY affects encrypted state (supplyBalances,
borrowBalances, collateral). Plaintext token transfers execute independently:

  shield()          safeTransferFrom BEFORE verify    [FAIL: user loses tokens]
  borrowWithLtvCheck()  safeTransfer AFTER verify (unconditional) [FAIL: free money]
  repayDebt()       safeTransferFrom BEFORE verify    [FAIL: user overpays]
  _withdrawCore()   safeTransfer AFTER verify (unconditional) [FAIL: protocol loses liq]
  shieldEth()       weth.deposit AFTER verify (unconditional) [FAIL: user loses ETH]
  borrowWithOracle()  safeTransfer AFTER verify (unconditional) [FAIL: free money]
  closePosition()   safeTransfer AFTER verify (unconditional) [FAIL: double-withdrawal]

Failure Mode Impacts (13 sites):
  User loss (tokens taken, state not updated):         shield, shieldEth, repayDebt,
                                                       all Composer user→protocol flows
  Protocol loss (tokens sent, debt not recorded):      borrowWithLtvCheck,
                                                       borrowWithOracle, _withdrawCore,
                                                       Composer borrow flows
  TVL inflation / double-withdrawal:                   closePosition (partial close)

Additional dependency: `FHE.eq` behavior on Arbitrum Sepolia CoFHE TaskManager
is NOT verified. If `FHE.eq` compares ciphertext hashes rather than plaintexts,
every `_verifyEquality` call silently returns `_ZERO` — catastrophic failure.

================================================================================
5. FORMAL VERIFICATION COVERAGE
================================================================================

5.1 What is Formally Specified (CVL — Certora Verification Language)

All specs are CERTORA PROVER specification skeletons with ghost abstractions
for FHE operations. They have NOT yet been run against the Prover (require
CERTORAKEY). Expected results document known FAIL states.

  | Spec              | Rules | Focus                                      | Status |
  |-------------------|-------|---------------------------------------------|--------|
  | FheForge.spec     |     3 | Core invariants A (EqualityGateSoundness),  | ⚠️ Skeletons |
  |                   |       | B (StateMutationOrdering),                  |        |
  |                   |       | C (ReentrancyGuardActive)                   |        |
  | LendingPool.spec  |     9 | 6 HIGH-site per-function rules +            | ⚠️ Skeletons |
  |                   |       | 3 composer-gated onlyComposer rules         |        |
  | StrategyVault.spec|     3 | closePosition_verifyGatesTransfer,          | ⚠️ Skeletons |
  |                   |       | closePosition_noDoubleWithdrawal,           |        |
  |                   |       | closePosition_fullCloseCompleteCleanup      |        |
  | FheForgeComposer  |     3 | openPosition_allThreeVerifiesExecuted,      | ⚠️ Skeletons |
  | .spec             |       | rebalance_multipleVerifiesInOrder,          |        |
  |                   |       | swapFlow_noVerifyRequired                   |        |

Expected Results:
  Rule                                    Status  Notes
  EqualityGateSoundness                   ⚠️ Part Known violations on shield, repayDebt
  StateMutationOrdering                   ✗ FAIL  Detects known ordering violations
  ReentrancyGuardActive                   ✓ Pass  nonReentrant correct on all public fns
  shield_verifyEqualityBeforeTransfer     ✗ FAIL  Known — safeTransferFrom before verify
  borrowWithLtvCheck_tokenConditional...  ⚠️ Part Verify-but-unconditional-transfer pattern
  repayDebt_verifyEqualityBeforeTransfer  ✗ FAIL  Known — safeTransferFrom before verify
  closePosition_noDoubleWithdrawal        ✗ FAIL  Known — double-withdrawal vector
  closePosition_fullCloseCompleteCleanup  ✓ Pass  placeholder — TVL consistency pending

5.2 What is Manually Reviewed

  All 9 core contracts:
    - Contract-by-contract security analysis (security-review.md, 515 lines)
    - Attack vector enumeration and mitigation assessment
    - FHE-specific threat modeling (ciphertext malleability, decryption oracle,
      proof replay, ACL cross-user isolation)
    - 20+ attack vectors documented

  All public/external view functions (PUBLIC_STATE_AUDIT.md, 559 lines):
    - 47+ GREEN functions (no FHE data)
    - 5 YELLOW functions (handle reuse / aggregated)
    - 5 RED functions (position leakage)
    - 2 findings missed by prior crypto audit

  All 13 _verifyEquality call sites (DUAL_INPUT_AUDIT.md, 429 lines):
    - Code flow analysis per site with line references
    - Failure mode analysis with financial impact
    - Attack scenarios with step-by-step execution

5.3 What is Verified vs. Unverified

  Verified (by manual review + testing):
    - Reentrancy protection: nonReentrant on all state-changing functions
    - FHE math safety: FHESafeMath128 overflow/underflow detection
    - Cross-user ACL isolation: per-user FHE.allow scoping
    - Ciphertext validation: _validateCiphertext reverts on null handles
    - Two-step ownership transfer pattern
    - Oracle staleness + confidence interval validation
    - Same-block close guard in StrategyVault
    - CannotSelfLiquidate() guard
    - Timelocked executor rotation

  Unverified / Dependent on CoFHE Runtime:
    - FHE.eq implementation on Arbitrum Sepolia CoFHE TaskManager
      (ciphertext hash vs. plaintext comparison)
    - FHE.verifyDecryptResult threshold signature correctness
    - FHE.allowPublic/FHE.allow/FHE.allowTransient ACL correctness
    - Ciphertext malleability resistance at the CoFHE level
    - All formal CVL specs (require Certora Prover run with CERTORAKEY)
    - FHESafeMath128 formal equivalence (recommended for HEVM)

  Explicitly Planned but Not Yet Implemented:
    - CoFHE ZK proof of equality (MC-035, estimated 4-8 weeks for circuit
      design + on-chain verifier + audit)

5.4 Recommended Verification Approach (from FORMAL_VERIFICATION_SPEC.md)

  Phase 1 (16-19 days): Certora CVL — prove invariants A/B/C via ghost FHE
    abstraction. Identifies execution ordering and gating violations.
  Phase 2 (5 days): Scribble runtime annotations on all 13 HIGH sites.
    Continuous monitoring in staging/test with fuzzing.
  Phase 3 (5-8 weeks): CoFHE ZK proof of equality — replaces caller-provided
    plaintext trust with cryptographic proof.

================================================================================
6. ANOMALIES AND NOTABLE ISSUES
================================================================================

A-1  `getDepositedAmount` defeats FHE privacy entirely
     The plain `uint256` `positionDepositedAmount` mapping makes encrypted
     `euint128` vault collateral storage privacy-theater. Missed by prior
     crypto audit. Fix: remove or encrypt.

A-2  `requestLiquidityCheck` grants permanent `allowPublic` on third-party data
     No access control, no rate limit, no revocation. Enables mass position
     scrape for pennies per user on Arbitrum. Should have caller ACL (e.g.,
     hold debt token) or cooldown.

A-3  FHE.eq behavior against deployed CoFHE coprocessor is unknown
     If `FHE.eq(ciphertext, trivial_encrypt(plaintext))` compares ciphertext
     hashes instead of plaintexts, every `_verifyEquality` call silently fails.
     This is a single-upstream-dependency verification gap that affects all
     13 call sites.

A-4  Composer `borrowFor` has no LTV or collateral check
     Immediate `setComposer()` with no timelock. If compromised, attacker can
     drain protocol. Needs TimelockedRotation or minimum delay.

A-5  `updatePriceFeeds()` batch timestamp bug
     Marks ALL tokens as fresh even if only a subset of Pyth feeds were
     updated. Minor — only affects the fallback staleness check — but a
     deviation from the documented behavior.

A-6  LendingPool events leak plain amounts despite prior P-HIGH-6 finding
     StrategyVault events were remediated; LendingPool events were not.
     Creates a plaintext audit trail that mirrors encrypted state.

A-7  Certora specs are skeletons, not verified proofs
     All 4 certora spec files contain CVL rules with NONDET FHE summaries and
     ghost abstractions, but they have NOT been run against the Certora Prover.
     Many rules contain `assert true` placeholders (LendingPool: 4/9,
     FheForgeComposer: 3/3, StrategyVault: 3/3). The `FheForge.conf` config
     file referenced in README.md was NOT found in the certora directory.

A-8  Double-withdrawal vector on StrategyVault.closePosition partial close
     If `_verifyEquality` fails on partial close: positionDepositedAmount is
     decremented in plaintext, tokens are transferred, but encrypted collateral
     and TVL remain unchanged. Owner can repeat the withdrawal. Concrete
     attack scenario documented in DUAL_INPUT_AUDIT.md (§9, Scenario C).

================================================================================
7. OPEN QUESTIONS
================================================================================

Q1  Has `FHE.eq` been integration-tested against the deployed CoFHE
    TaskManager on Arbitrum Sepolia? The known issue from ADR-002 and
    DUAL_INPUT_AUDIT.md §2 (Scenario C) remains unverified.

Q2  Are the Certora specs intended to be run before mainnet deployment?
    The README.md references a `FheForge.conf` that does not exist in the
    certora directory. All specs contain NONDET summaries that must be
    validated against real execution traces.

Q3  What is the plan for `allowPublic` revocation? PUBLIC_STATE_AUDIT.md
    recommends key rotation or re-encryption (PA-3), noting it requires
    CoFHE runtime support. Any timeline for this?

Q4  The `swapFlow_noVerifyRequired` rule in FheForgeComposer.spec documents
    that swap amount skips _verifyEquality. What ensures the borrowed amount
    (which funds the swap) was successfully verified before the swap executes?

================================================================================
8. SUMMARY
================================================================================

Security posture: The protocol has a thoughtful architecture with FHE-specific
mitigations (ciphertext validation, homomorphic safe math, ACL isolation,
cross-user encrypted state). However, three critical gaps exist:

  1. Dual-input verification gap — `_verifyEquality` does not control token
     transfers, enabling free-money, user-loss, and double-withdrawal attacks
     across 13 call sites.
  2. Privacy leakage — 5 RED functions expose individual positions, including
     `getDepositedAmount` (missed by prior audit) and `requestLiquidityCheck`
     (unrestricted mass scrape).
  3. Centralization risk — owner/composer/executor roles have broad powers
     with minimal constraints; multi-sig and timelocks recommended.

Formal verification is planned but incomplete: 4 CVL spec files define
invariants and document expected failures, but none have been proven against
the Certora Prover. Many rules use placeholder `assert true` statements.
The recommended three-phase approach (Certora CVL → Scribble → ZK Proof) is
sound but requires implementation commitment and the CoFHE ZK circuit (MC-035)
is the only complete fix for the dual-input gap.

Two high-confidence recommendations: (1) immediately gate token transfers on
`_verifyEquality` result (R1 in DUAL_INPUT_AUDIT.md) as a short-term fix;
(2) deploy multi-sig governance before mainnet (R2 in security-review.md).

================================================================================
