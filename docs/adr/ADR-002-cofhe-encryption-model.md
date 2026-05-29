# ADR-002: CoFHE Encryption Model

- **Status**: Accepted
- **Date**: 2026-05-28

## Context

FheForge needs a robust encryption model for all financial state. Every sensitive value (supply balance, borrow balance, vault collateral, strategy TVL) must be encrypted at rest on-chain. The encryption model must support:

- **Handle-based encrypted values**: Encrypted values are not stored raw on-chain but as opaque handles (references) managed by the CoFHE runtime. Contracts cannot see the underlying plaintext.
- **Encrypted arithmetic**: The model must support addition, multiplication, and comparison on encrypted handles without decryption, enabling LTV checks, balance updates, and conditional logic on hidden values.
- **Controlled decryption**: Only authorized addresses may decrypt a given handle. The default state should be fully private; decryption rights must be explicitly granted.
- **Transient access for composability**: When one contract passes an encrypted handle to another within a single transaction, the downstream contract needs temporary access without a permanent ACL grant.
- **Verifiable decryption**: Decrypted values must be accompanied by a cryptographic proof from the CoFHE threshold network, not returned as raw plaintext that could be forged.

Without this model, either all state would be public (defeating privacy) or decryption would be uncontrolled (leaking user positions).

## Decision

We use CoFHE's handle-based encryption model with `euint128` as the primary encrypted type, `eMapping` patterns for user-to-balance associations, and a three-phase decrypt-prove-submit flow for controlled decryption.

### Handle-Based Encryption with euint128

All financial amounts are stored as `euint128` handles. The actual ciphertext is managed by the CoFHE runtime (TaskManager); Solidity contracts hold only opaque references:

```solidity
// State storage pattern for encrypted balances
mapping(address => euint128) internal _supplyBalances;
mapping(address => euint128) internal _borrowBalances;
```

Key properties of the handle model:

- **Client encryption**: The user's frontend encrypts the amount using the CoFHE SDK, producing an `InEuint128` calldata struct. The plaintext never leaves the client device.
- **Handle creation**: Contracts call `FHE.asEuint128(InEuint128)` to convert calldata to a runtime handle. This operation is the entry point for all encrypted values.
- **Zero initialization**: `euint128` handles default to uninitialized. `FHE.isInitialized()` guards against arithmetic on zero-value handles. A static `_ZERO` handle is initialized at construction for safe default values.
- **No direct read**: Contracts cannot inspect the value of an `euint128` handle. Only CoFHE operations (`FHE.add`, `FHE.mul`, `FHE.lte`, etc.) can compute on them, producing new handles or `ebool` results.

### Encrypted Mappings (eMapping Pattern)

CoFHE does not provide a native `eMapping` type in the Solidity SDK. Instead, standard Solidity `mapping(address => euint128)` stores encrypted handles. This means:

- Each user's balance is an encrypted handle stored at their address key
- Adding to a balance: `_supplyBalances[user] = FHE.add(_supplyBalances[user], incoming)`
- Reading requires ACL -- the caller must be granted permission on the specific handle
- Per-token mappings (e.g., `mapping(address => mapping(address => euint128))`) handle multi-token support

This pattern simulates encrypted mappings but requires manual ACL management. Each read operation must grant ACL to the caller via `FHE.allowSender()` or `FHE.allow(user)` before `decryptForView`.

### Controlled Decryption via Permits

Decryption is a two-phase process controlled by the CoFHE ACL system:

**Phase 1: ACL Grant** -- The handle owner (or a contract acting on their behalf) grants decryption rights:

| Method | Scope | Use Case |
|---|---|---|
| `FHE.allow(handle, addr)` | Permanent, single address | Granting liquidator access to a position |
| `FHE.allowSender(handle)` | Permanent, tx.origin | Unshield flows where msg.sender should read |
| `FHE.allowTransient(handle, addr)` | Current transaction only | Cross-contract composability |
| `FHE.allowPublic(handle)` | Permanent, any address | Public audit or balance reveal flows |

**Phase 2: Decrypt** -- Once ACL is granted, the authorized address can decrypt via one of two paths:

- **`decryptForView`**: Off-chain call (via CoFHE SDK provider) that returns the plaintext to the caller. Used for read-only operations (dashboard display, position monitoring). No on-chain proof is generated.
- **`FHE.verifyDecryptResult`**: On-chain call that submits a threshold-signed proof from the CoFHE network along with the claimed plaintext value. The contract verifies the proof against the handle. Used for state-changing operations (withdraw, liquidate).

### Decrypt-Prove-Submit Flow

State-changing decryption follows a strict three-phase protocol:

```
Phase 1: DECRYPT
  User calls LendingPool.requestBalanceReveal(token)
    → Contract calls FHE.allowPublic(encryptedHandle)
    → CoFHE threshold network decrypts the handle
    → User's client receives the plaintext value via decryptForView
    → CoFHE SDK also returns a threshold-signed proof (proof + signature)

Phase 2: PROVE
  User's client retains:
    - The plaintext value (e.g., 1000 * 10^6 USDC)
    - The threshold proof (balanceProof: bytes)
    - The threshold signature (balanceSig: bytes)
  These are valid for a limited window (CoFHE proof expiry)

Phase 3: SUBMIT
  User calls LendingPool.unshieldWithProof(token, amount, balanceProof, balanceSig)
    → Contract calls FHE.verifyDecryptResult(encryptedHandle, balanceProof, balanceSig)
    → CoFHE runtime validates the proof against the handle
    → If valid, the contract processes the withdrawal
    → The encrypted handle is consumed or decremented
```

This flow ensures that:
- No plaintext is ever stored on-chain or visible to the contract
- Decryption requires active participation of the CoFHE threshold network (≥ threshold nodes)
- Withdrawals are provably backed by real decrypted values, not user-supplied claims

### Encryption Rights Gating

Not all addresses can encrypt arbitrary values. Encryption rights are gated by two CoFHE primitives:

- **`FHE.allowPublic()`**: Called on a handle to make it publicly decryptable. Any address can then call `decryptForView` on this handle. Used sparingly and only on explicit user action (e.g., `requestBalanceReveal`).
- **`FHE.allowTo(handle, addr)`**: Targeted ACL grant for a specific address. Used to grant liquidators, auditors, or the user's own second wallet access to a specific position handle.

The default state for any handle is fully private, no address can decrypt it. Every decryption path requires an explicit ACL grant.

## Consequences

### Positive

- **Complete privacy by default**: All financial state is encrypted. No position data, balance, or strategy movement is visible on-chain without explicit authorization.
- **Selective disclosure**: Users choose exactly who can decrypt their positions via permits and targeted ACL grants. Supports the auditor/regulator model.
- **Verifiable decryption**: `FHE.verifyDecryptResult()` provides cryptographic proof that decrypted values are authentic, preventing forged plaintext attacks.
- **Transient composability**: `FHE.allowTransient()` enables safe cross-contract encrypted data flow without permanent ACL grants, preserving privacy across multi-step operations.

### Negative

- **Decryption requires threshold network**: Both `decryptForView` and `FHE.verifyDecryptResult` require the CoFHE TaskManager to be live. If the threshold network is down, no decryption is possible. This is a single point of failure for all withdrawal and liquidation flows.
- **Permanent ACL risk**: `FHE.allowPublic()` permanently burns privacy for a handle. Once called, any address can decrypt that handle forever. Misuse (e.g., calling it in the wrong code path) leaks user data permanently.
- **No native eMapping**: Without a native encrypted mapping type, per-user ACL management must be handled manually. Each read of a user's balance requires explicit ACL grant logic, adding complexity and gas cost.
- **Handle lifecycle complexity**: `euint128` handles are managed by the CoFHE runtime with refcounting. Forgetting to call `FHE.allowTransient()` causes opaque reverts. Incorrect refcounting can leak handles (memory leak) or cause use-after-free errors.
- **Proof expiry**: Threshold-signed proofs from the CoFHE network have a limited validity window. Users who generate a proof but delay submission may need to restart the decrypt-prove-submit flow.

### Risks

- CoFHE SDK beta status -- breaking changes to the ACL API, handle lifecycle, or proof format could require substantial contract rewrites.
- The `_verifyEquality` pattern (dual plain+encrypted input) cannot cryptographically link user intent to ciphertext without a ZK proof of equality, tracked as a post-MVP enhancement.
- `FHE.allowPublic()` is a one-way operation. There is no revoke mechanism under the current CoFHE API.
