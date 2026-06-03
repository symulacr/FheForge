# @fheforge/bridge-integration

Forge frontend integration layer. Connects the bridge adapters (`@fheforge/bridge`) to the forge prototype UI without modifying any forge files.

## Script Loading Order

The following loading order is required for correct operation. All script tags live in `FheForge.html`:

```
1. React + ReactDOM (CDN — unpkg.com)
2. Babel standalone (CDN — unpkg.com)
3. Importmap for ESM packages (viem, wagmi, cofhe, axios via esm.sh)
4. BRIDGE: Bridge init (bridge-init.js — ESM, loads @fheforge/bridge)
5. BRIDGE: DataFetcherV2 (data-fetcher-v2.js — public/authenticated split polling)
6. BRIDGE: ForgeProvider React Context (bridge-context.js — subscribes to BridgeBus)
7. BRIDGE: ConnectInterceptor (connect-interceptor.js — wallet connect flow)
8. BRIDGE: Babel.transform monkey-patch (babel-transform-plugin.js)
9. Forge screen scripts + UI (text/babel — intercepted by patched Babel)
10. BRIDGE: Transformers (transformers.js — shape mapping functions)
```

### Why This Order

- **React + ReactDOM must load first** — forge screens depend on these globals.
- **Babel standalone must load before the monkey-patch** — the plugin patches `Babel.transform`.
- **Importmap must load before any ESM script tags** — resolves bare module imports (viem, wagmi, cofhe, axios).
- **Bridge init loads early** — creates `window.bridge` with production defaults used by downstream modules.
- **DataFetcherV2, BridgeContext, ConnectInterceptor load before babel-transform-plugin.js** — these set up the BridgeBus event system and ForgeProvider React Context, establishing the data pipeline before any screen scripts run.
- **Babel.transform monkey-patch loads before text/babel scripts** — ensures all forge screen transforms are intercepted with the ForgeProvider injection.
- **Transformers load last** — pure shape mapping functions exposed as `window.__transformers`, available for debugging after screens render.

## Files

| File | Purpose |
|------|---------|
| `src/babel-transform-plugin.js` | Babel.transform monkey-patch with 3 visitors (VariableDeclarator, JSXAttribute, Program.exit). Injects ForgeProvider wrapper and `window.__MOCK__` lookups for mock data constants and Cipher value literals. |
| `src/bridge-context.js` | ForgeProvider React Context — subscribes to BridgeBus events, exposes `window.ForgeProvider` with `useBridge()` hook. |
| `src/connect-interceptor.js` | ConnectInterceptor — wallet connect flow via BridgeBus events. |
| `src/data-fetcher-v2.js` | DataFetcherV2 — public/authenticated split polling, replaces Phase 5 integration-adapter.js. |
| `src/transformers.js` | Pure functions: transformMarkets, transformPositions, transformActivities, formatTicker, transformStrategies, transformProposals, transformNodeTypes, calculateNetValue, calculateLTV. |

## API

### window.\_\_MOCK\_\_

Object holding mock data for each screen component. Populated by the integration adapter.

```javascript
window.__MOCK__ = {
  D_POSITIONS: [...],     // Dashboard positions
  D_STRATS: [...],        // Dashboard strategies
  D_ACTIVITY: [...],      // Dashboard activity
  L_MARKETS: [...],       // Lending markets
  COMMUNITY: [...],       // Market community strategies
  PROPOSALS: [...],       // Governance proposals
  NODE_TYPES: {...},      // Builder node types
  TEMPLATES: [...],       // Builder templates (not overwritten by bridge)
  DEFAULT_CONFIG: {...},  // Builder default config (not overwritten by bridge)
  TICKER_ITEMS: [...],    // Landing ticker
  DEMO_ROWS: [...],       // Landing demo rows
};
```

### window.\_\_BRIDGE\_\_

Bridge integration API:

| Method | Description |
|--------|-------------|
| `setMockData(key, value)` | Sets `window.__MOCK__[key] = value` and notifies listeners |
| `getMockData(key)` | Returns `window.__MOCK__?.[key]` |
| `onDataUpdate(fn)` | Registers a listener; returns unsubscribe function |
| `notify()` | Increments data version and triggers all listeners |
