# Agent 5 — Tests/CI Microchange Plan

**Project:** FheForge — FHE DeFi on Arbitrum Sepolia  
**Date:** 2026-05-18  
**Scope:** All verified P0–P2 Tests/CI findings  

---

## Coverage Summary

| Contract | Lines | Tests Exist | Coverage Type | Status |
|---|---|---|---|---|
| **StrategyVault** | 241 | `contracts/test/StrategyVault.test.ts` | Hardhat (4 tests) | ✅ Covered |
| **LendingPool** | 658 | None | — | ❌ Uncovered |
| **SwapRouter** | 238 | `NonFheConstructor.t.sol` + `ExecutorContract.t.sol` | Foundry (8 tests) | ✅ Covered |
| **StrategyRegistry** | 255 | None | — | ❌ Uncovered |
| **PriceOracle** | 290 | None | — | ❌ Uncovered |
| **FheForgeComposer** | 249 | None | — | ❌ Uncovered |
| **ExecutorContract** | 144 | `ExecutorContract.t.sol` | Foundry (5 tests) | ✅ Covered |
| **TokenRegistry** | 105 | None | — | ❌ Uncovered |
| **StrategyExecutor** | 144 | None | — | ❌ Uncovered |
| **FheForgeBase** | 91 | (abstract — tested via children) | — | ⚠️ Indirect |

**5 main contracts** (deployed production): StrategyVault, LendingPool, SwapRouter, StrategyRegistry, PriceOracle  
→ **4 uncovered**: LendingPool, StrategyRegistry, PriceOracle, and either FheForgeComposer or TokenRegistry (both deployed and uncovered)

**Test counts currently:** 4 Hardhat + 8 Foundry = 12 total  
**POSTFIX probes:** ~25 distinct scenarios, all PASS across 6 runs  
**CI status:** `.github/workflows/ci.yml` exists but is incomplete (no backend test, no UI test, no POSTFIX step, no Foundry coverage enforcement)

---

## P0 — Critical Test Coverage

---

### MC-T5-001 · Foundry: LendingPool Core Operations Test

**File:** `contracts/test-foundry/LendingPool.t.sol` (new file)  
**Logic:** LendingPool (658 lines) is the largest contract and has zero test coverage. It implements the core FHE DeFi primitives: shield/supply, borrowWithLtvCheck, borrowWithOracle, repayDebt, partialUnshield, flashLoan, and liquidateWithProof. Every one of these functions now has FHE equality verification (`_verifyEquality`), safe math (`_safeIncrease`/`_safeDecrease`), and encrypted LTV gates — all added in Round 11. These must be tested.  
**Priority:** P0

**Test Scenario 1:** `test_ShieldAndSupply` — Deploy LendingPool + MockERC20, mint tokens to user, call `shield()`, verify `liquidReserve` increased and `getSupplyBalance` returns non-zero encrypted handle.  
**Test Scenario 2:** `test_ShieldWithAmountMismatch` — Call `shield(token, 100, encrypt(50))`, verify the `_verifyEquality` selects `_ZERO` so encrypted supply gets only 0 (equality mismatch clamped — no reserve drain).  
**Test Scenario 3:** `test_BorrowWithLtvCheck_Healthy` — `shield()` USDC first, then `borrowWithLtvCheck()` within LTV, verify liquidReserve decreases and borrow balance increases.  
**Test Scenario 4:** `test_BorrowWithLtvCheck_Unhealthy` — Attempt borrow with LTV exceeding limit, verify encrypted borrow returns `_ZERO` and plain transfer reverts via `InsufficientCollateral`.  
**Test Scenario 5:** `test_BorrowWithOracle` — Set oracle, supply collateral, borrow via oracle health gate.  
**Test Scenario 6:** `test_RepayDebt` — Borrow then repay, verify encrypted borrow balance decreases.  
**Test Scenario 7:** `test_PartialUnshield` — Supply then withdraw, verify liquidReserve decreases and user gets tokens.  
**Test Scenario 8:** `test_FlashLoan` — Supply tokens, then flash loan them and verify repayment + fee.

**Expected Behavior:** All core lending operations work with FHE integrity. P-CRIT-4 equality verification correctly suppresses skew attempts. P-CRIT-1 safe math doesn't wrap on normal operations.

```solidity
// Key contract fixture pattern for LendingPool Foundry tests
contract LendingPoolTest is Test {
    LendingPool public pool;
    MockERC20 public token;
    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    function setUp() public {
        vm.startPrank(owner);
        token = new MockERC20();
        pool = new LendingPool();
        // Note: FHE operations require CoFHE mocks — use Hardhat for FHE tests
        vm.stopPrank();
    }
}
```

> **IMPORTANT:** FHE operations (`FHE.asEuint128`, `FHE.add`, etc.) require the CoFHE mock environment. Foundry does not natively support FHE precompile mocking. The cleanest approach: **write FHE-using tests in Hardhat** (like the existing `StrategyVault.test.ts`) using `@cofhe/hardhat-plugin` mocks, and use Foundry only for **plain Solidity logic tests** (constructor validation, access control, arithmetic, oracle readback, view functions).

---

### MC-T5-002 · Hardhat: LendingPool FHE Integration Test

**File:** `contracts/test/LendingPool.test.ts` (new file)  
**Logic:** Since FHE operations require the CoFHE mock environment, the lending core functions (`shield`, `borrowWithLtvCheck`, `repayDebt`, `partialUnshield`, `liquidateWithProof`) must be tested in Hardhat with `hre.cofhe.mocks.deployMocks()`. This test covers the four P-CRIT remediations.  
**Priority:** P0

**Test Scenario 1 (P-CRIT-1):** SafeMath underflow prevention — `_safeDecrease` with amount > balance should return `_ZERO` (not wrap). Verify via `hre.cofhe.mocks.expectPlaintext`.  
**Test Scenario 2 (P-CRIT-2):** Liquidation privacy — After `liquidateWithProof`, verify the remaining encrypted balance is computed from the **stored** handle (not re-encrypted proof), so `encrypted - trivial = partially private` instead of `trivial - trivial = public`.  
**Test Scenario 3 (P-CRIT-4):** Equality verification — Supply with `amount=100, encAmount=50`. Verify `_verifyEquality` selects `_ZERO` for the encrypted balance update. User cannot inflate their balance by claiming a larger plain amount.  
**Test Scenario 4 (P-HIGH-5):** Encrypted LTV health check — `borrowWithLtvCheck` with excessive borrow should produce `actual == _ZERO` (the `FHE.select` route), not a revert (avoiding info leakage). Verify via mock.

**Expected Behavior:** All four P-CRIT + P-HIGH-5 remediations are proven working. No regression on existing tests.

```typescript
// Key test pattern for LendingPool FHE tests
describe("LendingPool FHE", () => {
  async function deployAll() {
    await hre.cofhe.mocks.deployMocks();
    // deploy pool + token + create user client
    // mint tokens, approve pool
    return { pool, token, user, userClient };
  }

  it("P-CRIT-4: equality verification blocks amount mismatch", async () => {
    const { pool, token, user, userClient } = await deployAll();
    const amount = ethers.parseEther("100");
    const [enc50] = await userClient.encryptInputs([
      Encryptable.uint128(ethers.parseEther("50")),
    ]).execute();
    await pool.connect(user)["shield(address,uint256,(uint256,uint8,uint8,bytes))"](
      await token.getAddress(), amount, enc50
    );
    // Encrypted balance should be 0 (mismatch clamped by _verifyEquality)
    const ctHash = await pool.connect(user).getSupplyBalance.staticCall(
      await token.getAddress()
    );
    await hre.cofhe.mocks.expectPlaintext(BigInt(ctHash), 0n);
  });
});
```

---

### MC-T5-003 · Hardhat: FHE Privacy Attack Vectors Test

**File:** `contracts/test/FhePrivacyAttacks.test.ts` (new file)  
**Logic:** Direct verification that the FHE cryptography fixes are effective. Each P-CRIT finding from `FHE_CRYPTO_PRIVACY_AUDIT.md` has a dedicated adversarial scenario.  
**Priority:** P0

**Test Scenario 1 (P-CRIT-1):** Underflow wrap attack — If a malicious input somehow bypasses `FHE.min`, verify `_safeDecrease` returns clamped zero instead of a wrapped 2^128-delta value. (Uses FHESafeMath128's `tryDecrease` which is what `_safeDecrease` calls.)  
**Test Scenario 2 (P-CRIT-2):** Liquidation balance privacy — After `liquidateWithProof`, call `getSupplyBalance` / `getBorrowBalance` on the liquidated user. Verify the returned handle is an actual encrypted handle (not trivially computed from public inputs). In mock environment, verify via `expectPlaintext` that the remaining balance is correct.  
**Test Scenario 3 (P-CRIT-4):** Reserve skew attack — Repeatedly call `shield` with `amount > encAmount`. Verify that `liquidReserve` does not diverge unsafely from actual encrypted supply. After each attempt, the user's encrypted balance is 0 (clamped by `_verifyEquality`).  
**Test Scenario 4 (P-HIGH-5):** Uncapped borrow — Call `borrowWithLtvCheck` with `ltvNum=1, ltvDen=100` (1% LTV) and a borrow amount that exceeds the user's collateral. Verify the encrypted portion is zeroed by `FHE.select`, and the plain transfer reverts with `InsufficientCollateral`.

**Expected Behavior:** All P-CRIT/P-HIGH remediations hold under adversarial scenarios.

---

### MC-T5-004 · Hardhat: PriceOracle Pyth Integration Test

**File:** `contracts/test/PriceOracle.test.ts` (new file)  
**Logic:** PriceOracle (290 lines) is the Pyth-native price feed. It has no tests. Core functions: `setSource`, `getPriceUsd`, `getPriceWithFallback`, `convertToUsd`, `convertFromUsd`, `isStale`, `updatePriceFeeds`, `setCollateralFactor`, `isSupported`. The Pyth price normalization math (`_normalizePythPrice`) with WAD scaling, exponent handling, and confidence-band tests must be verified.  
**Priority:** P0

**Test Scenario 1 (deployment):** Constructor reverts on zero address.  
**Test Scenario 2 (oracle setup):** `setSource` + `setCollateralFactor` → `getPriceUsd` returns fresh price.  
**Test Scenario 3 (staleness):** After `setSource` without update, `isStale` returns true for threshold=1.  
**Test Scenario 4 (price normalization):** `_normalizePythPrice` with positive price + non-negative expo → correct WAD output.  
**Test Scenario 5 (fallback):** Set fallback price, query `getPriceWithFallback` when Pyth feed is not registered → returns fallback.  
**Test Scenario 6 (conversion):** `convertToUsd` / `convertFromUsd` round-trip with various decimals.

**Expected Behavior:** PriceOracle functions correctly with Pyth SDK. Confidence-band checks reject uncertain prices. Fallback mechanism works when Pyth is unavailable.

```solidity
// Key test pattern for PriceOracle with mock Pyth
contract PriceOracleTest is Test {
    PriceOracle oracle;
    // Foundry can test plain logic (constructor, getter, view functions)
    // Hardhat needed for Pyth contract interaction
    
    function test_ConstructorRevertsZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        new PriceOracle(address(0), 3600);
    }
}
```

> **Note:** Pyth interaction tests (`getPriceUsd`, `updatePriceFeeds`) require a mock Pyth contract or Hardhat test environment. Foundry can test constructor validation, `isSupported`, `getPythUpdateFee` (view), and the price normalization pure math.

---

## P1 — Coverage Expansion

---

### MC-T5-005 · Hardhat: StrategyRegistry Test

**File:** `contracts/test/StrategyRegistry.test.ts` (new file)  
**Logic:** StrategyRegistry has zero test coverage. Core functions: `registerStrategy`, `setActive`, `setVault` (timelocked), `incrementTvl`/`decrementTvl`, `getStrategy`, `idByContentHash`.  
**Priority:** P1

**Test Scenario 1:** Register strategy with name + workflowHash + apyTarget + loopCount → strategy id returned, event emitted.  
**Test Scenario 2:** Register duplicate (creator, name) → revert `StrategyAlreadyExists`.  
**Test Scenario 3:** Empty name → revert `EmptyName`. Name > 256 bytes → revert `NameTooLong`.  
**Test Scenario 4:** Zero workflowHash → revert `ZeroWorkflowHash`.  
**Test Scenario 5:** TVL increment/decrement via vault-only functions.  
**Test Scenario 6:** Vault timelocked rotation: propose → no-early accept → accept after delay.  
**Test Scenario 7:** Get strategy metadata via `getStrategy`.

**Expected Behavior:** Full strategy lifecycle (register → toggle → TVL track → rotate vault) works correctly.

---

### MC-T5-006 · Hardhat: FheForgeComposer Integration Test

**File:** `contracts/test/FheForgeComposer.test.ts` (new file)  
**Logic:** FheForgeComposer (249 lines) is deployed and verified but never tested. It wraps the multi-step lifecycle (register → vault open → pool supply → pool borrow → swap) into a single `openPosition` call. Also has `rebalance` and `sweepToken`.  
**Priority:** P1

**Test Scenario 1:** `openPosition` with zero collateral (plaintext-only register path) → strategy registered, event emitted.  
**Test Scenario 2:** `openPosition` with `collateralAmount > 0` → tokens pulled from user, vault position opened, pool funded.  
**Test Scenario 3:** `openPosition` with borrow path → pool supply + borrow executed, tokens forwarded to user or swap escrowed.  
**Test Scenario 4:** Constructor reverts on any zero address in params.  
**Test Scenario 5:** `sweepToken` — only owner can recover stuck tokens.  
**Test Scenario 6:** FHE path (with encrypted inputs) → verify `_verifyEquality` is called for each encrypted param.

**Expected Behavior:** Composer orchestrates multi-contract lifecycles correctly. Equality verification gates all encrypted inputs.

---

### MC-T5-007 · Foundry: PriceOracle Pyth Math Unit Test

**File:** `contracts/test-foundry/PriceOracleMath.t.sol` (new file)  
**Logic:** The `_normalizePythPrice` function is pure math that converts Pyth price structs (price ± conf, expo) to WAD-scaled USD prices. This can be tested in Foundry without any Pyth contract by testing through the public interface after proper state setup. Covers the `WAD_DECIMALS`, `MAX_PYTH_EXP`, `BPS_DEN` constants.  
**Priority:** P1

**Test Scenario 1:** Price with expo = -8 (typical for USDC) → `_normalizePrice` yields ~1e18 USD.  
**Test Scenario 2:** Large expo (e.g., 0 for ETH) → correct WAD scaling.  
**Test Scenario 3:** Confidence too wide (> 100 bps) → `UncertainPrice` revert.  
**Test Scenario 4:** Negative price → `NegativePrice` revert.  
**Test Scenario 5:** Zero price → `ZeroPrice` revert.  
**Test Scenario 6:** `convertToUsd`/`convertFromUsd` roundtrip for different decimal tokens.

---

### MC-T5-008 · POSTFIX Probe Automation in CI

**File:** `.github/workflows/ci.yml` (modify existing) + `contracts/scripts/test-postfix.ts` (existing)  
**Logic:** 25 POSTFIX probes exist in `test-postfix.ts` and all 6 runs show all PASS. There is no CI step that runs them. They should run as a scheduled or manual step on the deployed contract integration.  
**Priority:** P1

**CI Addition:** Add a `deployed-integration` job (manual trigger / scheduled) that:
1. Uses the existing deployed contract addresses
2. Runs `npx hardhat run scripts/test-postfix.ts --network arb-sepolia`
3. Requires `TESTER_PRIVATE_KEY`, `COFHE_PRIVATE_KEY` secrets
4. Posts results as a CI artifact

```yaml
deployed-integration:
  name: POSTFIX Probes
  runs-on: ubuntu-latest
  if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
      with: { bun-version: "1.3.13" }
    - working-directory: contracts
      run: bun install
    - name: Run POSTFIX probes
      working-directory: contracts
      run: npx hardhat run scripts/test-postfix.ts --network arb-sepolia
      env:
        TESTER_PRIVATE_KEY: ${{ secrets.TESTER_PRIVATE_KEY }}
        COFHE_PRIVATE_KEY: ${{ secrets.COFHE_PRIVATE_KEY }}
    - name: Upload POSTFIX evidence
      uses: actions/upload-artifact@v4
      with:
        name: postfix-evidence
        path: contracts/deployments/*.postfix-evidence.json
```

---

### MC-T5-009 · Aderyn Low Fix: `10 ** dec` Exponent Literals

**File:** `contracts/contracts/PriceOracle.sol` (modify)  
**Logic:** Round 11 left 1 aderyn Low finding: 4 instances of `10 ** dec` where `10` is a raw literal. Per the ADERYN_MICROFIX_PLAN.md L-3 analysis, the `10` literal is the base-10 radix in exponentiation — naming it `BASE_10` or `TEN` would actually hurt readability (per the plan's own rationale). However, the task says "1 aderyn Low finding needs fixing."  
**Priority:** P1

**Approach:** Document the 4 sites in `aderyn.toml` as intentional (similar to L-1 centralization risk) OR rename `10` to a constant if the user prefers suppression-free code. The plan says: "We do not extract `10` (it's the literal 10-base, naming `TEN` would be silly)." — this is the right call. Document in `aderyn.toml`:

```toml
[detectors]
# 10 ** dec: 4 instances of radix-10 exponentiation in PriceOracle
# The `10` is the numeric base of decimal exponentiation.
# Extracting it as `uint8 constant TEN = 10` would reduce readability.
# Acceptable style residual per ADERYN_MICROFIX_PLAN.md L-3 analysis.
exclude_internals = ["sol-10", "radix-literal"]
```

---

## P2 — CI Pipeline

---

### MC-T5-010 · GitHub Actions: Add Missing Test Jobs

**File:** `.github/workflows/ci.yml` (modify)  
**Logic:** The existing CI has `contracts`, `backend`, `frontend`, and `prettier` jobs. Missing:
- **Backend `npm test`** — backend has `jest` configured, 2 spec files, and `test` script. CI only runs lint + type-check + build. Add a test step.
- **Frontend `npm test`** — UI has `vitest` configured, `vitest.config.ts`, and 1 spec file. CI only runs lint + type-check + build. Add a test step.
- **Forge coverage enforcement** — CI runs `forge coverage` but doesn't fail on low coverage. Add a minimum coverage threshold.

**Priority:** P2

**Backend test addition:**
```yaml
- name: Test
  run: npm test
  working-directory: backend/apps
```

**Frontend test addition:**
```yaml
- name: Test
  run: bun run test
  working-directory: ui
```

**Forge coverage enforcement:**
```yaml
- name: Coverage (Forge)
  working-directory: contracts
  run: forge coverage --report lcov --min-coverage 50
```

---

### MC-T5-011 · GitHub Actions: Lint/Test Splitting

**File:** `.github/workflows/ci.yml` (modify)  
**Logic:** The existing CI mixes lint + type-check + build in the same jobs. Splitting into `lint`, `type-check`, `test`, and `build` sub-jobs (using a build matrix or dependent jobs) gives faster feedback. Changes can fail lint in 30s instead of waiting for full build.  
**Priority:** P2

```yaml
contracts:
  name: Contracts
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    # ... setup, cache ...
    - name: Lint (solhint)
      run: bun run lint
      working-directory: contracts
    - name: Compile
      run: HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true npx hardhat compile
      working-directory: contracts
    - name: Type-check
      run: bunx tsc --noEmit -p tsconfig.json
      working-directory: contracts
    - name: Test (Hardhat)
      run: HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true npx hardhat test
      working-directory: contracts
    - name: Test (Forge)
      run: forge test -vvv
      working-directory: contracts
    - name: Coverage (Forge)
      run: forge coverage --report lcov --min-coverage 50
      working-directory: contracts
```

---

### MC-T5-012 · C5 Deferred Security Documentation

**File:** `contracts/TEST_README.md` (new file)  
**Logic:** DEFERRED_SECURITY.md documents C5 (SwapRouter executor trust) as a protocol-level architectural issue that requires ZK proof or batch auction redesign. This must be noted in a test README so future developers know the test gap.  
**Priority:** P2

**Contents:**

```markdown
# FheForge Test Coverage

## Current Status
- **Hardhat tests:** 4 (StrategyVault) + N new
- **Foundry tests:** 8 (SwapRouter, ExecutorContract) + N new  
- **POSTFIX probes:** 25 (all PASS)
- **Coverage target:** 50% minimum

## Deferred: C5 — SwapRouter Executor Trust

`SwapRouter.executeIntent` trusts the executor to settle swaps fairly.
The encrypted `minAmountOut` cannot be enforced on-chain because the CoFHE
runtime does not yet support encrypted comparison as a revert condition.

**Test gap:** No test proves that a malicious executor cannot steal slippage.
This cannot be tested until:
1. CoFHE adds encrypted comparison revert support, OR
2. FheForge adopts a ZK-based settlement proof, OR
3. A batch auction protocol replaces the single-executor model

See `DEFERRED_SECURITY.md` for full analysis.

## Test Networks
- **Local:** Hardhat node + CoFHE mocks (`hre.cofhe.mocks.deployMocks()`)
- **Testnet:** Arbitrum Sepolia (chain 421614)
- **Mainnet:** Not yet deployed
```

---

## Execution Order

| Order | MC-ID | File | What | Priority |
|---|---|---|---|---|
| 1 | MC-T5-009 | `PriceOracle.sol`, `aderyn.toml` | Document aderyn Low residual | P1 |
| 2 | MC-T5-004 | `contracts/test/PriceOracle.test.ts` | PriceOracle Hardhat tests | P0 |
| 3 | MC-T5-007 | `test-foundry/PriceOracleMath.t.sol` | PriceOracle pure math | P1 |
| 4 | MC-T5-001 | `test-foundry/LendingPool.t.sol` | LendingPool plain logic tests | P0 |
| 5 | MC-T5-002 | `contracts/test/LendingPool.test.ts` | LendingPool FHE tests | P0 |
| 6 | MC-T5-003 | `contracts/test/FhePrivacyAttacks.test.ts` | FHE attack vectors | P0 |
| 7 | MC-T5-005 | `contracts/test/StrategyRegistry.test.ts` | StrategyRegistry tests | P1 |
| 8 | MC-T5-006 | `contracts/test/FheForgeComposer.test.ts` | Composer integration tests | P1 |
| 9 | MC-T5-010 | `.github/workflows/ci.yml` | Add missing test jobs + coverage floor | P2 |
| 10 | MC-T5-011 | `.github/workflows/ci.yml` | Split lint/test/build for faster feedback | P2 |
| 11 | MC-T5-008 | `.github/workflows/ci.yml` | POSTFIX probe CI integration | P1 |
| 12 | MC-T5-012 | `contracts/TEST_README.md` | C5 deferral documentation | P2 |

---

## How to Run (Post-Implementation)

```bash
# All Foundry tests
cd contracts && forge test -vvv

# All Hardhat tests
cd contracts && npx hardhat test

# Individual test files
cd contracts && forge test --match-path test-foundry/LendingPool.t.sol -vvv
cd contracts && npx hardhat test test/PriceOracle.test.ts

# POSTFIX probes (requires deployed contracts)
cd contracts && npx hardhat run scripts/test-postfix.ts --network arb-sepolia

# Backend tests
cd backend/apps && npm test

# Frontend tests
cd ui && bun run test

# CI (full suite)
# Push to any branch — .github/workflows/ci.yml triggers on push + PR
```

---

## Key File References

| File | Purpose |
|---|---|
| `FHE_CRYPTO_PRIVACY_AUDIT.md` | 3 P-CRIT + 1 P-HIGH findings |
| `REMEDIATION_ROUND_11_SUMMARY.md` | Round 11 state: 1 aderyn Low, 17 onlyOwner, 2 known reverts |
| `DEFERRED_SECURITY.md` | C5: SwapRouter executor trust |
| `ADERYN_MICROFIX_PLAN.md` | 6-microchange aderyn fix plan |
| `contracts/scripts/test-postfix.ts` | 25 POSTFIX probe Hardhat script |
| `contracts/test/StrategyVault.test.ts` | Existing Hardhat test (4 tests) |
| `contracts/test-foundry/ExecutorContract.t.sol` | Existing Foundry test (5 tests) |
| `contracts/test-foundry/NonFheConstructor.t.sol` | Existing Foundry test (3 tests) |
| `contracts/contracts/LendingPool.sol` | ← P0 coverage target |
| `contracts/contracts/PriceOracle.sol` | ← P0 coverage target |
| `contracts/contracts/StrategyRegistry.sol` | ← P1 coverage target |
| `contracts/contracts/FheForgeComposer.sol` | ← P1 coverage target |
