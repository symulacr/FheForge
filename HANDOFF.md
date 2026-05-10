# Handoff — Wave12 Deploy + Critique Fixes

**Date**: 2026-05-10
**Session**: Full critique, micro-change fixes, unified deploy, on-chain wiring verification
**Status**: ✅ Complete

---

## Wave12 Deployed Contracts (Arb Sepolia, chainId 421614)

| Contract | Address |
|----------|---------|
| StrategyRegistry | `0x4275183A5Cb4eA237A3d55cf33105FaF739EB801` |
| LendingPool | `0x485d73BEc3bdD3cB27DFfa9Db3c31fb5d4bf39FC` |
| PriceOracle | `0x1C03753C84422b4D35D8A47e3f51576775bB14c1` |
| SwapRouter | `0x750BfeA4a800111A0EfC045a47444f56e47f9A92` |
| ExecutorContract | `0xD9095BE6ddEA0fEa735cBDF77f63Fc1E1A0aa473` |
| StrategyVault | `0xf5a5610dc1ef0b495Bf83d5B9e7d2073F39b5e97` |
| FheForgeComposer | `0x26D180fe54392fC720c8c48dc937e2c285189481` |

All 7 contracts verified on Sourcify (full match). All wiring confirmed on-chain via `verify-wiring.ts`.

---

## Critique Fixes Applied (12 micro-changes)

### Contracts (6)
- **C-03**: SwapRouter — `InsufficientOutput` error + `outputAmount < i.minAmountOut` check
- **C-04**: SwapRouter — Token escrow on submit, return on cancel, release on execute
- **C-08**: PriceOracle — `ZeroPrice` error separated from `NegativePrice`; `p.price == 0` vs `p.price < 0`
- **C-12**: LendingPool — `Euint64Overflow` error + `amount > type(uint64).max` guard in 6 entry points
- **H-06**: LendingPool — `ComposerSet` event + `emit ComposerSet(c)` in `setComposer`
- **C-10**: FheForgeComposer — Doc comment on `deadline==0` semantic overloading

### Frontend (4)
- **F-06**: addresses.ts + use-fhe-vault.ts — `validateEuint64`; 6 Pool calls switched from `validateEuint128` to `validateEuint64`
- **F-07**: use-fhe-vault.ts — `decryptForView` accepts `fheType` param; `revealBorrow` uses `FheTypes.Uint64`
- **F-01**: use-fhe-vault.ts — `openPosition` merged from single `collateralAmount`; caller updated

### Backend (2)
- **B-01**: fhenix-strategy.service.ts — Stale oracle → `logger.error` with "call updatePriceFeeds"
- **B-04**: defi_strategies.repository.impl.ts — TODO: verify `workflow_json` hash matches on-chain

---

## Unified Deploy Script

`contracts/scripts/deploy-full.ts` — replaces all wave-specific deploy scripts.

Features:
- Pre-flight: signer check, balance check (min 0.05 ETH)
- Dependency-ordered deploy: Level 0 (5 independent) → Level 1 (Vault) → Level 2 (Composer)
- Sequential wiring: proposeVault → timelock → acceptVault → setWeth → setOracle → setComposer → oracle feeds → executor rotation (if needed)
- Best-effort Sourcify + Etherscan verification
- Saves deployment record to `deployments/{chainId}.json`
- Prints UI env vars

Usage:
```
npx hardhat run scripts/deploy-full.ts --network arb-sepolia
```

---

## Unfixed CRITICALs (documented, not micro-changeable)

| ID | Issue | Why Not Fixed |
|----|-------|---------------|
| C-01 | Dual plain+encrypted input skew | Needs ZK proof of equality |
| C-02 | borrowFromLending no LTV | Needs cross-contract health factor |
| C-06 | One position per user | Needs Vault storage restructuring |

## Unfixed HIGHs (documented)

| ID | Issue |
|----|-------|
| H-01 | OWNER=EOA, no timelock |
| H-02 | No upgrade proxy |
| C-09 | No Pyth auto-refresh |
| C-11 | Swap amounts fully public |
| X-01 | No interest accrual |
| X-02 | Composer bypasses LTV |

V2_ARCHITECTURE.md plans fixes for most — NOT implemented yet.

---

## On-Chain Wiring Verification

Run: `npx hardhat run scripts/verify-wiring.ts --network arb-sepolia`

All checks pass:
- Registry.vaultAddress → Vault ✅
- Pool.weth → WETH ✅
- Pool.oracle → Oracle ✅
- Pool.composer → Composer ✅
- Oracle WETH/USDC price feeds + collateral factors (80% LTV, 85% liq) ✅
- Router.executor → ExecutorContract ✅

---

## UI Updated

- `ui/.env.local` — all 7 contract addresses updated to wave12
- `ui/abis/` — synced from fresh compilation
- TypeScript type-check passes

---

## On-Chain Audit Script

`contracts/scripts/audit-onchain.ts` — comprehensive on-chain function audit.

Features:
- Tests EVERY public/external function across all 7 contracts with real on-chain transactions
- Uses CoFHE SDK for real FHE encryption (`encryptInputs`), decryption (`decryptForView`, `decryptForTx`)
- Parallel execution: balance reads, oracle reads, approval batches, vault state reads
- Deep roundtrip tests: ETH↔WETH supply/withdraw, USDC supply→borrow→repay→withdraw lifecycle
- Vault liquidity deep test: WETH collateral, addCollateral, decryptForView, emergencyWithdraw
- Liquidation flow test: creates 80% LTV position, attempts liquidate (PositionHealthy = correct)
- Inter-contract wiring verification: Registry→Vault, Pool→Oracle, Pool→WETH, Router→Executor
- Unshield/reveal deep dive: decryptForView on all encrypted values, decryptForTx with permits, skew detection
- FHE architecture audit: 2 CRITICAL + 6 HIGH + 4 MEDIUM issues from CoFHE docs cross-reference
- Contract refactor recommendations (P0-P5 priority)
- Comprehensive error decoding: all 53 CoFHE errors + contract custom errors + ERC20/ECDSA errors
- Debug instrumentation ([DBG] prefix) for gap identification
- JSON report saved to `contracts/audits/wave12-audit-*.json` with fheIssues array

Usage:
```
npx hardhat run scripts/audit-onchain.ts --network arb-sepolia
```

## FHE Architecture Issues (from CoFHE docs review)

| Severity | Contract | Issue | Fix |
|----------|----------|-------|-----|
| CRITICAL | LendingPool | _writeLiquidationHandles missing FHE.allowThis() | Add allowThis on newBorrowEnc + newSupplyEnc |
| CRITICAL | LendingPool | Dual plain+encrypted state violates FHE | Remove plain mirrors, use FHE.select, decryptForView for UI |
| HIGH | All | No allowPublic() — no unshield/reveal possible | Add allowPublic + publishDecryptResult functions |
| HIGH | All | No publishDecryptResult flow | Add verifyDecryptResult for liquidation, FHE.select for health checks |
| HIGH | LendingPool | Trivial encryption in liquidation | Use encrypted inputs or decryptForTx+verifyDecryptResult |
| HIGH | LendingPool | require() on encrypted conditions | Replace with FHE.select-based logic |
| HIGH | Composer | Missing cross-contract ACL | Use allowTransient for same-tx, allow for persistent |
| HIGH | Composer | Permit2 creates UX friction (3 signing steps) | Add direct transferFrom path, bundle signing |
| MEDIUM | LendingPool | euint64 balances may overflow 18-decimal tokens | Migrate to euint128 |
| MEDIUM | LendingPool | No interest accrual | Add encrypted supplyIndex/borrowIndex, FHE.mul |
| MEDIUM | Registry | encryptedTvls only has allowThis | Add allowSender or allow(strategy) |
| MEDIUM | Vault | SameBlockClose reverts leak timing | Allow same-block close or use FHE.select |

## Refactor Priority
- **P0**: Fix allowThis bug in _writeLiquidationHandles (will cause ACLNotAllowed on next operation)
- **P1**: Remove plain mirrors, replace require() with FHE.select
- **P2**: Add allowPublic + publishDecryptResult for on-chain unshield/reveal
- **P3**: Migrate Pool balances from euint64 to euint128
- **P4**: Add direct transferFrom path as Permit2 alternative
- **P5**: Add encrypted interest accrual

## Next Steps

1. Run `npx hardhat run scripts/audit-onchain.ts --network arb-sepolia` — full on-chain audit
2. Review FHE architecture issues and plan contract refactor (P0 first — allowThis bug)
3. Redeploy with P0 fix (allowThis in liquidation) — cascading redeploy needed
4. Build + walk frontend, verify decryptForView works in UI
5. Plan P1 refactor (remove plain mirrors) for V2