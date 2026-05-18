# FHE Integration Gap & Bottleneck Analysis (Wave 21 Audit)

## Audit Results: 48 PASS / 4 FAIL

### Failures Breakdown

| # | Test | Error | Root Cause |
|---|------|-------|-----------|
| 1 | composer.openPosition | ZK proof verification failed (fetch failed) | **ZK verifier network timeout** — `https://testnet-cofhe-vrf.fhenix.zone` unreachable during proof submission step |
| 2 | pool.borrowWithOracle(WETH, USDC) | 0x3a23d825 InsufficientCollateral() | **Oracle cross-asset collateral** — `collateralFactorBps(WETH)` returns 0 or oracle `convertToUsd` undervalues WETH |
| 3 | pool.partialUnshield(USDC, 200) | 0x28b35f21 InsufficientReserve() | **State drift from mismatched operations** — plain `liquidReserve` drained by mismatch borrows that stored encrypted `_ZERO` |
| 4 | pool.shieldEth + borrowWithOracle | 0x3a23d825 InsufficientCollateral() | Same as #2 — oracle collateral factor not set for WETH on fresh deploy |

---

## GAP 1: ZK Verifier Network Reliability (CRITICAL)

**Symptom**: `composer.openPosition` fails with "ZK proof verification failed | Caused by: fetch failed"

**Root cause from CoFHE docs (encryption flow)**:
The encryption pipeline runs 5 steps: `InitTfhe → FetchKeys → Pack → Prove → Verify`. The `Verify` step sends the proof to the ZK verifier at `https://testnet-cofhe-vrf.fhenix.zone`. If this endpoint is unreachable, the entire `execute()` call throws.

**Why it only affects composer.openPosition**:
- Direct Pool/Vault calls use `enc128()` (no `setAccount`) → the ZK proof signer = deployer wallet → verifier matches
- Composer calls use `enc128ForComposer()` (with `setAccount(C)`) → the ZK proof signer = composer address → verifier must validate that `account` field matches
- The `fetch failed` is a **network error**, not a contract error — the SDK can't reach the verifier endpoint

**SDK 0.5.2 retry behavior**: Per changelog, 0.5.2 adds "Retry transient submit-time `404 Not Found` responses in the threshold-network decryption flows" and a configurable `.set404RetryTimeout(timeoutMs)`. However, this retry applies to `decryptForTx`/`decryptForView`, NOT to the ZK verify step.

**Fix needed**:
1. Add retry logic in audit script for `encryptInputs` calls that may hit network issues
2. Consider running composer tests after a connectivity check
3. Long-term: SDK should add retry for ZK verify step (not our fix — report upstream)

---

## GAP 2: Cross-Contract `setAccount` + `InvalidSigner` Pattern (HIGH)

**Symptom**: Before fix, ALL direct Pool calls with `enc128ForPool` (using `setAccount(P)`) reverted with `0x7ba5ffb5 InvalidSigner(address,address)`.

**Root cause from CoFHE docs**:
- `setAccount(address)` embeds the address in the ZK proof's `account` field
- When the contract calls `FHE.asEuint128(encInput)`, the TaskManager checks that `msg.sender == account` embedded in the proof
- For direct user→Pool calls, `msg.sender` = deployer, but proof had `account = Pool address` → MISMATCH → `InvalidSigner(deployer, Pool)`
- For Composer→Pool calls, Composer calls `FHE.asEuint128(encInput)` where `msg.sender = Composer`, and proof has `account = Composer` → MATCH ✓

**Rule established** (verified by docs + testing):
| Call path | SDK encryption | setAccount? | Why |
|-----------|---------------|-------------|-----|
| User → Pool.shield | `enc128(v)` | NO | Pool's `FHE.asEuint128` runs with `msg.sender = user` |
| User → Pool.borrowWithLtvCheck | `enc128(v)` | NO | Same — user is msg.sender |
| User → Vault.openPosition | `enc128(v)` | NO | User is msg.sender |
| Composer → Pool.depositFor | `enc128For(v, C)` | YES = Composer | Composer is msg.sender for Pool |
| Composer → Vault.addCollateral | `enc128For(v, C)` | YES = Composer | Composer is msg.sender for Vault |

**Bottleneck**: Frontend must know whether to use `setAccount` or not. This is a UX/call-path complexity that the SDK doesn't abstract away.

---

## GAP 3: Oracle Cross-Asset Collateral Not Configured (HIGH)

**Symptom**: `borrowWithOracle(WETH, USDC)` reverts `InsufficientCollateral()`.

**Root cause**: The deploy script calls:
```solidity
oracle.setCollateralFactor(WETH_ADDR, COLLATERAL_FACTOR_LTV, COLLATERIAL_FACTOR_LIQUID);
oracle.setCollateralFactor(USDC_ADDR, COLLATERAL_FACTOR_LTV, COLLATERIAL_FACTOR_LIQUID);
```
But `_requireOracleHealthy` checks:
```solidity
uint16 ltvBps = oracle.collateralFactorBps(collateralToken);
if (ltvBps == 0) revert LtvNumeratorZero();
uint256 collateralUsd = oracle.convertToUsd(collateralToken, collateralAmount);
uint256 totalDebtUsd = oracle.convertToUsd(borrowToken, borrowAmount + existingBorrow);
if (collateralUsd * ltvBps < totalDebtUsd * BPS_DEN) revert InsufficientCollateral();
```

Possible issues:
1. `collateralFactorBps(WETH)` may return 0 if not properly set
2. `convertToUsd(WETH, 0.1 ETH)` may return 0 if WETH price source misconfigured
3. The oracle may need `setSource` for WETH with the correct Pyth feed

**Fix needed**: Verify oracle configuration on-chain, check `collateralFactorBps(WETH)` and `convertToUsd` values.

---

## GAP 4: Encrypted/Plain State Drift from Mismatch Operations (HIGH)

**Symptom**: `partialUnshield(USDC, 200)` fails with `InsufficientReserve()`.

**Root cause**: The equality verification pattern (`FHE.select(FHE.eq(incoming, claimedPlain), incoming, _ZERO)`) creates a dangerous state drift:
- When `enc != plain` (mismatch), the **plain amount** is still transferred (tokens move) but **encrypted balance** stores `_ZERO` (no change)
- This means: `liquidReserve[token] -= plainAmount` (plain state decreases) but encrypted balance doesn't increase
- Over time, plain `liquidReserve` drains while encrypted balances stay inflated (from correct operations) or unchanged (from mismatches)
- The `InsufficientReserve` check uses plain `liquidReserve` which can go negative relative to actual deposits

**Bottleneck**: The equality verification pattern protects encrypted state integrity but creates a **doomsday scenario** where mismatched operations drain plain reserves without updating encrypted balances. Eventually users can't unshield because `liquidReserve < requested` even though their encrypted balance says they should have funds.

**Fix needed (V3)**:
1. Don't transfer plain tokens when equality check fails → `require(amountsMatch)` on decrypted result is NOT possible (FHE can't branch)
2. Instead: verify equality BEFORE transferring tokens → use `FHE.select` to gate the ENTIRE operation (not just the encrypted part)
3. Pattern: `actual = FHE.select(amountsMatch, incoming, _ZERO); if (actual == _ZERO) revert;` — BUT can't branch on encrypted values!
4. Real fix: Use `FHE.eq` → `ebool` → `FHE.select` for the transfer amount too → transfer only the verified encrypted amount

---

## GAP 5: `decryptForView` Returns `undefined` (MEDIUM)

**Symptom**: All `decryptForView` calls return `undefined` instead of the decrypted value.

**Root cause from CoFHE docs**: `decryptForView` requires a valid permit for the `account + chainId` pair. The permit was created with `client.permits.getOrCreateSelfPermit()`, but:
1. The permit may not be properly associated with the ciphertext handle
2. The handle may need `allowPublic` or `allow(recipient)` before decrypt works
3. The `FheTypes.Uint128` type may not match the actual ciphertext type on-chain

**From best practices docs**: "Once called [`allowPublic`], the value can be decrypted by anyone." But `decryptForView` uses permits, not `allowPublic`. The difference:
- `allowPublic` → enables `decryptForTx` (off-chain → on-chain proof)
- `allow(user)` + permit → enables `decryptForView` (local decryption for UI)

**Fix needed**:
1. Verify permit is correctly associated with the right chain+account
2. Ensure `FHE.allow(user, handle)` is called in contract for the user who will decrypt
3. Check that `decryptForView` is using the correct `FheTypes` enum value

---

## GAP 6: 2048-Bit Encryption Limit (MEDIUM)

**From CoFHE docs**: "A single `encryptInputs` call may encrypt at most **2048 bits** of plaintext in total. Exceeding this limit throws a `ZkPackFailed` error."

**Impact on FheForge**:
- `composer.openPosition` encrypts 3 × `uint128` = 3 × 128 bits = 384 bits ✓ (well within limit)
- `composer.rebalance` encrypts 3 × `uint128` = 384 bits ✓
- No current function exceeds the limit, but future functions with many encrypted inputs could

**No fix needed** currently, but document the constraint.

---

## GAP 7: Missing `FHE.allowSender` After Operations (MEDIUM)

**From CoFHE best practices docs**: "Call `allowThis` after modifying encrypted state variables so the contract can use them in future transactions."

**Current pattern in contracts** (verified):
```solidity
FHE.allowThis(actual);
FHE.allow(actual, _msgSender());
FHE.allowThis(newBorrow);
FHE.allow(newBorrow, _msgSender());
```

This is CORRECT — it calls both `allowThis` and `allow(user)`. But some code paths may miss `allowSender`. Need systematic audit of ALL `FHE.allow*` calls.

---

## GAP 8: Trivial Encryption Privacy Leak (LOW — acknowledged)

**From CoFHE docs**: "FHE.asEuint128(uint256) creates trivially encrypted values observable by anyone."

**Impact**: The `_ZERO` handle is trivially encrypted. Anyone who queries it via `decryptForView` will see `0`. This is acceptable for the zero handle but would be a privacy violation for user balances.

**No fix needed** for `_ZERO` — it's intentionally zero. But contracts MUST NOT use `FHE.asEuint128()` for user data — only SDK-encrypted inputs via `InEuint128`.

---

## BOTTLENECK SUMMARY (Priority Order)

| Priority | Gap | Impact | Fix Effort |
|----------|-----|--------|------------|
| P0 | GAP 4: Encrypted/plain state drift from mismatches | Funds locked, reserve depletion | High — requires architectural change |
| P1 | GAP 2: setAccount complexity for cross-contract | Frontend must track call paths | Medium — SDK helper or contract pattern |
| P2 | GAP 3: Oracle cross-asset not configured | Can't use WETH as collateral | Low — verify on-chain config |
| P3 | GAP 1: ZK verifier network timeout | Composer tests flaky | Low — retry logic in script |
| P4 | GAP 5: decryptForView returns undefined | Can't read balances in UI | Medium — verify permit + ACL wiring |
| P5 | GAP 7: Missing allowSender audit | Potential ACL errors on read | Low — systematic grep |
| P6 | GAP 6: 2048-bit limit | Future constraint | None — document only |
| P7 | GAP 8: Trivial encryption | Privacy leak for asEuint* | None — already handled |

---

## IMMEDIATE FIXES (can do now)

1. **GAP 1**: Add retry wrapper for `encryptInputs` in audit script
2. **GAP 2**: Add `setAccount` documentation comment to every hook that calls Composer functions
3. **GAP 3**: Verify oracle `collateralFactorBps(WETH)` on-chain, fix if needed
4. **GAP 5**: Debug `decryptForView` — check permit association and FheTypes

## DEFERRED FIXES (require V3 refactor)

1. **GAP 4**: Redesign equality verification to prevent plain/encrypted state drift — gate the ENTIRE operation (transfer + encrypted update) on the equality check result
2. **GAP 2**: Abstract `setAccount` behind a frontend SDK helper that inspects the call path
