# Agent 5 Critique — Integration / E2E Testing Findings

**Critique of:** Wave 1 Audit, Section 5 (Integration / E2E Testing)  
**Source files:** `WAVE1_MANIFEST.md` (§5), `agent-5-tests-ci.md`  
**Review date:** 2026-05-18  
**Critic:** Sisyphus (Verification Pass)

---

## Summary Assessment

The Wave 1 test audit correctly identifies the most critical gaps — 4 of 5 deployed contracts have zero coverage, and the CI pipeline is incomplete. However, several severity ratings are wrong, critical edge cases are missing from the proposed test scenarios, and the execution order ignores dependency chains that will waste implementation time. The audit also entirely misses several categories of testing that should exist.

**Bottom line:** 6 of 12 severity ratings need adjustment. At least 4 major missed findings exist. The proposed execution order needs significant rework.

---

## Finding-by-Finding Critique

---

### TEST-P0-1: LendingPool zero test coverage (MC-T5-001)

**Severity:** P0  
**Original classification:** P0 ✅ Correct

**Is severity correct?** Yes. LendingPool (658 lines) is the largest contract and the core of the protocol. Zero tests for a contract handling FHE supply/borrow/liquidation is correctly P0.

**Missed edge cases / scenarios:**
- **Multi-user contention:** All 8 proposed scenarios use a single user. No test covers two users supplying the same token, or one user borrowing against another user's supply. The `liquidReserve` invariant test is missing — verifying that `liquidReserve == sum(getPlainSupplyBalance) + sum(totalPlainBorrow)` across multiple users.
- **Reentrancy during flash loan:** Test Scenario 8 (flash loan) doesn't verify that reentrancy guard prevents callback-based attacks. Should test that a malicious receiver contract cannot re-enter during the flash loan callback.
- **Pause/unpause state transitions:** No test verifies that `whenNotPaused` guards work correctly — supply/borrow/repay/withdraw all revert when paused, but `withdrawPausedWithProof` (which has `whenPaused`) works. The Foundry test should verify this state-dependent behavior.
- **Edge: supply with zero `amount` but non-zero `encAmount`:** Tests clarify that `amount > encAmount` is clamped. But what about `amount = 0, encAmount = 100`? The plain transfer does nothing, but the encrypted balance might still update. This needs testing.
- **Edge: `liquidateWithProof` with zero debt:** What happens when a liquidator calls with `debtToCover = 0`? Expected: revert `ZeroAmount`. But does the FHE path also handle this?
- **Edge: `_finalizeRepay` when repay amount exceeds debt:** The `FHE.sub + FHE.min` pattern should clamp to zero. Verify via mock that over-repaying doesn't create negative (wrapped) debt.

**Implementation risks when fixing:**
- Foundry cannot test FHE operations. The plan correctly notes this, but the proposed `LendingPoolTest` fixture imports `LendingPool` which has FHE imports (`import "../FHE.sol"`). This will **fail to compile in Foundry** unless `FHE.sol` is also mocked. The existing `ExecutorContract.t.sol` works because it only imports contracts without FHE. For LendingPool, Foundry can only test constructor validation and non-FHE view functions. Most of the 8 scenarios need Hardhat anyway.
- The `_verifyEquality` and `_safeIncrease`/`_safeDecrease` functions were added in Round 11 and are internal — they can only be tested indirectly through public functions that call them.

**Dependencies on other domains:**
- Smart Contracts domain (SC-P2-2: interest accrual) — if interest accrual is implemented, the LendingPool tests need updating to account for accrual effects on supply/borrow balances.
- Infrastructure domain (INFRA-P0-4/5: wrong contract addresses) — Foundry tests use fresh deployments, but Hardhat FHE integration tests need correct mock addresses. If CoFHE mock addresses change, tests break.

---

### TEST-P0-2: LendingPool FHE integration missing (MC-T5-002)

**Severity:** P0  
**Original classification:** P0 ✅ Correct

**Is severity correct?** Yes. The 4 P-CRIT findings are the most critical security issues in the codebase. Having zero tests that verify their fixes is P0.

**Missed edge cases / scenarios:**
- **P-CRIT-3 (FHE.add overflow) is NOT tested:** The proposed test covers P-CRIT-1 (underflow), P-CRIT-2 (liquidation privacy), P-CRIT-4 (equality verification), and P-HIGH-5 (LTV enforcement). But P-CRIT-3 (FHE.add overflow causing balance inflation) has no dedicated scenario. The FHESafeMath `tryIncrease` pattern needs a test where supply exceeds 2^128-1 (or is forced to via mock).
- **No cross-user FHE isolation test:** Verify that user A's encrypted supply/borrow cannot be manipulated by user B's operations. The existing StrategyVault test covers cross-user collateral reads (test 4), but LendingPool has no equivalent.
- **No `liquidateWithProof` path with actual stored handle:** P-CRIT-2 fix uses `borrowBalances[debtToken][user]` (stored handle) instead of re-encrypted proof. The test should verify this specific change — not just that remaining balance is correct, but that the returned handle is the correct one (not re-created from trivial inputs).
- **No FHE.allowPublic verification:** `requestLiquidityCheck` calls `FHE.allowPublic` on user balances. The test should verify that after this call, the liquidator's contract can actually read the balance (not just that the function doesn't revert).

**Implementation risks when fixing:**
- CoFHE mock environment (`hre.cofhe.mocks.deployMocks()`) may not support all FHE operations. The `FHE.eq`, `FHE.select`, and `FHESafeMath` mock behaviors need verification. If mocks don't support `tryDecrease`/`tryIncrease`, the tests cannot validate the FHESafeMath integration.
- CoFHE mock `expectPlaintext` API may change between versions. The test file will be tightly coupled to the mock API.
- Hardhat tests are slower than Foundry tests (~5-10x). Adding 4 tests is fine now, but the test suite will need parallelization if scaled.

**Dependencies on other domains:**
- Smart Contracts (SC-P0-1, SC-P1-1, SC-P1-3) — these FHE remediations must be applied BEFORE the tests can pass. If remediation hasn't happened, the tests will fail (which is correct — they prove the fix works).
- FHE_CRYPTO_PRIVACY_AUDIT.md — the 4 P-CRIT findings were identified by the crypto audit agent. If the audit missed findings (it already missed P-CRIT-3 testing gap), the tests don't cover them.

---

### TEST-P0-3: No FHE privacy attack vector tests (MC-T5-003)

**Severity:** P0  
**Original classification:** P0 ✅ Correct

**Is severity correct?** Yes. Adversarial testing is the only way to prove FHE privacy fixes work. Correct at P0.

**Missed edge cases / scenarios:**
- **P-MED-10 (requestLiquidityCheck unrestricted) is not tested:** The proposed scenarios test P-CRIT-1/2/4 and P-HIGH-5 but ignore P-MED-10 — the finding that anyone can decrypt any user's balances. An adversarial test should verify that a third party cannot enumerate all user balances via `requestLiquidityCheck`.
- **P-MED-11 (withdrawPaused zeros borrow) not tested:** If `withdrawPausedWithProof` zeros borrow without requiring proof of repayment, test that a user can escape debt during pause.
- **P-HIGH-6 (event plaintext leakage) not tested:** The adversarial scenarios don't check whether events leak privacy-sensitive information. A test should verify that `Supplied`/`Borrowed` events don't contain plain amounts (if remediated), or document that they still do (if deferred).
- **Timing attack via `require`:** P-HIGH-5 and the SameBlockClose finding involve information leakage via revert/no-revert. The test should verify that a watcher cannot determine user health status by calling `borrowWithLtvCheck` and observing revert behavior.
- **Brute-force decryption attempt:** Test that calling `decryptForView` on another user's handle without a permit correctly reverts. (This tests the FHE ACL, not just the application code.)
- **Ciphertext malleability:** The ZK Verifier protects against CCA. But test that a modified ciphertext (bit-flipped) cannot produce a valid but different plaintext. This tests the CoFHE SDK, not FheForge per se, but it's important for adversarial documentation.

**Implementation risks when fixing:**
- The mock environment may not support adversarial patterns (e.g., simulating a malicious ciphertext or a CoFHE coprocessor bug). Some scenarios may only be testable on a local Fhenix/CoFHE testnet.
- P-CRIT-1 (underflow wrap) requires proving that `FHESafeMath.tryDecrease` catches an underflow. In mock, this means the mock must support returning `(handle, ebool=false)` for the underflow case. If mocks don't support conditional returns, this can't be tested locally.
- High risk of false positives — tests may "pass" because the mock environment can't simulate attacks, creating false confidence.

**Dependencies on other domains:**
- Smart Contracts remediation (SC-P0-1, SC-P1-1, SC-P1-3) — these tests validate the remediations. Must be done after or in parallel with contract fixes.
- Infrastructure (INFRA-P0-1: leaked key) — the adversarial tests run on testnet or local. If using testnet, the tester key must not be the leaked deployer key.

---

### TEST-P0-4: PriceOracle zero tests (MC-T5-004)

**Severity:** P0  
**Original classification:** P0 ✅ Correct

**Is severity correct?** Yes. PriceOracle (290 lines) is a critical dependency for borrow/LTV calculations. Zero tests on oracle feeds is P0.

**Missed edge cases / scenarios:**
- **Confidence band edge:** Scenario 3 (staleness) tests `isStale`, but doesn't test the confidence band check in `_normalizePythPrice` (Scenario 4 tests this for math). Missing: a price update with confidence/price ratio > 100 bps should revert with `UncertainPrice`. But what about exactly 100 bps boundary?
- **Multiple price feeds for same asset:** If Pyth returns different prices for the same asset in the same transaction (e.g., multiple updates), verify that the latest timestamp wins.
- **Price update failure:** `updatePriceFeeds` with an already-fresh price should not revert (idempotent). Test this.
- **`getPriceWithFallback` with both Pyth and fallback set:** When Pyth is active and fallback exists, Pyth price is used. When Pyth is stale, fallback kicks in. When Pyth reverts (e.g., uncertain price), fallback should also kick in. Test this cascade.
- **Conversion overflow:** `convertToUsd` with WAD scaling could overflow on multiply for extremely large amounts. Test with `type(uint256).max` to verify it reverts or rounds safely.
- **`convertFromUsd` with USDC (6 decimals) vs 18-decimal tokens:** Test that decimal normalization works for both. The existing scenarios mention "various decimals" but don't specify the boundary cases (0 decimals, 18 decimals, 6 decimals).
- **LTV/supported token lifecycle:** `setCollateralFactor(token, 0)` effectively disables a token as collateral. Test that after setting factor to 0, `isSupported` returns false and borrow against that token reverts. Test re-enabling.

**Implementation risks when fixing:**
- Pyth integration requires either a live Pyth contract on testnet (fragile — depends on RPC) or a mock Pyth contract. The plan mentions "mock Pyth contract or Hardhat test environment" but doesn't specify which. Mock Pyth contracts are preferred for deterministic tests.
- Pyth's `getPriceNoOlderThan` has a staleness threshold parameter. The contract's `STALENESS_THRESHOLD` must match the Pyth feed configuration. If they differ, tests pass locally but fail on testnet.
- The `_normalizePythPrice` function is internal. Testing it directly in Foundry requires exposing it via a test helper or using `vm.externalCall`. The plan's `PriceOracleMath.t.sol` (MC-T5-007) covers this, but if `_normalizePythPrice` is private, it can't be tested in isolation.

**Dependencies on other domains:**
- Backend (BE-P1-2: static exchange rate) — the backend uses a static exchange rate fallback. If PriceOracle tests reveal that the fallback behavior differs from backend expectations, the backend also needs fixing.
- Smart Contracts (SC-P1-2: trivial encryption in liquidation) — PriceOracle math doesn't involve FHE but liquidation amounts use FHE.asEuint128 for PriceOracle results. If PriceOracle returns unexpected values, liquidation math breaks.

---

### TEST-P1-1: StrategyRegistry zero test coverage (MC-T5-005)

**Severity:** P1  
**Original classification:** P1 ⚠️ Arguably P0

**Is severity correct?** The original classification says P1. However, the StrategyRegistry controls:
- Strategy lifecycle (registration, activation)
- TVL tracking (important for the Composer and frontend display)
- Vault rotation (governance-critical — timelocked ownership transfer)

A bug in StrategyRegistry could mean strategies are registered to the wrong vault, or TVL shows incorrect values, or governance is compromised. Compare to other P0 findings: PriceOracle (P0) and LendingPool (P0) have similar impact. While StrategyRegistry has fewer user-facing functions, the vault rotation bug would be **protocol-catastrophic** — a wrong vault could drain all positions.

**Recommendation:** Upgrade to **P0**. The vault rotation timelock is especially critical — if `acceptVault` can be called early (bypassing timelock), an attacker could set the vault to a malicious contract and drain all positions.

**Missed edge cases / scenarios:**
- **Propose vault, then propose again before accept:** Does the second proposal overwrite the first? The timelock behavior when multiple proposals exist needs testing.
- **Setting vault to address(0):** Should revert. Test this.
- **TVL increment/decrement by non-vault:** The proposed test covers vault-only functions, but should also test that non-vault callers are rejected. Without this, any address could manipulate TVL.
- **Strategy count overflow:** If `strategyCount` reaches `type(uint256).max`, what happens? (Purely theoretical but worth testing for completeness.)
- **Delete strategy vs setActive(false):** The contract has `setActive` (which archives) but no `delete`. Test that a deactivated strategy cannot be re-registered with the same creator+name.

**Implementation risks when fixing:**
- StrategyRegistry interacts with both vault and composer. Tests need to deploy both or provide mock interfaces.
- The timelock for vault rotation requires `vm.warp` in Foundry or `evm_increaseTime` in Hardhat. This is straightforward but must account for block timestamp differences.

**Dependencies on other domains:**
- Smart Contracts (SC-P2-3: `getEncryptedTvl` fails) — if `getEncryptedTvl` is fixed, the registry tests need updating to verify the fix. If the fix changes the function signature, Hardhat tests break.
- Smart Contracts (SC-P3-5: `_onlyVault` modifier unused) — if removed or changed, registry tests need updating.

---

### TEST-P1-2: FheForgeComposer never tested (MC-T5-006)

**Severity:** P1  
**Original classification:** P1 ⚠️ Arguably P0

**Is severity correct?** The Composer orchestrates the full user flow — register → vault open → pool supply → pool borrow → swap. A bug here means the entire user-facing DeFi builder flow breaks. The Composer is the primary user onboarding path.

**Recommendation:** Upgrade to **P0**. If the Composer silently fails on any step (e.g., incomplete `allowTransient` which the original audit flagged as SC-P1-4), users lose funds with no error message. The frontend (which has its own P0 bugs) calls the Composer — and a broken Composer compounds broken frontend UX into unresolvable user errors.

**Missed edge cases / scenarios:**
- **Partial failure recovery:** If `openPosition` succeeds in registering the strategy but fails in vault open (step 2), is the user's collateral stuck? The test should verify that the user's tokens are returned on any failure.
- **Re-entrancy through ERC-777 or similar:** The Composer pulls tokens from users. If the token has callback hooks (like ERC-777), the callback could re-enter the Composer. Test that `nonReentrant` prevents this.
- **`sweepToken` cannot sweep user tokens:** Test that `sweepToken` can only recover tokens that belong to the Composer (e.g., accidentally sent), not user deposits.
- **FHE path with multiple encrypted params:** The 8 encrypted params (`collateral`, `debt`, `apyTarget`, `loopCount`, `supplyEnc`, `borrowEnc`, `swapAmountIn`, `swapMinOut`) must each be verified independently. Scenario 6 tests this but should verify each param individually, not as a group.
- **Gas estimation for multi-step path:** The Composer calls 3-4 contracts in sequence. If any intermediate step exceeds block gas limit, the entire tx fails and user gets no error until they check. Test gas consumption for worst-case path.

**Implementation risks when fixing:**
- The Composer test requires deploying 6 contracts (StrategyRegistry, StrategyVault, LendingPool, SwapRouter, PriceOracle, MockERC20) + CoFHE mocks. This is a heavy setup that will make tests slow and fragile.
- If any of the 6 contracts change their interface (e.g., SC contract changes), the Composer test breaks.
- The `allowTransient` (SC-P1-4) fix may change how the Composer handles cross-contract ACL. Tests must be written against the final interface.

**Dependencies on other domains:**
- Smart Contracts (SC-P1-4: allowTransient) — the Composer uses `allowTransient` for cross-contract FHE ACL. If this is found insufficient, the Composer tests will fail.
- Smart Contracts (SC-P2-4: Permit2 flow) — if Permit2 is added, the Composer test needs a new scenario.
- Frontend (FE-P0-4: StrategyPromptDetails stub) — the Composer is the backend for the strategy prompt. If the Composer changes response format, the frontend stub implementation breaks.

---

### TEST-P1-3: PriceOracle Pyth math untested (MC-T5-007)

**Severity:** P1  
**Original classification:** P1 ✅ Correct

**Is severity correct?** Yes. The `_normalizePythPrice` function is pure math that can be tested in isolation. It's P1 because incorrect math would affect all downstream price calculations, but the test is self-contained and low-risk.

**Missed edge cases / scenarios:**
- **Expo overflow:** Pyth expo values range from -18 to +18 for standard feeds. Test with expo = +18 (extreme) and expo = -18. Should still handle correctly.
- **Multiplication overflow in WAD scaling:** The normalization involves `price * 10^18 / 10^(-expo)`. For large prices (> $1M with small expo), the intermediate multiplication could overflow uint256. Test with max safe values.
- **Zero confidence:** Pyth always returns confidence > 0, but test that confidence = 0 doesn't cause division by zero in the confidence-band check. (The check is `confidence * BPS_DEN > price`, not division, so this should be safe. Verify.)
- **Multiple calls to `_normalizePythPrice` with same cache state:** Pure function — verify determinism by calling twice and comparing results.

**Implementation risks when fixing:**
- If `_normalizePythPrice` is private (not internal), it cannot be tested directly in Foundry. The plan acknowledges this but doesn't specify how to work around it.
- Low risk overall — this is the safest finding to implement.

**Dependencies on other domains:**
- Smart Contracts (SC-P3-2: literal `18`) — if `WAD_DECIMALS` constant is introduced, the math test should use the constant instead of literal `18`. The fix order matters here.
- Smart Contracts (SC-P3-1: literal `10000`) — similar, if `BPS_DEN` is introduced, the confidence-band test should use the constant.

---

### TEST-P1-4: POSTFIX probe automation missing from CI (MC-T5-008)

**Severity:** P1  
**Original classification:** P1 ⚠️ Should be P2

**Is severity correct?** POSTFIX probes run against deployed contracts on testnet. They are integration smoke tests — valuable but not blocking. The probes run correctly (all PASS across 6 runs), so the automation gap is about convenience, not correctness.

Compared to TEST-P0-1 (zero coverage on LendingPool) or TEST-P1-1 (zero registry tests), adding CI automation for already-passing probes is less urgent. The probes existing and passing is what matters — CI automation is a quality-of-life improvement.

**Recommendation:** Downgrade to **P2**. It's a CI configuration change with no code impact.

**Missed edge cases / scenarios:**
- **Secret rotation handling:** The CI job uses `TESTER_PRIVATE_KEY` and `COFHE_PRIVATE_KEY` secrets. If these are rotated or expire, the job silently fails. The test should gracefully degrade (WARN instead of FAIL) on auth failures.
- **Network availability flakiness:** Arb Sepolia has occasional RPC issues. A CI run on schedule could fail due to network issues, not code bugs. The CI should retry or skip gracefully.
- **Gas price spikes:** Running probes on a real testnet costs gas (ETH). If the tester wallet runs out of gas, tests fail. CI should check balance before running.
- **Deployed contract address changes:** The probes use addresses from `deployments/421614.json`. If addresses change (INFRA-P0-4/5), the probes silently pass against wrong contracts. CI should verify addresses match expected values before running.

**Implementation risks when fixing:**
- The CI workflow change is straightforward YAML. Low risk.
- Secrets must be configured in GitHub repository settings. If the user pushing this code doesn't have admin access, they can't add secrets and the job will fail.

**Dependencies on other domains:**
- Infrastructure (INFRA-P0-4/5: wrong addresses) — POSTFIX probes use deployment addresses. If addresses are wrong, probes test nothing useful. This must be resolved FIRST.
- Infrastructure (INFRA-P0-6: token addresses differ) — the probes use hardcoded USDC/WETH addresses (lines 119-120 of `test-postfix.ts`). If token addresses change, probes fail or test wrong tokens.
- Infrastructure (INFRA-P1-1: rotate leaked key) — if the tester key is the leaked deployer key, running POSTFIX in CI exposes the compromised key further. A new tester key should be generated.

---

### TEST-P1-5: Aderyn Low: `10 ** dec` exponent literals (MC-T5-009)

**Severity:** P1  
**Original classification:** P1 ❌ Should be P3

**Is severity correct?** This is styling lint — 4 instances of `10 ** dec` where `10` is a literal. The plan itself argues that naming `10` as `TEN` or `BASE_10` would *reduce* readability. The `aderyn.toml` suppression approach is documented but the rationale section says "we do not extract 10 (it's the literal 10-base, naming TEN would be silly)."

This finding has zero impact on:
- Test coverage
- Test reliability
- CI correctness
- Integration/E2E testing

It's linter noise that was accepted as "acceptable style residual" by the original remediation. Including it as P1 in the Testing domain is category error.

**Recommendation:** Downgrade to **P3** and move to the Smart Contracts domain (or simply document in `aderyn.toml` and close).

**Missed edge cases:** None — this finding isn't about testing at all. The only question is whether to suppress or extract.

**Implementation risks when fixing:**
- Zero risk if suppressing via `aderyn.toml`.
- If extracting to a constant, risk of typos in 4 replacement sites.

**Dependencies on other domains:**
- Smart Contracts (SC-P3-1, SC-P3-2) — similar literal-constant extraction findings.

---

### TEST-P2-1: Missing test jobs in CI (MC-T5-010)

**Severity:** P2  
**Original classification:** P2 ✅ Correct

**Is severity correct?** P2 is right. The backend has 2 spec files, the frontend has 1 spec file. Adding CI test jobs for 3 spec files is low impact. The codebase has ~12 unit tests — the test infrastructure gap is minor compared to the coverage gap (P0 findings).

**Missed edge cases / scenarios:**
- **Backend tests need database:** The backend spec files (`event-indexer.service.spec.ts`, `simulators.spec.ts`) likely mock Supabase. If they connect to a real database, CI needs Supabase test containers, which adds complexity. The plan assumes `npm test` works with a simple CLI call.
- **Frontend Vitest config compatibility:** The frontend uses `vitest` but the CI install script is `bun install` (correct). However, `bun run test` may need `--reporter` flags for CI output. The `.spec.ts` file may test React components that need `jsdom` environment.
- **Forge coverage enforcement at 50%:** The current codebase likely has <50% coverage (only SwapRouter + ExecutorContract + constructor tests = ~16 tests covering ~400 of 2000+ lines). Adding `--min-coverage 50` will break CI immediately. The threshold should start lower (e.g., 20%) and increase incrementally.
- **CI caching conflicts:** The existing CI caches `contracts/node_modules`. If test files import from `node_modules` that aren't cached (new dependencies in test files), the cache key needs updating.
- **Gas snapshot check:** The CI already runs `forge snapshot --check` which fails if gas changes. Adding coverage enforcement means gas check + coverage check could both fail, creating a two-failure CI that's confusing.

**Implementation risks when fixing:**
- If backend tests need a Supabase instance, CI will fail without one. The current `event-indexer.service.spec.ts` likely mocks `@supabase/supabase-js`, so this should work — but needs verification.
- The `forge coverage` tool may report different coverage across Foundry versions. Pin Foundry version in CI to avoid flaky thresholds.

**Dependencies on other domains:**
- Backend (BE-P2-1: migration infrastructure) — backend tests may depend on the migration infrastructure being in place. If migrations are broken, tests that touch the database fail.
- Infrastructure — no direct dependency, but CI configuration changes need to be synchronized with any other CI changes from other domains (frontend, infra).

---

### TEST-P2-2: CI lint/test/build not split (MC-T5-011)

**Severity:** P2  
**Original classification:** P2 ✅ Correct

**Is severity correct?** Yes. The existing CI runs everything in sequence per job (contracts job runs lint → compile → type-check → test → coverage → gas). Splitting into parallel sub-jobs gives faster feedback. P2 is correct — nice-to-have optimization, not blocking.

**Missed edge cases / scenarios:**
- **Job dependency management:** The proposed split doesn't specify dependencies. If `lint` fails, `compile` and `test` should not run (wasted minutes). But if they run in parallel, all three start simultaneously. The CI needs `needs:` directives for proper pipeline flow.
- **`forge coverage` depends on compilation:** The split proposal has coverage as a separate step, but coverage implicitly runs compilation. Need to ensure the compilation step is cached/available to coverage.
- **Backend and frontend CI don't run tests at all currently.** Before splitting, the P2-1 fix should add test jobs. The ordering matters — split after adding test, not before.

**Implementation risks when fixing:**
- Over-complication: splitting 3 jobs (contracts, backend, frontend) into 10+ sub-jobs creates more CI config to maintain. For a buildathon project with ~16 tests, this is premature optimization.
- The actual CI execution time is probably <5 minutes. Splitting saves maybe 30-60 seconds at the cost of 3x more YAML. Not worth it during Wave 1.
- Workflow matrix syntax is error-prone for developers unfamiliar with GitHub Actions.

**Dependencies on other domains:**
- Frontend (FE-P0-1 through FE-P0-5) — frontend CI build step currently uses `bun run build`. If P0 frontend fixes change the build output, the CI build step needs updating first.
- Infrastructure — no direct dependency.

---

### TEST-P2-3: C5 deferred security not documented (MC-T5-012)

**Severity:** P2  
**Original classification:** P2 ✅ Correct

**Is severity correct?** Yes. C5 (SwapRouter executor trust) is a documented deferred security finding. Adding a test README that notes this gap is P2 — documentation hygiene, no code impact.

**Missed edge cases / scenarios:**
- **The TEST_README.md contains hardcoded test counts** that will become stale immediately as new tests are added. The line "4 (StrategyVault) + N new" will be out of date after the first P0 test is written. Recommend linking to a test count dashboard or using a CI badge instead of hardcoded numbers.
- **The C5 documentation doesn't reference EXISTING SwapRouter tests:** The Foundry test `NonFheConstructor.t.sol` actually tests some SwapRouter constructor behavior (deadline validation, executor storage). The deferred section should reference these existing tests.
- **No mention of the existing POSTFIX probes:** The 25 POSTFIX probes include SwapRouter tests (deadline bounds, executor rotation). These partially cover the intent lifecycle. The deferred section should acknowledge this partial coverage.

**Implementation risks when fixing:**
- Zero risk — it's creating a markdown file.
- Risk of the file becoming stale if not updated with new tests.

**Dependencies on other domains:**
- Smart Contracts (C5 finding) — if C5 is ever fixed, the TEST_README.md must be updated to reflect new coverage.

---

## Missed Findings

The Wave 1 audit missed several important testing gaps:

### MF-1: No Integration Tests for Backend-Frontend Contract Mismatch (P0)

**What was missed:** The audit identified that the UI uses Wave17 addresses and the backend uses Wave5-6 addresses (INFRA-P0-4/5), but there is NO integration test that detects this mismatch at the E2E level.

**Why it matters:** When the frontend calls `getSupplyBalance` and the backend calls `totalPlainBorrow`, they might be talking to completely different contracts (different deployment waves). A single E2E test that calls the Composer on-chain and checks the result through the backend API would catch address mismatch instantly.

**Suggested remediation:** Write a single E2E probe (`test-e2e-contract-consistency.ts`) that:
1. Reads deployment addresses from all config files (`ui/.env.local`, `backend/apps/.env.development`, `contracts/deployments/421614.json`)
2. Verifies they match on-chain bytecode via `eth_getCode`
3. Fails with a clear error message listing mismatched addresses

**Priority:** P0 — this is the cheapest (1 test script) way to catch the most critical infrastructure bug.

### MF-2: No Load / Stress Testing (P2)

**What was missed:** The entire audit ignores throughput, concurrency, and gas cost testing. For a DeFi protocol:

- What happens when 10 users call `shield` simultaneously?
- What's the gas cost of a Composer `openPosition` call with all 5 steps?
- Can the SwapRouter handle 100 intents within a single block?
- Does the backend's `/health` endpoint survive 1000 concurrent requests?

**Suggested remediation:** Add a stress test document and a simple gas benchmark script:
- `forge snapshot` already exists — add gas assertions to critical paths
- Backend load test: a simple `artillery` or `k6` script for the `/health` endpoint
- Contract stress test: a Hardhat script that sends 10 concurrent transactions

**Priority:** P2 — not blocking but important for claiming production readiness.

### MF-3: No Chain Reorganization / Fork Test (P1)

**What was missed:** FHE operations are asynchronous (handles returned immediately, computation off-chain). If the chain reorganizes:
- The stored handles may reference stale coprocessor computations
- Re-org could cause handle reuse or invalid handles
- The `allowTransient` ACL could be invalidated

**Suggested remediation:** Use Foundry fuzz testing or Hardhat's `evm_reorg` (if available) to test that the protocol handles chain reorgs correctly. At minimum, document that the FHE handle model assumes no reorg.

**Priority:** P1 — FHE-async model has unstated assumptions about chain finality.

### MF-4: No Mock/Fake Contract Verification Tests (P1)

**What was missed:** Both the Foundry and Hardhat tests use mock contracts (MockERC20, CoFHE mocks). If these mocks don't accurately reflect real contract behavior, the tests pass but the real system fails.

**Examples:**
- `CoFHE.mocks.deployMocks()` may not match the deployed CoFHE contract on Arbitrum Sepolia
- `MockERC20` doesn't test fee-on-transfer tokens (USDT has no fee, but other tokens might)
- Mock Pyth may not simulate confidence-band behavior correctly

**Suggested remediation:** Add a test that runs the same scenario against both mocks and testnet, then compares results. Document mock limitations in TEST_README.md.

**Priority:** P1 — test infrastructure gap that undermines all contract tests.

---

## Cross-Cutting Dependencies

This domain's fixes depend on and affect other domains:

### External Dependencies (this domain needs from others)

| Finding | Needs From | What's Needed |
|---------|------------|---------------|
| TEST-P0-1 (LendingPool tests) | SC Domain | P-CRIT-1/2/4 + P-HIGH-5 remediations applied |
| TEST-P0-2 (FHE integration tests) | SC Domain | Same as above, plus stable CoFHE mock API |
| TEST-P0-3 (Privacy attack tests) | SC Domain | FHESafeMath integration, FHE.eq equality fix |
| TEST-P0-4 (PriceOracle tests) | SC Domain | PriceOracle must be deployed with real Pyth addresses |
| TEST-P1-1 (Registry tests) | SC Domain | getEncryptedTvl fix (SC-P2-3) if testing TVL |
| TEST-P1-2 (Composer tests) | SC Domain | allowTransient fix (SC-P1-4), stable contract interfaces |
| TEST-P1-4 (POSTFIX CI) | Infra Domain | Correct deployment addresses (INFRA-P0-4/5), new tester key (INFRA-P1-1) |
| TEST-P2-1 (CI test jobs) | Frontend domain | Frontend test passing with Vitest, no P0 render bugs |
| TEST-P2-2 (CI splitting) | None | Self-contained CI config change |

### Upstream Effects (this domain affects others)

| Fix | Affects | How |
|-----|---------|-----|
| TEST-P0-1/2 (LendingPool tests) | SC Domain | Tests validate remediations — if they fail, SC fixes are incomplete |
| TEST-P0-4 (PriceOracle tests) | Backend Domain | Tests reveal oracle behavior — backend simulators may need adjustment (BE-P1-2) |
| TEST-P1-2 (Composer tests) | Frontend Domain | Composer output format affects frontend strategy display |
| TEST-P1-4 (POSTFIX CI) | Infra Domain | CI job consumes tester key secrets that infra manages |
| TEST-P2-1 (CI test jobs) | All domains | CI changes affect all pushes/PRs — everyone sees the results |

### The Critical Dependency Chain

The most important dependency path is:

```
INFRA-P0-4/5 (fix addresses)
  → TEST-P1-4 (POSTFIX probes can now target correct contracts)
  → TEST-P0-2/3 (FHE tests validate remediations on correct contracts)
```

If addresses aren't fixed first, none of the deployed-contract tests (POSTFIX, FHE integration, privacy attacks) can validate the actual deployed system.

---

## Recommended Execution Order

The original execution order in `agent-5-tests-ci.md` is:

```
1. MC-T5-009 (Aderyn Low)      — P1 (WRONG: should be P3, last)
2. MC-T5-004 (PriceOracle)      — P0
3. MC-T5-007 (PriceOracle math) — P1
4. MC-T5-001 (LendingPool)      — P0
5. MC-T5-002 (LendingPool FHE)  — P0
6. MC-T5-003 (Privacy attacks)  — P0
7. MC-T5-005 (StrategyRegistry) — P1
8. MC-T5-006 (Composer)         — P1
9. MC-T5-010 (CI test jobs)     — P2
10. MC-T5-011 (CI splitting)    — P2
11. MC-T5-008 (POSTFIX CI)      — P1
12. MC-T5-012 (TEST_README)     — P2
```

### Problems with the original order:

1. **Aderyn Low is listed FIRST but should be LAST** — it's a P3 linter issue that doesn't affect testing. It wastes momentum.
2. **CI changes (9-11) are mixed with contract tests (1-8)** — CI changes block all PRs. They should be applied carefully after contract tests are written, not during.
3. **PriceOracle before LendingPool** — PriceOracle is simpler and has no FHE dependencies. Starting here makes sense. But the math tests (MC-T5-007) should be done together with the integration tests (MC-T5-004), not split apart.
4. **POSTFIX CI (11) before TEST_README (12)** — The CI job needs the deployment addresses to be correct (INFRA dependency). If addresses aren't fixed, adding CI now is wasted effort.

### Recommended Order:

| Order | Finding | Priority | Rationale |
|-------|---------|----------|-----------|
| 1 | **TEST-P0-4** + **TEST-P1-3** (PriceOracle: integrate math + integration together) | P0 | Simplest contract, no FHE, independent of other fixes. Serves as test infrastructure warm-up. |
| 2 | **TEST-P0-1** (LendingPool plain logic — Foundry) | P0 | Non-FHE tests first — prove the Foundry patterns work. These can run immediately. |
| 3 | **TEST-P0-2** (LendingPool FHE — Hardhat) | P0 | Requires CoFHE mocks. Must come AFTER or IN PARALLEL with SC remediation (P-CRIT fixes applied). |
| 4 | **TEST-P0-3** (Privacy attack vectors) | P0 | Depends on SC remediation AND passing LendingPool FHE tests. Naturally follows #3. |
| 5 | **TEST-P1-1** (StrategyRegistry) | P0↑ | Upgraded to P0. Requires deployed Registry or mocks. No FHE dependencies — independent of #3-4. |
| 6 | **TEST-P1-2** (FheForgeComposer) | P0↑ | Upgraded to P0. Depends on ALL contracts being deployed/tested. Natuarally comes last. |
| 7 | **TEST-P1-4** (POSTFIX CI) | P2↓ | Downgraded to P2. Wait for INFRA-P0-4/5 (address fix) before adding CI step. |
| 8 | **TEST-P2-1** (CI test jobs) | P2 | Add test jobs AFTER contract tests exist. Otherwise CI passes with zero tests. |
| 9 | **TEST-P2-2** (CI splitting) | P2 | Do AFTER P2-1 (add tests first, then split). Premature optimization otherwise. |
| 10 | **TEST-P2-3** (TEST_README) | P2 | Create after tests exist, with real counts. |
| 11 | **TEST-P1-5** (Aderyn Low) | P3↓ | Last. Suppress in `aderyn.toml` or close as "won't fix." Not testing work. |
| — | **MF-1** (E2E contract consistency probe) | P0 | NEW FINDING. Should be done IMMEDIATELY — catches the address mismatch before any other test runs against wrong contracts. |

### Phase Grouping

**Phase 1 — Immediate (order 1-2):** PriceOracle tests + LendingPool Foundry tests. These have zero external dependencies and can be written/delivered in a single session. Estimated: 4-6 hours.

**Phase 2 — Core (order 3-4):** LendingPool FHE tests + Privacy attack tests. These depend on SC remediation being applied (or verified). The domain working on SC fixes should coordinate with this phase. Estimated: 6-8 hours.

**Phase 3 — Coverage (order 5-6):** Registry tests + Composer tests. These are the most complex setups (4-6 contracts each) but straightforward scenarios. Estimated: 6-8 hours.

**Phase 4 — CI & Polish (order 7-11):** POSTFIX automation, CI test jobs, CI splitting, README, Aderyn suppression. These are infrastructure changes that should be done AFTER contracts are stable to avoid CI breakage from test changes. Estimated: 3-4 hours.

**Phase 5 — New findings (MF-1):** E2E contract consistency probe. This 1-script fix should be done FIRST (before Phase 1) because it validates that the entire testing effort targets the right contracts. Estimated: 1 hour.

---

## Summary of Severity Changes

| Finding | Original | Recommended | Reason |
|---------|----------|-------------|--------|
| TEST-P0-1 | P0 | P0 | ✅ Correct |
| TEST-P0-2 | P0 | P0 | ✅ Correct |
| TEST-P0-3 | P0 | P0 | ✅ Correct |
| TEST-P0-4 | P0 | P0 | ✅ Correct |
| TEST-P1-1 | P1 | **P0** ↑ | Vault rotation governance risk, protocol-catastrophic if broken |
| TEST-P1-2 | P1 | **P0** ↑ | Composer is primary user onboarding path, broken composer = broken UX |
| TEST-P1-3 | P1 | P1 | ✅ Correct |
| TEST-P1-4 | P1 | **P2** ↓ | Probes already pass (all PASS ×6), CI automation is convenience, not correctness |
| TEST-P1-5 | P1 | **P3** ↓ | Linter noise, zero test impact, domain mismatch (should be in SC domain) |
| TEST-P2-1 | P2 | P2 | ✅ Correct |
| TEST-P2-2 | P2 | P2 | ✅ Correct |
| TEST-P2-3 | P2 | P2 | ✅ Correct |
| **MF-1** | — | **P0** ↑ | Missed — E2E contract consistency catches address mismatch instantly |

---

## Final Verdict

**Strengths of the original audit:**
- Correctly identified the 4 zero-coverage contracts
- Recognized the Foundry-vs-Hardhat split for FHE vs non-FHE testing
- Proposed realistic test scenario counts (6-8 per contract)
- Documented execution order with rationale

**Weaknesses:**
- 2 of 12 severity ratings underestimate actual risk (P1 → P0)
- 2 ratings overestimate urgency (P1 → P2, P1 → P3)
- 4 major missed findings (MF-1 through MF-4)
- Execution order puts Aderyn Low (linter issue) before every real test
- CI splitting (P2-2) is premature optimization for a ~16-test codebase
- No E2E integration test between domains
- No load/stress testing consideration
- No chain reorg testing for FHE async handles
- No mock-fidelity verification strategy

The domain needs ~28-34 hours of implementation work (25-30 for Phase 1-3 tests, 3-4 for Phase 4 CI). The highest impact single change is not any of the 12 findings — it's **MF-1** (the E2E contract consistency probe), which is a 1-hour fix that would have prevented the most critical infrastructure bug.
