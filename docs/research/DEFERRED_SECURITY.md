# Deferred Security Findings

## C5: SwapRouter Executor Trust — Deferred

### Risk

`SwapRouter.executeIntent` trusts a fully privileged EOA (`executor`) that can front-run the encrypted `minAmountOut`. The executor calls `executeIntent` with any `outputAmount` — there is no on-chain verification that the swap output satisfies the user's encrypted minimum.

### Mechanism

- **File**: `contracts/contracts/SwapRouter.sol` lines 15–16, `executeIntent` function
- The contract stores `SwapIntent` with encrypted `amountIn` and `minAmountOut` as `euint128`
- The `executor` address (set by owner) decrypts via FHE permit and performs the swap off-chain
- On settlement, the contract only checks `tokenIn` transfer — it **cannot** verify the `outputAmount` against the encrypted `minAmountOut` because FHE comparison results are not yet usable as on-chain guards in the CoFHE runtime
- This means a malicious or compromised executor can submit any output amount, effectively stealing slippage from users

### Architectural Fix Required

A verifiable batch auction or ZK proof of fair execution is needed. Options include:

1. **Batch auction with commit-reveal**: Collect intents in a batch, execute at a uniform price, prove the price on-chain
2. **ZK proof of fair output**: Executor submits a ZK proof that the output amount was computed fairly from a DEX quote at execution time
3. **TEE-based executor**: Run the executor inside a trusted execution environment that attests to correct swap execution

None of these are microchanges — each requires protocol-level redesign of the swap intent lifecycle.

### Why Deferred

- Requires a fundamental change to the swap intent architecture (not a patch)
- CoFHE runtime does not yet support encrypted comparison as a revert condition
- A proper fix depends on upstream FHE opcode support or a separate proof system
- The current executor is owner-controlled and the risk is documented and accepted for testnet

### Reference

- `SwapRouter.sol` lines 15–16: `contract SwapRouter is Pausable { ... address public executor; ... }`
- `SwapRouter.sol` `executeIntent` function: settles swap without on-chain verification of output amount vs encrypted minimum