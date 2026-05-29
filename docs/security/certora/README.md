# FheForge — Certora Formal Verification Specs

This directory contains CVL (Certora Verification Language) specification files for
formal verification of FheForge's core security invariants.

## File Organization

| File | Scope | Rules |
|---|---|---|
| `FheForge.spec` | All 3 contracts | Rule A (EqualityGateSoundness), Rule B (StateMutationOrdering), Rule C (ReentrancyGuardActive), helper ghosts/hooks |
| `LendingPool.spec` | LendingPool only | 6 HIGH-site per-function rules + 3 Composer-gated rules |
| `FheForgeComposer.spec` | FheForgeComposer only | openPosition all-three-verifies, rebalance ordering, swap flow |
| `StrategyVault.spec` | StrategyVault only | closePosition token gating, double-withdrawal prevention, full-close cleanup |
| `FheForge.conf` | Config | Certora Prover CLI configuration |

## Running the Verification

### Prerequisites

1. Install certora-cli:
   ```bash
   pip install certora-cli
   ```

2. Set your Certora API key:
   ```bash
   export CERTORAKEY=your_api_key_here
   ```

3. Ensure solc 0.8.28 is available:
   ```bash
   solc-select install 0.8.28
   solc-select use 0.8.28
   ```

### Running All Specs

```bash
certoraRun \
    contracts/contracts/FheForgeBase.sol \
    contracts/contracts/LendingPool.sol \
    contracts/contracts/FheForgeComposer.sol \
    contracts/contracts/StrategyVault.sol \
    contracts/contracts/StrategyRegistry.sol \
    --verify LendingPool:docs/security/certora/LendingPool.spec \
    --verify FheForgeComposer:docs/security/certora/FheForgeComposer.spec \
    --verify StrategyVault:docs/security/certora/StrategyVault.spec \
    --settings "-multiAssertCheck" \
    --loop_iter 3 \
    --solc_map \
    --msg "FheForge — Full Formal Verification Suite"
```

### Running Core Only (FheForge.spec)

```bash
certoraRun \
    contracts/contracts/FheForgeBase.sol \
    contracts/contracts/LendingPool.sol \
    contracts/contracts/FheForgeComposer.sol \
    contracts/contracts/StrategyVault.sol \
    --verify LendingPool:docs/security/certora/FheForge.spec \
    --settings "-multiAssertCheck" \
    --loop_iter 3 \
    --msg "FheForge — Core Invariants"
```

## Expected Results

| Rule | Current Status | Expected After Fix | Notes |
|---|---|---|---|
| `EqualityGateSoundness` | ⚠ Partial pass | ✓ All pass | Fails on shield, repayDebt (violated order) |
| `StateMutationOrdering` | ✗ FAIL | ✓ All pass | Detects known violations in §4 of DUAL_INPUT_AUDIT.md |
| `ReentrancyGuardActive` | ✓ Pass | ✓ Pass | nonReentrant correct on all public functions |
| `shield_verifyEqualityBeforeTransfer` | ✗ FAIL | ✓ Pass | Known — safeTransferFrom before verify |
| `borrowWithLtvCheck_tokenConditionalOnVerify` | ⚠ Partial | ✓ Pass | Verify-but-unconditional-transfer pattern |
| `repayDebt_verifyEqualityBeforeTransfer` | ✗ FAIL | ✓ Pass | Known — safeTransferFrom before verify |
| `closePosition_noDoubleWithdrawal` | ✗ FAIL | ✓ Pass | Known — double-withdrawal vector on partial close |

## References

- `docs/security/FORMAL_VERIFICATION_SPEC.md` — Full specification document
- `docs/security/DUAL_INPUT_AUDIT.md` — Complete _verifyEquality call site audit
- `docs/security/WAVE2_REVIEW.md` — MF-1 (P0 finding), MF-6 (CoFHE dependency)
- `docs/ADR-002-cofhe-fhe-integration.md` — Design rationale for _verifyEquality
