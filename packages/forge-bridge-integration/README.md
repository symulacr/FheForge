# @fheforge/bridge-integration

Forge frontend integration layer. Connects the bridge adapters (`@fheforge/bridge`) to the forge prototype UI without modifying any forge files.

## Script Loading Order

The following loading order is required for correct operation. All script tags live in `FheForge.html`:

```
1. React + ReactDOM (CDN — unpkg.com)
2. Babel standalone (CDN — unpkg.com)
3. Importmap for ESM packages (viem, wagmi, cofhe, axios via esm.sh)
4. BRIDGE: Babel.transform monkey-patch (babel-transform-plugin.js)
5. BRIDGE: Screen wrappers (screen-override.js)
6. Forge screen scripts (text/babel — intercepted by patched Babel)
7. UI app.jsx + components.jsx (text/babel)
8. BRIDGE: Integration adapter (integration-adapter.js)
```

### Why This Order

- **React + ReactDOM must load first** — forge screens depend on these globals.
- **Babel standalone must load before the monkey-patch** — the plugin patches `Babel.transform`.
- **Importmap must load before any ESM script tags** — resolves bare module imports (viem, wagmi, cofhe, axios).
- **Babel.transform monkey-patch loads before text/babel scripts** — ensures all forge screen transforms are intercepted.
- **Screen wrappers load before forge screens** — wraps `window.Dashboard`, `window.Landing`, etc. before the forge scripts define them.
- **Integration adapter loads last** — depends on bridge being initialized and screen wrappers being in place.

## Files

| File | Purpose |
|------|---------|
| `src/babel-transform-plugin.js` | Babel.transform monkey-patch with 3 visitors (VariableDeclarator, Identifier, JSXAttribute). Injects `window.__MOCK__` lookups for mock data constants and Cipher value literals. |
| `src/screen-override.js` | Screen wrapper components (Landing, Dashboard, Lending, Market, Governance, ConnectModal) with `key={dataVersion}` re-mount. |
| `src/integration-adapter.js` | DataFetcher (per-screen polling), Transformer (shape mapping), StateManager (window.__MOCK__ updates + notify). |
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
