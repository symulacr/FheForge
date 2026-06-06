# Validation Contract — Phase 5: Forge Frontend Integration

## Area: ABI Extraction

### VAL-INTEGRATION-ABI-001: `abis.js` exists at expected path

- **Behavioral description**: The file `packages/forge-bridge/src/abis.js` must exist as a static ES module.
- **Tool**: `file-exists`
- **Evidence requirements**: Verify the file exists at `packages/forge-bridge/src/abis.js`. Confirm it is a regular file with `type: "module"` compatible export syntax (static `export` statements, no dynamic `import()` calls).

### VAL-INTEGRATION-ABI-002: `CONTRACT_ABIS` export contains all 9 contract entries

- **Behavioral description**: `abis.js` must export a `CONTRACT_ABIS` record mapping every deployed contract name to its ABI array. The 9 required keys are: `LendingPool`, `StrategyVault`, `Composer`, `SwapRouter`, `PriceOracle`, `StrategyRegistry`, `StrategyExecutor`, `TokenRegistry`, `ExecutorContract`.
- **Tool**: `file-content`
- **Evidence requirements**: Parse the ES module exports from `abis.js`. Confirm `CONTRACT_ABIS` is exported. Assert that `Object.keys(CONTRACT_ABIS)` contains exactly those 9 strings (no missing, no extras). Each value must be a non-null object.

### VAL-INTEGRATION-ABI-003: `CONTRACT_ADDRESSES` export contains all 9 deployed addresses

- **Behavioral description**: `abis.js` must export a `CONTRACT_ADDRESSES` record with the same 9 contract names mapped to their `0x`-prefixed Arbitrum Sepolia addresses. The addresses must match the values listed in the deployed contract manifest (see `contract.js`).
- **Tool**: `file-content`
- **Evidence requirements**: Parse the ES module and verify `CONTRACT_ADDRESSES` is exported. Assert each key has a string value matching `/^0x[a-fA-F0-9]{40}$/`. Verify addresses match the known deployed values (LendingPool: `0x2e04961e0d4448FeeeA5b23593eC81C1C9A2cD2a`, StrategyVault: `0xe9486B12261D02BeB236355934981d49c5697fb3`, etc.).

### VAL-INTEGRATION-ABI-004: Each ABI is a valid, non-empty viem-compatible array

- **Behavioral description**: For every entry in `CONTRACT_ABIS`, the ABI value must be a `import('viem').Abi`-compatible array with at least 1 entry. Each entry must have a `type` field (typically `"function"`, `"event"`, `"error"`). At least one entry per contract must have `type: "function"`.
- **Tool**: `file-content` + `terminal-output` (via Node.js import)
- **Evidence requirements**: Write a small verification script that:
  1. Static-imports `CONTRACT_ABIS` from `abis.js`
  2. Iterates all entries
  3. Asserts each is `Array.isArray()` and `length > 0`
  4. Asserts each entry has a `type` field that is one of `"function"`, `"event"`, `"error"`, `"constructor"`, `"fallback"`, `"receive"`
  5. Asserts `CONTRACT_ABIS[key].filter(e => e.type === "function").length >= 1`

### VAL-INTEGRATION-ABI-005: `contract.js` imports from `abis.js` instead of dynamic `contracts/out/` imports

- **Behavioral description**: The file `contract.js` must import `CONTRACT_ABIS` and `CONTRACT_ADDRESSES` from `./abis.js` (a sibling module). It must NOT contain dynamic `import()` calls referencing `contracts/out/*.json` paths or any `importForgeAbi()` dynamic loader pattern.
- **Tool**: `file-content`
- **Evidence requirements**: Search `contract.js` for:
  1. A static import line matching `import { CONTRACT_ABIS, CONTRACT_ADDRESSES } from "./abis.js"` (or similar)
  2. Zero occurrences of `import("../../../contracts/out/`
  3. Zero occurrences of `importForgeAbi`
  4. No dynamic `import()` calls (except possibly the simulation/API imports which are unrelated)

### VAL-INTEGRATION-ABI-006: `abis.js` has zero Node.js or filesystem dependencies

- **Behavioral description**: The `abis.js` module must be statically analyzable and loadable in a browser CDN context. It must contain no `import` of Node.js builtins (`fs`, `path`, `url`, `process`), no dynamic `import()` expressions, and no `require()` calls.
- **Tool**: `file-content`
- **Evidence requirements**: Read `abis.js` and confirm:
  1. All imports are static `import ... from "./..."` or `import ... from "package-name"`
  2. No string literal contains `"fs"`, `"path"`, `"process"`, `"child_process"`, `"module"`
  3. No `require(` call present
  4. No `import(` dynamic expression present
  5. The file can be loaded in a browser context (no top-level `window` references that would crash in SSR—if present, must be guarded by `typeof window !== "undefined"`)

### VAL-INTEGRATION-ABI-007: ABI array content matches compiled `contracts/out/*.json` sources

- **Behavioral description**: For each contract in `CONTRACT_ABIS`, the ABI array must be a deep (structural) subset of the corresponding `contracts/out/{Contract}.sol/{Contract}.json` compiled output's `"abi"` field. Every function signature and event in the exported ABI must exist in the compiled output.
- **Tool**: `terminal-output`
- **Evidence requirements**: Run a verification script that:
  1. Reads each `contracts/out/*.sol/*.json` file
  2. Extracts its `abi` array
  3. Imports `CONTRACT_ABIS` from `abis.js`
  4. For each contract key, asserts that `abis.js` ABI is a "subset" of the compiled ABI (every element in the exported ABI must deep-equal an element in the compiled ABI). Alternatively, verify that function signatures (name + inputs) from the exported ABI are found in the compiled ABI.

### VAL-INTEGRATION-ABI-008: ABI entries include FHE-specific types (`euint128`, `ebool`)

- **Behavioral description**: Because FheForge is an FHE-encrypted protocol, the contract ABIs must include FHE-specific parameter types (`euint128`, `ebool`) in function signatures. At least the LendingPool and StrategyVault ABIs should contain entries with `"internalType"` or `"type"` containing `"euint128"` or `"ebool"`.
- **Tool**: `file-content` + `terminal-output`
- **Evidence requirements**: Parse `CONTRACT_ABIS.LendingPool` and `CONTRACT_ABIS.StrategyVault`. For each, find function entries and inspect their `inputs` array. Assert that at least one input has a `type` or `internalType` matching `euint128` or `ebool` (case-insensitive). If no FHE types are found, this is a regression from the compiled Forge output.

---

## Area: Scaffold (forge-bridge-integration)

### VAL-INTEGRATION-SCAFFOLD-001: `packages/forge-bridge-integration/` directory exists with expected file structure

- **Behavioral description**: The scaffold package directory must exist at `packages/forge-bridge-integration/` and contain at minimum: `bridge-babel.js`, `bridge-screen-override.js`, `bridge-adapter.js`. Optionally may include `package.json`, `README.md`.
- **Tool**: `file-exists`
- **Evidence requirements**: List the contents of `packages/forge-bridge-integration/`. Confirm the three core files exist. Their paths must be:
  - `packages/forge-bridge-integration/bridge-babel.js`
  - `packages/forge-bridge-integration/bridge-screen-override.js`
  - `packages/forge-bridge-integration/bridge-adapter.js`

### VAL-INTEGRATION-SCAFFOLD-002: `bridge-babel.js` monkey-patches `Babel.transform` before any `text/babel` scripts load

- **Behavioral description**: The file must wrap itself in an IIFE that checks `typeof Babel !== "undefined"`, saves `Babel.transform`, replaces it with a wrapper that injects the mock-data plugin into the `options.plugins` array, and calls the original transform. It must also import `@babel/types` from `Babel.packages.types` for AST construction.
- **Tool**: `file-content`
- **Evidence requirements**: Read `bridge-babel.js` and verify:
  1. The file body is wrapped in an IIFE: `(function() { ... })();` or equivalent
  2. It checks `typeof Babel === 'undefined'` and guards with a console.error fallback
  3. It captures `const origTransform = Babel.transform;` (or `var`)
  4. It assigns `Babel.transform = function(code, options) { ... }` that prepends a plugin to `options.plugins`
  5. It calls `origTransform.call(this, code, options)` at the end

### VAL-INTEGRATION-SCAFFOLD-003: `VariableDeclarator` visitor transforms `const X = val` to `var X = window.__MOCK__?.X ?? val`

- **Behavioral description**: The `mockDataPlugin` must contain a `VariableDeclarator` visitor that: checks if the declared identifier is in `MOCK_CONSTANTS`, changes the parent `VariableDeclaration` kind from `"const"` to `"var"`, and wraps the initializer in a `LogicalExpression` (`??`) with an `OptionalMemberExpression` accessing `window.__MOCK__?.X`.
- **Tool**: `file-content`
- **Evidence requirements**: Read the plugin definition in `bridge-babel.js` and verify:
  1. A `visitor.VariableDeclarator` function is defined
  2. It accesses `path.node.id?.name` and checks membership in `MOCK_CONSTANTS`
  3. It calls `path.findParent(p => p.isVariableDeclaration())` to get the parent declaration
  4. It sets `parentDecl.node.kind = 'var'`
  5. It sets `path.node.init` to a `t.logicalExpression('??', ...)` with a `t.optionalMemberExpression` accessing `window.__MOCK__.{name}`

### VAL-INTEGRATION-SCAFFOLD-004: `Identifier` visitor replaces references with `window.__MOCK__` lookups

- **Behavioral description**: The plugin must contain an `Identifier` visitor that checks if the identifier name is in `MOCK_CONSTANTS` and if it is a referenced identifier (`path.isReferencedIdentifier()`). It replaces the node with a `LogicalExpression` (`??`) that reads from `window.__MOCK__?.X` with the original identifier as fallback.
- **Tool**: `file-content`
- **Evidence requirements**: Read the plugin and verify:
  1. A `visitor.Identifier` function is defined
  2. It checks `MOCK_CONSTANTS.has(path.node.name)`
  3. It calls `path.isReferencedIdentifier()` (or `path.isReferencedIdentifier() || path.isJSXIdentifier()`)
  4. It calls `path.replaceWith(...)` with a `t.logicalExpression('??', ...)` accessing `window.__MOCK__?.{name}` with fallback to the original `t.identifier(path.node.name)`

### VAL-INTEGRATION-SCAFFOLD-005: `JSXAttribute` visitor transforms `<Cipher value="lit">` to use `window.__MOCK__` lookup

- **Behavioral description**: The plugin must contain a `JSXAttribute` visitor that: checks if the attribute name is `"value"`, verifies the parent JSX element is `<Cipher>`, checks the value is a `StringLiteral`, looks up the literal in a `VALUE_TO_MOCK_KEY` map, and replaces the attribute value with a `JSXExpressionContainer` containing a `LogicalExpression` (`??`) reading from `window.__MOCK__?.KEY`.
- **Tool**: `file-content`
- **Evidence requirements**: Read the plugin and verify:
  1. A `visitor.JSXAttribute` function is defined
  2. It checks `path.node.name?.name === 'value'`
  3. It navigates to `path.parentPath?.parent?.openingElement` and checks `openingElement.name?.name === 'Cipher'`
  4. It checks `attrValue.type === 'StringLiteral'`
  5. It uses a `VALUE_TO_MOCK_KEY` map (or inline object) to look up the string literal
  6. It sets `path.node.value` to `t.jsxExpressionContainer(...)` wrapping a `t.logicalExpression('??', ...)`

### VAL-INTEGRATION-SCAFFOLD-006: `VALUE_TO_MOCK_KEY` map covers known string literals from all 6 screens

- **Behavioral description**: The `VALUE_TO_MOCK_KEY` object (or equivalent mapping) must contain entries for all documented `<Cipher value="...">` string literals across all screens. Minimum required entries (from the Phase 5 plan):
  - `"68,412.07"` → `PORTFOLIO_NET_VALUE`
  - `"42,084.13"` → `DEMO_SUPPLIED_VALUE`
  - `"18,910.00"` → `DEMO_BORROWED_VALUE`
  - `"7,418.94"` → `DEMO_STRATS_VALUE`
  - `"42,084"` → `USER_NET_SUPPLIED`
  - `"5.42 ETH"` → `USER_NET_BORROWED`
  - `"22,508.30"` → `WALLET_BALANCE`
  - `"+ 2.41%"` → `PORTFOLIO_CHANGE_24H`
  - `"142.08"` → `POSITION_INTEREST`
  - `"2.84"` → `HEALTH_AFTER_SUPPLY`
  - `"1.62"` → `HEALTH_AFTER_BORROW`
  - `"0.412"` → `GAS_ETH`
  - `"0.00"` → `EMPTY_PORTFOLIO`
  - `"44.8%"` → `PORTFOLIO_LTV`
- **Tool**: `file-content`
- **Evidence requirements**: Parse the `VALUE_TO_MOCK_KEY` definition (can be a `const` object, a `Map`, or inline in the JSXAttribute visitor). Assert that at least 12 of the 14 documented entries are present (to allow minor variance while maintaining coverage). Each entry must map a string literal to a valid `__MOCK__` key in `SCREAMING_SNAKE_CASE`.

### VAL-INTEGRATION-SCAFFOLD-007: `MOCK_CONSTANTS` set includes all 11 module-scoped and function-scoped constants

- **Behavioral description**: The `MOCK_CONSTANTS` Set must contain every constant name documented in the Phase 5 plan:
  - `D_POSITIONS`, `D_STRATS`, `D_ACTIVITY` (dashboard.jsx — module-scoped)
  - `L_MARKETS` (lending.jsx — module-scoped)
  - `COMMUNITY` (market.jsx — module-scoped)
  - `PROPOSALS` (governance.jsx — module-scoped)
  - `NODE_TYPES`, `TEMPLATES`, `DEFAULT_CONFIG` (builder-workspace.jsx — module-scoped)
  - `TICKER_ITEMS`, `DEMO_ROWS` (landing.jsx — function-scoped)
- **Tool**: `file-content`
- **Evidence requirements**: Parse the `MOCK_CONSTANTS` definition. Assert it is a `Set` (or array that gets converted). Assert all 11 strings are present. If any are missing, the Babel plugin will not intercept those declarations, causing them to remain hardcoded.

### VAL-INTEGRATION-SCAFFOLD-008: `window.__MOCK__` and `window.__BRIDGE__` API are exposed globally

- **Behavioral description**: After `bridge-babel.js` executes, the following globals must be available:
  1. `window.__MOCK__` — an object (initially `{}`) that will hold mock data overrides
  2. `window.__BRIDGE__` — an API object with:
     - `setMockData(key, value)` — sets `__MOCK__[key] = value`
     - `getMockData(key)` — returns `__MOCK__?.[key]`
     - `onDataUpdate(fn)` — registers a listener, returns unsubscribe function
     - `notify()` — calls all registered listeners
     - `_listeners` — a `Set` of listener functions
- **Tool**: `file-content` (and optionally `terminal-output` via Node.js with jsdom)
- **Evidence requirements**: Read `bridge-babel.js` and verify:
  1. `window.__MOCK__ = {}` or equivalent initialization
  2. `window.__BRIDGE__ = { ... }` with all the required methods
  3. `onDataUpdate` returns an unsubscribe function
  4. `notify` iterates `this._listeners` and calls each function

### VAL-INTEGRATION-SCAFFOLD-009: `bridge-screen-override.js` wraps every screen component with a data-version-aware wrapper

- **Behavioral description**: The screen override file must define wrappers for at minimum: `Landing`, `Dashboard`, `Lending`, `Market`, `Governance`, `ConnectModal` (and optionally `BuilderWorkspace`). Each wrapper must:
  1. Subscribe to `window.__BRIDGE__.onDataUpdate()`
  2. Maintain a `dataVersion` state (via React `useState` or closure counter)
  3. Render the original screen component with `key={dataVersion}` to force re-mount on data update
  4. Pass through all original props (`setRoute`, `ctx`, `grantPermit`, `openConnect`)
- **Tool**: `file-content`
- **Evidence requirements**: Read `bridge-screen-override.js` and verify:
  1. At least 6 screen wrappers are defined
  2. Each wrapper subscribes to bridge data updates
  3. Each uses `key={dataVersion}` (or equivalent key-changing mechanism)
  4. All original props are forwarded to the wrapped component

### VAL-INTEGRATION-SCAFFOLD-010: ConnectModal wrapper intercepts `onNext` callbacks for real bridge operations

- **Behavioral description**: The ConnectModal screen wrapper must override the step transition callbacks to call real bridge adapter methods instead of mock state changes. Specifically:
  - Step 0→1 (wallet selection): calls `bridge.wallet.connect(connectorId)`
  - Step 1→2 (sign message): calls `bridge.wallet.login()` → real wagmi signMessage + API JWT
  - Step 2→3 (permit grant): calls `bridge.fhe.permitGrant()` → real SDK permit
  - Step 3→4 (ready): proceeds to ready state
- **Tool**: `file-content`
- **Evidence requirements**: Read the ConnectModal wrapper section and verify:
  1. The wrapper intercepts `onNext` (or equivalent step callback)
  2. Wallet selection step triggers `bridge.wallet.connect()`
  3. Sign step triggers `bridge.wallet.login()`
  4. Permit step triggers `bridge.fhe.permitGrant()`
  5. The real adapter calls are followed by `setCtx` to update React state

### VAL-INTEGRATION-SCAFFOLD-011: `bridge-adapter.js` implements `DataFetcher`, `Transformer`, `StateManager` layers

- **Behavioral description**: The integration adapter must contain three distinct logical layers:
  1. **DataFetcher**: Per-screen fetch functions that call bridge adapter methods (wallet, api, contract, fhe) and return raw data
  2. **Transformer**: Shape-mapping functions that transform raw API/contract data into mock-compatible shapes (e.g., `transformPositions()`, `transformMarkets()`, `transformActivities()`, `formatTicker()`)
  3. **StateManager**: Functions that update `window.__MOCK__[key] = transformedData` and then call `notify()` to trigger screen re-mounts
- **Tool**: `file-content`
- **Evidence requirements**: Read `bridge-adapter.js` and verify:
  1. Functions like `fetchDashboardData`, `fetchLandingData`, `fetchLendingData`, `fetchMarketData`, `fetchGovernanceData`, `fetchBuilderData` exist
  2. Transformer functions matching the documented shapes exist (at minimum: `transformPositions`, `transformMarkets`, `transformActivities`, `formatTicker`)
  3. `setMockData(key, value)` calls that update `window.__MOCK__` followed by a `notify()` call

### VAL-INTEGRATION-SCAFFOLD-012: Each screen has correct data fetching strategy (polling interval and triggers)

- **Behavioral description**: The `DataFetcher` must implement the polling/trigger strategy from the plan:
  - Landing (Ticker): polls `bridge.api.stats.getStats()` every 30s
  - Landing (DemoCard): fetches on `ctx.connected` change (event-driven)
  - Dashboard (positions): contract reads on mount + wallet change
  - Dashboard (activity): polls `bridge.api.activities.getActivities()` every 15s
  - Lending (markets): polls `bridge.api.markets.getMarkets()` every 30s
  - Market (community): fetches on mount (cached 60s)
  - Governance (proposals): fetches on mount (cached 60s)
  - Builder (modules): fetches on mount
- **Tool**: `file-content`
- **Evidence requirements**: Read each fetch function's implementation and verify:
  1. Polling functions use `setInterval` (or equivalent) with the documented interval values
  2. On-mount fetchers are triggered by screen wrapper initialization
  3. Event-driven fetchers respond to `ctx.connected` changes
  4. Contract read functions use the correct bridge adapter method names (e.g., `bridge.contract.read.getSupplyBalance`)

### VAL-INTEGRATION-SCAFFOLD-013: Failed fetches gracefully fall back to preserved mock data

- **Behavioral description**: Each fetch function must wrap its operations in try/catch. On failure (network error, contract revert, API error), the error must be logged via `console.error` but the `window.__MOCK__` values must NOT be cleared—the existing values (hardcoded fallbacks from the Babel transform's `??` operator) remain visible. Optionally, an error badge or indicator can be set.
- **Tool**: `file-content`
- **Evidence requirements**: Read the fetch functions in `bridge-adapter.js` and verify:
  1. Each fetch function has a `try/catch` block
  2. The `catch` branch calls `console.error` with a descriptive message
  3. The `catch` branch does NOT overwrite `window.__MOCK__` with `null`/`undefined`/empty
  4. (Optional) There is an error indicator mechanism (e.g., setting `window.__MOCK__.__ERROR__ = true`)

### VAL-INTEGRATION-SCAFFOLD-014: `NODE_TYPES` and `TEMPLATES` are in `MOCK_CONSTANTS` but `TEMPLATES` is NOT replaced by bridge data

- **Behavioral description**: Per the design, `NODE_TYPES` and `TEMPLATES` are both in `MOCK_CONSTANTS` so the Babel plugin transforms their declarations. However, `TEMPLATES` must NOT be overwritten by bridge data—it is structural (factory functions for new strategy drafts). The bridge adapter must only set `window.__MOCK__.NODE_TYPES` (from `bridge.api.defiModules.getDefiModules()`) and must NOT set `window.__MOCK__.TEMPLATES`. `DEFAULT_CONFIG` is similarly structural and must not be overwritten.
- **Tool**: `file-content`
- **Evidence requirements**: 
  1. Verify `MOCK_CONSTANTS` includes `NODE_TYPES`, `TEMPLATES`, `DEFAULT_CONFIG`
  2. Verify `bridge-adapter.js` has a `setMockData('NODE_TYPES', ...)` call for builder data
  3. Verify there is NO `setMockData('TEMPLATES', ...)` or `setMockData('DEFAULT_CONFIG', ...)` call
  4. The only structural constant that SHOULD be replaced is `NODE_TYPES`

### VAL-INTEGRATION-SCAFFOLD-015: Script loading order documentation is defined and correct

- **Behavioral description**: The integration package must document (in a README, package.json `"scripts"`, or inline comment) the required script loading order:
  1. React + ReactDOM (unpkg CDN)
  2. Babel standalone (unpkg CDN)
  3. `bridge-babel.js` (must load BEFORE any `text/babel` script)
  4. `bridge-screen-override.js`
  5. Forge screen scripts (`<script type="text/babel" ...>`)
  6. Main app scripts
  7. `bridge-adapter.js` (loads LAST, after all components are registered)
- **Tool**: `file-content`
- **Evidence requirements**: Find documentation of the loading order (in README.md, inline comments, or a LOADING_ORDER.md). Verify that:
  1. `bridge-babel.js` loads before any `text/babel` scripts
  2. `bridge-adapter.js` loads after all screen scripts
  3. The rationale for each position is explained (monkey-patch must be active before transforms; adapter must load after components are registered on `window`)
