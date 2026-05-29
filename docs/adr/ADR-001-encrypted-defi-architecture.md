# ADR-001: Encrypted DeFi Architecture

- **Status**: Accepted
- **Date**: 2026-05-28

## Context

FheForge requires a smart contract architecture that supports private encrypted DeFi operations on Arbitrum Sepolia using CoFHE (threshold FHE). Traditional DeFi operates entirely in the clear, with every position, swap, and liquidation visible on-chain. FheForge needs to hide all financial amounts while still enabling core DeFi operations: supply, borrow, swap, liquidate, and automated multi-step strategies.

The architecture must satisfy three distinct concerns that map to separate layers:

1. **DeFi logic** -- standard lending pool mechanics, swap routing, vault position management, price feeds, and governance. These contracts handle the protocol's business rules.
2. **Encryption management** -- CoFHE handle lifecycle, ACL grants (allowPublic, allowTo, allowTransient), ciphertext verification, and threshold decryption proofs. These cross-cut all contracts.
3. **Multi-step execution** -- atomic sequencing of operations across contracts, gas checkpointing for long pipelines, and access-controlled intent execution.

No single contract can own all three concerns without becoming unmanageable. Each layer imposes different upgrade, access control, and testing requirements.

## Decision

We adopt a **three-layer architecture** that separates DeFi logic, encryption management, and execution orchestration into distinct contract groups:

### Layer 1: Contract Layer (DeFi Logic)

Each core DeFi function is owned by a dedicated contract with single responsibility:

| Contract | Responsibility |
|---|---|
| **LendingPool** | Encrypted supply, borrow, repay, withdraw, and liquidation with LTV checks using FHE comparison operations |
| **StrategyVault** | Encrypted position management -- open, add collateral, close positions with per-position euint128 tracking |
| **SwapRouter** | DEX integration supporting both intent-based swaps and direct Uniswap V3 single-hop/multi-hop swaps |
| **PriceOracle** | Multi-source price feeds (Pyth, Chainlink, custom) with per-token staleness thresholds and collateral factor |
| **StrategyRegistry** | Strategy catalog with encrypted TVL tracking, registration, activation, and cross-chain broadcast |
| **FlashLoanProvider** | Encrypted flash loan support within the LendingPool |
| **GovernanceModule** | Protocol parameter management, pause control, and upgrade authorization |
| **FheForgeBase** | Abstract base inherited by all contracts providing _verifyEquality, _safeIncrease, _safeDecrease, _grantAcl, pause/unpause, and two-step ownership |

These contracts operate on `euint128` handles but do not manage ACL beyond their immediate needs. They call `FHE.asEuint128()` for input conversion, `FHE.add`/`FHE.mul`/`FHE.lte` for encrypted arithmetic, and `FHE.allowThis()`/`FHE.allowSender()` for basic access control.

### Layer 2: Encryption Layer (CoFHE Handle & Permit Management)

Encryption concerns are managed through CoFHE's ACL system and two dedicated patterns:

- **Handle lifecycle**: Client encrypts with CoFHE SDK producing `InEuint128` calldata. Contracts call `FHE.asEuint128()` to create an `euint128` handle. The handle exists until explicitly freed (CoFHE handles refcounted state).
- **ACL management**: `FheForgeBase._grantAcl()` centralizes granting ACL to both the contract and the user. `FHE.allowTransient()` grants temporary ACL for composability across contracts within a single transaction. `FHE.allowPublic()` permanently publishes a handle for anyone to decrypt (used only on explicit user action like `requestBalanceReveal`).
- **Permit-based decryption**: Users generate signed permits off-chain granting specific addresses the right to call `decryptForView` on specific handles. This enables the auditor/liquidator model without broad public exposure.
- **Verification**: `FHE.verifyDecryptResult()` accepts a threshold-signed proof attesting to a decrypted value, enabling trustless withdrawal and liquidation flows.

The encryption layer is not a single contract but a set of patterns and ACL primitives that permeate all contracts through `FheForgeBase`.

### Layer 3: Execution Layer (StrategyExecutor Pipeline)

Multi-step execution is handled by two dedicated contracts:

- **StrategyExecutor**: Manages a pipeline of up to 8 action types (`SupplyCollateral`, `Borrow`, `SwapViaUniswap`, `RepayDebt`, etc.) with gas checkpointing. Maintains a `mapping(bytes32 => Checkpoint)` that tracks the next action index. Before each action, checks `gasleft() >= 100,000` and saves progress if gas is low.
- **ExecutorContract**: Thin Ownable access proxy for executing swap intents on SwapRouter and managing token approvals. Never holds user funds -- operates purely on approved allowances.

The composer pattern (`FheForgeComposer.openPosition()`) provides a high-level 4-step opinionated flow (vault, deposit, borrow, swap) that internally calls into all three layers.

```
         ┌──────────────────────────────────────────────────┐
         │               FheForgeComposer                    │
         │       (High-level position orchestration)        │
         └────┬──────────┬────────────────┬────────────────┘
              │          │                │
     ┌────────▼──┐ ┌─────▼──────┐ ┌──────▼─────────┐
     │ LAYER 1   │ │ LAYER 2    │ │ LAYER 3        │
     │ DeFi      │ │ Encryption │ │ Execution       │
     │ Contracts │ │ ACL/Permits│ │ Pipeline        │
     │           │ │            │ │                 │
     │ Lending   │ │ FheForge   │ │ Strategy        │
     │ Pool      │ │ Base       │ │ Executor        │
     │           │ │            │ │                 │
     │ Swap      │ │ CoFHE SDK  │ │ Executor        │
     │ Router    │ │ (external) │ │ Contract        │
     │           │ │            │ │                 │
     │ Strategy  │ │ Permit     │ │                 │
     │ Vault     │ │ System     │ │                 │
     └───────────┘ └────────────┘ └─────────────────┘
```

## Consequences

### Positive

- **Separation of concerns**: Each contract owns a single responsibility. LendingPool focuses on lending math, not ACL management. StrategyExecutor focuses on sequencing, not DeFi logic. Testing and upgrades are isolated.
- **Cross-cutting encryption**: The FheForgeBase base class ensures consistent ACL and verification behavior across all contracts without duplication.
- **Composability**: The execution layer can combine any sequence of actions from the contract layer, enabling novel strategies without deploying new contracts.
- **Auditability**: Each layer can be audited independently. The encryption layer's ACL patterns are consistent and reviewable in one place (FheForgeBase).

### Negative

- **FHE gas overhead**: Every FHE operation (`FHE.add`, `FHE.mul`, `FHE.lte`, `FHE.select`, `FHE.eq`, `FHE.asEuint128`) adds significant gas cost compared to plaintext arithmetic. A single LTV check using `FHE.mul` and `FHE.lte` costs orders of magnitude more than the plaintext equivalent. This limits the complexity of per-transaction FHE computation.
- **Threshold network dependency**: All decryption flows (`FHE.verifyDecryptResult`) depend on the CoFHE TaskManager being live and honest on Arbitrum Sepolia. If the threshold network is unavailable, withdrawals and liquidations that require proof verification cannot proceed.
- **Cross-layer coordination complexity**: Bugs at layer boundaries (e.g., forgetting `FHE.allowTransient()` before passing an encrypted handle from StrategyExecutor to LendingPool) cause subtle reverts that are hard to debug without deep CoFHE knowledge.
- **Single-chain coupling**: All three layers are deployed on Arbitrum Sepolia. Cross-chain strategy execution is limited to StrategyRegistry's broadcast/receive mechanism.

### Risks

- CoFHE SDK maturity (beta) may introduce breaking changes in future versions, requiring updates across all three layers.
- The dual plaintext+encrypted input pattern (`_verifyEquality`) cannot cryptographically link intent to ciphertext without a ZK proof of equality, a post-MVP enhancement.
