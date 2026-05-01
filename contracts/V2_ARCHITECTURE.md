# FheForge v2 — Refactor Architecture (Vault + Composer / Mesh, Batched-Sync Pool, Permissionless Registry, FHE-Composable Core)

**Status:** design specification, no `.sol` edits yet.
**Companion file:** `STRESS_FINDINGS.md` — every gap in this doc cross-references a finding ID from the 10-run stress test.
**Methodology:** each section names the v1 gap, the chosen v2 primitive, the **why**, the **how** (concrete Solidity surface), the **when** (deployment phase), and the trade-off. Inspired by the user brief (Vault+Composer mesh, batched-sync pool, permissionless cross-layer registry, FHE-composable liquidity at the core) and validated against production patterns from Yearn V3, Morpho, Uniswap V4, Balancer V3, CoW Protocol, Hyperlane, Permit2, and Fhenix CoFHE.

---

## 1  North-star architecture diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          USER (EOA / Smart wallet)                        │
│                  signs an Intent (Permit2 + EIP-712)                       │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  COMPOSER  (entry-point; users NEVER touch vault/pool/router directly)    │
│  ── multicall + Permit2 + ERC-1363 transferAndCall                          │
│  ── unlock/callback (Uniswap V4 style)                                      │
│  ── composes:                                                               │
│       openLeveragedStrategy(name, hash, encInputs[], strategyId,            │
│                             supplyAmount, borrowParams, swapIntent)         │
└──────────────────────────────────────────────────────────────────────────┘
       ▼              ▼               ▼                ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  REGISTRY   │ │   VAULT     │ │    POOL     │ │   ROUTER    │ │   ORACLE    │
│ permission- │ │ ERC-4626    │ │ batched-    │ │ intent      │ │ Chainlink + │
│ less; commit│ │ shares; per-│ │ sync        │ │ Merkle root │ │ Pyth + TWAP │
│ -reveal id; │ │ strategy    │ │ flash       │ │ + multi-DVN │ │ + heartbeat │
│ Hyperlane   │ │ tokens; FHE │ │ accounting  │ │ executors   │ │             │
│ mailbox to  │ │ ACL delegate│ │ + reserve   │ │ + ZK min-out│ │             │
│ remote chains│ │ registry   │ │   gate      │ │   proof     │ │             │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
       │              │               │                │               │
       └──────────────┴───────────────┴────────────────┴───────────────┘
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              FHE / Privara / Reineira CORE  (cofhe-contracts)              │
│   ── ZK-proof of `encrypted == plain` (single input per call)              │
│   ── delegate ACL registry (allowAddress)                                  │
│   ── batched FHE.add (multi-input precompile call)                         │
│   ── encrypted price oracle adapters                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

The composer is the only EOA-callable surface. Every other layer is permissioned to `composer || registry || keeper`. This is the inverse of v1 where users approve and call the vault directly.

---

## 2  Design principles (in order of priority)

1. **Users never touch storage of multiple contracts.** One signature → one tx → one composer entrypoint → all internal hops are atomic. Closes 4-tx front-running window (gap O.3).
2. **Plain ↔ encrypted is one input, never two.** Either pass an encrypted-only input and let the contract decrypt+compare, or pass plain only and let the contract re-encrypt. Closes the P.1–P.3 skew gaps.
3. **Reserve invariant is the lend-pool's first-class check.** `reserve(token) ≥ Σ plainSupply(user, token) − Σ plainBorrow(user, token)`. Closes A.5b2/A.5c/F.6/Q.5.
4. **Batched-sync at the metal.** Aggregate N user ops into one `settle()` that hits SLOAD/SSTORE once per touched slot. Inspired by Uniswap V4 PoolManager flash accounting + Balancer V3 internal balances. Closes W.5/F.1/F.7/F.8.
5. **Permissionless cross-layer messaging.** Registry events are the source of truth; remote chains subscribe via Hyperlane mailbox. No central relay. Closes Z.5/F.9.
6. **Pause + upgrade as first-class concerns.** Every contract behind ERC-1967 proxy + OZ Pausable + Timelock-controlled admin role. Closes X.1–X.5/X.7.
7. **Public commit-reveal for ids.** Both strategy registration and intent submission use a 2-tx commit-reveal (or sender-salted hash). Closes Q.4/Q.6.
8. **FHE remains the privacy layer, not the integrity layer.** Plaintext-skew is a known FHE limitation; v2 mitigates by requiring single-input + ZK proof of equality, NOT by ad-hoc encrypted-vs-plain checks.

---

## 3  Layer-by-layer design

### 3.1 Registry — permissionless, lifecycle-aware, cross-chain

**v1 gaps closed:** B.5, B.6 (LIMIT), C.3, C.4, F.7, M.3, Q.3, Q.4, Q.6, S.2, X.4, Z.3, Z.4, Z.5

**Why:** v1's registry is a write-once-read-many flat list with a one-shot vault binding. v2 needs a lifecycle (active/paused/archived), a rotation path, identity collision resistance, and cross-chain visibility.

**How (Solidity surface):**
```solidity
interface IFheForgeRegistry {
    enum StrategyStatus { Active, Paused, Archived }

    struct Strategy {
        bytes32 namespacedId;        // keccak256(creator, name); collision-free
        bytes32 workflowHash;        // never zero
        address creator;
        address[] tokenAllowlist;    // strategies are token-bound (closes H.5)
        StrategyStatus status;
        uint64 createdAt;
        uint64 updatedAt;
        bytes32 attesterRoot;        // optional KYC merkle root (closes Z.4)
    }

    // ── 1. Two-step commit-reveal for spam-resistant registration (closes Q.6) ──
    function commitStrategy(bytes32 commitHash) external;
    function revealStrategy(
        string calldata name,
        bytes32 workflowHash,
        address[] calldata tokenAllowlist,
        bytes32 attesterRoot,
        uint256 nonce
    ) external returns (bytes32 namespacedId);

    // ── 2. Lifecycle (closes C.3, S.2) ──
    function setStatus(bytes32 namespacedId, StrategyStatus s) external; // creator-only
    function rotateCreator(bytes32 namespacedId, address newCreator) external; // creator-only

    // ── 3. Vault rotation via timelock (closes C.4) ──
    function proposeVault(address v) external;     // OWNER → 7-day timelock
    function acceptVault(address v) external;      // anyone after delay

    // ── 4. Encrypted TVL with multi-token denomination (closes Y.4) ──
    function incrementTvlNormalised(bytes32 id, address token, euint128 amount) external;
    function decrementTvlNormalised(bytes32 id, address token, euint128 amount) external;
    function getTvlUsd(bytes32 id) external view returns (euint128); // oracle-normalised

    // ── 5. Cross-chain mailbox hook (closes Z.5) ──
    function dispatchToRemote(uint32 destDomain, bytes32 strategyId) external;
    event StrategyDispatched(uint32 indexed dest, bytes32 indexed id, bytes32 messageId);

    // ── 6. Pausability (closes X.4) ──
    function pause() external;          // guardian role
    function unpause() external;
}
```

**When:** Phase 1 of v2 deployment. Registry must ship before the new Vault because the Vault binds to `Registry.namespacedId` at construction.

**Trade-off:** namespaced IDs (`keccak256(creator, name)`) make on-chain enumeration require a subgraph; v1's monotonic uint256 was simpler for UIs but front-runnable. We accept the subgraph dependency in exchange for collision resistance + front-running immunity.

**Cross-chain:** Hyperlane Mailbox (https://docs.hyperlane.xyz/docs/protocol/protocol-overview) is the chosen primitive. It is permissionless (anyone can deploy a mailbox + ISM), modular (each strategy can pick its own ISM), and battle-tested (Mailbox + ISMs since 2023). LayerZero V2 was considered but its DVN model adds an off-chain dependency; Hyperlane lets us run our own validators if needed.

---

### 3.2 LendingPool — reserve-gated, batched-sync, oracle-aware, payable

**v1 gaps closed:** A.5b2, A.5c, F.3, F.5, F.6, H.1–H.3, P.3, Q.5, W.5, X.2, Y.1–Y.5, AA.3

**Why:** v1's pool fails the reserve invariant the moment any user borrows. It also has no interest, no liquidation, no native ETH, no batching, no oracle, no decimal normalisation. Each is a v2 must-have.

**How (Solidity surface):**
```solidity
interface IFheForgePool {
    struct Balance {
        uint128 plain;       // gates transfers
        euint128 encrypted;  // FHE-private state
    }

    struct InterestIndex {
        uint128 supplyIndex;    // ray = 1e27 scaled
        uint128 borrowIndex;
        uint64 lastUpdate;
    }

    // ── 1. Native + ERC-20 unified (closes F.3, H.1–H.3) ──
    function supply(address token, uint256 amount, EncryptedAmount calldata enc)
        external payable;        // payable so caller can send ETH for token=NATIVE
    function withdraw(address token, uint256 amount, EncryptedAmount calldata enc)
        external;

    // ── 2. Reserve-gated (closes A.5b2, A.5c, F.6, Q.5) ──
    //   `_assertHealthy(user)` is called at start AND end of withdraw/borrow.
    //   healthFactor = sumNorm(supply * liqLtv) / sumNorm(borrow);
    //   reserve(token) >= sum(plainSupply) - sum(plainBorrow) is asserted globally.
    function checkLtvAndBorrow(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        EncryptedAmount calldata enc,
        // NOTE: ltvNum/ltvDen NOT user-supplied anymore; pool reads risk params from oracle (closes Y.3)
        uint256 oracleNonce
    ) external returns (uint256 actualBorrowed);

    // ── 3. Interest accrual + liquidation (closes F.5) ──
    function accrueInterest(address token) external;     // anyone can call (keeper)
    function liquidate(
        address user,
        address collateralToken,
        address debtToken,
        uint256 debtToCover,
        bool receiveAsShare
    ) external;

    // ── 4. Batched-sync flash accounting (closes F.1, W.5, F.7) ──
    //   Same pattern as Uniswap V4 PoolManager: caller wraps a sequence of
    //   ops in `unlock(callback)`; all transfers net out at `settle`.
    //   See https://docs.uniswap.org/contracts/v4/concepts/PoolManager
    function unlock(bytes calldata data) external returns (bytes memory);
    function settle(address token) external payable returns (uint256 paid);
    function take(address token, address to, uint256 amount) external;

    // ── 5. Oracle + decimal normalisation (closes Y.1, Y.2) ──
    function setOracle(address token, address oracle, uint256 staleThreshold) external; // governance
    function priceUsd(address token) public view returns (uint256 priceWad);

    // ── 6. Pausability + emergency withdraw (closes X.2, X.6) ──
    function pause() external;
    function emergencyWithdraw(address token) external; // returns plain balance, ignores FHE
}

struct EncryptedAmount {
    bytes32 ctHash;       // existing CoFHE handle
    bytes proofOfEquality; // optional ZK proof that ctHash == amount (closes P.3)
}
```

**When:** Phase 2; depends on Registry.namespacedId. Pool's batched-sync requires Cancun's transient storage (`TSTORE`/`TLOAD`), which Arbitrum already supports.

**Trade-off:** The reserve gate makes `withdraw` and `borrow` 5–10 % slower (one extra SLOAD per affected token) but eliminates the systemic drain risk. The flash-accounting `unlock`/`settle` model adds re-entrancy surface (mitigated by the same pattern Uniswap V4 audited at length).

**Specific behaviour for the v1 gaps:**
* **A.5c/F.6:** `withdraw(token, amount, enc)` ends with `_assertHealthy(msg.sender)` AND `require(reserve(token) >= sumPlainSupply(token) - sumPlainBorrow(token))`. A user cannot drain anyone else's reserve.
* **F.5:** every state-mutating function calls `accrueInterest(token)` first; index-based interest grows borrow balances without per-user iteration. Liquidator is permissionless (`liquidate` callable by anyone with `healthFactor < 1`); receives a configurable bonus.
* **F.3:** if `token == NATIVE`, `_settle` calls `WETH.deposit{value: msg.value}()` internally; user never sees WETH.
* **Y.4** (in tandem with Registry): TVL is reported in USD-normalised `euint128` via the oracle adapter; per-token raw is kept for accounting.

---

### 3.3 StrategyVault — ERC-4626 share token, partial-aware, FHE-delegate

**v1 gaps closed:** A.3, A.4, F.2, F.4, P.1, P.2, S.3, U.2, W.2, X.1, AA.2, AA.6

**Why:** v1's vault stores per-user positions but the position is non-fungible, non-tokenized, and cannot be partially closed. v2 mints an ERC-4626 share token per strategy, supports partial unwinds, and delegates FHE ACL to whoever the user authorises (e.g. a strategy manager / rebalancer).

**How (Solidity surface):**
```solidity
interface IFheForgeVault is IERC4626 {
    struct PositionPacked {
        // packed into 1-2 storage slots (closes AA.2)
        address collateralToken;
        uint128 plainCollateral;
        euint128 encryptedCollateral;
        euint128 encryptedDebt;
        euint16 apyTarget;
        euint8 loopCount;
        uint64 strategyId;       // namespacedId-derived (32→64 bit hash)
        uint64 createdAt;
        uint64 maturityAt;       // optional, set by strategy creator (closes S.3)
    }

    // ── 1. ERC-4626 + per-strategy share token (closes W.2) ──
    //   `vault.deposit(assets, receiver, strategyId, encryptedAssets, proof)`
    //   mints `shares` of strategyId-specific ERC-4626; transferable.
    function deposit(
        uint256 assets,
        address receiver,
        bytes32 strategyId,
        EncryptedAmount calldata encAssets
    ) external returns (uint256 shares);

    // ── 2. Partial close (closes A.3, F.4) ──
    function redeem(
        uint256 shares,
        address receiver,
        address owner,
        EncryptedAmount calldata encShares
    ) external returns (uint256 assets);

    // ── 3. Single-input encrypted-only API (closes P.1, P.2) ──
    //   No more "plain + encrypted" pair. Caller submits encrypted input
    //   accompanied by an optional ZK proof; if no proof, encryption-time
    //   commitment is verified server-side via cofhe-mocks for testnet.
    function depositEncrypted(
        EncryptedAmount calldata encAssets,
        bytes32 strategyId,
        address receiver
    ) external returns (uint256 shares);

    // ── 4. Delegate ACL (closes U.2) ──
    function setDecryptDelegate(address delegate, bool allowed) external;
    function getCollateralFor(address owner) external returns (euint128);

    // ── 5. Lifecycle (closes S.3, AA.6) ──
    //   Maturity & cooldown enforced; partial close decrements registry by
    //   proportional encrypted amount (computed off-chain via decryption oracle
    //   then asserted on-chain via FHE.eq).
    function setMaturity(bytes32 strategyId, uint64 maturityAt) external;

    // ── 6. Composer integration (closes F.2) ──
    //   Vault REJECTS direct calls from EOAs; only the COMPOSER may move tokens.
    modifier onlyComposer { require(msg.sender == COMPOSER, "EOAs use Composer"); _; }

    // ── 7. Pausability (closes X.1) ──
    function pause() external;
}
```

**When:** Phase 2; depends on Pool (for collateral routing) and Registry (for strategyId).

**Trade-off:** ERC-4626 shares are transferable, which means encrypted balances become a per-share concept rather than per-user. We reconcile by storing `encryptedCollateral` in the position (private to the share owner) and the share-token balance is plain. Partial-close uses the standard ERC-4626 `redeem(shares)` pattern; the encrypted decrement is computed via a decryption oracle and verified on-chain.

**FHE ACL design:** each Vault call routes its FHE handle through `FHE.allowAddress(delegate)` if the user has `setDecryptDelegate(delegate, true)`. This solves U.2 and lets a manager / liquidator / KYC oracle read encrypted collateral without exposing private keys. The delegate registry itself is pause-able and timelock-rotatable.

---

### 3.4 Composer / Mesh — single user-facing entry point

**v1 gaps closed:** F.1, F.2, F.7, F.9, M.3, O.2, O.3, W.1, W.6

**Why:** v1 forces users to sequence approve → openPosition → approve → supply → borrow. v2 collapses these to a single Composer call signed once.

**How (Solidity surface):**
```solidity
interface IFheForgeComposer {
    /// @notice Single-tx atomic: register strategy + open vault position +
    ///         supply collateral + borrow + (optional) submit swap intent.
    /// @dev Permit2-signed token approval; user signs ONE EIP-712 message;
    ///      Composer pulls funds, calls each layer in turn, and reverts the
    ///      whole batch on any layer's revert.
    function openLeveragedStrategy(
        Strategy memory strategy,
        VaultDeposit memory vd,
        PoolSupply memory ps,
        PoolBorrow memory pb,
        SwapIntent memory si,
        IPermit2.PermitTransferFrom memory permit,
        bytes memory signature
    ) external returns (
        bytes32 strategyId,
        uint256 shares,
        uint256 borrowed,
        bytes32 intentId
    );

    /// @notice Atomic compound: addCollateral + repay + borrow with new params.
    function rebalance(
        bytes32 strategyId,
        VaultAddCollateral memory add,
        PoolRepay memory repay,
        PoolBorrow memory pb
    ) external;

    /// @notice Batched intent submission (closes W.6, CoW Protocol style)
    function submitIntentBatch(
        bytes32 merkleRoot,
        SwapIntent[] memory intents
    ) external;

    /// @notice Multi-hop unlock callback (Uniswap V4 style)
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}
```

**When:** Phase 3, last of the user-facing stack. Composer assumes Pool/Vault/Registry/Router are deployed and stable.

**Trade-off:** the Composer is an admin-trusted contract (it gets `onlyComposer` privileges on every other layer). This concentrates risk; we mitigate by:
1. Composer is deployed behind UUPS proxy with timelock-only admin.
2. Composer source is < 500 LoC (target) — small surface to audit.
3. Composer holds NO funds; every state change is delegated to the underlying layer.

**Permit2 integration** (https://docs.uniswap.org/contracts/permit2/overview): users approve Permit2 once for `MAX uint256` per token; subsequent Composer calls use `permitTransferFrom(permit, signature, …)` with a per-call EIP-712 signature. Closes the "user must approve every layer" pain (W.1).

**Gas target** (from O.2): the v1 leveraged-strategy flow costs **1 646 963 gas** across 4 txs; the v2 Composer must execute the equivalent in **≤ 1 070 525 gas (≤65 %)** in 1 tx. The savings come from:
* Eliminated duplicate `approve` (Permit2)
* Single FHE handle setup amortised across 3+ ops
* Single `unlock`/`settle` batched-sync envelope on the pool
* Cached ACL grants (closes AA.5)

**Mesh terminology:** the user's brief calls this a "mesh" because multiple Composers can co-exist (one per workflow archetype: leverage, vault-only, swap-only, governance). They share the underlying registry/vault/pool/router but expose different intent shapes. Morpho Vaults adopt the same pattern (a "metavault" routes user deposits into individual markets); see https://docs.morpho.org/learn/concepts/vaults.

---

### 3.5 SwapRouter — batched intents, ZK min-out, fee, multi-executor

**v1 gaps closed:** B.7a, B.8, C.5, F.8, J.6, J.7, W.6, X.3

**Why:** v1's router takes single intents from a single immutable executor and trusts the executor's `outputAmount` blindly. v2 needs batched submission, executor rotation, on-chain min-out enforcement, and a fee/payment mechanism.

**How:**
```solidity
interface IFheForgeRouter {
    struct SwapIntentBatch {
        bytes32 merkleRoot;
        uint64  validUntil;
        uint64  intentCount;
    }

    // ── 1. Batched submission (closes F.8, W.6) ──
    function submitBatch(SwapIntentBatch calldata b) external returns (bytes32 batchId);

    // ── 2. ZK-proof of `output >= encMin` (closes J.6) ──
    function executeWithProof(
        bytes32 intentId,
        uint256 outputAmount,
        bytes calldata zkProof,
        bytes32[] calldata merkleProof
    ) external;

    // ── 3. Multi-executor with rotation (closes C.5, X.3) ──
    function addExecutor(address e) external;       // governance
    function removeExecutor(address e) external;
    function pause() external;

    // ── 4. Fee collection (closes J.7) ──
    function setFeeBps(uint16 feeBps) external;
    function withdrawFees(address token, address to) external;

    // ── 5. Deadline bounds (closes B.7a, B.8) ──
    //   minDeadlineOffset = 30 seconds, maxDeadlineOffset = 7 days; both enforced.
    uint256 constant MIN_DEADLINE_OFFSET = 30;
    uint256 constant MAX_DEADLINE_OFFSET = 7 days;
}
```

**When:** Phase 3, alongside Composer.

**Trade-off:** ZK proof verification (e.g. Plonky2 / Halo2) is expensive (~300–500 K gas). For v2.0 we can ship without the ZK proof and use a trusted-decryption oracle + EIP-712 attestation; v2.1 adds the proof. CoW Protocol's batch-auction model (https://docs.cow.fi/cow-protocol/concepts/introduction/batch-auctions) is the inspiration — solvers compete for batches, Uniform Directed Clearing Prices (UDP) eliminate per-order MEV.

---

### 3.6 FHE / Privara / Reineira core — composable confidential primitives

**v1 gaps closed:** M.3, P.1, P.2, P.3, U.2, AA.4, AA.5

**Why:** the user's brief identifies "Fhenix and Privara and Reineira at core" as the foundation for "fully composable liquidity". v1 uses Fhenix CoFHE primitives (`FHE.asEuint128`, `FHE.add`, `FHE.allowSender`, `FHE.allowTransient`) but does not expose them as a composable library. v2 must provide:

1. **Single-input + ZK-equality.** Replace every (plain, encrypted) pair with a single `EncryptedAmount{ctHash, proofOfEquality}`. Closes P.1–P.3.
2. **Delegate ACL registry.** A small contract that lets a user grant `allowAddress(delegate)` for any of their handles, revocable. Closes U.2.
3. **Batched FHE.add precompile.** Fhenix CoFHE supports multi-input precompile calls (e.g. add 5 encrypted values in one tx) — v2 must use these instead of N individual `FHE.add` calls. Closes AA.4.
4. **On-chain permit log.** Emit `PermitGranted(bytes32 permitHash, address issuer)` on every `createSelf`. Closes M.3.

**Concrete library surface:**
```solidity
library FheCore {
    struct EncryptedAmount {
        bytes32 ctHash;
        bytes proofOfEquality;  // optional ZK proof: encrypted == plain
        uint256 plain;          // included only when proof is supplied
    }

    function settle(EncryptedAmount calldata e) internal returns (euint128, uint256);
    function batchAdd(euint128[] calldata handles) internal returns (euint128);
    function delegateRead(euint128 h, address delegate) internal;
}

interface IFhePermitRegistry {
    event PermitGranted(bytes32 indexed permitHash, address indexed issuer, uint64 expiry);
    function recordPermit(bytes32 permitHash, uint64 expiry) external;
    function listPermits(address issuer) external view returns (bytes32[] memory);
}
```

**Privara / Reineira semantics:** the user clarified these are **design philosophy** keywords, not surviving code (the parallel implementations were deleted in commit `1ea9b181d`). We carry them forward as:

* **Privara** = the *private representation* layer — every public state mutation has a private mirror that aggregates without revealing per-user breakdown. Manifests as: `Pool.supplyBalances` (private mirror of `plainSupplyBalances`) and `Registry.encryptedTvls` (private aggregate of all positions in a strategy). v2 keeps this pattern but adds the delegate ACL and the batched FHE.add.
* **Reineira** = the *re-entrant network of intents* layer — every layer accepts an intent shape (registry intent, vault intent, pool intent, swap intent) and the Composer routes them through the mesh. Manifests as: the Composer's `unlockCallback` pattern that lets a single intent hop across all four layers atomically. Inspired by Uniswap V4's hook system.

**Reference:** Fhenix CoFHE testnet (https://docs.fhenix.zone/) and the cofhe-contracts library (`@fhenixprotocol/cofhe-contracts`). Inco Network (https://docs.inco.org) is the closest production analogue but uses a different precompile API; we stay on Fhenix for the existing arb-sepolia deployment.

---

### 3.7 Oracle adapter — Chainlink + Pyth + TWAP fallback

**v1 gaps closed:** Y.1, Y.2, Y.3, Y.4, Y.5

**Why:** v1's pool LTV is a raw-units comparison. Without prices, cross-asset positions are meaningless and aggregated TVL is incoherent.

**How:**
```solidity
interface IPriceOracle {
    function getPriceUsd(address token) external view returns (uint256 priceWad, uint64 updatedAt);
    function setSource(address token, address source, OracleSource sourceType) external;
    function setStaleThreshold(uint64 secs) external;

    enum OracleSource { Chainlink, Pyth, UniswapV3Twap }
}
```

Per-token configuration: stablecoins use Chainlink; long-tail use Uniswap V3 TWAP; everything else falls through to Pyth. Heartbeat + staleness asserted on every read. Pool & Registry both consume this adapter so TVL and LTV use the same prices.

**When:** Phase 1 (alongside Registry). Pool depends on it.

---

### 3.8 Governance + Tokenomics + Cross-chain mesh

**v1 gaps closed:** Z.1, Z.2, Z.3, Z.5

**Why:** v1's OWNER is the immutable deployer. v2 must support DAO-controlled parameters, an incentive token (even if minted later), and cross-chain reach.

**How:**
* **Governor + Timelock:** OZ Governor + TimelockController with 48-hour delay; voting via FORGE (TBD) token.
* **FORGE token (placeholder):** ERC-20 with `delegate()` for vote weight; emission TBD per Phase-4 plan.
* **Hyperlane mesh:** Registry exports `dispatchToRemote(destDomain, strategyId)`; remote chain's Registry verifies with Mailbox + ISM.
* **Snapshot integration:** off-chain signaling at https://snapshot.org/#/fheforge.eth (placeholder).

**When:** Phase 4 (after the protocol is stable on Arbitrum Sepolia).

---

### 3.9 Safety & upgradability

**v1 gaps closed:** X.1–X.6, X.7, X.8

| Concern | Solution |
|---|---|
| pause() | Every contract inherits `OZ Pausable`; a `GUARDIAN_ROLE` (multisig) can pause without governance |
| upgrade() | ERC-1967 (UUPS) proxies for all four contracts; only Timelock can call `upgradeTo` |
| timelock | All admin functions go through `TimelockController` (48h delay) |
| emergency withdraw | `Pool.emergencyWithdraw(token)` returns plain balance ignoring FHE state — tested in CI |
| view-only encrypted read | Each `getXxx()` becomes `peekXxx() returns (bytes32 ctHash) view` (no ACL mutation) + a one-time `setupReadDelegate(this)` setup call |
| reentrancy | Already covered by `nonReentrant` in v1 (audit finding); preserve in v2 |

---

### 3.10 Performance / packing

**v1 gaps closed:** AA.2, AA.3, AA.4, AA.5, AA.6

| Layer | v1 storage cost | v2 target |
|---|---|---|
| Vault Position | 6 mappings × 1 SLOT each | 2 mappings × 1 packed struct (5 fields fit in 2 slots) |
| Pool balances | 4 mappings × 2 slots = 8 slots/op | 2 mappings × `Balance{uint128 plain; euint128 encrypted}` = 2 slots/op |
| addCollateral gas | ~330 K | < 200 K via batched FHE.add + cached ACL |
| ACL grants | 1 per call | 1 per session (cached on first call after open) |
| Registry decrement | full handle | partial-aware proportional decrement (computed via decryption oracle) |

---

## 4  Deployment phasing & migration

| Phase | Contracts deployed | Gates |
|---|---|---|
| **0** | (current) v1 on arb-sepolia, audited | Run stress test (this doc) |
| **1** | OracleAdapter, FheCore library, Registry v2 | Cross-chain mailbox configured; Permit2 deployed (it's already mainnet) |
| **2** | LendingPool v2, StrategyVault v2 | Migration script: re-encode existing positions; read v1 plainSupply/Borrow → re-supply to v2 with proof of equality |
| **3** | SwapRouter v2, Composer | E2E integration tests pass; tester wallet completes a 1-tx leveraged-strategy flow under target gas |
| **4** | Governor, Timelock, FORGE token | DAO bootstrap; OWNER renounces |

Migration is opt-in: v1 contracts remain deployed and verified for users who want to stay; v2 has a one-shot `migrateFromV1(positionData, signature)` that reads v1 state and reconstructs v2 state under the new ACL.

---

## 5  Trade-offs summary (one place per layer)

| Layer | Win | Cost |
|---|---|---|
| Composer | Single tx, single signature, MEV-protected | New trusted contract; UUPS proxy + Timelock mitigate |
| Vault | ERC-4626 share token (transferable, secondary markets) | Encrypted state per share gets complex on transfer; partial-close needs decryption oracle |
| Pool | Reserve-gated, oracle-aware, batched-sync, native ETH | +5–10% gas; flash-accounting re-entrancy surface |
| Registry | Lifecycle, namespaced ids, cross-chain, paused | Subgraph required for enumeration |
| Router | Batched intents, ZK min-out, multi-executor | ZK proof verification ~500K gas (deferred to v2.1) |
| FHE Core | Single-input + delegate ACL + batched precompile | Requires Fhenix mainnet primitives we don't yet have proofs for |
| Oracle | Multi-source, decimal-normalised | Single point of failure if all three sources drift |

---

## 6  Cross-reference — every gap to its v2 fix

(Copy of the table at the end of `STRESS_FINDINGS.md` for completeness.)

| Gap ID | v2 design item |
|---|---|
| A.3, A.5b2, A.5c, F.6, Q.5 | §3.2 Pool — health-factor + reserve gate + partial close |
| F.1, F.7, F.8, W.5, W.6 | §3.4 Composer — atomic multi-call & batched-sync |
| F.2, W.1, W.2 | §3.4 Composer — Permit2 + ERC-4626 share token |
| F.3, H.1–H.3 | §3.2 Pool — payable entrypoints, internal WETH wrapping |
| F.4, F.5, J.6, J.7 | §3.2 Pool — interest accrual + liquidation, §3.5 Router — partial-fill + fee |
| C.3, C.4, C.5, X.7 | §3.1 Registry — vault rotation, executor rotation, OZ Timelock |
| P.1, P.2, P.3 | §3.6 FHE core — ZK-proof-of-equality OR encrypted-input only API |
| U.2, M.3 | §3.6 FHE core — delegate ACL registry + on-chain permit events |
| Y.1–Y.5 | §3.7 Oracle adapter — Chainlink + price-normalised LTV |
| Z.1–Z.5 | §3.8 Governance — DAO + token + cross-chain mailbox |
| X.1–X.6, X.8 | §3.9 Safety — Pausable, ERC-1967 proxy, emergency withdraw |
| AA.1–AA.6 | §3.10 Performance — packed structs, lazy ACL grants, multi-input FHE.add |
| B.5, B.6, Q.3, Q.4, Q.6 | §3.1 Registry — name validation, length cap, commit-reveal id |
| S.2, S.3 | §3.1 Registry — strategy lifecycle, position cooldown |

---

## 7  References (production patterns this design draws from)

| Pattern | Source |
|---|---|
| Singleton Vault + Composer/Router | Uniswap V4 PoolManager — https://docs.uniswap.org/contracts/v4/concepts/PoolManager |
| Flash accounting / unlock-callback | Uniswap V4 — https://docs.uniswap.org/contracts/v4/concepts/PoolManager#flash-accounting |
| Internal balances / settle-take | Balancer V3 Vault — https://docs.balancer.fi/concepts/vault |
| Curated metavaults routing into markets | Morpho Vaults — https://docs.morpho.org/learn/concepts/vaults |
| Permit2 signature-approvals | Uniswap Permit2 — https://docs.uniswap.org/contracts/permit2/overview |
| Batch-auction intent settlement | CoW Protocol — https://docs.cow.fi/cow-protocol/concepts/introduction/batch-auctions |
| Permissionless cross-chain mailbox | Hyperlane — https://docs.hyperlane.xyz/docs/protocol/protocol-overview |
| ERC-4626 share token | EIP-4626 — https://eips.ethereum.org/EIPS/eip-4626 |
| FHE primitives (FHE.add, allowSender, etc.) | Fhenix CoFHE — https://docs.fhenix.zone/ |
| Pause + AccessControl + UUPS proxy | OpenZeppelin v5 — https://docs.openzeppelin.com/contracts/5.x/ |
| Timelock for governance | OpenZeppelin Governor + TimelockController — https://docs.openzeppelin.com/contracts/5.x/governance |

---

## 8  What this document does NOT do

* It does not modify any `.sol` file. v1 contracts remain deployed and verified.
* It does not write the v2 contracts. That is the next phase, gated on user approval of this design.
* It does not redo the stress test. The 10-run evidence in `421614.stress-evidence.json` stands as the input.
* It does not promise specific gas numbers (the ≤65% target is an engineering aspiration informed by the v1 baseline, not a guarantee).

When you (the user) approve this architecture I will:
1. Scaffold v2 contracts under `contracts/contracts/v2/` (separate from v1).
2. Write Foundry tests using `forge test --evm-version cancun` for the new flash-accounting paths.
3. Deploy to arb-sepolia, then re-run a v2-aware variant of `test-stress.ts` to confirm the 53 GAPs are closed.
