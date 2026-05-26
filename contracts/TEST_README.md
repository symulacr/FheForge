# FheForge — Test Documentation (MC-093)

## Overview

FheForge uses a dual testing strategy:
- **Foundry (Forge)**: Tests for non-FHE Solidity logic (math, access control, invariants)
- **Hardhat (with CoFHE plugin)**: Tests for FHE-encrypted operations (shield, borrow, repay, privacy)

## Test Count

| Test Suite | Count | Source |
|---|---|---|
| Foundry (non-FHE) | 13 | `test-foundry/` |
| Hardhat (FHE) | 4 | `test/` |

*Updated at build time. Run `forge test` and `npx hardhat test` for current counts.*

## Test Files

### Foundry (`contracts/test-foundry/`)

| File | Type | MC |
|---|---|---|
| `NonFheConstructor.t.sol` | Constructor validation for all contracts | — |
| `ExecutorContract.t.sol` | ExecutorContract integration with SwapRouter | — |
| `LendingPool.t.sol` | LendingPool non-FHE paths (flashloan, pause, owner) | MC-069 |
| `SwapRouter.t.sol` | SwapRouter full test suite | MC-070 |
| `PriceOracle.t.sol` | PriceOracle math, source management, fallback | MC-071 |
| `InvariantTests.t.sol` | Invariant/fuzz tests for protocol invariants | MC-073 |
| `TestHelper.sol` | Shared deployment helpers and constants | MC-077 |

### Hardhat (`contracts/test/`)

| File | Type | MC |
|---|---|---|
| `StrategyVault.test.ts` | StrategyVault open/close position with FHE | — |
| `FuzzEdgeCases.test.ts` | Fuzz edge cases, boundary values | MC-072 |
| `IntegrationFlow.test.ts` | End-to-end flow: deposit→borrow→swap→repay→withdraw | MC-074 |

## Coverage Target

- **Target**: 50% line coverage for Solidity contracts
- **Measure**: `forge coverage --report lcov`
- **Run**: `forge coverage`

## CI Integration

Tests run automatically via GitHub Actions in `.github/workflows/ci.yml`:
- `forge test -vvv` — Foundry tests
- `npx hardhat test` — Hardhat FHE tests
- `jest` — Backend unit tests
- `vitest` — Frontend unit tests

POSTFIX probes run on manual/scheduled trigger against Arbitrum Sepolia.

## Deferred Security Issues

### C5: SwapRouter Executor Trust
`SwapRouter.executeIntent` trusts the executor to report the correct `minAmountOut`. Encrypted `minAmountOut` cannot be enforced on-chain because FHE operations are not composable with external DEX settlement. The executor can settle the swap at any price and report any output amount.

**Mitigation**: `ExecutorContract` is an Ownable contract controlled by a multi-sig. In production, the executor would be a trusted off-chain keeper with reputational and economic bonds.

**Long-term fix**: Requires ZK-proof or batch auction mechanism. Documented in `DEFERRED_SECURITY.md`.

### Chain Reorganization Risk
FHE operations are async — a chain reorg could invalidate encrypted handles, cause handle reuse, or invalidate `allowTransient` ACL. This is a known limitation of the CoFHE testnet environment. Mainnet CoFHE is expected to include reorg-safe handle management.

## Running Tests

```bash
# Foundry tests (non-FHE)
cd contracts && forge test -vvv

# Hardhat tests (FHE + mocks)
cd contracts && HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true npx hardhat test

# POSTFIX probes (live network)
cd contracts && npx hardhat run scripts/test-postfix.ts --network arb-sepolia

# Backend tests
cd backend/apps && bun run test

# Frontend tests
cd ui && bun run test
```
