# Agent Critique — Frontend / UI-UX (Wave 1 Audit)

**Critique of:** `agent-2-frontend.md` (ref. `WAVE1_MANIFEST.md §2`)
**Date:** 2026-05-18
**Scope:** All 5 P0 findings, P2 findings, missed findings, cross-cutting dependencies

---

## Severity Re-Assessment

### FE-P0-1: ConfigPanel render-side-effect causes infinite re-render loop

**Original severity:** P0
**Corrected severity:** **P1** (disagree — see rationale)

The `initializedNodeIdRef.current !== node.id` guard prevents a true *infinite* loop. After the first render + state-batch cascade, the ref is set and the block skips on subsequent renders. This is:
- Not crash-causing under normal conditions
- A real code smell (side effects in render body)
- Could degrade to P0 if `pairs` or `node.id` change on every render due to upstream logic (e.g., if pairs array is re-created each render)

**P0 is defensible** if you assume the worst case (upstream creates new `pairs` reference on every render, defeating the ref guard). But the actual behavior is ~P1-majority: excessive initial re-renders, not infinite.

**Add nuance:** The agent correctly identifies the fix (`useEffect`) but misses that the dependency array needs careful consideration — `pairs` is likely re-created each render by ReactFlow / parent, which could cause the effect to re-run on every render anyway. The ref (`initializedNodeIdRef`) inside the effect mitigates this, but the effect still re-runs unnecessarily. Recommend memoizing `pairs` upstream OR using a layout effect for initialization.

---

### FE-P0-2: ProtocolIcon hardcodes weth.svg, takes no props

**Original severity:** P0 ✓ **Correct**

Confirmed — `ProtocolIcon` takes zero props, always renders WETH.
- The caller (`defi-node-shell.tsx:74`) passes `protocolName` prop that is silently ignored
- `TokenIcon` (sibling component) already has the correct pattern — accepts `symbol`, has fallback UI (first-letter letter), supports `size`
- This is a real visual bug: every DeFi node shows WETH regardless of protocol (Uniswap, Aave, Fhenix)

**Edge cases missed:** `ProtocolIcon` has NO fallback UI when icon is missing. `TokenIcon` shows a letter-based fallback. The agent's remediation preserves this gap — if `agentIcons[symbol]` is `undefined`, it falls back to `agentIcons.FHENIX` but if `FHENIX` is also missing, `Image` renders with `src=undefined` which causes a runtime error. Should add a fallback component similar to `TokenIcon`.

---

### FE-P0-3: Duplicate SWAP case in getAmountOut — dead code

**Original severity:** P0
**Corrected severity:** **P2** (disagree — over-severity)

This is dead code — unreachable by definition. Dead code is a maintenance hazard, not a runtime bug. The second `case "SWAP"` is never reached because JavaScript `switch` matches the first `case "SWAP"` and `return`s before falling through. The merged remediation (adding `estimate?.shares_out` fallback to the first case) is a minor functional enhancement, not a bug fix.

**P0 means "blocks deployment or causes data loss / security breach."** This does neither. P2 is appropriate.

---

### FE-P0-4: StrategyPromptDetails is "Coming Soon" stub

**Original severity:** P0
**Corrected severity:** **P1** (disagree — not P0)

A "Coming Soon" placeholder degrades UX but doesn't break anything. The component renders gracefully (full height, centered, styled). The strategy detail page still works — other tabs display correctly. This is a missing feature, not a crash or data loss.

P1 is appropriate: "major user-facing impact" — the AI prompt strategy feature is a differentiator for the project.

---

### FE-P0-5: useRebalance exists but has zero consumers

**Original severity:** P0
**Corrected severity:** **P1** (disagree — not P0)

97 lines of dead code. No runtime impact — unused code just sits in the bundle. The agent's own remediation says "either wire it or delete it." If deleted (Option B), this is trivial. If wired (Option A), it's a feature addition.

**The real P0 argument:** If someone *expects* to be able to rebalance and the button doesn't exist, that's product failure. But that's feature completeness, not a deployment blocker. P1.

---

### FE-P2-1: Missing Base Sepolia env vars

**Original severity:** P2
**Corrected severity:** **P2** ✓ Correct

Confirmed — `.env.local` has BASE_VAULT, BASE_POOL, BASE_ROUTER, BASE_REGISTRY but is missing BASE_COMPOSER, BASE_SWAP_ROUTER, BASE_ORACLE. The code in `addresses.ts:35-43` will throw `!` assertion errors at runtime on Base chain. P2 is correct because Base Sepolia is not the primary chain.

---

### FE-P2-2: Wire useRebalance into strategy detail page

**Original severity:** P2
**Corrected severity:** **P2** ✓ Correct

This is a feature addition for the strategy detail page. The agent provides a full component implementation. Correct severity.

---

## Edge Cases & Scenarios Missed by Original Analysis

### 1. ConfigPanel: Pairs reference instability (FE-P0-1, extension)

The agent recommends `[pairs, node.id, node.data?.config, prevConfig, requiresTokenOut]` as useEffect deps. But `pairs` is likely derived from ReactFlow state or an API call, meaning it may be a **new array reference every render**. This defeats the purpose of useEffect — the effect re-runs every render, making the ref guard the *real* protection. The code works by accident, not by design.

**Fix:** Memoize `pairs` upstream OR use `useMemo` in ConfigPanel. Or keep the ref guard inside the effect (current proposal) and add `pairs.length` as the only dependency.

### 2. ProtocolIcon: No empty/loading/error state (FE-P0-2, extension)

If `agentIcons[symbol]` returns `undefined` AND `agentIcons.FHENIX` is undefined (someone edits `iconMap.ts`), the `Image` component receives `src={undefined}` which in Next.js triggers a 500 error in development and a broken image in production. `TokenIcon` has a proper fallback — `ProtocolIcon` does not.

### 3. SWAP deduplication: `shares_out` field may be incorrect type (FE-P0-3, extension)

The merged logic assumes `estimate?.shares_out` is a valid number. But `shares_out` could be a different format (bigint, decimal string, etc.) compared to `amount_out`. If the estimate object comes from different sources (backend API vs. contract call vs. simulation), field types might differ silently.

### 4. StrategyPromptDetails: `DefiStrategy` type may not have `prompt` or `context` fields (FE-P0-4, extension)

The agent's implementation reads `strategy?.prompt` and `strategy?.context` from a `DefiStrategy` type. This assumes these fields exist on the type. If they don't (type mismatch between UI types and API response), the component will always show the empty state. Need to verify the `DefiStrategy` type definition and the API shape match.

### 5. useRebalance wiring: Hardcoded LTV and token addresses (FE-P2-2, extension)

The agent's `StrategyRebalance` component hardcodes `WETH` as collateral token, `USDC` as borrow token, and `7500n / 10000n` as LTV ratio. This might not match the user's actual position composition. If the user's position uses different tokens, the rebalance call will revert with cryptic errors.

---

## Implementation Risks

### Risk 1: ConfigPanel useEffect dependency cascade (FE-P0-1)

Wrapping 80+ lines of initialization logic in `useEffect` will cause a **flash of empty state** on every component mount (effect runs after paint). The current render-body approach at least initializes synchronously before first paint. Users may see: "no tokens selected" → "tokens populated" flash.

**Mitigation:** Use `useLayoutEffect` instead of `useEffect` to run before paint. Or initialize in a lazy-initialized state (`useState` with initializer function).

### Risk 2: ProtocolIcon image 404s in production (FE-P0-2)

Adding dynamic `symbol` prop means the `Image` component receives different `src` values. If the icon file doesn't exist, Next.js `Image` logs a 404 in production but *throws an error in development*. The agent's remediation should include a try/catch or fallback.

**Mitigation:** Add fallback similar to `TokenIcon` (first-letter display) when `agentIcons[symbol]` is not found. Use `onError` callback on `Image` to handle missing files gracefully.

### Risk 3: SWAP deduplication changes behavior for non-SWAP operations (FE-P0-3)

Low risk — the only change is adding `estimate?.shares_out` fallback to the SWAP case. But if other code paths depend on `getAmountOut` returning `null` for SWAP (unlikely but possible), this could cause downstream issues.

### Risk 4: StrategyPromptDetails breaks if API shape diverges (FE-P0-4)

If the backend API returns a different shape than the `DefiStrategy` TypeScript type, the component shows "No prompt data available" silently. Zero error logging or fallback.

### Risk 5: useRebalance deletion removes ABI import (FE-P0-5, Option B)

If other components import the `FheForgeComposer` ABI for other reasons, deleting `use-rebalance.ts` will cause a build error unless tree-shaking handles it. The agent should verify no other imports depend on the ABI file.

### Risk 6: useRebalance wiring triggers real contract calls (FE-P2-2, Option A)

The `StrategyRebalance` component calls `rebalanceWithEncrypt` which triggers an actual `writeContractAsync` call. If the hardcoded parameters produce invalid calldata, the transaction reverts with gas spent and no user-friendly error. The agent's component lacks transaction error handling beyond `console.error`.

---

## Missed Findings

### MF-1: chainIcons maps "base-sepolia" → Arbitrum icon (P1)

**File:** `ui/lib/iconMap.ts:19-22`
```typescript
export const chainIcons: Record<string, string> = {
  "arb-sepolia": "/chain-icon/arbitrum.png",
  "base-sepolia": "/chain-icon/arbitrum.png",  // ← WRONG: should be base logo
  arbitrum: "/chain-icon/arbitrum.png",
};
```

If the app supports Base Sepolia, switching chains shows an Arbitrum icon — completely misleading. Also, there is no Base chain icon file at all in `public/chain-icon/`.

**Severity:** P1 (visually broken, misleading chain identity)
**Fix:** Create or obtain a Base Sepolia chain icon; correct the mapping.

---

### MF-2: iconMap has incomplete coverage — DOT tokens have SVGs but no mapping (P2)

**Files:** `ui/public/icons/assets/` has `dot.svg`, `gdot.svg`, `vdot.svg` but `ui/lib/iconMap.ts` only maps WETH, USDC, USDT.

The icon files exist on disk but are unreferenced. If a strategy involves DOT-based tokens, the UI falls back to... nothing (well, `TokenIcon` shows first-letter fallback, which works but looks inconsistent).

**Severity:** P2 (incomplete asset coverage, minor visual issue)
**Fix:** Add DOT/vDOT/gDOT entries to both `iconMap` and `assetIcons`.

---

### MF-3: No error boundary for API failures / backend-down state (P2)

**File:** `ui/services/api.ts`

The Axios instance has `API_TIMEOUT` as the only error handling. There are no request/response interceptors, no retry logic, no global error handler. If the backend (at `https://fheforge-backend-production.up.railway.app`) is down — and the Wave 1 audit flags this backend as having critical auth issues — the frontend will silently fail or throw unhandled promise rejections.

**Scenarios:**
- User navigates to strategy list → API returns 500 → blank page with no error message
- User submits a strategy → API network error → toast never fires, user thinks it worked
- Auth guard (when implemented) rejects requests → confusing silent failures

**Severity:** P2 (degraded UX on backend failure, no fallback communication to user)

---

### MF-4: `validateEnvVars` only console.warns — no build-time or user-facing error (P2)

**File:** `ui/utils/addresses.ts:63-77`, called from `ui/app/layout.tsx:29`

```typescript
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.warn(`[FheForge] Missing env vars: ${missing.join(", ")}`);
}
```

This is called at module level — fine for Next.js SSR. But `console.warn` in a server context is invisible to end users and easily missed in CI logs. A missing env var causes cryptic `!` assertion errors downstream (e.g., `process.env.NEXT_PUBLIC_VAULT_ADDRESS!` throws "Cannot read properties of undefined").

**Severity:** P2 (silent config failure → runtime crash)
**Fix:** Make `validateEnvVars()` throw on missing keys in development; use `process.env.NODE_ENV` guard.

---

### MF-5: Token address non-null assertions mask missing config (P2)

**File:** `ui/utils/addresses.ts:7-9`
```typescript
WETH: { address: process.env.NEXT_PUBLIC_TOKEN_WETH!, decimals: 18 },
USDC: { address: process.env.NEXT_PUBLIC_TOKEN_USDC!, decimals: 6 },
USDT: { address: process.env.NEXT_PUBLIC_TOKEN_USDT ?? "", decimals: 6 },
```

WETH and USDC use `!` (non-null assertion) which means if the env var is missing, these silently become `undefined`. Only USDT has a `?? ""` fallback. Combined with MF-4, this means:
- If `.env.local` is misconfigured, `TOKEN_SYMBOL_MAP.WETH.address` is `undefined`
- Contract calls use `undefined` as token address → revert with incomprehensible error

**Severity:** P2

---

### MF-6: Stale ZK verifier key workaround undocumented in frontend context (P2)

**File:** `ui/hooks/use-composer.ts:73-88`
```typescript
// R7: WORKAROUND — do NOT use setAccount(composerAddress) for cross-contract calls.
// On arb-sepolia, the TaskManager has a stale ZK verifier key ...
// Without setAccount, the default account = user wallet ...
```

This workaround is documented in the code but the agent didn't flag it as a finding. This is a **cross-cutting concern** (frontend + contracts + infra):
- If the TaskManager is ever updated to enforce `account == msg.sender`, all composer operations break
- The workaround bypasses the intended CoFHE security model (user encrypting for contract)
- There's no test or monitoring to detect when this becomes a problem

**Severity:** P2 (latent security bypass, no monitoring for breakage)

---

### MF-7: Zero error tracking / analytics for frontend crashes (P3)

The INFRA domain flags missing Sentry for the backend, but the frontend also has no runtime error tracking. `@sentry/nextjs` is not in `package.json`. If the ConfigPanel re-render loop or any other P0/P1 bug occurs in production, **there is zero visibility**.

The app does have `@vercel/analytics` which tracks page views but not JavaScript errors.

**Severity:** P3 (no production error visibility — harder to debug post-deployment)

---

### MF-8: `tsconfig.json` excludes test files from type-checking (P3)

**File:** `ui/tsconfig.json:35-38`
```json
"exclude": [
  "node_modules",
  "**/__tests__/**",
  "**/*.test.ts",
  "**/*.test.tsx"
]
```

Tests can have type errors that go unnoticed until runtime. Combined with only 1 test file for 19 hooks, this is a low but real risk.

**Severity:** P3

---

### MF-9: Frontend reads plaintext values that SC-P0-1 targets for encryption (P0 — cross-domain)

**Cross-domain dependency with SC-P0-1:** If the smart contract migrates `totalPlainBorrow` and `liquidReserve` to encrypted `euint128` state, **the frontend will break**. The frontend likely reads these values for display. The agent didn't check whether the frontend reads these fields or verify the impact of the largest contract change on the UI.

**Severity:** P0 (will break frontend display of pool stats if/when SC-P0-1 is implemented)

---

## Cross-Cutting Dependencies

### Frontend ↔ Smart Contracts

| Dep | Direction | Impact |
|-----|-----------|--------|
| SC-P0-1 (encrypted state) → Frontend | Frontend reads `totalPlainBorrow`/`liquidReserve` — will break when migrated | P0 — must fix in lockstep |
| SC-P1-1 (reveal functions) → Frontend | Frontend needs UI for requesting decryption permits | P1 — new feature needed |
| SC-P2-2 (interest accrual) → Frontend | Pool APY/earnings display depends on index being updated | P2 — display will show wrong values |
| SC-P2-3 (getEncryptedTvl fails) → Frontend | Strategy TVL display returns "Forbidden" | P2 — broken portfolio |

### Frontend ↔ Infrastructure / DevOps

| Dep | Direction | Impact |
|-----|-----------|--------|
| INFRA-P0-4 (wrong Wave17 addresses) → Frontend | Frontend talks to wrong/nonexistent contracts | P0 — app non-functional |
| INFRA-P0-6 (token address chaos) → Frontend | Token operations use wrong addresses | P0 — wrong token flows |
| INFRA-P0-10 (no Sentry) → Frontend | Frontend has zero error tracking | P3 — no visibility |
| INFRA-P2-1 (no /metrics) → Frontend | Can't monitor frontend performance nor API errors | P2 — no observability |

### Frontend ↔ Backend / API

| Dep | Direction | Impact |
|-----|-----------|--------|
| BE-P0-1 (auth not applied) → Frontend | Frontend doesn't send auth tokens; 39 unprotected endpoints | P0 — no user-specific data, any "my" features broken |
| BE-P0-3 (missing GET /defi-strategies/:id) → Frontend | Strategy detail page cannot fetch by ID | P1 — page shows stale/empty data |
| BE-P0-4 (missing GET endpoints) → Frontend | Token list/asset browse broken | P2 — missing data |

---

## Execution Order Recommendation

Within the frontend domain, the order should be driven by **user-facing impact** and **cross-domain dependencies**:

### Phase 1: Crash fixes & contract connectivity (depends on INFRA addresses)

These are blocked until INFRA-P0-4/5/6 (correct contract addresses) are resolved. Without correct addresses, nothing works.

| Order | ID | Finding | Why here |
|-------|-----|---------|----------|
| 1 | MF-9 | Plan for SC-P0-1 encrypted state migration | Must coordinate frontend and contract changes |
| 2 | FE-P0-1 | ConfigPanel re-render loop | True runtime bug (worst case) |

### Phase 2: Visual correctness & data display

| Order | ID | Finding | Why here |
|-------|-----|---------|----------|
| 3 | FE-P0-2 | ProtocolIcon hardcoded WETH | Every DeFi node shows wrong icon |
| 4 | MF-1 | chainIcons base-sepolia → arbitrum | Same misleading icon problem |
| 5 | FE-P0-4 | StrategyPromptDetails stub | Differentiator feature for submission |
| 6 | MF-3 | API error boundary | Prevents silent failures |

### Phase 3: Code quality & dead code removal

| Order | ID | Finding | Why here |
|-------|-----|---------|----------|
| 7 | FE-P0-5 | useRebalance dead code (delete it) | Remove dead weight, no risk |
| 8 | FE-P0-3 | Duplicate SWAP case | Minor cleanup, no user impact |
| 9 | FE-P2-1 | Missing Base Sepolia env vars | Secondary chain config |
| 10 | MF-5 | Token address assertions | Safety net for misconfiguration |

### Phase 4: Feature additions (wire things up)

| Order | ID | Finding | Why here |
|-------|-----|---------|----------|
| 11 | FE-P2-2 | Wire useRebalance into strategy page | New feature, needs stable contracts |
| 12 | MF-2 | iconMap incomplete (DOT tokens) | Nice-to-have asset coverage |

### Phase 5: Polish & future-proofing

| Order | ID | Finding | Why here |
|-------|-----|---------|----------|
| 13 | MF-6 | Document ZK verifier workaround | Documentation, no code change |
| 14 | MF-4 | validateEnvVars should throw | Build-time safety |
| 15 | MF-7 | Add Sentry to frontend | Error monitoring |
| 16 | MF-8 | Fix tsconfig test exclusion | Testing infra |

---

## Summary of Severity Changes

| ID | Original | Corrected | Delta | Rationale |
|----|----------|-----------|-------|-----------|
| FE-P0-1 | P0 | P1 (P0 defensible) | ↓ | Ref guard prevents true infinite loop |
| FE-P0-2 | P0 | P0 | — | Confirmed — every node shows wrong icon |
| FE-P0-3 | P0 | **P2** | ↓↓ | Dead code, not crash/data-loss |
| FE-P0-4 | P0 | **P1** | ↓ | Missing feature, graceful degradation |
| FE-P0-5 | P0 | **P1** | ↓ | Unused code, no runtime impact |
| FE-P2-1 | P2 | P2 | — | Correct |
| FE-P2-2 | P2 | P2 | — | Correct |
| MF-1 | — | P1 | + | Missed: misleading chain icon |
| MF-2 | — | P2 | + | Missed: incomplete icon map |
| MF-3 | — | P2 | + | Missed: no API error handling |
| MF-4 | — | P2 | + | Missed: silent config failure |
| MF-5 | — | P2 | + | Missed: non-null assertions mask missing config |
| MF-6 | — | P2 | + | Missed: undocumented security workaround |
| MF-7 | — | P3 | + | Missed: no error monitoring |
| MF-8 | — | P3 | + | Missed: tests excluded from type-checking |
| MF-9 | — | P0 | + | Missed: cross-domain SC-P0-1 impact on frontend |

**Final count:** 5 original P0 findings → 1 remains P0, 2 demoted to P1, 1 demoted to P2, plus 1 new P0 cross-domain finding.

---

## Conclusion

The agent-2-frontend.md report is **thorough and accurate on the findings it identifies**. The code-level remediations are well-specified with before/after code blocks. However:

1. **Severity inflation:** 3 of 5 "P0" findings are over-severity. The ConfigPanel bug (P0→P1), SWAP dedup (P0→P2), and StrategyPromptDetails stub (P0→P1) and useRebalance dead code (P0→P1) are not deployment-blocking issues. The real P0 bugs are the ProtocolIcon misrender (correctly P0) and the cross-domain dependency on SC-P0-1 (missed entirely).

2. **The agent missed 9 findings** ranging from P0 (cross-domain encryption impact) to P3 (tsconfig test exclusion).

3. **Execution blocking:** Nearly all frontend fixes depend on INFRA-P0-4/5/6 (correct contract addresses). The frontend domain cannot be effectively fixed until the address chaos is resolved. The audit should have flagged this ordering dependency more explicitly.

4. **The agent found 0 new test file additions for the frontend** — but this is consistent with Wave 1 scope (test coverage deferred to Wave 2). The single existing spec file (`use-lending-actions.spec.ts`) is well-structured but inadequate coverage for 26.6K LOC and 19 hooks.
