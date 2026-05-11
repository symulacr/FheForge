# Handoff — Wave16 Composer Fix + CoFHE setAccount Integration

**Date**: 2026-05-10
**Status**: ✅ Composer flow verified on-chain

---

## Wave16 Deployed Contracts (Arb Sepolia, chainId 421614)

| Contract | Address |
|----------|---------|
| StrategyRegistry | `0x59d955dA6a678D140ce8379ae7175850B7481E76` |
| LendingPool | `0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb` |
| PriceOracle | `0xD0f0072ae4308be044bd5722059ACCf2CF543130` |
| SwapRouter | `0x20C385f6292440aaDD6a4d7F620B612B658a1a93` |
| ExecutorContract | `0x9bA1498Bc935F5BE8138D40B366418C874A1A345` |
| StrategyVault | `0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa` |
| FheForgeComposer | `0xeF1EdEcB5Df34C732561685F5Efa788947Dd68b8` |

All verified on Sourcify + Arbiscan.

---

## Key Fixes This Session

### Composer Token Flow Bug (Wave16)
- **Root cause**: `openLeveragedStrategyDirect` pulled `collateralAmount` + `poolSupplyAmount` separately. Vault took `collateralAmount`, then Pool tried to pull `poolSupplyAmount` from empty Composer.
- **Fix**: Pull `totalNeeded = max(collateralAmount, poolSupplyAmount)` once. Split: vault gets `min(totalNeeded, collateralAmount)`, pool gets `totalNeeded - vaultCovered`.
- **`_supplyToPoolDirect`** signature changed to accept `uint256 supplyAmount` parameter.

### Pool Composer Address
- After Composer redeploy, Pool still referenced old composer address.
- Fixed via `pool.setComposer(newComposer)`. Vault has no composer reference.

### CoFHE setAccount Fix
- **Root cause**: `TaskManager.extractSigner` validates `keccak256(ctHash||utype||securityZone||sender||chainId)`. When Composer forwards inputs, `msg.sender=Composer` but SDK signed with `account=user`.
- **Fix**: `encryptInputs([...]).setAccount(composerAddress).execute()` embeds Composer's address in proof signature.
- Applied to:
  - `contracts/scripts/audit-onchain.ts` — `enc64For`/`enc128For` helpers
  - `ui/hooks/use-composer.ts` — `encrypt64ForComposer`/`encrypt128ForComposer` helpers
  - `ui/app/strategy-review/StrategyReviewClient.tsx` — uses `encrypt128ForComposer`/`encrypt64ForComposer`
  - `ui/components/shared/execution-modal.tsx` — uses `encrypt128ForComposer`/`encrypt64ForComposer`

### SDK Upgrade
- `@cofhe/sdk` 0.5.1→0.5.2 (both contracts/ and ui/)
- `@cofhe/hardhat-plugin` 0.5.1→0.5.2
- `@cofhe/mock-contracts` 0.5.1→0.5.2
- `@cofhe/abi` 0.5.1→0.5.2

### openLeveragedStrategyDirect added to use-composer.ts
- New frontend function bypassing Permit2 (3 signing steps → 1 approve)

---

## On-Chain Audit Results (9 PASS / 0 FAIL)

```
✓ Pool.composer == new Composer
✓ Pool.supply (user direct)
✓ Vault.openPosition (user direct)
✓ Vault.closePosition
✓ Composer.openLeveragedStrategyDirect (no vault, no swap)
✓ Composer.openLeveragedStrategyDirect (with vault, no swap)
✓ Registry.strategyCount > 0
✓ Pool not paused
✓ Vault not paused
```

Run: `npx hardhat run scripts/audit-quick.ts --network arb-sepolia`

---

## Known Issues (NOT fixed)

| ID | Issue | Why Not Fixed |
|----|-------|---------------|
| C-01 | Dual plain+encrypted input skew | Needs ZK proof of equality |
| C-02 | borrowFromLending no LTV | Needs cross-contract health factor |
| C-06 | One position per user | Needs Vault storage restructuring |
| Swap | Composer swap flow broken | Borrowed tokens sent to user before swap escrow — architectural fix needed |
| supplyEth | `unknown(0x)` revert | FHE input format or WETH deposit issue |
| Liquidation | `invalid BigNumberish` | ABI encoding of encrypted inputs |

---

## Deployer Info
- Address: `0x485534DE1BB491ed0D624dd9b9c3A89a140E58a8`
- Balance: ~0.49 ETH on arb-sepolia
- Mock tokens: WETH=`0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d`, USDC=`0x150376EdEbc5AC48771655a61a795d828BeC8Df6`
- CoFHE TaskManager: `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9` (REAL coprocessor)

---

## Key Scripts
- `deploy-full.ts` — unified deploy
- `audit-quick.ts` — fast targeted on-chain test (9 checks, ~2 min)
- `audit-onchain.ts` — comprehensive audit (127 tests, slow)
- `close-vault-position.ts` — close vault position helper
- `unpause-all.ts` — unpause all contracts
- `verify-wiring.ts` — verify contract wiring

---

## Next Steps
1. Fix Composer swap flow (architectural — keep borrowed tokens in Composer when swap is needed)
2. Fix supplyEth `unknown(0x)` revert
3. Fix liquidation flow `invalid BigNumberish`
4. Add `FHE.allowTransient()` in Composer before calling Pool/Vault (R2 from CoFHE plan)
5. Add `FHE.allowThis()` after Composer-triggered encrypted mutations (R3)
6. Test full frontend E2E with real wallet + CoFHE SDK
7. Commit all changes
