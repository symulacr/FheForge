# ADR-003: Strategy Execution Pipeline

- **Status**: Proposed
- **Date**: 2026-05-28

## Context

FheForge users need to execute automated multi-step DeFi strategies where each step involves encrypted amounts via CoFHE. A typical "loop" strategy might sequence supply collateral, borrow against it, swap borrowed tokens, and deposit the result back as collateral. Without a pipeline abstraction, users would submit separate transactions for each step, incurring higher costs, MEV exposure, and execution delay.

Key requirements for the execution layer:

- **Atomic multi-step execution**: A strategy must execute across multiple contracts (LendingPool, StrategyVault, SwapRouter) within a single transaction to minimize MEV exposure.
- **Gas resilience**: Pipelines involving many FHE operations (each `FHE.mul`, `FHE.add`, `FHE.lte` adds significant gas) may exceed block gas limits. Partial execution must be resumable.
- **Action variety**: Strategies can involve supply, borrow, swap (both intent-based and direct Uniswap V3), repay, add collateral, and withdraw. The pipeline must support at least 8 distinct action types.
- **Access control**: Swap intents require an authorized executor role. Not all pipeline contracts should hold this role -- a thin access proxy provides audit separation.

The existing `FheForgeComposer.openPosition()` provides a fixed 4-step flow but cannot accommodate the full range of strategy patterns users need.

## Decision

We implement a **StrategyExecutor** contract that manages a pipeline of up to 8 action types with gas checkpointing, paired with an **ExecutorContract** that provides access-controlled intent execution.

### StrategyExecutor Pipeline

The core data structure is the `Action` struct:

```solidity
struct Action {
    bytes4 actionType;   // Selector identifying which operation to perform
    bytes params;        // ABI-encoded parameters specific to the action
    InEuint128 encAmount; // Encrypted amount for FHE operations
}
```

Eight action types are defined:

| Action Type | Selector | Target | Purpose |
|---|---|---|---|
| `SupplyCollateral` | `0x00000001` | LendingPool | Supply tokens as collateral to the lending pool |
| `Borrow` | `0x00000002` | LendingPool | Borrow tokens against existing collateral with LTV check |
| `SwapViaUniswap` | `0x00000003` | SwapRouter | Execute a direct Uniswap V3 single-hop or multi-hop swap |
| `RepayDebt` | `0x00000004` | LendingPool | Repay outstanding borrow position |
| `DepositVault` | `0x00000005` | StrategyVault | Open a new vault position or deposit into existing one |
| `AddCollateral` | `0x00000006` | StrategyVault | Add additional collateral to an existing position |
| `WithdrawVault` | `0x00000007` | StrategyVault | Withdraw collateral from a vault position |
| `SwapIntent` | `0x00000008` | SwapRouter | Submit an intent-based swap (resolved by ExecutorContract) |

### Gas Checkpointing

The `executePipeline()` function implements a resumable execution model:

```solidity
struct Checkpoint {
    uint256 actionIndex;  // Next action index to execute
    bool completed;        // True if the entire pipeline finished
}

mapping(bytes32 => Checkpoint) public checkpoints;
```

Execution flow:

1. Read checkpoint from `checkpoints[strategyId]`. If `completed`, reset to index 0.
2. Iterate from `actionIndex` through the action array.
3. Before each action execution, check `gasleft() >= 100,000`.
4. If gas is too low, save `actionIndex = current + 1`, emit `PipelineCheckpointSaved`, and return `false`.
5. Execute the action: decode params, transfer tokens from user (if applicable), approve downstream contract, call downstream with `FHE.asEuint128(encAmount)`.
6. On full completion, set `completed = true` and `actionIndex = actions.length`.

The caller can resume by calling `executePipeline()` again with the same `strategyId` and `actions` array. The pipeline picks up from the saved checkpoint.

Admin functions provide safety valves:

- `resetCheckpoint(strategyId)`: Clears a stuck checkpoint, allowing the pipeline to restart from index 0.
- `pause()`/`unpause()`: Emergency stop for all pipeline execution (inherited from FheForgeBase).

### Encrypted Amount Handling

Each action carries its own `InEuint128 encAmount`. The StrategyExecutor does not perform FHE operations itself:

1. It calls `FHE.asEuint128(action.encAmount)` to convert calldata to an `euint128` handle.
2. It grants transient ACL to the downstream contract via `FHE.allowTransient(handle, downstream)`.
3. It passes the handle as part of the downstream call.

This pass-through design means the StrategyExecutor never needs to hold ACL on user handles beyond the current transaction.

### ExecutorContract as Thin Access Proxy

The `ExecutorContract` is a separate Ownable contract that serves as the sole holder of the `executor` role on `SwapRouter`:

- `executeIntent(address router, bytes32 intentId, uint256 outputAmount)`: Calls `router.executeIntent()` on behalf of the protocol.
- `approveToken(address token, address spender, uint256 amount)`: Manages token approvals for downstream swaps.
- `withdrawTokens(address token, address to, uint256 amount)`: Emergency token recovery.

The separation ensures StrategyExecutor never holds privileged roles directly. If the StrategyExecutor were compromised, an attacker could sequence arbitrary actions but could not execute swap intents -- only the ExecutorContract (Ownable) can do that.

### Pipeline Execution Sequence

```
                    User prepares Action[] off-chain
                             │
                    ┌────────▼────────┐
                    │ Approve tokens  │
                    │ to StrategyExec │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ executePipeline │
                    │ (strategyId,    │
                    │  actions)       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Load checkpoint │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Action 0 │  │ Action 1 │  │ Action 2 │
        │ Supply   │─▶│ Borrow   │─▶│ Swap     │
        └──────────┘  └──────────┘  └──────────┘
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Transfer │  │ LTV      │  │ Uniswap  │
        │ + Supply │  │ Check +  │  │ V3 Call  │
        │ To Pool  │  │ Borrow   │  │          │
        └──────────┘  └──────────┘  └──────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │ gasleft() check │
                    │ (100K reserve)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Save checkpoint │
                    │ or complete     │
                    └─────────────────┘
```

### Relationship to FheForgeComposer

| Aspect | FheForgeComposer | StrategyExecutor |
|---|---|---|
| Purpose | Standard leveraged position opening | Custom multi-step strategies |
| Flow | Fixed 4-step (vault, deposit, borrow, swap) | Arbitrary order of 8 action types |
| Flexibility | Opinionated, low config | Fully configurable action array |
| Checkpoint | None (atomic entire transaction) | Gas checkpoint with 100K reserve |
| Encrypted amounts | 3 encrypted params in one struct | 1 encrypted param per action |
| Use case | 80% of common strategies | Complex or experimental strategies |

## Consequences

### Positive

- **Atomic multi-step execution**: Entire strategies execute within one transaction, eliminating MEV exposure between steps. Intermediate state changes are not visible to searchers or front-runners.
- **Gas checkpointing**: Partial execution preserves all completed state changes. Users do not lose gas on failed long pipelines -- they resume from the last checkpoint.
- **Action composability**: Any combination of 8 action types enables diverse strategy patterns (loop strategies, collateral rebalancing, debt swapping, yield farming) without deploying new contracts.
- **Thin access control**: ExecutorContract isolates the privileged executor role from the pipeline logic. A StrategyExecutor bug cannot be escalated to unauthorized intent execution.
- **Single-token approval**: Users approve the StrategyExecutor once rather than approving LendingPool, StrategyVault, and SwapRouter individually.

### Negative

- **Action type limit**: Fixed at 8 types. Adding new action types (e.g., flash loan, delegate, stake) requires a contract upgrade. Dynamic action dispatch was deemed too risky for the current phase.
- **No atomic rollback**: The pipeline executes sequentially. If action 3 fails, actions 0-2 have already modified state. There is no automatic rollback mechanism. Users must manually unwind via separate transactions.
- **Checkpoint storage accumulation**: Every strategy execution creates a checkpoint entry. Stale or abandoned checkpoints remain in storage indefinitely. The current design provides `resetCheckpoint()` but no bulk cleanup.
- **No cross-action validation**: The pipeline does not verify intermediate state consistency. A user could supply after borrowing, creating a temporarily undercollateralized position. The downstream contract's individual checks (e.g., LTV on borrow) apply per action but not across actions.

### Risks

- **Gas estimation difficulty**: FHE operations have variable gas costs depending on the CoFHE network state. The 100K gas reserve is an initial heuristic that may need adjustment per action type.
- **User error in action ordering**: There is no validation that actions are sequenced correctly. The pipeline executes whatever actions the user provides in whatever order, trusting the caller to construct a valid sequence.
- **ExecutorContract centralization**: Ownable ownership on ExecutorContract gives a single address broad power (execute any intent, withdraw any token). This is acceptable for the buildathon phase but should graduate to a multisig or timelock for production.
