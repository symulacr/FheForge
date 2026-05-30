# FheForge — FINAL 96-Step Execution Plan (May 29 → June 1)

**Target:** Akindo Wave Hacks Final Wave — 45,000 USDC pool  
**Submission:** FheForge ONLY (one flagship)  
**Deadline:** June 1 15:15 UTC  
**Deployer key:** `[REDACTED - use environment variables]`  
**All tester keys identical** to deployer key (accepted for hackathon)  
**License:** MIT + Apache 2.0 dual  

## Decisions Made (91 questions across 24 waves)

| Wave | Key Decisions |
|------|--------------|
| 1 | FheForge ONLY submission, frontend full rewrite, re-deploy Vercel, hybrid video |
| 2 | Re-deploy ALL 9 contracts, understand forge-deploy.ts first, EOA owner, add FHESafeMath guard, live FHE.eq test |
| 3 | Keep forge-deploy as-is, accept same keys, Router address is naming-drift cruft, live FHE test = match + mismatch |
| 4 | Remove dead ROUTER alias, standalone FHE.eq test (real not mock), all 3 test gaps, add gas report to README |
| 5 | Fix AI Builder (real Gemini, no stubs), re-deploy backend with fixes, use @cofhe/react hooks from selective-disclosure, full walkthrough demo |
| 6 | Move research files to docs/archive, deploy governance contracts, screenshots from localhost, add defense text to Known Issues |
| 7 | Full static analysis (slither+solhint+aderyn), real testnet test, deployer as executor, upgrade to 0.5.2 (already there) |
| 8 | Run all static analysis, deployer as executor, keep Solidity 0.8.28, deploy 12 contracts (9 main + 3 governance) |
| 9 | 2-3min video, rewrite README, 13 contracts on Arbiscan, <0.5 ETH deploy gas |
| 10 | Add full CI pipeline, keep all git history, testnet only, tag `fheforge-v1.2` |
| 11 | Use impeccable skill for frontend, responsive design, keep RainbowKit, English only |
| 12 | Deep fuzz, run Certora prover, 100% forge coverage |
| 13 | Leave cloned repos as-is, remove dead monitoring config, add Sentry, pg_dump backup |
| 14-24 | GitHub alerts for Known Issues, write demo script, tag FHE tests, dual license, README gas table + JSON, add COOP/COEP headers, improve forge-test for all 13 contracts, Swagger enabled, no throttle for hackathon |

---

## Phase 0: Preparation (Hours 0-1) — 4 steps

**Step 1:** Verify environment compiles (15 min)
```
forge build --force && npx hardhat compile
```

**Step 2:** Run baseline test suite, record pass/fail (15 min)
```
forge test -vvv && npx hardhat test
```

**Step 3:** Git tag + backup branch (15 min)
```
git tag fheforge-pre-fix
git checkout -b fix/critical-bugs
```

**Step 4:** Take pg_dump of Supabase DB (15 min)
```
pg_dump $SUPABASE_DB_URL > backup/2026-05-29-pre-migration.sql
```

---

## Phase 1: Smart Contract Bug Fixes (Hours 1-10) — 12 steps

**Step 5:** Fix `_verifyEquality` in `shield()` — move check before `safeTransferFrom` (30 min)
File: `contracts/contracts/LendingPool.sol:77-91`

**Step 6:** Fix `_verifyEquality` in `repayDebt()` — move before transfer (30 min)
File: `LendingPool.sol:132-151`

**Step 7:** Fix `_verifyEquality` in `borrowWithLtvCheck()` — gate plain accounting + transfer after FHE LTV check (45 min)
File: `LendingPool.sol:93-130`

**Step 8:** Fix `_verifyEquality` in `borrowWithOracle()` — same reorder (30 min)
File: `LendingPool.sol:315-345`

**Step 9:** Fix `_verifyEquality` in `_withdrawCore()` → `partialUnshield()` — move before `liquidReserve` update (30 min)
File: `LendingPool.sol:154-182`

**Step 10:** Gate `requestLiquidityCheck` — add `msg.sender == user` check (30 min)
File: `LendingPool.sol:411-420`

**Step 11:** Remove `getDepositedAmount` + deprecate `positionDepositedAmount` mapping (30 min)
File: `StrategyVault.sol:235`

**Step 12:** Add `allowPublic` cooldown to `requestBalanceReveal` / `requestBorrowReveal` (30 min)
File: `LendingPool.sol:184,222`

**Step 13:** Add `nonReentrant` to all SwapRouter functions + fix CEI in `executeIntent` (1h)
File: `SwapRouter.sol`

**Step 14:** Add `_verifyEquality` to StrategyExecutor before all forwarded actions (1h)
File: `StrategyExecutor.sol` — all 6 action types

**Step 15:** Add `_validateCiphertext` + `FHE.isInitialized` to all incoming encrypted handles (30 min)
File: `FheForgeBase.sol`

**Step 16:** Add overflow guard to `FHESafeMath128.tryIncrease` (30 min)
File: `libraries/FHESafeMath128.sol`

**Step 17:** Run `forge build --force` after changes, fix errors (30 min)

---

## Phase 2: Backend Fixes (Hours 10-16) — 8 steps

**Step 18:** Replace in-memory nonce Map with Supabase `auth_nonces` table (2h)
File: `backend/apps/src/auth/auth.service.ts`
- Migration: `003_auth_nonces.sql`
- Rewrite `generateNonce()` + `validateNonce()` with upsert + delete

**Step 19:** Add JWT `algorithms: ['HS256']` restriction (15 min)
File: `backend/apps/src/auth/jwt.strategy.ts`

**Step 20:** Write migration DDL for 12 missing tables (2h)
File: `backend/apps/migrations/004_full_schema.sql`
- users, strategies, defi_strategies, defi_strategy_versions
- defi_strategy_executions, defi_execution_step_results
- defi_strategy_simulation_snapshots, defi_modules
- defi_module_actions, defi_pairs, defi_token, activities

**Step 21:** Fix event indexer gap handling — auto-clamp to 128-block retention (30 min)
File: `backend/apps/src/event-indexer/event-indexer.service.ts`

**Step 22:** Fix /health caching — 30s cache for RPC health (15 min)
File: `backend/apps/src/app.controller.ts`

**Step 23:** Remove global throttle for hackathon, keep AI builder 5/min limit (15 min)
File: `backend/apps/src/app.module.ts`

**Step 24:** Fix CORS — fail on missing ALLOWED_ORIGINS in production (15 min)
File: `backend/apps/src/main.ts`

**Step 25:** Enable Swagger at /api/docs for judge review (15 min)
File: `backend/apps/src/main.ts`

---

## Phase 3: Static Analysis + Linting (Hours 16-20) — 6 steps

**Step 26:** Run `solhint 'contracts/**/*.sol'` — fix findings (30 min)

**Step 27:** Run Slither on all contracts (1h)
```
slither . --exclude-dependencies --print human-summary
```

**Step 28:** Run Aderyn (30 min)
```
aderyn .
```

**Step 29:** Run `forge coverage --report lcov` — target 100% (1h)
```
forge coverage --report lcov --min-coverage 100
```

**Step 30:** Run `biome check --fix .` — format all files (30 min)

**Step 31:** Add GitHub Actions CI: lint → type-check → test → build → coverage (1h)
File: `.github/workflows/ci.yml`

---

## Phase 4: Frontend Rewrite (Hours 20-36) — 12 steps

**Step 32:** Create fresh `ui/src/lib/cofhe-client.ts` — based on selective-disclosure patterns + @cofhe/react hooks (1h)
- `initCofheClient()` with `createCofheConfig()`, `Ethers6Adapter()`
- `encryptUint128()`, `encryptUint64()` — correct types per ABI
- `decryptForView()`, `decryptForTx()` helpers

**Step 33:** Rewrite `useFheVault` — fix Encryptable types per contract ABI (2h)
- `repayDebt` / `partialUnshield` / `shieldEth` / `partialUnshieldEth` → `Encryptable.uint64()`
- All other functions → `Encryptable.uint128()`
- Add missing `try/finally` on `closePosition`, `withdrawEth`, `submitSwapIntent`

**Step 34:** Add `decryptForTx` helper to `useLendingActions` for liquidation proofs (1h)
File: `ui/hooks/use-lending-actions.ts`

**Step 35:** Add `permitReady` guard to `requestLiquidityCheck` frontend call (15 min)

**Step 36:** Fix strategy builder — remove false "success" toast, check tx receipt (1h)
File: `ui/hooks/use-strategy-builder.ts`

**Step 37:** Remove dead `NEXT_PUBLIC_ROUTER_ADDRESS` alias, consolidate to `SWAP_ROUTER_ADDRESS` only (30 min)
- Update getContractAddresses in addresses.ts
- Update all hook references
- Update forge-deploy.ts ENV_KEYS

**Step 38:** Fix AI Strategy Builder — make Gemini integration real, fix StrategyPromptDetails stub (2h)
File: `ui/app/prompt/PromptPage.tsx`, `backend/apps/src/ai-strategy-builder/`

**Step 39:** Add COOP/COEP headers in `next.config.js` + `vercel.json` for CoFHE Wasm (30 min)
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Step 40:** Add loading skeletons for all async FHE operations (1h)
- Deposit flow, borrow flow, portfolio load, AI builder

**Step 41:** Add user-facing error toasts for all failures (30 min)
- Replace raw console.error with sonner toast.error

**Step 42:** Show both encrypted (truncated handle) + decrypted (on permit) balance states (1h)

**Step 43:** Responsive design — collapsible sidebar navigation, mobile layout (1h)

---

## Phase 5: Tests — Real FHE + Full Coverage (Hours 36-48) — 10 steps

**Step 44:** Write privacy attack vector test (1.5h)
File: `contracts/test-foundry/FhePrivacyAttacks.t.sol`
- Unauthorized call to `requestLiquidityCheck` → revert
- `getDepositedAmount` removed → revert
- `_verifyEquality` failure → no token transfer

**Step 45:** Write executor bypass tests (1.5h)
File: `contracts/test-foundry/StrategyExecutorBypass.t.sol`
- StrategyExecutor calls without `_verifyEquality` → reverted
- Silent skip of unknown action type → reverted

**Step 46:** Write governance contract tests (2h)
File: `contracts/test-foundry/FheForgeGovernor.t.sol`
- Token deploy → delegate → propose → vote → queue → execute

**Step 47:** Write live FHE.eq test on Arb Sepolia (2h)
File: Add to existing `forge-test.ts` or standalone script
- Encrypt value=42, call FHE.eq on real CoFHE TaskManager
- Verify match (42==42 → true), mismatch (42!=43 → false)
- Record tx hash as judge evidence

**Step 48:** Review ALL existing tests — replace mock/cheat FHE with real FHE ops (3h)
- 22 files currently use mock FHE only — convert critical paths to use CoFHE SDK
- Tag tests: `[REAL]` for real FHE, `[MOCK]` for mock-only

**Step 49:** Upgrade forge-test.ts to test ALL 13 contracts with real Arb Sepolia txns (3h)
- Add tests for governance contracts
- Add SwapRouter intent flow
- Add StrategyExecutor composed strategy
- Capture tx hashes for every scenario

**Step 50:** Run deep fuzz testing (1h)
```
forge test -vvv --fuzz --fuzz-runs 10000
```

**Step 51:** Run Certora prover on existing CVL specs (2h)
```
certoraRun LendingPool.sol --verify LendingPool:LendingPool.spec
```
Fix known violations (StateMutationOrdering, shield_verifyEqualityBeforeTransfer, etc.)

**Step 52:** Run full gas benchmarks (30 min)
```
cd contracts && npx hardhat run scripts/gas-benchmarks.ts --network arb-sepolia
```

**Step 53:** Run full forge-test.ts against deployed Arb Sepolia (post-deploy) (1h)
```
npx hardhat run scripts/forge-test.ts --network arb-sepolia
```

---

## Phase 6: Deploy to Arbitrum Sepolia (Hours 48-54) — 6 steps

**Step 54:** Update forge-deploy.ts — add governance deploy (Token → Timelock → Governor) with wiring (1h)
File: `contracts/scripts/forge-deploy.ts`
- Deploy FheForgeToken → constructor: name, symbol
- Deploy FheForgeTimelock → constructor: minDelay, proposers, executors
- Deploy FheForgeGovernor → constructor: token, timelock, votingDelay, votingPeriod, quorum
- Wire: grant PROPOSER_EXECUTOR_ROLE to Governor
- Transfer timelock admin to Governor

**Step 55:** Fund deployer wallet on Arb Sepolia — check balance, faucet if needed (15 min)
```
cast balance <DEPLOYER_ADDRESS> --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

**Step 56:** Run forge-deploy.ts — all 12+ contracts in one command (2h)
```
DEMO_MODE=1 SYNC_ABIS=1 npx hardhat run scripts/forge-deploy.ts --network arb-sepolia
```

**Step 57:** Verify all 13 contracts on Arbiscan (1h)
- forge-deploy.ts auto-verifies via FastVerifier
- Confirm 13/13 verified: LendingPool, StrategyVault, Composer, SwapRouter, PriceOracle, Registry, StrategyExecutor, ExecutorContract, TokenRegistry + Governor, Timelock, Token, FheForgeBase (inherited)

**Step 58:** Sync ABIs to frontend (SYNC_ABIS=1 already in deploy step) (5 min)

**Step 59:** Update frontend .env + backend .env with new deployment addresses (15 min)
```
cp contracts/deployments/421614.env ui/.env.local
```

---

## Phase 7: Post-Deploy Verification (Hours 54-58) — 5 steps

**Step 60:** Run forge-test.ts against live Arb Sepolia deployment (1h)
```
npx hardhat run scripts/forge-test.ts --network arb-sepolia
```

**Step 61:** Run gas benchmarks against live network (30 min)
```
npx hardhat run scripts/gas-benchmarks.ts --network arb-sepolia
```

**Step 62:** Manually verify: connect wallet → deposit → borrow → view portfolio on local frontend (30 min)

**Step 63:** Manually verify: AI strategy builder → generate strategy → review → deploy (30 min)

**Step 64:** Run full CI pipeline (trigger GitHub Actions) — all tests passing (30 min)

---

## Phase 8: Documentation + README Rewrite (Hours 58-66) — 8 steps

**Step 65:** Rewrite README completely — concise, judge-optimized (3h)
Structure:
1. **Title + badges**:
   ```
   # 🏗️ FheForge — Private, Encrypted DeFi on Arbitrum Sepolia
   ```
   Badges: Solidity 0.8.28, Next.js 14, NestJS 11, FHE/CoFHE, Fhenix, Arbitrum Sepolia, MIT+Apache 2.0, Akindo Wave Hacks

2. **Elevator pitch** (3 lines — no jargon):
   "FheForge is the first encrypted DeFi protocol where you supply, borrow, swap, and automate strategies — every amount stays encrypted on-chain. Only you control who can decrypt and verify your position."

3. **Problem** (5 lines): glass house DeFi, front-running, MEV, institutional barrier

4. **Why FHE** (table + FHESafeMath128.tryDecrease code snippet)

5. **Architecture diagram** (mermaid, keep current)

6. **Deployed contracts** (13 verified on Arbiscan table)

7. **Gas benchmarks** (table: per-operation costs)

8. **Screenshots** (4 images: dashboard, deposit, builder, liquidation)

9. **Demo video** (`[▶️ Watch Demo (2 min)](https://youtu.be/...)`)

10. **Known Issues** (GitHub alert blocks — add defense paragraph per issue)

11. **Team** (@symulacr with bio)

12. **Quick Start** (fix: add .env step, replace test-hardened.js with forge test)

**Step 66:** Add gas benchmark table to README + keep `gas_benchmarks.json` (30 min)

**Step 67:** Add defense paragraphs to Known Issues using GitHub alert blocks (30 min)
```markdown
> [!WARNING]
> **`_verifyEquality` consistency check (not ZK proof)**  
> The `_verifyEquality` function verifies that caller-provided ciphertext matches the claimed plaintext using `FHE.eq`. This is a consistency check, not a cryptographic proof — a malicious caller could provide a mismatched pair, but the ciphertext (the value that persists in encrypted state) would still be what the user encrypted. Token transfers are now gated to execute AFTER the equality check, preventing fund loss on mismatch. Full ZK proof-of-equality is planned post-MVP.
```

**Step 68:** Take 4 screenshots of localhost app with wallet connected (30 min)
- Dashboard with portfolio overview
- Deposit collateral flow showing encrypted amount
- AI Strategy Builder with generated strategy
- Liquidation with permit/decryption

**Step 69:** Move 15+ research .md files from root to `docs/archive/` (15 min)

**Step 70:** Write demo script `docs/fheforge-demo-script.md` (1h)
- Scene 1 (0:00-0:20): Problem — DeFi has no privacy
- Scene 2 (0:20-0:45): FHE solution — encrypted amounts
- Scene 3 (0:45-1:45): Live app demo — connect → deposit → borrow → portfolio
- Scene 4 (1:45-2:15): Architecture — contract diagram, FHE ops
- Scene 5 (2:15-2:30): Team + call to action

**Step 71:** Add Sentry initialization in both frontend + backend (15 min)

**Step 72:** Clean up: remove dead monitoring config, keep only working Prometheus/Grafana (15 min)

---

## Phase 9: Demo Video + Submission (Hours 66-72) — 6 steps

**Step 73:** Create Remotion project with hybrid animation + recording (3h)
```
npx create-video@latest fheforge-demo
```
Scenes:
- Animated title + problem statement (Remotion spring animations)
- 10-15s screen recording of live app flow (connect → deposit → borrow → portfolio)
- Architecture diagram animation
- Team + links

**Step 74:** Render + upload demo video (30 min)
```
npx remotion render src/index.ts FheForgeDemo fheforge-demo.mp4
```
Upload to Loom as unlisted, get link for README

**Step 75:** Create git tag for submission (5 min)
```
git tag fheforge-v1.2
git push origin fheforge-v1.2
```

**Step 76:** Deploy frontend to Vercel with updated env vars (30 min)
```
cd ui && vercel --prod
```
Verify: COOP/COEP headers present, CoFHE Wasm works, wallet connects to Arb Sepolia

**Step 77:** Re-deploy backend to Railway with fixes (30 min)
```
cd backend/apps && railway up
```
Verify: `/health` responds, `/api/docs` shows Swagger, auth works with DB-backed nonces

**Step 78:** Submit on Akindo platform (30 min)
- Project name: "FheForge — Encrypted DeFi on Fhenix"
- Category: Confidential DeFi
- Tags: #FHE #CoFHE #Fhenix #encrypted-defi #privacy #Arbitrum
- Demo URL: Vercel deployment
- GitHub URL: `https://github.com/symulacr/FheForge`
- Description: Reuse README content
- Attach link to demo video

---

## Phase 10: Buffer + Polish (Hours +12 buffer) — 18 steps

**Steps 79-96:** Buffer items (do if time remains):
79. Run `pnpm audit --audit-level=high` — fix CVEs
80. Verify `pnpm-lock.yaml` is committed (not gitignored)
81. Add `.env.example` files in all packages that reference env vars
82. Write CLAUDE.md for AI-assisted development
83. Update CHANGELOG with v1.2 release notes
84. Verify all 22 pre-submission checklist items from WAVE8_review_checklist.md
85. Final forge + hardhat test run — zero failures
86. Final POSTFIX probe against live deployment
87. Open submission page cold as judge — verify it sells itself in 2 min
88. Respond to any Akindo team questions
89. Check Arbiscan: all 13 contracts verified
90. Check Vercel: COOP/COEP headers present via curl
91. Check Railway: health endpoint returns real status
92. Verify demo video link works in README
93. Verify screenshots render in README
94. Push final commit + tag to GitHub
95. Celebrate submission 🎉
96. Plan post-submission: rotate deployer key, write remaining CVL specs, mainnet launch prep

---

## Key Files Reference

| File | Phase | Purpose |
|------|-------|---------|
| `LendingPool.sol` | P1 | Fix 6 _verifyEquality call sites + requestLiquidityCheck ACL |
| `StrategyVault.sol` | P1 | Remove getDepositedAmount |
| `SwapRouter.sol` | P1 | Add nonReentrant + fix CEI |
| `StrategyExecutor.sol` | P1 | Add _verifyEquality before all actions |
| `FheForgeBase.sol` | P1 | Add _validateCiphertext |
| `FHESafeMath128.sol` | P1 | Add overflow guard |
| `auth.service.ts` | P2 | Replace in-memory Map with DB |
| `event-indexer.service.ts` | P2 | Fix gap handling |
| `migrations/*.sql` | P2 | Write 12 missing table DDLs |
| `next.config.js` | P4 | Add COOP/COEP headers |
| `app/src/lib/cofhe-client.ts` | P4 | Fresh CoFHE SDK client |
| `use-fhe-vault.ts` | P4 | Fix Encryptable types |
| `README.md` | P8 | Full rewrite |
| `forge-deploy.ts` | P6 | Add governance deploy |
| `forge-test.ts` | P5 | Cover all 13 contracts |

---

## Resource Checklist

| Item | Status |
|------|--------|
| Deployer private key | ✅ `0xe6868d...c547ba` |
| Etherscan API key | ✅ `5QHW8JJHR3C5U65HGBYVD4VRXANWRIRFM7` |
| Arb Sepolia ETH | Need to check balance |
| Tester private keys | ✅ (same as deployer) |
| Vercel account | Needs setup |
| Railway account | Needs setup |
| Supabase project | Existing — backup before changes |
| FFmpeg (Remotion) | `sudo apt install ffmpeg` |
| Loom/OBS account | For screen recording |
| GitHub token | For CI pipeline |
| Slither | `pip install slither-analyzer` |
| Aderyn | `cargo install aderyn` |
| Certora CLI | `pip install certora-cli` + CERTORAKEY |
