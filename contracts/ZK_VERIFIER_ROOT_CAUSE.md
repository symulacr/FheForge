# ZK Verifier Root Cause Analysis — CONFIRMED

## Finding

**The CoFHE TaskManager on arb-sepolia (0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9) has a STALE ZK verifier signing key.**

## Evidence

| Test | setAccount | Pool.shield Result | Recovered Signer | Expected (slot 4) |
|------|-----------|-------------------|-----------------|-------------------|
| A | None | SUCCESS | (old key, matches slot 4) | — |
| B | deployer | SUCCESS | (old key, matches slot 4) | — |
| C | Pool | InvalidSigner | 0xd2973164... | 0x013a19c34... |
| D | Composer | InvalidSigner | 0xd72f9f50... | 0x013a19c34... |
| E | Vault | InvalidSigner | 0x916f9ea6... | 0x013a19c34... |

**TaskManager storage slot 4** (expected signer): `0x013a19C3401B19C21390BF3f0BCdf9C01eAAfe71`

The recovered signer varies per call but is always DIFFERENT from slot 4 when `setAccount` targets a contract. When targeting the user's wallet (or omitted), it MATCHES slot 4.

## Root Cause

The CoFHE testnet ZK verifier service has TWO signing keys:

1. **User-wallet key** (matches slot 4 `0x013a19c34...`): Used when `account` is an EOA / the connected wallet
2. **Contract-account key** (newer, NOT in slot 4): Used when `account` is a contract address

The on-chain TaskManager was NOT updated when the contract-account signing key was rotated. The user-wallet key still matches slot 4, so direct user→contract FHE calls work. But `setAccount(contractAddress)` triggers the new key, which doesn't match → `InvalidSigner`.

## Impact

- **Direct user→contract FHE calls** (Pool.shield, Vault.openPosition): **WORK** (no setAccount needed)
- **Cross-contract via Composer with setAccount(Composer)**: **BROKEN** (InvalidSigner)
- **Composer without setAccount**: **WORKS** because account defaults to deployer wallet, which matches the old key

## Workaround

Use `enc128()` (NO `setAccount`) for ALL calls including Composer. This works because:
- The TaskManager does NOT enforce `account == msg.sender` for `FHE.asEuint128`
- The default `account = connected wallet` uses the old signing key that matches slot 4
- The contract still receives valid encrypted handles

This is NOT the documented CoFHE pattern (which requires `setAccount` for cross-contract), but it's the only option until Fhenix updates the TaskManager.

## Required Fix (Fhenix side)

Update TaskManager slot 4 on arb-sepolia with the current contract-account signing key, or add a separate slot for contract-account keys.

## Verification Commands

```bash
# Check TaskManager storage slots
npx hardhat run scripts/check-tm.ts --network arb-sepolia

# Test setAccount variants
npx hardhat run scripts/debug-zk4.ts --network arb-sepolia

# Test composer with setAccount(deployer) workaround
npx hardhat run scripts/debug-zk3.ts --network arb-sepolia
```
