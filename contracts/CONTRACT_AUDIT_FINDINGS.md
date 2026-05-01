# Contract Audit Findings (consolidated)

This file consolidates the final stress run (#10) into the report shape required by the remediation protocol.

For run-by-run breakdown see `FINDINGS/FINDINGS_RUN_01.md` through `FINDINGS_RUN_10.md`.

For the design-level write-up see `STRESS_FINDINGS.md` and `V2_ARCHITECTURE.md`.

## Final tally

| Severity | Count |
|---|---:|
| FAIL | 0 |
| GAP | 53 |
| LIMIT | 2 |
| WARN | 13 |
| INFO | 26 |
| PASS | 65 |

## Critical (FAIL) findings

- None. The final run has 0 FAILs.

## High-severity (GAP) findings, grouped by category

### A — Partial-state / cross-step drift

- **[A.3]** Vault.closePosition cannot partial-close
  - collateralAmount < deposited deletes ALL state but only transfers the requested amount; remainder is permanently stranded. Static-only; not executed to avoid loss.
- **[A.5b2]** Pool reserve < tracked supply
  - actual USDC in pool=1000000 < tracked plainSupply=2000000. Borrow drained reserves but plainSupply was not adjusted; subsequent withdraw must rely on other suppliers' tokens to honour this user's tracked supply.
- **[A.5c]** Pool.withdraw causes reserve underflow (CRITICAL)
  - withdraw passed plain check but ERC-20 transfer failed (Error("ERC20: transfer amount exceeds balance")) because reserves were already drained by the borrow. Different user's withdraw could succeed by draining the borrower's reserve. v2 must enforce a healthFactor + net-supply gate.

### C — Cross-contract desync

- **[C.3]** Strategy.active flag is unused
  - registerStrategy sets active=true; no code path ever reads-and-acts-on or writes false. v2 must either remove the field or implement deactivate()/setActive() with auth.
- **[C.4]** Registry.vaultAddress cannot be rotated
  - VaultAlreadySet revert is permanent; if vault is upgraded the registry must be redeployed too. v2 design must support a vault rotation path or a registry that delegates by signed message.
- **[C.5]** SwapRouter.EXECUTOR is immutable
  - executor key compromise requires redeploying the router (and re-pointing UI/backend). v2 must support a delayed rotation or a Safe-controlled executor role.

### F — Composability gaps

- **[F.1]** No batched operations on any contract
  - Vault, Pool, Registry, Router each expose single-op functions only. v2 must add a Multicall or Composer entrypoint (atomic openPosition+supply+swap, openPosition+addCollateral, supply+borrow as one tx) to cut user gas and reduce front-running surface.
- **[F.2]** Users must approve and call vault directly
  - The vault is the recipient of safeTransferFrom, so users must approve(vault, amount) themselves. v2 Composer pattern would let users approve(composer) once and the composer would re-route to whichever vault implements their intent.
- **[F.3]** No native ETH support
  - openPosition / supply require ERC-20 with a non-zero address. Wrapping ETH→WETH adds friction. v2 should accept native ETH via `payable` entrypoints and wrap internally on first deposit.
- **[F.4]** No partial close / no withdraw-only-collateral path
  - closePosition is all-or-nothing; there is no decreaseCollateral or scaleDown. v2 must support partial unwinds with proportional encrypted TVL decrement.
- **[F.5]** No interest accrual / no liquidation
  - plainBorrowBalances never grows; there is no `accrueInterest` and no liquidator entrypoint. A 70% LTV position costs 0% APR and never gets liquidated. v2 must add either a healthFactor gate + liquidator role or per-block index updates.
- **[F.6]** Pool withdraw not gated by outstanding borrow
  - See A.5c. Without `if (borrow[user] > 0) require(supply[user] >= borrow[user] / ltv)` or a healthFactor check, a user can supply→borrow→withdraw and walk away.
- **[F.7]** Registry has no batched register / no strategy update
  - Each strategy is one tx. There is no setWorkflowHash, no deactivateStrategy, no transferOwnership of a strategy. v2 should support EIP-712-signed batch registration for permissionless onboarding.
- **[F.8]** SwapRouter has only single-intent + single-executor
  - No batchSubmit, no execute-many, no partial-fill, no executor rotation. v2 should accept a Merkle root of intents and support multi-DVN style executors.
- **[F.9]** No cross-layer triggers
  - Vault.openPosition cannot atomically supply remaining funds to LendingPool, nor submit a swap intent. Each layer is isolated. v2 mesh/composer should expose `intent => sequence of layer calls` semantics.

### H — Native / multi-token

- **[H.5]** Strategies are not bound to tokens
  - Registry stores name+workflowHash+creator only. There is no on-chain link between a strategy and the tokens it operates on. UI/back-end must enforce this off-chain. v2 should embed an allowlist of tokens (or a Merkle root) per strategy.

### J — SwapRouter executor

- **[J.6]** SwapRouter has no on-chain min-out enforcement
  - executeIntent accepts whatever outputAmount the executor passes; the encrypted minAmountOut is informational only. v2 must implement either a ZK proof of `output >= encMin` or a trusted-decryption oracle that publishes a signed minOut.
- **[J.7]** No fee / payment for executor
  - executor pays gas + transfers their own tokenOut for free. Production design must charge a fee on the user side and pay the executor (escrowed) per filled intent.

### M — Event integrity

- **[M.3]** No on-chain log of permit issuance
  - FHE permits are issued via off-chain createSelf(); there is no `PermitGranted(bytes32 permitHash, address issuer)` event. Subgraph indexers cannot reconstruct the permit graph from chain data alone.

### O — Composer / Mesh target

- **[O.2]** v2 Composer target: < 65% of v1 total gas
  - Composer.openLeveragedStrategy(name, hash, encInputs[]) should run in a single transaction at ≤ 1070611 gas (≤65% of v1) by amortising the FHE handle setup, eliminating duplicate ERC-20 approvals (use Permit2 or transferAndCall), and writing to registry/vault/pool storage in one transient ACL pass.
- **[O.3]** v1 has 4-tx front-running window
  - Between approve→open→supply→borrow, an attacker can sandwich the approval (revoking via UI, replacing the approval target, or front-running the borrow with a spam tx that bumps gas). v2 Composer with single-tx semantics removes this entire window.

### P — Plaintext / Encrypted skew

- **[P.1]** Vault.openPosition has no plaintext↔encrypted equality proof
  - collateralAmount (uint256) and collateral (InEuint128) are two independent inputs; the contract trusts the user that they match. An attacker can deposit 1 USDC plain but stamp encrypted=10**18, polluting the encrypted TVL handle. v2 must require either (a) encrypted comparison via FHE.eq + a server-decryption oracle, or (b) a ZK proof that encrypted == plain.
- **[P.2]** Vault.addCollateral has no plaintext↔encrypted equality proof
  - Same skew: amount (plain) ≠ encAmount (encrypted) is not enforced. Multiple addCollateral calls compound the skew.
- **[P.3]** Pool.supply / borrow / repay / withdraw all carry plaintext↔encrypted skew
  - All five state-mutating Pool functions take both plain and encrypted versions of the amount. The plain copy gates the transfer; the encrypted copy goes into the FHE handle. Mismatch is not detected. v2 must remove the duplicate input or enforce equality.

### Q — Argument space

- **[Q.5]** Pool reserve drained to 0
  - before=1000000 after=0; checkLtvAndBorrow at 100% LTV drains the user's own reserve. Multi-user setting: an attacker can drain another user's supply this way. v2 healthFactor must include a global reserve check.
- **[Q.6]** registerStrategy is front-runnable
  - An attacker watching the mempool can copy (name, workflowHash) and submit at higher gas to grab the lower id. v2 should commit-reveal or salt the id with msg.sender's hash so collisions become impossible.

### S — Time-based

- **[S.2]** Registry has no strategy lifecycle / decay
  - Strategies live forever; there is no archive/sunset path. Storage grows monotonically. v2 should let creators decommission strategies (active=false) and pruneable storage rooting in a Merkle root for old IDs.
- **[S.3]** Vault positions have no maturity / cooldown
  - Once opened, a position can be closed any time. No vesting, no minimum lock, no cooldown. v2 may want a strategist-defined minLock (e.g. 7-day vesting for strategy-bound LP).

### U — FHE zero-state

- **[U.2]** FHE ACL is binary (this contract / msg.sender)
  - All allowThis/allowSender calls grant decryption to the contract or the caller only. There is no allowAddress(thirdParty) call path, so a strategy manager / liquidator / KYC oracle cannot read encrypted balances. v2 should expose a permissioned delegate registry that grants narrow ACL.

### W — Architecture / Composer

- **[W.1]** No transferAndCall / Permit2 integration
  - Users must approve(token, spender, amount) explicitly before each contract interaction. v2 should integrate Permit2 (signature approvals) and/or ERC-1363 transferAndCall so a single signed message replaces two on-chain txs.
- **[W.2]** Vault is not ERC-4626 compatible
  - There are no shares/totalAssets/totalSupply hooks; users hold positions, not tokens. v2 should mint a per-strategy share token (ERC-4626) so positions are transferable, composable, and tradeable on secondary markets.
- **[W.3]** No protocol fee / no creator royalties
  - Strategists earn nothing for registering profitable strategies; the protocol takes nothing on TVL. v2 should accrue an encrypted fee per position (e.g. 10 bps annual) split between creator and protocol treasury.
- **[W.4]** No automation / cron / keeper hook
  - There is no `executeStrategy(id, signedAction)` path. Off-chain bots must rebalance manually. v2 should expose a keeper-callable function that can rebalance positions according to encrypted parameters within strategist-defined bounds.
- **[W.5]** No batched-sync pool primitive
  - Pool.supply/withdraw/borrow/repay are per-call; there is no `tick()` or `settle()` that nets queued operations. v2 (per the brief) needs an Uniswap V4-style flash accounting / Balancer-style internal balances so users can do many micro-ops in one settle tx.
- **[W.6]** No router-level intent batching
  - submitSwapIntent is one-at-a-time. v2 should accept a Merkle root of intents (CoW Protocol style) so a single tx posts N intents and a single settle clears them.

### X — Safety / upgradability

- **[X.1]** No pause() / circuit-breaker on Vault
  - If a bug is found post-deploy, users can't be protected. v2 must inherit OZ Pausable + a guardian role.
- **[X.2]** No pause() on LendingPool
  - Same. Critical for a pool that bypasses borrow-backing checks (see A.5c).
- **[X.3]** No pause() on SwapRouter
  - Compromised executor = drainable; v2 must let a guardian pause the router immediately.
- **[X.4]** No pause() on Registry
  - Strategy spam (Q.4, Q.6) cannot be stopped; v2 needs a temporary pause on registerStrategy.
- **[X.5]** No upgrade path (no proxy)
  - Bugs require redeploying the entire contract suite + state migration. v2 should sit behind an ERC-1967 / UUPS proxy with timelocked upgrades, or use the diamond pattern.
- **[X.6]** No emergency withdraw
  - If the FHE backend is degraded (cofhe-mocks vs production), users have no plaintext-only escape hatch. v2 must include an emergencyWithdraw(token) that returns plain-only deposits.
- **[X.7]** No timelock on admin paths
  - setVault and (potentially) future admin functions execute immediately. v2 should route admin actions through OZ TimelockController so users can react to malicious / botched changes within a delay window.
- **[X.8]** No view-only encrypted-balance read
  - getCollateral / getSupplyBalance / getBorrowBalance are `external nonReentrant returns (euint128)` because they call FHE.allowSender. UIs must use staticCall to avoid sending a tx. v2 should expose a parallel view-only `peekXxx()` returning the cached ctHash without mutating ACL, and offload allowSender to a one-time setup call.

### Y — Pricing / decimals

- **[Y.1]** Pool LTV check ignores token decimals
  - checkLtvAndBorrow compares (borrowAmount * ltvDen) ≤ (supply * ltvNum) in raw token units. USDC has 6 decimals, WETH 18 — borrowing 1 wei WETH (which is ~$0) against 1 USDC ($1) trivially passes; borrowing 1 WETH (~$3000) against 1 USDC ($1) trivially fails. v2 must normalise to a common unit (e.g. 1e18 USD via Chainlink) before comparison.
- **[Y.2]** No price oracle integration
  - There is no Chainlink / Uniswap V3 TWAP / Pyth integration. Cross-asset LTV is meaningless without prices. v2 must add a per-token-pair oracle adapter and a heartbeat / staleness check.
- **[Y.3]** No collateral factor / loan-to-value per token
  - ltvNum/ltvDen are caller-supplied. A user borrowing against WETH can pass 99/100; against a stablecoin 70/100; both go through unchecked. v2 should store risk-adjusted LTV per (collateralToken, borrowToken) pair, controlled by governance.
- **[Y.4]** Encrypted TVL aggregation has no cross-token denomination
  - Registry encryptedTvls[strategyId] is a single euint128 per strategy. If a strategy accepts USDC + WETH + WBTC, the TVL is the SUM OF RAW UNITS (incoherent). v2 must aggregate in a price-normalised base (USDC-1e6 or USD-1e18) using an oracle.
- **[Y.5]** Pool has no price-aware liquidation threshold
  - Without prices, there is no notion of "position is unhealthy". v2 must define `healthFactor = sum(collateral_i * price_i * liqLtv_i) / sum(borrow_j * price_j)` and let liquidators close positions where healthFactor < 1.

### Z — Governance

- **[Z.1]** No protocol governance
  - OWNER is the immutable deployer. There is no ability to migrate to a DAO, no Snapshot / Tally integration. v2 must hand control to a multisig or DAO at deploy and use OpenZeppelin Governor + Timelock for parameter changes.
- **[Z.2]** No protocol token / no incentive alignment
  - There is no token to reward strategists, suppliers, executors, or governance voters. v2 should plan an emission schedule even if not deployed in v2.0.
- **[Z.3]** Strategies have no human-readable identifier
  - strategyId is uint256; the only on-chain link to humans is the `name` string (un-validated, see Q.4). v2 should use ENS-style namespaced ids (creator.strategyName) or content-addressed hashes.
- **[Z.4]** No off-chain attestation / KYC hook
  - Anyone can registerStrategy. For institutional integrations (regulated jurisdictions) a strategy creator may need to attach a KYC attestation (EIP-712 signed by an attester). v2 should support an optional `attesterRoot` parameter on registerStrategy.
- **[Z.5]** No cross-chain registry / no message passing
  - All four contracts are arb-sepolia-local. A v2 mesh requires a permissionless cross-chain registry (Hyperlane Mailbox / LayerZero V2 endpoint) so a strategy registered on Arbitrum can be referenced from Base or Linea.


## WARN findings

- **[A.4]** Vault.addCollateral wrong-token reverts ZeroAddress — Error name `ZeroAddress` is misleading — the actual cause is a token mismatch, not a zero address. v2 should raise `TokenMismatch`
- **[B.5]** Registry accepts empty name — id=79 name="" creator=0xA2ad1b1cAe13146D656F56b7e6ae3774dE485a51 — no validation on length or content
- **[B.7a]** Router accepts deadlineOffset=0 — intent 0x56c4a8ed94… stored with deadline=block.timestamp; executor would revert IntentExpired on next block
- **[B.8]** Router accepts huge deadlineOffset — 18446744073709551615 estimateGas=326831; uint256 add never overflows for realistic offsets but no upper bound enforced
- **[H.4]** Pool.supply WETH reverts on missing balance/allowance — Error("ERC20: transfer amount exceeds balance")
- **[Q.3]** Registry accepts ZeroHash workflow — registry does not validate workflowHash; an empty / placeholder hash is accepted. v2 should reject ZeroHash to avoid orphan strategies.
- **[Q.4]** Registry allows duplicate names — two strategies with name='Q-dup' co-exist (different ids). v2 should at minimum flag duplicates or store a name→id reverse mapping for UI deduplication.
- **[AA.1]** checkLtvAndBorrow accepts ltvNum=0 — ltvNum is uint128 with no zero-check (only ltvDen has). When ltvNum=0 the borrow always reverts InsufficientCollateral, so it is benign — but inputs that always revert are usually rejected at the boundary. v2 should add `if (ltvNum == 0) revert LtvNumeratorZero();` for caller clarity.
- **[AA.2]** Vault Position uses 6 separate storage mappings — positions, hasPosition, collateralTokens, depositedAmounts, positionStrategyIds, positionCreatedAt are 6 distinct mappings. The audit split them to satisfy slither's cross-function reentrancy detector. v2 can collapse to 1-2 mappings using a packed struct + struct-of-mappings pattern, saving ~50% of position-mutation gas.
- **[AA.3]** Pool uses 4 storage mappings per (token,user) — supplyBalances, borrowBalances, plainSupplyBalances, plainBorrowBalances are 4 disjoint mappings. v2 should combine plain+encrypted per side into a struct {uint128 plain; euint128 encrypted} so a single SLOAD/SSTORE covers both halves of one balance.
- **[AA.4]** addCollateral gas dominated by FHE precompile — 330594 gas per addCollateral; ~80% is FHE.add + allowThis/allowSender/allowTransient. v2 must amortise: lazy ACL grants, batched FHE.add via a single multi-input precompile call, or off-chain proof of post-state.
- **[AA.5]** ACL grants are not cached across calls — Every state-mutating function calls allowThis + allowSender on its result handle. A user that calls addCollateral 10 times pays 10× ACL gas. v2 should grant once at openPosition and skip on subsequent ops if the handle id is unchanged.
- **[AA.6]** Registry decrements TVL by full encrypted handle — closePosition passes the full positions[user].collateral handle to decrementTvl. This is correct only because partial-close is impossible (A.3). v2 must compute `decrementAmount = closeAmount / depositedAmount * collateralHandle` (encrypted division is hard) or carry per-strategy net positions.

## LIMIT findings

- **[B.6.4096]** Registry registerStrategy name=4096B gasEst — 3112338
- **[B.6.16384]** Registry registerStrategy name=16384B gasEst — 12002861
