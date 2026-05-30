# ZK Verifier Fix — Research & Validation Report

## Problem
`setAccount(contractAddr)` on CoFHE SDK triggered `InvalidSigner(address,address)` (selector `0x7ba5ffb5`) when encrypting inputs targeting a contract account on arb-sepolia.

## Root Cause (CONFIRMED)
TaskManager at `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9` had stale ZK verifier signing key in storage slot 4 (`0x013a19C3401B19C21390BF3f0BCdf9C01eAAfe71`). The off-chain ZK verifier service at `testnet-cofhe-vrf.fhenix.zone` used a newer key for contract accounts, but the on-chain stored key only matched the old EOA/wallet key.

## Fix (NOW LIVE)
Fhenix rotated the TaskManager signing key. As of 2026-05-10:

- **decryptResultSigner()**: `0x5a33384B487224500Ee5a84C846A7Aa469E9ae1A` (slot 7)
- **owner()**: `0x6578D0E3A6d902896415c51cf4188fFBEBE753DB` (Fhenix — unchanged)
- **slot 4** (old stale key): `0x013a19C3401B19C21390BF3f0BCdf9c01eAAfe71` (still present but no longer the active signer)

## Manual Test Proof (2026-05-10, arb-sepolia chainId 421614)

### Test 1: setAccount(contract) encryption
```
setAccount(pool)      → PASS (ctHash: 745372340313289007442276594185)
setAccount(executor)  → PASS (ctHash: 819940900980145485416015763471)
```

### Test 2: Full shield flow (wallet encryption, no setAccount)
```
pool.shield(USDC, 10e6, enc128(10e6)) → PASS (gas: 317659)
USDC reserve after: 110.0
```

### Test 3: Flash loan queries
```
maxFlashLoan(USDC)  → 110.0 USDC
flashFee(USDC, 5)   → 0.0025 USDC (0.05% fee)
```

## What This Unblocks
1. **StrategyExecutor pipeline** — can encrypt inputs for executor contract via `setAccount(executorAddr)`
2. **Cross-contract FHE** — Composer can receive encrypted inputs targeting itself via `setAccount(composerAddr)`
3. **Full CoFHE SDK flow** — `setAccount` is no longer broken on arb-sepolia

## Proper Fix Pattern
```typescript
// ENCRYPT FOR CONTRACT (now works!)
const [encAmt] = await client.encryptInputs([Encryptable.uint128(amount)])
  .setAccount(contractAddr)  // ← NO MORE InvalidSigner!
  .execute();

// Pass to contract
await contract.someFunction(encAmt);
```

## Compatibility
- CoFHE SDK: 0.5.2 (current minimum: 0.5.1 per official docs)
- cofhe-contracts: 0.1.3
- Hardhat plugin: 0.5.1
- Networks: arb-sepolia ✅, eth-sepolia ✅, base-sepolia ✅

## Action Items
1. Remove `setAccount` workaround comments from audit-fhe.ts
2. Update StrategyExecutor to use `setAccount(executorAddr)` encryption
3. Re-enable Composer cross-contract tests with `setAccount(composerAddr)`
4. Re-run full audit with setAccount-enabled encryption

## Sources
- CoFHE docs: https://cofhe-docs.fhenix.zone/deep-dive/cofhe-components/zk-verifier
- CoFHE docs: https://cofhe-docs.fhenix.zone/client-sdk/guides/encrypting-inputs
- CoFHE docs: https://cofhe-docs.fhenix.zone/fhe-library/core-concepts/common-errors
- CoFHE errors: https://cofhe-docs.fhenix.zone/fhe-library/reference/cofhe-errors-reference
- GitHub: https://github.com/FhenixProtocol/cofhesdk
- TaskManager on-chain state verified 2026-05-10
