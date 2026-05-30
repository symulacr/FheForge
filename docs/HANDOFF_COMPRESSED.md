# HANDOFF COMPRESSED

## State
- **Goal active**: Execute `/tmp/review-repos/MANIFEST_EXECUTION.md v2` — 4 waves, 20+ steps
- **Deadline**: June 1 15:15 UTC (Akindo Wave Hacks Final)
- **Todo**: CLEARED (rm) — re-init when starting

## Current Repo State

**Build**: `forge build --no-cache` succeeds (140 files, Solc 0.8.34, warnings only)
**Deployed**: 12 contracts on Arb Sepolia; Vercel LIVE at fheforge-xkq.vercel.app; Railway LIVE at fheforge-api-production-6465.up.railway.app
**Tests**: 369 total — 344 pass, 25 fail (mock FHE ACL issues, pre-existing)
**Key fixes applied**: _verifyEquality before all transfers, requestLiquidityCheck ACL'd, getDepositedAmount neutered, SwapRouter nonReentrant+CEI, StrategyExecutor verified, FHESafeMath overflow guard
**Backend fixed**: import type→import (74 files), SupabaseService uses process.env, JWT_SECRET set
**Config**: COOP/COEP in code NOT deployed; Quick Start stale (test-hardened.js); .env.example missing for backend+root

## Critical Artifacts
- **Manifest**: `/tmp/review-repos/MANIFEST_EXECUTION.md` (216 lines, v2 with critic corrections)
- **Audits**: `/tmp/review-repos/AUDIT_FINAL_P*.md` (7 files)
- **Critics**: `/tmp/review-repos/CRITIC_WAVE*.md` + `CRITIC_GAPS.md` (6 files)
- **Benchmarks**: `/tmp/review-repos/BENCHMARK_COMPARISON.md`
- **Remotion scaffold**: `fheforge-demo/` at repo root

## Wave 1 — Deploy + Demo (critical path, ~2-3h)
1. `cd ui && vercel --prod` → COOP/COEP headers go live
2. `cp contracts/artifacts/contracts/governance/*.json ui/abis/` → gov ABIs
3. Manual: connect MetaMask on Arb Sepolia → deposit → borrow → portfolio
4. Screenshot 4 views: portfolio, deposit, builder, liquidation
5. `cd fheforge-demo && npx remotion render src/index.ts FheForgeDemo fheforge-demo.mp4`
6. Upload video to Loom, update README.md links + Quick Start (forge build not test-hardened.js)
7. `git add -A && git commit -m "final: submission" && git push && git tag fheforge-v1.2-submission`
8. Submit on https://app.akindo.io/wave-hacks/Nm2qjzEBgCqJD90W

## Wave 2 — Tests + Env (~2h, after W1)
9. `contracts/test-foundry/FheForgeGovernor.t.sol` — change `vm.roll(2)` to `vm.roll(3)`
10. Update `backend/apps/.env.production` with new contract addresses (from deployments/421614.json)
11. `cd backend/apps && railway up --detach`

## Wave 3 — Type Safety (~6-11h, parallel W2)
12. `biome check --fix . && forge fmt`
13. Fix 9 tsc errors in 3 files: StrategyFlowPreview.tsx, use-fhe-vault.ts, use-lending-actions.ts
14. Fix 24 solhint errors (struct packing, visibility)
15. `cd backend/apps && npx eslint src/ --fix` (7004 auto-fixable)

## Wave 4 — Polish (~1h, if time)
16. `mv docs/research/* docs/archive/`
17. Create `backend/apps/.env.example` + root `.env.example`
18. `git tag fheforge-pre-fix`
19. Verify 22-item checklist from WAVE8_review_checklist.md
20. `forge test --no-cache`
21. Update README Known Issues with 25 failing tests

## Blockers info
- `ask_user_question` only when truly NO feasible workaround
- Vercel deploy: needs user to complete `vercel login` if session expired
- Railway deploy: `railway login` may need re-auth
- Remotion: `npx create-video@latest` scaffold done; scenes need writing
- E2E test: needs MetaMask wallet on Arb Sepolia with test tokens

## Deployer creds
- Key: `[REDACTED - use environment variables]`
- Etherscan: `5QHW8JJHR3C5U65HGBYVD4VRXANWRIRFM7`
- Deployer address: `0x485534DE1BB491ed0D624dd9b9c3A89a140E58a8`
- Balance: ~0.81 ETH on Arb Sepolia
