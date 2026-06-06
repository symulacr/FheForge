# Phase 6: Integration Re-architecture — Injector Between Layers

> **Status**: Planning only — no execution, no edits.
> This document defines the mission plan for rewiring the forge frontend integration from screen wrappers to an injector-between-layers communication pattern.

---

## 1. Problem Statement

Phase 5 built the forge frontend integration using **screen wrappers** — HOCs that intercept `window.*` component registration, wrap each screen with `key={dataVersion}` to force React re-mounts when bridge data arrives. This approach has 7 concrete issues:

### Issue 1: Screen wrappers depend on fragile timing
The `screen-override.js` polls `window.*` for component registration (every 50ms, up to 20s). If a screen registers after the poll expires, it's never wrapped. The Babel plugin already rewrites `window.X = X` assignments — it could inject the wrapper at that point instead of polling later.

### Issue 2: key={dataVersion} causes React state loss
Every data update unmounts and remounts all screens. This loses:
- Scroll position in the dashboard master-detail list
- Selected position/strategy/proposal in the detail pane
- Input values in the lending form (amount, asset selection)
- Builder workspace canvas state (node positions, connections)
- ConnectModal progress (which step the user was on)

### Issue 3: Wallet connect flow never fires
The `wrappedSetCtx` in `screen-override.js` has a `!prevCtx.connected` guard. When the tweaks panel sets `startConnected: true` (which is default in dev mode), this guard evaluates to `false` and `performRealConnectFlow()` is silently skipped. Even without this guard, the flow calls `setStep(2)` before wallet connection resolves, advancing the UI to the permit screen while the user still hasn't connected their wallet.

### Issue 4: Mock values persist because data fetching never starts
`DataFetcher.startAll()` only fires inside `Lifecycle.start()`, which only fires when `bridge.wallet.isConnected()` transitions to `true`. For an unconnected user (or a user without MetaMask):
- No polling ever starts
- `triggerScreenData()` calls `fetchNow()` which returns silently (no fetchers registered)
- `__MOCK__` values remain `undefined`
- Babel's `??` fallback preserves hardcoded values indefinitely

**However**: Backend investigation confirms that `/health`, `/stats`, and `/markets` are **public** endpoints (no JWT required). These can (and should) fetch data for unconnected users.

### Issue 5: CORS blocks all API requests from localhost:3100
The backend `main.ts` allows `['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173']`. Serving from `localhost:3100` causes every API request to fail with a CORS error before it reaches the NestJS API.

### Issue 6: 4.47 MB monolithic bridge bundle
`bun build ./src/index.js --outdir=dist` bundles ALL deps (viem, wagmi, cofhe, axios) inline — 4.47 MB, 1146 modules. An `--external` build reduces this to **172 KB** (96% reduction) by loading deps from the esm.sh CDN importmap.

### Issue 7: Importmap is incomplete
Missing entries: `viem/chains`, `@wagmi/connectors`, `@cofhe/sdk/permits`. These are bare-imported by the bridge source and will cause runtime import failures.

---

## 2. Proposed Architecture: Injector Between Layers

Replace screen wrappers with a **BridgeBus** event emitter + **BridgeProvider** React Context injected via the Babel plugin.

```
┌──────────────────────────────────────────────────────────┐
│  Bridge Adapters (wallet, api, contract, fhe)            │
│  createBridge(config) → { wallet, api, contract, fhe }  │
└────────────────────────┬─────────────────────────────────┘
                         │ feeds data to
                         ▼
┌──────────────────────────────────────────────────────────┐
│  BridgeBus (central event bus + reactive state)          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  stateTree = {                                     │  │
│  │    public: { ticker, markets, activities },         │  │
│  │    authed: { positions, strategies, proposals, .. },│  │
│  │    wallet: { connected, address, chainId },         │  │
│  │    permit: { unlocked, secondsLeft }                │  │
│  │  }                                                  │  │
│  │  Events: 'data:markets', 'wallet:connected',        │  │
│  │          'permit:granted', 'error:*'                │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │ provides state via Context
                         ▼
┌──────────────────────────────────────────────────────────┐
│  ForgeProvider (React Context — injected by Babel plugin)│
│  Wraps <App /> in ReactDOM.createRoot:                   │
│    <ForgeProvider>                                        │
│      <App />                                              │
│    </ForgeProvider>                                       │
│  Provides: useBridgeContext() → { wallet, data, permit } │
└────────────────────────┬─────────────────────────────────┘
                         │ screens consume via hooks
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Forge Components (IMMUTABLE — same as today)            │
│  • ctx prop still passed in (legacy)                     │
│  • Screens can ALSO read from BridgeContext for real data│
│  • No wrappers, no key={dataVersion}, no re-mount        │
│  • Each component gets what it needs via context         │
└──────────────────────────────────────────────────────────┘
```

### 2.1 BridgeBus Spec

Central event bus with reactive state. Pure JS, zero dependencies.

```javascript
// Singleton. Initialized by bridge-init.js after createBridge().
window.__bridgeBus = {
  // State tree — reactive, subscribable
  state: {
    public: { ticker: [], markets: [], activities: [] },
    authed: { positions: [], strategies: [], proposals: [], nodeTypes: [], walletBalance: "0" },
    wallet: { connected: false, address: "", chainId: 0 },
    permit: { unlocked: false, secondsLeft: 0 },
    meta: { dataVersion: 0, errors: {} }
  },

  // Subscribe to state changes
  //   .on('data:markets', (markets) => ...)
  //   .on('wallet:connected', ({ address }) => ...)
  // Returns unsubscribe function
  on(event, callback),

  // Update state (partial merge) + emit event
  //   .set('data:markets', marketsData)
  //   .set('wallet:connected', { connected: true, address: '0x...' })
  set(event, data),

  // Get current state snapshot
  getState(),

  // Reset (on disconnect)
  reset(),
};
```

Events emitted:
| Event | Payload | Trigger |
|-------|---------|---------|
| `data:ticker` | string[9] | Stats poll (30s) |
| `data:markets` | Market[] | Markets poll (30s) |
| `data:activities` | Activity[] | Activities poll (15s) |
| `data:positions` | Position[] | On connect + nav |
| `data:strategies` | Strategy[] | On nav |
| `data:proposals` | Proposal[] | On nav |
| `data:nodeTypes` | NodeType[] | On nav |
| `wallet:connected` | `{ address }` | On wallet connect |
| `wallet:disconnected` | `{}` | On wallet disconnect |
| `wallet:networkChanged` | `{ chainId }` | On chain switch |
| `permit:granted` | `{ secondsLeft }` | On permit grant |
| `permit:expired` | `{}` | On permit expiry |
| `permit:tick` | `{ secondsLeft }` | Every second during countdown |
| `error:*` | `{ source, message }` | On any fetch failure |

### 2.2 ForgeProvider Spec

React Context provider injected by the Babel plugin at the app root:

```jsx
// Injected by Babel plugin into app.jsx's ReactDOM.createRoot:
import { ForgeProvider, BridgeContext } from "../packages/forge-bridge-integration/src/bridge-context.js";

ReactDOM.createRoot(document.getElementById("root")).render(
  <ForgeProvider>
    <App />
  </ForgeProvider>
);
```

Context shape:
```javascript
const BridgeContext = React.createContext({
  // Wallet state
  connected: false,
  address: "",
  chainId: 421614,

  // Permit state  
  permitUnlocked: false,
  permitSeconds: 0,

  // Data — reactive, updated by BridgeBus
  ticker: [],          // TICKER_ITEMS
  markets: [],          // L_MARKETS
  activities: [],       // D_ACTIVITY
  positions: [],        // D_POSITIONS
  strategies: [],       // D_STRATS
  proposals: [],        // PROPOSALS
  community: [],        // COMMUNITY
  nodeTypes: {},        // NODE_TYPES
  walletBalance: "0",   // WALLET_BALANCE
  portfolioNetValue: "0",
  portfolioLTV: "0",
});
```

Hooks:
```javascript
// Main hook — get everything
const bridge = useBridge();

// Specific hooks — get what you need
const wallet = useWallet();        // { connected, address, chainId }
const permit = usePermit();        // { unlocked, secondsLeft }
const data = useBridgeData();       // All data arrays
```

### 2.3 DataFetcherV2 Spec

Two modes, independent lifetime:

```javascript
// Public mode — starts on page load, never stops
DataFetcherV2.startPublic({
  ticker:  { poll: 30,   fn: fetchTicker },    // bridge.api.stats.getStats()
  markets: { poll: 30,   fn: fetchMarkets },   // bridge.api.markets.getMarkets()
});

// Authenticated mode — starts on wallet connect, stops on disconnect
DataFetcherV2.startAuthed({
  positions:  { poll: 60,   fn: fetchPositions },  // bridge.contract.read
  strategies: { poll: null, fn: fetchStrategies },  // on-nav
  activities: { poll: 15,   fn: fetchActivities },  // bridge.api.activities
  proposals:  { poll: null, fn: fetchProposals },   // on-nav
  nodeTypes:  { poll: null, fn: fetchNodeTypes },   // on-nav
});
```

### 2.4 Babel Plugin v2 Spec

Enhanced version of the Phase 5 Babel plugin with THREE responsibilities:

**1. Mock data interception (carried over from Phase 5)**
Same as v1: `const D_POSITIONS = [...]` → `var D_POSITIONS = window.__MOCK__?.D_POSITIONS ?? [...]`

**2. React Context provider injection (NEW)**
At the `ReactDOM.createRoot` call in `app.jsx`, wrap `<App />` in `<ForgeProvider>`. This requires the Babel plugin to detect the `ReactDOM.createRoot(...).render(<App />)` pattern and inject the provider wrapper.

**3. Screen wrapper → BridgeContext bridge (NEW)**
Instead of wrapping `window.Landing` with a key={dataVersion} HOC, inject context consumption logic:
```javascript
// Before (Phase 5):
window.Landing = BridgeScreenWrapper(Landing);

// After (Phase 6):
window.Landing = Landing;  // unchanged — no wrapper needed
// The ForgeProvider at root provides real data via context
// Screens read from BridgeContext instead of __MOCK__
```

### 2.5 ConnectInterceptor Spec

ConnectModal doesn't need wrapping either. The injection is at the app.jsx level:

```javascript
// Instead of wrapping ConnectModal in BridgeConnectModal:
// The ForgeProvider provides a connect() function that does:
//   1. bridge.wallet.connect(connectorId)
//   2. bridge.wallet.login() → JWT
//   3. ctx updates via setCtx
//   4. bridge.fhe.permitGrant()
// 
// The Babel plugin replaces the grantPermit callback in app.jsx
// with a bridge-aware version that calls real adapters.
```

### 2.6 Importmap + Build v2

```json
{
  "imports": {
    "viem/": "https://esm.sh/viem@2.48/",
    "@wagmi/core": "https://esm.sh/@wagmi/core@2.22",
    "@wagmi/connectors": "https://esm.sh/@wagmi/connectors@5",
    "@cofhe/sdk/": "https://esm.sh/@cofhe/sdk@0.5/",
    "axios": "https://esm.sh/axios@1.7",
    "@fheforge/bridge/core": "../packages/forge-bridge/dist/index.js"
  }
}
```

Trailing-slash patterns (`viem/`, `@cofhe/sdk/`) automatically handle sub-path imports like `viem/chains` and `@cofhe/sdk/permits`.

Build command:
```bash
bun build ./src/index.js --outdir=dist \
  --external "viem" \
  --external "@wagmi/core" \
  --external "@wagmi/connectors" \
  --external "axios" \
  --external "@cofhe/sdk"
```
Result: ~172 KB (96% reduction from 4.47 MB).

---

## 3. Data Flow Scenarios

### 3.1 Page Load (Unconnected User)

```
1. Page loads, importmap resolves CDN packages
2. bridge-init.js loads (deferred module):
   → fetch 172 KB bridge bundle (not 4.47 MB!)
   → createBridge() → window.bridge = { wallet, api, contract, fhe }
3. babel-transform-plugin.js runs:
   → patches Babel.transform
   → initializes window.__MOCK__ = TEMPLATES, DEFAULT_CONFIG only
4. babel-plugin-v2 injects ForgeProvider at ReactDOM.createRoot
5. Forge screen files load (text/babel, processed by patched Babel):
   → const D_POSITIONS → var D_POSITIONS = window.__MOCK__?.D_POSITIONS ?? [...]
6. app.jsx loads:
   → ForgeProvider wraps <App />
   → App renders with ctx.connected=false (no mock data overwrites)
7. Public data polling starts automatically (no wallet needed):
   → GET /stats → formatTicker() → BridgeBus.set('data:ticker', [...])
   → GET /markets → transformMarkets() → BridgeBus.set('data:markets', [...])
8. ForgeProvider re-renders with real ticker + markets data
   → Ticker shows real block numbers, gas prices, pool TVLs
   → Lending shows real market APYs, TVLs
   → No React re-mount needed — just normal context re-render
```

### 3.2 Wallet Connect Flow

```
1. User clicks "Connect" → ConnectModal opens
2. User selects wallet (e.g., MetaMask)
3. Step 0→1: ConnectInterceptor detects step transition:
   → bridge.wallet.connect('metamask') → MetaMask prompts
   → User approves in extension
   → bridge.wallet.login() → nonce→sign→POST JWT
   → ctx.connected = true, ctx.address = real address
   → BridgeBus.set('wallet:connected', { address })
4. Step 1→2: Sign message (real nonce from backend)
   → bridge.api.auth.getNonce(addr) → wallet signs → POST login
   → JWT stored in localStorage
5. Step 2→3: Permit grant
   → bridge.fhe.permitGrant() → CoFHE SDK
   → ctx.permitUnlocked = true, ctx.permitSeconds = 900
   → BridgeBus.set('permit:granted', { secondsLeft: 900 })
6. BridgeBus triggers authed data fetching:
   → GET /defi-strategies → D_STRATS populated
   → GET /activities → D_ACTIVITY populated
   → contract.read positions → D_POSITIONS populated
   → ForgeProvider re-renders with real position/strategy/activity data
7. No screen re-mount — screens just re-render via context
   → Scroll position, selected items, form inputs preserved
```

### 3.3 Data Update Cycle (with Error Handling)

```
1. Polling interval fires (e.g., markets every 30s)
2. DataFetcherV2 calls bridge.api.markets.getMarkets()
3. On success:
   → transformers.transformMarkets(data) → [Market, ...]
   → BridgeBus.set('data:markets', markets)
   → ForgeProvider re-renders Lending screen with new APY/TVL
4. On error (network failure, CORS, 5xx):
   → BridgeBus.set('error:markets', { source: 'api', message: '...' })
   → Stale data preserved in state tree
   → Optional: inline warning badge shown via BridgeContext.errors
   → Next poll interval retries automatically
```

---

## 4. Migration Path

Phase 6 is implemented in 5 sub-phases. Each sub-phase is independently testable and leaves the product in a working state.

### Sub-phase 1: Foundation — BridgeBus + Build v2
- Create `bridge-bus.js` — event emitter + reactive state
- Update build to `--external` (172 KB)
- Fix importmap (add missing entries, trailing-slash patterns)
- No behavioral changes — existing code still uses screen wrappers

### Sub-phase 2: DataFetcherV2 — Public Data on Page Load
- Create `DataFetcherV2` with separate public/authed modes
- Start public polling (ticker, markets) unconditionally on page load
- BridgeBus receives data → __MOCK__ updated
- Unconnected users see real ticker and market data
- Existing wrappers still handle re-mount

### Sub-phase 3: Babel Plugin v2 — Context Injection
- Create `bridge-context.js` — ForgeProvider, BridgeContext, hooks
- Update Babel plugin to detect `ReactDOM.createRoot(...).render(<App />)`
- Inject `<ForgeProvider><App /></ForgeProvider>`
- ForgeProvider subscribes to BridgeBus → re-renders on data changes
- **Migration point**: Disable screen wrappers for one screen at a time, verify context works

### Sub-phase 4: ConnectInterceptor — Direct Wallet Flow
- Replace BridgeConnectModal with ConnectInterceptor
- Inject at app.jsx level (replace grantPermit callback)
- Remove BridgeConnectModal wrapper from screen-override.js
- Fix `!prevCtx.connected` guard issue

### Sub-phase 5: Cleanup — Remove Screen Wrappers
- Remove screen-override.js entirely (or keep only BridgeBus subscriber)
- Verify no key={dataVersion} pattern remains
- Verify all screens work without wrappers
- Final: git diff -- ui/ = 0

---

## 5. Backend CORS Fix

Add `'http://localhost:3100'` to `DEV_ORIGINS` in `backend/apps/src/main.ts`:

```typescript
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3100',  // Added for forge integration
  'http://localhost:5173',
];
```

No other backend changes needed — CORS is the only integration blocker.

---

## 6. Features Breakdown (36 features across 5 sub-phases)

### Sub-phase 1: Foundation (8 features)

| # | Feature | Effort |
|---|---------|--------|
| 1.1 | Create BridgeBus — event emitter + reactive state | M |
| 1.2 | BridgeBus.subscribe() — scoped subscriptions | S |
| 1.3 | BridgeBus.set() — partial state merge + event emit | S |
| 1.4 | Update build to `--external` (package.json) | S |
| 1.5 | Add missing importmap entries (viem/chains, connectors, cofhe/permits) | S |
| 1.6 | Rebuild dist/index.js with --external | S |
| 1.7 | Verify BridgeBus works in browser (console test) | S |
| 1.8 | Add backend CORS origin (localhost:3100) | XS |

### Sub-phase 2: Public Data on Page Load (8 features)

| # | Feature | Effort |
|---|---------|--------|
| 2.1 | Create DataFetcherV2 with public/auth mode split | M |
| 2.2 | Wire ticker polling (30s) to BridgeBus | S |
| 2.3 | Wire markets polling (30s) to BridgeBus | S |
| 2.4 | Wire activity polling (15s) to BridgeBus | S |
| 2.5 | Create authed data fetchers (positions, strategies, governance) | M |
| 2.6 | Wire on-nav triggers for authed data | S |
| 2.7 | Handle errors: stale data preservation + warning | S |
| 2.8 | Unit tests for DataFetcherV2 | M |

### Sub-phase 3: BridgeContext + Babel Plugin v2 (8 features)

| # | Feature | Effort |
|---|---------|--------|
| 3.1 | Create ForgeProvider + BridgeContext | M |
| 3.2 | Create hooks: useBridge, useWallet, usePermit, useBridgeData | M |
| 3.3 | Update Babel plugin with ReactDOM.createRoot detector | M |
| 3.4 | Inject ForgeProvider wrapper at app root via Babel plugin | M |
| 3.5 | Wire BridgeBus → ForgeProvider (context updates on events) | S |
| 3.6 | Verify context re-render on data changes (no re-mount) | S |
| 3.7 | Unit tests for ForgeProvider + hooks | M |
| 3.8 | Integration test: page load → ticker updates via context | M |

### Sub-phase 4: ConnectInterceptor (6 features)

| # | Feature | Effort |
|---|---------|--------|
| 4.1 | Create ConnectInterceptor — replaces BridgeConnectModal | M |
| 4.2 | Wire wallet.connect via ConnectInterceptor | M |
| 4.3 | Wire JWT login flow via ConnectInterceptor | M |
| 4.4 | Wire permit grant via ConnectInterceptor | M |
| 4.5 | Handle: network mismatch, failure recovery, rapid cycles | M |
| 4.6 | Remove BridgeConnectModal wrapper from screen-override | S |

### Sub-phase 5: Cleanup + Verification (6 features)

| # | Feature | Effort |
|---|---------|--------|
| 5.1 | Remove screen wrappers for Landing + Dashboard | S |
| 5.2 | Remove screen wrappers for Lending + Market | S |
| 5.3 | Remove screen wrappers for Governance + BuilderWorkspace | S |
| 5.4 | Remove ConnectModal wrapper | S |
| 5.5 | Delete or slim screen-override.js (keep only BridgeBus subscriber) | S |
| 5.6 | Full regression: 385 tests pass, forge immutability, all screens work | M |

---

## 7. Open Questions

### Q1: How does BridgeBus discover the bridge instance?
**Options**: (a) Poll `window.bridge` like getBridgeApi() does, (b) BridgeBus is initialized by bridge-init.js after createBridge(), (c) BridgeBus and bridge are created together in a new init script.
**Recommendation**: (c) — create a `bridge-init-v2.js` that creates both bridge and BridgeBus together, assigns both to window.

### Q2: Should Babel plugin v2 be a separate file or modify the existing one?
**Recommendation**: Add the new visitors to the existing `babel-transform-plugin.js` (file is already loaded and patching Babel.transform). The new `Program.exit` visitor detects `ReactDOM.createRoot` patterns. This keeps the loading order unchanged.

### Q3: How do screens access real data without re-mount?
**Recommendation**: Screens don't need to change. The ForgeProvider at root updates `window.__MOCK__` on data changes (same as before). Screens still read from `window.__MOCK__` via the Babel plugin's `??` fallback. The difference is: instead of key={dataVersion} forcing re-mount, the ForgeProvider's context update triggers a React re-render of only the components that consume the changed context values. The Babel plugin ensures constants re-read on render evaluation.

### Q4: What about BuilderWorkspace's sim/deploy overrides?
**Recommendation**: These are currently set via `window.__bridgeSimulate` / `window.__bridgeDeploy` by the wrapper on mount. With wrappers removed, the ForgeProvider's effect can set these on mount and clear on unmount. No behavioral change needed.

### Q5: Structural data (TEMPLATES, DEFAULT_CONFIG) protection?
**Recommendation**: Already handled in Phase 5 — StateManager.clearmMockData() skips TEMPLATES and DEFAULT_CONFIG. BridgeBus should inherit this same protection.

---

## 8. Validation Strategy

### Unit Tests
- BridgeBus: event emit, subscribe/unsubscribe, state merge, scoped events
- ForgeProvider: context provides correct values, re-renders on BridgeBus events
- Babel Plugin v2: detects ReactDOM.createRoot, injects provider wrapper, still handles mock constants
- ConnectInterceptor: wallet.connect called, JWT flow, permit grant, error handling
- DataFetcherV2: public polls start immediately, authed polls wait for connect

### Integration Tests
- Page load (unconnected): ticker shows real stats, markets show real APYs
- Wallet connect: full flow with real adapters, ctx updated correctly
- Data update: bridge data appears without screen re-mount
- Error handling: network failure shows stale data + warning badge
- Disconnect/reconnect: poll stop/start cleanly

### Regression Assertions (carried from Phase 5)
- VAL-INTEGRATION-CROSS-001: Forge immutability (git diff -- ui/ = 0)
- VAL-INTEGRATION-CROSS-004: 385 tests pass
- VAL-INTEGRATION-CROSS-005: Build succeeds
- VAL-INTEGRATION-CROSS-008: Loading state shows mock data
- VAL-INTEGRATION-CROSS-009: Error state preserves mock data
- VAL-INTEGRATION-CROSS-011: Reconnection cycle
- VAL-INTEGRATION-CROSS-015: Rapid connect/disconnect cycles

### New Phase 6 Assertions
- VAL-INTEGRATION-V2-001: Screen wrappers removed — no key={dataVersion} in codebase
- VAL-INTEGRATION-V2-002: BridgeBus initialized on page load
- VAL-INTEGRATION-V2-003: Public data fetches without wallet (ticker, markets)
- VAL-INTEGRATION-V2-004: Browser state preserved across data updates (scroll, selection, input)
- VAL-INTEGRATION-V2-005: Bridge bundle ≤ 250 KB (--external build verified)
- VAL-INTEGRATION-V2-006: CORS fix — API requests succeed from localhost:3100
- VAL-INTEGRATION-V2-007: Wallet connect fires without !prevCtx.connected guard race

---

## 9. Summary

| Aspect | Phase 5 (current) | Phase 6 (proposed) |
|--------|-------------------|-------------------|
| Integration pattern | Screen wrappers + key={dataVersion} | BridgeBus + ForgeProvider (Context) |
| Data trigger | Re-mount via key change | Context re-render |
| Public data | Never fetched without wallet | Fetched on page load |
| Bridge bundle | 4.47 MB (all deps inlined) | 172 KB (external deps via CDN) |
| Importmap | Incomplete (missing 3 entries) | Complete with trailing-slash patterns |
| CORS | Broken for localhost:3100 | Fixed with backend origin addition |
| Wallet connect | Wrapper guards block the flow | Direct injection at app.jsx level |
| State preservation | Lost on every data update | Preserved across context updates |
| Forge files modified | 0 (immutability preserved) | 0 (same constraint) |

---

*This document was created during the planning phase of the FheForge integration re-architecture. No code changes have been made.*
