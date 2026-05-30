# CONTINUATION GOAL: FheForge Akindo Final Wave — Complete Remaining Steps

## IDENTITY
You are the Continuation Agent. Your job is to execute ALL remaining steps from `docs/EXECUTION_PLAN_72H.md` that prior agents could not complete due to infrastructure constraints. You have 96 steps total from the plan. ~79 are DONE. ~17 remain BLOCKED by infrastructure (testnet deployment, demo video, submission).

You also MUST think outside the box: find things the prior analysis missed, fix pre-existing issues, and surface anything that would embarrass the submission.

---

## ENVIRONMENT

### Repo root
```
/home/eya/archives/refactor/refactor-FheForge-work
```

### Deployer credentials (from contracts/.env)
```
PRIVATE_KEY=[REDACTED - use environment variables]
DEPLOYER_PRIVATE_KEY=[REDACTED - use environment variables]
TESTER1-3_PRIVATE_KEY=SAME AS DEPLOYER
ETHERSCAN_API_KEY=5QHW8JJHR3C5U65HGBYVD4VRXANWRIRFM7
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
```

### Currently deployed (from ui/.env.local + backend/.env.development)
```
LendingPool:        0x6903df3E8f45497C3097A16E534787D6Fc9F58eF (verified)
StrategyVault:      0xf3cB0A1b02128C630C2bca9b50151FbC350f6AFC (verified)
FheForgeComposer:   0x65dB0572076f14b838327F5C2513f32b927Ec36E (verified)
SwapRouter:         0x1136E5eF8bB8E189aE83894eCB2F0c67E3097Ea1 (verified)
PriceOracle:        0xFB8fb4232f70bF41750515F54861b0698938ceDe (verified)
StrategyRegistry:   0xC1256f738f1bF9D08F8168eE48e34d4E929DDE9C (verified)
StrategyExecutor:   0x9eCC8c61F65EBB652d3DfA3A32Eac08487CC1e00 (verified)
TokenRegistry:      0x7aF5d7E762D895C917EA3c9e72Ca134176A32AD3 (verified)
ExecutorContract:   0x80EF32CE77f5DC7aA92d200f36357cd83ef8407D (unverified - EIP-1167 proxy)
```

### Git tags
```
fheforge-v1.2-submission (latest)
fheforge-pre-fix (baseline)
```

---

## COMPLETED STEPS (79/96 — do NOT redo)

### Phase 0: Prep — 4/4 DONE
- forge build works (--no-cache), remappings fixed
- 350/352 tests passing (2 pre-existing FuzzPriceOracle precision issues)
- git tag fheforge-pre-fix + fix/critical-bugs branch
- pg_dump: **NOT DONE** (no SUPABASE_DB_URL env var)

### Phase 1: Contract Fixes — 13/13 DONE (CONFIRMED BY AUDIT)
Every fix verified by reading actual Solidity code. Changes present in LendingPool.sol, StrategyVault.sol, SwapRouter.sol, StrategyExecutor.sol, FheForgeBase.sol, FHESafeMath128.sol.

### Phase 2: Backend — 8/8 DONE (CONFIRMED BY AUDIT)
Auth nonce DB migration, JWT alg restrict, event indexer gap fix, health cache, throttle relaxed, CORS hardened, Swagger enabled, 12-table DB migration (004_full_schema.sql, 160 lines).

### Phase 3: Static Analysis — 4/6 DONE, 2 PARTIAL
- solhint: RUN (42 findings, mostly prettier formatting — fixable)
- Slither: RUN (107 findings — report at /tmp/review-repos/STEP27_slither.md)
- Aderyn: RUN (4 High, 17 Low — report at STEP28_aderyn.md)
- forge coverage: RUN (86.6% core, target was 100%)
- biome format: RUN (165 files auto-fixed)
- CI pipeline: EXISTS (14 jobs, 4 stages — verified)

### Phase 4: Frontend — 6/10 DONE, 4 PARTIAL
- cofhe-client.ts: CREATED
- Encryptable types: FIXED (uint128/uint64 per ABI)
- decryptForTx helper: ADDED (prepareLiquidationProof) 
- permitReady guard: ADDED (requestLiquidityCheck)
- Toast fix: APPLIED (tx receipt check before success)
- ROUTER alias: REMOVED (consolidated to SWAP_ROUTER)
- COOP/COEP: ADDED (headers in next.config.js + vercel.json)
- **PARTIAL:** AI Builder (StrategyPromptDetails stub still exists)
- **PARTIAL:** Loading skeletons, error toasts, balance states, responsive

### Phase 5: Tests — 4/10 DONE, 2 PARTIAL, 6 NOT STARTED
- FhePrivacyAttacks.t.sol: WRITTEN (3 tests — mock ACL issues)
- StrategyExecutorBypass.t.sol: WRITTEN (8 tests)
- FheForgeGovernor.t.sol: WRITTEN (full lifecycle)
- forge-test.ts: EXISTS (needs upgrade for governance)
- **NOT STARTED:** Live FHE.eq test (need real Arb Sepolia)
- **NOT STARTED:** Test annotations (REAL/MOCK tagging)
- **NOT STARTED:** Deep fuzz, Certora, gas benchmarks, full forge-test live

### Phase 8: Docs — 5/6 DONE, 1 PARTIAL
- README: REWRITTEN (gas table, defense paragraphs, deployed contracts table, badges)
- Demo script: WRITTEN (docs/fheforge-demo-script.md, 5 scenes, 2:30)
- Monitoring alerts: CLEANED (removed dead system alerts)
- LICENSE: DUAL (MIT + Apache 2.0)
- **PARTIAL:** Screenshots (files on disk as placeholder text, not actual images)

---

## REMAINING: 17 BLOCKED STEPS

### BLOCKER GROUP 1: Deploy to Arbitrum Sepolia (Steps 54-59)
**These must be done FIRST — everything else depends on them.**

```
Step 54: Update forge-deploy.ts for governance
  STATUS: ALREADY DONE — forge-deploy.ts lines 310-355 already has full governance deployment
  (Token → Timelock → Governor with role wiring). Verify it works in a dry run.

Step 55: Fund deployer wallet
  COMMAND: cast balance <DEPLOYER_ADDRESS> --rpc-url https://sepolia-rollup.arbitrum.io/rpc
  PRIVATE_KEY: [REDACTED - use environment variables]
  DERIVE_ADDRESS: cast wallet address --private-key [REDACTED - use environment variables]
  If balance < 0.1 ETH, get from Arb Sepolia faucet: https://www.alchemy.com/faucets/arbitrum-sepolia
  Expected cost: < 0.5 ETH for 12+ contracts + verification.

Step 56: Run forge-deploy
  COMMAND: DEMO_MODE=1 SYNC_ABIS=1 npx hardhat run scripts/forge-deploy.ts --network arb-sepolia
  Deploys: LendingPool, StrategyVault, Composer, SwapRouter, Oracle, Registry,
  Executor, TokenRegistry, StrategyExecutor + FheForgeToken, FheForgeTimelock, FheForgeGovernor
  = 12+ contracts total

Step 57: Verify 13 contracts on Arbiscan
  forge-deploy.ts auto-verifies via FastVerifier. Confirm 12/12 or 13/13 verified.
  ExecutorContract is EIP-1167 proxy — skip verification.

Step 58: Sync ABIs (SYNC_ABIS=1 already in deploy command)
Step 59: Update .env files
  COMMAND: cp contracts/deployments/421614.env ui/.env.local
  Also update: backend/apps/.env.development
```

### BLOCKER GROUP 2: Post-Deploy Verification (Steps 60-64)
```
Step 60: forge-test.ts against live Arb Sepolia
  COMMAND: npx hardhat run scripts/forge-test.ts --network arb-sepolia
  NOTE: Upgrade forge-test.ts FIRST to test governance contracts too (Step 49)

Step 61: Gas benchmarks live
  COMMAND: npx hardhat run scripts/gas-benchmarks.ts --network arb-sepolia

Step 62-63: Manual verification
  - Connect wallet → deposit → borrow → view portfolio (Step 62)
  - AI strategy builder → generate → review → deploy (Step 63)

Step 64: GitHub Actions CI pipeline — trigger and verify all passing
```

### BLOCKER GROUP 3: Tests That Need Live Network (Steps 47-53)
```
Step 47: Write live FHE.eq test
  Write a Hardhat test that deploys a trivial contract to Arb Sepolia
  and calls real FHE.eq against the deployed CoFHE TaskManager.
  Verify match (42==42 → true), mismatch (42!=43 → false).
  Record tx hashes as judge evidence.

Step 48: Review all tests — add REAL/MOCK annotations
  Per the plan: tag tests with [REAL] or [MOCK] prefix in test names.
  22 test files need review. Not started.

Step 49: Upgrade forge-test.ts
  Add tests for governance contracts (Token → delegate → propose → vote → queue → execute)
  Add SwapRouter intent flow test
  Add StrategyExecutor composed strategy test

Step 50: Deep fuzz
  COMMAND: forge test -vvv --fuzz-runs 10000
  Note: existing FuzzPriceOracle has 2 pre-existing failures from precision edge cases
  These are marginal cases — accept or fix precision handling.

Step 51: Certora prover
  Certora specs exist at contracts/docs/certora/ but were never executed.
  COMMAND: certoraRun LendingPool.sol --verify LendingPool:LendingPool.spec
  Need CERTORAKEY env var. If not available, document as "post-submission".

Step 52: Gas benchmarks
  COMMAND: npx hardhat run scripts/gas-benchmarks.ts --network arb-sepolia
  Updates contracts/deployments/gas_benchmarks.json

Step 53: forge-test.ts against deployed (same as Step 60)
```

### BLOCKER GROUP 4: Demo Video + Submission (Steps 73-78)
```
Step 73-74: Create Remotion demo video
  COMMAND: npx create-video@latest fheforge-demo
  5 scenes (15s each = 2:30 total):
  - Scene 1: Problem — DeFi has no privacy
  - Scene 2: FHE solution — encrypted amounts
  - Scene 3: Live app — connect → deposit → borrow → portfolio
  - Scene 4: Architecture — contract diagram
  - Scene 5: Team + CTA
  Render: npx remotion render src/index.ts FheForgeDemo fheforge-demo.mp4
  Upload to Loom, get link for README.

Step 75: Git tag update (already exists, update if new deploy)
  COMMAND: git tag -f fheforge-v1.2-submission

Step 76: Deploy frontend to Vercel
  COMMAND: cd ui && vercel --prod
  Verify: COOP/COEP headers present (curl -I), CoFHE Wasm works, wallet connects

Step 77: Deploy backend to Railway
  COMMAND: cd backend/apps && railway up
  Verify: /health responds, /api/docs shows Swagger

Step 78: Submit on Akindo platform
  Project: "FheForge — Encrypted DeFi on Fhenix"
  Category: Confidential DeFi
  Tags: #FHE #CoFHE #Fhenix #encrypted-defi #privacy #Arbitrum
```

### BLOCKER GROUP 5: Buffer Polish (Steps 79-96)
```
79: pnpm audit --audit-level=high — fix CVEs
80: Verify pnpm-lock.yaml committed
81: Add .env.example files for all packages
82: Write CLAUDE.md for AI-assisted development
83: Update CHANGELOG with v1.2 release notes
84: Verify 22-item pre-submission checklist (from WAVE8_review_checklist.md)
85: Final forge + hardhat test run — zero failures
86: POSTFIX probe against live deployment
87: Open submission cold as judge — verify it sells in 2 min
88: Respond to Akindo questions
89: Check Arbiscan: all contracts verified
90: Check Vercel: COOP/COEP headers via curl
91: Check Railway: health returns real status
92: Verify demo video link in README
93: Verify screenshots render in README
94: Push final commit + tag
95: Celebrate 🎉
96: Post-submission: rotate deployer key, CVL specs, mainnet prep
```

---

## THINGS TO FIX / PRE-EXISTING ISSUES

### Must fix before submission:
1. **All 5 tester keys IDENTICAL to deployer key** (contracts/.env lines 19-22)
   - Fix: generate 3 unique test keys, fund them from deployer
2. **SWAP_EXECUTOR_ADDRESS empty** (contracts/.env line 16)
   - Fix: set to deployer address or generate new executor key
3. **WalletConnect project ID placeholder** (ui/.env.local line 36)
   - Fix: replace "your_project_id_here" with real WalletConnect project ID
4. **SENTRY_DSN and GEMINI_API_KEY empty** (backend/.env.development lines 32-33)
   - Fix: add real keys or document "demo mode — not configured"
5. **README demo video link placeholder** (README.md line ~38)
   - Fix: replace `https://youtu.be/your-video-link` with actual video URL
6. **2 pre-existing FuzzPriceOracle test failures**
   - Fix: precision edge case in fuzz converter — either fix or document as false positive

### Think outside the box — things prior audit might have missed:
1. Is there a gas griefing vector in any public nonReentrant function?
2. Do the mock contracts (PoolMock, RouterMock, VaultMock) still match the real contract ABIs after Phase 1 changes?
3. Are there any hardcoded addresses in the frontend that should use env vars?
4. Does the forge-test.ts actually run on real testnet or only localhost?
5. Is the `.env.example` in ui/ still up to date with all required vars?
6. Are there any stale `TODO:` or `FIXME:` comments in the contracts that would look bad to judges?
7. Does the Quick Start in README actually work from scratch?

---

## CRITICAL COMMANDS SUMMARY

```bash
# 1. Check wallet balance
cast wallet address --private-key [REDACTED - use environment variables]
cast balance <ADDRESS> --rpc-url https://sepolia-rollup.arbitrum.io/rpc

# 2. Deploy to testnet (if funded)
cd /home/eya/archives/refactor/refactor-FheForge-work
DEMO_MODE=1 SYNC_ABIS=1 npx hardhat run scripts/forge-deploy.ts --network arb-sepolia

# 3. Run tests
forge test -vvv --no-cache                    # Foundry tests
npx hardhat test                              # Hardhat tests
forge test --fuzz-runs 10000                   # Deep fuzz

# 4. Demo video
npx create-video@latest fheforge-demo && npx remotion render src/index.ts FheForgeDemo fheforge-demo.mp4

# 5. Deploy frontend
cd ui && vercel --prod

# 6. Deploy backend
cd backend/apps && railway up
```

## DEADLINE
**June 1 15:15 UTC** — Akindo Wave Hacks Final Wave submission cutoff.
Current working directory: `/home/eya/archives/refactor/refactor-FheForge-work`
