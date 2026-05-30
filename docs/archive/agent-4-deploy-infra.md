# Agent-4: Deploy/Infrastructure Microchange Plan

**Generated:** 2026-05-18  
**Scope:** All verified Deploy/Infra findings (P0–P2) — FheForge on Arbitrum Sepolia (CoFHE)  
**Target:** Akindo Wave Hacks "Private By Design dApp Buildathon" Wave 4

---

## Address Inventory (Current State)

Before individual microchanges, the full address matrix across all config files:

| Contract | UI `.env.local` (Wave17) | Backend `.env.development` (Wave5-6) | README (claims Wave30) | `deployments/421614.json` (claims Wave30) |
|---|---|---|---|---|
| **StrategyVault** | `0x06d9A84B289f3203a3268051DE66D733fc6f7EeA` | `0x261c4b5a66C24Dd1974E7ea470e76154dff062F5` | `0xBf65f09f901340328C17e10d67479bd884feC551` | `0x75c7D581d9c408B93Bf6FB43aF3ECbe6FF5EEB1A` |
| **LendingPool** | `0x6e4DA21723ea0e3E87320b5c7146DACacb2a4958` | `0xb4F6b792219e3d6Cd3f3B8088285e52a64CCcb44` | `0x605e973B47C311aE9ad7ea5984e673B129fCB769` | `0x4F0508ca71a5Dae2C49FD9307a507f74DE90DD72` |
| **SwapRouter** | `0xC990c3287844e44D145780d5b90B0d22A7FE9A7d` | `0x78C2818a401477F78E129A7526bC833Eb93d964A` | `0xc613Ba147b7d76854c6e2D37E15fe50FFbD8F489` | `0x56d08512c95562Ea3F70Bc16E0a0379E3632221B` |
| **StrategyRegistry** | `0xFCb1beeaDBa65718eB1AF96F9fC72989704D98c0` | `0xcdFB608e7f45f6e6cCA27e504ce6b8aDe64701B9` | `0xfe9FAb915b0271CEA1243a299a4a4085497DE260` | `0x4e0414204972C9127E7eef2aeA5493e6E4D44914` |
| **PriceOracle** | `0x3ffD184d90daBe831C647D82242163B1940938b4` | *(not set)* | `0x6793a71fefA499d9A345Bd4Ab15eae8bb27F065C` | `0xfA7B1f68c66AEf1BDC0981465ee5E29E456Da12C` |
| **FheForgeComposer** | `0x9d3f780f1644E0A3E84b34bABcF11943377aFd46` | *(not set)* | `0xCEF1B60C8FE8641f3346c5eD0ebBDA742c62e750` | `0x9892D8CaEB4a2ab4Dba10126a2f49D2aD5807b2C` |
| **WETH (mock)** | `0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32` | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` | `0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d` | `0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32` |
| **USDC (mock)** | `0x150376EdEbc5AC48771655a61a795d828BeC8Df6` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `0x150376EdEbc5AC48771655a61a795d828BeC8Df6` | *(not in deployments JSON)* |

**Key observation:** Four different address sets exist — all seven contracts have mismatched addresses, some with **4 different values** across files. The WETH/USDC token addresses also differ. The README and `deployments/421614.json` **both claim Wave30 but disagree** — on-chain verification is required before applying contract address updates.

---

## P0-SECURITY

---

### MC-D4-01 · Remove leaked private key from backend `.env.development`

**File:** `backend/apps/.env.development`  
**Logic:** Real deployer key `0xf0c35250d31fdd7db7756d4bbc26b7803b54f0205ccd99723f3d34d6a56f9049` is tracked in git. Anyone with repo access can drain contracts. The `.gitignore` already has `.env.development` (line 32), meaning the file was committed before the gitignore rule was added or was force-staged.

**Old:**
```env
PRIVATE_KEY=0xf0c35250d31fdd7db7756d4bbc26b7803b54f0205ccd99723f3d34d6a56f9049
```

**New:**
```env
PRIVATE_KEY=
```
(Key removed; value sourced from Vault/1Password at deploy time, never stored in-repo.)

**Priority:** P0-SECURITY  
**Rollback:** `git checkout backend/apps/.env.development` — but do NOT re-commit the leaked key.  
**Verify:** 
1. `git log -p -- backend/apps/.env.development` — confirm key no longer appears 
2. `git rm --cached backend/apps/.env.development` to stop tracking
3. `git diff --cached -- backend/apps/.env.development` verify only key-line removed
4. On-chain: use `cast balance <deployer_address>` to confirm the associated account is drained (it was already public in commits on a public fork)

---

### MC-D4-02 · Remove `.env.development` from git tracking (purge history)

**File:** `.gitignore` (already has `.env.development` on line 32 — this is correct)  
**File:** `backend/apps/.env.development`  
**Logic:** Even though `.gitignore` correctly excludes `.env.development`, the file was already committed in previous history. Must be removed from git tracking and history scrubbed to prevent key extraction from git history.

**Old (in git index):**
```bash
git ls-files --cached -- backend/apps/.env.development  # returns the file path
```

**New:**
```bash
git rm --cached backend/apps/.env.development
echo "backend/apps/.env.development" >> .gitignore  # verify line exists already
```

**Priority:** P0-SECURITY  
**Rollback:** `git reset HEAD -- backend/apps/.env.development` + `git checkout -- backend/apps/.env.development`  
**Verify:**
- `git ls-files --cached -- backend/apps/.env.development` returns empty
- `git status` shows `.env.development` deleted from index but `.gitignore` preventing re-addition

---

### MC-D4-03 · Use unique private keys for each test account

**File:** `contracts/.env`  
**Logic:** All five private keys (PRIVATE_KEY, TESTER1, TESTER2, TESTER3, DEPLOYER) are identical (`[REDACTED - use environment variables]`). This means every test runs as the deployer address, defeating isolation testing. Each test account must have a unique key (with test eth funded separately).

**Old:**
```env
PRIVATE_KEY=[REDACTED - use environment variables]
TESTER1_PRIVATE_KEY=[REDACTED - use environment variables]
TESTER2_PRIVATE_KEY=[REDACTED - use environment variables]
TESTER3_PRIVATE_KEY=[REDACTED - use environment variables]
DEPLOYER_PRIVATE_KEY=[REDACTED - use environment variables]
```

**New:**
```env
PRIVATE_KEY=[REDACTED - use environment variables]
TESTER1_PRIVATE_KEY=<unique-key-1>
TESTER2_PRIVATE_KEY=<unique-key-2>
TESTER3_PRIVATE_KEY=<unique-key-3>
DEPLOYER_PRIVATE_KEY=[REDACTED - use environment variables]
```
(TESTER1-3 keys generated via `cast wallet new`; each funded with test ETH from faucet.)

**Priority:** P0-SECURITY  
**Rollback:** Revert TESTER1-3 to the deployer key value.  
**Verify:**
- `cast wallet address --private-key <tester1-key>` yields a different address than `cast wallet address --private-key <deployer-key>`
- Hardhat/foundry test scripts using `TESTER1_PRIVATE_KEY` deploy from account ≠ deployer

---

## P0-BROKEN

---

### MC-D4-04 · Replace UI contract addresses (Wave17 → Wave30)

**File:** `ui/.env.local`  
**Logic:** All 6 contract addresses in the UI are from Wave17 (deployed ~2026-05-10). The current contracts are Wave30 (deployed 2026-05-12). The app sends transactions to nonexistent/lagging contracts.

**⚠ DISCREPANCY:** The README table and `deployments/421614.json` **both claim Wave30 but list different addresses.** On-chain verification via Arbiscan is required before applying one or the other. Below shows both candidate sets with the deployments JSON as the script-generated source of truth.

**Old (Wave17):**
```env
NEXT_PUBLIC_VAULT_ADDRESS=0x06d9A84B289f3203a3268051DE66D733fc6f7EeA
NEXT_PUBLIC_POOL_ADDRESS=0x6e4DA21723ea0e3E87320b5c7146DACacb2a4958
NEXT_PUBLIC_ROUTER_ADDRESS=0xC990c3287844e44D145780d5b90B0d22A7FE9A7d
NEXT_PUBLIC_REGISTRY_ADDRESS=0xFCb1beeaDBa65718eB1AF96F9fC72989704D98c0
NEXT_PUBLIC_ORACLE_ADDRESS=0x3ffD184d90daBe831C647D82242163B1940938b4
NEXT_PUBLIC_COMPOSER_ADDRESS=0x9d3f780f1644E0A3E84b34bABcF11943377aFd46
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=0xC990c3287844e44D145780d5b90B0d22A7FE9A7d
```

**New (candidate — `deployments/421614.json` values, MUST verify on-chain first):**
```env
NEXT_PUBLIC_VAULT_ADDRESS=0x75c7D581d9c408B93Bf6FB43aF3ECbe6FF5EEB1A
NEXT_PUBLIC_POOL_ADDRESS=0x4F0508ca71a5Dae2C49FD9307a507f74DE90DD72
NEXT_PUBLIC_ROUTER_ADDRESS=0x56d08512c95562Ea3F70Bc16E0a0379E3632221B
NEXT_PUBLIC_REGISTRY_ADDRESS=0x4e0414204972C9127E7eef2aeA5493e6E4D44914
NEXT_PUBLIC_ORACLE_ADDRESS=0xfA7B1f68c66AEf1BDC0981465ee5E29E456Da12C
NEXT_PUBLIC_COMPOSER_ADDRESS=0x9892D8CaEB4a2ab4Dba10126a2f49D2aD5807b2C
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=0x56d08512c95562Ea3F70Bc16E0a0379E3632221B
```

**Priority:** P0-BROKEN  
**Rollback:** Revert to Wave17 addresses.  
**Verify:**
- `cast code <address> --rpc-url https://sepolia-rollup.arbitrum.io/rpc` returns non-empty bytecode for each address
- Each address's implementation matches the expected contract (check via Arbiscan at `https://sepolia.arbiscan.io/address/<addr>`)
- UI loads and connects to the correct contracts (check network tab for contract calls)

---

### MC-D4-05 · Replace backend contract addresses (Wave5-6 → Wave30)

**File:** `backend/apps/.env.development`  
**Logic:** Backend contract addresses (VAULT, POOL, ROUTER, REGISTRY) are from Wave5-6 era — older than even the UI's Wave17 values. Backend cannot interact with current contracts.

**Old (Wave5-6):**
```env
VAULT_ADDRESS=0x261c4b5a66C24Dd1974E7ea470e76154dff062F5
POOL_ADDRESS=0xb4F6b792219e3d6Cd3f3B8088285e52a64CCcb44
ROUTER_ADDRESS=0x78C2818a401477F78E129A7526bC833Eb93d964A
REGISTRY_ADDRESS=0xcdFB608e7f45f6e6cCA27e504ce6b8aDe64701B9
```

**New (candidate — `deployments/421614.json` values, MUST verify on-chain first):**
```env
VAULT_ADDRESS=0x75c7D581d9c408B93Bf6FB43aF3ECbe6FF5EEB1A
POOL_ADDRESS=0x4F0508ca71a5Dae2C49FD9307a507f74DE90DD72
ROUTER_ADDRESS=0x56d08512c95562Ea3F70Bc16E0a0379E3632221B
REGISTRY_ADDRESS=0x4e0414204972C9127E7eef2aeA5493e6E4D44914
```

**Priority:** P0-BROKEN  
**Rollback:** Restore Wave5-6 values.  
**Verify:** Backend `/health` endpoint returns chain status; backend event indexer picks up events from the new contract addresses.

---

### MC-D4-06 · Reconcile WETH/USDC token addresses across all files

**File:** `ui/.env.local`, `backend/apps/.env.development`, `contracts/.env`  
**Logic:** WETH address differs between UI, Backend, and README/deployments. USDC differs between Backend and everything else. Token addresses must be consistent for the app to function.

**Current state:**

| Source | WETH | USDC |
|---|---|---|
| UI `.env.local` | `0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32` | `0x150376EdEbc5AC48771655a61a795d828BeC8Df6` |
| Backend `.env.development` | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| README | `0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d` | `0x150376EdEbc5AC48771655a61a795d828BeC8Df6` |
| `deployments/421614.json` | `0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32` | *(not present)* |

**Three different WETH addresses.** The `deployments/421614.json` weth and UI WETH agree (`0x84BddCA...`). The Backend and README each use different values.

**New — use deployments value as ground truth (after on-chain verification):**
- **WETH:** `0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32` (matches UI `.env.local` and `deployments/421614.json`)
- **USDC:** `0x150376EdEbc5AC48771655a61a795d828BeC8Df6` (matches UI `.env.local` and README; deployments file doesn't specify USDC explicitly)

**Old (backend):**
```env
TOKEN_WETH=0x980B62Da83eFf3D4576C647993b0c1D7faf17c73
TOKEN_USDC=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
```

**New (backend):**
```env
TOKEN_WETH=0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32
TOKEN_USDC=0x150376EdEbc5AC48771655a61a795d828BeC8Df6
```

Also update `contracts/.env` similarly:
```env
WETH_ADDRESS=0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32
USDC_ADDRESS=0x150376EdEbc5AC48771655a61a795d828BeC8Df6
```

**Priority:** P0-BROKEN  
**Rollback:** Restore prior token addresses per-file.  
**Verify:**
- `cast call <weth> "name()" --rpc-url <rpc>` returns `"Wrapped Ether"` on-chain
- `cast call <usdc> "decimals()" --rpc-url <rpc>` returns `6`
- All three configs use identical WETH and USDC addresses

---

## P0-MONITORING

---

### MC-D4-07 · Move monitoring from Docker-local to Railway (production observability)

**Files:** `monitoring/docker-compose.yml`, `backend/apps/railway.json`  
**Logic:** The Prometheus/Grafana/Loki/Alertmanager stack is Docker-compose only — it runs `localhost` and is invisible to Railway deployments. No production metrics collection exists. Three options (ordered by recommendation strength):

**Option A (Recommended): Railway Observability Add-ons**
Railway supports add-on services. Deploy Prometheus and Grafana as separate Railway services within the same project.

```
Railway Project: fheforge
├── Backend API (existing)
├── Prometheus (new)
├── Grafana (new)
└── Alertmanager (new)
```

**Option B (Lighter): Railway Built-in Metrics**
Railway natively exposes CPU/memory/restart metrics in the dashboard. Remove prometheus dependency and use Railway's native observability for MVP.

**Option C (Hybrid): Deploy a single `prometheus-node-exporter` sidecar to backend, keep Grafana local**

**Old:** No monitoring in Railway config.
```json
// backend/apps/railway.json — no monitoring section
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node dist/main",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**New (Option A — add monitoring as Railway add-on services):**
```json
// No change to railway.json itself — monitoring is separate services.
// Instead, add via `railway add` CLI or Railway dashboard.
```

**Priority:** P0-MONITORING  
**Rollback:** Remove/add the monitoring services in Railway dashboard.  
**Verify:**
- `railway status` shows monitoring services running
- Prometheus dashboard accessible at `prometheus.<project>.up.railway.app`
- Grafana dashboard accessible at `grafana.<project>.up.railway.app`

---

### MC-D4-08 · Create Grafana dashboard provisioning files

**Files:** `monitoring/grafana/dashboards/` (directory + JSON files)  
**Logic:** The `monitoring/` README references `grafana/dashboards/` for 4 dashboards (API Performance, Database Performance, Contract Interactions, System Health) but the directory doesn't exist. No dashboard JSON files are provisioned, and no `grafana/datasources/` provisioning directory exists either.

**Old (missing):**
```bash
$ ls monitoring/grafana/
ls: cannot access 'monitoring/grafana/': No such file or directory
```

**New — create provisioning structure:**
```
monitoring/grafana/
├── dashboards/
│   ├── api-performance.json
│   ├── database-performance.json
│   ├── contract-interactions.json
│   └── system-health.json
└── datasources/
    └── prometheus.yml
```

**`datasources/prometheus.yml`:**
```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

**Minimum viable dashboard** (`api-performance.json` — others follow same pattern):
```json
{
  "title": "API Performance",
  "panels": [
    {
      "title": "Request Rate",
      "type": "graph",
      "targets": [{ "expr": "rate(http_requests_total[5m])" }]
    },
    {
      "title": "Error Rate",
      "type": "graph",
      "targets": [{ "expr": "rate(http_requests_total{status=~\"5..\"}[5m])" }]
    },
    {
      "title": "P95 Latency",
      "type": "graph",
      "targets": [{ "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))" }]
    }
  ]
}
```
(These metrics won't appear until MC-D4-11 is implemented.)

**Priority:** P0-MONITORING  
**Rollback:** Delete the `monitoring/grafana/` directory.  
**Verify:**
- `ls monitoring/grafana/dashboards/` shows 4 JSON files
- `ls monitoring/grafana/datasources/` shows `prometheus.yml`
- Grafana container starts without provisioning errors
- Grafana UI shows pre-configured data source and dashboards (at `http://localhost:3000`)

---

### MC-D4-09 · Fix/remove 11 broken alert rules referencing non-existent metrics

**File:** `monitoring/alerts/alerts.yml`  
**Logic:** 11 of 14 alert rules reference metrics that are never produced by any service:

| # | Rule | Metric | Status |
|---|---|---|---|
| 1 | HighErrorRate | `http_requests_total` | **BROKEN — no /metrics endpoint** |
| 2 | SlowAPIResponse | `http_request_duration_seconds_bucket` | **BROKEN** |
| 3 | APIDown | `up{job="backend-api"}` | **BROKEN** |
| 4 | DatabaseConnectionFailed | `up{job="database"}` | **BROKEN** |
| 5 | SlowDatabaseQueries | `database_query_duration_seconds_bucket` | **BROKEN** |
| 6 | HighDatabaseConnections | `database_connections_active` | **BROKEN** |
| 7 | ContractDeploymentFailed | `contract_deployment_total` | **BROKEN** |
| 8 | HighGasPrice | `gas_price_gwei` | **BROKEN** |
| 9 | ContractInteractionFailed | `contract_interaction_total` | **BROKEN** |
| 13 | NewUserSignup | `user_signups_total` | **BROKEN** |
| 14 | HighTransactionVolume | `contract_interaction_total` | **BROKEN** |
| 10 | HighCPUUsage | `node_cpu_seconds_total` | OK (node-exporter) |
| 11 | HighMemoryUsage | `node_memory_*` | OK (node-exporter) |
| 12 | HighDiskUsage | `node_filesystem_*` | OK (node-exporter) |

**Strategy:** Remove rules 1–9 and 13–14 until the `/metrics` endpoint is implemented (MC-D4-11). Keep rules 10–12 (node-exporter) as they work when Docker stack is running. Add a comment noting the removed rules are pending backend metrics instrumentation.

**Old:**
```yaml
groups:
  - name: api_alerts
    interval: 30s
    rules:
      - alert: HighErrorRate            # ← BROKEN
        expr: ...
      - alert: SlowAPIResponse          # ← BROKEN
        expr: ...
      - alert: APIDown                  # ← BROKEN
        expr: ...
  - name: database_alerts
    ...
      - alert: DatabaseConnectionFailed  # ← BROKEN
      - alert: SlowDatabaseQueries       # ← BROKEN
      - alert: HighDatabaseConnections   # ← BROKEN
  - name: contract_alerts
    ...
      - alert: ContractDeploymentFailed  # ← BROKEN
      - alert: HighGasPrice              # ← BROKEN
      - alert: ContractInteractionFailed # ← BROKEN
  - name: system_alerts
    ...
      - alert: HighCPUUsage              # ← OK (node-exporter)
      - alert: HighMemoryUsage           # ← OK (node-exporter)
      - alert: HighDiskUsage             # ← OK (node-exporter)
  - name: business_alerts
    ...
      - alert: NewUserSignup             # ← BROKEN
      - alert: HighTransactionVolume     # ← BROKEN
```

**New — keep only system_alerts group, comment out the rest with explanation:**
```yaml
groups:
  # ────────────────────────────────────────────────────────────
  # API, Database, Contract, and Business alert groups removed.
  # These referenced metrics (http_requests_total,
  # http_request_duration_seconds, contract_interaction_total,
  # etc.) are not yet emitted by any service.
  #
  # Restore when backend /metrics endpoint is implemented
  # (see MC-D4-11).
  # ────────────────────────────────────────────────────────────

  - name: system_alerts
    interval: 30s
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
          service: system
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is {{ $value }}% on {{ $labels.instance }}"

      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 80
        for: 5m
        labels:
          severity: warning
          service: system
        annotations:
          summary: "High memory usage"
          description: "Memory usage is {{ $value }}% on {{ $labels.instance }}"

      - alert: HighDiskUsage
        expr: (node_filesystem_size_bytes{fstype!="tmpfs"} - node_filesystem_free_bytes{fstype!="tmpfs"}) / node_filesystem_size_bytes{fstype!="tmpfs"} * 100 > 80
        for: 5m
        labels:
          severity: warning
          service: system
        annotations:
          summary: "High disk usage"
          description: "Disk usage is {{ $value }}% on {{ $labels.instance }}"
```

**Priority:** P0-MONITORING  
**Rollback:** Restore all 14 rules from git history: `git checkout monitoring/alerts/alerts.yml`  
**Verify:**
- `promtool check rules monitoring/alerts/alerts.yml` exits 0
- Prometheus container starts without "rule evaluation error" log messages
- Only 3 alert rules are loaded (check `/api/v1/rules` on Prometheus)

---

### MC-D4-10 · Add Sentry dependencies (currently zero)

**File:** `backend/apps/package.json`, `ui/package.json` (optional)  
**Logic:** Documentation references Sentry for error tracking, but zero Sentry dependencies exist anywhere in the project. Root-level `node_modules/` has `@sentry/node@5.30.0` and `@sentry/tracing` — these are from a transitive dependency (likely `eslint` or similar), not configured or initialized in either app.

**Old (`backend/apps/package.json` dependencies — no Sentry):**
```json
  "dependencies": {
    "@google/generative-ai": "^0.24.1",
    "@nestjs/common": "^11.0.1",
    ...
    // No @sentry/*
  }
```

**New:**
```bash
# In backend/apps/
npm install @sentry/node @sentry/profiling-node

# In ui/
npm install @sentry/nextjs
```

**Backend initialization** (`backend/apps/src/main.ts`, add before `NestFactory.create`):
```typescript
import * as Sentry from '@sentry/node';
// ...
async function bootstrap() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
    integrations: [Sentry.nativeNodeFetchIntegration()],
  });
  // ...
```

**Environment variable** to add to `.env.development`:
```env
SENTRY_DSN=
```

**Priority:** P0-MONITORING  
**Rollback:** `npm uninstall @sentry/node @sentry/profiling-node` from backend; remove Sentry init from main.ts  
**Verify:**
- `grep -r "@sentry/" backend/apps/package.json` returns Sentry dependencies
- Backend starts without error when `SENTRY_DSN` is empty (Sentry no-ops)
- Backend reports an error to Sentry dashboard when `SENTRY_DSN` is set and an error is thrown

---

## P1

---

### MC-D4-11 · Rotate leaked key and verify it's invalid

**File:** (on-chain operation, not a file change)  
**Logic:** The key `0xf0c35250d31fdd7db7756d4bbc26b7803b54f0205ccd99723f3d34d6a56f9049` was in git. Even after removal from code, the key itself must be rotated — deployer contract roles must be transferred to a new key and the old key renounced.

**Steps:**

1. Generate new deployer key: `cast wallet new`
2. Fund new deployer with test ETH from faucet
3. Transfer ownership of each contract to new deployer:
   ```
   cast send <StrategyVault> "transferOwnership(address)" <new-deployer> --private-key <old-key> --rpc-url <rpc>
   ```
4. Update `contracts/.env` PRIVATE_KEY with new value
5. Verify old key no longer has any owner role:
   ```
   cast call <contract> "owner()" --rpc-url <rpc>
   # Must NOT return the old deployer address
   ```

**Priority:** P1  
**Rollback:** Re-transfer ownership back to old key (if it still has gas funds).  
**Verify:** `cast balance <old-deployer-address> --rpc-url <rpc>` returns 0 and no `owner()` call returns the old address.

---

### MC-D4-12 · Create Base Sepolia deployment artifact stub

**Files:** `contracts/deployments/84532.json` (create if needed)  
**Logic:** No Base Sepolia deployment artifact exists (`contracts/deployments/84532.json` is absent despite `BASE_SEPOLIA_RPC_URL` being configured in `contracts/.env` and the `NEXT_PUBLIC_BASE_*` address variables existing in `ui/.env.local`. The UI currently has commented-out placeholder addresses for Base Sepolia.

**Current state:**
```bash
$ ls contracts/deployments/ | grep 84532
# empty — no Base Sepolia artifact
```

**New (stub indicating contracts are not yet deployed):**
```json
{
  "network": "base-sepolia",
  "chainId": 84532,
  "deployer": "",
  "deployedAt": null,
  "mode": "not-deployed",
  "wave": null,
  "contracts": {},
  "notes": "Base Sepolia deployment not yet performed. Requires deploy:base script run after Arbitrum Sepolia contracts are finalized.",
  "weth": "",
  "usdc": ""
}
```

**Also:** Clear the placeholder Base Sepolia addresses in `ui/.env.local` (lines 15-18 currently have placeholder values):
```env
# Base Sepolia contracts — not deployed yet
NEXT_PUBLIC_BASE_VAULT_ADDRESS=
NEXT_PUBLIC_BASE_POOL_ADDRESS=
NEXT_PUBLIC_BASE_ROUTER_ADDRESS=
NEXT_PUBLIC_BASE_REGISTRY_ADDRESS=
```
(Set to empty strings to prevent accidental cross-chain usage.)

**Priority:** P1  
**Rollback:** Delete `contracts/deployments/84532.json` if it shouldn't exist yet.  
**Verify:**
- `ls contracts/deployments/84532.json` exists
- `jq '.mode' contracts/deployments/84532.json` returns `"not-deployed"`
- UI `.env.local` `NEXT_PUBLIC_BASE_*` values are empty strings

---

## P2

---

### MC-D4-13 · Add `/metrics` endpoint to backend (NestJS + prom-client)

**File:** `backend/apps/src/app.controller.ts` (or new `metrics.controller.ts`)  
**File:** `backend/apps/package.json` (add `prom-client` dep)  
**Logic:** The backend has no Prometheus metrics endpoint. The Prometheus `scrape_configs` in `monitoring/prometheus.yml` already configure scrapes to `backend:3001/metrics` and `backend:3001/api/custom-metrics` — but these return 404. `/metrics` is a prerequisite for all alert rules 1–9 and 13–14 to work.

**Old:**
```typescript
// app.controller.ts — only has /health
@Controller()
export class AppController {
  @Get('health')
  async health() {
    const status = await this.fhenixStrategy.getNetworkStatus();
    return { ...status, status: 'ok', chain: 'arb-sepolia', chainId: 421614 };
  }
}
```

**New — add metrics endpoint:**

```bash
npm install prom-client @opentelemetry/api
```

```typescript
// metrics.controller.ts
import { Controller, Get, Header } from '@nestjs/common';
import * as promClient from 'prom-client';

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

const userSignupsTotal = new promClient.Counter({
  name: 'user_signups_total',
  help: 'Total user sign-ups',
  registers: [register],
});

@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('Content-Type', register.contentType)
  async metrics(): Promise<string> {
    return register.metrics();
  }
}
```

**Also update** `monitoring/prometheus.yml` scrape config (s/`backend`/hostname/ for Railway) and remove the stale `job: custom-metrics` entry.

**Priority:** P2  
**Rollback:** Remove `MetricsController`, `prom-client` from `package.json`.  
**Verify:**
- `curl http://localhost:3001/metrics` returns Prometheus-format metrics including `http_requests_total`, `http_request_duration_seconds_bucket`, `process_cpu_seconds_total`
- Prometheus `targets` page shows backend target as UP
- `rate(http_requests_total[5m])` returns a value in Prometheus

---

### MC-D4-14 · Restore/redesign alert rules after `/metrics` exists

**File:** `monitoring/alerts/alerts.yml`  
**Logic:** After MC-D4-13 (backend `/metrics` endpoint), the previously removed alert rules (MC-D4-09) can be restored — BUT they need to match the actual metrics emitted. Specifically:
- `http_requests_total` must be labeled with `method`, `route`, `status` (from the new MetricsController)
- `http_request_duration_seconds` is a Histogram (provides `_bucket`, `_sum`, `_count`)
- `database_query_duration_seconds` and `contract_interaction_*` metrics require additional instrumentation
- `user_signups_total` is implemented as a Counter

**New — add only the rules whose metrics actually exist:**

```yaml
  - name: api_alerts
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total[5m]))
          ) > 0.05
        for: 5m
        labels:
          severity: critical
          service: backend-api
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} for the last 5 minutes"

      - alert: SlowAPIResponse
        expr: |
          histogram_quantile(0.95,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
          ) > 1
        for: 5m
        labels:
          severity: warning
          service: backend-api
        annotations:
          summary: "Slow API response time"
          description: "95th percentile response time is {{ $value }}s"

      - alert: APIDown
        expr: up{job="backend-api"} == 0
        for: 1m
        labels:
          severity: critical
          service: backend-api
        annotations:
          summary: "API is down"
          description: "Backend API has been down for more than 1 minute"

      - alert: NewUserSignup
        expr: increase(user_signups_total[5m]) > 0
        labels:
          severity: info
          service: business
        annotations:
          summary: "New user sign-up"
          description: "{{ $value }} new user(s) signed up in the last 5 minutes"
```

**Leave out** (require further backend instrumentation):
- Database alerts (no `database_query_*` metrics emitted yet)
- Contract alerts (no `contract_interaction_*` metrics emitted yet)
- HighGasPrice (gas price data not exposed as a metric)

**Priority:** P2  
**Rollback:** Run `git checkout monitoring/alerts/alerts.yml` to restore the 3-rule version from MC-D4-09.  
**Verify:** All 7 rules (3 system + 4 API) evaluate without error. Prometheus `/api/v1/rules` shows them all as active.

---

### MC-D4-15 · Add Railway monitoring configuration

**File:** `backend/apps/railway.json` (add health check path)  
**Logic:** Railway supports health check endpoints for restart policy. Currently `railway.json` only has `restartPolicyType: ON_FAILURE` but no health check path or timeout configuration. This means Railway doesn't know when the app is truly unhealthy vs. still starting.

**Old:**
```json
{
  "deploy": {
    "startCommand": "node dist/main",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**New:**
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node dist/main",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3,
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30
  }
}
```

**Also create** a Railway-native metrics integration (optional): Railway can forward metrics to Grafana Cloud or other providers via its integrations panel.

**Priority:** P2  
**Rollback:** Remove `healthcheckPath` and `healthcheckTimeout` from `railway.json`.  
**Verify:**
- Railway deployment dashboard shows "Healthy" status
- Railway automatically restarts the service if `/health` returns 5xx
- `railway logs` shows health check pings at `/health`

---

## Summary: Address Reconciliation Decision Tree

The most critical issue is the **four conflicting address sets**. The recommended resolution workflow:

```
1. Run:  cast code <addr> --rpc-url https://sepolia-rollup.arbitrum.io/rpc
         for each address in deployments/421614.json
   → If bytecode exists, deployments JSON is correct

2. If deployments JSON addresses are dead:
   Try README addresses with same cast code check
   → If bytecode exists, README is correct

3. If NEITHER set has bytecode:
   → A newer deploy happened that didn't update either artifact
   → Re-run: npx hardhat run scripts/deploy.ts --network arbitrumSepolia
   → Capture the output addresses

4. Apply the verified set to:
   - ui/.env.local (MC-D4-04)
   - backend/apps/.env.development (MC-D4-05)
   - contracts/.env (MC-D4-06)
```

---

## Execution Order (Dependency Graph)

```
MC-D4-01 (remove leaked key) ─────────────────────────────────┐
MC-D4-02 (purge .env from git index) ─────────────────────────┤
MC-D4-03 (unique test keys) ──────────────────────────────────┤
                                                               ├→ P0 (no deps, parallel OK)
MC-D4-04 (UI addresses) ──────────────────────────────────────┤
MC-D4-05 (backend addresses) ─────────────────────────────────┤
MC-D4-06 (token addresses) ───────────────────────────────────┘
                                     
MC-D4-07 (monitoring → Railway) ──────────────────────────────┐
                                                               ├→ P0-MON (parallel OK)
MC-D4-08 (Grafana dashboards) ────────────────────────────────┤
MC-D4-09 (fix alert rules) ───────────────────────────────────┤
MC-D4-10 (add Sentry) ────────────────────────────────────────┘

MC-D4-11 (rotate key) ─────── (needs MC-D4-01 first) ────────→ P1

MC-D4-12 (Base Sepolia stub) ─ (no deps) ────────────────────→ P1
MC-D4-13 (/metrics endpoint) ─ (no deps, but MC-D4-09's fix   │
                                 references this) ────────────→ P2
MC-D4-14 (restore alert rules) ─ (needs MC-D4-13) ───────────→ P2
MC-D4-15 (Railway healthcheck) ─ (no deps) ──────────────────→ P2
```

**Total: 15 microchanges** across 5 priority tiers.
