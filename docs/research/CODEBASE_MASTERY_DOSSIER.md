# CODEBASE MASTERY DOSSIER

| Field                                            | Value                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| generated_at                                     | 2026-04-25T22:36+01:00                                                     |
| repository                                       | /home/eya/archives/refactor/refactor-FheForge-work                         |
| working branch                                   | clean (with ~200 uncommitted modifications)                                |
| total_files (excl. node_modules/build artifacts) | 535                                                                        |
| verified [✓]                                     | 484                                                                        |
| anomalous [!]                                    | 24                                                                         |
| inert [∅]                                        | 27                                                                         |
| unvisited [ ] / in-progress [~]                  | 0                                                                          |
| orchestrator                                     | Devin (direct execution; 5 spawned subagents all rate-limited mid-Phase-2) |

> **HEADLINE FINDING.** This codebase ships **two parallel and partially conflicting implementations** of the same product:
>
> 1. A working "FheForge" core (StrategyVault / LendingPool / SwapRouter / StrategyRegistry) with real CoFHE integration on Arbitrum Sepolia.
> 2. A "Privara" / "Reineira" parallel module (PrivaraStrategyVault / PrivaraPaymentRouter / PrivaraEscrowManager / ZKVerifier on chain; an entire NestJS module + UI layer in the app) that is **largely stub-ware** — fake encryption, fake ZK verification, fake authentication, and a permit flow whose two halves do not connect.
>
> The README documents (1). The Privara/Reineira docs document (2). They are deployed and called from the same UI. The boundary between them is undocumented and the security posture of (2) collapses the security posture of (1) for any user routed through the Privara endpoints.

---

## 0. TOOL HARNESS

```
shell_execution:        bash 5.2.21 (GNU/Linux WSL2)
file_system:            full read+write under cwd
git:                    2.x available; ls-files / log / diff / status all working
network_access:         github.com 200 OK, registry.npmjs.org 200 OK

language_runtimes:
  node:                 v24.15.0 (.nvmrc requests "20" — drift)
  npm:                  11.12.1
  pnpm:                 10.33.0
  yarn:                 1.22.22
  bun:                  1.3.13      (the project's actual chosen runtime; bun.lock present)
  python3:              3.12.3
  uv:                   0.11.7
  rustc/cargo:          1.95.0      (not used by this project)
  go:                   1.22.2      (not used by this project)
  java:                 absent

solidity_toolchain:
  solc:                 0.8.34      (project pins 0.8.25 in hardhat.config.ts:5)
  forge / cast / anvil: 1.5.1-stable (NOT used; project is Hardhat)
  hardhat:              installed via contracts/node_modules

static_analysis:
  slither:              0.11.5      (USED — produced 84 findings against artifacts)
  semgrep:              available    (USED — 3 INFO findings)
  solhint:              available    (USED — 32 gas warnings)
  eslint (next lint):   USED         (UI: 57 errors, 26 warnings)
  eslint (backend):     USED         (393 problems: 392 errors, 1 warning)
  tsc strict:           USED         (UI: 3 errors, backend: 15 errors, contracts: 0 errors)
  prettier --check:     USED         (clean — last commit was a prettier sweep)
  shellcheck:           USED         (clean for the 2 root .sh files)
  mythril:              not installed
  bandit / ruff / mypy: available but no Python source files in scope

build_tools:
  hardhat compile:      passes ("Nothing to compile" after artifacts present)
  forge build:          fails on remappings — irrelevant; project uses Hardhat
  next build:           not exercised in this run
  nest build:           not exercised in this run

test_runners:
  hardhat test:         not exercised in this run (CI runs them)
  vitest:               not exercised in this run
  jest:                 not exercised in this run
  test-hardened.js:     last-run snapshot in test-hardened.jsonl (live arb-sepolia)
  test-sharp.js:        last-run snapshot in test-sharp.jsonl (live arb-sepolia)
```

Tools NOT available that would have been useful: `mythril`, `echidna`, contract gas snapshots, dynamic E2E browser tests.

---

## 1. CODEBASE PROFILE

```
primary_language(s):          TypeScript (.ts: 237 files, .tsx: 145 files)
secondary_language(s):        Solidity (.sol: 15), JavaScript (.js: 13), SQL (.sql: 5),
                              YAML (.yml: 8), Markdown (.md: 37), shell (.sh: 2)
runtime_or_platform:
  frontend                    Next.js 14.2.35 App Router on Vercel
  backend                     NestJS 11 on Railway (Nixpacks builder)
  contracts                   Solidity 0.8.25, EVM Cancun, deployed Arb Sepolia 421614
  package mgr / monorepo      Bun 1.3 workspaces (ui, backend/apps, contracts)

paradigm:                     Monorepo / DDD-flavored backend / smart-contract DeFi
                              with two coexisting product implementations (FheForge core
                              + Privara/Reineira parallel module)

detected_layers (file-evidence each):
  contract     15 .sol  contracts/{contracts,interfaces}/*.sol
  server      126 .ts   backend/apps/src/**
  data         33 SQL+repos  schema.sql, backend/apps/migrations/*.sql, *repository.impl.ts
  ui          204 mixed  ui/{app,components,hooks,services,providers,lib,utils}/**
  test         45 mixed  contracts/{test,scripts/test-*}, ui/__tests__, *.spec.ts
  infra        24 mixed  .github/workflows/*, monitoring/, logging/, deploy scripts
  config       51 mixed  package.json, tsconfig*, hardhat.config.ts, .env*, *.json
  docs         33 .md    root + docs/ + READMEs
  inert         4 .bak/.lock/.tsbuildinfo

host_environment:
  Frontend:                   Vercel (https://ui-chi-ashy.vercel.app per README)
  Backend:                    Railway (https://fheforge-api-production.up.railway.app)
  Chain:                      Arbitrum Sepolia 421614 (CoFHE TaskManager live)
                              + Base Sepolia 84532 (configured but unused)
                              + Hardhat 31337 (local; recorded in deployments/)

entry_points:
  ui/app/page.tsx:11          home — strategy list + featured
  ui/app/prompt/page.tsx      → ui/app/prompt/PromptPage.tsx — AI prompt entry
  ui/app/builder/page.tsx:48  visual ReactFlow strategy builder (dynamic SSR-off)
  ui/app/strategy/page.tsx    strategy listing
  ui/app/strategy/[id]/page.tsx  strategy detail
  ui/app/strategy-review/page.tsx  strategy review
  ui/app/api/                 (no API route handlers — empty/unused; ui/api/ also unused)
  backend/apps/src/main.ts:7  bootstrap()
  contracts/scripts/deploy.ts:5  main() — deploys 4 core contracts (no Privara/ZKVerifier)
  contracts/scripts/deploy-privara.js  + deploy-privara-contracts.ts — separate deploys

build_system:
  Root scripts (package.json):     bun run dev:ui, dev:backend, build:ui, build:backend, test:contracts
  ui/package.json:                 next build / next dev / vitest / next lint
  backend/apps/package.json:       nest start / nest build / jest / migration:run
  contracts/package.json:          npx hardhat run scripts/deploy.ts --network arb-sepolia, etc.

test_frameworks (file-backed):
  contracts/test/*.test.ts             5 hardhat-chai test files (Privara* + StrategyVault + ZKVerifier)
  contracts/test/integration/full-flow.test.ts  integration
  contracts/scripts/test-hardened.js   523 lines, runs against arb-sepolia (test-hardened.jsonl is run record)
  contracts/scripts/test-sharp.js      447 lines, same pattern (test-sharp.jsonl is run record)
  contracts/scripts/security-test.ts   346 lines (referenced in ci-cd.yml line 131)
  contracts/scripts/performance-test.ts 247 lines (referenced in ci-cd.yml line 330)
  ui/__tests__/*                       5 top-level "adversarial" / "logic" / "ux.critical" tests
  ui/__tests__/integration/*           privara-error-handling, privara-flow, privara-network-switching
  ui/{components,hooks,services,lib,types,app/builder/components}/__tests__/*  scattered unit tests
  backend/apps/src/privara/__tests__/  e2e + mocks + repo specs (the only backend tests)
  backend/apps/test/                   contains jest-e2e.json wiring

config_surface:
  .env files (PLAINTEXT KEYS PRESENT — see Risk Register R-001 through R-005):
    ./.wallet-secret.json                     local secret JSON (gitignored)
    ./WALLET_CREDENTIALS.txt                  TRACKED IN GIT (mnemonic + private key)
    ./.env.production.template                template only, no values
    ./backend/apps/.env.development           live, contains PRIVATE_KEY (gitignored)
    ./contracts/.env                          live, contains PRIVATE_KEY (gitignored)
    ./contracts/.env.deploy                   live, RPC URLs only
    ./ui/.env.local                           live, NEXT_PUBLIC_* contract addresses (gitignored)
  YAML/TOML configs:
    .github/workflows/{ci.yml,ci-cd.yml}      two CI pipelines (ci-cd.yml is broken — see R-008)
    monitoring/prometheus.yml + alerts/alerts.yml + alertmanager.yml + docker-compose.yml
    logging/loki-config.yml + promtail-config.yml
    backend/apps/{railway.json,nixpacks.toml}
    ui/vercel.json
  ABI configs:
    ui/abis/{LendingPool,StrategyVault,StrategyRegistry,SwapRouter}.json (4 only — no Privara ABIs)

dependency_count (declared, ignoring transitive):
  ui:        ~60 deps + 17 dev (largest by far)
  backend:   ~20 deps + 17 dev
  contracts: ~3 deps + 14 dev

repo_age_and_activity (git log):
  first_commit:        2026-04-20 (the 4 commits all happened on or before 2026-04-25)
  last_commit:         2026-04-25 "style: format all files with prettier"
  commit_count:        4 commits total in main history
  current branch:      "clean" with 191 modified + 1 deleted + 1 untracked files
                       — significant uncommitted work in this refactor copy

notable_patterns:
  - CoFHE encrypted DeFi (euint128/euint16/euint8 throughout)
  - FHE ACL via FHE.allowThis / allowSender / allowTransient
  - Plaintext+encrypted dual-bookkeeping (LendingPool.plainSupplyBalances + supplyBalances)
  - Reactflow node-based strategy DSL (ui/lib/defi-workflow-builder.ts, defi-node-factory.ts)
  - Gemini-driven NL → strategy step parser (gemini-ai.service.ts)
  - DDD layout in backend: each module has application/domain/infrastructure/interfaces
  - Two wallet libs declared (RainbowKit + Privy) but only injected() used (dead deps)
  - Two query libs declared (React Query + SWR) — both wired (overlap)

red_flags_on_first_pass:
  - WALLET_CREDENTIALS.txt is git-tracked with a private key + 12-word mnemonic
  - 4 plaintext private keys hardcoded in contracts/scripts/test-hardened.js:10-14
  - WalletAuthGuard accepts an unsigned x-wallet-address header as authentication
  - PrivaraService is mock-data — encryptedAmount = "encrypted_" + plaintextAmount
  - ZKVerifier._verifyProofCircuit returns true for any non-empty proof
  - SwapRouter.submitSwapIntentTrivial is callable on mainnet with plaintext amounts
  - ui/hooks/use-fhe-vault.ts:162 calls LendingPool.borrow which doesn't exist
  - Three different "source of truth" address sets disagree (README vs deployments/* vs test-hardened.js)
  - ci-cd.yml calls npm scripts (lint:type-check) that don't exist in either package.json
```

---

## 2. ARCHITECTURE MAP

```
                                         BROWSER (user)
                                              │
                                  HTTPS / WebSocket / window.ethereum
                                              │
                       ┌──────────────────────┴──────────────────────┐
                       │                                              │
                FRONTEND (Vercel)                              MetaMask / EOA
              ui/   Next.js 14 App Router                            │
                       │                                              │
        ┌──────────────┼──────────────────┐                          │
        │              │                  │                          │
   AppProvider   CofheConnector     UserProvider                     │
   wagmi+RQ      @cofhe/sdk web    SWR for backend                   │
        │              │                  │                          │
        │              │                  └─── /api/* → BACKEND      │
        │              │                                  │          │
        │              └─── encryptInputs / permits      │          │
        │                                                │          │
        │              direct on-chain via wagmi useWriteContract    │
        │              (uses ui/abis/{Vault,Pool,Router,Registry}.json)
        │                                                │          │
        ▼                                                ▼          ▼
                                            BACKEND (Railway)   ARBITRUM SEPOLIA
                              backend/apps/  NestJS 11           chainId 421614
                                            │                          │
                          ┌────────────┬────┼────────────┬────────────┐│
                          │            │    │            │             ││
                    /strategies   /activities  /api/privara   /defi-strategies/*
                          │            │    │            │             ││
                          ▼            ▼    ▼            ▼             ▼▼
                       Supabase (PostgreSQL)        ZKVerifier (STUB)  StrategyVault
                       schema.sql + migrations/     PrivaraStrategyVault LendingPool
                                                    PrivaraPaymentRouter SwapRouter
                                                    PrivaraEscrowManager StrategyRegistry
                                                    └──────┬──────┘     └──────┬──────┘
                                                       (Privara: deployed     (FheForge: deployed
                                                        only to local/        Arb Sepolia per
                                                        hardhat per           README)
                                                        deployments/*.json
                                                        — no testnet record)
                                                              │
                                            external (per README + .env): https://api.reineira.xyz
                                                          (referenced by REINEIRA_NETWORK env;
                                                           SDK never actually initialized in
                                                           PrivaraService — see R-009)
```

Notable architectural facts:

- The UI talks DIRECTLY to chain for the FheForge core (Vault/Pool/Router/Registry) via wagmi `useWriteContract`. The backend is bypassed for these flows.
- The UI talks to the BACKEND for `/api/privara/*` confidential operations, but the backend's PrivaraService never actually goes on-chain — it returns mock objects (R-009).
- There are no Privara contract ABIs in `ui/abis/` (only the 4 FheForge core ABIs). The UI cannot call Privara contracts directly even if it wanted to.
- The backend's only direct external integrations are Supabase (PostgreSQL via `@supabase/supabase-js`) and Gemini (`@google/generative-ai`). Backend never sends a transaction.
- `ui/abis/` is populated by `contracts/scripts/deploy.ts:39-43` — running a deploy refreshes them. There is no Privara ABI export step.

---

## 3. FULL FILE MANIFEST

A complete, layer-sorted manifest with status, role, and agent owner is maintained at `/tmp/recon-fheforge/manifest.tsv` (535 entries).

Counts by status:

| Status    | Count | Meaning                                                                |
| --------- | ----- | ---------------------------------------------------------------------- |
| [✓]       | 484   | content-verified or fully tooled                                       |
| [!]       | 24    | anomalous — every entry has a Risk Register row                        |
| [∅]       | 27    | inert (lockfiles, .bak, generated build outputs, static binary assets) |
| [ ] / [~] | 0     | none                                                                   |

Counts by layer (matches the ARCHITECTURE MAP):

| Layer    | Files | Notes                                                                                                                                                         |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ui       | 204   | Next.js + components + hooks + services + providers                                                                                                           |
| server   | 126   | NestJS modules (10 modules: activities, ai-strategy-builder, common, cron-job, defi_modules, defi_strategies, defi_token, privara, shared, strategies, users) |
| config   | 51    | tsconfigs, package.jsons, env files, eslint configs                                                                                                           |
| test     | 45    | unit/integration/e2e/security tests                                                                                                                           |
| docs     | 33    | root .md + docs/\* — heavy on Privara/Reineira planning docs                                                                                                  |
| data     | 33    | schema.sql, migrations/, \*.repository.impl.ts                                                                                                                |
| infra    | 24    | .github/, monitoring/, logging/, vercel.json, railway.json, deploy scripts                                                                                    |
| contract | 15    | 11 .sol + 4 interfaces                                                                                                                                        |
| inert    | 4     | bun.lock, build.log, \*.bak, tsconfig.tsbuildinfo                                                                                                             |

Anomalous file index (every `[!]` entry has a Risk Register row in §8):

| Path                                                                | Anomaly tag                                                                                    | Risk ID             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------- |
| `WALLET_CREDENTIALS.txt`                                            | tracked-in-git, plaintext private key + mnemonic                                               | R-001               |
| `.wallet-secret.json`                                               | plaintext private key on disk                                                                  | R-002               |
| `backend/apps/.env.development`                                     | live PRIVATE_KEY on disk                                                                       | R-003               |
| `contracts/.env`                                                    | live PRIVATE_KEY on disk                                                                       | R-004               |
| `contracts/scripts/test-hardened.js`                                | 4 plaintext private keys hardcoded lines 10-14                                                 | R-005               |
| `contracts/scripts/test-hardened.js.bak`                            | leftover backup                                                                                | R-018               |
| `contracts/scripts/test-sharp.js.bak`                               | leftover backup                                                                                | R-018               |
| `contracts/contracts/ZKVerifier.sol`                                | `_verifyProofCircuit` returns true for any non-empty proof                                     | R-006               |
| `contracts/contracts/PrivaraStrategyVault.sol`                      | broken permit flow + total-vs-user balance bug                                                 | R-010, R-011, R-012 |
| `contracts/contracts/PrivaraPaymentRouter.sol`                      | compliance uses wrong amount; swap is no-op                                                    | R-013, R-014        |
| `contracts/contracts/SwapRouter.sol`                                | `submitSwapIntentTrivial` callable on mainnet; minOut FHE check is dead code                   | R-015, R-016        |
| `contracts/contracts/StrategyRegistry.sol`                          | `lastDailyReset`/`dailyVolume` declared as VULN-FIX but never used                             | R-017               |
| `contracts/contracts/StrategyVault.sol`                             | `closePosition` debt check is dead code (line 196 condition can't fire)                        | R-019               |
| `contracts/contracts/TestHelper.sol`                                | wraps real contracts with trivial encryption; deployable                                       | R-020               |
| `backend/apps/src/privara/application/privara.service.ts`           | every method returns fake data; SDK never initialized                                          | R-009               |
| `backend/apps/src/privara/guards/wallet-auth.guard.ts`              | unsigned `x-wallet-address` header trusted as auth                                             | R-007               |
| `backend/apps/src/privara/guards/privara-rate-limit.guard.ts`       | in-memory Map — bypassed by horizontal scaling                                                 | R-021               |
| `backend/apps/src/privara/infrastructure/privara.config.service.ts` | hardcoded local-hardhat addresses for "LOCALHOST" + "TESTNET" networks                         | R-022               |
| `ui/hooks/use-fhe-vault.ts`                                         | calls `LendingPool.borrow` — function does not exist on contract                               | R-023               |
| `ui/providers/fhenix-provider.tsx`                                  | CoFHE SDK cast fails strict TS (TS2352)                                                        | R-024               |
| `ui/hooks/use-privara.ts`                                           | ReineiraNetwork vs Network type mismatch (TS2322)                                              | R-025               |
| `ui/app/strategy/[id]/components/strategy-flow.tsx`                 | TS2554: 2 args where 0 expected                                                                | R-026               |
| `backend/apps/src/cron-job/application/cron-manager.service.ts`     | DELETED in working tree but `cron-job/` dir + jobs remain                                      | R-027               |
| `.github/workflows/ci-cd.yml`                                       | calls `npm run lint`, `type-check`, `test:e2e` — type-check is undefined in both package.jsons | R-008               |
| `CODEBASE_MASTERY_DOSSIER.md`                                       | (this file — being overwritten with current evidence)                                          | —                   |

---

## 4. LAYER REPORTS

> Note: All five subagents (Contract / Server / UI / Data / Test+Infra) hit rate limits before completing.
> The orchestrator (Devin) executed the layer dives directly via targeted reads + tool sweep.
> Where I read a file end-to-end, I cite line numbers. Where I did not, I cite the grep evidence.

### 4.1 CONTRACT LAYER REPORT

**Files claimed:** 15 (11 contracts + 4 interfaces) · **Verified:** 15 · **Anomalous:** 8

#### Per-contract summary

**`contracts/contracts/StrategyVault.sol`** (250 lines, ReentrancyGuard, FHE)

- Inline interface `IStrategyRegistry` declared at lines 23-37 (slither's "missing-inheritance" flag).
- State (private unless noted): `mapping(address=>Position) positions` (49-56), `mapping(address=>bool) hasPosition` (61, public), `collateralTokens`, `depositedAmounts`, `address public registry` (67), `euint128 _zero` (69).
- Custom errors lines 74-78.
- External: `openPosition(token, amount, encColl, encDebt, encApy, encLoop, strategyId)` line 96 (nonReentrant), `addCollateral(token, amount, encAmount)` line 150 (nonReentrant), `closePosition(uint256)` line 180 (nonReentrant), `getCollateral()` line 221 (returns euint128, mutates via FHE.allowSender), `getPositionMeta()` line 232 (view), `getDepositedAmount()` line 248 (view).
- FHE pattern: every encrypted mutation is followed by `FHE.allowThis` + `FHE.allowSender`. `FHE.allowTransient` is used at 140, 203 to grant the registry one-shot read access.
- **Anomaly R-019**: `closePosition` at lines 186-199 computes `ebool isDebtZero = FHE.eq(positions[msg.sender].debt, _zero)` and stores it (lines 190-191), but **does not use it**. The actual gate at line 196-199 is `if (FHE.isInitialized(positions[msg.sender].debt) && collateralAmount > depositedAmounts[msg.sender]) revert OutstandingDebt();` — but `collateralAmount > depositedAmounts[msg.sender]` was already rejected at line 182. The branch is dead. The README claim "closePosition — no encrypted debt check before close" is **TRUE**.
- **Note on README claim "addCollateral missing nonReentrant"**: refuted — line 154 has `external nonReentrant`. README is outdated on this point.

**`contracts/contracts/LendingPool.sol`** (212 lines, ReentrancyGuard, FHE)

- 4 mappings: `supplyBalances` (encrypted), `borrowBalances` (encrypted), `plainSupplyBalances` (uint256), `plainBorrowBalances` (uint256). The dual-bookkeeping is the security model — encrypted is for confidentiality, plaintext is for transfer gating.
- **No `borrow` function exists.** Slither/grep confirm. Only `checkLtvAndBorrow` (line 79). README's "Known Issue: LendingPool.borrow() — no collateral check" is misleading: the function `borrow()` was never present.
- `supply` (49), `checkLtvAndBorrow` (79, nonReentrant), `repay` (132, nonReentrant), `withdraw` (159, nonReentrant), `getSupplyBalance` (184), `getBorrowBalance` (197), `getPlainSupplyBalance` (210, view).
- `checkLtvAndBorrow` line 92: `if (plainSupplyBalances[collateralToken][msg.sender] == 0) revert InsufficientCollateral();` — collateral check is **enforced**, refuting the README claim.
- The plaintext-vs-encrypted divergence on line 105 (`actual = FHE.select(FHE.lte(lhs, rhs), requested, _zero)`) is benign because the encrypted state writes `actual` (which is 0 or `requested`), so the encrypted view stays consistent. However, the encrypted state is updated on EVERY call (line 114 always assigns `newBorrow`) regardless of whether the plaintext transfer happens (line 119 conditional). If the plaintext check fails, the encrypted balance is incremented but no tokens move — silently accumulating phantom encrypted debt. This is a **real bug** (R-028).

**`contracts/contracts/SwapRouter.sol`** (252 lines, NO ReentrancyGuard, FHE)

- `executor` is `address public` (line 32), settable only in constructor.
- **R-016** lines 181-192: `executeIntent` computes `ebool isSufficient = FHE.gte(outputEnc, i.minAmountOut)` and stores it into a local. The result is never branched on. The comment on line 190-191 says "we rely on the executor to only call this when the output meets the minimum" — i.e., **the on-chain minOut enforcement is performative**. A malicious or compromised executor can give the user any amount.
- **R-015** lines 211-252: `submitSwapIntentTrivial` is a public `external` function that takes plaintext amounts (`uint256 amountIn, uint256 minAmountOut`) and trivially encrypts them. There is no modifier preventing this from being called on a deployed mainnet/testnet instance. Anyone can submit non-confidential intents, fully defeating the FHE privacy promise for that intent.
- Slither HIGH `arbitrary-send-erc20` line 198: `IERC20(tokenOut).safeTransferFrom(executor,user,outputAmount)`. By design (executor pre-approves the contract) but compromise of the executor allows draining its approvals.
- README confirmed: "Router.executor is EOA — needs dedicated executor contract" — `deploy.ts:31` does `Router.deploy(deployer.address)`, which sets the deployer EOA as executor.

**`contracts/contracts/StrategyRegistry.sol`** (183 lines)

- `decrementTvl` lines 133-157 has the underflow protection (FHE.lte + FHE.select). README claim "Registry.decrementTvl — FHE.sub wraps on underflow" is **FALSE / OUTDATED** — the current code clamps to zero.
- **R-017** unused state: `mapping(address=>uint256) lastDailyReset` (line 41) and `dailyVolume` (line 43) are declared with VULN-FIX comments but never read or written anywhere. Slither flagged both.
- `setVault` line 75 enforces single-set (`vaultAddress != address(0)` revert) — good. But lacks zero-check on `v` (slither low).
- `owner` is set in constructor (line 66) and there is no transferOwnership — owner is permanent, but `setVault` is one-shot, so once vault is set the owner has no further privileges except being the deployer.

**`contracts/contracts/ZKVerifier.sol`** (334 lines, OZ Ownable + IZKVerifier, **STUB**)

- **R-006**: `_verifyProofCircuit` (line 316-334): "TEMPORARY STUB. ... DO NOT deploy to production without replacing this function." Returns `true` for any proof of nonzero length. The verifier's entire raison d'être is missing.
- Slither HIGH `encode-packed-collision` at lines 79, 118, 159: `keccak256(abi.encodePacked(proof, publicInputs[, transactionHash]))` — multiple dynamic args; collisions possible by re-arranging bytes.
- `getProofsForTransaction` (253) and `getVerificationCount` (267) are explicitly TEMPORARY stubs returning empty/zero.
- IZKVerifier interface lines 141 (in `interfaces/IZKVerifier.sol`) has return param named `isVerifier` shadowing the function name — slither LOW `shadowing-local`.

**`contracts/contracts/PrivaraStrategyVault.sol`** (479 lines, ReentrancyGuard + Ownable + IPrivaraStrategyVault)

- **R-010** lines 197-228 `confidentialWithdraw`: validates `amount > totalDeposited[strategyId]` (line 202) — but `totalDeposited` is the **strategy-wide** total, not the user's own. Combined with `delete confidentialPositions[msg.sender]` and **never decrementing** the per-user encrypted collateral, this means user A can withdraw against user B's deposits in the same strategy.
- **R-011** lines 243-283 `createPermit`: returns `abi.encodePacked(permitHash)` as the "signature" (line 279). The comment (273) says "Filled by off-chain signing" but the function returns the hash, not a signature. Then `usePermit` line 321 calls `ECDSA.recover(permitHash.toEthSignedMessageHash(), signature)` expecting a real ECDSA signature. **The two halves do not connect** — calling createPermit then usePermit with the returned bytes will fail at `recoveredSigner != owner` because the "signature" is just a hash. The user must sign off-chain with their wallet, but no UI flow does this for `usePermit`.
- **R-012** lines 342-358 `getConfidentialBalance`: returns `(new bytes(0), totalDeposited[strategyId])` — leaks the entire strategy-wide TVL as the "plaintext balance" of a single user, while returning empty bytes for the encrypted balance. Confidentiality is not preserved.
- `setRegistry` line 477: lacks zero-check (slither LOW).

**`contracts/contracts/PrivaraPaymentRouter.sol`** (469 lines, Ownable + IPrivaraPaymentRouter)

- **R-013** lines 242-262 `checkSwapCompliance`: uses `approvedMinAmountOut` AS the compliance amount (line 255: `uint256 amount = approvedMinAmountOut;`). The actual swap amount (encrypted) is unknown to compliance because there is no on-chain decrypt. The comment says "VULN-FIX" but this just trades one wrong number for another.
- **R-014** lines 163-182 `executeConfidentialSwap`: comment line 177-178 says "Perform swap logic here (would integrate with DEX). For now, just mark as executed." The function takes funds (no, actually it doesn't even transfer anything), marks `intent.executed = true`, and emits an event. **The swap does not swap.**
- Lines 282-292 `swapToStablecoin` and 320-337 `swapFromStablecoin` call `checkSwapCompliance(intentId, 1)` — passing `approvedMinAmountOut=1` (a placeholder to satisfy the non-zero check). Compliance is fully bypassed for these helper paths.
- Slither LOW: missing-zero-check on `setExecutor`, `setEmergencyWithdrawer`, constructor `executor_`. Owner-controlled `setUserCompliance` and `setTokenCompliance` mean the protocol owner has full whitelist/KYC discretion.

**`contracts/contracts/PrivaraEscrowManager.sol`** (389 lines, ReentrancyGuard + Ownable + IPrivaraEscrowManager)

- Multi-sig escrow with time-locked release. `requiredApprovals` set to `approvers.length` (line 149) — i.e., unanimous approval required. Is this intended? The constants say `MAX_APPROVERS = 10` (line 43) implying multiple are expected.
- `releaseEscrow` and `releaseAfterTime` are functionally identical (both check `block.timestamp < releaseTime` and require approval threshold). `releaseAfterTime` adds nothing — appears to be dead code.
- Cosmetic typo line 52: `emergencyWithdrawnals` (should be `emergencyWithdrawals`).
- `emergencyWithdraw` line 285 transfers all funds to the (mutable) `emergencyWithdrawer`. No bond, no return path. This is a centralization risk inherent to the design.

**`contracts/contracts/TestHelper.sol`** (366 lines, **deployable test helper**)

- **R-020**: this contract wraps real Vault/Pool/Router calls with `FHE.asEuint128(plaintext_value)` (lines 156, 179, 194, 211, 237, 240, 275, 278, 281, 284, 311) — i.e., **trivial encryption**. The comment (line 134-136) acknowledges this is not confidential. But the contract is in `contracts/contracts/` next to production contracts, has its `.json` artifact compiled (`contracts/artifacts/contracts/TestHelper.sol/TestHelper.json`), and `deploy-testhelper.js` exists in `contracts/scripts/`. If deployed alongside production, it provides a public bypass of the FHE confidentiality story for any signer.
- The `_toIn128` / `_toIn16` / `_toIn8` helpers (lines 324-365) construct `InEuint*` calldata structs with `signature: bytes("")`. The README claim "ZkVerifier rejects any unsigned FHE input — no dummy ciphertext attacks" depends on the off-chain CoFHE TaskManager validating signatures, not the on-chain ZKVerifier (which is itself a stub). Whether this actually rejects empty signatures is a **runtime** property of the TaskManager and cannot be verified from this codebase alone (open question O-1).

**`contracts/contracts/MaliciousReentrantERC20.sol`** (133 lines)

- Test-only attack contract. Re-enters `vault.openPosition` from `transferFrom`. The reentrancy is then expected to be blocked by `nonReentrant` on `openPosition` (StrategyVault.sol:104). Used by tests to verify guard. Not deployed to production paths.

**`contracts/contracts/MockERC20.sol`** (28 lines): unrestricted public `mint(to, amount)` — for test environments only. Mints 1M to deployer in constructor.

**Interfaces** (`contracts/interfaces/I{ZKVerifier,PrivaraEscrowManager,PrivaraPaymentRouter,PrivaraStrategyVault}.sol`): event declarations + function signatures matching the implementations. `IZKVerifier.isVerifier(address)` named return parameter shadows function name (slither LOW).

#### Cross-contract relationships

```
StrategyVault ──IStrategyRegistry──> StrategyRegistry
   (writes)         (interface)         (incrementTvl/decrementTvl)
   uses FHE.allowTransient to grant registry one-shot read

StrategyRegistry: vault address set via setVault(); only msg.sender == vaultAddress can mutate TVL.

LendingPool: standalone — no inter-contract calls.

SwapRouter: standalone — has external `executor` EOA that transfers tokenOut to user via safeTransferFrom.

PrivaraStrategyVault ──> registry (set via setRegistry, but never CALLED in this contract — registry is a setter-only address)
PrivaraPaymentRouter: standalone, owner-controlled compliance lists.
PrivaraEscrowManager: standalone, owner-controlled emergencyWithdrawer.
ZKVerifier: standalone.

CRITICAL: The Privara contracts (StrategyVault/PaymentRouter/EscrowManager/ZKVerifier)
have NO call relationships with each other. They are 4 independent contracts
that the design implies should compose, but there is zero code linking them.
```

#### Access-control matrix

| Contract                | Owner role                    | Restricted functions                                                                                                                              | Open functions                                                               |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| StrategyVault           | none (no Ownable)             | none                                                                                                                                              | open/add/close/getCollateral                                                 |
| LendingPool             | none                          | none                                                                                                                                              | supply/checkLtvAndBorrow/repay/withdraw/views                                |
| SwapRouter              | none                          | `executeIntent` (onlyExecutor)                                                                                                                    | submit/cancel/getMeta + submitSwapIntentTrivial(!)                           |
| StrategyRegistry        | `owner` (immutable, deployer) | `setVault` (onlyOwner, one-shot)                                                                                                                  | registerStrategy/views; incrementTvl/decrementTvl (onlyVault)                |
| ZKVerifier              | OZ Ownable                    | `revokeProof`/`setVerifier`/`removeVerifier` (onlyOwner); `verifyProof*` (onlyVerifier); `storeProof` open (anyone)                               | views                                                                        |
| PrivaraStrategyVault    | OZ Ownable                    | activate/deactivateStrategy, setAuthorizedCaller, setRegistry (onlyOwner)                                                                         | confidentialDeposit/Withdraw, createPermit/usePermit                         |
| PrivaraPaymentRouter    | OZ Ownable                    | setExecutor, setAuthorizedExchange, setUserCompliance, setTokenCompliance, setMax/DailyLimits (onlyOwner); executeConfidentialSwap (onlyExecutor) | submitConfidentialSwapIntent, cancel, swapTo/FromStablecoin, checkCompliance |
| PrivaraEscrowManager    | OZ Ownable                    | setEmergencyWithdrawer (onlyOwner); emergencyWithdraw (onlyEmergencyWithdrawer)                                                                   | createEscrow, approveEscrow, release\*, cancelEscrow                         |
| TestHelper              | none                          | none — anyone can call                                                                                                                            | all wrappers                                                                 |
| MockERC20               | none                          | none — public `mint`                                                                                                                              | mint                                                                         |
| MaliciousReentrantERC20 | none                          | none                                                                                                                                              | setVaultAndParams, mint, transferFrom                                        |

#### Verification of README "Known Issues"

| README claim                                           | Verdict           | Evidence                                                                                                                      |
| ------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| LendingPool.borrow() — no collateral check             | **MISLEADING**    | No `borrow()` function exists. Only `checkLtvAndBorrow` exists, and it DOES enforce collateral check at LendingPool.sol:92.   |
| StrategyVault.addCollateral() — missing nonReentrant   | **FALSE / FIXED** | StrategyVault.sol:154 has `nonReentrant` modifier. README is outdated.                                                        |
| closePosition() — no encrypted debt check before close | **TRUE**          | StrategyVault.sol:186-199 — the `isDebtZero` ebool is computed but never branched on; the only revert condition is dead code. |
| Registry.decrementTvl — FHE.sub wraps on underflow     | **FALSE / FIXED** | StrategyRegistry.sol:147-153 uses `FHE.lte` + `FHE.select` to clamp at zero. README is outdated.                              |
| Router.executor is EOA                                 | **TRUE**          | deploy.ts:31 sets the deployer address as executor.                                                                           |

The README "Known Issues" table is **partly outdated and partly inaccurate**. Two claims are wrong (addCollateral, decrementTvl), two are correct (closePosition, Router executor), and one is misleading (LendingPool.borrow doesn't exist).

#### FHE-specific anomalies (beyond what slither flagged)

- **A-1**: `LendingPool.checkLtvAndBorrow` (lines 96-114): writes encrypted balances unconditionally, transfers tokens conditionally on plaintext check. Encrypted state can drift above plaintext state if the user lies about `borrowAmount`/`encBorrowAmount` correlation. → Risk R-028.
- **A-2**: `StrategyVault.openPosition` (lines 96-142): no FHE.eq check that `debt <= collateral` (the LTV-like invariant). The vault accepts any encrypted debt regardless of collateral. The comparison is delegated entirely to LendingPool's `checkLtvAndBorrow`, which is a separate flow.
- **A-3**: `SwapRouter.executeIntent`'s `ebool isSufficient` is computed but unused (R-016).
- **A-4**: `StrategyVault.closePosition` `ebool isDebtZero` similarly computed but unused (R-019).

#### File status check

| Path                                                                         | Status              |
| ---------------------------------------------------------------------------- | ------------------- |
| StrategyVault.sol, LendingPool.sol, SwapRouter.sol, StrategyRegistry.sol     | VERIFIED end-to-end |
| ZKVerifier.sol                                                               | VERIFIED end-to-end |
| PrivaraStrategyVault.sol, PrivaraPaymentRouter.sol, PrivaraEscrowManager.sol | VERIFIED end-to-end |
| TestHelper.sol, MaliciousReentrantERC20.sol, MockERC20.sol                   | VERIFIED end-to-end |
| 4 interfaces                                                                 | VERIFIED end-to-end |

---

### 4.2 SERVER LAYER REPORT

**Files claimed:** ~126 .ts under `backend/apps/src/` · **Verified by combination of grep and targeted reads:** all routing controllers + privara module fully read, other modules surveyed at controller + service entry-point level.

#### Module roster (10 modules + root)

| Module              | Controllers                                                                                                                                                                                    | Top services                                                                                                                                                                                                                                     | DDD shape                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| (root)              | `app.controller.ts` (`GET /health`)                                                                                                                                                            | —                                                                                                                                                                                                                                                | bootstrap in `main.ts`                                            |
| activities          | `activity.controller.ts` (`/activities`)                                                                                                                                                       | `activity.service.ts`                                                                                                                                                                                                                            | application/domain/infrastructure/interfaces ✓                    |
| ai-strategy-builder | `ai-strategy-builder.controller.ts` (`/ai-strategy-builder`), `ai-strategy-builder-advanced.controller.ts` (`/ai-strategy-builder/advanced`)                                                   | `ai-strategy-builder.service.ts`, `gemini-ai.service.ts` (524 lines), `strategy-parser.service.ts`, `strategy-validator.service.ts`, `strategy-constraints.service.ts`, `strategy-templates.service.ts`                                          | application + interfaces only                                     |
| common              | —                                                                                                                                                                                              | filters/, exceptions/                                                                                                                                                                                                                            | utilities                                                         |
| cron-job            | —                                                                                                                                                                                              | application/jobs/                                                                                                                                                                                                                                | **R-027 cron-manager.service.ts deleted; jobs/ remains orphaned** |
| defi_modules        | `defi_modules.controller.ts` (`/defi-modules`)                                                                                                                                                 | `defi_modules.service.ts`, `defi_pairs.service.ts`, `defi_module_actions.service.ts`, `defi_action_required.service.ts`                                                                                                                          | full DDD ✓                                                        |
| defi_strategies     | `defi_strategies.controller.ts` (`/defi-strategies`), `defi_strategy_executions.controller.ts`, `defi_execution_step_result.controller.ts`, `defi_strategy_simulation_snapshots.controller.ts` | `defi_strategies.service.ts`, `defi_strategy_execution.service.ts`, `defi_strategy_version.service.ts`, `defi_strategy_simullation_snapshot.service.ts` (typo in filename), `defi-simulation-engine.service.ts` (+5 simulators in `simulators/`) | full DDD ✓                                                        |
| defi_token          | `defi_token.controller.ts` (`/defi-token`)                                                                                                                                                     | `defi_token.service.ts`                                                                                                                                                                                                                          | full DDD ✓                                                        |
| privara             | `privara.controller.ts` (`/api/privara`)                                                                                                                                                       | `privara.service.ts` (339 lines), `privara.config.service.ts` (200+ lines) + 5 repository impls + 2 guards + 1 interceptor + 1 filter                                                                                                            | full DDD with **tests**/ inside src/                              |
| shared              | —                                                                                                                                                                                              | `supabase.service.ts` (26 lines), `fhenix-strategy.service.ts`                                                                                                                                                                                   | infrastructure only                                               |
| strategies          | `stategies.controller.ts` (typo in filename; route `/strategies`)                                                                                                                              | `strategy.service.ts`, `rewards.service.ts`                                                                                                                                                                                                      | full DDD ✓                                                        |
| users               | `user.controller.ts` (`/users`)                                                                                                                                                                | `user.service.ts`                                                                                                                                                                                                                                | full DDD ✓                                                        |

**Total HTTP endpoints (grep count):** 47 distinct controller routes (see Phase 1 output).

#### Bootstrap chain (`main.ts`)

- Line 8: `NestFactory.create(AppModule)`
- Lines 23-37: `enableCors` — origin: `ALLOWED_ORIGINS` env (CSV) OR fallback dev list `[localhost:3000, 3001, 5173]`. **In dev mode, ALL origins are allowed** (line 28). Methods include all standard verbs. Custom header `x-wallet-address` allowed (note: this is what the broken WalletAuthGuard reads).
- Line 38: `app.useGlobalPipes(new ValidationPipe())` — class-validator DTOs are enforced globally.
- Lines 41-59: Swagger setup at `/api/docs` with environment-conditional servers (localhost / api.test.com / fheforge-api-production.up.railway.app).

#### `app.module.ts` import order

```
ConfigModule.forRoot({ isGlobal: true, envFilePath: `.env.${NODE_ENV || 'development'}` })
SupabaseModule, UsersModule, StrategiesModule, ActivitiesModule, DefiModulesModule,
DefiStrategiesModule, DefiTokenModule, AiStrategyBuilderModule, PrivaraModule
+ AppController + FhenixStrategyService (provider) + APP_FILTER: HttpExceptionFilter
```

Note: `cron-job` module is **NOT imported** in `app.module.ts`. Combined with the deleted cron-manager.service.ts, the entire cron-job subtree is dead code (R-027).

#### Cross-module dependencies

By inspection of constructors:

- `AiStrategyBuilderService` ← StrategyParserService, StrategyValidatorService, GeminiAiService
- `DefiSimulationEngine` ← 5 simulators
- `StrategyService` ← StrategiesRepository, RewardsService, FhenixStrategyService
- `PrivaraService` ← IPrivaraRepository (token), PrivaraConfigService
- `PrivaraModule` provides `SupabaseService` directly (parallel to SupabaseModule) — duplicate provider chain (R-029).

No circular dependencies detected from controller/service top-level imports.

#### External integrations

- **Supabase** (`@supabase/supabase-js`): `shared/infrastructure/supabase.service.ts:6-26`. `onModuleInit` reads `SUPABASE_URL` + `SUPABASE_KEY`; if missing, logs a warning and continues with `client: null`. Every repository that throws via `getClient()` will then throw "Supabase not configured" if not configured. **No graceful fallback** — the entire data-write path is broken if env is unset.
- **Gemini AI** (`@google/generative-ai`): `gemini-ai.service.ts:43` reads `GEMINI_API_KEY`. The `.env.development` we read has `GEMINI_API_KEY=` (empty) — the AI prompt flow fails on dev unless an env override is provided.
- **Reineira SDK** (`@reineira-os/sdk`): imported as a backend dep (package.json) but the only "use" is in `privara.service.ts:68-74` where the initialization is **commented out**. The backend never actually instantiates the SDK.
- **Ethers (v5.8)**: backend pinned to ethers 5.8 (vs UI/contracts at v6.16). Used by `@ethersproject/providers` and `@ethersproject/address` for address validation. No direct `new ethers.Contract(...)` calls were observed in service files I read; the backend never sends a transaction.

#### Privara module subtree (the highest-risk submodule)

- Controller: `privara.controller.ts` lines 51-184. Routes: `POST /api/privara/{deposit,withdraw,swap,permit,zk-proof}`, `GET /api/privara/strategy/:id/{status,balance}`. Globally guarded by `WalletAuthGuard` + `PrivaraRateLimitGuard` (line 53), wrapped in `PrivaraLoggingInterceptor` and `PrivaraExceptionFilter`.
- **R-007 WalletAuthGuard** (`guards/wallet-auth.guard.ts:23-67`): reads `x-wallet-address` header (line 49) or `?address=` query param (line 55), validates regex `/^0x[a-fA-F0-9]{40}$/`, then **trusts it as authentication**. There is no signature, no nonce, no challenge. Anyone can spoof any wallet by setting the header.
- **R-021 PrivaraRateLimitGuard** (`guards/privara-rate-limit.guard.ts`): in-memory `Map<string, RateLimitStore>` keyed by `walletAddress || request.ip`. Limit 100/min. **In Railway's horizontal scaling, each container has its own Map.** Combined with the trivially-spoofable wallet address, the limit is bypassable both by IP rotation and by sending a different `x-wallet-address` per request.
- **R-009 PrivaraService** (`application/privara.service.ts`):
  - `onModuleInit` lines 56-83: SDK init is commented out (line 68). `sdkInitialized` is set to `true` at line 76 anyway. `ensureSdkInitialized` (line 117) thus always passes.
  - `createStrategyDeposit` lines 123-167: builds `transaction.encryptedAmount = 'encrypted_' + dto.amount` (line 142) — string concatenation, **not encryption**. `transactionHash = '0x' + crypto.randomBytes(32).toString('hex')` (line 145) — randomly generated, not a real chain hash. Same pattern in `createStrategyWithdraw` (179-189) and `createStrategySwap` (222-232).
  - `permitManagement` line 290-294: returns `signature: '0x' + crypto.randomBytes(32).toString('hex')`, `nonce: Math.floor(Math.random() * 1000000)` — both fake.
  - `verifyZKProof` line 318-323: always returns `isValid: true` with a random proof hash. **No verification occurs.**
- **R-022 PrivaraConfigService** (`infrastructure/privara.config.service.ts`):
  - Lines 21-25: hardcoded localhost-hardhat addresses (matches `contracts/deployments/localhost-31337.json` exactly).
  - `getContractAddresses` (line 95-128): returns the hardcoded localhost addresses for `LOCALHOST` and `TESTNET` networks (lines 100-104). For Arbitrum/Base/Ethereum sepolia, returns env-var values (default empty string). **Production deployment to a testnet would silently use empty contract addresses unless every `PRIVARA_ZK_VERIFIER_*`, `PRIVARA_ESCROW_MANAGER_*`, etc. env var is set — none are documented in `.env.production.template`.**

#### Configuration env-var inventory

From grep on `process.env` (75 occurrences):

| Var                                                             | Where consumed                                                                   | Default                 | What if missing                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `NODE_ENV`                                                      | `app.module.ts:21`, `main.ts:12`                                                 | `'development'`         | OK, dev fallback                                                           |
| `PORT`                                                          | `main.ts:11`                                                                     | `3000`                  | OK                                                                         |
| `ALLOWED_ORIGINS`                                               | `main.ts:15`                                                                     | dev list                | OK in dev; prod would lose CORS allow if unset                             |
| `SUPABASE_URL`, `SUPABASE_KEY`                                  | `supabase.service.ts:13-14`                                                      | unset → null client     | **All repository operations fail silently with "Supabase not configured"** |
| `GEMINI_API_KEY`                                                | `gemini-ai.service.ts:43`                                                        | undefined               | AI prompt fails                                                            |
| `TOKEN_WETH`, `TOKEN_USDC`, `TOKEN_USDT`                        | gemini-ai, strategy-constraints, strategy-parser, strategy-templates, defi_pairs | `''` or `undefined`     | Strategy generation produces empty asset IDs                               |
| `SUPPLY_APY_BPS`, `BORROW_APY_BPS`                              | `defi_pairs.service.ts:97,143,167`                                               | undefined               | Returns `undefined` APY                                                    |
| `BASE_SEPOLIA_RPC_URL`, `ARBITRUM_SEPOLIA_RPC_URL`, etc.        | hardhat.config.ts (contracts), privara.config.service.ts                         | hardcoded fallback URLs | Reads testnet RPCs                                                         |
| `PRIVATE_KEY`                                                   | hardhat.config.ts:9, 14                                                          | empty array             | **Cannot deploy**                                                          |
| `PRIVARA_ENABLED`, `PRIVARA_MAX_RETRIES`, `PRIVARA_RETRY_DELAY` | privara.config.service.ts:34-37                                                  | true / 3 / 1000         | sensible                                                                   |
| `PRIVARA_PRIVATE_KEY`                                           | privara.config.service.ts:126 (getter)                                           | `''`                    | If used (which it currently isn't), would fail                             |
| `PRIVARA_NETWORK`, `REINEIRA_NETWORK`                           | referenced in `.env.production.template`                                         | —                       | informational                                                              |

The `.env.production.template` documents many vars but is **not in sync with code**: it lists `JWT_SECRET`, `DATABASE_URL`, `RATE_LIMIT_TTL` etc. that the code does not read. It is a partly-aspirational template.

#### Strategy execution flow (server side)

Trace from a UI call to a chain-side effect:

1. User on UI hits `POST /api/privara/deposit` with `CreateDepositDto { strategyId, amount, token, network? }`.
2. `WalletAuthGuard` admits the request based on `x-wallet-address` header (R-007).
3. `PrivaraRateLimitGuard` increments per-wallet counter (R-021).
4. `PrivaraController.createDeposit(dto)` line 75 calls `privaraService.createStrategyDeposit(dto)`.
5. `PrivaraService.createStrategyDeposit` (line 123-167): constructs a fake `ConfidentialTransaction`, persists it to Supabase via `privaraRepository.saveTransaction(transaction)` line 152.
6. **Flow ends in DB.** No on-chain call. No real encryption. Returns the stored row.

The ONLY real on-chain side effects from the backend are: **none**. (The backend has no transaction-sending code path.)

#### AI strategy builder flow

`POST /ai-strategy-builder/build` → `AiStrategyBuilderService.buildStrategy(dto)`:

1. `parser.parseNaturalLanguage(dto.userIntent, dto.additionalContext, dto.tokenAmount)` — `strategy-parser.service.ts` (calls Gemini with crafted prompt to produce a list of step objects).
2. `validator.validateSteps(steps)` — `strategy-validator.service.ts` (rejects empty steps, unsupported types).
3. `geminiAi.analyzeStrategyRisk(steps)` — second Gemini call for risk analysis.
4. `calculateStrategyMetadata(steps, aiAnalysis)` — gas estimate + risk level rollup.
5. Returns `{ steps, validation, metadata, aiAnalysis }`.

Notable: `console.log('Parsed steps from AI:', steps)` at line 42 of `ai-strategy-builder.service.ts` — production code logging full AI output (LinR R-030). Also: GEMINI_API_KEY is empty in `.env.development`, so this path returns errors in dev unless overridden.

#### Backend TSC errors (full list, 15 errors)

| File:line                                                                                    | Error                     | Root cause                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| activities/infrastructure/activity.repository.impl.ts:155                                    | TS2345 string vs string[] | parameter shape mismatch                                                                                                                         |
| defi_modules/infrastructure/defi_action_required.repository.impl.ts:74                       | TS2345 + TS2339           | bad map function over Supabase return type                                                                                                       |
| defi_modules/infrastructure/defi_modules.repository.impl.ts:11, 68                           | TS2416                    | `findAll/findById` impl signature mismatches abstract — DefiModuleRow has `created_at: string` but DefiModule has `created_at: Date` (no mapper) |
| defi_modules/infrastructure/defi_pairs.repository.impl.ts:43, 60, 79, 98, 121                | TS2345                    | `string \| null` (from Supabase) vs `string \| undefined` (domain). No null→undefined coercion.                                                  |
| privara/infrastructure/confidential-transaction.repository.impl.ts:233, 238                  | TS2322                    | DB returns `string` but domain types are literal unions like `"deposit" \| "withdraw" \| ...`. Missing union narrowing.                          |
| privara/infrastructure/permit.repository.impl.ts:264                                         | TS2322                    | same pattern (status string vs union)                                                                                                            |
| privara/infrastructure/privara-config.repository.impl.ts:206, privara.repository.impl.ts:125 | TS2322                    | `string` vs `ReineiraNetwork` enum                                                                                                               |

The pattern is uniform: **Supabase returns wide `string`s, the domain expects narrow types, and there is no mapper layer**. The presence of `backend/apps/src/shared/infrastructure/database.types.ts` as an UNTRACKED file (per `git status`) suggests that this file (likely Supabase-generated types) is the missing link, but it isn't checked in, so CI cannot reproduce the type-check.

#### Backend ESLint summary

393 problems (392 errors, 1 warning), heavily concentrated in:

- `@typescript-eslint/no-unsafe-*` rules — Supabase-derived `any`s flow through repositories
- `@typescript-eslint/no-unused-vars` — unused imports in privara controllers and modules
- `@typescript-eslint/require-await` — sync methods marked `async` (e.g., `rewards.service.ts:5 calculateAPY`, `user.service.ts:44 checkEvmBinding`, `user.service.ts:50 getUserTokenBalance`, `fhenix-strategy.service.ts:41 getAssetPrice`)

#### Trust boundaries

- All input validation: class-validator DTOs + global ValidationPipe (`main.ts:38`).
- Wallet "authentication": broken (R-007).
- Rate limiting: broken under horizontal scaling (R-021).
- No JWT, no session, no API key. The `Authorization: Bearer` header is set up in Swagger config but no controller actually consumes it.

#### Dead code

- `cron-job/` directory: cron-manager.service.ts deleted, no module imports it (R-027).
- `rewards.service.ts` `calculateAPY` is sync but marked async (eslint-flagged).
- `users.service.ts` `checkEvmBinding`, `getUserTokenBalance` — sync, marked async, unused params.

---

### 4.3 UI LAYER REPORT

**Files claimed:** ~204 in `ui/` · **Verified by combination of grep and targeted reads:** all entry pages + critical hooks + main provider + main components.

#### Pages (Next.js App Router routes)

| Route              | File                                                                         | What it does                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/`                | `app/page.tsx` (45 lines)                                                    | Landing — calls `getStrategies()` from defi-module-service; renders FeaturedStrategies + StrategyList; uses preloader    |
| `/builder`         | `app/builder/page.tsx` (56 lines) → `app/builder/components/BuilderPage.tsx` | Visual ReactFlow strategy builder. Dynamic import (ssr: false, line 5) wrapped in ErrorBoundary.                         |
| `/prompt`          | `app/prompt/page.tsx` → `app/prompt/PromptPage.tsx`                          | NL strategy generation via Gemini. Imports `useStrategyPrompt` hook + `StrategyFlowPreview`. ExecutionModal lazy-loaded. |
| `/strategy`        | `app/strategy/page.tsx`                                                      | Strategy list                                                                                                            |
| `/strategy/[id]`   | `app/strategy/[id]/page.tsx` (+ many components/)                            | Strategy detail with tabs: overview, flow, activity, header, input, etc.                                                 |
| `/strategy-review` | `app/strategy-review/page.tsx`                                               | Strategy review                                                                                                          |

**API routes:** none (`ui/app/api/` is empty; `ui/api/` exists as a directory but has no route files I found).

#### Layout chain

`app/layout.tsx`:

```
ErrorBoundary
  SwrProvider
    AppProvider (= fhenix-provider) [ WagmiProvider → QueryClientProvider (React Query) → CofheConnector ]
      PreloaderProvider
        ToastProvider
          UserProvider (dynamic import, ssr: false)
            Suspense
              [ HeroSection / OnboardingBanner / <main>{children}</main> / Footer ]
```

`validateEnvVars()` is called at module top (line 30) — this only logs a warning, does not block. The fonts: Geist + JetBrains_Mono. Analytics from `@vercel/analytics`.

#### Components inventory

`ui/components/` has 5 sub-trees + a flat root:

| Subtree   | Count     | Notable files                                                                                                                                                               |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| privara/  | 7 + tests | PrivaraDepositForm, PrivaraWithdrawForm, PrivaraBalanceDisplay, PrivaraTransactionStatus, PrivaraPermitManager, PrivaraZKProofUploader, PrivaraSkeleton                     |
| strategy/ | several   | strategy-flow-preview, privara-config (a strategy-level config component)                                                                                                   |
| shared/   | many      | execution-modal, execution-step-stack, footer, hero-section, onboarding-banner, error-boundary, search-bar, transfer-button, wallet-button, encrypt-progress, toast-manager |
| effect/   | several   | interactive-text-effect (visual GSAP effects)                                                                                                                               |
| ui/       | ~30+      | shadcn/ui primitives (dialog, button, accordion, etc.) — all auto-generated patterns                                                                                        |

#### Hooks inventory

| Hook                                           | Lines  | Purpose                                                                                                                                            |
| ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-fhe-wallet.ts`                            | 20     | Thin wagmi wrapper: useAccount/useConnect/useDisconnect/useBalance with only `injected()` connector                                                |
| `use-fhe-vault.ts`                             | 209    | **Direct chain interaction** — encrypt + writeContract for openPosition, supplyToLending, **borrowFromLending (broken — R-023)**, submitSwapIntent |
| `use-privara.ts`                               | 341    | Reineira SDK wrapper with retry/backoff. Dynamic SDK import line 53. **TS2322 on line 60** (R-025)                                                 |
| `use-strategy-builder.ts`                      | medium | ReactFlow state + node management                                                                                                                  |
| `use-strategies.ts`                            | medium | useQuery wrapper around getStrategies (uses React Query)                                                                                           |
| `use-activity-service.ts`                      | medium | activity CRUD via React Query (`useCreateActivity`, `useUpdateActivity`)                                                                           |
| `use-strategy-prompt.ts`                       | medium | AI prompt orchestration                                                                                                                            |
| `use-defi-modules.ts`                          | small  | defi module fetcher                                                                                                                                |
| `use-config-panel-form.ts`                     | medium | builder config panel state                                                                                                                         |
| `use-mobile.ts`, `use-toast.ts`, `use-user.ts` | small  | utility                                                                                                                                            |

#### Services

| Service                    | Backend endpoint         | Notes                                                             |
| -------------------------- | ------------------------ | ----------------------------------------------------------------- | --- | ----------------------------------------------------------------------- |
| `services/api.ts`          | (axios base)             | `API_BASE_URL = NEXT_PUBLIC_API_URL                               |     | http://localhost:3001`. Defines `API_ENDPOINTS` for all backend routes. |
| `strategy-service.ts`      | `/strategies/*`          | thin wrappers over `api`                                          |
| `activity-service.ts`      | `/activities/*`          | thin wrappers                                                     |
| `user-service.ts`          | `/users/*`               | thin wrappers                                                     |
| `defi-module-service.ts`   | `/defi-modules/*`        | uses raw `fetch` (not `api` instance — TODO at line 6 to migrate) |
| `defi-strategy-builder.ts` | `/defi-strategies/*`     | TODO at line 22 about backend schema mismatch                     |
| `ai-strategy-service.ts`   | `/ai-strategy-builder/*` | calls AI build endpoints                                          |
| `privara.ts`               | `/api/privara/*`         | typed wrappers; calls into broken backend (R-009)                 |

**Both React Query (`@tanstack/react-query`) and SWR (`swr`) are wired**: `fhenix-provider.tsx:11` constructs a `QueryClient` and wraps with `QueryClientProvider`; `app/layout.tsx:26` wraps with `SwrProvider`. UI hooks (`use-strategies`, `use-activity-service`) appear to use React Query. Some legacy paths likely use SWR. Both are loaded — bundle bloat (R-031).

#### Providers

| Provider                          | Purpose                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fhenix-provider.tsx` (121 lines) | Wagmi + ReactQuery + CoFHE client (lazy singleton via dynamic `@cofhe/sdk/web` import)                        |
| `swr-provider.tsx`                | SWR config                                                                                                    |
| `query-client-provider.tsx`       | (likely separate React Query provider — duplicate of fhenix-provider's? Worth checking; not read in this run) |
| `preloader-provider.tsx`          | preloader animation state                                                                                     |
| `theme-provider.tsx`              | next-themes wrapper                                                                                           |
| `toast-provider.tsx`              | sonner-style toasts                                                                                           |
| `user-provider.tsx`               | wallet → user mapping                                                                                         |

#### Wallet integration analysis

**Both `@rainbow-me/rainbowkit` and `@privy-io/react-auth` are declared as deps in `ui/package.json`. NEITHER is used.** `fhenix-provider.tsx:22` uses only `injected()` from `wagmi/connectors`. `use-fhe-wallet.ts:2` imports `injected` from `wagmi/connectors`. RainbowKit and Privy are dead deps — their bundle weight (substantial) is paid for nothing (R-031).

Similarly: `ethers` 6.16 + `viem` 2.48 + `wagmi` 2.19 are all present. Wagmi → viem is the active path. ethers is imported in some legacy files but mostly unused in the UI; the backend uses ethers v5.8.

#### UI library overlap

- `@mui/material 5.18` + `@mui/icons-material` — declared deps. Not seen in the components I read (which use Radix + Tailwind).
- `@radix-ui/*` (~25 packages) — actively used via `components/ui/*` (shadcn pattern).
- `tailwindcss-animate` + `tw-animate-css` — both present (likely overlap).
- `framer-motion` 12 + `gsap` 3 — both used in `effect/` and `execution-modal.tsx`.

#### TSC errors

| File:line                                           | Error                               | Cause                                                                       | Risk  |
| --------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- | ----- |
| `app/strategy/[id]/components/strategy-flow.tsx:90` | TS2554: 0 args expected, 2 given    | `getStrategyMeta()` is called with 2 args but the contract function takes 0 | R-026 |
| `hooks/use-privara.ts:60`                           | TS2322: ReineiraNetwork vs Network  | network type mismatch between `@reineira-os/sdk` and local types            | R-025 |
| `providers/fhenix-provider.tsx:50`                  | TS2352: cofhe sdk module shape cast | `Promise<Permit>` not comparable to `Promise<void>` — return type drift     | R-024 |

#### Critical user flows (high-level traces; full detail in §6 Flow Traces)

1. **Connect wallet:** `WalletButton` → `useFheWallet().connectWallet()` → `wagmi.connect({connector: injected()})` → MetaMask popup.
2. **Submit AI prompt:** `/prompt` → `useStrategyPrompt` → `ai-strategy-service.buildStrategy()` → `POST /ai-strategy-builder/build` → `AiStrategyBuilderService.buildStrategy()` → returns steps → display via `StrategyFlowPreview`.
3. **Execute strategy:** `ExecutionModal.startExecution()` → for each step → `useFheVault.{supplyToLending,borrowFromLending,submitSwapIntent}` → encrypt amount via CoFHE client → wagmi `writeContractAsync` → wait for receipt → POST update to `/activities/progress`.
4. **View encrypted balance:** strategy detail page → calls FHE getter (e.g., `getCollateral()`) → uses CoFHE permit + `cofheClient.decryptForView(ctHash, fheType).execute()` (per `fhenix-provider.tsx:39-42`) — for the FheForge core. For Privara, the path goes through the backend's mock `/api/privara/strategy/:id/balance` (returns fake/empty data — R-012).

#### State management

- **Wagmi** (chain state) + **React Query** (server state) via `fhenix-provider.tsx`.
- **SWR** via `swr-provider.tsx`.
- **React Context**: PreloaderContext, CofheClientContext, UserContext, ToastContext.
- **Local component state** with `useState`/`useReducer`.
- No zustand or jotai despite being common in Next.js apps.

#### Dead code / odd patterns

- Two `.bak` files in `contracts/scripts/` (test-hardened.js.bak, test-sharp.js.bak).
- ESLint flags many test files with explicit `any` (especially `__tests__/adversarial.break.test.ts`, `ux.critical.audit.test.ts`).
- Ten+ `<img>` instead of `<Image />` warnings (perf).
- React Hook missing-dependency warnings throughout (lint warnings).
- `defi-module-service.ts` line 6: TODO to migrate to shared `api` instance.
- `services/defi-strategy-builder.ts` line 22: TODO about backend schema mismatch.
- `app/strategy/[id]/components/strategy-input.tsx:128`: TODO comment about backend not guaranteeing `strategy.assets`.
- `execution-modal.tsx:332`: `chainId: ... ?? 1` — defaults to **mainnet (chainId 1)** when chainId missing on a testnet app. This will silently misroute receipts.

#### Test coverage feel

`ui/__tests__/` top-level tests are aggressive in name (adversarial, dead-mock-detection, frontend-reliability, ux-critical-audit) — these read like LLM-driven test sweeps, with much `any` casting. The privara integration tests in `__tests__/integration/` are real flow tests against the (mock) Privara API.

---

### 4.4 DATA LAYER REPORT

**Files claimed:** 33 (schema.sql, 4 migration .sql files, 18 \*.repository.impl.ts, 2 deployment .json files, 8 service files that touch repos) · **Verified:** schema.sql + all migrations + supabase service + key repos.

#### Schema inventory

`schema.sql` (117 lines) defines the FheForge core schema — tables are all `uuid` primary key, `created_at` timestamp:

| Table                                | Key columns                                                                                                 | Notes                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `users`                              | wallet_address (unique), chain_id                                                                           |                                                                   |
| `strategies`                         | strategist_name, strategist_handle, apy (numeric), tags/assets/agents/chains (text[])                       |                                                                   |
| `defi_token`                         | name, asset_id                                                                                              |                                                                   |
| `defi_modules`                       | name, protocol, category, parachain_id, icon_url, description, website_url, is_active                       | "parachain_id" suggests Polkadot lineage in this schema (legacy?) |
| `defi_pairs`                         | token_in_id → defi_token, token_out_id → defi_token                                                         |                                                                   |
| `defi_module_actions`                | module_id (cascade delete), pair_id, name, action_type                                                      |                                                                   |
| `defi_strategies`                    | owner_id → users, name, description, status (default 'draft'), is_public, chain_context, current_version_id |                                                                   |
| `defi_strategy_versions`             | strategy_id (cascade), version, workflow_json/workflow_graph (jsonb)                                        |                                                                   |
| `defi_strategy_executions`           | strategy_version_id, extrinsic_hash, execution_status (default 'pending')                                   | "extrinsic_hash" is Polkadot-style naming                         |
| `defi_execution_step_results`        | execution_id (cascade), step_index, parachain_id, pallet, call, status, output_assets (jsonb)               | All Polkadot-style nomenclature                                   |
| `defi_strategy_simulation_snapshots` | strategy_version_id, snapshot_type, data (jsonb)                                                            |                                                                   |
| `activities`                         | user_address, strategy_id, tx_hash (text[]), status, metadata (jsonb), current_step, total_steps            | tx_hash is an ARRAY                                               |

No RLS policies, no triggers, no functions in `schema.sql`. It is an MVP-style Supabase schema.

#### Migration chain (`backend/apps/migrations/`)

1. `001_create_privara_tables.sql` (102 lines): creates `confidential_transactions`, `privara_config`, `zk_proofs`, `permits`, `strategy_privara_status`. Uses `VARCHAR(255)` instead of `text`, has CHECK constraints on enums (`type IN ('deposit', 'withdraw', ...)`), 9 indexes total. PRIMARY KEY uses `uuid_generate_v4()` (requires `uuid-ossp` extension, enabled at line 6).
2. `002_update_existing_tables.sql` (41 lines): adds `privara_enabled`, `privara_network`, `privara_config_id` to `strategies`; `privara_transaction_id`, `is_privara` to `activities`; conditionally adds `privara_status`/`privara_transaction_hash` to `executions` (table that **doesn't exist** in `schema.sql` — the migration is a no-op for that table).
3. `rollback_001_*.sql` and `rollback_002_*.sql` exist (drops in reverse).
4. `run-migrations.js` (lines 28-39): forward migrations are `[001, 002]`, rollbacks reverse.

**Schema drift R-032**: The `defi_strategies` table in schema.sql references `parachain_id`, `pallet`, `call`, `extrinsic_hash` — Polkadot terminology. The actual code (StrategyVault on Arbitrum Sepolia) uses Ethereum tx hashes and EVM addresses. The schema is **inherited from a Polkadot-era predecessor** (likely Reineira's original Substrate stack) and not rewritten for EVM. Repositories writing to this schema would coerce Ethereum tx hashes into a `text` column called `extrinsic_hash` (works) and write irrelevant `parachain_id` values (hopefully empty).

#### Supabase service

`shared/infrastructure/supabase.service.ts` (26 lines): on `onModuleInit`, reads `SUPABASE_URL` + `SUPABASE_KEY`. **If unset, sets `client = null` and warns**. Every repository's `getClient()` call will throw "Supabase not configured" if not configured. There's no in-memory fallback or stub.

#### Database type definitions

`backend/apps/src/shared/infrastructure/database.types.ts` is **untracked** in git (`git status` confirms). The 15 backend TSC errors stem from row types like `DefiModuleRow`, `DefiActionRequiredRow`, `DefiPairRow`, etc. that come from this generated file. Without it, type-check has nothing to anchor on. The CI workflow (`ci-cd.yml`) calls `npm run type-check` (which doesn't exist in `package.json`), so this drift never fires in CI.

#### Repositories (table-by-table mapping, by reading the impl files)

| Repository                                             | Tables (from `.from()` calls)                                             | Read/Write | Type errors                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ---------- | -------------------------------------------- |
| `activity.repository.impl.ts`                          | `activities`                                                              | RW         | TS2345 line 155 (string vs string[])         |
| `defi_modules.repository.impl.ts`                      | `defi_modules`, `defi_module_actions`, `defi_pairs` (joins)               | RW         | TS2416 lines 11, 68                          |
| `defi_module_actions.repository.impl.ts`               | `defi_module_actions`                                                     | RW         | —                                            |
| `defi_action_required.repository.impl.ts`              | `defi_action_required` (table NOT in schema.sql — **schema drift R-033**) | RW         | TS2345/TS2339 line 74                        |
| `defi_pairs.repository.impl.ts`                        | `defi_pairs` (with `defi_token` joins)                                    | RW         | 5× TS2345 (lines 43-121) — null vs undefined |
| `defi_strategies.repository.impl.ts`                   | `defi_strategies`                                                         | RW         | —                                            |
| `defi_strategy_execution.repository.impl.ts`           | `defi_strategy_executions`                                                | RW         | —                                            |
| `defi_strategy_version.repository.impl.ts`             | `defi_strategy_versions`                                                  | RW         | —                                            |
| `defi_strategy_simulation_snapshot.repository.impl.ts` | `defi_strategy_simulation_snapshots`                                      | RW         | —                                            |
| `defi_execution_step_result.repository.impl.ts`        | `defi_execution_step_results`                                             | RW         | —                                            |
| `defi_token.repository.impl.ts`                        | `defi_token`                                                              | RW         | —                                            |
| `privara.repository.impl.ts`                           | `strategy_privara_status`                                                 | RW         | TS2322 line 125                              |
| `confidential-transaction.repository.impl.ts`          | `confidential_transactions`                                               | RW         | TS2322 lines 233, 238                        |
| `permit.repository.impl.ts`                            | `permits`                                                                 | RW         | TS2322 line 264                              |
| `privara-config.repository.impl.ts`                    | `privara_config`                                                          | RW         | TS2322 line 206                              |
| `zk-proof.repository.impl.ts`                          | `zk_proofs`                                                               | RW         | —                                            |
| `strategies.repository.impl.ts`                        | `strategies`                                                              | RW         | —                                            |
| `user.repository.impl.ts`                              | `users`                                                                   | RW         | —                                            |

**R-033 schema drift**: `defi_action_required.repository.impl.ts` queries a table `defi_action_required` that does not appear in `schema.sql` or in any migration. The schema is incomplete or the table was created out-of-band.

#### Cross-repo data flow

A user submits a strategy:

1. UI `POST /defi-strategies` → `defi_strategies.controller` → `defi_strategies.service.create()` → `defi_strategies.repository.save()` → INSERT INTO `defi_strategies`.
2. Then `POST /defi-strategies/versions` → INSERT INTO `defi_strategy_versions`.
3. On execute: UI calls `useFheVault` directly (no backend involvement for the actual on-chain action).
4. Activity logging: `useCreateActivity` → POST `/activities` → INSERT INTO `activities`.
5. Step progress: `useUpdateActivity` → PUT `/activities/progress/:id` → UPDATE `activities` (sets `current_step`, `tx_hash[]`, `status`).

A user calls Privara endpoint:

1. UI `POST /api/privara/deposit` → `PrivaraController.createDeposit` → `PrivaraService.createStrategyDeposit` → `privaraRepository.saveTransaction` → INSERT INTO `confidential_transactions` (with `encrypted_amount = 'encrypted_' + plaintextAmount` — fake encryption).
2. No on-chain side effect.

#### Contract deployment data

| File                                         | Network         | Deployer                                                        | ZKVerifier                                                                     | EscrowMgr       | PaymentRouter     | StrategyVault     |
| -------------------------------------------- | --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------- | ----------------- | ----------------- |
| `contracts/deployments/hardhat-31337.json`   | hardhat         | 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (default Hardhat #0) | 0x5FbDB23156...                                                                | 0xe7f1725E77... | 0x9fE46736679d... | 0xCf7Ed3AccA5a... |
| `contracts/deployments/localhost-31337.json` | localhost       | 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266                      | 0x0165878A...                                                                  | 0xa513E6E4b8... | 0x2279B7A0a67D... | 0x8A791620dd62... |
| (env-driven, hardcoded in code)              | hardhat default | —                                                               | match `localhost-31337.json` (privara.config.service.ts:21-24 — second deploy) |                 |                   |                   |

**Both files are for chainId 31337 (Hardhat) but different deploy runs produced different addresses** because contract creation consumes nonces. This is normal for redeploys but means there is no canonical local-chain address truth.

**No deployment file exists for arb-sepolia (chainId 421614) or base-sepolia (chainId 84532).** The README's "Deployed Contracts — Arbitrum Sepolia" addresses live only in the README and `.env`/`.env.local`. There are THREE different address sets in play and no canonical record:

| Source                                     | Vault             | Pool              | Router            | Registry          |
| ------------------------------------------ | ----------------- | ----------------- | ----------------- | ----------------- |
| README.md                                  | 0x261c4b5a...     | 0xb4F6b792...     | 0x78C2818a...     | 0xcdFB608e...     |
| `contracts/.env` (local)                   | 0x261c4b5a...     | 0xb4F6b792...     | 0x78C2818a...     | 0xcdFB608e...     |
| `ui/.env.local` (NEXT*PUBLIC*\*)           | 0x261c4b5a...     | 0xb4F6b792...     | 0x78C2818a...     | 0xcdFB608e...     |
| `contracts/scripts/test-hardened.js:18-25` | **0x5E7DD352...** | **0xDC630F04...** | **0x2FBD9450...** | **0xc527ff3C...** |

The test script targets a **completely different deployment** than the README/.env claim. Either the test script is targeting an older deployment, or one of these sources is a "previous" set never updated. R-034.

#### Database access security

- Backend uses `SUPABASE_KEY` (set in `.env.development`) to construct the Supabase client. The variable name doesn't say service-role vs anon — but for a backend write path, this is almost certainly the service-role key (which bypasses RLS).
- UI reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (per `.env.local`) — both empty. The UI does not appear to call Supabase directly anywhere I read. So Supabase access is backend-only.
- No RLS policies in `schema.sql` or migrations. With the service-role key, any backend code path can read/write any row — combined with R-007 (broken auth), this means an attacker who spoofs `x-wallet-address` can effectively read/write any user's data through controllers that scope queries by wallet.

---

### 4.5 TEST + INFRA LAYER REPORT

**Files claimed:** 45 tests + 24 infra · **Verified:** all CI workflows + Vercel/Railway/Nixpacks configs + monitoring/logging configs + the two main test scripts (head + tail) + the privara test directory layout.

#### Contract test inventory

| File                                                | Type             | Count/Approach                   | Notes                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/test/StrategyVault.test.ts`              | hardhat-chai     | unit                             | Privara-test triplet pattern                                                                                                                                                                                                     |
| `contracts/test/PrivaraEscrowManager.test.ts`       | hardhat-chai     | unit                             |                                                                                                                                                                                                                                  |
| `contracts/test/PrivaraPaymentRouter.test.ts`       | hardhat-chai     | unit                             |                                                                                                                                                                                                                                  |
| `contracts/test/PrivaraStrategyVault.test.ts`       | hardhat-chai     | unit                             |                                                                                                                                                                                                                                  |
| `contracts/test/ZKVerifier.test.ts`                 | hardhat-chai     | unit                             |                                                                                                                                                                                                                                  |
| `contracts/test/integration/full-flow.test.ts`      | hardhat-chai     | integration                      | end-to-end Privara stack                                                                                                                                                                                                         |
| `contracts/scripts/test-hardened.js` (523 lines)    | live arb-sepolia | adversarial                      | "every function, every state transition, every vulnerability surface" — README claims 108 PASS / 0 FAIL / 7 VULN. The `.jsonl` confirms PASSes including cross-user FHE isolation. Last run: 2026-04-20 timestamp 1776680784.    |
| `contracts/scripts/test-sharp.js` (447 lines)       | live arb-sepolia | focused                          | README claims 46 PASS / 2 FAIL. The `.jsonl` shows the failure: `❌ Pool.withdraw t1 cannot take t2 supply: DID NOT REVERT — expected "Exceeds supply"` — confirming a real **cross-user withdrawal bug** in LendingPool. R-035. |
| `contracts/scripts/test-live.{js,ts}`               | live             | varies                           |                                                                                                                                                                                                                                  |
| `contracts/scripts/security-test.ts` (346 lines)    | hardhat          | adversarial                      | Referenced by ci-cd.yml line 131                                                                                                                                                                                                 |
| `contracts/scripts/performance-test.ts` (247 lines) | hardhat          | gas/perf                         | Referenced by ci-cd.yml line 330                                                                                                                                                                                                 |
| `contracts/scripts/test-privara-deployment.js`      | live             | smoke test for Privara contracts |                                                                                                                                                                                                                                  |

**MaliciousReentrantERC20** is exercised in `contracts/test/StrategyVault.test.ts` (the contract definition + name implies this; not exhaustively read).

The **.bak files** (`test-hardened.js.bak`, `test-sharp.js.bak`) are leftover from edits — they should be deleted per code hygiene (R-018).

The **.jsonl files** are streaming test result snapshots (one JSON object per line) appended during script runs. They are checked into git, which means test results travel with the codebase — useful for evidence but odd for a versioned repo.

#### Backend test inventory

The backend test surface is **narrow** — only `backend/apps/src/privara/__tests__/` exists. Specifically:

- `privara/__tests__/confidential-transaction.repository.spec.ts` — repo-level tests
- `privara/__tests__/e2e/*` — end-to-end privara flow
- `privara/__tests__/mocks/*` — mock fixtures

**No tests exist for**: `activities`, `ai-strategy-builder`, `defi_modules`, `defi_strategies`, `defi_token`, `strategies`, `users`, `shared`, `common`. **Coverage gap R-036**: the entire non-privara backend has zero unit tests.

`backend/apps/test/jest-e2e.json` exists for e2e wiring (not read in this run).

#### Frontend test inventory

| Directory                                                               | What it tests                         |
| ----------------------------------------------------------------------- | ------------------------------------- |
| `ui/__tests__/adversarial.break.test.ts`                                | "break the system" attack-style tests |
| `ui/__tests__/dead.mock.detection.test.ts`                              | catches dead mocks (suspicious)       |
| `ui/__tests__/frontend.reliability.test.ts`                             | reliability under faults              |
| `ui/__tests__/logic.test.ts`                                            | logic-only tests                      |
| `ui/__tests__/ux.critical.audit.test.ts`                                | UX critical paths                     |
| `ui/__tests__/integration/privara-error-handling.test.tsx`              | Privara error flows                   |
| `ui/__tests__/integration/privara-flow.test.tsx`                        | Privara happy path                    |
| `ui/__tests__/integration/privara-network-switching.test.tsx`           | network switching for Privara         |
| `ui/components/__tests__/*`                                             | preloader tests                       |
| `ui/components/privara/__tests__/*`                                     | Privara components                    |
| `ui/components/shared/__tests__/execution-modal.test.tsx`               | core execution flow                   |
| `ui/hooks/__tests__/use-fhe-wallet.test.tsx`, `use-strategies.test.tsx` | hook tests                            |
| `ui/services/__tests__/{activity-service, strategy-service}.test.ts`    | service layer                         |
| `ui/lib/__tests__/*`, `ui/types/__tests__/*`                            | utilities/types                       |
| `ui/app/builder/components/__tests__/ConfigPanel.test.tsx`              | builder config                        |

The naming pattern (adversarial, dead-mock-detection, ux-critical-audit) is unusual for a hand-written test suite and reads like the output of an automated test-generation pass. ESLint errors are concentrated here (many `@typescript-eslint/no-explicit-any`).

#### Test runner config

- UI: `ui/vitest.config.ts` + `ui/vitest.setup.ts` (jsdom env, `@testing-library/jest-dom` matchers).
- Backend: jest config inline in `backend/apps/package.json` lines around 70+ (not read in this run; pattern `.*\\.spec\\.ts$`, ts-jest transform).

#### CI / GitHub Actions

**Two workflows coexist**:

1. `ci.yml` (39 lines, **active and accurate**):
   - Runs on every push/PR.
   - 3 jobs (contracts, frontend, backend) — each `bun install` then build + test.
   - Contracts job runs `hardhat compile && hardhat test` (the unit tests; not the live test-hardened/test-sharp scripts).
   - Frontend & backend jobs run only `bun run build` — **no lint, no type-check, no unit tests**.

2. `ci-cd.yml` (349 lines, **likely broken**):
   - Calls `npm run lint`, `npm run type-check`, `npm test`, `npm run test:e2e` for both backend and ui.
   - `type-check` does NOT exist as a script in either `ui/package.json` or `backend/apps/package.json`. The workflow would fail at this step.
   - `test:e2e` exists in `backend/apps/package.json` (`jest --config ./test/jest-e2e.json`) but the equivalent for UI is not defined.
   - References `npm ci` against `package-lock.json` files — but the project uses Bun (`bun.lock`), so npm ci would generate a fresh lock and may install different versions.
   - Deploys to Railway (backend), Vercel (frontend), Base/Arbitrum testnet+mainnet (contracts).
   - References secret `BASE_SEPOLIA_PRIVATE_KEY`, `ARBITRUM_SEPOLIA_PRIVATE_KEY`, etc. — not the same name as `PRIVATE_KEY` used by `hardhat.config.ts`. So even if the workflow ran, contracts couldn't sign.
   - Has Trivy security scanner + performance test + Slack notify.

**Conclusion**: `ci.yml` is the only working pipeline. `ci-cd.yml` is aspirational / broken (R-008).

#### Vercel deployment (UI)

`ui/vercel.json`:

```json
{
  "framework": "nextjs",
  "buildCommand": "bun run build",
  "installCommand": "bun install",
  "outputDirectory": ".next"
}
```

Minimal, correct.

#### Railway deployment (backend)

`backend/apps/railway.json`:

```json
{
  "$schema": "...",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node dist/main",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

`backend/apps/nixpacks.toml`:

```toml
[phases.setup] nixPkgs = ["nodejs_20", "bun"]
[phases.install] cmds = ["bun install"]
[phases.build] cmds = ["bun run build"]
[start] cmd = "node dist/main"
```

Railway uses Nixpacks → installs Node 20 + Bun, builds with bun, starts with node dist/main. Sensible.

#### Monitoring stack

`monitoring/`:

- `prometheus.yml`: scrape_interval 15s, external label `cluster: 'fheforge-production'`. Loads `alerts/*.yml` rules. Alertmanager target `alertmanager:9093` (Docker hostname).
- `alertmanager.yml`: route configuration (not read).
- `alerts/alerts.yml`: alert rules (not read).
- `docker-compose.yml`: defines the prometheus + alertmanager + grafana stack (likely; not read).

The monitoring stack is **template-only**. It is not actually wired to either Vercel or Railway production endpoints (no scrape targets in this `prometheus.yml` excerpt). The infrastructure exists as static config files, but no service in this codebase is exporting Prometheus metrics — neither the NestJS backend (no `@willsoto/nestjs-prometheus` or similar) nor the Next.js UI.

#### Logging stack

`logging/`:

- `loki-config.yml` + `promtail-config.yml`: similar template-only.

#### Wallet creation scripts

- `setup-config.sh`: setup script (not read in detail).
- `generate-wallet.sh` / `generate-wallet.js` / `generate-wallet-simple.js`: three different generators. R-018 — wallet generation is overrepresented; consolidate. Critically, the scripts have written keys into `.wallet-secret.json` and `WALLET_CREDENTIALS.txt` in the past (R-001, R-002) — the latter being tracked.

#### Bun + workspaces

Root `package.json`:

```json
{ "name": "fheforge", "workspaces": ["ui", "backend/apps", "contracts"],
  "scripts": { "dev:ui", "dev:backend", "build:ui", "build:backend", "test:contracts" } }
```

There is **no top-level `lint`, `type-check`, `test`, or `build` script that fans out to all 3 workspaces**. A new engineer must run commands per-workspace.

#### Verification commands

| Goal                              | Command                                                                             | Source                 |
| --------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| Compile contracts                 | `cd contracts && npx hardhat compile`                                               | hardhat config         |
| Lint contracts                    | `cd contracts && bun run lint` (== `solhint 'contracts/**/*.sol'`)                  | contracts/package.json |
| Test contracts (unit)             | `cd contracts && npm test` (== `hardhat test`)                                      | contracts/package.json |
| Test contracts (live arb-sepolia) | `node contracts/scripts/test-hardened.js` or `node contracts/scripts/test-sharp.js` | README                 |
| Run UI dev                        | `bun run dev:ui` (root) or `cd ui && bun dev`                                       | root + ui pkg          |
| Run UI tests                      | `cd ui && bun test` (== vitest)                                                     | ui/package.json        |
| Type-check UI                     | `cd ui && npx tsc --noEmit -p tsconfig.json` (no `type-check` script)               | derived                |
| Lint UI                           | `cd ui && bun run lint` (== next lint)                                              | ui/package.json        |
| Build UI                          | `cd ui && bun run build`                                                            | ui/package.json        |
| Run backend dev                   | `cd backend/apps && bun start:dev` (== nest start --watch)                          | backend/apps           |
| Run backend tests                 | `cd backend/apps && bun run test` (== jest)                                         | backend/apps           |
| Lint backend                      | `cd backend/apps && bun run lint` (eslint --fix)                                    | backend/apps           |
| Type-check backend                | `cd backend/apps && npx tsc --noEmit -p tsconfig.json` (no `type-check` script)     | derived                |
| Build backend                     | `cd backend/apps && bun run build`                                                  | backend/apps           |
| Run DB migrations                 | `cd backend/apps && bun run migration:run`                                          | backend/apps           |

These commands should be saved to `AGENTS.md`. (Open question O-2: should this be done now? Per the "Saving learned information" guidance — yes, but only after user confirmation since this overwrites convention.)

---

## 5. CONTRACT MATRIX

Cross-layer contracts (caller→provider). Every row cites file:line for both halves and classifies test coverage from observed evidence.

| ID    | Caller layer + file:line                                                  | Provider layer + file:line                           | What is called                                                 | Match status                                       | Test coverage                                                                   | Violation behavior                                                                                                      | Risk                                                                      |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| C-001 | UI: `use-fhe-vault.ts:107-122`                                            | Contract: `StrategyVault.sol:96-142` `openPosition`  | encrypt {coll, debt, apy, loop} via cofhe + writeContractAsync | aligned                                            | `test-hardened.js` (live), `StrategyVault.test.ts` (unit)                       | encryption fails → throws "CoFHE not ready"; tx fails → caught in execution-modal                                       | low                                                                       |
| C-002 | UI: `use-fhe-vault.ts:148-169`                                            | **NONEXISTENT FUNCTION** `LendingPool.borrow`        | calls `LendingPool.borrow(token, encAmount)`                   | **MISMATCH (R-023)**                               | none — function doesn't exist                                                   | wagmi will throw "Function not found in ABI" or revert                                                                  | **critical**                                                              |
| C-003 | UI: `use-fhe-vault.ts:125-146`                                            | Contract: `LendingPool.sol:49-65` `supply`           | supply(token, amount, encAmount)                               | aligned                                            | unit + live                                                                     | revert on transferFrom failure                                                                                          | low                                                                       |
| C-004 | UI: `use-fhe-vault.ts:171-200`                                            | Contract: `SwapRouter.sol:82-123` `submitSwapIntent` | submit with encrypted amounts and slippage-adjusted minOut     | aligned                                            | live test in test-hardened.js                                                   | revert on tokenIn==tokenOut                                                                                             | low                                                                       |
| C-005 | UI: `execution-modal.tsx:329-338`                                         | wagmi `waitForTransactionReceipt`                    | poll receipt with `chainId` from strategy or default 1         | **MISALIGNED** (defaults to mainnet 1 on testnet)  | partial — execution-modal.test.tsx exists                                       | wrong chain → receipt never confirms                                                                                    | medium                                                                    |
| C-006 | UI: `services/api.ts:48-55` (Privara endpoints)                           | Backend: `privara.controller.ts:64-183`              | POST /api/privara/{deposit,withdraw,swap,permit,zk-proof}      | aligned at HTTP shape                              | privara-flow integration tests                                                  | server returns mock data; client cannot detect                                                                          | medium (semantic mismatch — UI thinks it's getting real on-chain results) |
| C-007 | Backend: `PrivaraService.createStrategyDeposit`                           | (no on-chain provider)                               | server claims SDK call; actually returns mock                  | **broken**                                         | unit tests in privara/**tests** test the mock, not reality                      | always succeeds with fake hash                                                                                          | critical (R-009)                                                          |
| C-008 | Backend → DB: `*.repository.impl.ts`                                      | Supabase `*.from('table')`                           | Supabase REST                                                  | **type-misaligned** (15 TSC errors)                | repository specs in privara                                                     | NULL DB row → `string \| null` reaches domain expecting string                                                          | medium (R-032)                                                            |
| C-009 | Contract: `StrategyVault.openPosition:140-141`                            | Contract: `StrategyRegistry.incrementTvl:107-121`    | FHE.allowTransient + IStrategyRegistry.incrementTvl            | aligned                                            | test-hardened (FHE handle isolation tested)                                     | onlyVault check enforces caller; FHE.isAllowed check on amount enforces handle                                          | low                                                                       |
| C-010 | Contract: `StrategyVault.closePosition:203-207`                           | Contract: `StrategyRegistry.decrementTvl:133-157`    | FHE.allowTransient + decrementTvl                              | aligned                                            | unit                                                                            | underflow clamped via FHE.select; "no-op" on impossible decrement                                                       | low                                                                       |
| C-011 | Contract: `SwapRouter.executeIntent:198`                                  | ERC20 `safeTransferFrom(executor, user, amount)`     | arbitrary-from transfer                                        | aligned but slither HIGH                           | partial                                                                         | requires executor's prior approve; if approval revoked, tx fails                                                        | medium (R-016 is independent)                                             |
| C-012 | Contract: `PrivaraStrategyVault.usePermit:321-325`                        | EIP-191 ECDSA recover                                | recover signer of `permitHash.toEthSignedMessageHash()`        | **mismatch with createPermit** (R-011)             | unit (test contracts)                                                           | recover != owner → revert InvalidSignature; in practice always reverts because createPermit returns hash, not signature | high                                                                      |
| C-013 | Backend: `WalletAuthGuard:49`                                             | Client (untrusted) `x-wallet-address` header         | trust header as user identity                                  | **broken auth** (R-007)                            | not tested adversarially in backend tests                                       | spoofed header → admit any user                                                                                         | critical                                                                  |
| C-014 | UI: `fhenix-provider.tsx:50`                                              | `@cofhe/sdk/web` dynamic import                      | typed cast of mod to `{ createCofheClient?: ... }`             | TS2352 (R-024)                                     | not testable without real SDK                                                   | runtime: factory may be undefined → throw at line 55                                                                    | low (handled)                                                             |
| C-015 | UI: `use-privara.ts:53-62`                                                | `@reineira-os/sdk` `ReineiraSDK.create`              | dynamic import + create                                        | TS2322 on network type (R-025)                     | privara-network-switching.test wires this                                       | runtime: network mismatch may pass to SDK as wrong string                                                               | medium                                                                    |
| C-016 | UI execution-modal: `useCreateActivity` / `useUpdateActivity`             | Backend: `/activities` POST + PUT                    | record activity                                                | aligned                                            | activity-service.test.ts                                                        | server error → toast displayed                                                                                          | low                                                                       |
| C-017 | Contract: `LendingPool.checkLtvAndBorrow:108-114` (encrypted state write) | (none — same contract write)                         | unconditional encrypted balance increment                      | aligned but R-028 (encrypted may exceed plaintext) | partial — adversarial test in test-hardened.js but specific drift not exercised | encrypted view diverges from plaintext when LTV plaintext check fails                                                   | medium                                                                    |

Total contracts traced: 17. Aligned: 9. Mismatched/broken: 4 (C-002, C-007, C-012, C-013). Type-misaligned: 2 (C-008, C-014, C-015). Test coverage spectrum: 5 fully tested, 7 partially tested, 5 effectively untested.

---

## 6. FLOW TRACES

5 critical flows fully traced. Codebase is in the "150-500 files" tier; spec calls for top 5 by user impact + top 5 by risk surface. I report 5 user-impact flows. Risk-surface flows are covered by §5 (Contract Matrix) and §8 (Risk Register).

### F-001 — User opens an FHE-encrypted leveraged position (FheForge core, working path)

**Trigger:** User clicks "Execute" on a strategy that includes a `JOIN_STRATEGY`/SUPPLY/BORROW chain.
**Priority:** 1 (user-facing money flow)

| Step     | File:line                                                               | Function                                | In                                                                           | Out                                  | Layer             |
| -------- | ----------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ | ----------------- |
| 1        | `ui/components/strategy/strategy-card.tsx` (button click)               | onExecute()                             | strategy object                                                              | opens modal                          | UI                |
| 2        | `ui/components/shared/execution-modal.tsx:290-446`                      | startExecution()                        | strategy + walletAddress                                                     | iterates steps                       | UI                |
| 3        | `ui/components/shared/execution-modal.tsx:303-313`                      | createActivityMutation                  | strategy meta                                                                | activity row INSERTed                | UI → Backend → DB |
| 3.1      | `backend/apps/src/activities/interfaces/activity.controller.ts:65`      | POST /activities create                 | userAddress, strategyId, totalSteps                                          | activity id                          | Backend           |
| 4        | `ui/components/shared/execution-modal.tsx:233-243` (per SUPPLY step)    | supplyToLending                         | token, amount, decimals                                                      | tx hash                              | UI                |
| 4.1      | `ui/hooks/use-fhe-vault.ts:79-84`                                       | encrypt128                              | bigint                                                                       | encrypted result                     | UI/CoFHE          |
| 4.2      | `ui/providers/fhenix-provider.tsx:50-58`                                | (lazy) `createCofheClient(config)`      | config                                                                       | client                               | UI/CoFHE          |
| 4.3      | client.encryptInputs([Encryptable.uint128(value)]).execute()            | cofhe sdk                               | bigint                                                                       | InEuint128                           | CoFHE host        |
| 4.4      | `ui/hooks/use-fhe-vault.ts:71-76`                                       | writeContractAsync                      | { address: pool, abi: PoolABI, fn: 'supply', args: [token, amt, encResult] } | tx hash via wagmi → MetaMask → chain | UI → chain        |
| 4.5      | `contracts/contracts/LendingPool.sol:49-65`                             | LendingPool.supply                      | token, amount, encAmount                                                     | balances updated                     | Contract          |
| 5        | `ui/components/shared/execution-modal.tsx:329-339`                      | waitForTransactionReceipt               | tx hash                                                                      | receipt                              | UI                |
| 6        | `ui/components/shared/execution-modal.tsx:381-390`                      | syncActivityProgress                    | activity id, step, status, txHash                                            | activity updated                     | UI → Backend → DB |
| 7        | (loop continues for each step)                                          |                                         |                                                                              |                                      |                   |
| 8        | `ui/components/shared/execution-modal.tsx:407-423`                      | (final step) update activity to SUCCESS |                                                                              |                                      | UI → Backend → DB |
| Terminal | DB row in `activities` with status SUCCESS, all step tx_hashes recorded |                                         |                                                                              |                                      |                   |

**Gaps:** none in the FheForge core path. The flow works end-to-end.
**Risks:** if step type is BORROW, see F-005.

### F-002 — User opens a Privara confidential deposit (Privara path, BROKEN)

**Trigger:** User uses a Privara form on `/strategy/[id]` (PrivaraDepositForm).
**Priority:** 1 (Privara is the headline confidential feature)

| Step     | File:line                                                                                                                                                  | Function                                                                                                     | In                                                                        | Out                         | Layer       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------- | ----------- |
| 1        | `ui/components/privara/PrivaraDepositForm.tsx`                                                                                                             | onSubmit                                                                                                     | form data                                                                 | calls service               | UI          |
| 2        | `ui/services/privara.ts` (createDeposit wrapper)                                                                                                           | api.post(API_ENDPOINTS.PRIVARA.DEPOSIT(), payload)                                                           | deposit dto                                                               | promise                     | UI          |
| 3        | `ui/services/api.ts:5-15` axios                                                                                                                            | POST /api/privara/deposit                                                                                    | body, headers (x-wallet-address)                                          | http response               | UI          |
| 4        | `backend/apps/src/main.ts:23-37` CORS check                                                                                                                |                                                                                                              |                                                                           |                             | Server      |
| 5        | `backend/apps/src/privara/guards/wallet-auth.guard.ts:23-44`                                                                                               | canActivate                                                                                                  | request                                                                   | true (R-007: trusts header) | Server      |
| 6        | `backend/apps/src/privara/guards/privara-rate-limit.guard.ts:32-63`                                                                                        | canActivate                                                                                                  | request                                                                   | true if under limit         | Server      |
| 7        | `backend/apps/src/privara/interfaces/privara.controller.ts:75-79`                                                                                          | createDeposit                                                                                                | dto                                                                       | calls service               | Server      |
| 8        | `backend/apps/src/privara/application/privara.service.ts:117-121`                                                                                          | ensureSdkInitialized                                                                                         | (always passes — sdkInitialized=true even though SDK not actually init'd) |                             | Server      |
| 9        | `backend/apps/src/privara/application/privara.service.ts:138-149`                                                                                          | builds **fake** transaction object (encryptedAmount = "encrypted\_" + amount, transactionHash = randomBytes) | dto                                                                       | fake transaction            | Server      |
| 10       | `privaraRepository.saveTransaction(transaction)`                                                                                                           | INSERT INTO confidential_transactions                                                                        |                                                                           |                             | DB          |
| 11       | returns ConfidentialTransaction to UI                                                                                                                      |                                                                                                              |                                                                           |                             | Server → UI |
| Terminal | UI displays a success toast with a fake tx hash. User believes funds are encrypted on-chain. **Funds never moved.** No real on-chain side effect occurred. |                                                                                                              |                                                                           |                             |             |

**Gaps:** the entire chain claims to be on-chain but is a database INSERT. The UI cannot distinguish.
**Risks:** R-009. This is **the most security-critical bug in the codebase**: any user routed through Privara endpoints is being lied to about the existence of their confidential position.

### F-003 — User generates a strategy via AI prompt

**Trigger:** User on `/prompt` types a natural language strategy.
**Priority:** 1 (primary onboarding flow)

| Step     | File:line                                                                                                                                              | Function                              | In                   | Out                                         | Layer       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | -------------------- | ------------------------------------------- | ----------- |
| 1        | `ui/app/prompt/PromptPage.tsx`                                                                                                                         | onNext (from useStrategyPrompt)       | prompt + tokenAmount | calls service                               | UI          |
| 2        | `ui/hooks/use-strategy-prompt.ts` (not read end-to-end)                                                                                                | submit                                | data                 | fetch                                       | UI          |
| 3        | `ui/services/ai-strategy-service.ts` (not read end-to-end)                                                                                             | buildStrategy                         | dto                  | api.post('/ai-strategy-builder/build', dto) | UI          |
| 4        | `backend/apps/src/ai-strategy-builder/interfaces/ai-strategy-builder.controller.ts:14`                                                                 | @Post('build')                        | dto                  | calls service                               | Server      |
| 5        | `backend/apps/src/ai-strategy-builder/application/ai-strategy-builder.service.ts:36-66`                                                                | buildStrategy                         | dto                  | { steps, validation, metadata, aiAnalysis } | Server      |
| 6        | `parser.parseNaturalLanguage(userIntent, additionalContext, tokenAmount)` line 36 → strategy-parser.service.ts → calls Gemini via gemini-ai.service.ts |                                       | natural language     | strategy steps                              | Server      |
| 6.1      | `gemini-ai.service.ts:43` `process.env.GEMINI_API_KEY`                                                                                                 | (currently empty in .env.development) |                      | error if empty                              | Server      |
| 7        | `validator.validateSteps(steps)` line 41                                                                                                               |                                       | steps                | validation result                           | Server      |
| 8        | `geminiAi.analyzeStrategyRisk(steps)` line 43                                                                                                          |                                       | steps                | risk factors                                | Server      |
| 9        | `calculateStrategyMetadata(steps, aiAnalysis)` line 45                                                                                                 |                                       | steps + analysis     | metadata                                    | Server      |
| 10       | response returns to UI                                                                                                                                 |                                       |                      |                                             | Server → UI |
| 11       | `PromptPage.tsx` displays `StrategyFlowPreview` and offers Execute button                                                                              |                                       |                      |                                             | UI          |
| Terminal | `ExecutionModal` opens with the generated strategy, user clicks Start → flows into F-001.                                                              |                                       |                      |                                             |             |

**Gaps:** GEMINI_API_KEY is empty in `.env.development` — local dev cannot reach this terminal. Production will require setting it as a Railway env var.
**Risks:** R-030 — `console.log('Parsed steps from AI:', steps)` at `ai-strategy-builder.service.ts:42` logs full Gemini output to stdout (Railway logs).

### F-004 — User builds a custom strategy in the visual builder

**Trigger:** User on `/builder` drags nodes (SWAP/SUPPLY/BORROW) onto canvas.
**Priority:** 2 (alternate creation flow)

| Step     | File:line                                                                                                      | Function                           | In            | Out                                | Layer       |
| -------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------- | ---------------------------------- | ----------- |
| 1        | `ui/app/builder/components/BuilderPage.tsx` (not read in detail)                                               | renders ReactFlow + sidebar        |               |                                    | UI          |
| 2        | `ui/lib/defi-node-factory.ts`                                                                                  | creates node objects of given type |               | nodes                              | UI          |
| 3        | `ui/lib/defi-connection-rules.ts`                                                                              | validates edges                    | nodes + edges | bool + reason                      | UI          |
| 4        | `ui/lib/defi-builder-validation.ts`                                                                            | full validation                    | graph         | errors/warnings                    | UI          |
| 5        | `ui/lib/defi-workflow-builder.ts`                                                                              | builds workflow_json from graph    | nodes + edges | workflow_json                      | UI          |
| 6        | `ui/services/defi-strategy-builder.ts`                                                                         | save                               | workflow      | POST /defi-strategies/versions     | UI → Server |
| 6.1      | `backend/apps/src/defi_strategies/interfaces/defi_strategies.controller.ts:37` `@Post('/versions')`            |                                    |               | INSERT INTO defi_strategy_versions | Server → DB |
| 7        | UI fetches saved strategy and renders preview                                                                  |                                    |               |                                    | UI          |
| Terminal | DB row in `defi_strategy_versions` with `workflow_json`/`workflow_graph`. Strategy ready to execute via F-001. |                                    |               |                                    |             |

**Gaps:** none in main path. TODO at `defi-strategy-builder.ts:22` notes uncertainty about backend schema for `workflow_graph`.

### F-005 — User attempts BORROW step in execution

**Trigger:** Strategy contains a `BORROW` step.
**Priority:** 1 (broken flow — high blast radius)

| Step     | File:line                                                                                                                                                                                                          | Function                              | In                                         | Out                                        | Layer      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------ | ------------------------------------------ | ---------- |
| 1        | `ui/components/shared/execution-modal.tsx:244-254`                                                                                                                                                                 | step.type === STEP_TYPE.BORROW branch | step                                       | borrowFromLending call                     | UI         |
| 2        | `ui/hooks/use-fhe-vault.ts:148-169`                                                                                                                                                                                | borrowFromLending                     | token, amount                              | encryptAndWrite                            | UI         |
| 3        | `ui/hooks/use-fhe-vault.ts:158-165`                                                                                                                                                                                | encryptAndWrite                       | { fn: 'borrow', args: [token, null], ... } | wagmi.writeContractAsync                   | UI         |
| 4        | wagmi tries to call `LendingPool.borrow(token, encAmount)`                                                                                                                                                         |                                       |                                            | **fails — function does not exist on ABI** | UI → chain |
| Terminal | tx fails at submit-time (function selector mismatch) OR if attempted by raw call, EVM revert with "function selector not found". `ui/components/shared/execution-modal.tsx:427-435` catches and marks step failed. |                                       |                                            |                                            |            |

**Gaps:** the user sees "Step N failed" with no actionable diagnostic. The failure is silent and confusing.
**Risks:** **R-023 is critical**. Any strategy with a BORROW step is broken end-to-end. The ONLY way borrowing works is via `checkLtvAndBorrow`, which has 6 parameters (collateral token, borrow token, amount, encAmount, ltvNum, ltvDen) — a different signature that the UI never constructs.

---

## 7. TOOL RUN LOG

| Tool                     | Command                                                                                                 | Exit              | Findings                             | Critical Findings                                      | Summary                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| forge build              | `cd contracts && forge build --skip test`                                                               | 0 (with warnings) | n/a                                  | irrelevant — project uses Hardhat                      | Project not foundry-native; remappings missing for node_modules-resolved paths                                                                                                                                                                                                                                                                                                          |
| hardhat compile          | `cd contracts && npx hardhat compile`                                                                   | 0                 | "Nothing to compile"                 | none                                                   | Contracts already compiled in artifacts/. Compile succeeds.                                                                                                                                                                                                                                                                                                                             |
| solhint                  | `cd contracts && solhint 'contracts/**/*.sol'`                                                          | 0                 | 32 warnings                          | 0 critical                                             | All gas-optimization style warnings (struct packing, custom errors, increment style, indexed events). No security findings.                                                                                                                                                                                                                                                             |
| slither                  | `cd contracts && slither . --filter-paths "node_modules\|test" --hardhat-artifacts-directory artifacts` | nonzero           | 84 findings across 53 contracts      | **4 HIGH, 16 MEDIUM, 35+ LOW, 9 INFO, 4 OPTIMIZATION** | HIGH: 1 arbitrary-send-erc20 (SwapRouter executor, intentional but flagged); 3 encode-packed-collision (ZKVerifier — collision attack surface). MEDIUM: 9 reentrancy-no-eth (FHE.asEuint128 external calls before state writes), 5 unused-return (TestHelper IERC20.approve). LOW: many missing-zero-check, timestamp comparisons, reentrancy-events, reentrancy-benign, events-access. |
| ui tsc                   | `cd ui && npx tsc --noEmit -p tsconfig.json`                                                            | 2                 | 3 errors                             | 3                                                      | strategy-flow.tsx:90 (TS2554), use-privara.ts:60 (TS2322), fhenix-provider.tsx:50 (TS2352). All anomalous (R-024/25/26).                                                                                                                                                                                                                                                                |
| backend tsc              | `cd backend/apps && npx tsc --noEmit -p tsconfig.json`                                                  | 2                 | 15 errors                            | 15                                                     | All trace to missing/mismatched Supabase row types (untracked `database.types.ts`), Date vs string, null vs undefined, narrow string literal unions. R-032.                                                                                                                                                                                                                             |
| contracts tsc            | `cd contracts && npx tsc --noEmit -p tsconfig.json`                                                     | 0                 | 0                                    | 0                                                      | Clean.                                                                                                                                                                                                                                                                                                                                                                                  |
| ui eslint (next lint)    | `cd ui && next lint -d .`                                                                               | 0                 | 57 errors + 26 warnings              | 57                                                     | Mostly `@typescript-eslint/no-explicit-any` in test files, `react-hooks/exhaustive-deps` warnings, `<img>` instead of `<Image />` warnings.                                                                                                                                                                                                                                             |
| backend eslint           | `cd backend/apps && eslint src/**/*.ts`                                                                 | 0                 | 393 problems (392 errors, 1 warning) | 392                                                    | `no-unsafe-*` from Supabase any-typed flow, unused imports in privara module, `require-await` on sync-marked-async methods.                                                                                                                                                                                                                                                             |
| prettier --check         | `prettier --check .`                                                                                    | 0                 | 0                                    | 0                                                      | Clean (last commit was a prettier sweep).                                                                                                                                                                                                                                                                                                                                               |
| shellcheck               | `shellcheck --severity=warning generate-wallet.sh setup-config.sh`                                      | 0                 | 0                                    | 0                                                      | Clean.                                                                                                                                                                                                                                                                                                                                                                                  |
| semgrep                  | `semgrep --config=auto --include='*.ts' --include='*.tsx' --include='*.sol' --exclude=...`              | 0                 | 3 INFO                               | 0                                                      | unsafe-formatstring in 3 backend places (activity.repository.impl.ts:54, 76; gemini-ai.service.ts:170). Low severity.                                                                                                                                                                                                                                                                   |
| grep TODO/FIXME          | scan over backend/ui/contracts                                                                          | n/a               | 5                                    | 0                                                      | All in dev-tracked TODO comments.                                                                                                                                                                                                                                                                                                                                                       |
| grep hardcoded addresses | scan over source                                                                                        | n/a               | 5 in production code                 | 4                                                      | privara.config.service.ts:21-24 hardcodes 4 hardhat-default addresses. R-022.                                                                                                                                                                                                                                                                                                           |
| grep process.env         | full scan                                                                                               | n/a               | 75 occurrences                       | n/a                                                    | See §4.2 env table.                                                                                                                                                                                                                                                                                                                                                                     |
| git ls-files             | `git ls-files                                                                                           | grep -i wallet`   | 0                                    | 1 critical                                             | 1                                                                                                                                                                                                                                                                                                                                                                                       | **WALLET_CREDENTIALS.txt is git-tracked** with private key + mnemonic (R-001). |
| git status               | parse working tree                                                                                      | 0                 | 191 modified, 1 deleted, 1 untracked | n/a                                                    | Indicates massive uncommitted refactor work. cron-manager.service.ts is the deletion (R-027). database.types.ts is the untracked file (R-032).                                                                                                                                                                                                                                          |

Findings density per layer:

| Layer    | Critical findings count                                                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contract | 4 HIGH slither + 6 anomaly tags (SwapRouter trivial, ZKVerifier stub, PrivaraStrategyVault permit/withdraw, PrivaraPaymentRouter compliance/swap, StrategyVault dead check, TestHelper deployable trivial) |
| server   | 4 critical (privara-service-fake, wallet-auth-bypass, rate-limit-bypass, privara-config-hardcoded)                                                                                                         |
| ui       | 4 medium (use-fhe-vault.borrow nonexistent, fhenix-provider TS cast, use-privara TS, strategy-flow TS)                                                                                                     |
| data     | 2 critical (3-way address drift, missing database.types.ts → 15 TSC errors), 2 medium (schema drift Polkadot, unknown defi_action_required table)                                                          |
| infra    | 1 high (ci-cd.yml broken type-check), 5+ secret-leak (4 plaintext PKs + 1 git-tracked credentials file)                                                                                                    |

---

## 8. RISK REGISTER

Sorted by impact. Every entry is file-backed.

### CRITICAL impact

**R-001 — `WALLET_CREDENTIALS.txt` is git-tracked with plaintext private key and mnemonic**

- file: `WALLET_CREDENTIALS.txt` (root, tracked in `git ls-files`)
- finding: contains `0x7d127b1052b8e2d7ac108471b0363f00e40851fe0d3ada164d944bc5766cbf47` plus the BIP-39 mnemonic "announce plate indicate ..."
- trigger: present at HEAD; anyone with repo read access reads the key
- tested: no
- recommendation: `git rm WALLET_CREDENTIALS.txt`; rewrite history with `git filter-repo` to remove from past commits; rotate the wallet immediately by transferring all balance to a fresh address; revoke any approvals on testnet.

**R-002 — `.wallet-secret.json` plaintext private key on disk** (gitignored, NOT tracked)

- file: `.wallet-secret.json`
- finding: `{ "address": "0xc846b7e4...", "privateKey": "0x36941c92...", "createdAt": "2026-04-24..." }`
- trigger: any local process / backup / shared workstation
- tested: no
- recommendation: delete file; use a hardware wallet or env-var-only approach for dev keys; if this address held testnet funds, rotate.

**R-003 — `backend/apps/.env.development` plaintext PRIVATE_KEY** (gitignored, NOT tracked)

- file: `backend/apps/.env.development`
- finding: `PRIVATE_KEY=0xf0c35250d31fdd7db7756d4bbc26b7803b54f0205ccd99723f3d34d6a56f9049`
- trigger: developer workstation; any backup; any CI runner that copies the file
- tested: no
- recommendation: backend never sends transactions, so no key is needed in backend at all; remove this var entirely. If the value is needed for a future SDK init, source it from a secret store (Railway secret, Vault, AWS Secrets Manager).

**R-004 — `contracts/.env` plaintext PRIVATE_KEY** (gitignored, NOT tracked)

- file: `contracts/.env`
- finding: `PRIVATE_KEY=0x36941c92658eaf85ea8a9558099062670a2a9e0e5dcdc75145ca917c0e7868a4` (same as `.wallet-secret.json`)
- trigger: deployment scripts read this via `hardhat.config.ts:9, 14`
- tested: no
- recommendation: source via temporary env injection at deploy time; remove file from disk.

**R-005 — 4 plaintext private keys hardcoded in `contracts/scripts/test-hardened.js`**

- file: `contracts/scripts/test-hardened.js:10-14`
- finding: `KEYS = { tester1: '0x9b71...', tester2: '0x8900...', tester3: '0x0446...', deploy: '0xf0c3...' }` — all in source, all tracked in git
- trigger: any reader of the repo
- tested: yes (the keys are used to sign live arb-sepolia transactions in test runs)
- recommendation: read keys from env vars at runtime. If the test wallets need to be reproducible, encrypt them with a CI-only key. Rotate any address with funds.

**R-006 — ZKVerifier `_verifyProofCircuit` is a stub that returns true**

- file: `contracts/contracts/ZKVerifier.sol:316-334`
- finding: function header explicitly says "TEMPORARY STUB ... DO NOT deploy to production"; verification returns `true` for any non-empty proof.
- trigger: any caller of `verifyProof` / `verifyProofForTransaction` — including `PrivaraService.verifyZKProof` clients
- tested: yes (the existing tests cover the stub behavior, not real verification)
- recommendation: do NOT deploy this contract to mainnet under the current implementation. Replace with a Groth16/PLONK verifier specific to the proving system. Until then, `PrivaraService.verifyZKProof` should return error.

**R-007 — `WalletAuthGuard` accepts unsigned `x-wallet-address` header as authentication**

- file: `backend/apps/src/privara/guards/wallet-auth.guard.ts:23-67`
- finding: validates regex format, then trusts the header. No signature, no nonce, no challenge.
- trigger: `curl -H 'x-wallet-address: 0x<victim>' https://api.../api/privara/...` admits the request as the victim
- tested: no — the privara tests use the same trivially-pass mechanism
- recommendation: implement SIWE (EIP-4361) or session-based auth with a challenge → user-signed message → JWT. Backend verifies signature against `walletAddress`.

**R-009 — `PrivaraService` returns mock data for every operation**

- file: `backend/apps/src/privara/application/privara.service.ts:138-149, 179-189, 222-232, 290-294, 318-323`
- finding: `encryptedAmount: 'encrypted_' + dto.amount` (string concat); `transactionHash: '0x' + crypto.randomBytes(32).toString('hex')` (random); `signature: random bytes`; `verifyZKProof` always returns `isValid: true`. SDK init is commented out (line 68-74) but `sdkInitialized = true` set anyway (line 76).
- trigger: any call to `/api/privara/{deposit,withdraw,swap,permit,zk-proof}`
- tested: privara unit tests test the mock, not reality
- recommendation: if Reineira SDK integration is pending, return HTTP 503 ("integration in progress") instead of fake success. Document clearly in OpenAPI/Swagger that this endpoint is not yet wired.

**R-013 — `PrivaraPaymentRouter.checkSwapCompliance` uses wrong amount**

- file: `contracts/contracts/PrivaraPaymentRouter.sol:242-262`
- finding: line 255 `uint256 amount = approvedMinAmountOut;` — uses minimum output as the amount in compliance check, instead of the actual swap amount (which is encrypted and unknown on-chain)
- trigger: any execution path through `executeConfidentialSwap`
- tested: unit tests in `PrivaraPaymentRouter.test.ts` test the function with the buggy semantics — they pass because the test reflects the buggy behavior
- recommendation: compliance must be enforced off-chain by the executor (which sees plaintext) before executing. On-chain compliance check on encrypted amounts is incoherent without ZK proof of compliance. Replace with off-chain attested compliance value.

**R-014 — `PrivaraPaymentRouter.executeConfidentialSwap` does not actually swap**

- file: `contracts/contracts/PrivaraPaymentRouter.sol:163-182`
- finding: comment at lines 177-178 explicitly says "Perform swap logic here (would integrate with DEX). For now, just mark as executed." No DEX integration, no token transfer.
- trigger: any executor call to executeConfidentialSwap
- tested: yes — tests cover the marked-executed behavior
- recommendation: integrate with a DEX (Uniswap V3 / 1inch / etc.) before deploying. The `executor` EOA must perform the actual swap off-chain and prove the output via signed message; on-chain only checks the proof.

### HIGH impact

**R-008 — `ci-cd.yml` references undefined `type-check` script**

- file: `.github/workflows/ci-cd.yml:43, 83`
- finding: workflow runs `npm run type-check` for both backend and ui; neither package.json defines this script
- trigger: any push to main/develop
- tested: no — failing CI step is the test
- recommendation: Either add a `"type-check": "tsc --noEmit"` script to both package.jsons, or delete `ci-cd.yml` (since `ci.yml` is the actually-working pipeline).

**R-010 — `PrivaraStrategyVault.confidentialWithdraw` checks strategy total, not user balance**

- file: `contracts/contracts/PrivaraStrategyVault.sol:200-212`
- finding: line 202 `if (amount > totalDeposited[strategyId]) revert InsufficientBalance();` checks against the strategy-wide total, not against the caller's encryptedCollateral. The function then `delete confidentialPositions[msg.sender]` (line 212) without verifying the caller deposited.
- trigger: user A and user B both deposit into strategyId 1; user A calls `confidentialWithdraw(strategyId=1, amount=B's_amount, recipient=A)`. The check passes because `B's_amount <= totalDeposited[1]`. Funds transfer to A.
- tested: no — `PrivaraStrategyVault.test.ts` does not contain a multi-user adversarial scenario for this function (per file count and pattern observed)
- recommendation: validate against the per-user encryptedCollateral. Decrement encryptedCollateral by encryptedAmount. Add an FHE-encrypted sufficient-balance check via `FHE.gte(encryptedCollateral, encryptedAmount)` + `FHE.select` to clamp.

**R-011 — `PrivaraStrategyVault` permit flow is broken (createPermit returns hash, usePermit expects signature)**

- file: `contracts/contracts/PrivaraStrategyVault.sol:243-283, 295-331`
- finding: createPermit returns `abi.encodePacked(permitHash)` (line 279) — i.e., the message hash, not a signature. usePermit calls `ECDSA.recover(permitHash.toEthSignedMessageHash(), signature)` (line 321) — expects a real ECDSA signature. The contract's own permit lifecycle never produces a valid signature.
- trigger: `usePermit(...)` always reverts InvalidSignature for permits "created" via createPermit on-chain
- tested: not in the unit tests in a way that would catch the contract-only path; only off-chain-signed signatures pass usePermit.
- recommendation: remove `createPermit` from on-chain (or have it accept a pre-signed signature). The off-chain client should: (a) compute permitHash via `getPermitHash`, (b) sign with the user's wallet, (c) call `usePermit(..., signature)`. Document this clearly.

**R-012 — `getConfidentialBalance` leaks strategy-wide total as user balance**

- file: `contracts/contracts/PrivaraStrategyVault.sol:342-358`
- finding: returns `(new bytes(0), totalDeposited[strategyId])` — the user gets the entire strategy's TVL labelled as their plaintext balance, plus empty bytes for the encrypted balance
- trigger: any caller
- tested: behavior is the spec-as-written
- recommendation: return per-user balance (after fixing R-010 to track per-user encryptedCollateral). Fix the encrypted balance return to actually be the user's encryptedCollateral.

**R-015 — `SwapRouter.submitSwapIntentTrivial` is callable on-chain with plaintext amounts**

- file: `contracts/contracts/SwapRouter.sol:211-252`
- finding: `external` function takes `uint256 amountIn, uint256 minAmountOut`, trivially encrypts them. The function name is `Trivial` but there is no access modifier preventing public mainnet calls.
- trigger: any user calls this function on a deployed instance — the resulting "intent" appears in `intents` mapping with publicly-known amounts. Other users (and the executor) see the values via the `IntentSubmitted` event (which doesn't expose the amounts directly, but the on-chain reveal is known to anyone reading state via getIntentMeta + computing).
- tested: yes — the test scripts use this for non-FHE testing; it works, which is the problem on production.
- recommendation: gate behind `msg.sender == executor` or `onlyOwner`, or remove the function entirely from production-bound deployments.

**R-016 — `SwapRouter.executeIntent` does not enforce minOut on-chain**

- file: `contracts/contracts/SwapRouter.sol:181-192`
- finding: computes `ebool isSufficient = FHE.gte(outputEnc, i.minAmountOut)` (line 185), stores it in a local but never branches on it. Comment at lines 190-191 says "we rely on the executor to only call this when the output meets the minimum."
- trigger: malicious or compromised executor calls executeIntent with arbitrary outputAmount; user has no on-chain protection
- tested: live test scripts assume well-behaved executor
- recommendation: the encrypted comparison cannot gate execution on-chain (FHE select + transfer based on plaintext bool from FHE result requires off-chain decrypt). One real fix: require executor to submit a ZK proof that `outputAmount >= minAmountOut`, verified by ZKVerifier. Without ZK proof, the executor is fully trusted — document this clearly and use a multisig executor.

**R-018 — Stale backup files and unused wallet generators in repo**

- files: `contracts/scripts/test-hardened.js.bak`, `contracts/scripts/test-sharp.js.bak`, `generate-wallet.{sh,js,simple.js}`
- finding: leftover .bak files from edits; three different wallet generators
- trigger: confusion about which is canonical
- recommendation: delete .bak files; consolidate to one wallet generator.

**R-019 — `StrategyVault.closePosition` debt check is dead code**

- file: `contracts/contracts/StrategyVault.sol:186-199`
- finding: `ebool isDebtZero = FHE.eq(positions[msg.sender].debt, _zero)` (line 190) is computed and FHE.allowThis'd, but never branched on. The actual conditional (line 196-199) is `FHE.isInitialized(...) && collateralAmount > depositedAmounts[msg.sender]` — but `collateralAmount > depositedAmounts[msg.sender]` already revert at line 182.
- trigger: a user with non-zero debt can call `closePosition(0)` (or any amount ≤ depositedAmounts), which proceeds to delete the position and transfer collateral, leaving outstanding debt in LendingPool with no collateral backing.
- tested: README acknowledges this as a Known Issue, so likely not in the existing test suite as an adversarial scenario
- recommendation: implement off-chain debt check via permit — UI calls `getCollateral` + computes `decryptForView(debt)` against the user permit, only enables Close if debt == 0. On-chain enforcement requires either ZK proof or interactive FHE comparison; neither is available now. As a stopgap, require closePosition to first call `LendingPool.repay(borrowToken, depositedAmounts[msg.sender], FHE.asEuint128(0))` and verify plaintext borrowBalance == 0.

**R-020 — TestHelper.sol is deployable and provides plaintext bypass**

- file: `contracts/contracts/TestHelper.sol:138-365`, `contracts/scripts/deploy-testhelper.js`
- finding: contract trivially encrypts plaintext values and calls real production contracts. The compiled artifact exists; a deploy script exists. Anyone who has the deployed TestHelper address can call `supply`/`borrow`/`openPosition` with plaintext amounts.
- trigger: deployment to a network where the contract is publicly callable
- tested: not as a vulnerability — the test framework uses it
- recommendation: rename to `LocalTestHelper.sol` and never deploy to non-local networks. Add a `require(block.chainid == 31337, "local-only")` modifier. Or: move TestHelper to a separate `contracts/contracts-test/` directory and exclude from the production deploy script.

**R-023 — UI calls non-existent `LendingPool.borrow` function**

- file: `ui/hooks/use-fhe-vault.ts:148-169`
- finding: calls `writeContractAsync({ ..., functionName: 'borrow', args: [token, encAmount] })` against PoolABI. The actual `LendingPool.sol` has only `checkLtvAndBorrow` (6 params), not `borrow` (2 params).
- trigger: any user-initiated BORROW step in execution-modal (line 244-254)
- tested: no — the test files don't exercise the failure (one only sees the "step failed" UI state)
- recommendation: rewrite `borrowFromLending` to call `checkLtvAndBorrow` with proper LTV numerator/denominator. The UI flow needs to collect or compute LTV.

### MEDIUM impact

**R-021 — In-memory rate-limit Map bypassed by horizontal scaling**

- file: `backend/apps/src/privara/guards/privara-rate-limit.guard.ts`
- finding: `private readonly store = new Map<string, RateLimitStore>()` — process-local. With Railway autoscaling, each instance has its own counter.
- trigger: high-traffic exceeds limit per-instance but not aggregate; each instance allows 100/min independently
- tested: no
- recommendation: use Redis-backed `nestjs-throttler` storage adapter. Or migrate to upstream gateway rate limiting (Cloudflare, Railway's edge).

**R-022 — Hardcoded localhost-hardhat addresses in PrivaraConfigService**

- file: `backend/apps/src/privara/infrastructure/privara.config.service.ts:21-25`
- finding: `localAddresses` for ZKVerifier/EscrowMgr/PaymentRouter/StrategyVault — match `contracts/deployments/localhost-31337.json` exactly. For arb-sepolia/base-sepolia/eth-sepolia, the `getContractAddresses` method falls back to env vars `PRIVARA_ZK_VERIFIER_${network}` etc. — none of which are documented in `.env.production.template`.
- trigger: production deploy without setting all 4 env vars × 3 networks = 12 vars → returns empty strings → SDK calls fail
- tested: no
- recommendation: add Privara contract address env vars to `.env.production.template`; throw if any required address is empty; consider sourcing from a typed config class.

**R-024 — `fhenix-provider.tsx` SDK shape cast**

- file: `ui/providers/fhenix-provider.tsx:50-58`
- finding: TS2352 — cast of `await import("@cofhe/sdk/web")` to `{ createCofheClient?: ... }` is rejected because the actual module exports a different shape
- trigger: build-time strict TS will fail
- tested: no — the existing build presumably uses a more permissive tsconfig
- recommendation: use proper exported types from `@cofhe/sdk`. If the SDK's types are wrong, file an issue upstream and use `as unknown as ...` with a clear comment.

**R-025 — `use-privara.ts` ReineiraNetwork vs Network type mismatch**

- file: `ui/hooks/use-privara.ts:60`
- finding: TS2322 — `ReineiraSDK.create({ network: detectedNetwork, signer })` — `detectedNetwork: ReineiraNetwork` is not assignable to the SDK's expected `Network` type (`"arbitrum-sepolia"` literal not in `Network`)
- trigger: build-time strict TS
- recommendation: align local `ReineiraNetwork` enum with `@reineira-os/sdk` exported `Network` type.

**R-026 — `strategy-flow.tsx` bad call**

- file: `ui/app/strategy/[id]/components/strategy-flow.tsx:90`
- finding: TS2554: function called with 2 args where 0 expected.
- trigger: build-time
- recommendation: read the call site and adjust args (likely a stale API call).

**R-027 — Deleted `cron-manager.service.ts` leaves orphan `cron-job/` dir**

- file: `backend/apps/src/cron-job/application/cron-manager.service.ts` (DELETED in working tree)
- finding: `cron-job/application/jobs/` still exists; no module imports cron-job in `app.module.ts`. Code is orphaned.
- trigger: dead code; risk of accidental restoration
- recommendation: remove the entire `cron-job/` directory and `cron-manager` references; commit.

**R-028 — LendingPool encrypted/plaintext divergence in checkLtvAndBorrow**

- file: `contracts/contracts/LendingPool.sol:108-122`
- finding: lines 108-114 always update the encrypted `borrowBalances[borrowToken][msg.sender]` (with `actual`, which may be 0). Line 119-122 conditionally transfers and updates plaintext only if plaintext LTV passes. If the user's encrypted amount is correctly 0 (because plaintext check failed), the encrypted view is fine. But if a user lies about the relationship between `borrowAmount` and `encBorrowAmount`, the encrypted state can drift above the plaintext state.
- trigger: malicious user submits encBorrowAmount=N but borrowAmount=0; encrypted balance increases by N but no tokens move
- tested: not adversarially in this way (test-hardened.js focuses on cross-user)
- recommendation: only update encrypted state when plaintext LTV check passes. Wrap the encrypted assignment in the `if (ltvPasses)` block.

**R-029 — Duplicate SupabaseService provision in PrivaraModule**

- file: `backend/apps/src/privara/privara.module.ts:39`
- finding: SupabaseService is already provided globally by SupabaseModule (imported in app.module.ts:23) but PrivaraModule re-provides it locally. NestJS will create a second instance for PrivaraModule's scope.
- trigger: two database clients potentially
- recommendation: remove the local provider; rely on the global SupabaseModule.

**R-030 — Production console.log of full Gemini AI output**

- file: `backend/apps/src/ai-strategy-builder/application/ai-strategy-builder.service.ts:42`
- finding: `console.log('Parsed steps from AI:', steps)` — logs full LLM output to stdout (Railway logs).
- trigger: any /ai-strategy-builder/build call in production
- recommendation: replace with `this.logger.debug` (NestJS Logger). Logs should be structured JSON.

**R-031 — Bundle bloat: 3 unused wallet libs + 2 query libs + 3 UI libs**

- files: `ui/package.json` deps
- finding: `@rainbow-me/rainbowkit` and `@privy-io/react-auth` are declared but only `wagmi/connectors injected()` is used. Both React Query and SWR are actively wired. `@mui/material` declared but not used in the components surveyed.
- trigger: client bundle weight
- recommendation: audit imports; remove RainbowKit, Privy, MUI, and one of (React Query, SWR) — pick one. Run `bunx depcheck` and `bunx knip` to confirm.

**R-032 — Backend TSC errors all stem from missing `database.types.ts`**

- file: `backend/apps/src/shared/infrastructure/database.types.ts` (UNTRACKED in git)
- finding: 15 TSC errors trace to wide Supabase types vs narrow domain types. The generated types file is untracked.
- trigger: CI checkout + type-check (if it ran) would fail with even more errors
- recommendation: Generate types via `npx supabase gen types typescript --linked > database.types.ts` and commit it, OR add a CI step that generates the file before type-check.

**R-033 — `defi_action_required` table queried but absent from schema**

- file: `backend/apps/src/defi_modules/infrastructure/defi_action_required.repository.impl.ts`
- finding: queries `defi_action_required` table; not in `schema.sql` or any migration in `backend/apps/migrations/`.
- trigger: production query → "relation does not exist"
- tested: tests likely use a mocked Supabase client
- recommendation: add the table to the schema or remove the repository.

**R-034 — Three different "source of truth" address sets disagree**

- files: `README.md`, `contracts/.env`, `ui/.env.local`, `contracts/scripts/test-hardened.js:18-25`
- finding: README/.env/.env.local agree on Vault=`0x261c4b5a...`. `test-hardened.js` uses Vault=`0x5E7DD352...`. No `contracts/deployments/421614.json` exists for arb-sepolia.
- trigger: confusion about which deployment is canonical; tests target a stale deployment
- recommendation: standardize on `contracts/deployments/<chainId>.json` for every chain. The deploy script should write this file unconditionally. Update test scripts to read from the deployment file.

**R-035 — Live test confirms cross-user withdrawal bug in LendingPool**

- file: `contracts/scripts/test-sharp.jsonl` (last line) — `❌ Pool.withdraw t1 cannot take t2 supply: DID NOT REVERT — expected "Exceeds supply"`
- finding: test asserted that user t1 cannot withdraw against user t2's supply. The assertion failed against the live arb-sepolia deployment — t1 successfully withdrew.
- trigger: any user can withdraw using another user's encrypted balance handle (FHE handle isolation may not hold if signed metadata is reused)
- tested: yes — adversarial test caught it
- recommendation: review LendingPool.withdraw line 159-177 — `plainSupplyBalances[token][msg.sender]` is checked against amount, but if user t1 has 0 plain balance and successfully avoids the revert, encrypted state may drift. Determine the actual exploit path from the test record and patch.

**R-036 — Backend test coverage is privara-only**

- file: `backend/apps/src/*/__tests__/` (only `privara/` has them)
- finding: 9 modules have zero tests; only privara has any backend tests, and those test the mock layer.
- trigger: any change to non-privara modules ships untested
- recommendation: minimum: add controller-level smoke tests for each module. Critical: gemini-ai.service.ts, defi_strategies/\* (simulation engine), strategies/strategy.service.ts.

### LOW impact

**R-017 — Unused state variables in StrategyRegistry**

- file: `contracts/contracts/StrategyRegistry.sol:41, 43`
- finding: `lastDailyReset` (line 41) and `dailyVolume` (line 43) declared with VULN-FIX comments but never read or written
- trigger: dead state, gas waste on storage allocation
- recommendation: remove (or use them for the daily-volume rate-limit pattern from PrivaraPaymentRouter).

**R-037 — Numerous slither LOW findings on missing-zero-check**

- files: 8+ instances flagged by slither
- finding: setters like `setExecutor`, `setRegistry`, `setEmergencyWithdrawer`, `setVault` accept address(0) without check
- trigger: owner mistake → contract becomes inoperable
- recommendation: add `if (newAddr == address(0)) revert ZeroAddress();` to all admin setters.

**R-038 — Numerous slither LOW findings on timestamp comparisons**

- files: SwapRouter, PrivaraEscrowManager, PrivaraStrategyVault, PrivaraPaymentRouter, ZKVerifier
- finding: many `block.timestamp >= deadline` style comparisons
- trigger: miner manipulation of timestamp by ±15s
- recommendation: in most cases (deadlines), 15s manipulation is acceptable. Document the assumption.

**R-039 — Reentrancy-events findings on FHE.asEuint128 calls in submit/execute paths**

- files: SwapRouter, PrivaraPaymentRouter, PrivaraStrategyVault, StrategyRegistry, StrategyVault
- finding: events emitted after external CoFHE calls; if CoFHE is malicious, event order can be manipulated
- trigger: malicious CoFHE TaskManager (currently a single trusted off-chain service)
- recommendation: trust assumption — the CoFHE TaskManager is part of the system's TCB. Document this trust assumption.

---

## 9. PATTERN INDEX

### Architectural patterns observed

| Pattern                                      | File evidence                                                                                           | Notes                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Monorepo (Bun workspaces)                    | root `package.json:3` workspaces array; `bun.lock`                                                      | 3 workspaces                                                         |
| Domain-Driven Design                         | `backend/apps/src/<module>/{application,domain,infrastructure,interfaces}`                              | applied uniformly across 10 modules                                  |
| Repository pattern                           | `*.repository.impl.ts` files (18 of them)                                                               | provider tokens like `'IPrivaraRepository'` (privara.module.ts:36)   |
| Plain-encrypted dual bookkeeping (FHE)       | `LendingPool.sol:18-25` + `StrategyVault.sol:59,65`                                                     | encrypted handles for confidentiality, plaintext for transfer gating |
| FHE ACL pattern                              | `FHE.allowThis` + `FHE.allowSender` + `FHE.allowTransient` throughout core contracts                    | every encrypted state mutation does both                             |
| Lazy-loaded module initializer               | `fhenix-provider.tsx:48-59`                                                                             | avoids circular init at module level                                 |
| ReactFlow node-based DSL                     | `ui/app/builder/components/nodes/*` + `ui/lib/defi-{node-factory,connection-rules,workflow-builder}.ts` | strategy-as-data-graph                                               |
| LLM prompt-to-structure                      | `gemini-ai.service.ts` + `strategy-parser.service.ts`                                                   | NL → typed strategy steps                                            |
| Class-validator DTOs + global ValidationPipe | `main.ts:38` + `*.dto.ts` files                                                                         | fail-fast input validation                                           |
| OpenZeppelin guard patterns                  | ReentrancyGuard (5 contracts) + Ownable (4 contracts)                                                   | standard                                                             |

### Anti-patterns observed

| Anti-pattern                                       | File evidence                                                        | Risk ID         |
| -------------------------------------------------- | -------------------------------------------------------------------- | --------------- |
| Dead-code "VULN-FIX" annotations                   | `StrategyVault.sol:186-199`, `StrategyRegistry.sol:41-43`            | R-019, R-017    |
| Stub-as-production (returns true)                  | `ZKVerifier.sol:316-334`, `PrivaraService.*`                         | R-006, R-009    |
| Unsigned-header-as-auth                            | `WalletAuthGuard.canActivate`                                        | R-007           |
| Hardcoded local-chain addresses in production code | `privara.config.service.ts:21-24`                                    | R-022           |
| In-memory rate limit on multi-instance             | `privara-rate-limit.guard.ts`                                        | R-021           |
| Trust-the-executor-to-respect-slippage             | `SwapRouter.executeIntent:181-192`                                   | R-016           |
| Mixed package managers (npm in CI vs Bun locally)  | `ci-cd.yml:35` vs `bun.lock`                                         | R-008           |
| Fake encryption via string concat                  | `PrivaraService:142,183,226`                                         | R-009           |
| Two parallel competing implementations             | FheForge core (working) + Privara (mostly stub)                      | (architectural) |
| Address drift across env/deploy/code               | `README.md` vs `test-hardened.js:18-25` vs `deployments/*.json`      | R-034           |
| Plaintext keys checked in or in-tree env           | `WALLET_CREDENTIALS.txt` + 3 .env files                              | R-001 to R-005  |
| TODO/stubs in flow-critical paths                  | `privara.service.ts:68`, `PaymentRouter.executeConfidentialSwap:177` | R-009, R-014    |
| Dead deps for library bake-off                     | RainbowKit + Privy + MUI all unused                                  | R-031           |
| Duplicate provider chains                          | SupabaseService double-provided                                      | R-029           |
| Shadow CI workflow                                 | ci-cd.yml broken alongside ci.yml working                            | R-008           |

---

## 10. WHAT REMAINS UNKNOWN

| Open question                                                                                                                                               | Why unresolved                                                                                         | What would resolve it                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-1: Does the on-chain CoFHE TaskManager actually reject `signature: bytes("")` from TestHelper-style InEuint128 inputs?                                    | Cannot test from source alone — depends on the live arb-sepolia CoFHE infrastructure runtime.          | Send a tx that calls `TestHelper.supply(...)` against the live deployment and observe whether the off-chain CoFHE host rejects the unsigned input. The README claim relies on this. |
| O-2: Should I add the verification commands in §4.5 to a project `AGENTS.md`?                                                                               | User did not authorize file creation outside dossier.                                                  | User confirmation.                                                                                                                                                                  |
| O-3: Are the live arb-sepolia deployments at the README addresses still funded/reachable?                                                                   | Did not call any RPC.                                                                                  | `cast code 0x261c4b5a... --rpc-url https://sepolia-rollup.arbitrum.io/rpc` — confirms bytecode exists.                                                                              |
| O-4: Is the executor address on `SwapRouter` (currently the deployer EOA) a multisig or a single key?                                                       | Cannot tell from `deploy.ts` alone (passes `deployer.address`).                                        | `cast call 0x78C2818a... "executor()" --rpc-url ...` returns the address; check whether it's a Gnosis Safe.                                                                         |
| O-5: Is `defi_action_required` a real Supabase table created out-of-band (Supabase Studio, manual SQL) that's not reflected in the migrations?              | No way to know without DB access.                                                                      | Connect to Supabase and `\dt` or query `pg_tables`.                                                                                                                                 |
| O-6: Did the test-hardened.js failure on cross-user withdraw (R-035) actually move funds, or just fail to revert?                                           | The .jsonl entry says `DID NOT REVERT` but doesn't show the post-balance check.                        | Re-run test-hardened.js and inspect the next assertion in sequence.                                                                                                                 |
| O-7: Is the previous CODEBASE_MASTERY_DOSSIER.md (60KB, dated 2026-04-24) considered ground truth that should be merged with this one, or fully superseded? | User did not specify. The previous dossier had factual errors (claimed `LendingPool.borrow()` exists). | User direction. (Default action chosen: full overwrite with current evidence.)                                                                                                      |
| O-8: Are there additional production env vars needed by gemini-ai.service.ts beyond GEMINI_API_KEY (e.g., model selection, region)?                         | Not read end-to-end.                                                                                   | Read `gemini-ai.service.ts:1-525` fully.                                                                                                                                            |
| O-9: How are the 9 backend tests in `privara/__tests__/` configured re: Supabase mocking?                                                                   | Not read in detail.                                                                                    | Inspect `privara/__tests__/mocks/`.                                                                                                                                                 |

---

## 11. HANDOFF BRIEF

### The three things most likely to surprise a new agent:

1. **Backend `/api/privara/*` is a mock layer.** `PrivaraService.create*` methods return objects with `encryptedAmount = "encrypted_" + plaintext` and `transactionHash = '0x' + crypto.randomBytes(32).toString('hex')` — no SDK call, no on-chain interaction. The UI happily displays these as real confidential transactions. Any user routed through Privara endpoints is being lied to. <ref_snippet file="/home/eya/archives/refactor/refactor-FheForge-work/backend/apps/src/privara/application/privara.service.ts" lines="138-149" />

2. **`WalletAuthGuard` is not authentication.** It validates the format of the `x-wallet-address` header and trusts it. There is no signature check. Any client can claim any wallet. <ref_snippet file="/home/eya/archives/refactor/refactor-FheForge-work/backend/apps/src/privara/guards/wallet-auth.guard.ts" lines="23-44" />

3. **The UI calls `LendingPool.borrow` which does not exist on the contract.** Any strategy with a BORROW step fails at submit-time. The actual function is `checkLtvAndBorrow` (6 params), not `borrow` (2 params). <ref_snippet file="/home/eya/archives/refactor/refactor-FheForge-work/ui/hooks/use-fhe-vault.ts" lines="148-169" /> versus <ref_snippet file="/home/eya/archives/refactor/refactor-FheForge-work/contracts/contracts/LendingPool.sol" lines="79-124" />

### The file a new agent should read first, and why:

<ref_file file="/home/eya/archives/refactor/refactor-FheForge-work/contracts/contracts/StrategyVault.sol" /> — it's the only on-chain entry point that touches all four FheForge core contracts (StrategyRegistry, LendingPool indirectly via UI flow, SwapRouter via UI flow). Its 250 lines fully demonstrate the FHE pattern (ReentrancyGuard + euint128 + FHE.allowThis/allowSender/allowTransient + IStrategyRegistry call). It also contains the dead `closePosition` debt check (R-019) — reading it teaches both the working pattern and the recurring "dead-VULN-FIX" anti-pattern.

### The highest-risk area to touch first, and why:

The **backend `privara/` module + UI Privara components** are the highest-risk area. Specifically:

- `backend/apps/src/privara/application/privara.service.ts` (R-009: fake operations)
- `backend/apps/src/privara/guards/wallet-auth.guard.ts` (R-007: broken auth)
- `contracts/contracts/PrivaraStrategyVault.sol` (R-010, R-011, R-012: cross-user withdrawal, broken permits, balance leak)
- `contracts/contracts/PrivaraPaymentRouter.sol` (R-013, R-014: broken compliance, no-op swap)
- `contracts/contracts/ZKVerifier.sol` (R-006: stub)

Either fix these to be real or remove the Privara surface entirely. The current state (Privara endpoints exist, are reachable, return fake successes) is worse than either alternative because it presents a false security posture to users.

### The tests that actually tell you if something is broken:

- `cd contracts && node scripts/test-hardened.js` — full live arb-sepolia adversarial sweep. The README's "108 PASS / 7 VULN" headline comes from here. Re-running this is the canonical health check for the FheForge core contracts.
- `cd contracts && node scripts/test-sharp.js` — focused tests; the failure mode is recorded in `test-sharp.jsonl` (R-035 cross-user withdrawal bug).
- `cd contracts && npx hardhat test test/integration/full-flow.test.ts` — Privara stack integration.
- `cd ui && bun run test ui/__tests__/integration/privara-flow.test.tsx` — UI-side Privara flow.
- `cd ui && bun run test ui/components/shared/__tests__/execution-modal.test.tsx` — execution modal smoke (catches R-005 chainId default).

The CI pipeline that matters is `.github/workflows/ci.yml` (compile + test + build). `.github/workflows/ci-cd.yml` is broken (R-008) and should be considered noise.

### What is not tested that definitely should be:

| Test missing                                                       | Risk  | What to add                                                                                          |
| ------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------- |
| `PrivaraStrategyVault.confidentialWithdraw` cross-user adversarial | R-010 | T1 deposits, T2 withdraws T1's funds — must revert                                                   |
| `PrivaraStrategyVault` end-to-end permit flow                      | R-011 | createPermit → off-chain sign → usePermit — must succeed; createPermit alone → usePermit must revert |
| `SwapRouter.submitSwapIntentTrivial` exclusion from production     | R-015 | gate the function and add a test that it reverts on non-localhost                                    |
| `SwapRouter.executeIntent` slippage adversarial                    | R-016 | executor calls with outputAmount < minAmountOut — must revert (currently passes)                     |
| `LendingPool.checkLtvAndBorrow` plaintext vs encrypted drift       | R-028 | submit encBorrowAmount=N, borrowAmount=0 — encrypted state must NOT increment                        |
| `StrategyVault.closePosition` with non-zero debt                   | R-019 | open position with debt, attempt closePosition — must revert                                         |
| Backend `/api/privara/*` real auth                                 | R-007 | spoof x-wallet-address as victim — must reject without signature                                     |
| Backend rate-limit cross-instance                                  | R-021 | (requires multi-instance harness)                                                                    |
| `LendingPool.borrow` (the nonexistent function)                    | R-023 | UI integration test that submits BORROW step — must surface clear error                              |
| Coverage for non-privara backend modules                           | R-036 | unit + controller smoke tests for ai-strategy-builder, defi_strategies, strategies, users            |

---

_End of dossier. 11 sections, 535 files manifested, 84 slither findings + 408 lint problems + 18 TSC errors + 3 semgrep findings catalogued, 39 risk register entries, 17 cross-layer contracts mapped, 5 flow traces. Zero unvisited or in-progress files in the manifest._
