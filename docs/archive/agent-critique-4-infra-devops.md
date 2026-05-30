# Agent Critique: Infrastructure / DevOps (Wave 1 Audit)

**Critique of:** `agent-4-deploy-infra.md` (15 findings, P0-P2)  
**Cross-ref:** `WAVE1_MANIFEST.md` §4  
**Date:** 2026-05-18  
**Critic:** Agent 4-Critique (Post-Audit Review)

---

## Ground Truth Verification Findings

Before critiquing individual findings, here are independent verifications that reveal several audit inaccuracies:

### 1. The "Leaked Private Key in Git" Claim is Stale/Incorrect

The audit claims INFRA-P0-1 and INFRA-P0-2 are about a key **committed in git**. However:

- `git ls-files --cached -- backend/apps/.env.development` → **empty** (not tracked)
- `git log --all --full-history -- backend/apps/.env.development` → **no output** (never committed)
- `git log -p --all -S "f0c35250"` → **no output** (key string never in any commit)
- `.gitignore` line 32 correctly lists `.env.development`

**Diagnosis:** Either (a) the key was never committed (audit misread the working tree for a committed file), or (b) it was committed in an ancient commit and purged via BFG/git-filter-repo before this audit. If (b), the purge happened so cleanly that zero evidence remains, meaning the **"purge from git history" remediation is already done** — but the audit didn't detect this.

**Impact on critique:** INFRA-P0-1 and INFRA-P0-2 severities and remediations need adjustment based on this.

### 2. Deployments JSON Has More Contracts Than README

The `deployments/421614.json` lists **9 contracts** including `ExecutorContract`, `TokenRegistry`, and `StrategyExecutor` that the README doesn't mention. This means the README address table is incomplete, not just stale — a finding the audit missed.

### 3. Prometheus Config is Docker-Bound, Unusable on Railway

The `monitoring/prometheus.yml` scrapes `backend:3001`, `frontend:3000`, `node-exporter:9100`, `cadvisor:8080` — all Docker compose service names. These are unresolvable on Railway. The audit's MC-D4-07 doesn't address rewriting the scrape configs for Railway deployment, only the top-level decision to move services.

---

## Per-Finding Critique

### INFRA-P0-1: Leaked private key committed in `backend/apps/.env.development`

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Partially.** The key IS present on disk in a real `.env.development` file. This is severe. However, it is **NOT in git history** (see verification above). Calling this a "committed key" overstates the remediation scope. Actual severity: **P0 for access risk, P2 for git-history concern** (there's no history to purge). |
| **Recommended severity** | **P0-SEC** — keep P0 because a real deployer key sitting unencrypted on disk is unacceptable, but **remove the "purge from git history" burden**. The remediations should be: (1) delete the key from the file, (2) verify `.gitignore` prevents re-addition (confirmed working). Git history purge is unnecessary. |
| **Edge cases missed** | The key could be in a **stash**, **reflog**, or **worktree** even if not in commit history. A full `git stash list`, `git reflog --all`, and worktree scan should be performed before declaring it unreachable. The key could also be in CI logs or GitHub Actions artifacts if any CI run used this file. |
| **Implementation risks** | Deleting the key from the file is safe. Verifying purge completeness via `git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname)' | awk '/blob/'` is more thorough. The real risk is that someone has already copied this key from a public fork — on-chain rotation (INFRA-P1-1) is the only true fix. |
| **Dependencies on other domains** | No code-dependency, but **critical dependency on INFRA-P1-1** (key rotation on-chain). Until the deployer key is revoked on-chain, removing it from the file provides false comfort — the compromised key is still active. |
| **Priority** | **3rd** (after P1-1 key rotation — without on-chain rotation, file cleanup is theater) |

---

### INFRA-P0-2: `.env.development` tracked in git despite `.gitignore`

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **No — this finding appears to be FALSE.** `.gitignore` line 32 already has `.env.development`. The file is NOT in the git index. `git ls-files --cached` returns empty. |
| **Recommended severity** | **REMOVE this finding OR downgrade to P3-INFORMATIONAL.** If the audit meant "this file existed in a previous state" without verifying, that's a methodological error. If the file WAS previously committed and was already purged before the audit, the finding is stale. Current state: no action needed. |
| **Edge cases missed** | If the concern is about `.env.*` being re-added via `git add -f`, the `.gitignore` already protects against accidental commits. But a `pre-commit` hook that rejects staged files with real private keys would be a belt-and-suspenders improvement the audit missed. |
| **Implementation risks** | None — the fix is already in place. |
| **Dependencies** | None. |
| **Priority** | **Remove from execution order** — no work needed unless confirming purge was complete. |

---

### INFRA-P0-3: All 5 private keys in `contracts/.env` are identical

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P0-SEC is correct.** I confirmed this independently: `contracts/.env` lines 5-28 show `PRIVATE_KEY`, `TESTER1_PRIVATE_KEY`, `TESTER2_PRIVATE_KEY`, `TESTER3_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY` all set to `0xe6868d73b9c3c398baac27d3491414128e459fe51e2de1ae5af75c8e41c547ba`. Tests running as the deployer defeats isolation testing entirely. |
| **Edge cases missed** | (1) **This key is ALSO leaked.** The deployer key in `contracts/.env` is `0xe6868d...` which is different from the backend `.env.development` key (`0xf0c35...`), but it's still exposed. The audit treated this as only a "test isolation" problem — it's also a **second leaked deployer key**. (2) If Hardhat tests deploy contracts with this key, those deployed contracts are owned by a publicly exposed key. (3) The `ETHERSCAN_API_KEY` on line 16 is also exposed — this is a P2 issue the audit missed. |
| **Implementation risks** | Generating new keys is safe (`cast wallet new`). The risk is: (a) test scripts assume `TESTER1` has funds — new keys need separate test ETH funding; (b) some tests might implicitly rely on the deployer being the tester (e.g., `onlyOwner` calls that should fail but pass because tester=deployer). These tests will break when tester ≠ deployer — which is actually the intended behavior, but it could cause confusing CI failures. |
| **Dependencies** | Depends on test infrastructure funding (test ETH to new addresses). If the project uses faucet-based funding, this is non-trivial. Also depends on contracts domain — if contracts tests use `PRIVATE_KEY` for deployments, those scripts need updating. |
| **Priority** | **1st** (no dependencies, highest isolation impact, quick win) |

---

### INFRA-P0-4: UI contract addresses from Wave17 (Wave30 is live)

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P0-BROKEN is correct.** I confirmed: `ui/.env.local` uses Wave17 addresses (e.g., `0x06d9A84B...` for Vault), while `deployments/421614.json` has Wave30 addresses (Vault: `0x75c7D581...`). The UI talks to nonexistent/lagging contracts. This is a complete app-breaker. |
| **Edge cases missed** | (1) The deployments JSON has **9 contracts** but the UI only sets env vars for 6. The `ExecutorContract`, `TokenRegistry`, and `StrategyExecutor` are deployed but the UI has no awareness of them. (2) The `NEXT_PUBLIC_SWAP_ROUTER_ADDRESS` duplicates `NEXT_PUBLIC_ROUTER_ADDRESS` — both point to the same value. This is dead config but indicates confusion about which router contracts exist. (3) No `NEXT_PUBLIC_EXECUTOR_ADDRESS` exists — if the frontend needs to interact with the executor, it can't. |
| **Implementation risks** | (1) **The proposed new addresses from `deployments/421614.json` may also be wrong.** Both the README and deployments JSON claim Wave30 but differ. Neither has been on-chain verified. The fix MUST start with `cast code` verification of EACH address. (2) Swapping all 6+ addresses at once without testing each contract interaction independently could make debugging harder if some work and some don't. (3) The `NEXT_PUBLIC_SWAP_ROUTER_ADDRESS` duplicates `NEXT_PUBLIC_ROUTER_ADDRESS` — if one of these is supposed to be the `SwapRouter` and the other `SwapRouterV2` or similar, there's a conceptual problem the audit didn't address. |
| **Dependencies** | **Depends on infrastructure domain's own address reconciliation** (decision tree in agent-4). Depends on on-chain verification tooling (cast/Arbiscan). Affects frontend (FE-P0-1 through FE-P0-5 would connect to wrong contracts even if fixed). |
| **Priority** | **2nd** (blocked only by on-chain verification of correct addresses, which is a prerequisite, not a separate finding) |

---

### INFRA-P0-5: Backend contract addresses from Wave5-6

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P0-BROKEN.** I confirmed: backend `.env.development` uses `VAULT_ADDRESS=0x261c4b5a...`, `POOL_ADDRESS=0xb4F6b792...` etc. These are from Wave5-6 era — even older than the UI's Wave17. Backend event indexing, health checks, and any on-chain reads all target wrong contracts. |
| **Edge cases missed** | (1) The PRICE_ORACLE variable is **not set** in backend `.env.development` at all — the audit notes this in the matrix but doesn't flag it as its own finding. This means the backend has zero oracle awareness. (2) The COMPOSER_ADDRESS is also missing from backend — any backend service that needs the composer is completely broken. (3) If backend services use these addresses for event indexing, they may be indexing non-existent contracts silently, giving the illusion of working data. |
| **Implementation risks** | Same address verification risk as P0-4. Additionally, the backend's env var naming convention (`VAULT_ADDRESS`, `POOL_ADDRESS`) differs from the UI's (`NEXT_PUBLIC_VAULT_ADDRESS`). If there's a `STRATEGY_VAULT_ADDRESS` variant being read elsewhere in the backend code (as the cross-cutting concerns note), just updating `.env.development` won't fix it — the code may read from a different var name entirely. |
| **Dependencies** | Same address reconciliation as P0-4. Also depends on backend code audit to determine which exact env var names are read by which services. |
| **Priority** | **2nd** (same batch as P0-4, same dependency chain) |

---

### INFRA-P0-6: WETH/USDC token addresses differ across 3 config layers

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P0-BROKEN.** I confirmed: 3 different WETH addresses across UI (`0x84BddCA...`), backend (`0x980B62Da...`), and README (`0x9A0227eb...`). The backend also has a different USDC (`0x75faf114e...`). The `deployments/421614.json` WETH (`0x84BddCA...`) matches the UI — so UI is likely correct for WETH. |
| **Edge cases missed** | (1) **USDC is missing from deployments JSON entirely** — there's no ground truth for the USDC address. The audit assumes UI's USDC is correct (`0x150376Ed...`) but this hasn't been on-chain verified. (2) If these are real (not mock) tokens with different decimals (WETH=18, USDC=6), using the wrong address could cause severe math errors — e.g., supplying 100 USDC at 6 decimals vs 18 decimals would be off by 10^12. (3) The `contracts/.env` has `WETH_ADDRESS=` and `USDC_ADDRESS=` as empty strings — meaning contract deploy scripts have no token address context and could deploy with the wrong mock tokens. |
| **Implementation risks** | (1) If the WETH and USDC are mock tokens specific to this project's deployment, they could have been re-deployed in different waves, meaning multiple "correct" values exist for different contract versions. The fix must identify which token deployment corresponds to the Wave30 contracts. (2) Changing token addresses in the backend requires updating both `TOKEN_WETH`/`TOKEN_USDC` and any hardcoded references in service code. |
| **Dependencies** | Tied to P0-4 and P0-5 (address reconciliation is a single coordinated effort). Also depends on contracts domain — who deployed the mock WETH/USDC and when? |
| **Priority** | **2nd** (part of the coordinated address reconciliation sweep) |

---

### INFRA-P0-7: Monitoring stack is Docker-local only — not on Railway

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P0-MON is correct.** The `docker-compose.yml` runs Prometheus, Grafana, Loki, Alertmanager, Node Exporter, and cAdvisor — all `localhost`-bound. No Railway deployment exists. Production has zero observability. |
| **Edge cases missed** | (1) **Railway doesn't natively run Docker Compose.** The audit's Option A (Railway Observability Add-ons) is misleading — Railway doesn't support arbitrary Docker containers as add-ons the way the audit implies. Railway's observability features are: built-in metrics (CPU/memory/restarts), Grafana Cloud integration, and log streaming. They don't let you deploy Prometheus + Grafana + Alertmanager as free add-ons. Option B (use Railway native metrics) is the only realistic path for MVP. (2) The Prometheus scrape config is hardcoded to Docker hostnames (`backend:3001`, `frontend:3000`). Even if Prometheus were deployed on Railway, these targets are unresolvable. The scrape config needs a full rewrite. (3) cAdvisor and Node Exporter require host filesystem access — these can't run on Railway at all (it's a PaaS, not IaaS). (4) Loki/Promtail for log aggregation is overkill for an MVP with Railway's native log streaming. |
| **Implementation risks** | (1) Over-investing in a custom monitoring stack on Railway is premature — Railway could change its add-on model, and custom containers add operational complexity. (2) The audit's Option A creates 4 new Railway services — each one adds to the project's Railway bill and management surface. (3) Without the `/metrics` endpoint (P2-1, MC-D4-13), Prometheus-based monitoring is impossible regardless of deployment approach. |
| **Dependencies** | **Depends on P2-1** (`/metrics` endpoint). No point deploying Prometheus until the backend emits metrics. Also depends on backend domain for metrics instrumentation. |
| **Priority** | **9th** (deferred until after `/metrics` endpoint — swap P0-MON and P2 execution order. Currently evaluating monitoring infra before the data source exists, which is backwards.) |

---

### INFRA-P0-8: Grafana dashboard provisioning directory doesn't exist

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Largely correct as P0-MON, but overstated.** I confirmed: `ls monitoring/grafana/` returns "No such file or directory". The `docker-compose.yml` references `./grafana/dashboards` and `./grafana/datasources` — without these, Grafana fails to start with provisioning errors. However, since the monitoring stack is Docker-local only (P0-7) and not deployed anywhere, this is a **broken local dev experience**, not a production blocker. Calling it P0 alongside "all 39 API endpoints are public" inflates its relative priority. |
| **Recommended severity** | **P1** — the missing dashboards are a dev UX issue, not a security or production-blocking issue. The docker-compose won't start Grafana correctly, but nobody is relying on that stack in production. |
| **Edge cases missed** | (1) The audit suggests creating 4 dashboard JSONs, but without the `/metrics` endpoint, these dashboards will show "No Data" for all panels. Creating detailed dashboards before metrics exist is premature. (2) A minimal provisioning structure (empty dashboards + datasource YAML) is sufficient for Wave 1 — detailed dashboards belong in Wave 2. (3) The docker-compose's `GF_SECURITY_ADMIN_USER` and `GF_SECURITY_ADMIN_PASSWORD` use `${...}` env var substitution but have no defaults — Grafana will start with empty credentials if `.env` is missing. |
| **Implementation risks** | Low — creating files is safe. The risk is investing time in beautiful dashboards that show nothing because the data sources don't exist yet. |
| **Dependencies** | Depends on P2-1 (`/metrics`), P0-7 (monitoring deployment strategy). The dashboards are useless without both. |
| **Priority** | **10th** (create minimal stub directories only in Wave 1; defer full dashboard authoring to Wave 2) |

---

### INFRA-P0-9: 11 of 14 alert rules reference non-existent metrics

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Severity is correct as architectural problem, but the count is slightly off.** I confirmed the `alerts.yml` file — 14 rules total. Rules 1-9 (api_alerts, database_alerts, contract_alerts) and 13-14 (business_alerts) all reference metrics that don't exist anywhere in the codebase. Only rules 10-12 (system_alerts) use real metrics from Node Exporter. However, calling this P0 is questionable — broken alert rules are noise, not a security incident. They don't cause false alerts because Prometheus can't evaluate them (results in empty series). The main cost is log noise during Prometheus startup. |
| **Recommended severity** | **P2** — broken alert rule definitions in a Docker-local monitoring stack that isn't deployed to production. Move this down. The priority should reflect impact: these rules are harmless noise, not production-blocking. |
| **Edge cases missed** | (1) The audit's fix is to delete 11 rules entirely. A better approach: **comment them out** with the Prometheus metric names documented, so when metrics are implemented, re-enabling the rules is a one-line uncomment. (2) The proposed replacement (MC-D4-09, keep only 3 system rules) has a hard requirement on Node Exporter being deployed — which can't run on Railway. So even the 3 "working" system rules won't work in production. (3) The `promtool check rules` verification step won't catch semantic errors — it only checks YAML syntax and PromQL validity, not whether the metrics exist. |
| **Implementation risks** | Minimal — commenting out/removing YAML blocks is safe. The real risk is forgetting to restore them when metrics are eventually implemented. A TODO/checklist would help. |
| **Dependencies** | Depends on P2-1 (`/metrics` endpoint) for restoration of API rules. Database and contract alert restoration depends on backend instrumentation that doesn't exist yet (Wave 2 scope). |
| **Priority** | **8th** (low effort, high noise reduction in Docker logs, but not blocking anything serious) |

---

### INFRA-P0-10: Zero Sentry dependencies despite docs referencing error tracking

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **No — this is P1 at most, not P0.** The absence of Sentry means no error tracking in production, which is bad, but it's not as severe as "app talks to wrong contracts" or "private keys leaked." Sentry is important for debugging but the service still runs without it. The audit conflates "documentation mentions a feature" with "a critical feature that doesn't work." |
| **Recommended severity** | **P1** — important for debugging and operations, but the app functions without it. Errors surface as HTTP 500s (which appear in Railway logs) instead of Sentry issues. The impact is operational visibility, not functional correctness or security. |
| **Edge cases missed** | (1) The root `node_modules/` has `@sentry/node@5.30.0` from transitive dependencies — but Sentry v5 is 2 major versions behind current (v8+). If someone copies an initialization snippet from the internet using v8 API, it would silently fail against the v5 transitive package. (2) Sentry DSN is an env var that must be configured — adding Sentry dependencies without a DSN in production means Sentry initializes in "no-op" mode. The audit doesn't mention needing a real DSN from sentry.io. (3) The frontend (Next.js) needs `@sentry/nextjs` which has a specific setup process (Sentry Webpack plugin, source maps upload, etc.) that differs from the simple `Sentry.init()` pattern for backend. The audit's `npm install @sentry/nextjs` recommendation is incomplete without the full Next.js integration. |
| **Implementation risks** | (1) Sentry can cause boot-time crashes if misconfigured (e.g., invalid DSN format, missing permissions). (2) Sentry's default `tracesSampleRate: 1.0` (as recommended by the audit) would send 100% of traces in production, which can be expensive and high-volume. Should be `0.1` or configurable. (3) Adding Sentry to the backend adds startup latency and memory overhead. (4) If DSN is set and Sentry can't reach the server, it blocks the request for up to the timeout period. |
| **Dependencies** | None for installation. Requires a Sentry account and project setup (external dependency). Depends on operations team to monitor Sentry dashboard. |
| **Priority** | **7th** (important but not blocking; can be done in parallel with address fixes) |

---

### INFRA-P1-1: Rotate leaked deployer key on-chain

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **No — this should be P0, not P1.** The deployer key `0xf0c35...` is real and was exposed (at minimum on disk, and the audit claims it was in git history before possible purge). As long as that key controls contracts on-chain, anyone with the hex value can drain the protocol. On-chain rotation is the **only true fix** — removing the key from the file is theater without rotation. Calling this P1 creates the wrong priority signal. |
| **Recommended severity** | **P0-SEC** — this is the most important security fix in the entire infra domain. Move it to P0, above address fixes. |
| **Edge cases missed** | (1) The audit assumes all contracts have `transferOwnership` or equivalent. Not all contracts may support this — the `onlyOwner` modifier audit found 20 admin functions. Contracts without ownership transfer need to be redeployed. (2) The `ExecutorContract` swap executor address — if the old deployer key is set as `SWAP_EXECUTOR_ADDRESS`, rotating the deployer key doesn't change the executor. A separate `setExecutor()` call is needed. (3) The `ETHERSCAN_API_KEY` in contracts/.env is also leaked — this could be used to verify (or impersonate) contracts on Arbiscan. Rotating it is P2. (4) Any contract with `renounceOwnership()` called after transfer would permanently lock admin functions. Check before rotating. |
| **Implementation risks** | (1) If the old key is already drained, it can't pay gas for the ownership transfer transaction. The new deployer must fund the old key with just enough ETH for the transfer tx. (2) Each contract requires a separate `cast send` transaction — if any contract's `owner()` call fails because the contract doesn't have `Ownable`, the transfer silently fails. (3) The `deployments/421614.json` deployer address is `0x485534DE1BB491ed0D624dd9b9c3A89a140E58a8` which may NOT match the leaked key's corresponding address. The leaked key's address must be derived first: `cast wallet address --private-key 0xf0c35...` to confirm what it controls. |
| **Dependencies** | **Critical dependency on INFRA-P0-1** (key removal from file is secondary to on-chain rotation). Also depends on SC domain to confirm which contracts have `onlyOwner` and which can be transferred. |
| **Priority** | **0th** (do this FIRST, before everything else — including file cleanup, which becomes moot if the key is already rotated) |

---

### INFRA-P1-2: No Base Sepolia deployment artifact exists

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P1 is correct.** The Base Sepolia deployment artifact for chain 84532 is absent. The UI has commented-out placeholder addresses for Base Sepolia that could cause cross-chain confusion. This is not P0 because Base Sepolia isn't the primary deployment target — Arb Sepolia is. |
| **Edge cases missed** | (1) The audit's proposed stub marks contracts as `"not-deployed"` — but the UI's `.env.local` has `NEXT_PUBLIC_BASE_*_ADDRESS` set to placeholder values (e.g., `0x1BF1E351481D072488f9f17C0e3B2669701fd0a9` for Base Vault). If the UI checks chain ID and uses these addresses on Base Sepolia, it would connect to random contracts. The audit doesn't flag that the UI's Base Sepolia env vars have values when they should be empty. (2) The backend's `.env.development` has `BASE_SEPOLIA_RPC_URL` set but no corresponding BASE addresses — inconsistency between frontend and backend Base Sepolia configs. |
| **Implementation risks** | Low — creating a JSON stub is safe. Clearing UI placeholder addresses could break chain-switching logic if the UI tries to use them. |
| **Dependencies** | None — this is a documentation/artifact fix. Actual Base Sepolia deployment depends on contracts domain. |
| **Priority** | **11th** (lowest priority — it's a documentation stub for future work) |

---

### INFRA-P2-1: No `/metrics` endpoint on backend

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P2 is correct.** No `/metrics` means no Prometheus metrics, which breaks the entire monitoring vision. But the app works without it. The audit correctly notes this as a prerequisite for alert rules and dashboards, not as a standalone production blocker. |
| **Edge cases missed** | (1) **Security risk:** Exposing `/metrics` publicly leaks operational data (request rates, error rates, business metrics like `user_signups_total`). The audit doesn't mention securing the endpoint. On Railway, this is accessible at `https://fheforge-api-production.up.railway.app/metrics` unless protected by auth middleware or Railway's internal networking. (2) The audit's `prom-client` code registers `collectDefaultMetrics` which exposes Node.js process metrics (memory, event loop lag, GC) — these can help attackers fingerprint the runtime environment. (3) Railway's internal networking supports `internal: true` in `railway.json` to make endpoints inaccessible from the public internet — the audit doesn't mention this pattern. |
| **Implementation risks** | (1) `prom-client`'s `collectDefaultMetrics` can cause memory leaks in long-running Node processes (known issue with the `gc` metric). (2) The prometheus metrics registry is a singleton — if multiple `MetricsController` instances are created (e.g., in testing), they share state. (3) Adding histogram metrics without bounding cardinality (e.g., unbounded `route` label from user input) can cause metric cardinality explosion. |
| **Dependencies** | Depends on backend domain — the `MetricsController` needs to be integrated into the NestJS module system. Also depends on INFRA-P0-7 (monitoring deployment strategy) and INFRA-P2-2 (alert rule restoration). |
| **Priority** | **4th** (prerequisite for all monitoring value — must come before dashboards, alert restorations, or monitoring stack decisions) |

---

### INFRA-P2-2: Alert rules need restoration after `/metrics` exists

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P2 is correct.** Alert rules are non-functional without data sources. This finding is correctly sequenced after P2-1. |
| **Edge cases missed** | (1) The restored alert rules (MC-D4-14) use `up{job="backend-api"}` for APIDown — but on Railway, the `up` metric comes from the Prometheus target scrape, not from the application. The `job` label must match the `prometheus.yml` job name. The audit assumes `backend-api` but the Railway Prometheus config might use a different job name. (2) The `NewUserSignup` alert fires on ANY increase — this means every new user generates an "alert." This is noise, not a useful alert. It should be a dashboard panel, not an alert rule. (3) The `SlowAPIResponse` alert uses `histogram_quantile(0.95, sum by(le) (rate(...)))` — the `sum by(le)` aggregates across ALL routes, losing per-route granularity. A slow endpoint is masked by fast ones. |
| **Implementation risks** | Re-adding rules that reference non-existent metrics causes Prometheus startup errors if misconfigured. Each rule should be verified individually after the metric exists. |
| **Dependencies** | **Direct dependency on P2-1** (`/metrics` endpoint). Also depends on INFRA-P0-7 (monitoring stack deployment) and verifying metric names match between controller code and alert expressions. |
| **Priority** | **6th** (after `/metrics` is deployed and verified working with specific metric names) |

---

### INFRA-P2-3: Railway healthcheck path missing

| Dimension | Assessment |
|-----------|------------|
| **Severity correct?** | **Yes, P2 is correct.** The `railway.json` has `restartPolicyType: ON_FAILURE` but no `healthcheckPath`. Railway can't distinguish "still starting" from "crashed." This is production hardening, not a blocker. |
| **Edge cases missed** | (1) The `/health` endpoint currently checks chain status from `FhenixStrategy.getNetworkStatus()` — if the RPC endpoint is down (which happens), the health check fails and Railway restarts the service unnecessarily. Health should distinguish between "app is running" (return 200) and "external dependency is down" (still return 200 but include a `degraded: true` flag in the body). (2) `healthcheckTimeout: 30` means Railway waits 30 seconds for a response — this is long. If the app has a slow boot (NestJS module resolution, DB connection), the health check might timeout during startup. Should be 10-15 seconds for faster recovery. (3) Railway also supports `healthcheckPath` per-environment — but `railway.json` is environment-agnostic. The audit doesn't mention environment-specific health checks. |
| **Implementation risks** | (1) If `healthcheckPath` is set but `/health` takes longer than `healthcheckTimeout`, Railway kills and restarts the service — creating a crash loop. (2) Setting `healthcheckPath` without testing that `/health` reliably returns 200 can turn a minor issue (slow boot) into a production outage (repeated restarts). |
| **Dependencies** | Depends on backend domain — `/health` must be reliable and fast. |
| **Priority** | **5th** (important but needs `/health` to be reliable first; test health endpoint stability before adding healthcheck to railway.json) |

---

## Missed Findings

### M1: `contracts/.env` ETHERSCAN_API_KEY is also leaked (P2)
The `contracts/.env` file on line 16 has a real `ETHERSCAN_API_KEY=5QHW8JJHR3C5U65HGBYVD4VRXANWRIRFM7`. While Arbiscan API keys are free and low-severity, a leaked key could be used to: (a) consume the owner's API rate limit, (b) query which contracts the owner has verified, (c) in rare cases, access private contract verification data. Should be documented and optionally rotated.

### M2: Prometheus scrape config is Docker-bound (P2)
The `monitoring/prometheus.yml` has hardcoded Docker service names (`backend:3001`, `frontend:3000`, `node-exporter:9100`, etc.) that are unresolvable outside of Docker Compose. If the team follows the audit's recommendation to deploy Prometheus on Railway, the scrape config will silently fail. This needs a Railway-specific `prometheus.yml` with proper target URLs.

### M3: Railway doesn't support custom Docker monitoring stack (P0-7 scope error)
The audit's Option A (deploy Prometheus/Grafana as Railway services) is unrealistic. Railway is a PaaS that does not support arbitrary Docker containers with host filesystem access (needed for Node Exporter/cAdvisor). The viable options are:
- **Railway Built-in Metrics** (Option B) — CPU/memory/restarts, no custom metrics
- **Grafana Cloud** — SaaS Grafana that integrates with Railway
- **Separate VPS** — external monitoring host (adds cost and ops burden)
The audit should have clarified this rather than implying Railway supports custom Docker stacks.

### M4: No CI/CD secret scanning (P2)
With 2 leaked private keys (one in `contracts/.env`, one in `backend/apps/.env.development`), the absence of automated secret scanning is notable. GitHub Advanced Security / Secret Scanning or a pre-commit hook with `truffleHog`/`gitleaks` would catch future leaks. The Wave 2 recommendations mention this, but it should be surfaced as a finding in this domain.

### M5: Railway JSON lacks `internal` network config (P2)
The `railway.json` doesn't set any networking restrictions. Adding `"internal": true` to sensitive endpoints (like `/metrics` or any future admin API) would prevent public internet access — an important security pattern that aligns with the auth gap (BE-P0-1).

### M6: No deploy script / deploy automation (P2)
The audit notes address chaos but doesn't flag that there's no reproducible deploy script producing a single ground-truth output. The `contracts/deployments/` directory has 16 JSON files from various deployment runs — no standardization. A `deploy.ts` script that writes to `deployments/<chainId>.json` would prevent future address drift.

### M7: Monitoring stack uses plain HTTP, no TLS (P2)
The docker-compose exposes Prometheus (port 9090), Grafana (port 3000), Alertmanager (port 9093) without any TLS. If any of these are exposed to a network (even internally), credentials and data flow in plaintext. The audit misses this entirely.

### M8: The deployer key in `contracts/.env` is a SECOND leaked key (P0-SEC)
The audit found 5 identical keys but treated it as only an isolation problem. Key `0xe6868d73b9c3c398baac27d3491414128e459fe51e2de1ae5af75c8e41c547ba` is in a **second** committed file (`contracts/.env` is NOT in `.gitignore`) — meaning TWO deployer keys are leaked, not one. This key should also be rotated on-chain.

---

## Cross-Cutting Dependencies

| Infra Finding | Depends On | Affects |
|--------------|------------|---------|
| INFRA-P0-1 (key removal) | INFRA-P1-1 (on-chain rotation) — without rotation, file cleanup is meaningless | 🔒 Security — all contract domains |
| INFRA-P0-4/5/6 (address reconciliation) | On-chain verification tooling (cast/Arbiscan) | 🌐 Frontend (contract connections), 🌐 Backend (event indexing), 🔬 Integration (POSTFIX probes) |
| INFRA-P0-7 (monitoring → Railway) | INFRA-P2-1 (/metrics endpoint) — no data source | 🌐 Backend (metrics instrumentation), 📊 Operations (observability) |
| INFRA-P0-8 (grafana dashboards) | INFRA-P2-1, INFRA-P0-7 — dashboards need both data and deployment | 📊 Operations |
| INFRA-P0-9 (fix alert rules) | INFRA-P2-1, INFRA-P2-2 — rules need real metrics | 📊 Operations |
| INFRA-P0-10 (Sentry) | External Sentry account + DSN | 🌐 Backend, 🖥️ Frontend (error tracking) |
| INFRA-P1-1 (key rotation) | INFRA-P0-1 (key removal), SC domain (contract ownership model) | 🔒 All on-chain contracts |
| INFRA-P2-1 (/metrics endpoint) | Backend domain (NestJS module integration) | 📊 All monitoring |
| INFRA-P2-3 (Railway healthcheck) | Backend domain (/health reliability) | 🚀 Deployment reliability |

**Key observation:** The longest dependency chain is:
```
INFRA-P2-1 (/metrics) → INFRA-P0-7 (monitoring deployment) → INFRA-P0-8 (dashboards) → INFRA-P2-2 (alert rules)
```
This chain should be executed IN ORDER, not all at P0-MON as the audit suggests.

---

## Revised Execution Order

The audit's execution order is reasonable for independence but misses critical sequencing. Here's the revised priority with rationale:

```
0️⃣  INFRA-P1-1 → Rotate leaked keys on-chain (BOTH keys: 0xf0c35... AND 0xe6868...)
    [Before anything else — the app can't be secure while compromised keys control contracts]

1️⃣  INFRA-P0-3 → Unique test keys in contracts/.env
    [No deps, quick win, improves test integrity immediately]

2️⃣  INFRA-P0-4 + P0-5 + P0-6 → Coordinated address reconciliation sweep
    [Must be done together — verify deployments JSON on-chain, apply to UI + backend + contracts/.env]

3️⃣  INFRA-P0-1 → Remove leaked key from backend .env.development file
    [After on-chain rotation — otherwise this is theater]

4️⃣  INFRA-P2-1 → Add /metrics endpoint to backend
    [Prerequisite for ALL monitoring value — no point deploying monitoring without data]

5️⃣  INFRA-P2-3 → Add Railway healthcheck configuration
    [Quick win after /health reliability is confirmed]

6️⃣  INFRA-P2-2 → Restore working alert rules (matching actual metric names)
    [After /metrics is deployed and metric names are verified]

7️⃣  INFRA-P0-10 → Add Sentry dependencies
    [Independent — can be done any time but valuable early for error visibility]

8️⃣  INFRA-P0-9 → Clean up broken alert rules
    [Low effort, high noise reduction; can be done early but non-critical]

9️⃣  INFRA-P0-7 → Determine monitoring strategy for Railway
    [Should be OPTION B (Railway built-in metrics) for MVP — defer Prometheus/Grafana to Wave 2]

🔟  INFRA-P0-8 → Create minimal Grafana provisioning stubs
    [Minimal files only — full dashboards in Wave 2]

1️⃣1️⃣ INFRA-P1-2 → Create Base Sepolia deployment stub
    [Documentation — lowest priority]
```

---

## Summary: What the Audit Got Right vs Wrong

### Got Right
- Address reconciliation as the most critical infrastructure issue ✓
- Identified the monitoring stack's Docker-only limitation ✓
- Flagged identical tester keys as a testing integrity issue ✓
- Correctly identified the missing Grafana provisioning directory ✓
- Correctly identified missing `/metrics` endpoint as blocking alert rules ✓
- Correctly identified the Railway healthcheck gap ✓
- The address reconciliation decision tree is well-designed ✓
- The dependency graph diagram is accurate for independent findings ✓

### Got Wrong
- **Claimed `.env.development` was "committed in git"** — NOT confirmed in git history (either never committed or already purged)
- **P0-2 is a false positive** — `.gitignore` already works, file not tracked
- **P1-1 (key rotation) is P0, not P1** — the only true fix for leaked keys
- **P0-10 (Sentry) is P1, not P0** — important but not production-blocking
- **P0-8 (missing grafana dir) is P1, not P0** — broken local dev, not production-blocking
- **P0-9 (broken alert rules) is P2, not P0** — harmless noise in a non-deployed stack
- **Monitoring deployment options were poorly researched** — Railway doesn't support custom Docker monitoring stacks as implied
- **Missed second leaked key** — `contracts/.env` has `0xe6868...` exposed in a tracked file
- **Missed leaked ETHERSCAN_API_KEY** in `contracts/.env`
- **Missed Prometheus scrape config being Docker-bound** — won't work on Railway
- **Missed that the monitoring stack should be decisioned AFTER `/metrics` exists**, not before

### Overall Domain Score: 7/10

The infra/devops audit correctly identified the major problems (address chaos, leaked keys, missing monitoring) but the severity assignments need significant recalibration, the monitoring cloud deployment analysis was weak, and 2 findings are stale/wrong. The execution order needs restructuring: **on-chain key rotation should be the very first action**, and the monitoring stack should be a Wave 2 concern rather than being scattered across P0-P2 with unrealistic deployment assumptions.
