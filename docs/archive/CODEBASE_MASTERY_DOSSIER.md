# CODEBASE MASTERY DOSSIER

**generated_from:** FheForge (refactor-FheForge-work)
**codebase_profile:** Encrypted DeFi monorepo — Solidity 0.8.28 / Next.js 14 / NestJS 11
**total_files:** ~230 | **verified:** ~200+ | **anomalous:** 35+

---

## 1. Codebase Profile

| Field | Value |
|---|---|
| **Primary languages** | Solidity 0.8.28, TypeScript (Next.js 14 / NestJS 11) |
| **Paradigm** | Monorepo (bun workspaces: `contracts`, `ui`, `backend/apps`) |
| **Runtime** | EVM (Arbitrum Sepolia 421614, Base Sepolia 84532, Hardhat local 31337), Node.js 22 |
| **Layers** | Smart Contracts, Frontend, Backend API, PostgreSQL, Infra/Monitoring, Deploy/Ops, Side Projects |
| **Build** | bun + Hardhat (solidity compile via viaIR/evm:cancun) + Foundry (forge test) |
| **Test** | Foundry (24 fuzz+invariant tests), Hardhat (4 TS tests), Jest (~10), Vitest (1), Slither, Certora (4 spec files, 18 rules, 1 passing) |
| **Config surface** | .env files (5 envs), hardhat.config.ts, foundry.toml, monitoring/*.yml, logging/*.yml, .github/workflows/*.yml, railway.json |
| **External deps** | ~80+ npm pkgs: CoFHE SDK 0.5.2, OpenZeppelin 5.6, Pyth, Next.js 14, NestJS 11, wagmi 2.19, viem 2.48, ethers 6, Radix UI (30+), TanStack Query, Google Gemini AI |
| **Key patterns** | FHE/CoFHE private DeFi, encrypted lending, strategy vault system, ReactFlow visual builder, AI strategy builder (Gemini), DDD backend, event indexer, wallet-based JWT auth, Certora formal verification |

---

## 2. Architecture Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js 14)                     │
│  /  /builder  /prompt  /strategy/[id]  /strategy-review  /lending-demo │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Hooks: use-fhe-vault use-lending-actions use-composer   │     │
│  │         use-strategy-builder use-swap-router use-portfolio│    │
│  │         use-activity-service use-rebalance use-strategies │    │
│  └──────────────┬────────────────────────────┬──────────────┘     │
│                 │ REST (axios)               │ wagmi/viem         │
│                 ▼                            ▼                    │
└─────────────────────────────────────────────────────────────────┘
         │                                      │
         │ GET/POST /defi-strategies            │ deposit() borrow()
         │ GET/POST /activities                 │ supplyCollateral()
         │ GET /defi-modules                    │ openPosition()
         │ POST /ai-strategy-builder/build      │ executeIntent()
         │ POST /auth/*                         │ getPriceUsd()
         │                                      │
         ▼                                      ▼
┌──────────────────────────┐         ┌──────────────────────────────────┐
│    BACKEND (NestJS 11)    │         │     SMART CONTRACTS (EVM)        │
│  ┌────────────────────┐   │         │  ┌─────────────────────┐        │
│  │ AuthModule         │   │         │  │ LendingPool         │        │
│  │ (JWT, nonce→wallet)│   │         │  │ supply/borrow/repay │        │
│  ├────────────────────┤   │         │  │ liquidate (encrypted)│        │
│  │ DefiStrategies     │   │         │  ├─────────────────────┤        │
│  │ (5 entities, sim)  │   │         │  │ StrategyVault       │        │
│  ├────────────────────┤   │         │  │ open/close/rebalance│        │
│  │ AiStrategyBuilder  │   │         │  ├─────────────────────┤        │
│  │ (Gemini→strategy)  │   │         │  │ FheForgeComposer    │        │
│  ├────────────────────┤   │         │  │ 4-step strategy exec│        │
│  │ EventIndexer       │──┼─────────┼─▶│ ├─────────────────────┤        │
│  │ (poll→DB sync)     │   │         │  │ PriceOracle         │        │
│  ├────────────────────┤   │         │  │ (Pyth+Chainlink)    │        │
│  │ FhenixStrategySvc  │──┼─────────┼─▶│ ├─────────────────────┤        │
│  │ (price feed reads) │   │         │  │ SwapRouter          │        │
│  └────────┬───────────┘   │         │  │ (intent-based DEX)  │        │
│           │               │         │  ├─────────────────────┤        │
│           ▼               │         │  │ StrategyRegistry    │        │
│  ┌────────────────────┐   │         │  │ + TokenRegistry     │        │
│  │  Supabase / PG      │   │         │  ├─────────────────────┤        │
│  │  (16 tables)        │   │         │  │ StrategyExecutor    │        │
│  └────────────────────┘   │         │  │ (8 action types)    │        │
└──────────────────────────┘         │  ├─────────────────────┤        │
                                     │  │ FheForgeBase        │        │
       MONITORING                    │  │ (ACL, verify, pause)│        │
  ┌──────────────────────┐           │  ├─────────────────────┤        │
  │ Prometheus → Grafana │           │  │ ExecutorContract    │        │
  │ Loki → Promtail      │           │  │ (Ownable proxy)     │        │
  │ Alertmanager (email, │           │  ├─────────────────────┤        │
  │  Slack, PagerDuty)   │           │  │ Governance          │        │
  └──────────────────────┘           │  │ (Timelock,Governor) │        │
                                     │  └─────────────────────┘        │
                                     │  deps: CoFHE TaskManager,       │
                                     │  Pyth Oracle, OpenZeppelin      │
                                     └──────────────────────────────────┘

External:
  - Google Gemini AI (backend → strategy generation)
  - CoFHE TaskManager (Arbitrum Sepolia — FHE coprocessor)
  - Pyth Oracle (price feeds)
  - Railway (backend deployment)
  - Vercel (frontend deployment)
  - Supabase (PostgreSQL)
  - Sentry (error tracking)
```

---

## 3. Layer Contracts & Cross-Layer Index

### UI → Backend API (REST)

| Caller (UI) | Provider (Backend) | Contract | Test Coverage |
|---|---|---|---|
| `ai-strategy-service.ts` | `POST /ai-strategy-builder/build` | NL prompt → strategy JSON | Not tested (5/min throttled) |
| `defi-module-service.ts` | `GET/POST /defi-modules/*` | Module/pair/action CRUD | Not tested |
| `defi-module-service.ts` | `GET/POST /defi-strategies/*` | Strategy CRUD + simulate | Not tested |
| `activity-service.ts` | `GET/POST /activities/*` | Activity log CRUD + progress | Not tested |
| `user-service.ts` | `GET/POST /users/*` | User CRUD + balance/evm-binding | Not tested |
| `strategy-service.ts` | `GET /strategies/*` | Strategy showcase CRUD | Not tested |
| `api.ts` | `POST /auth/wallet-login` | Wallet-based JWT auth | Not tested |

### UI → Smart Contracts (on-chain via wagmi/viem)

| Caller (UI hook) | Contract | Functions | Test Coverage |
|---|---|---|---|
| `use-fhe-vault.ts` | StrategyVault | deposit, withdraw, supplyCollateral, borrow, wrap, claimRewards | Foundry: 25+ tests |
| `use-lending-actions.ts` | LendingPool | supply, depositCollateral, borrow (encrypted), repay, withdraw, liquidateWithProof | Foundry: 24 unit + 15 fuzz |
| `use-swap-router.ts` | SwapRouter | executeIntent, cancelIntent, getIntentMeta | Foundry: 19 unit + 7 fuzz + 6 invariant |
| `use-composer.ts` | FheForgeComposer | openPosition (encrypted) | Foundry: 20+ |
| `use-portfolio.ts` | StrategyVault + LendingPool | getPositionIds, positionMeta, getUserSupply, getUserBorrow | Implicit in vault tests |
| `use-rebalance.ts` | FheForgeComposer | rebalance (addCollateral, repay, newBorrow) | Combined test |

### Backend → Smart Contracts (ethers RPC)

| Caller (Backend) | Contract | Purpose | Test Coverage |
|---|---|---|---|
| `event-indexer.service.ts` | StrategyVault + LendingPool | Poll event logs → persist to DB (15s interval) | 1 spec file, 2 test blocks |
| `fhenix-strategy.service.ts` | PriceOracle | getPriceUsd price feed reads (1min cache) | Not tested |

### Backend → DB (Supabase/PostgreSQL)

| Module | Tables | Status |
|---|---|---|
| AuthModule | users | **No migration DDL** |
| UsersModule | users | **No migration DDL** |
| StrategiesModule | strategies | **No migration DDL** |
| ActivitiesModule | activities | **No migration DDL** |
| DefiStrategiesModule | defi_strategies, defi_strategy_versions, defi_strategy_executions, defi_execution_step_results, defi_strategy_simulation_snapshots | **No migration DDL** (5 tables) |
| DefiModulesModule | defi_modules, defi_module_actions, defi_pairs, defi_action_required | defi_action_required has DDL; others **missing** |
| DefiTokenModule | defi_token | **No migration DDL** |
| EventIndexerModule | on_chain_events, event_indexer_state | **Has DDL** (001) |

### Smart Contract → Smart Contract

| Caller | Provider | Purpose | Test Coverage |
|---|---|---|---|
| LendingPool | FheForgeBase (inherited) | ACL, verifyEquality, pause, ownership | Foundry: extensive |
| LendingPool | PriceOracle | getPriceUsd, getAssetPrice, convertToUsd, getCollateralFactor, getLiquidationThreshold | Foundry: 40+ unit + 10 fuzz |
| LendingPool | StrategyRegistry | getVault, getComposer | Unit tested |
| LendingPool | TokenRegistry | getTokenAddress | Unit tested |
| LendingPool | ExecutorContract | execute (for liquidations) | Unit tested |
| StrategyVault | FheForgeBase (inherited) | ACL, owner, pause | 25+ vault tests |
| StrategyVault | LendingPool | supply, borrow, repay (encrypted) | Integration tested |
| StrategyVault | PriceOracle | price queries | Tested via pool |
| FheForgeComposer | StrategyVault | open/close/rebalance vault positions | Foundry: 20+ |
| FheForgeComposer | LendingPool | supply/borrow on behalf | Integration tested |
| FheForgeComposer | StrategyExecutor | schedule action sequence | Foundry: 10+ |
| StrategyExecutor | SwapRouter/StrategyVault/LendingPool | Execute 8 action types | Foundry: 10+ |
| SwapRouter | IUniswapV3SwapCallback | DEX swap via Uniswap V3 | Input validation only (no real swap tested) |
| ExecutorContract | Ownable (inherited) | Single-owner proxy | Unit tested |
| WETH9 | ERC20 | WETH wrap/unwrap | Unit tested |

---

## 4. Critical Flow Traces

### Flow 1: Encrypted Lending (supply → borrow → repay)

```
User wallet
  → ui/app/lending-demo/page.tsx [UI render + wallet connect]
  → ui/hooks/use-lending-actions.ts [supply(amount, token)]
    → @cofhe/sdk Encryptable.encrypt(amount) [amount → InEuint128 handle]
    → LendingPool.supply(token, encryptedAmount, receiver)
      → FheForgeBase._verifyEquality(encryptedAmount, receiver) [FHE.eq check]
      → LendingPool._updateSupply(receiver, token, encryptedAmount)
        → FHESafeMath128.add(totalSupplies[token], encryptedAmount) [FHE.add]
      → emit Supply(receiver, token, encryptedAmount) [← LEAKS encrypted handle]
  → LendingPool.borrow(token, encryptedAmount, receiver)
      → FheForgeBase._verifyEquality(encryptedAmount, receiver)
      → LendingPool._checkBorrowLTV(receiver) [oracle price lookup]
        → PriceOracle.getPriceUsd(token) [Pyth feed or fallback]
      → LendingPool._updateBorrow(receiver, token, encryptedAmount)
        → FHESafeMath128.add(totalBorrows[token], encryptedAmount)
      → emit Borrow(receiver, token, encryptedAmount)
  → LendingPool.repay(token, encryptedAmount, borrower)
      → FheForgeBase._verifyEquality(encryptedAmount, borrower)
      → LendingPool._updateBorrow(borrower, token, FHESafeMath128.sub(borrow, amount))
      → emit Repay(borrower, token, encryptedAmount)

TERMINAL: Encrypted state updated on-chain. No plaintext amounts visible.
ANOMALIES:
  - _verifyEquality runs AFTER token transfer in 5 of 13 check sites (CRIT-1)
  - LendingPool events emit encrypted handles, but events are public — amount tracking possible
  - Borrow LTV check uses PriceOracle which falls back to static env rates if Pyth stale
  - No liquidation test with real zk-proof (always mocked)
```

### Flow 2: AI Strategy Builder → Review → Execute

```
User input at ui/app/prompt/
  → ui/hooks/use-strategy-prompt.ts [submit prompt]
    → ui/services/ai-strategy-service.ts [POST /ai/build-strategy]
      → backend POST /ai-strategy-builder/build
        → AiStrategyBuilderController.build()
          → GeminiAiService.generateStrategy(prompt)
            → Google Gemini API [NL → structured strategy]
          → StrategyValidatorService.validateStrategy(response)
          → StrategyConstraintsService.checkConstraints(response)
        ← BuildStrategyResponse { steps, tokens, estimatedGas }
  → Redirect to /strategy-review
    → ui/app/strategy-review/StrategyReviewClient.tsx [display strategy]
    → User reviews and confirms
    → ui/hooks/use-strategy-builder.ts [submitStrategy]
      → ui/services/defi-strategy-builder.ts [POST /defi-strategies]
        → backend DefiStrategiesController.create()
          → DefiStrategiesService.save(workflow_json, workflow_graph)
        ← strategy_id
  → UI calls FheForgeComposer.openPosition()
    [encrypted collateral, supply, borrow amounts]
    → StrategyVault.openPosition(receiver, encryptedCollateral)
    → LendingPool.supply(token, encryptedSupply, position)
    → LendingPool.borrow(token, encryptedBorrow, position)

TERMINAL: AI-generated strategy persisted in DB + deployed as on-chain position.
ANOMALIES:
  - Gemini API call is rate-limited to 5/min but NOT per-user — global budget
  - GEMINI_API_KEY missing detected at runtime, not startup (CFG-002)
  - strategy full lifecycle (AI→review→on-chain) has ZERO automated tests
  - Backend strategy DB state may drift from on-chain state (no workflowHash check)
```

### Flow 3: Composer Position (create → rebalance → close)

```
  → ui/hooks/use-composer.ts [openPosition with encrypted params]
    → @cofhe/sdk encrypt128ForComposer(collateral, supply, borrow)
      [slot-4 workaround for arb-sepolia stale ZK verifier key]
    → FheForgeComposer.openPosition(params)
      → FheForgeBase._verifyEquality(collateral.encrypted, msg.sender)
      → FheForgeComposer._openVaultPosition(token, collateral.encrypted, supply.encrypted)
        → StrategyVault.supplyCollateral(positionId, token, collateral.encrypted)
          → LendingPool.supply(positionId, token, supply.encrypted)
      → FheForgeComposer._borrowViaPool(token, borrow.encrypted, strategist)
        → LendingPool.borrow(token, borrow.encrypted, strategist)
      → StrategyExecutor.schedule(actions[], schedule)
  → User rebalances via use-rebalance.ts
    → FheForgeComposer.rebalance(positionId, updatedParams)
      → StrategyVault.closePosition(positionId, withdrawEncrypted)
      → StrategyVault.openPosition(addCollateralEncrypted, newBorrowEncrypted)
  → User closes via StrategyVault.closePosition()
    → LendingPool.repayAll()
    → Withdraw remaining collateral

TERMINAL: Position lifecycle complete. All amounts encrypted end-to-end.
ANOMALIES:
  - Composer.borrowFor has NO LTV check (HIGH-6)
  - closePosition partial close has double-withdrawal vector (A-8, security report)
  - Slot-4 workaround indicates CoFHE SDK compatibility issue on target network
  - _verifyEquality not gate token transfers in borrowFor path
```

### Flow 4: Authentication (wallet sign → JWT)

```
User wallet (MetaMask)
  → GET /auth/nonce/:walletAddress
    → AuthController.getNonce(walletAddress)
      → uuid v4 nonce generated, stored in Map<walletAddress, {nonce, createdAt}>
      → Returns nonce + EIP-191 sign message
  → User signs with eth_sign in wallet
  → POST /auth/wallet-login { walletAddress, signature, nonce, chainId }
    → AuthController.walletLogin(dto)
      → AuthService.validateAndLogin(walletAddress, signature, nonce)
        → Lookup nonce in Map
        → ethers.verifyMessage(message, signature) → recoveredAddress
        → Require recoveredAddress == walletAddress (case-insensitive)
        → Consume nonce (delete from Map)
        → UserService.getUserByWalletAddress(walletAddress)
        → If not found: UserService.createUser({ walletAddress, chainId })
        → JwtService.sign({ sub: userId, walletAddress, role: 'user' }, 15min)
      ← { accessToken, userId, walletAddress }
  → Subsequent API calls include Authorization: Bearer <token>
    → JwtAuthGuard validates via passport-jwt strategy
    → @Public() decorator exempts specific routes

TERMINAL: JWT issued. User authenticated for 15 minutes.
ANOMALIES:
  - Nonce stored in-memory Map — BROKEN in multi-instance (AUTH-001, CRITICAL)
  - Memory leak — nonces never garbage collected (AUTH-002, MEDIUM)
  - No token revocation / logout (AUTH-004)
  - /health and /metrics are public but throttled at 20/60s (API-001, HIGH)
```

### Flow 5: Event Indexer (on-chain → DB)

```
backend OnModuleInit:
  → EventIndexerModule.onModuleInit()
    → Restore checkpoint from DB: event_indexer_state WHERE id='event_indexer'
    → Start polling loop (every 15s)
      → Get current block: provider.getBlockNumber()
      → If block > lastBlock + 1:
        → Check gap: if (block - lastBlock - 1) > 64 → log WARNING
        → Fetch logs: provider.getLogs({ fromBlock: lastBlock+1, toBlock: min(block, lastBlock+1000) })
        → Parse events by known signatures:
          - StrategyVault: OpenPosition, ClosePosition, AddCollateral, Withdraw
          - LendingPool: Supply, Borrow, Repay, Withdraw, Liquidate
        → For each event: create on_chain_events row (contract_name, event_name, block_number, tx_hash, log_index, data JSONB, timestamp)
        → Update checkpoint: event_indexer_state UPSERT lastBlock= block

TERMINAL: On-chain events persisted in PostgreSQL.
ANOMALIES:
  - Gap > 64 blocks warns but no catch-up mechanism (MON-005, HIGH)
  - Arbitrum Sepolia retains ~128 blocks → extended downtime LOSES events permanently
  - Only indexes StrategyVault + LendingPool events — SwapRouter, Composer, Registry events ignored
  - No HTTP endpoint to observe current checkpoint or trigger manual re-sync
```

---

## 5. Risk Register

### CRITICAL (5)

| ID | Layer | Finding | Trigger | Tested | Recommendation |
|---|---|---|---|---|---|
| R-001 | Contracts | `_verifyEquality` does NOT gate token transfers at 13 sites — dual input gap | Malicious/mismatched plain+encrypted input | Partially (Certora CVL fails known) | Gate all token transfers on `_verifyEquality` result before execution |
| R-002 | Contracts | `requestLiquidityCheck` has no ACL — anyone can `allowPublic` on any user's balances | Any address calls `requestLiquidityCheck(user)` | No | Add access control + economic barrier |
| R-003 | Contracts | `getDepositedAmount` returns plaintext uint256 — defeats FHE privacy for vault | Anyone calls this public view on any position | No | Return encrypted handle or ACL-gate |
| R-004 | Backend | Auth nonce in-memory Map — completely broken in multi-instance Railway deployment | >1 backend instance running | No | Replace with Redis-backed nonce store |
| R-005 | DB/Infra | 13/16 DB tables lack migration DDL — entire schema lost if Supabase project recreated | Supabase project recreation/deletion | No | Write DDL for all 13 missing tables as migration files |

### HIGH (8)

| ID | Layer | Finding | Trigger | Tested | Recommendation |
|---|---|---|---|---|---|
| R-006 | Contracts | `allowPublic` grants are permanent — no revocation mechanism | User calls allowPublic (or someone calls requestLiquidityCheck) | No | Implement decryption key rotation or expiry |
| R-007 | Contracts | ExecutorContract single-owner hot wallet — no timelock | Owner key compromised | Partially | Add multisig or timelock on executor role |
| R-008 | Contracts | Composer `borrowFor` has no LTV check | Composer can borrow exceeding safe LTV | Partially | Add LTV validation in composer |
| R-009 | Contracts | Fallback price manipulation via owner (setSource, updatePriceFeeds bulk-fresh) | Owner sets malicious Pyth source or stale prices accepted | Partially | Timelock oracle admin, per-token freshness |
| R-010 | Backend | CORS `ALLOWED_ORIGINS` falls back to dev localhost in production | Production deployed without setting var | No | Hard-fail in production if ALLOWED_ORIGINS unset |
| R-011 | Backend/Monitoring | Alertmanager SMTP credentials have no defaults — monitoring stack non-functional | docker-compose up with no env vars | No | Add defaults to docker-compose or .env.example |
| R-012 | Backend/Monitoring | /health and /metrics hit global 20/60s throttle — Railway healthchecks 429 | Prometheus scraping or Railway healthcheck | No | Exempt from throttle |
| R-013 | Infra/CI | No deploy approval gate — Railway auto-deploys from linked repo on push to main | Any push to main | N/A | Add GitHub environment with required reviewers |

### MEDIUM (10)

| ID | Layer | Finding | Trigger | Tested | Recommendation |
|---|---|---|---|---|---|
| R-014 | Contracts | Governor proposalThreshold() override bypasses GovernorSettings.setProposalThreshold() | Governance proposal calls setProposalThreshold | No | Remove override or make setProposalThreshold revert |
| R-015 | Contracts | FHE.eq behavior against deployed CoFHE coprocessor is unknown — single upstream dependency gap | CoFHE TaskManager upgrade or bug | No | Add integration test against actual TaskManager |
| R-016 | Backend | Auth nonce memory leak — unbounded Map growth | Attacker calls generateNonce repeatedly | No | Add periodic cleanup interval |
| R-017 | Backend | Strategy service filename typo 'stategies.controller.ts' | Developer confusion | N/A | Rename file |
| R-018 | Backend | Event indexer gap risk — >64 blocks warns, ~128 blocks loss | Backend down >30 min | No | Implement archive node fallback |
| R-019 | Backend | Global throttler 20/60s applies to ALL routes including health/metrics | Scrape/poll storms | No | Exempt health/metrics from global throttle |
| R-020 | Backend | Missing DB indexes on foreign key columns (8 tables) | Large dataset joins become slow | No | Add indexes on all FK columns |
| R-021 | Contracts | LendingPool events leak plain amounts (P-HIGH-6 unresolved) | Event watchers can correlate encrypted amounts | Partially known | Review and sanitize event data |
| R-022 | Monitoring | 3 Grafana dashboards reference non-existent metrics — No Data | Any user opens dashboard | No | Remove dead panels or implement metrics |
| R-023 | Monitoring | Grafana dashboard provisioning YAML missing — JSON files never loaded | docker-compose up monitoring stack | No | Add dashboards.yaml provisioning config |

---

## 6. Test Coverage Reality

| Contract | Unit | Fuzz | Invariant | Formal (CVL) | Live/Postfix | Coverage |
|---|---|---|---|---|---|---|
| LendingPool | 24 tests (Foundry) | 15 fuzz (2 files) | 7 reentrancy tests | 9 rules (4 assert-true) | test-postfix.ts | 96.1% fn coverage |
| StrategyVault | 25+ tests | 2 fuzz | None | 3 rules (all assert-true) | test-postfix.ts | ~95% |
| PriceOracle | 40+ tests | 10 fuzz | None | Not spec'd | test-postfix.ts | ~90% |
| SwapRouter | 19 tests | 7 fuzz | 6 balance tests | Not spec'd | test-postfix.ts | ~85% |
| FheForgeComposer | 20+ tests | None | None | 3 rules (all assert-true) | test-postfix.ts | ~85% |
| StrategyRegistry | 14 tests | 1 fuzz | None | Not spec'd | test-postfix.ts | ~90% |
| TokenRegistry | 12 tests | None | None | Not spec'd | test-postfix.ts | ~90% |
| StrategyExecutor | 10+ tests | None | None | Not spec'd | test-postfix.ts | ~80% |
| ExecutorContract | 5 tests | None | None | Not spec'd | test-postfix.ts | ~75% |
| Governance | None | None | None | Not spec'd | Not deployed | 0% |
| **Backend API** | Jest (~10) | None | None | N/A | None | Unknown |
| **Frontend** | Vitest (1 spec) | None | None | N/A | None | Minimal |
| **Auth** | None | None | None | N/A | None | 0% |

### Blind Spots

| Area | Gap |
|---|---|
| Real CoFHE TaskManager integration | All tests use MockLendingPool / MockTaskManager |
| Pyth oracle integration beyond mock | PriceOracle tests use SimplePythMock |
| Live liquidation with zk-proof | liquidateWithProof always mocked (return true) |
| Cross-contract reentrancy (A→B→A) | Only single-contract nonReentrant tested |
| Full AI strategy lifecycle (prompt→review→on-chain) | Zero automated tests |
| Auth flow end-to-end | Zero Jest tests for auth module |
| DB layer (Supabase repository impls) | Zero tests — no testcontainers/mock |
| Event indexer with real RPC | Spec tests are minimal (2 blocks) |
| Uniswap V3 swap integration | Only input validation tested |
| Governance on testnet | Not deployed on Arbitrum Sepolia |
| Cross-chain (Base Sepolia) | Minimal deployment record, no tests |
| FHESafeMath128 overflow properties | No formal equivalence verification |
| CoFHE ZK proof of equality (MC-035) | Planned post-MVP |

---

## 7. Red Team Findings Summary

22 findings from adversarial probes:

| Area | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| Config/Env | 0 | 2 | 3 | 1 |
| Auth/Nonce | 1 | 0 | 3 | 1 |
| API/Throttler | 0 | 1 | 2 | 0 |
| Database | 1 | 1 | 1 | 0 |
| Monitoring | 0 | 4 | 1 | 0 |
| CI/CD | 0 | 1 | 2 | 1 |
| **Total** | **3** | **7** | **10** | **2** |

### Top 3 by blast radius:
1. **AUTH-001** (CRITICAL): In-memory nonce Map = login broken under multi-instance scaling
2. **DB-001** (CRITICAL): No migration DDL for 13/16 tables = schema unrecoverable
3. **API-001** (HIGH): /health throttled at 20/60s = Railway kills healthy containers

---

## 8. Contract Anomalies (Smart Contract `[!]`)

| File | Finding | Severity |
|---|---|---|
| FheForgeBase.sol | `_verifyEquality` runs after token transfers in 5/13 sites — dual input mismatch vector | CRITICAL |
| StrategyVault.sol | `getDepositedAmount` returns plaintext uint256 — privacy defeat | CRITICAL |
| FheForgeBase.sol | `requestLiquidityCheck` no ACL — anyone can allowPublic any user data | CRITICAL |
| FheForgeGovernor.sol | `proposalThreshold()` constant overrides GovernorSettings — setter is dead code | HIGH |
| FheForgeToken.sol | Owner can mint unlimited tokens — no cap, no renounceOwnership in deploy | HIGH |
| PriceOracle.sol | `updatePriceFeeds` marks ALL tokens fresh, not just updated ones | MEDIUM |
| FheForgeComposer.sol | `borrowFor` has no LTV check — vault LTV may differ from pool LTV | HIGH |
| ExecutorContract.sol | Single owner, no timelock, no multisig | HIGH |
| LendingPool.sol | Events emit encrypted amounts but plain amounts leaked in prior findings (P-HIGH-6) | HIGH |
| StrategyVault.sol | `closePosition` partial close has double-withdrawal vector | HIGH |
| Certora specs | 4 spec files, 18 rules — 1 passing, 5 known violations, 10 assert-true placeholders | MEDIUM |
| Schema | No CVL for FheForgeComposer or SwapRouter balance invariants | MEDIUM |

---

## 9. What Remains Unknown

- **CoFHE TaskManager real behavior**: All testing uses MockTaskManager. Actual FHE.eq, verifyDecryptResult, and threshold signing behavior against deployed Arbitrum Sepolia coprocessor is unknown.
- **Pyth Oracle integration health**: PriceOracle tests use SimplePythMock. Real Pyth Hermes feed latency, staleness thresholds, and price deviation across assets on Arbitrum Sepolia are untested.
- **Governance contract deployment on testnet**: 421614.json has no governance addresses. Governance only tested on localhost. Testnet deployment procedure and interaction testing are pending.
- **Base Sepolia deployment state**: deployment/84532.json is 243 bytes of minimal record. The cross-chain deployment status (deployed? partially? planned?) is unclear.
- **13 missing DB table DDL origin**: These tables exist in the deployed Supabase project but have no migration files. Likely created manually or via Supabase UI. Not reproducible.
- **Strategy execution on-chain mechanism**: Backend has DefiStrategyExecution entity with extrinsic_hash but no on-chain tx submission code visible. Presumably frontend/wallet submits the tx directly.
- **Uniswap V3 swap integration**: SwapRouter has Uniswap V3 callback interface but only input validation is tested. Whether real swaps work on Arbitrum Sepolia Uniswap deployments is unknown.

---

## 10. Recommendations

### Immediate (blocking issues)

1. **Gate `_verifyEquality` before token transfers** — all 13 call sites. CRITICAL dual-input vulnerability. Certora rules already fail on this — implement the fix.
2. **Replace in-memory nonce Map with Redis** — auth breaks under multi-instance scaling on Railway (AUTH-001).
3. **Write migration DDL for 13/16 DB tables** — catastrophic schema loss on Supabase project recreation (DB-001).
4. **Exempt /health and /metrics from global 20/60s throttle** — Railway healthchecks and Prometheus scraping break (API-001).

### Short-term (HIGH risk)

5. **Fix `getDepositedAmount` plaintext leak** — defeats FHE privacy guarantee. Return encrypted handle or ACL-gate.
6. **Add ACL to `requestLiquidityCheck`** — anyone can permanently expose any user's balances via allowPublic.
7. **Add per-index.json Grafana dashboard provisioning** — 4 dashboard JSON files are dead code.
8. **Remove or fix 3 system alert rules** — node_exporter metrics never scraped on Railway, rules never fire.
9. **Implement event indexer catch-up / backfill** — >30min downtime permanently loses events (Arbitrum Sepolia ~128 block retention).
10. **Add Auth module Jest tests** — zero test coverage on critical auth flow.

### Medium-term (MEDIUM risk)

11. Governance parameter fix — proposalThreshold constant vs GovernorSettings.setProposalThreshold dead code.
12. Remove CORS dev fallback in production (ALLOWED_ORIGINS).
13. Add deploy approval gate (GitHub environment with required reviewers).
14. Implement token revocation / logout endpoint.
15. Add periodic nonce store cleanup to prevent memory leak.
16. Add Supabase DB indexes on all foreign key columns.
17. Fix Alertmanager SMTP defaults so monitoring stack is bootable.
18. Fix CI env var name (FHENIX_RPC → COFHE_RPC).
19. Consolidate duplicate PRIVATE_KEY/TESTER_PRIVATE_KEY in CI.

### Low-priority

20. Filename typo fix: `stategies.controller.ts` → `strategies.controller.ts`.
21. Extend event indexer to cover SwapRouter, Composer, Registry events.
22. Add strategy workflow Hash cross-check between backend DB and on-chain StrategyRegistry.
23. Lock down Swagger docs (/api/docs) in production.
24. Remove or document the 3 side-project directories at repo root (rfq-demo, poc-*).
