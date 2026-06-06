# Phase 6: Integration Re-architecture -- Injector Between Layers

## 1. Problem Statement

Phase 5 delivered a working bridge integration using three mechanisms: (a) a Babel plugin that rewrites `const X = val` to `var X = window.__MOCK__?.X ?? val`, (b) screen wrappers that intercept `window.*` component registrations and wrap them with `key={dataVersion}` re-mount logic, and (c) an integration adapter that polls bridge adapters and writes results into `window.__MOCK__`. The architecture proved fragile in five concrete ways:

### 1.1 Screen Wrapper Timing Dependency

The `screen-override.js` polling loop (`setInterval(wrapScreens, 100)`) runs a race: forge screens register themselves on `window.*` asynchronously (Babel transforms `text/babel` scripts), and the wrapper must capture each registration after the component exists but before React uses it. The polling has no backpressure -- it can miss a registration if the interval fires between `window.Screen = Component` and `ReactDOM.createRoot`. Screens that register late (e.g., because Babel transform is queued) cause `bridge-screen-override.js` to wrap `undefined`, requiring manual re-trigger via `window.__wrapScreens()`.

### 1.2 key={dataVersion} State Loss

Forcing React to re-mount via `key={dataVersion}` destroys all component-local state: scroll position in master-detail lists, selected tab indices, open accordions, input focus and cursor position. On every 30-second ticker poll, every visible screen unmounts and remounts. Users lose their place in the dashboard activity list, lending market sort order, and governance proposal selection. This is unacceptable for production UX.

### 1.3 Wallet Connect Blocked by startConnected Guard

The `wrappedSetCtx` in the ConnectModal wrapper has a `!prevCtx.connected` guard that is intended to detect the mock-connected transition (`connected` goes from `false` to `true` with the mock address). However, when `startConnected=true` (the tweaks panel default), the guard evaluates `true` immediately on mount, attempting `performRealConnectFlow()` before the user has clicked anything. A `connectInProgressRef` prevents duplicate attempts, but the first attempt runs prematurely, creating a race where the wallet popup appears before the user expects it, and if dismissed, the `connected=false` fallback disables the entire connect flow.

### 1.4 Mock Values Never Replaced for Unconnected Users

`DataFetcher.startAll()` only fires inside `Lifecycle.start()`, which only fires when `bridge.wallet.isConnected()` returns `true`. This means public data (ticker, markets, community strategies) is never fetched for unconnected users -- they always see hardcoded mock values. Three independent issues compound this:

- **(a) Wallet-gated fetching**: The `initLifecycle()` polling loop watches `bridge.wallet.isConnected()` and only starts fetchers when a wallet is connected. Public data endpoints (stats, markets) are treated identically to authenticated ones.
- **(b) CORS**: The bridge API base URL defaults to a production Railway URL. The local dev server (`localhost:3100`) is not in the backend allowed origins list, so all API calls from local dev fail with CORS errors regardless of connection state.
- **(c) Unregistered fetchers**: `triggerScreenData()` in the screen wrapper calls `df.fetchNow(dataSources[i])`, but `fetchNow` calls `_fetchOne(name)`, which silently no-ops if the fetcher name has not been registered. Registration happens inside `registerDefaultFetchers()` which is called by `Lifecycle.start()` -- the very function that never fires for unconnected users.

### 1.5 4.47 MB Bridge Bundle

The `bun build ./src/index.js --outdir=dist` command bundles ALL dependencies (viem, wagmi, @cofhe/sdk, axios) inline into a single `dist/index.js`. This produces a 4.47 MB file that must be loaded, parsed, and executed before any bridge adapter code runs. The intended design was to `--external` all deps and load them via importmap CDN entries, reducing the bridge bundle to approximately 175 KB (mainly ABI arrays and wiring code). However, the `package.json` build script omits `--external`, and the required `viem/chains` and `@wagmi/connectors` importmap entries are absent.

### 1.6 Importmap Incomplete

The HTML `<script type="importmap">` block maps `@fheforge/bridge` and `viem` but is missing entries for:
- `viem/chains` (used by `wallet.js` to import `arbitrumSepolia`)
- `@wagmi/connectors` (used by `wallet.js` to import `walletConnect`)
- `@wagmi/core` (used throughout `wallet.js`)

Without these, the ESM import in `bridge-init.js` fails with module-not-found errors, and the 2-second retry timeout in `getBridgeApi()` expires, causing the integration layer to believe the bridge is not available.

### 1.7 getBridgeApi() 2s Timeout Race

`getBridgeApi()` in `integration-adapter.js` polls for `window.bridge` on a 100ms interval with a 20-retry (2 second) cap. If the bridge adapter has not loaded within that window -- which is common because `bridge-init.js` is a deferred ESM module that must load, parse, and execute the 4.47 MB bundle -- the promise rejects with `Error('Bridge adapter not loaded')`. The fetchers initialized by `Lifecycle.start()` fail silently at registration time because each calls `getBridgeApi()` which rejects, and the `_fetchOne` error handler only logs, never retries.

---

## 2. Proposed Architecture: Injector Between Layers

The core insight: screen wrappers with `key={dataVersion}` re-mount is the wrong mechanism. Instead of wrapping entire forge components, we inject a lightweight bridge-aware React Context at the app root and replace the Babel plugin's mock-data strategy with a runtime provider pattern.

### 2.1 Layer Diagram

```
+-------------------------------------------------------------------+
|  Bridge Adapters (IMMUTABLE -- same as Phase 5)                   |
|  +----------+ +----------+ +--------------+ +----------+          |
|  | wallet   | | api      | | contract     | | fhe      |          |
|  | (wagmi)  | | (axios)  | | (viem)       | |(@cofhe)  |          |
|  +----+-----+ +----+-----+ +------+-------+ +----+-----+          |
|       |            |              |              |                |
+-------+------------+--------------+--------------+----------------+
        |            |              |              |
        v            v              v              v
+-------------------------------------------------------------------+
|  Bridge Bus (NEW) -- Event emitter + reactive state store          |
|  - Holds reactive state tree for all data domains                  |
|  - Emits granular events per domain (ticker, markets, positions)   |
|  - Manages public vs authenticated data lifecycle                  |
|  - No dependency on React or any framework                         |
|  Exposes: bus.on('markets', cb), bus.off(...), bus.getState()     |
|           bus.dispatch('markets', data), bus.subscribe(domain, cb) |
+---------------------+---------------------------------------------+
                      |
+-------------------------------------------------------------------+
|  Injector Layer (NEW -- replaces screen wrappers + Babel v1 plugin)|
|                                                                   |
|  a) Babel Plugin v2 (enhanced)                                    |
|     - Still replaces const mock decls with __MOCK__ lookups       |
|     - ADDITIONALLY: injects <BridgeProvider> into app.jsx         |
|     - ADDITIONALLY: injects data-fetching init code               |
|     - Drops JSXAttribute visitor (no longer needed)               |
|                                                                   |
|  b) BridgeProvider (React Context)                                |
|     - Subscribes to Bridge Bus                                    |
|     - Provides wallet, permit, data state via React Context        |
|     - No key={dataVersion} -- React re-renders naturally           |
|     - Public data polling starts immediately on mount              |
|     - Authenticated data polling starts on wallet connect          |
|                                                                   |
|  c) ConnectInterceptor                                            |
|     - Injected at app.jsx where openConnect callback is passed     |
|     - Replaces the callback with a bridge-aware version            |
|     - Direct function injection, no component wrapping            |
|                                                                   |
+---------------------+---------------------------------------------+
                      |
+-------------------------------------------------------------------+
|  Forge Components (IMMUTABLE -- same as today)                    |
|  - const D_POSITIONS = window.__MOCK__?.D_POSITIONS ?? [...]      |
|  - Reads from __MOCK__ which is updated by BridgeProvider          |
|  - No key={dataVersion} -- normal React reconciliation            |
|  - Cipher locked/unlocked flows through ctx (already correct)      |
+-------------------------------------------------------------------+
```

### 2.2 Key Architectural Differences from Phase 5

| Aspect | Phase 5 | Phase 6 |
|--------|---------|---------|
| Re-render mechanism | key={dataVersion} unmount/remount | React Context provides new values, natural re-render |
| State loss on data update | Full (scroll, selection, focus) | Zero (no re-mount) |
| Data fetching trigger | Wallet connection required | Public data: page load. Auth data: wallet connect |
| Bridge binding | window.bridge global, polled | Bridge Bus, event-driven |
| Connect modal integration | Component wrapper (BridgeConnectModal) | Callback injection at app.jsx |
| Babel plugin | 3 visitors (VarDecl, Identifier, JSXAttr) | 2 visitors + JSX injection |
| Bundle size | 4.47 MB (all deps inlined) | ~175 KB (externals via importmap) |
| Importmap entries | 2 (bridge + viem) | 6 (viem, viem/chains, @wagmi/core, @wagmi/connectors, @cofhe/sdk, bridge) |
| Loading order | Complex (bridge-babel > screen-override > screens > app > adapter) | Simplified (bridge-babel > screens > app + injector) |

---

## 3. Component Specs

### 3.1 BridgeBus (NEW)

A framework-agnostic event emitter and reactive state store that decouples data producers (bridge adapters) from data consumers (forge components).

**File**: `packages/forge-bridge-integration/src/bridge-bus.js`

**Interface**:

```javascript
class BridgeBus {
  // State
  getState(domain)             // Returns reactive state for a domain
  getStateSnapshot()           // Returns entire state tree snapshot

  // Dispatch (write)
  dispatch(domain, data)       // Update state for domain, emit event
  dispatchBatch(updates)       // Batch update multiple domains, emit once

  // Subscribe (read)
  subscribe(domain, callback)  // Subscribe to a specific domain
  subscribeAll(callback)       // Subscribe to all domains
  unsubscribe(domain, callback)
  unsubscribeAll(callback)

  // Lifecycle
  start()                      // Begin polling timers
  stop()                       // Stop all polling timers
  isRunning()                  // Returns boolean

  // Domain registration
  registerDomain(name, config) // Register a domain with polling config
}
```

**State Tree Shape**:

```javascript
{
  ticker: { data: [...], loading: false, error: null, lastUpdated: null },
  markets: { data: [...], loading: false, error: null, lastUpdated: null },
  positions: { data: [...], loading: false, error: null, lastUpdated: null },
  strategies: { data: [...], loading: false, error: null, lastUpdated: null },
  activity: { data: [...], loading: false, error: null, lastUpdated: null },
  community: { data: [...], loading: false, error: null, lastUpdated: null },
  proposals: { data: [...], loading: false, error: null, lastUpdated: null },
  nodeTypes: { data: {...}, loading: false, error: null, lastUpdated: null },
  walletBalance: { data: null, loading: false, error: null, lastUpdated: null },
  // Connection state
  connection: { connected: false, address: null, chainId: null, jwtStored: false },
  permit: { unlocked: false, secondsLeft: 0 },
}
```

**Domain Registration Config**:

```javascript
bus.registerDomain('ticker', {
  fetcher: () => bridge.api.stats.getStats().then(transformers.formatTicker),
  interval: 30000,          // 30-second polling
  authRequired: false,      // Public data -- fetch even without wallet
  transform: formatTicker,  // Optional: transform function applied to raw data
});

bus.registerDomain('positions', {
  fetcher: () => fetchPositions(bridge),
  interval: 60000,          // 60-second polling
  authRequired: true,       // Requires wallet connection
  transform: transformPositions,
});
```

**Implementation Notes**:

- Uses a simple Map for state, Set for subscribers
- `dispatch()` runs `Object.freeze()` on data payloads to prevent mutation by consumers
- `dispatchBatch()` coalesces multiple updates into a single notification cycle
- Polling uses `setInterval` + `clearInterval` on `start()/stop()`
- On fetch error: sets state `{ data: previousData, error: err, loading: false }` (stale data preserved)
- On start of authenticated domain when wallet not connected: schedules fetch but does not execute until wallet connects

### 3.2 BridgeProvider (NEW React Context)

A React Context provider and hooks that subscribe to BridgeBus and provide reactive bridge state to all forge components.

**File**: `packages/forge-bridge-integration/src/bridge-provider.js`

**Interface**:

```javascript
// Provider inserted into app.jsx by Babel Plugin v2
<BridgeProvider bridgeBus={bus}>
  <App />
</BridgeProvider>

// Consumer hooks
useBridge()             // Returns full bridge state
useDomain(domainName)   // Returns { data, loading, error, lastUpdated } for a domain
useWallet()             // Returns wallet state (connected, address, chainId)
usePermit()             // Returns permit state (unlocked, secondsLeft)
usePublicData()         // Returns all public domain data (ticker, markets, activity)

// Action hooks
useConnect()            // Returns { connect, disconnect } functions
useGrantPermit()        // Returns { grantPermit } function
```

**BridgeProvider Implementation**:

```javascript
function BridgeProvider({ bridgeBus, children }) {
  const [state, setState] = useState(() => bridgeBus.getStateSnapshot());

  useEffect(() => {
    // Subscribe to all domain changes
    const unsub = bridgeBus.subscribeAll((domain, data) => {
      setState(prev => ({ ...prev, [domain]: data }));
    });

    // Start public data polling immediately
    bridgeBus.start();

    return () => {
      unsub();
      bridgeBus.stop();
    };
  }, [bridgeBus]);

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    ...state,
    connect: bridgeBus.connect,
    disconnect: bridgeBus.disconnect,
    grantPermit: bridgeBus.grantPermit,
  }), [state]);

  return (
    <BridgeContext.Provider value={contextValue}>
      {children}
    </BridgeContext.Provider>
  );
}
```

**Key difference from Phase 5**: No `key={dataVersion}`. When `setState` is called with new data, React re-renders only the components that consume the changed context slices (via `useDomain` granular hooks). Master-detail scroll position, selected tab, and input focus are preserved.

### 3.3 Babel Plugin v2 (Enhanced)

Replaces the Phase 5 babel plugin. Three visitors plus a new injection pass.

**File**: `packages/forge-bridge-integration/src/babel-injector-plugin.js`

**Changes from v1**:

| Visitor | Phase 5 v1 | Phase 6 v2 |
|---------|-----------|------------|
| VariableDeclarator | const -> var + __MOCK__ lookup | Same (unchanged) |
| Identifier | References rewritten to __MOCK__ | Same (unchanged) |
| JSXAttribute | Cipher value literals rewritten | REMOVED. No longer needed |
| NEW: Program exit | -- | Inject BridgeProvider import + wrapper |
| NEW: ImportDeclaration | -- | Add React import if missing |

**Program Exit Injection**:

The critical new behavior: after all transformations, the plugin walks the AST of `app.jsx` and wraps the root export/rendered element with `<BridgeProvider>`.

```javascript
Program: {
  exit(path) {
    // Only inject for app.jsx (detected by filename or content pattern)
    if (!this.isAppFile(path)) return;

    const t = require('@babel/types');

    // Find the ReactDOM.createRoot(...).render(...) call
    // or the root export default function App() { ... }
    const rootRender = findRootRenderCall(path);

    if (rootRender) {
      // Wrap the rendered element:
      // <App />  ->  <BridgeProvider><App /></BridgeProvider>
      const appElement = rootRender.node.arguments[0];
      rootRender.node.arguments[0] = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier('BridgeProvider'), [], false),
        t.jsxClosingElement(t.jsxIdentifier('BridgeProvider')),
        [t.jsxText('\n'), appElement, t.jsxText('\n')],
        false
      );
    }

    // Add import for BridgeProvider at top of file
    const importDecl = t.importDeclaration(
      [t.importDefaultSpecifier(t.identifier('BridgeProvider'))],
      t.stringLiteral('./bridge/bridge-provider.js')
    );
    path.node.body.unshift(importDecl);
  }
}
```

**Data Fetching Init Injection**:

In addition to the provider injection, the plugin can inject an initialization script at the top of `app.jsx` that creates the BridgeBus instance and starts public data polling:

```javascript
// Injected before the main app code:
const bridgeBus = new BridgeBus();
bridgeBus.registerDomain('ticker', { /* ... */ });
bridgeBus.registerDomain('markets', { /* ... */ });
bridgeBus.registerDomain('community', { /* ... */ });
// ... other public domains ...
bridgeBus.start(); // Starts public data polling immediately
```

This eliminates the chicken-and-egg problem where `Lifecycle.start()` never fires because wallet is not connected, which means fetchers are never registered, which means `triggerScreenData()` no-ops.

### 3.4 ConnectInterceptor (NEW -- replaces BridgeConnectModal)

Instead of wrapping the entire ConnectModal component with a HOC that intercepts `setCtx`, we inject a thin interceptor at the app.jsx level where the `openConnect` callback is defined.

**File**: `packages/forge-bridge-integration/src/connect-interceptor.js`

**Approach**:

The Phase 5 approach wrapped `window.ConnectModal` with `BridgeConnectModal(OriginalModal)` which passed a wrapped `setCtx` prop. The Phase 6 approach intercepts at the point where `openConnect` is passed as a prop to the connect modal trigger (typically a button in `TopBar` or `Landing`).

```javascript
// Injected into app.jsx by Babel Plugin v2, wrapping the openConnect callback:
// Before:
//   <button onClick={openConnect}>Connect Wallet</button>
// After:
//   <button onClick={bridgeOpenConnect}>Connect Wallet</button>

const bridgeOpenConnect = async () => {
  // 1. Open the connect modal (original behavior)
  openConnect();

  // 2. Wait for user to select wallet (modal step 0 -> 1)
  //    The modal's internal step management is untouched.
  //    We listen for the step transition via BridgeBus.

  // 3. When user clicks "Connect" after wallet selection:
  //    This is detected by BridgeBus.connection state change.
  //    The BridgeBus handles the real wallet connect + JWT flow.
  //    No component wrapping needed.
};
```

**How It Works**:

1. The Babel plugin finds the `openConnect` callback definition in `app.jsx`
2. It replaces the callback body with one that performs real bridge operations
3. The connect modal remains untouched -- it still shows the same 4-step UI
4. When the user completes step 0 (wallet selection), instead of the mock `setCtx({ connected: true, address: mockAddr })`, the interceptor calls `bridgeBus.walletConnect()` then `bridgeBus.walletLogin()` then updates the connection state in BridgeBus
5. BridgeBus dispatches `connection` domain change, BridgeProvider re-renders components consuming `useWallet()`
6. On successful connect, BridgeBus starts authenticated data polling (positions, strategies, proposals)

### 3.5 Data Fetching v2

Split into two modes with separate lifecycle management.

**File**: `packages/forge-bridge-integration/src/data-fetcher-v2.js`

**Public Mode** (starts on page load):

| Domain | Source | Interval | Notes |
|--------|--------|----------|-------|
| ticker | `bridge.api.stats.getStats()` | 30s | No wallet required |
| markets | `bridge.api.markets.getMarkets()` | 30s | No wallet required |
| community | `bridge.api.strategies.listStrategies()` | 60s | Cached |
| proposals | `bridge.api.governance.listProposals()` | 60s | Cached |
| nodeTypes | `bridge.api.defiModules.getDefiModules()` | On mount | Cached 60s internally |

**Authenticated Mode** (starts on wallet connect):

| Domain | Source | Interval | Notes |
|--------|--------|----------|-------|
| positions | `bridge.contract.read` per token | 60s | On mount + wallet change |
| strategies | `bridge.api.defiStrategies.getDefiStrategies({owner})` | On focus/nav | On mount |
| activity | `bridge.api.activities.getActivities({userAddress})` | 15s | On mount + interval |
| walletBalance | `bridge.wallet.getBalance(addr)` | 60s | On connect |

**Implementation**:

```javascript
class DataFetcherV2 {
  constructor(bridgeBus, bridge) {
    this.bus = bridgeBus;
    this.bridge = bridge;
    this.publicTimer = null;
    this.authTimers = {};
    this.authStarted = false;
  }

  // Called immediately on page load
  startPublicPolling() {
    // Register and start public domains
    this.bus.registerDomain('ticker', {
      fetcher: () => this.bridge.api.stats.getStats().then(formatTicker),
      interval: 30000,
      authRequired: false,
    });
    // ... register other public domains ...
    this.bus.start(); // Starts all registered polling timers
  }

  // Called when wallet connects
  startAuthenticatedPolling(address) {
    if (this.authStarted) return;
    this.authStarted = true;

    this.bus.registerDomain('positions', {
      fetcher: () => this.fetchPositions(address),
      interval: 60000,
      authRequired: true,
    });
    // ... register other auth domains ...
  }

  // Called when wallet disconnects
  stopAuthenticatedPolling() {
    this.authStarted = false;
    this.bus.stopDomain('positions');
    this.bus.stopDomain('strategies');
    this.bus.stopDomain('activity');
    this.bus.stopDomain('walletBalance');
    // Clear auth data from state (but not public data)
    this.bus.clearAuthData();
  }

  async fetchPositions(address) {
    const [supplies, borrows, markets] = await Promise.all([
      this.fetchAllSupplies(address),
      this.fetchAllBorrows(address),
      this.bus.getState('markets')?.data || this.bridge.api.markets.getMarkets(),
    ]);
    return transformPositions(supplies, borrows, markets);
  }
}
```

### 3.6 Build v2

**Target**: Reduce bridge bundle from 4.47 MB to ~175 KB.

**Changes to `packages/forge-bridge/package.json`**:

```json
{
  "scripts": {
    "build": "bun build ./src/index.js --outdir=dist --external=viem --external=@wagmi/core --external=@wagmi/connectors --external=@cofhe/sdk --external=axios --external=react --format=esm",
    "build:dev": "bun build ./src/index.js --outdir=dist --external=viem --external=@wagmi/core --external=@wagmi/connectors --external=@cofhe/sdk --external=axios --external=react --format=esm --sourcemap=inline"
  }
}
```

**Importmap Changes** (in `FheForge.html`):

```html
<script type="importmap">
{
  "imports": {
    "@fheforge/bridge/core": "./bridge/dist/index.js",
    "@fheforge/bridge": "./bridge/dist/index.js",
    "@fheforge/bridge-integration": "./bridge-integration/src/bridge-bus.js",
    "viem": "https://unpkg.com/viem@2.x/dist/esm/index.js",
    "viem/chains": "https://unpkg.com/viem@2.x/dist/esm/chains.js",
    "@wagmi/core": "https://unpkg.com/@wagmi/core@2.x/dist/esm/index.js",
    "@wagmi/connectors": "https://unpkg.com/@wagmi/connectors@5.x/dist/esm/index.js",
    "@cofhe/sdk": "https://unpkg.com/@cofhe/sdk@0.5.x/dist/index.js",
    "@cofhe/sdk/permits": "https://unpkg.com/@cofhe/sdk@0.5.x/dist/permits.js",
    "axios": "https://unpkg.com/axios@1.x/dist/axios.js"
  }
}
</script>
```

**Updated HTML Loading Order**:

```html
<!-- 1. React + ReactDOM (CDN) -->
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>

<!-- 2. Importmap (defines module resolution for ESM imports) -->
<script type="importmap">...</script>

<!-- 3. Babel standalone (for text/babel transforms) -->
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

<!-- 4. BRIDGE: Babel monkey-patch (injects mock-data plugin + provider injection) -->
<script src="bridge/babel-injector-plugin.js"></script>

<!-- 5. Forge screen scripts (transformed by patched Babel) -->
<script type="text/babel" src="ui/screens/landing.jsx"></script>
<script type="text/babel" src="ui/screens/dashboard.jsx"></script>
<script type="text/babel" src="ui/screens/lending.jsx"></script>
<script type="text/babel" src="ui/screens/market.jsx"></script>
<script type="text/babel" src="ui/screens/governance.jsx"></script>
<script type="text/babel" src="ui/screens/builder-workspace.jsx"></script>
<script type="text/babel" src="ui/screens/connect-modal.jsx"></script>

<!-- 6. Main app (BridgeProvider injected here by Babel plugin) -->
<script type="text/babel" src="ui/app.jsx"></script>
<script type="text/babel" src="ui/components.jsx"></script>

<!-- 7. BRIDGE: Bridge adapter + data fetcher v2 -->
<script type="module" src="bridge/bridge-init.js"></script>
```

The key simplification: no more `bridge-screen-override.js`. The screen wrappers file is eliminated entirely. No polling for screen registration. No polling for bridge availability. The BridgeBus is created from `babel-injector-plugin.js` or `bridge-init.js` (depending on timing), and the BridgeProvider subscribes to it at the React level.

---

## 4. Data Flow Walkthroughs

### 4.1 Page Load (Unconnected User)

```
1. HTML loads, scripts execute in order
2. babel-injector-plugin.js runs:
   - Patches Babel.transform
   - Creates window.__MOCK__ = {}
3. Forge screen scripts load:
   - const D_POSITIONS = [...] -> var D_POSITIONS = window.__MOCK__?.D_POSITIONS ?? [...]
4. app.jsx loads:
   - Babel plugin injects:
     import BridgeProvider from './bridge/bridge-provider.js'
     import DataFetcherV2 from './bridge/data-fetcher-v2.js'
     const bridgeBus = new BridgeBus()
     const fetcher = new DataFetcherV2(bridgeBus, window.bridge)
     fetcher.startPublicPolling()
     ReactDOM.createRoot(...).render(
       <BridgeProvider bridgeBus={bridgeBus}>
         <App />
       </BridgeProvider>
     )
5. React renders, BridgeProvider mounts:
   - BridgeProvider.subscribeAll -> setState on domain changes
   - BridgeBus.start() begins polling ticker (30s), markets (30s)
6. 30 seconds later:
   - BridgeBus dispatches 'ticker' with real data
   - BridgeProvider.setState updates ticker domain
   - Components consuming useDomain('ticker') re-render
   - Ticker items drawn from window.__MOCK__.TICKER_ITEMS = real data
7. User never connected:
   - No authenticated data polling starts
   - window.__MOCK__.D_POSITIONS stays as hardcoded fallback via ?? operator
```

### 4.2 Wallet Connect Flow

```
1. User clicks "Connect Wallet" in TopBar
2. ConnectInterceptor (injected at app.jsx) fires:
   - Opens the connect modal (original UI, unchanged)
3. User selects wallet (MetaMask, Rabby, etc.) in connect modal step 0
4. Modal advances to step 1 (sign message)
5. ConnectInterceptor detects step transition via BridgeBus.connection state:
   - Calls bridgeBus.connect() -> bridge.wallet.connect(connectorId)
   - Wagmi opens wallet popup, user approves
6. Wallet connected, Interceptor continues:
   - Calls bridgeBus.login() -> bridge.wallet.login()
   - Wagmi signs nonce message, POSTs to /auth/wallet-login
   - JWT stored in localStorage
7. BridgeBus dispatches 'connection' with { connected: true, address: realAddr, ... }
8. BridgeProvider re-renders, useWallet() consumers update
9. DataFetcherV2 detects wallet connect:
   - Calls startAuthenticatedPolling(realAddress)
   - Registers positions, strategies, activity, walletBalance fetchers
   - BridgeBus begins authenticated polling
10. First position data arrives:
    - BridgeBus dispatches 'positions'
    - BridgeProvider.setState updates positions domain
    - Dashboard components re-render with real position data
    - No re-mount -- scroll position, tab selection preserved
11. Modal advances to step 2 (permit grant):
    - ConnectInterceptor calls bridgeBus.grantPermit() -> bridge.fhe.permitGrant()
    - SDK creates FHE permit
12. BridgeBus dispatches 'permit' with { unlocked: true, secondsLeft: 900 }
13. BridgeProvider re-renders, usePermit() consumers update
14. Cipher components switch from blurred to plaintext
15. Modal advances to step 3 (ready), auto-dismisses after 1.6s
```

### 4.3 Data Update Cycle

```
1. BridgeBus polling interval fires for 'ticker' (every 30s)
2. fetcher() calls bridge.api.stats.getStats()
3. Response transformed via formatTicker()
4. BridgeBus.dispatch('ticker', formattedData)
5. BridgeBus internal state:
   - ticker.data = formattedData
   - ticker.lastUpdated = Date.now()
   - ticker.error = null
6. BridgeBus iterates ticker subscribers, calls each with formattedData
7. BridgeProvider's subscribeAll callback fires:
   - setState(prev => ({ ...prev, ticker: { data: formattedData, ... } }))
8. React batch re-render:
   - Only components that call useDomain('ticker') or consume relevant context re-render
   - Ticker component reads window.__MOCK__.TICKER_ITEMS (already updated)
   - No other screens re-render
   - Dashboard, Lending, etc. unaffected

9. Error case:
   - bridge.api.stats.getStats() throws network error
   - BridgeBus catches error:
     - ticker.error = { message: 'Network error', ... }
     - ticker.data = PREVIOUS_DATA (stale data preserved)
     - ticker.loading = false
   - BridgeBus dispatches 'ticker' with error state
   - Components can optionally display error indicator
   - ?? fallback in Babel-transformed code keeps showing previous values
```

---

## 5. Migration Path from Phase 5 to Phase 6

The migration is designed to be incremental: each component can be replaced independently without breaking the Phase 5 architecture. The old and new systems can coexist during transition.

### Phase 6a: BridgeBus (parallel deploy)

**Goal**: BridgeBus is developed and deployed alongside Phase 5 architecture. No functional change yet.

1. Create `packages/forge-bridge-integration/src/bridge-bus.js` -- new BridgeBus class
2. Create `packages/forge-bridge-integration/src/data-fetcher-v2.js` -- new DataFetcherV2
3. Export BridgeBus on `window.__BRIDGE_BUS__` for testing
4. BridgeBus runs in parallel with existing `window.__MOCK__` and `window.__BRIDGE__`
5. Validation: BridgeBus correctly receives and stores data, but Phase 5 still drives the UI

**No breaking changes**: Phase 5 screen wrappers continue to work. BridgeBus is idle.

### Phase 6b: Babel Plugin v2 (replaces v1)

**Goal**: Replace the Babel plugin. The new plugin still rewrites mock declarations AND additionally injects BridgeProvider into app.jsx.

1. Create `packages/forge-bridge-integration/src/babel-injector-plugin.js`
2. Copy VariableDeclarator and Identifier visitors from v1 (identical logic)
3. Add Program.exit visitor for BridgeProvider injection into app.jsx
4. Remove JSXAttribute visitor (no longer needed -- Cipher value strings handled differently)
5. Update script loading order: load new plugin instead of old one
6. BridgeProvider is injected but does NOT yet drive the UI -- it just subscribes to BridgeBus

**Validation**: 
- All screen components still get correct `var X = window.__MOCK__?.X ?? val` transforms
- app.jsx now has `<BridgeProvider>` wrapper
- No change in UI behavior

**No breaking changes**: Phase 5 screen wrappers still handle re-renders via key={dataVersion}. BridgeProvider is present but passive.

### Phase 6c: BridgeProvider Activation (disables screen wrappers)

**Goal**: Wire BridgeProvider to actually drive `window.__MOCK__` updates, eliminating the need for screen wrappers.

1. BridgeProvider gains a `useEffect` that writes domain data to `window.__MOCK__[key] = data`
2. BridgeProvider's data update triggers normal React re-render cycle
3. Remove screen wrappers one by one:
   - Start with Landing (lowest state-loss impact)
   - Then Market, Governance (simple list screens)
   - Then Lending (moderate state -- market sort, tab)
   - Finally Dashboard (high state -- master-detail scroll, selection)
4. For each screen removed from wrapper:
   - Delete the `BridgeScreenWrapper` call for that screen
   - Verify scroll position, selection, input focus are preserved
5. Phase 5 screen-override.js shrinks until only ConnectModal wrapper remains

**Validation per screen**:
- Data still updates on polling intervals
- No re-mount (verify React DevTools key doesn't change)
- Scroll position preserved
- Selected item in master-detail preserved
- Input fields maintain focus

### Phase 6d: ConnectInterceptor (replaces BridgeConnectModal)

**Goal**: Replace the ConnectModal wrapper with direct callback injection.

1. Create `packages/forge-bridge-integration/src/connect-interceptor.js`
2. The Babel plugin's Program.exit visitor gains logic to find the `openConnect` function definition in app.jsx
3. Replace the function body with bridge-aware implementation
4. BridgeConnectModal wrapper in screen-override.js becomes inert (its `wrappedSetCtx` never fires because the modal now receives the real callback directly)
5. Remove BridgeConnectModal entirely

**Validation**:
- Connect flow still works: wallet selection -> sign -> permit -> ready
- No duplicate connect attempts (the Phase 5 `!prevCtx.connected` guard race is gone)
- Permit state updates correctly

### Phase 6e: Build v2 + Loading Order Cleanup

**Goal**: Reduce bundle size and simplify loading.

1. Update `package.json` build script with `--external` flags
2. Add missing importmap entries
3. Remove `bridge-screen-override.js` from loading order
4. Update `bridge-init.js` to create BridgeBus and wire to BridgeProvider
5. Remove the 2-second polling in `getBridgeApi()` -- BridgeBus receives bridge reference directly

**Validation**:
- Bundle size reduced from 4.47 MB to ~175 KB
- Importmap resolves all modules without errors
- Bridge initializes within same tick (no deferred ESM timing issue)
- No console errors for missing modules

---

## 6. Feature Breakdown

### Phase 6a: BridgeBus Foundation

| ID | Feature | Effort | Dependencies |
|----|---------|--------|-------------|
| 6a.1 | Create BridgeBus class with state, dispatch, subscribe | 1 day | None |
| 6a.2 | Add domain registration with polling config | 0.5 day | 6a.1 |
| 6a.3 | Add public vs auth domain lifecycle | 0.5 day | 6a.2 |
| 6a.4 | Add dispatchBatch and coalesced notifications | 0.5 day | 6a.1 |
| 6a.5 | Unit tests for BridgeBus | 1 day | 6a.1-4 |
| 6a.6 | Integration test: BridgeBus + mock bridge adapters | 0.5 day | 6a.1-4 |

### Phase 6b: Babel Plugin v2

| ID | Feature | Effort | Dependencies |
|----|---------|--------|-------------|
| 6b.1 | Create babel-injector-plugin.js with v1 visitors | 0.5 day | None |
| 6b.2 | Add Program.exit injection of BridgeProvider import | 1 day | 6a.1 |
| 6b.3 | Add Program.exit injection of bridgeBus creation + fetcher init | 1 day | 6a.6 |
| 6b.4 | Add ConnectInterceptor injection at openConnect site | 1 day | 6b.2 |
| 6b.5 | Remove JSXAttribute visitor | 0.25 day | 6b.1 |
| 6b.6 | Unit tests for babel-injector-plugin | 1 day | 6b.1-5 |
| 6b.7 | Snapshot tests: compare v1 vs v2 output for each screen | 0.5 day | 6b.6 |

### Phase 6c: BridgeProvider

| ID | Feature | Effort | Dependencies |
|----|---------|--------|-------------|
| 6c.1 | Create BridgeProvider React component | 1 day | 6a.1, React |
| 6c.2 | Create useDomain, useWallet, usePermit hooks | 0.5 day | 6c.1 |
| 6c.3 | Wire BridgeProvider writes to window.__MOCK__ | 0.5 day | 6c.1 |
| 6c.4 | Remove Landing from screen wrappers, verify state preservation | 0.5 day | 6c.3 |
| 6c.5 | Remove Market, Governance from screen wrappers | 0.5 day | 6c.3 |
| 6c.6 | Remove Lending from screen wrappers | 0.5 day | 6c.3 |
| 6c.7 | Remove Dashboard, BuilderWorkspace from screen wrappers | 0.5 day | 6c.3 |
| 6c.8 | E2E test: data updates without state loss | 1 day | 6c.4-7 |

### Phase 6d: ConnectInterceptor

| ID | Feature | Effort | Dependencies |
|----|---------|--------|-------------|
| 6d.1 | Create connect-interceptor.js | 1 day | 6b.4, 6a.1 |
| 6d.2 | Wire wallet connect + JWT flow via BridgeBus | 0.5 day | 6d.1 |
| 6d.3 | Wire permit grant flow via BridgeBus | 0.5 day | 6d.1 |
| 6d.4 | Remove BridgeConnectModal wrapper | 0.25 day | 6d.1-3 |
| 6d.5 | E2E test: full connect flow end-to-end | 1 day | 6d.4 |

### Phase 6e: Build Optimization

| ID | Feature | Effort | Dependencies |
|----|---------|--------|-------------|
| 6e.1 | Update build script with --external flags | 0.25 day | None |
| 6e.2 | Add missing importmap entries | 0.25 day | 6e.1 |
| 6e.3 | Update bridge-init.js for BridgeBus wiring | 0.5 day | 6a.1 |
| 6e.4 | Remove screen-override.js from loading order | 0.25 day | 6c.7, 6d.4 |
| 6e.5 | Remove 2s getBridgeApi() polling timeout | 0.25 day | 6e.3 |
| 6e.6 | Verify bundle size (target <200 KB) | 0.25 day | 6e.1 |
| 6e.7 | Verify importmap resolves all entries | 0.25 day | 6e.2 |

---

## 7. Validation Strategy

### 7.1 Unit Tests

| Component | Test | Pass Condition |
|-----------|------|----------------|
| BridgeBus | dispatch updates state | `bus.getState('ticker').data === expected` |
| BridgeBus | subscribe receives events | Callback fires with correct domain and data |
| BridgeBus | unsubscribe stops events | Callback does not fire after unsubscribe |
| BridgeBus | dispatchBatch coalesces | Single notification cycle for N updates |
| BridgeBus | public domain starts on `start()` | Fetcher called within interval period |
| BridgeBus | auth domain waits for wallet | Fetcher not called until `bus.authConnect()` |
| Babel v2 | VariableDeclarator visitor | `const X = val` -> `var X = window.__MOCK__?.X ?? val` |
| Babel v2 | Provider injection in app.jsx | Output AST contains `<BridgeProvider>` wrapper |
| Babel v2 | ConnectInterceptor injection | Output AST contains `bridgeOpenConnect` wrapper |
| DataFetcherV2 | Public polling starts immediately | Fetcher called on construction |
| DataFetcherV2 | Auth polling starts on wallet connect | Fetcher called after `startAuthenticatedPolling()` |
| DataFetcherV2 | Auth polling stops on disconnect | Fetcher intervals cleared, auth data cleared |
| BridgeProvider | useDomain provides data | Hook returns state for requested domain |
| BridgeProvider | data updates trigger re-render | Component re-renders with new data |
| Transformers | All 9 transformers return correct shape | Snapshot test per transformer |

### 7.2 Integration Tests

| Test | Scenario | Verification |
|------|----------|-------------|
| Page load, unconnected | Load page without wallet | Ticker shows real API data within 30s; markets show real data within 30s; positions remain hardcoded; no console errors for auth fetcher failures |
| Wallet connect | Full connect flow | Wallet connects; JWT stored; permit granted; authenticated data appears; Cipher components unlock |
| Network error during fetch | Bridge API returns 500 | Stale data preserved; error logged; UI continues to show previous values; next poll retries |
| Wallet disconnect | User disconnects mid-session | Auth data cleared; public data persists; Cipher re-locks; connect button re-appears |
| Bundle size | Measure dist/index.js | Target <200 KB (currently 4.47 MB) |
| Importmap resolution | Load all modules via importmap | No module-not-found errors in browser console |
| Data update without state loss | Dashboard positions update while scrolled | Scroll position preserved; selected item preserved; input focus preserved |
| CORS from localhost | Dev server on localhost:3100 | API calls succeed (verify allowed origins config) |

### 7.3 Regression Tests

All Phase 5 validation contracts (see `VALIDATION_INTEGRATION.md`) must continue to pass, with the following additions:

| ID | Description | Tool |
|----|-------------|------|
| VAL-INTEGRATION-6-001 | BridgeBus exists on window scope | `file-exists` |
| VAL-INTEGRATION-6-002 | BridgeProvider component renders correctly | `terminal-output` (React testing) |
| VAL-INTEGRATION-6-003 | Babel plugin v2 injects BridgeProvider import into app.jsx | `file-content` (AST check) |
| VAL-INTEGRATION-6-004 | Public data fetchers fire without wallet | `terminal-output` (browser console) |
| VAL-INTEGRATION-6-005 | No screen wrappers loaded | `file-content` (verify screen-override.js not in loading order) |
| VAL-INTEGRATION-6-006 | Bundle size < 200 KB | `terminal-output` (bun build --external; ls -lh dist/) |
| VAL-INTEGRATION-6-007 | All 6 importmap entries resolve | `terminal-output` (browser devtools network tab) |
| VAL-INTEGRATION-6-008 | Connect flow completes without `!prevCtx.connected` guard | `file-content` (verify guard removed) |
| VAL-INTEGRATION-6-009 | Data update preserves DOM state | `manual` (scroll, tab, focus test) |

---

## 8. Open Questions

### 8.1 BridgeBus and BridgeProvider Discovery

How does the BridgeProvider component (injected by Babel plugin v2 into `app.jsx`) discover the BridgeBus instance? Options:

- **(A) Global window variable**: `window.__BRIDGE_BUS__` is set by `bridge-init.js`, the Babel plugin injects code that reads it. Simplest, matches Phase 5 patterns.
- **(B) Import from bridge bundle**: `import { BridgeBus } from '@fheforge/bridge-integration'` in injected code. Requires importmap entry for bridge-integration package.
- **(C) Created inline in app.jsx**: The Babel plugin injects `const bridgeBus = new BridgeBus()` directly in app.jsx. BridgeBus must be available as a global or import.

**Recommendation**: Option (A) for Phase 6a-6c (shortest path to working), migrate to Option (B) for Phase 6e when importmap is fully configured. This avoids importmap resolution issues during early development.

### 8.2 ConnectModal and the connect-interceptor.js Integration Point

Where exactly in `app.jsx` does the connect interceptor inject? The `openConnect` callback could be:
- A standalone function passed as a prop
- Created inline via `onClick={() => setOpen(true)}`
- A `useCallback` wrapping `setOpen(true)`

The Babel plugin needs to detect all three patterns. If it cannot reliably find the injection site, fall back to wrapping `window.ConnectModal` as before but WITHOUT the `!prevCtx.connected` guard (just fix the guard logic). This is a simpler, more robust approach than the AST injection.

**Recommendation**: Implement both approaches. If the Babel plugin can detect and replace the openConnect callback (simple cases), use the interceptor. For complex cases (e.g., callback is buried in a `useEffect` closure), fall back to ConnectModal wrapper with fixed guard logic. The screen wrapper file can be reduced to just the ConnectModal wrapper.

### 8.3 Cipher Value String Literals

Phase 5 used a JSXAttribute visitor to replace `<Cipher value="68,412.07">` with `<Cipher value={window.__MOCK__?.PORTFOLIO_NET_VALUE ?? "68,412.07"}>`. Phase 6 drops this visitor. How do Cipher value strings get replaced?

Options:
- **(A) BridgeProvider writes to __MOCK__**: Since BridgeProvider already writes domain data to `window.__MOCK__`, and the Babel plugin's VariableDeclarator/Identifier visitors handle most replacements, the ~14 Cipher string literals remain as-is through the `??` fallback. BridgeProvider writes real values (e.g., `window.__MOCK__.PORTFOLIO_NET_VALUE = "72,104.33"`) on data update. React re-renders read the new values from `window.__MOCK__`.
- **(B) Add data-mock-key attributes to Cipher**: Modify the Babel plugin to detect `<Cipher value="...">` and add a `data-mock-key` attribute. A runtime script reads these attributes and replaces textContent.
- **(C) Keep the JSXAttribute visitor**: Don't remove it. Even though BridgeProvider handles most data, the JSXAttribute visitor ensures Cipher values are always mock-aware.

**Recommendation**: Option (A). BridgeProvider already writes all values to `window.__MOCK__`. The Cipher string literals have `??` fallback through their original `const` declaration (e.g., `const PORTFOLIO_NET_VALUE = "68,412.07"` which is transformed to `var PORTFOLIO_NET_VALUE = window.__MOCK__?.PORTFOLIO_NET_VALUE ?? "68,412.07"`). Wait -- these are NOT const declarations, they're JSX string literals. The original approach works because the const declarations for these values exist as comment annotations or separate variables.

**Correction**: The Cipher string literals in Phase 5 are NOT module-scoped consts -- they're inline JSX string literals. They were only handled by the JSXAttribute visitor. In Phase 6, the Babel plugin must keep handling these, OR the BridgeProvider must set `window.__MOCK__` values for each Cipher string key, AND the component must read from `window.__MOCK__` -- which it does NOT because the JSX literal was never transformed.

**Resolution**: Keep the JSXAttribute visitor in Phase 6. It's small (~30 lines), well-tested, and handles a real gap. Remove it only if all Cipher value strings can be traced to a module-scoped const or identifier reference.

### 8.4 CORS for Local Development

The backend API at `fheforge-api-production-6465.up.railway.app` does not include `localhost:3100` in its allowed origins. Phase 6 must either:
- **(A) Add localhost to backend CORS config**
- **(B) Proxy requests through the dev server**
- **(C) Use a CORS proxy**

**Recommendation**: (A) is the correct solution. Add `http://localhost:3100` and `http://127.0.0.1:3100` to the backend's CORS `allowedOrigins` configuration. If backend changes are not possible, (B) -- proxy through the dev server's API route.

### 8.5 BuilderWorkspace Simulation and Deploy Overrides

The Phase 5 `BridgeBuilderWorkspace` wrapper exposes `window.__bridgeSimulate` and `window.__bridgeDeploy` functions that the builder canvas uses for simulation and deployment. How does Phase 6 handle these?

**Recommendation**: Move these to BridgeBus as action methods:
```javascript
bus.registerAction('simulateStrategy', (canvasState) => {
  return bridge.api.defiStrategies.simulateDefiStrategy(canvasState);
});
bus.registerAction('deployStrategy', (deployParams) => {
  return bridge.contract.write.openPosition(deployParams);
});
```
The builder workspace reads these from BridgeBus via a `useBridgeAction('simulateStrategy')` hook. This eliminates the global `window.__bridge*` functions.

### 8.6 NODE_TYPES and TEMPLATES Protection

Phase 5 has a guard in `setBatchMockData` that skips `TEMPLATES` and `DEFAULT_CONFIG` to prevent overwriting structural data. How does Phase 6 handle this?

**Recommendation**: BridgeBus domain registration should not auto-overwrite domains that are structural/non-data. Register `TEMPLATES` and `DEFAULT_CONFIG` as "static" domains:
```javascript
bus.registerStatic('TEMPLATES', templatesValue);
bus.registerStatic('DEFAULT_CONFIG', defaultConfigValue);
```
Static domains are never overwritten by `dispatch()` or `dispatchBatch()`, only by explicit `dispatchStatic()`.

### 8.7 Async Module Loading and Babel Transform Timing

The Babel plugin injects code referencing `BridgeProvider`, `BridgeBus`, `DataFetcherV2`, etc. into `app.jsx`. These modules must be loaded before the injected code executes. How to ensure correct load order?

Options:
- **(A) Synchronous script loads before text/babel**: Load bridge-provider.js and bridge-bus.js as regular `<script>` tags (not `type="module"`) before the `text/babel` scripts. Since these files are small ESM-compatible IIFEs, they work fine as classic scripts.
- **(B) ESM imports in injected code**: The injected `import BridgeProvider from './bridge/bridge-provider.js'` is a static import, which the bundler or browser resolves before executing.

**Recommendation**: Option (A) for Phase 6a-6c (simplest), transition to Option (B) for Phase 6e when importmap is fully configured and scripts can be loaded as ES modules.

### 8.8 Testing the Provider Injection

How to test that the Babel plugin correctly injects BridgeProvider into app.jsx?

**Recommendation**: Snapshot testing. Create a test fixture of `app.jsx` content, run it through Babel.transform with the Phase 6 plugin, and assert the output matches a snapshot. The snapshot should contain:
- `import BridgeProvider from './bridge/bridge-provider.js'` at the top
- A `<BridgeProvider>` JSX wrapper around the app root
- (Optional) `const bridgeBus = ...` creation and `bridgeBus.start()` call

---

## 9. Summary: What Stays, What Goes, What Changes

### Stays (unchanged from Phase 5)

| Component | Reason |
|-----------|--------|
| Bridge adapters (wallet, api, contract, fhe) | Working correctly, only the integration layer changes |
| Transformers (all 9 functions) | Working correctly, no changes needed |
| Babel VariableDeclarator visitor | Working correctly, identical logic in v2 |
| Babel Identifier visitor | Working correctly, identical logic in v2 |
| Forge components (all 13 ui/ files) | Untouched by design -- zero modifications |
| window.__MOCK__ global | Still the mechanism for data delivery to components |
| Cipher, PermitChip, WalletChip, LtvGauge | Receive same props with real values as before |
| MasterDetail, MDItem, MDGroup, Modal, etc. | Pure layout components, unchanged |
| All CSS / DESIGN.md tokens | Unchanged |
| All Framer Motion animations | Unchanged |

### Goes (removed from Phase 5)

| Component | Replacement | Reason |
|-----------|-------------|--------|
| screen-override.js (full file) | BridgeProvider + BridgeBus | Eliminates key={dataVersion} state loss |
| BridgeScreenWrapper HOC | BridgeProvider (useDomain hooks) | Same reason |
| BridgeConnectModal wrapper | ConnectInterceptor | Eliminates timing race and guard bug |
| BridgeBuilderWorkspace wrapper | BridgeBus action methods | Eliminates window.__bridge* globals |
| Babel JSXAttribute visitor (optional) | BridgeProvider writes to __MOCK__ | Kept if Cipher strings need direct handling |
| getBridgeApi() 2s timeout | Direct BridgeBus reference | No polling needed |
| Lifecycle.start() wallet gating | Public vs auth domain lifecycle | Public data starts on page load |

### Changes (modified from Phase 5)

| Component | Change | Reason |
|-----------|--------|--------|
| babel-transform-plugin.js | Add Program.exit provider injection | Eliminates need for screen wrappers |
| bridge-init.js | Wire BridgeBus to BridgeProvider | Decouples data sources from consumers |
| Build scripts | Add --external flags | 4.47 MB -> 175 KB |
| Importmap | Add 4 missing entries | Fix ESM module resolution |
| Integration adapter | Split into public + auth lifecycle | Public data without wallet |
