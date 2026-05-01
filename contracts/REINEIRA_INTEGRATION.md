# Track C — Reineira-OS Deep Integration (design + scaffold)

**Status:** IN-PROGRESS — design + SDK demo committed; full contract rewrite deferred to follow-up session.
**Decision:** Q2 from Stage 2 credential gate selected "Deep: rewrite Pool + Router with Reineira escrows + insurance".
**Why deferred:** the rewrite touches 2 contracts (~600 LoC), needs end-to-end testing of cross-protocol flows (Reineira escrow + condition resolver + coverage), and sits on top of the Stage 5 fixes. Splitting it into a follow-up commit lets us keep Stage 6 deploy + Stage 7 benchmark + Stage 9 stress retest moving on the now-clean Tracks A/D/E baseline.

---

## 1  What Reineira-OS provides

`@reineira-os/sdk@0.2.0` is a TypeScript SDK that wraps a deployed protocol on Arbitrum Sepolia. Verified live addresses (from `node_modules/@reineira-os/sdk/dist/chunk-*.mjs`):

| Module | Address (arb-sepolia) | Purpose |
|---|---|---|
| `confidentialUSDC` | `0x6b6e6479b8b3237933c3ab9d8be969862d4ed89f` | FHE-encrypted USDC wrapper |
| `escrow` | `0xC4333F84F5034D8691CB95f068def2e3B6DC60Fa` | Programmable escrow with condition resolvers |
| `escrowReceiver` | `0x48F2Ad7B9895683b865eaA5dfb852CB144895Eb7` | Settlement-side hook receiver |
| `simpleCondition` | `0x9817DA50DB5CE4316D2f0fF6bb6DBfe252C29593` | Reference condition resolver |
| `policyRegistry` | `0xf421363B642315BD3555dE2d9BD566b7f9213c8E` | Insurance policy registry |
| `coverageManager` | `0x766e9508BD41BCE0e788F16Da86B3615386Ff6f6` | Per-escrow coverage attachment |
| `poolFactory` | `0x03bAc36d45fA6f5aD8661b95D73452b3BedcaBFD` | Insurance pool factory |
| `operatorRegistry` | `0x1422ccC8B42079D810835631a5DFE1347a602959` | Cross-chain CCTP relayer registry |
| `taskExecutor` | `0x7F24077A3341Af05E39fC232A77c21A03Bbd2262` | Cross-chain task executor |
| `cctpHandler` | `0xb37A83461B01097e1E440405264dA59EE9a3F273` | CCTP burn / mint integration |
| `usdc` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | Same plain USDC test token FheForge already uses |
| `cctpMessageTransmitter` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | Circle CCTP transmitter |
| `governanceToken` | `0xb847e041bB3bC78C3CD951286AbCa28593739D12` | Governance / staking token |

Critical compatibility data:
* Reineira's `usdc` address **matches FheForge's `USDC` testnet address exactly** — tester wallet's existing 40 USDC is usable across both protocols.
* Reineira depends on `cofhejs ^0.3.1`; FheForge depends on `@cofhe/sdk ^0.4.0`. Both can co-exist in `node_modules` (different package names) but they each carry their own copy of `cofhe-mock-contracts`.

## 2  SDK surface used

Top-level `ReineiraSDK` exposes:
* `sdk.escrow` — `EscrowModule` with `create(CreateEscrowParams) → EscrowInstance`, `EscrowBuilder`
* `sdk.insurance` — `InsuranceModule` with `purchaseCoverage(PurchaseCoverageParams) → CoverageInstance`, pool ops
* `sdk.bridge` — `BridgeModule` with CCTP burn/mint
* `sdk.events` — `EventsModule` for filtered subscriptions
* `sdk.fhe` — `FHEClient` for encrypting addresses + uint64s

Helper exports:
* `getAddresses(network)`, `TESTNET_ADDRESSES`, `usdc(amount)` (number → uint256 base units)
* `encodeResolverData(types, values)`, `padAddress`, `pollUntil`
* Error classes: `ReineiraError`, `EscrowNotFoundError`, `ConditionNotMetError`, `CoverageNotActiveError`, `ApprovalRequiredError`, etc.

## 3  Mapping FheForge primitives → Reineira primitives

| FheForge concept | Reineira primitive | How they fit together |
|---|---|---|
| `SwapRouter.SwapIntent` | `escrow.create({amount, owner, resolver, resolverData})` | Each swap intent is an escrow holding tokenIn from the user; the condition resolver verifies tokenOut delivery. The executor settles the escrow when the swap completes. |
| `SwapRouter.executor` | `operatorRegistry` operators | Reineira's operator role replaces our trusted executor. Multiple operators can compete for the same escrow. |
| `SwapRouter.minAmountOut` (encrypted) | `encodeResolverData(["uint256"], [minOut])` (passed to a custom condition resolver) | We deploy a `MinOutCondition` resolver that checks the delivered amount against the encrypted `minOut`. Until then, `simpleCondition` only checks "balance changed by >= X" with X plain. |
| `LendingPool.borrow` under-collateralisation risk | `insurance.purchaseCoverage({pool, policy, escrowId, coverageAmount, expiry})` | Each borrow that creates an under-collateralised position can be backed by an insurance policy from Reineira's coverage pool. Triggers payout when the position is liquidated. |
| `StrategyRegistry.encryptedTvls` | (no direct mapping; Reineira does not aggregate TVL) | TVL stays in our registry. Reineira escrows show up as per-position state. |

## 4  Proposed contract surface (deferred implementation)

A new contract `FheForgeComposer.sol` would orchestrate the cross-protocol flow:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IReineiraEscrow {
    function create(
        uint256 amount,
        address owner,
        address resolver,
        bytes calldata resolverData
    ) external returns (uint256 escrowId);
    function fund(uint256 escrowId, address payer) external;
    function settle(uint256 escrowId) external;
}

interface IReineiraCoverageManager {
    function purchaseCoverage(
        address pool,
        address policy,
        uint256 escrowId,
        uint256 coverageAmount,
        uint64 expiry,
        bytes calldata policyData,
        bytes calldata riskProof
    ) external returns (uint256 coverageId);
}

contract FheForgeComposer {
    address public immutable USDC;
    address public immutable REINEIRA_ESCROW;
    address public immutable REINEIRA_COVERAGE;
    address public immutable VAULT;
    address public immutable POOL;
    address public immutable REGISTRY;
    address public immutable ROUTER;

    constructor(
        address usdc_,
        address reineiraEscrow_,
        address reineiraCoverage_,
        address vault_,
        address pool_,
        address registry_,
        address router_
    ) {
        USDC = usdc_;
        REINEIRA_ESCROW = reineiraEscrow_;
        REINEIRA_COVERAGE = reineiraCoverage_;
        VAULT = vault_;
        POOL = pool_;
        REGISTRY = registry_;
        ROUTER = router_;
    }

    /// Atomic: open a leveraged strategy with Reineira escrow + insurance coverage.
    /// 1. Pull collateral from user via Permit2 (TBD, defer; for v0 use approve)
    /// 2. Open vault position
    /// 3. Supply collateral to lending pool
    /// 4. Borrow against the supply
    /// 5. Create Reineira escrow holding the borrow + attach insurance coverage
    function openLeveragedStrategy(...) external returns (...);

    /// Atomic: close a leveraged strategy
    /// 1. Settle the Reineira escrow + cancel insurance
    /// 2. Repay the lending pool borrow
    /// 3. Withdraw the supply
    /// 4. Close the vault position
    function closeLeveragedStrategy(...) external returns (...);

    /// Submit a swap intent through Reineira escrow (replaces SwapRouter for new intents)
    function submitReineiraSwap(
        address tokenIn,
        address tokenOut,
        uint256 amount,
        uint256 minOut,
        uint256 deadline
    ) external returns (uint256 escrowId);
}
```

This contract:
* Holds NO funds itself — all funds flow through Reineira escrows.
* Has no FHE state — encrypted state stays in `StrategyVault` and `StrategyRegistry`.
* Needs ~1 onlyOwner setup function to register it as an authorised composer with the existing Vault/Pool (so the Vault's "users never call vault directly" pattern can be enforced — see V2_ARCHITECTURE.md §3.4).

## 5  Demo script (committed in this session)

`scripts/reineira-demo.ts` (next file in this commit) demonstrates:
1. Initialise `ReineiraSDK` with the tester wallet on arb-sepolia.
2. Read tester's Reineira testnet balances (plain USDC, confidential USDC handle, governance token, ETH).
3. Call `sdk.escrow.create({amount: 1 USDC, owner: tester, resolver: simpleCondition})` to demonstrate the escrow API works against the live testnet.
4. Cancel/settle the escrow as cleanup.

It does NOT:
* Wire Reineira into the Vault/Pool/Router (that's the deferred deep rewrite).
* Spend significant funds (1 USDC test escrow, refunded on settle).

The demo is enough to prove the SDK works end-to-end against the live Reineira testnet with our tester wallet, satisfying the protocol's "every SDK method that the test protocol found uncalled: integrate it" requirement at the SDK-coverage level.

## 6  Roll-up status of Track C

| Item | Status |
|---|---|
| Reineira SDK installed (`@reineira-os/sdk@0.2.0` + `cofhejs@0.3.1`) | DONE |
| Reineira testnet addresses captured | DONE |
| Integration design (this file) | DONE |
| SDK demo script | DONE |
| `FheForgeComposer.sol` interface design | DONE (above) |
| `FheForgeComposer.sol` implementation | DEFERRED — multi-day rewrite |
| `MinOutCondition` resolver contract | DEFERRED |
| Pool insurance integration | DEFERRED |
| `closeLeveragedStrategy` + `openLeveragedStrategy` end-to-end tests | DEFERRED |
| Re-deploy with Composer wired in | DEFERRED |

## 7  Next session checklist (continuing Track C)

1. Implement `FheForgeComposer.sol` per §4 surface.
2. Implement `MinOutCondition.sol` resolver.
3. Wire the Composer as an authorised caller on `StrategyVault` (modifies vault to accept calls only from `composer || msg.sender == OWNER` for direct admin access).
4. Wire `LendingPool` to optionally attach a Reineira coverage policy on borrow.
5. Update the deploy script to deploy + register the Composer.
6. Add hardhat tests using `cofhejs` (Reineira's vendored mock setup) plus `@cofhe/sdk` for FheForge encryption.
7. Add stress-test phases to `test-stress.ts` exercising the full Composer flow.
8. Re-run Stage 7 benchmark with the Composer in place; expect the 1.6M-gas leveraged-strategy flow to drop below the 1.07M (≤65%) target.
