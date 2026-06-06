# Phase 5 Integration Plan — Design-Preserving Bridge Integration

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Bridge Adapters (real data sources)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐  │
│  │  wallet  │ │   api    │ │   contract   │ │   fhe    │  │
│  │ (wagmi)  │ │ (axios)  │ │   (viem)     │ │(@cofhe)  │  │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ └────┬─────┘  │
└───────┼─────────────┼──────────────┼──────────────┼────────┘
        │             │              │              │
        ▼             ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│  Integration Layer (bridge-adapter.js)                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  DataFetcher: polls/streams from adapters           │   │
│  │  Transformer: shapes data to match mock structures  │   │
│  │  StateManager: updates window.__MOCK__ + notifies   │   │
│  └──────────────────────┬──────────────────────────────┘   │
└─────────────────────────┼──────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  window.__MOCK__ (Proxy object with change detection)       │
│  D_POSITIONS, D_STRATS, D_ACTIVITY, L_MARKETS, ...         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  screen-override wrappers (bridge-screen-override.js)       │
│  key={dataVersion} forces re-mount when __MOCK__ changes    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Forge React Components (IMMUTABLE)                         │
│  const D_POSITIONS → var D_POSITIONS =                      │
│    window.__MOCK__?.D_POSITIONS ?? [...]                    │
│  Renders identical JSX with real values                     │
└─────────────────────────────────────────────────────────────┘
```

## A) Mock-to-Real Data Mapping — Complete

### 1. landing.jsx

| Mock Location | Mock Data | `__MOCK__` Key | Bridge Source | Shape Mapping |
|---|---|---|---|---|
| `Ticker()` → `items` array | 9 hardcoded strings like `"block #182,944,108"`, `"gas · 0.014 gwei"`, `"USDC pool tvl · $8.42M"`, etc. | `TICKER_ITEMS` | `bridge.api.stats.getStats()` (cached, TTL 30s) | `stats` response → 9 display strings, formatted via `formatTicker(stats)` utility |
| `DemoCard()` → `rows` array | `[["Supplied","42,084.13","USDC"], ["Borrowed","18,910.00","ETH"], ["In strategies","7,418.94","USDC"]]` | `DEMO_ROWS` | `bridge.contract.read.getSupplyBalance(addr)`, `bridge.contract.read.getBorrowBalance(addr)`, `bridge.contract.read.getCollateral(posId)` | When connected: real balances transformed to `[label, formattedAmount, asset]` tuples. When disconnected: null → falls back to hardcoded demo values |
| `DemoCard()` → net value `"68,412.07"` | String literal in JSX `<Cipher value="68,412.07"...>` | `PORTFOLIO_NET_VALUE` | Sum of all supplies + vault positions valued at oracle prices | `bridge.contract.read.convertToUsd(token, amount)` for each position → sum → format |
| `DemoCard()` → `"+ 2.41% / 24h"` | String literal | `PORTFOLIO_CHANGE_24H` | `bridge.api.stats.getStats()` → 24h portfolio change | Format with sign |
| `DemoCard()` → `"3 strategies"` | String literal | `ACTIVE_STRATEGY_COUNT` | `bridge.api.defiStrategies.getDefiStrategies({owner: address})` | Count of active strategies |

**Key notes:**
- The Ticker `items` array is **function-scoped** (`const items` inside `function Ticker()`). The Babel plugin's `VariableDeclarator` visitor catches ALL `const` declarations matching the `MOCK_CONSTANTS` set, regardless of scope level. Add `"TICKER_ITEMS"` to `MOCK_CONSTANTS`.
- The DemoCard `rows` array is similarly function-scoped. Add `"DEMO_ROWS"` to `MOCK_CONSTANTS`.
- String literals like `"68,412.07"` in JSX cannot be intercepted by the Identifier/VariableDeclarator visitors. **Solution**: The integration layer must also transform these. Extend the Babel plugin with a `JSXAttribute` visitor that detects `<Cipher value="...">` patterns and replaces the value with `window.__MOCK__?.PORTFOLIO_NET_VALUE ?? "68,412.07"`. Without this, landing page demo values remain hardcoded for connected users.
- The landing page **DemoCard** shown to unconnected users is correct with demo data. Real data replacement only applies when `ctx.connected === true`.

**Loading/Error/Empty states:**
- **Loading**: Ticker shows hardcoded fallback values (the Babel `??` operator preserves original values) until stats fetch completes. DemoCard shows demo values until connected.
- **Error**: Same fallback — values remain as hardcoded defaults.
- **Empty (connected, no positions)**: DemoCard shows zeros or "—" via the bridge layer setting window.__MOCK__ values to empty-state equivalents.

### 2. dashboard.jsx

| Mock Location | Mock Data | `__MOCK__` Key | Bridge Source | Shape Mapping |
|---|---|---|---|---|
| Module scope `D_POSITIONS` | 5-item array `[{id, venue, asset, side, amount, apy, liq}, ...]` | `D_POSITIONS` | `bridge.contract.read.getSupplyBalance(addr)`, `bridge.contract.read.getBorrowBalance(addr)`, `bridge.contract.read.getUserPositions(addr)` | Contract raw balances → position objects. Multi-token: iterate all supported tokens from markets list. APY from `bridge.api.markets.getMarkets()` |
| Module scope `D_STRATS` | 3-item array `[{id, name, apy, staked, loops, last}, ...]` | `D_STRATS` | `bridge.api.defiStrategies.getDefiStrategies({owner: address})` | API response → strategy objects. `staked` = formatted supply amount |
| Module scope `D_ACTIVITY` | 6-item array `[{id, block, age, what, kind, asset, delta}, ...]` | `D_ACTIVITY` | `bridge.api.activities.getActivities({userAddress: address})` | API response → activity objects. Each `on_chain_event` maps to kind/what/delta |
| Overview tile: net value `"68,412.07"` | String literal | `PORTFOLIO_NET_VALUE` | Same as landing — sum of position values via oracle | Convert each position to USD, sum, format |
| Overview tile: LTV `"44.8%"` | String literal | `PORTFOLIO_LTV` | `bridge.contract.read` supply/borrow for each token → compute ratio | Weighted LTV = totalBorrowUsd / totalSupplyUsd × 100 |
| Overview tile: Permit state | Dynamic (from ctx) | — | `bridge.fhe.permitCheck()` | Already reactive through `ctx` — no transformation needed |
| Overview tile: Gas `"0.412"` | String literal | `GAS_ETH` | `bridge.api.stats.getStats()` or contract state | Not critical — can remain stub or wire to actual ETH balance |
| LTV gauge value `44.8` | Number literal | `LTV_GAUGE_VALUE` | Computed from contract reads | Float percentage |
| Position tile: interest `"142.08"` | String literal | `POSITION_INTEREST` | `bridge.contract.read` → accrued interest since last action | Format from contract-calculated value |
| "synced 14s ago" | String subtext | `LAST_SYNC_TIME` | Timestamp of last fetch cycle | Relative time string |
| "3 strategies" count | Dynamic from D_STRATS.length | — | Computed automatically from D_STRATS.length | Auto-reactive via array length |

**Key notes:**
- `D_POSITIONS`, `D_STRATS`, `D_ACTIVITY` are **module-scoped `const`** arrays. These are the primary targets for the Babel plugin. Add all three to `MOCK_CONSTANTS`.
- The Cipher components in dashboard use the `locked` prop derived from `ctx.permitUnlocked`. This is already reactive through React's normal state cycle — no intervention needed.
- The overview `Overview` component uses the `locked` prop and mock values. When `window.__MOCK__` updates, the wrapper re-mounts the screen, and component re-evaluates all values from `window.__MOCK__`.

**Loading/Error/Empty states:**
- **Loading**: Original mock data shows (via `??` fallback). The wrapper shows Cipher components in locked state naturally.
- **Error**: Falls back to hardcoded mocks. For connected-user error, the bridge layer can set empty arrays with an error badge.
- **Empty**: Set D_POSITIONS = [] via __MOCK__, Dashboard renders empty master-detail with "No positions" text naturally.

### 3. lending.jsx

| Mock Location | Mock Data | `__MOCK__` Key | Bridge Source | Shape Mapping |
|---|---|---|---|---|
| Module scope `L_MARKETS` | 5-item array `[{asset, supplyApy, borrowApy, util, tvl, liq, oracle, price}, ...]` | `L_MARKETS` | `bridge.api.markets.getMarkets()` | API response → market objects. APYs from env/on-chain, TVL from aggregate, utilization computed |
| "Your position" net supplied `"42,084"` | String literal | `USER_NET_SUPPLIED` | `bridge.contract.read.getSupplyBalance(token)` per token | Sum of all supply balances |
| "Your position" net borrowed `"5.42 ETH"` | String literal | `USER_NET_BORROWED` | `bridge.contract.read.getBorrowBalance(token)` per token | Sum, formatted with dominant asset |
| LTV `"44.8%"` | String literal | `USER_LTV` | Same as dashboard — computed | Weighted LTV |
| Wallet balance `"22,508.30"` | String literal | `WALLET_BALANCE` | `bridge.contract.read` token balance, or wagmi `getBalance` | Actual ERC-20 or native balance for selected asset |
| Summary health after `"2.84"` / `"1.62"` | String literal | `HEALTH_AFTER` | Estimated post-action health from simulation | `bridge.api.defiStrategies.simulateDefiStrategy` or off-chain calc |

**Key notes:**
- `L_MARKETS` is a module-scoped `const` — add to `MOCK_CONSTANTS`.
- The input amount field shows `<Cipher value="22,508.30" locked={locked} size="sm" inline />` — this is a string literal for wallet balance. Extend the Babel JSXAttribute visitor pattern or use the screen wrapper to override.
- The percentage quick-buttons (25%, 50%, 75%, Max) are hardcoded to specific string values in the onClick handler. The bridge layer overrides these via the screen wrapper which intercepts `setAmount` with real wallet balance percentages.

**Loading/Error/Empty states:**
- **Loading**: Markets show hardcoded fallbacks. User position section shows fallback values.
- **Error**: Markets stale-show with last-good data. Position errors show "—" via Cipher locked state.
- **Empty (no wallet)**: The `!ctx.connected` guard shows Connect button. No data fetching attempted.

### 4. market.jsx

| Mock Location | Mock Data | `__MOCK__` Key | Bridge Source | Shape Mapping |
|---|---|---|---|---|
| Module scope `COMMUNITY` | 6-item array `[{id, name, author, risk, apy, tvl, asset, deployers, template}, ...]` | `COMMUNITY` | `bridge.api.strategies.listStrategies()` | API response → community strategy objects. Risk level from on-chain params or tagged | 

**Key notes:**
- `COMMUNITY` is a module-scoped `const` — add to `MOCK_CONSTANTS`.
- Drafts are already persisted to `localStorage` — these are user-owned and should NOT be replaced by bridge data.
- The `TEMPLATES` from `builder-workspace.jsx` are hardcoded factory functions for creating new draft strategies. These are structural templates, not data — they should remain as-is (not mapped to bridge data).

**Loading/Error/Empty states:**
- **Loading**: Community list shows hardcoded entries while API loads.
- **Error**: Falls back to hardcoded community list. Drafts always show from localStorage.
- **Empty**: No community strategies matching filters → shows "No matching strategies" text naturally.

### 5. governance.jsx

| Mock Location | Mock Data | `__MOCK__` Key | Bridge Source | Shape Mapping |
|---|---|---|---|---|
| Module scope `PROPOSALS` | 5-item array `[{id, title, status, body, forVotes, againstVotes, abstain, quorum, timeLeft, proposer}, ...]` | `PROPOSALS` | `bridge.api.governance.listProposals()` (or contract reads via FheForgeGovernor events) | API or contract → proposal objects. Status from contract state enum, vote tallies from events |

**Key notes:**
- `PROPOSALS` is a module-scoped `const` — add to `MOCK_CONSTANTS`.
- Voting: the "Sign & submit" button calls `bridge.api.governance.castVote({proposalId, support, votes})`.
- The connect-gated vote panel already checks `ctx.connected` — no change needed.

**Loading/Error/Empty states:**
- **Loading**: Shows hardcoded proposals as fallback.
- **Error**: Falls back to hardcoded proposals, vote action disabled.
- **Empty (no proposals)**: Set `PROPOSALS = []` → shows empty groups naturally.

### 6. builder-workspace.jsx

| Mock Location | Mock Data | `__MOCK__` Key | Bridge Source | Shape Mapping |
|---|---|---|---|---|
| Module scope `NODE_TYPES` | 5-key object `{supply, borrow, swap, repeat, settle}` | `NODE_TYPES` | `bridge.api.defiModules.getDefiModules()` | API module list → node type definitions. Custom node types from active protocol modules |
| Module scope `TEMPLATES` | 4-key object with node/edge graphs | `TEMPLATES` | Static — structural templates, not data | **Not replaced by bridge**. These are code-level factory shapes for new strategy drafts |
| Module scope `DEFAULT_CONFIG` | Default configs per node type | `DEFAULT_CONFIG` | From default node configs in API or app state | Node default parameters when a new node is placed |
| Simulation trigger | Hardcoded POST path | — | `bridge.api.defiStrategies.simulateDefiStrategy({nodes, edges})` | The call is triggered by the "Simulate" button in the builder workspace |
| Deploy trigger | Hardcoded Composer.openPosition() | — | `bridge.contract.write.openPosition(token, amount, encAmount, strategyId, user, account)` | The deploy button triggers the real contract write |

**Key notes:**
- `NODE_TYPES` is a module-scoped `const` — the key is that the **palette** (available node types shown in the builder) can be dynamically driven by available protocol modules from the API.
- `TEMPLATES` and `DEFAULT_CONFIG` are structural defaults that should remain hardcoded. They provide the initial state for new drafts.
- The builder's simulation and deploy buttons are wired to call bridge adapter methods. These are actions, not display values — handled via the screen wrapper or by the integration layer providing handler overrides.

**Loading/Error/Empty states:**
- **Loading**: Palette shows NODE_TYPES fallback. Drafts load from localStorage.
- **Error**: Palette shows fallback. Simulation/deploy errors shown in the builder's status area.
- **Empty (no drafts)**: Shows the "Pick a draft or fork a template" empty detail naturally.

### 7. connect-modal.jsx

| Mock Location | Mock Data | Bridge Source | Notes |
|---|---|---|---|
| Step 0 wallet selection | 4 hardcoded wallet options | `bridge.wallet.connect(connectorId)` | UI stays the same — `onNext` calls real `bridge.wallet.connect('metamask'|'rabby'|'walletConnect'|'ledger')` |
| Step 1 sign message | Hardcoded mock nonce/message | `bridge.api.auth.getNonce(addr)` → `bridge.wallet.login()` with `wagmiSignMessage` | The "Sign" button calls real signMessage via wagmi → API login → JWT stored |
| Step 2 permit | Hardcoded scope/expires/cost | `bridge.fhe.permitGrant()` via `@cofhe/sdk` | "Grant permit" button calls real SDK permit creation flow |
| Step 3 ready | Success UI | — | Shows on successful permit grant |
| ctx.address | Hardcoded `"0x9f3a2c4b1e0d8f7a6c5b4a39"` | `bridge.wallet.getAccount()` | Real address from wagmi after connect |
| ctx.permitUnlocked | Boolean toggle | `bridge.fhe.permitCheck().unlocked` | Real permit state from SDK |
| ctx.permitSeconds | Countdown from 14*60 | `bridge.fhe.permitCheck().secondsLeft` | Real countdown from SDK |

**Key notes:**
- The `connect-modal.jsx` is the **only screen that needs behavioral changes**, not just data replacement.
- The step transitions (`onNext` callbacks) must call real bridge adapter methods instead of the mock `setCtx` calls.
- **Implementation approach**: Since the connect modal's `onNext` handlers call `setCtx` which is passed in as a prop, and we **cannot modify the source**, the integration layer must override these behaviors. Options:
  1. **Override `setCtx`**: Pass a wrapped `setCtx` that, on certain state transitions, triggers bridge adapter calls
  2. **Screen wrapper intercept**: The wrapper component provides a custom `grantPermit` and `setCtx` that execute bridge operations
  3. **Post-hoc React context overrides**: Use React Context to intercept the `ctx` prop after it's set

  **Recommendation: Option 2** — The screen wrapper for the connect modal provides overridden callbacks that perform real bridge operations and then call the original state updates.

---

## B) Data Flow Architecture

### Layer Design

```
[Bridge Adapters]
     │
     ▼
[DataFetcher Layer]
  ├─ Polls adapters on interval (or on-navigate)
  ├─ One-time fetcher per screen mount
  └─ WebSocket/subscription streams (future)
     │
     ▼
[Transformer Layer]
  ├─ Shape mapping: raw API data → mock-compatible shape
  └─ Formatting: BigInt → readable string, USD formatting, etc.
     │
     ▼
[StateManager Layer]
  ├─ Updates window.__MOCK__[key] = transformedData
  ├─ Triggers window.__BRIDGE__.notify() after all updates
  └─ Handles loading/error/empty fallback logic
     │
     ▼
[Screen Warmers]
  ├─ Watch for __BRIDGE__.onDataUpdate()
  └─ Force re-mount screens with key={dataVersion}
     │
     ▼
[Forge Components render with real data]
```

### Data Fetching Strategies

| Screen | Strategy | Interval | Trigger |
|---|---|---|---|
| Landing (Ticker) | Poll `bridge.api.stats.getStats()` | 30s | On mount + interval |
| Landing (DemoCard) | Fetch on `ctx.connected` change | — | On wallet connect/disconnect |
| Dashboard (positions) | `bridge.contract.read` for each token | On focus/navigate + 60s** | On mount + wallet change |
| Dashboard (strategies) | `bridge.api.defiStrategies.getDefiStrategies({owner})` | On focus/navigate | On mount |
| Dashboard (activity) | `bridge.api.activities.getActivities({userAddress})` | 15s | On mount + interval |
| Lending (markets) | `bridge.api.markets.getMarkets()` | 30s | On mount + interval |
| Market (community) | `bridge.api.strategies.listStrategies()` | On mount | On mount (cached 60s internally) |
| Governance (proposals) | `bridge.api.governance.listProposals()` | On mount | On mount (cached 60s internally) |
| Builder (modules) | `bridge.api.defiModules.getDefiModules()` | On mount | On mount |

**For contract reads (positions), 60s polling is aggressive for on-chain data. Consider using event-driven triggers (transaction receipt → re-fetch) instead of polling, implemented via a pending transaction tracker in the integration layer.

### How `window.__MOCK__` Gets Updated

```javascript
// In bridge-adapter.js (Integration Layer)
const state = {
  dataVersion: 0,
  mockData: {},
  listeners: new Set(),
};

function setMockData(key, value) {
  state.mockData[key] = value;
  window.__MOCK__[key] = value;
}

function notify() {
  state.dataVersion++;
  state.listeners.forEach(fn => fn(state.dataVersion));
}

// ── For each screen, define a fetcher ──

async function fetchDashboardData(address, bridge) {
  // Set loading state (optional — preserves existing mock data via ?? fallback)
  setLoadingIndicator(address);
  
  try {
    // 1. Fetch positions
    const [supplyBalances, borrowBalances, userPositions] = await Promise.all([
      fetchAllSupplies(bridge, address),
      fetchAllBorrows(bridge, address),
      bridge.contract.read.getUserPositions(address).catch(() => []),
    ]);
    
    const positions = transformPositions(supplyBalances, borrowBalances);
    setMockData('D_POSITIONS', positions);
    
    // 2. Fetch strategies
    const stratsResult = await bridge.api.defiStrategies.getDefiStrategies({ owner: address });
    const strategies = transformStrategies(stratsResult.data);
    setMockData('D_STRATS', strategies);
    
    // 3. Fetch activity
    const activityResult = await bridge.api.activities.getActivities({ userAddress: address });
    const activities = transformActivities(activityResult.data);
    setMockData('D_ACTIVITY', activities);
    
    // 4. Fetch portfolio-level values
    const netValue = calculateNetValue(positions, bridge);
    setMockData('PORTFOLIO_NET_VALUE', netValue);
    
    const ltv = calculateLTV(positions);
    setMockData('PORTFOLIO_LTV', ltv);
    setMockData('LTV_GAUGE_VALUE', ltv);
    
    notify(); // Triggers screen re-mount
  } catch (err) {
    console.error('[Bridge] Dashboard fetch failed:', err);
    // Keep existing mock data (?? fallback preserves original values)
    // Only clear if we want to show error state
  }
}
```

### Handling Permit-Gated Reveals

The Cipher component's locked/unlocked state is driven by the `locked` prop, which is derived from `ctx.permitUnlocked`. Since `ctx` is managed by the app's React state and is already reactive, the integration strategy is:

1. **Wallet connection** → `ctx.connected = true` → bridge adapters start fetching data
2. **Data arrives** → `window.__MOCK__[key] = realData` → `notify()` → screen re-mounts
3. **Permit granted** → `ctx.permitUnlocked = true` → `ctx.permitSeconds = 900` → React re-renders all Cipher components → they switch from blurred to plaintext

The integration layer **does not need to manage permit state**. It flows naturally through the existing `ctx` → `locked` → `<Cipher locked={locked}>` chain.

The integration layer's responsibility with respect to permits:
- When `bridge.fhe.permitCheck().unlocked` changes, the `ctx.permitUnlocked` state must be updated
- This happens through the `onPermitChange` listener provided by the FHE adapter:
  ```javascript
  bridge.fhe.onPermitChange(({ unlocked, secondsLeft }) => {
    setCtx(c => ({ ...c, permitUnlocked: unlocked, permitSeconds: secondsLeft }));
  });
  ```

### Wallet Connection State Flow

```
User clicks "Connect" → ConnectModal opens
  → Step 1: User selects wallet
  → Step 2: bridge.wallet.connect(connectorId) → wagmi connect → wallet approves
  → bridge.wallet.login() → GET /auth/nonce/:addr → user signs → POST /auth/wallet-login → JWT stored
  → ctx.connected = true, ctx.address = real address
  → Step 3: bridge.fhe.permitGrant() → @cofhe SDK creates self-permit
  → ctx.permitUnlocked = true, ctx.permitSeconds = 900
  → Step 4: Done → modal closes
  → Integration layer detects ctx.connected === true → starts data fetching
  → window.__MOCK__ populated → screens re-render with real data
```

---

## C) What Stays vs What Goes

### Stays (unchanged, only props/data sources change)

| Component | Current State | After Integration | Notes |
|---|---|---|---|
| `WalletChip` | Receives `address={ctx.address}`, `chain="421614"` | Same props, but `ctx.address` comes from `bridge.wallet.getAccount()` instead of hardcoded mock | The component itself is identical — its parent passes a real address |
| `PermitChip` | Receives `unlocked={ctx.permitUnlocked}`, `secondsLeft={ctx.permitSeconds}` | Same props, values from `bridge.fhe.permitCheck()` | The countdown is already driven by React state — just origin of state changes |
| `Cipher` | Receives `value`, `unit`, `locked`, `size`, `inline` | Same props — values now come from `window.__MOCK__` data, `locked` from permit state | Core component — no changes. Its behavior (blur/plain) is already correct |
| `LtvGauge` | Receives `ltv={44.8}`, `liqAt={80}` | Same props — `ltv` now from computed real data | The gauge rendering (fill %, colors, tick) stays identical |
| `Tag` | Receives `children`, `tone` | Same usage — tone determined dynamically from data state | Pure visual component |
| `AssetGlyph` | Receives `sym`, `size` | Same usage — asset symbols from real data | Pure visual component |
| `Spark` | Receives `points`, `w`, `h`, `color` | Same usage — data from real activity history | Pure visual component |
| `Stat` | Receives `kicker`, `value`, `sub`, `locked`, `size` | Same usage — values from `window.__MOCK__` | Composes Cipher internally |
| `MasterDetail` | Layout shell with `listHeader`, `listBody`, `detailHeader`, `detailBody`, `detailFullBleed` | Same usage — structure driven by real data arrays | Pure layout component |
| `MDItem`, `MDGroup` | List items with `idx`, `title`, `sub`, `right`, `selected`, `onClick` | Same usage — props from real data | Pure list primitives |
| `Modal` | Overlay shell with `open`, `onClose`, `children`, `width` | Same usage | Pure layout component |
| `TopBar` | Nav bar with route buttons, theme toggle, wallet chip, permit chip | Same structure — wallet/permit state from real adapters | Wrapper provides correct props |
| `MobileNav` | Bottom nav for mobile | Unchanged | Static component |
| `ThemeToggle` | Light/dark toggle | Unchanged | Static component |
| `BackgroundOrbits` | SVG animation | Unchanged | Static decorative component |
| All CSS / theme.css | Design tokens, animations, zero-radius | **UNTOUCHED** | No changes to any CSS |
| All Framer Motion animations | Staggered reveal, 150-250ms ease-out | **UNTOUCHED** | Animation timing and easing stay identical |

### Goes (behavioral changes through integration layer, not source modification)

| Mock Behavior | Real Behavior | Integration Mechanism |
|---|---|---|
| `ctx.address = "0x9f3a..."` | `ctx.address = bridge.wallet.getAccount()` | Connect modal wrapper calls real `bridge.wallet.connect()` |
| `ctx.permitUnlocked = true` on click | `ctx.permitUnlocked = true` after `bridge.fhe.permitGrant()` | Grant permit handler in wrapper calls `bridge.fhe.permitGrant()` |
| `connect-modal.jsx` mock steps | Real wagmi connect + JWT login + SDK permit | Screen wrapper intercepts `onNext` callbacks |
| `Ticker` shows hardcoded stats | Shows real protocol stats from `bridge.api.stats.getStats()` | window.__MOCK__.TICKER_ITEMS updated on 30s interval |
| `D_POSITIONS` hardcoded 5 items | Real positions from `bridge.contract.read` | window.__MOCK__.D_POSITIONS updated after contract reads |
| `L_MARKETS` hardcoded 5 markets | Real markets from `bridge.api.markets.getMarkets()` | window.__MOCK__.L_MARKETS updated on 30s interval |
| `COMMUNITY` hardcoded 6 strategies | Real strategies from `bridge.api.strategies.listStrategies()` | window.__MOCK__.COMMUNITY updated on navigation |
| `PROPOSALS` hardcoded 5 proposals | Real proposals from `bridge.api.governance.listProposals()` | window.__MOCK__.PROPOSALS updated on navigation |
| Builder "Simulate" → static result | `bridge.api.defiStrategies.simulateDefiStrategy({nodes, edges})` | Button handler override in screen wrapper |
| Builder "Deploy" → static success | `bridge.contract.write.openPosition(...)` | Button handler override in screen wrapper |

---

## D) Component-Level Integration Detail

### Landing

| Aspect | Current | After Integration |
|---|---|---|
| Props received | `{ setRoute, ctx, grantPermit, openConnect }` | **Unchanged** — same props |
| Ticker data source | `const items = [...]` (function-scoped) | `var items = window.__MOCK__?.TICKER_ITEMS ?? [...]` |
| DemoCard data source | `const rows = [...]` (function-scoped) | `var rows = window.__MOCK__?.DEMO_ROWS ?? [...]` |
| DemoCard net value | `value="68,412.07"` (JSX literal) | `value={window.__MOCK__?.PORTFOLIO_NET_VALUE ?? "68,412.07"}` (via Babel JSXAttribute visitor) |
| Re-render trigger | `ctx.connected` or `demoLocked` state | `ctx.connected` change OR `dataVersion` from bridge notify |
| Components needing NO changes | `BackgroundOrbits`, `Ticker` layout, `DemoCard` structure, all CSS | Everything structural |

### Dashboard

| Aspect | Current | After Integration |
|---|---|---|
| Props received | `{ setRoute, ctx, grantPermit, openConnect }` | **Unchanged** — same props |
| D_POSITIONS source | `const D_POSITIONS = [...]` (module-scoped) | `var D_POSITIONS = window.__MOCK__?.D_POSITIONS ?? [...]` |
| D_STRATS source | `const D_STRATS = [...]` (module-scoped) | `var D_STRATS = window.__MOCK__?.D_STRATS ?? [...]` |
| D_ACTIVITY source | `const D_ACTIVITY = [...]` (module-scoped) | `var D_ACTIVITY = window.__MOCK__?.D_ACTIVITY ?? [...]` |
| Overview tile values | String/number literals | `window.__MOCK__?.PORTFOLIO_NET_VALUE ?? ...` via JSXAttribute visitor |
| LTV gauge value | `ltv={44.8}` | `ltv={window.__MOCK__?.LTV_GAUGE_VALUE ?? 44.8}` via JSXAttribute visitor |
| Re-render trigger | Component mounts, `ctx` change | `ctx` change OR `dataVersion` from bridge → re-mount → identifiers re-evaluated |
| Empty state | `DashboardEmpty` when `!ctx.connected` | **Unchanged** — same guard, same component |
| Components needing NO changes | `Overview`, `PositionDetail`, `StrategyDetail`, `ActivityDetail`, `Tile`, `MasterDetail`, `MDItem`, `MDGroup`, `Tag` | All structural components unchanged |

### Lending

| Aspect | Current | After Integration |
|---|---|---|
| Props received | `{ setRoute, ctx, grantPermit, openConnect }` | **Unchanged** — same props |
| L_MARKETS source | `const L_MARKETS = [...]` (module-scoped) | `var L_MARKETS = window.__MOCK__?.L_MARKETS ?? [...]` |
| User position values | String/number literals | Via `window.__MOCK__` (JSXAttribute visitor) |
| Wallet balance in input | `value="22,508.30"` JSX literal | Via `window.__MOCK__` or screen wrapper intercepts `setAmount` |
| Amount quick-buttons | Hardcoded string values (`"5627"`, `"11254"`, etc.) | Screen wrapper overrides percentage calculations with real wallet balance |
| Re-render trigger | `assetId`, `side`, `amount`, `ltv` state changes | Same + `dataVersion` from bridge |
| Components needing NO changes | `LendAction` form structure, market item display, `AssetGlyph`, `LtvGauge`, all cards | Everything structural |

### Market / Strategies

| Aspect | Current | After Integration |
|---|---|---|
| Props received | `{ setRoute, ctx, grantPermit, openConnect }` | **Unchanged** — same props |
| COMMUNITY source | `const COMMUNITY = [...]` (module-scoped) | `var COMMUNITY = window.__MOCK__?.COMMUNITY ?? [...]` |
| Drafts source | `localStorage` | **Unchanged** — user-owned data |
| TEMPLATES source | Module-scoped structural const | **Unchanged** — structural, not data |
| NODE_TYPES source (in builder-workspace) | `const NODE_TYPES = {...}` (module-scoped) | `var NODE_TYPES = window.__MOCK__?.NODE_TYPES ?? {...}` |
| Re-render trigger | `filter`, `query`, `selectedId`, `drafts` state | Same + `dataVersion` from bridge |
| Components needing NO changes | `BuilderWorkspace` canvas, node rendering, drag/drop, edge drawing, inspector panels | All structural |

### Governance

| Aspect | Current | After Integration |
|---|---|---|
| Props received | `{ setRoute, ctx, grantPermit, openConnect }` | **Unchanged** — same props |
| PROPOSALS source | `const PROPOSALS = [...]` (module-scoped) | `var PROPOSALS = window.__MOCK__?.PROPOSALS ?? [...]` |
| Vote action | Mock state toggle | `bridge.api.governance.castVote({proposalId, support, votes})` via screen wrapper |
| Re-render trigger | `selectedId`, `vote` state | Same + `dataVersion` from bridge |
| Components needing NO changes | `ProposalDetail` structure, tally bars, vote panel layout | All structural |

### Connect Modal

| Aspect | Current | After Integration |
|---|---|---|
| Props received | `{ open, onClose, ctx, setCtx, grantPermit }` | **Unchanged** — but wrapper overrides callbacks |
| Step 1 wallet selection | Mock selection UI | **Unchanged** — UI stays. `onNext` calls `bridge.wallet.connect(wallet)` |
| Step 2 sign message | Mock nonce display | **Unchanged** — UI stays. `onNext` calls `bridge.wallet.login()` → real wagmi sign + API JWT |
| Step 3 permit grant | Mock permit display | **Unchanged** — UI stays. `onNext` calls `bridge.fhe.permitGrant()` → real SDK permit |
| Step 4 ready | Success animation | **Unchanged** |
| Dismiss | Timer-based, calls `onClose` | **Unchanged** |

### Shared Components That Need No Changes

| Component | Reason |
|---|---|
| `Cipher` | Already takes `value`, `locked`, `unit` props. Values change via __MOCK__, `locked` via ctx. No code changes needed |
| `PermitChip` | Already takes `unlocked`, `secondsLeft`, `onClick`. Values come from ctx which is updated by bridge fhe adapter. No code changes |
| `WalletChip` | Already takes `address`, `chain`, `onClick`. Address comes from ctx which is updated by bridge wallet adapter. No code changes |
| `LtvGauge` | Already takes `ltv`, `liqAt` as numbers. Values change via __MOCK__. No code changes |
| `Tag` | Pure presentational. No code changes |
| `AssetGlyph` | Pure presentational. No code changes |
| `Spark` | Pure presentational. No code changes |
| `Stat` | Wraps Cipher. Values change via __MOCK__. No code changes |
| `MasterDetail` | Pure layout. No code changes |
| `MDItem`, `MDGroup` | Pure list primitives. No code changes |
| `Modal` | Pure overlay layout. No code changes |
| `TopBar` | Gets its state from ctx which updates via bridge. No code changes |
| `ThemeToggle` | Static component. No code changes |

---

## Integration Files to Create (No Forge Files Modified)

### 1. `bridge/bridge-babel.js` — Babel.transform monkey-patch
- Loads BEFORE any `text/babel` scripts
- Patches `Babel.transform` to inject a plugin
- Plugin transforms `const CONST_NAME = <value>` → `var CONST_NAME = window.__MOCK__?.CONST_NAME ?? <value>`
- Plugin transforms identifier references to the same pattern
- Plugin transforms `<Cipher value="literal">` JSX attributes to use `window.__MOCK__` lookups
- Exports `window.__MOCK__ = {}` and `window.__BRIDGE__` API

### 2. `bridge/bridge-screen-override.js` — Screen Wrappers
- Wraps `window.Landing`, `window.Dashboard`, `window.Lending`, `window.Market`, `window.Governance`, `window.ConnectModal`
- Each wrapper:
  - Subscribes to `window.__BRIDGE__.onDataUpdate()`
  - Maintains `dataVersion` state
  - Renders original component with `key={dataVersion}` for re-mount
  - For ConnectModal: intercepts `onNext` callbacks to call real bridge adapters

### 3. `bridge/bridge-adapter.js` — Integration Layer
- Creates bridge instance via `createBridge(config)`
- Implements `DataFetcher` with per-screen fetch functions
- Implements `Transformer` with shape mapping functions for each data type
- Implements `StateManager` that updates `window.__MOCK__` and calls `notify()`
- Watches wallet/permit state changes via `bridge.wallet.onChainChange()` and `bridge.fhe.onPermitChange()`
- Starts/stops data fetching based on connection state

### Script Loading Order

```html
<!-- 1. React + ReactDOM -->
<script src="https://unpkg.com/react/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>

<!-- 2. Babel standalone -->
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

<!-- 3. BRIDGE: Babel.transform monkey-patch (before any text/babel scripts) -->
<script src="bridge/bridge-babel.js"></script>

<!-- 4. BRIDGE: screen override wrappers -->
<script src="bridge/bridge-screen-override.js"></script>

<!-- 5. Forge screen scripts (intercepted by patched Babel.transform) -->
<script type="text/babel" src="ui/screens/landing.jsx"></script>
<script type="text/babel" src="ui/screens/dashboard.jsx"></script>
<script type="text/babel" src="ui/screens/lending.jsx"></script>
<script type="text/babel" src="ui/screens/market.jsx"></script>
<script type="text/babel" src="ui/screens/governance.jsx"></script>
<script type="text/babel" src="ui/screens/builder-workspace.jsx"></script>
<script type="text/babel" src="ui/screens/connect-modal.jsx"></script>

<!-- 6. Main app -->
<script type="text/babel" src="ui/app.jsx"></script>
<script type="text/babel" src="ui/components.jsx"></script>

<!-- 7. BRIDGE: integration adapter (fetches data, wires everything) -->
<script src="bridge/bridge-adapter.js"></script>
```

---

## Extended Babel Plugin (Additional Visitors)

The mock-data plugin from the research needs two additional visitors beyond `VariableDeclarator` and `Identifier`:

### JSXAttribute Visitor (for string literals in Cipher)

```javascript
// Additional visitor: Replace string literal values in <Cipher> components
JSXAttribute(path) {
  const name = path.node.name?.name;
  if (name !== 'value') return;
  
  const openingElement = path.parentPath?.parent?.openingElement;
  if (!openingElement) return;
  
  const componentName = openingElement.name?.name;
  if (componentName !== 'Cipher') return;
  
  const attrValue = path.node.value;
  if (!attrValue || attrValue.type !== 'StringLiteral') return;
  
  const literalValue = attrValue.value;
  
  // Map known Cipher value literals to __MOCK__ keys
  const VALUE_TO_MOCK_KEY = {
    '68,412.07': 'PORTFOLIO_NET_VALUE',
    '42,084.13': 'DEMO_SUPPLIED_VALUE',
    '18,910.00': 'DEMO_BORROWED_VALUE',
    '7,418.94': 'DEMO_STRATS_VALUE',
    '42,084': 'USER_NET_SUPPLIED',
    '5.42 ETH': 'USER_NET_BORROWED',
    '22,508.30': 'WALLET_BALANCE',
    '+ 2.41%': 'PORTFOLIO_CHANGE_24H',
    '142.08': 'POSITION_INTEREST',
    '2.84': 'HEALTH_AFTER_SUPPLY',
    '1.62': 'HEALTH_AFTER_BORROW',
    '0.412': 'GAS_ETH',
    '0.00': 'EMPTY_PORTFOLIO',
  };
  
  const mockKey = VALUE_TO_MOCK_KEY[literalValue];
  if (!mockKey) return;
  
  // Replace: value="68,412.07" → value={window.__MOCK__?.PORTFOLIO_NET_VALUE ?? "68,412.07"}
  path.node.value = t.jsxExpressionContainer(
    t.logicalExpression(
      '??',
      t.optionalMemberExpression(
        t.optionalMemberExpression(
          t.identifier('window'),
          t.identifier('__MOCK__'),
          false,
          true
        ),
        t.identifier(mockKey),
        false,
        false
      ),
      t.stringLiteral(literalValue)
    )
  );
}
```

### Alternative: Use `data-mock-key` Data Attributes

A simpler approach than the JSXAttribute visitor: instead of matching every string literal, the bridge screen wrapper could walk the rendered DOM after mount and replace text content based on data attributes. However, this violates the "no forge file modification" constraint since we'd need to add `data-mock-key` attributes to the source.

**Recommendation**: Use the JSXAttribute visitor with a curated `VALUE_TO_MOCK_KEY` map. This is a one-time setup and requires no forge source changes.

---

## Complete MOCK_CONSTANTS Set

```javascript
const MOCK_CONSTANTS = new Set([
  // dashboard.jsx
  'D_POSITIONS', 'D_STRATS', 'D_ACTIVITY',
  // lending.jsx
  'L_MARKETS',
  // market.jsx
  'COMMUNITY',
  // governance.jsx
  'PROPOSALS',
  // builder-workspace.jsx
  'NODE_TYPES', 'TEMPLATES', 'DEFAULT_CONFIG',
  // landing.jsx (function-scoped)
  'TICKER_ITEMS', 'DEMO_ROWS',
]);
```

---

## Data Transformer Functions

Each mock-to-real mapping needs a transformer. Here are the key signatures:

```javascript
// helpers/transformers.js

/** Market data */
function transformMarkets(apiMarkets) {
  return apiMarkets.map((m, i) => ({
    asset: m.symbol || m.token,
    supplyApy: (m.supplyRate || 0) * 100,
    borrowApy: (m.borrowRate || 0) * 100,
    util: Math.round((m.totalBorrows / m.totalSupply) * 100) || 0,
    tvl: formatCompact(m.totalSupplyUsd || 0),
    liq: m.liquidationThreshold || 80,
    oracle: m.oracle || 'Pyth',
    price: formatUsd(m.price || 0),
  }));
}

/** Position data (from contract reads) */
function transformPositions(supplies, borrows, markets) {
  const positions = [];
  
  Object.entries(supplies).forEach(([token, rawAmount]) => {
    const amount = formatAmount(rawAmount, token);
    const market = markets.find(m => m.address === token);
    positions.push({
      id: `pos-${token}-supply`,
      venue: 'Lending Pool',
      asset: token,
      side: 'supply',
      amount,
      apy: `+${market?.supplyApy || 0}%`,
      liq: null,
    });
  });
  
  Object.entries(borrows).forEach(([token, rawAmount]) => {
    const amount = formatAmount(rawAmount, token);
    positions.push({
      id: `pos-${token}-borrow`,
      venue: 'Lending Pool',
      asset: token,
      side: 'borrow',
      amount,
      apy: `−${market?.borrowApy || 0}%`,
      liq: formatUsd(calculateLiquidationPrice(token, rawAmount)),
    });
  });
  
  return positions;
}

/** Activity data (from API) */
function transformActivities(apiActivities) {
  return apiActivities.map((a, i) => ({
    id: `a${i + 1}`,
    block: a.blockNumber,
    age: formatRelativeTime(a.timestamp),
    what: a.description || a.eventType,
    kind: a.action,
    asset: a.tokenSymbol,
    delta: formatDelta(a.amount, a.action),
  }));
}

/** Ticker item strings (from stats API) */
function formatTicker(stats) {
  return [
    `block #${formatBlockNumber(stats.currentBlock || 182944108)}`,
    `gas · ${stats.gasPrice || '0.014'} gwei`,
    `USDC pool tvl · $${stats.usdcPoolTvl || '8.42M'}`,
    `ETH pool tvl · $${stats.ethPoolTvl || '4.18M'}`,
    `WBTC pool tvl · $${stats.wbtcPoolTvl || '1.80M'}`,
    `encrypted ops · ${formatCompact(stats.encryptedOps || 1420000)}`,
    `permit decrypts · ${formatCompact(stats.permitDecrypts || 42000)} / day`,
    `active strategies · ${stats.activeStrategies || 412}`,
    `deployed via composer · ${stats.composerDeploys || 1284}`,
  ];
}
```

---

## Summary of Key Design Decisions

1. **Zero forge file modifications** — 13 ui/ files are immutable. All integration is external via Babel monkey-patching and screen wrappers.

2. **Babel.transform monkey-patch** is the correct approach for module-scoped constants (D_POSITIONS, L_MARKETS, etc.). The plugin transforms declarations and references to use `window.__MOCK__`.

3. **JSXAttribute visitor extension** is required for inline string literals in `<Cipher value="...">` components. A curated `VALUE_TO_MOCK_KEY` map handles the ~14 known string literals.

4. **Screen wrappers with key={dataVersion}** force React to re-mount components when bridge data arrives. This is the only reliable way to re-evaluate module-scoped constants (even after Babel transforms them to var lookups).

5. **ConnectModal is the behavioral exception** — its step transitions must call real bridge adapters instead of mock state changes. The screen wrapper intercepts the `onNext` callbacks.

6. **All shared components are untouched** — Cipher, PermitChip, WalletChip, LtvGauge, MasterDetail, etc. receive the same props with real values.

7. **Cipher locked/unlocked state** flows naturally from ctx, which is updated by `bridge.fhe.onPermitChange()`. The integration layer does not need to manage cipher state.

8. **Data freshness**: Ticker (30s poll), Markets (30s poll), Activity (15s poll), Positions (on-navigate + manual refresh), Strategies (on-navigate), Governance (on-navigate). Contract writes trigger immediate re-fetch via the pending tx tracker.
