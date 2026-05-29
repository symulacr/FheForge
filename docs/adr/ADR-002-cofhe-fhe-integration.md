# ADR-002: CoFHE FHE Integration for Private State

- **Status**: Accepted
- **Date**: 2026-05-28
- **Author**: FheForge Team

## Context

FheForge requires on-chain encrypted state for all user balances and positions — supply amounts, borrow amounts, vault collateral — with the ability to compute on these encrypted values (addition, multiplication, comparison) without ever decrypting them. The system also needs controlled, selective decryption so only authorized parties (the position owner, or a permit holder) can reveal plaintext amounts.

Key requirements:

- Encrypted uint types (`euint128`) for all financial amounts
- Encrypted mappings (`eMapping`) for user-to-balance associations
- FHE arithmetic: add, subtract, multiply, compare (lte, eq), select (conditional)
- ACL-based decryption control — only authorized addresses can decrypt a given handle
- Transient ACL grants to enable composability: contract A computes on encrypted value, grants temporary access to contract B
- Verification of decryption results against threshold-signed proofs (not raw plaintext return)

CoFHE (Threshold FHE) was chosen over alternatives (Zama's fhEVM, Fhenix) because it provides:
- A live TaskManager on Arbitrum Sepolia
- Standard Solidity interfaces (`FHE.sol`) compatible with Hardhat/Foundry
- SDK support (`@cofhe/sdk`, `@cofhe/react`) for client-side encryption

## Decision

We integrate CoFHE's `FHE.sol` library as the sole encryption layer across all contracts. All sensitive state is stored as `euint128` handles, and all on-chain computation on encrypted values uses the CoFHE FHE operations.

### Encrypted Types Used

| Type | Purpose | Usage |
|---|---|---|
| `euint128` | Encrypted unsigned 128-bit integer | Primary type for all amounts (supply, borrow, collateral, TVL) |
| `InEuint128` | Calldata-encoded encrypted input | User-submitted encrypted amounts (decoded via `FHE.asEuint128()`) |
| `ebool` | Encrypted boolean | Result of FHE comparisons (`FHE.eq`, `FHE.lte`) for conditional selection |
| `eMapping` (implicit) | Encrypted mapping via `mapping(address => euint128)` | Supply balances, borrow balances, position collateral |

### FHE Operations Used

| Operation | Contract Usage | Example |
|---|---|---|
| `FHE.asEuint128(InEuint128)` | All contracts | Convert calldata to encrypted handle |
| `FHE.eq(a, b)` | FheForgeBase._verifyEquality | Verify ciphertext matches claimed plaintext |
| `FHE.select(cond, a, b)` | FheForgeBase._verifyEquality | Choose verified amount or zero |
| `FHE.add(a, b)` | LendingPool | Add new borrow to existing borrow balance |
| `FHE.mul(a, b)` | LendingPool | Compute LTV check: `borrow * ltvDen <= supply * ltvNum` |
| `FHE.lte(a, b)` | LendingPool | Compare leveraged position against LTV threshold |
| `FHE.isInitialized(handle)` | FheForgeBase._ensureInitialized | Guard against uninitialized handles |
| `FHE.allowThis(handle)` | All contracts | Grant ACL to the current contract |
| `FHE.allow(handle, addr)` | FheForgeBase._grantAcl | Grant ACL to a specific user |
| `FHE.allowTransient(handle, addr)` | FheForgeComposer, LendingPool | Grant temporary ACL for downstream call |
| `FHE.allowSender(handle)` | LendingPool.getSupplyBalance | Grant ACL to the caller (view helper) |
| `FHE.allowPublic(handle)` | LendingPool.requestBalanceReveal | Publish ACL for audit/decrypt flows |
| `FHE.verifyDecryptResult(handle, proof, sig)` | LendingPool.unshieldWithProof | Verify threshold-decrypted result |

### Encryption Flow: Decrypt → Prove → Submit

```
User wants to withdraw or reveal balance:
  1. DECRYPT: User calls LendingPool.requestBalanceReveal(token) which calls
     FHE.allowPublic(handle) — CoFHE threshold network decrypts the handle
     and provides the plaintext value to the caller via decryptForView
  2. PROVE: CoFHE produces a threshold-signed proof (balanceProof, balanceSig)
     that cryptographically attests to the decrypted value
  3. SUBMIT: User calls unshieldWithProof(token, balanceProof, balanceSig)
     Contract calls FHE.verifyDecryptResult(handle, proof, sig) to validate
     against the CoFHE threshold network, then processes the withdrawal
```

### ACL Model

- **Default**: FHE handles have no ACL — no address can read them
- **On creation**: `_grantAcl()` grants ACL to both the contract and the user
- **Transient grants**: `FHE.allowTransient()` grants access for the current transaction only — used by FheForgeComposer when passing encrypted handles to LendingPool/StrategyVault
- **Public reveal**: `FHE.allowPublic()` is called only on explicit user action (`requestBalanceReveal`, `requestUnshield`)
- **Withdraw pause**: `withdrawPausedWithProof()` bypasses normal ACL and uses `FHE.verifyDecryptResult` for safety during emergency pauses

### Verification of Equality Pattern

Each function that accepts both a plaintext `amount` and an encrypted `InEuint128 encAmount` executes:

```solidity
euint128 incoming = FHE.asEuint128(encAmount);
euint128 result = _verifyEquality(incoming, amount);
// result is either the verified incoming (if FHE.eq matches) or _ZERO
```

This is implemented in `FheForgeBase._verifyEquality()`:

```solidity
function _verifyEquality(euint128 incoming, uint256 claimedPlain)
    internal returns (euint128 result)
{
    _validateCiphertext(incoming);
    euint128 claimedEnc = FHE.asEuint128(claimedPlain);
    ebool match_ = FHE.eq(incoming, claimedEnc);
    result = FHE.select(match_, incoming, _ZERO);
    FHE.allowThis(result);
    return result;
}
```

If the equality check fails, the result is `_ZERO` (a statically initialized `euint128` of value 0).

## Consequences

### Positive

- **Native on-chain FHE**: All computation stays on-chain with no trusted hardware (TEE) or off-chain computation (ZK/MPC)
- **Selective disclosure**: Users control decryption via ACL, supporting the auditor/regulator permit model
- **Composability**: Transient ACL enables safe multi-contract orchestration without broad permanent grants
- **SDK support**: `@cofhe/sdk` for Node.js, `@cofhe/react` for frontend — standard tooling

### Negative

- **Gas cost**: FHE operations are orders of magnitude more expensive than plaintext arithmetic. A single `FHE.mul` for an LTV check costs significantly more than the equivalent plaintext `*` operation
- **Threshold network dependency**: Decryption (`verifyDecryptResult`) requires the CoFHE threshold network to be live and responsive. If the TaskManager is down, withdrawals and liquidations that require proof verification are blocked
- **CoFHE beta maturity**: The SDK is in beta (version 0.0.0-beta as of deployment) — subject to breaking API changes, undiscovered bugs, and potential deprecation
- **Handle management complexity**: Developers must carefully manage `euint128` ACL lifecycle — forgetting to grant transient ACL causes downstream reverts, over-granting leaks privacy
- **No native eMapping**: `eMapping` is not used; instead, standard Solidity mappings of `<address> => <euint128>` simulate encrypted mappings, requiring manual ACL management per user per token

### Key Risks

- **Dual-input verification gap**: The `_verifyEquality` pattern cannot cryptographically link the user's intent to the encrypted value — the plaintext is provided by the same caller. A ZK proof of equality is planned for post-MVP
- **FHE.allowPublic() permanently burns privacy**: Once `allowPublic` is called on a handle, any address can decrypt that handle. The pattern is used but must be carefully scoped to explicit user action
