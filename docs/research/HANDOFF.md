# Handoff — P0-P10 V2 Refactor Complete + Repetition Analysis

**Date**: 2026-05-10
**Status**: ✅ All P0-P10 contract changes compiling + deployed (Wave17). Repetition analysis done.

---

## Wave17 Deployed Contracts (Arb Sepolia, chainId 421614)

| Contract | Address |
|----------|---------|
| StrategyRegistry | `0xFCb1beeaDBa65718eB1AF96F9fC72989704D98c0` |
| StrategyVault | `0x06d9A84B289f3203a3268051DE66D733fc6f7EeA` |
| FheForgeComposer | `0x9d3f780f1644E0A3E84b34bABcF11943377aFd46` |
| LendingPool | `0x6e4DA21723ea0e3E87320b5c7146DACacb2a4958` |
| SwapRouter | `0xC990c3287844e44D145780d5b90B0d22A7FE9A7d` |
| PriceOracle | `0x3ffD184d90daBe831C647D82242163B1940938b4` |
| ExecutorContract | `0xC607306C3F57B824a424d0b7b7140F74720a1527` |
| WETH9 | `0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32` |

All verified on Sourcify + Arbiscan.

---

## V2 Refactor Phases — Execution Status

| Phase | Description | Status |
|-------|-------------|--------|
| P0 | ACL fixes + Composer swap flow fix | ✅ Done + deployed (Wave17) |
| P1 | euint128 migration — all euint64→euint128 | ✅ Done + deployed |
| P2 | Eliminate plain mirrors — removed plainSupply/plainBorrow | ✅ Done + deployed |
| P3 | Interest accrual — shares-based with InterestIndex | ✅ Done + deployed |
| P4 | FHE.select health checks — checkHealth returning ebool | ✅ Done + deployed |
| P5 | Unshield/reveal — requestUnshield, unshieldWithProof, requestBorrowReveal | ✅ Done + deployed |
| P6 | Remove Permit2 + fix swap callback | ✅ Done + deployed |
| P7 | Multi-position vault — bytes32 positionId, getUserPositions | ✅ Done + deployed |
| P8 | Governance contracts — Governor + Timelock created | ✅ Contracts created, NOT integrated (OWNER→AccessControl migration pending) |
| P9 | Multi-source oracle — fallbackPrices, staleness, isStale | ✅ Done + deployed |
| P10 | Cross-chain events — broadcastStrategy, receiveCrossChainStrategy | ✅ Done + deployed |

**Pending**: P8 integration (replace OWNER immutable with AccessControl + UUPS proxy). Wave18 (LendingPool + Composer cross-contract euint128 handle fix).

---

## On-Chain Audit Results (Wave17: 10 PASS / 0 FAIL)

```
✓ Pool.supply (user direct)
✓ Pool.borrowWithOracle
✓ Vault.openPosition (user direct)
✓ Vault.closePosition
✓ Composer.openLeveragedStrategyDirect
✓ Registry.strategyCount > 0
✓ Oracle.getPriceWithFallback
✓ Pool not paused
✓ Vault not paused
✓ Router not paused
```

---

## Repetition Analysis — 20 Findings

Full report: `REPETITION_ANALYSIS.md`

Key findings:
- **3/20** addressed by V2 plan (R2/R3 via P8, R11/R12 partially via P1)
- **17/20** unplanned — no shared base contract, no shared error library, no shared constants
- **Top extractable patterns**: `allowThis+allow` ACL (×15), `_ZERO` init (×3), timelocked rotation (×2), `isInitialized?add:incoming` (×5), pause/unpause boilerplate (×4)
- **Bugs found**: Pool missing supply/borrow getters with allowSender; custom Paused/Unpaused events shadow OZ; Composer still passes InEuint128 to Vault's openPosition instead of euint128 handle

---

## Known Issues (NOT yet fixed)

| ID | Issue | Status |
|----|-------|--------|
| Wave18 | LendingPool + Composer cross-contract euint128 handle fix — compiled but not deployed | Ready to deploy |
| R18 | Pool has no getSupplyBalance/getBorrowBalance getters with allowSender | Unplanned |
| R20 | Custom Paused/Unpaused events shadow OZ Pausable events | Unplanned |
| R13 | Composer local interfaces duplicate actual contract interfaces | Unplanned |
| Composer→Vault | `_openVaultPosition` passes InEuint128 instead of euint128 handle to openPosition | Bug, unfixed |

---

## Deployer Info

- Address: `0x485534DE1BB491ed0D624dd9b9c3A89a140E58a8`
- Balance: ~0.49 ETH on arb-sepolia
- Private key: in `contracts/.env`
- Etherscan API key: in `contracts/.env`
- CoFHE TaskManager: `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9` (real coprocessor)
- Pyth: `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF`

---

## Key Scripts

- `deploy-full.ts` — unified deploy (set WAVE=17)
- `audit-quick.ts` — fast targeted on-chain test (10 checks)
- `audit-onchain.ts` — comprehensive audit (127 tests)

---

## Next Steps

1. Deploy Wave18 — LendingPool + Composer with cross-contract euint128 handle fix
2. Fix Composer→Vault InEuint128 vs euint128 bug in `_openVaultPosition`
3. Add Pool `getSupplyBalance`/`getBorrowBalance` getters with `allowSender`
4. Remove custom Paused/Unpaused events (rely on OZ events)
5. Extract shared `FheForgeBase.sol` abstract contract
6. P8 integration: replace OWNER with AccessControl + UUPS proxy
7. Extract Composer inline interfaces to `contracts/interfaces/`
