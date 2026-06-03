/* ──────────────────────────────────────────────
   DataFetcherV2 — Public/authenticated split polling
   for FheForge integration layer.

   Replaces the Phase 5 DataFetcher with two independent modes:
     - Public mode:  ticker (30s), markets (30s) — starts on page load
     - Auth mode:    activities (15s), positions (60s + on-nav),
                     strategies (on-nav), proposals (on-nav),
                     nodeTypes (on-nav), walletBalance (60s)

   All fetched data is written to BridgeBus via set().
   Errors preserve stale data and record in meta.errors.
   Start/stop methods are idempotent — safe to call multiple times.
   ────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────
     DataFetcherV2
     ────────────────────────────────────────────── */

  /**
   * Add ±10% jitter to a polling interval to prevent thundering herd.
   * @param {number} interval - Base interval in ms
   * @returns {number} Jittered interval
   */
  var jitter = function (interval) {
    return interval * (0.9 + Math.random() * 0.2);
  };

  /**
   * Default polling intervals — created once at module level
   * instead of inside the constructor to avoid reallocation on
   * every DataFetcherV2 instantiation.
   */
  var DEFAULT_INTERVALS = {
    ticker: 30000,
    markets: 30000,
    activities: 15000,
    positions: 60000,
    walletBalance: 60000,
  };

  /**
   * Maps BridgeBus data event names to their window.__MOCK__ key
   * for backward compatibility with the Babel plugin.
   *
   * Used by _fetchAndTransform to write fetched data to __MOCK__
   * alongside BridgeBus — keeps __MOCK__ in sync for live API calls.
   */
  var EVENT_TO_MOCK_KEY = {
    'data:ticker': 'TICKER_ITEMS',
    'data:markets': 'L_MARKETS',
    'data:activities': 'D_ACTIVITY',
    'data:positions': 'D_POSITIONS',
    'data:strategies': 'D_STRATS',
    'data:proposals': 'PROPOSALS',
    'data:nodeTypes': 'NODE_TYPES',
  };

  var DataFetcherV2 = /** @class */ (function () {

    /**
     * @param {Object} [options]
     * @param {Object}   [options.bridge]       - Bridge adapter (defaults to window.bridge)
     * @param {Object}   [options.bus]          - BridgeBus instance (defaults to window.__bridgeBus)
     * @param {Object}   [options.transformers] - Transformer fns (defaults to window.__transformers)
     * @param {Object}   [options.intervals]    - Custom interval overrides in ms
     * @param {number}   [options.intervals.ticker=30000]
     * @param {number}   [options.intervals.markets=30000]
     * @param {number}   [options.intervals.activities=15000]
     * @param {number}   [options.intervals.positions=60000]
     * @param {number}   [options.intervals.walletBalance=60000]
     */
    function DataFetcherV2(options) {
      options = options || {};
      this._bridge = options.bridge || (typeof window !== 'undefined' ? window.bridge : null);
      this._bus = options.bus || (typeof window !== 'undefined' ? window.__bridgeBus : null);
      this._xf = options.transformers || (typeof window !== 'undefined' ? window.__transformers : null);

      // Default intervals (ms) — uses module-level DEFAULT_INTERVALS
      // to avoid recreating the defaults object on every instance.
      var custom = options.intervals || {};
      this._pollIntervals = {};
      for (var k in DEFAULT_INTERVALS) {
        if (DEFAULT_INTERVALS.hasOwnProperty(k)) {
          this._pollIntervals[k] = custom[k] != null ? custom[k] : DEFAULT_INTERVALS[k];
        }
      }

      // Interval tracking — each entry: { name, id }
      this._publicIntervalIds = [];
      this._authIntervalIds = [];

      // Start guards
      this._publicStarted = false;
      this._authStarted = false;
      this._demoStarted = false;

      // beforeunload leak guard — stops all intervals on page unload
      // to prevent ghost polling processes when user refreshes or navigates away
      this._beforeUnloadHandler = function () {
        this.stopAll();
      }.bind(this);
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
      }
    }

    /* ── Public API ──────────────────────────────────────── */

    /**
     * Start public polling: ticker (30s) and markets (30s).
     * Idempotent — safe to call multiple times.
     * Does NOT require wallet connection.
     *
     * If demo mode is already active (startDemoMode was called before),
     * real API polling is skipped to avoid overwriting demo data.
     * Demo mode already provides realistic data for all public endpoints.
     */
    DataFetcherV2.prototype.startPublicPolling = function () {
      if (this._publicStarted) return;
      this._publicStarted = true;

      // If demo mode is active, skip real API polling to prevent
      // async responses from overriding the demo data.
      if (this._demoStarted) return;

      // Fetch immediately on start, then poll at interval
      this._startInterval('public', 'ticker', this._fetchTicker.bind(this), this._pollIntervals.ticker);
      this._startInterval('public', 'markets', this._fetchMarkets.bind(this), this._pollIntervals.markets);
    };

    /**
     * Start authenticated polling:
     *   - activities (15s interval)
     *   - positions  (60s interval + on-nav fetch)
     *   - strategies (on-nav only — no interval)
     *   - proposals  (on-nav only — no interval)
     *   - nodeTypes  (on-nav only — no interval)
     *   - walletBalance (60s interval)
     *
     * Idempotent — safe to call multiple times.
     * Should be called after wallet connect + JWT login + permit grant.
     */
    DataFetcherV2.prototype.startAuthenticatedPolling = function () {
      if (this._authStarted) return;
      this._authStarted = true;

      // Activities — poll every 15s
      this._startInterval('authed', 'activities', this._fetchActivities.bind(this), this._pollIntervals.activities);
      // Positions — poll every 60s (also triggered on navigation separately)
      this._startInterval('authed', 'positions', this._fetchPositions.bind(this), this._pollIntervals.positions);
      // Wallet balance — poll every 60s
      this._startInterval('authed', 'walletBalance', this._fetchWalletBalance.bind(this), this._pollIntervals.walletBalance);

      // On-nav data sources: fetch immediately once (no interval)
      // Navigation handlers call the dedicated fetch methods when screens change
      this._fetchStrategies();
      this._fetchProposals();
      this._fetchNodeTypes();

      // Notify BridgeBus that authenticated mode is active
      if (this._bus) {
        this._bus.enableAuthenticated();
      }
    };

    /**
     * Fetch positions on navigation.
     * Safe to call regardless of auth state — returns early if not started.
     */
    DataFetcherV2.prototype.fetchPositions = function () {
      if (!this._authStarted) return;
      this._fetchPositions();
    };

    /**
     * Fetch strategies on navigation.
     * Safe to call regardless of auth state — returns early if not started.
     */
    DataFetcherV2.prototype.fetchStrategies = function () {
      if (!this._authStarted) return;
      this._fetchStrategies();
    };

    /**
     * Fetch proposals on navigation.
     * Safe to call regardless of auth state — returns early if not started.
     */
    DataFetcherV2.prototype.fetchProposals = function () {
      if (!this._authStarted) return;
      this._fetchProposals();
    };

    /**
     * Fetch node types on navigation.
     * Safe to call regardless of auth state — returns early if not started.
     */
    DataFetcherV2.prototype.fetchNodeTypes = function () {
      if (!this._authStarted) return;
      this._fetchNodeTypes();
    };

    /**
     * Stop authenticated polling and clear authed state.
     * Preserves public data in BridgeBus (VAL-REARCH-DATA-010).
     */
    DataFetcherV2.prototype.stopAuthenticatedPolling = function () {
      this._authStarted = false;
      this._clearIntervalGroup('authed');

      if (this._bus) {
        this._bus.disableAuthenticated();
      }
    };

    /**
     * Stop public polling.
     * Preserves public data in BridgeBus.
     */
    DataFetcherV2.prototype.stopPublicPolling = function () {
      this._publicStarted = false;
      this._clearIntervalGroup('public');
    };

    /**
     * Stop all polling (public + authenticated).
     * Preserves all existing data in BridgeBus.
     * Also removes the beforeunload listener to prevent dangling references.
     */
    DataFetcherV2.prototype.stopAll = function () {
      this.stopPublicPolling();
      this.stopAuthenticatedPolling();

      // Remove beforeunload listener to avoid keeping a reference to this instance
      if (this._beforeUnloadHandler && typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', this._beforeUnloadHandler);
        this._beforeUnloadHandler = null;
      }
    };

    /* ── Demo Mode ──────────────────────────────────────── */

    /**
     * Start demo mode: populate window.__MOCK__ and BridgeBus with
     * realistic synthetic data for ALL mock keys.
     *
     * This ensures the app shows populated data on all screens without
     * needing wallet connection or backend API calls.
     *
     * Demo data:
     *   - Public: ticker, markets (same as public polling response)
     *   - Authenticated: activities, positions, strategies, proposals,
     *                    nodeTypes, walletBalance
     *   - Cipher values: PORTFOLIO_NET_VALUE, LTV, balances, etc.
     *
     * Idempotent — safe to call multiple times.
     */
    DataFetcherV2.prototype.startDemoMode = function () {
      if (this._demoStarted) return;
      this._demoStarted = true;

      // Stop any existing public polling intervals so real API
      // responses don't override the demo data later.
      if (this._publicStarted) {
        this._clearIntervalGroup('public');
      }

      var data = this._generateDemoData();

      // Write to window.__MOCK__ for backward compat
      // (Babel plugin's var X = __MOCK__.X ?? default pattern)
      this._writeMockData(data);

      // Enable authenticated mode on BridgeBus so auth data events flow through
      if (this._bus) {
        this._bus.enableAuthenticated();

        // Public domain events
        if (data.ticker) this._bus.set('data:ticker', data.ticker);
        if (data.markets) this._bus.set('data:markets', data.markets);
        if (data.activities) this._bus.set('data:activities', data.activities);

        // Authed domain events
        if (data.positions) this._bus.set('data:positions', data.positions);
        if (data.strategies) this._bus.set('data:strategies', data.strategies);
        if (data.proposals) this._bus.set('data:proposals', data.proposals);
        if (data.nodeTypes) this._bus.set('data:nodeTypes', data.nodeTypes);
        if (data.walletBalance) this._bus.set('data:walletBalance', data.walletBalance);
      }
    };

    /* ── Demo Data Generation ──────────────────────────── */

    /**
     * Generate realistic synthetic data for all mock keys.
     * Data formats match what the screen components expect,
     * based on the hardcoded defaults in ui/screens/*.jsx.
     *
     * @returns {Object} Plain object with all demo data keys
     */
    DataFetcherV2.prototype._generateDemoData = function () {
      return {
        // ── Ticker ──────────────────────────────────
        ticker: [
          '\u29E7 182,944,108',
          'GAS: 0.014 gwei',
          'TVL: $8.42M',
          'encrypted ops \u00B7 1.42M',
        ],

        // ── Markets (lending.jsx) ────────────────────
        markets: [
          { asset: "USDC", supplyApy: 4.82, borrowApy: 6.21, util: 64, tvl: "8.42M", totalSupply: "8.42M", totalBorrow: "5.39M", liq: 80, oracle: "Pyth", price: "$1.000", icon: "USDC" },
          { asset: "ETH",  supplyApy: 2.14, borrowApy: 3.78, util: 41, tvl: "4.18M", totalSupply: "4.18M", totalBorrow: "1.71M", liq: 75, oracle: "Pyth", price: "$2,544.10", icon: "ETH" },
          { asset: "WBTC", supplyApy: 1.66, borrowApy: 3.10, util: 22, tvl: "1.80M", totalSupply: "1.80M", totalBorrow: "0.40M", liq: 70, oracle: "Pyth", price: "$94,210", icon: "WBTC" },
          { asset: "ARB",  supplyApy: 5.42, borrowApy: 8.20, util: 68, tvl: "0.92M", totalSupply: "0.92M", totalBorrow: "0.63M", liq: 65, oracle: "Pyth \u00B7 fb", price: "$0.74", icon: "ARB" },
          { asset: "DAI",  supplyApy: 3.91, borrowApy: 5.04, util: 51, tvl: "0.61M", totalSupply: "0.61M", totalBorrow: "0.31M", liq: 78, oracle: "Pyth", price: "$1.000", icon: "DAI" },
        ],

        // ── Activities (dashboard.jsx) ───────────────
        activities: [
          { id: "a1", block: 182944108, age: "14s",  what: "S/01 \u00B7 loop iter 3",  kind: "shield",  asset: "USDC",     delta: "+5,200.00" },
          { id: "a2", block: 182944094, age: "47s",  what: "Composer open",       kind: "borrow",  asset: "ETH",      delta: "\u22121.480" },
          { id: "a3", block: 182944081, age: "1m",   what: "Pool \u00B7 interest",     kind: "accrue",  asset: "USDC",     delta: "+12.04" },
          { id: "a4", block: 182943988, age: "4m",   what: "Swap intent filled",  kind: "swap",    asset: "ETH\u2192USDC", delta: "\u22484,820" },
          { id: "a5", block: 182943890, age: "11m",  what: "S/02 \u00B7 re-supply",    kind: "shield",  asset: "WETH",     delta: "+0.840" },
          { id: "a6", block: 182943742, age: "26m",  what: "Permit \u00B7 renewed",    kind: "permit",  asset: "All",     delta: "renewed" },
        ],

        // ── Positions (dashboard.jsx) ────────────────
        positions: [
          { id: "p1", venue: "Lending Pool", asset: "USDC", side: "supply", amount: "42,084.13", apy: "+4.82%", liq: null },
          { id: "p2", venue: "Lending Pool", asset: "ETH",  side: "borrow", amount: "5.420",     apy: "\u22123.14%", liq: "$1,820" },
          { id: "p3", venue: "Vault \u00B7 S/01", asset: "USDC", side: "vault",  amount: "12,840.00", apy: "+11.4%", liq: null },
          { id: "p4", venue: "Vault \u00B7 S/02", asset: "WETH", side: "vault",  amount: "3.205",     apy: "+8.7%",  liq: null },
          { id: "p5", venue: "Vault \u00B7 S/03", asset: "WBTC", side: "vault",  amount: "0.1402",    apy: "+14.2%", liq: null },
        ],

        // ── Strategies (dashboard.jsx) ───────────────
        strategies: [
          { id: "s1", name: "Lean USDC leverage", apy: "+11.4%", staked: "12,840 USDC", loops: 4, last: "2m ago" },
          { id: "s2", name: "ETH delta-neutral",  apy: "+8.7%",  staked: "8,200 USDC",  loops: 3, last: "11m ago" },
          { id: "s3", name: "WBTC carry & swap",  apy: "+14.2%", staked: "4,108 USDC",  loops: 5, last: "1h ago" },
        ],

        // ── Proposals (governance.jsx) ───────────────
        proposals: [
          {
            id: "P-08", title: "WBTC liquidation 75% \u2192 70%",
            status: "active",
            body: "Tightens WBTC liquidation threshold by 500 bps after two near-liquidation events. Affects 18 open positions, recipients pre-notified.",
            forVotes: 412840, againstVotes: 88200, abstain: 12400, quorum: 460000,
            proposer: "@symulacr", created: "2026-05-28",
          },
          {
            id: "P-07", title: "ARB collateral factor 65% \u2192 70%",
            status: "active",
            body: "Increase ARB collateral factor to match on-chain volatility metrics. Risk team recommends +500 bps.",
            forVotes: 328100, againstVotes: 45200, abstain: 8200, quorum: 460000,
            proposer: "@haven", created: "2026-05-25",
          },
          {
            id: "P-06", title: "Stable rate optimiser V2",
            status: "queued",
            body: "Deploy new interest rate curve for USDC and DAI. Smoother ramp between 60\u201380% utilisation.",
            forVotes: 584200, againstVotes: 12100, abstain: 4600, quorum: 460000,
            proposer: "@plux", created: "2026-05-20",
          },
          {
            id: "P-05", title: "Composer whitelist \u2014 StrategyVault",
            status: "executed",
            body: "Grant StrategyVault contract access to Composer for automated loop execution. Audited by Zellic.",
            forVotes: 612400, againstVotes: 8400, abstain: 3200, quorum: 460000,
            proposer: "@quietco", created: "2026-05-15",
          },
          {
            id: "P-04", title: "Fee switch 5/15/30",
            status: "defeated",
            body: "Introduce protocol fee: 5% supply interest, 15% borrow interest, 30% liquidation bonus.",
            forVotes: 184200, againstVotes: 412800, abstain: 24000, quorum: 460000,
            proposer: "@symulacr", created: "2026-05-10",
          },
        ],

        // ── Node Types (builder-workspace.jsx) ───────
        nodeTypes: {
          supply: { label: "Supply",  kicker: "lend",  swatch: "var(--positive)", desc: "Shield ERC-20 into pool" },
          borrow: { label: "Borrow",  kicker: "debt",  swatch: "var(--danger)",   desc: "Encrypted borrowWithLtv" },
          swap:   { label: "Swap",    kicker: "dex",   swatch: "var(--accent)",   desc: "Intent or Uni V3" },
          repeat: { label: "Repeat",  kicker: "loop",  swatch: "var(--ink-2)",    desc: "Composer loop depth" },
          settle: { label: "Settle",  kicker: "fin",   swatch: "var(--ink)",      desc: "Grant ACL, end pipeline" },
        },

        // ── Wallet Balance / Portfolio Metrics ─────
        walletBalance: {
          netValue: "68,412.07",
          portfolioLTV: "30.00",
          ltvGaugeValue: 30,
          balance: "22,508.30",
        },
      };
    };

    /**
     * Write demo data to window.__MOCK__ for backward compatibility
     * with the Babel plugin's mock data interceptors.
     *
     * Writes ALL keys that the Babel plugin's MOCK_CONSTANTS and
     * VALUE_TO_MOCK_KEY mappings expect.
     *
     * @param {Object} data - Demo data from _generateDemoData()
     */
    DataFetcherV2.prototype._writeMockData = function (data) {
      if (typeof window === 'undefined' || !window.__MOCK__) return;

      // MOCK_CONSTANTS (used in VariableDeclarator transformations)
      window.__MOCK__.TICKER_ITEMS = data.ticker;
      window.__MOCK__.L_MARKETS = data.markets;
      window.__MOCK__.D_ACTIVITY = data.activities;
      window.__MOCK__.D_POSITIONS = data.positions;
      window.__MOCK__.D_STRATS = data.strategies;
      window.__MOCK__.PROPOSALS = data.proposals;
      window.__MOCK__.NODE_TYPES = data.nodeTypes;

      // Community strategies (market.jsx) — not in BridgeBus events
      window.__MOCK__.COMMUNITY = [
        { id: "c-lev",  name: "Lean USDC leverage",  author: "@symulacr", risk: "low",  apy: 11.4, tvl: "1,284,210", asset: "USDC", deployers: 412, template: "leverage" },
        { id: "c-dn",   name: "ETH delta-neutral",   author: "@haven",    risk: "med",  apy: 8.7,  tvl: "612,950",   asset: "ETH",  deployers: 188, template: "deltaNeutral" },
        { id: "c-wbtc", name: "WBTC carry & swap",   author: "@symulacr", risk: "high", apy: 14.2, tvl: "402,180",   asset: "WBTC", deployers: 71,  template: "leverage" },
        { id: "c-arb",  name: "ARB incentive sweep", author: "@plux",     risk: "med",  apy: 22.8, tvl: "298,400",   asset: "ARB",  deployers: 240, template: "rebalance" },
        { id: "c-skim", name: "Stable fee skim",     author: "@quietco",  risk: "low",  apy: 5.6,  tvl: "1,840,210", asset: "USDC", deployers: 612, template: "rebalance" },
      ];

      // Builder workspace static data
      window.__MOCK__.TEMPLATES = {
        blank: {
          label: "Blank",
          nodes: [{ id: "n1", type: "settle", x: 40, y: 40, config: {} }],
          edges: [],
        },
        leverage: {
          label: "Leverage loop",
          nodes: [
            { id: "n1", type: "supply", x: 16,  y: 32,  config: { asset: "USDC", amount: "20,000" } },
            { id: "n2", type: "borrow", x: 192, y: 32,  config: { asset: "ETH",  ltv: 65, amount: "8,400" } },
            { id: "n3", type: "swap",   x: 368, y: 32,  config: { from: "ETH", to: "USDC", slip: 0.5 } },
            { id: "n4", type: "repeat", x: 544, y: 32,  config: { loops: 3 } },
          ],
          edges: [
            { from: "n1", to: "n2" },
            { from: "n2", to: "n3" },
            { from: "n3", to: "n4" },
            { from: "n4", to: "n1" },
          ],
        },
        deltaNeutral: {
          label: "Delta neutral",
          nodes: [
            { id: "n1", type: "supply", x: 16,  y: 32,  config: { asset: "ETH", amount: "10,000" } },
            { id: "n2", type: "borrow", x: 192, y: 32,  config: { asset: "USDC", ltv: 50, amount: "5,000" } },
            { id: "n3", type: "swap",   x: 368, y: 32,  config: { from: "USDC", to: "ETH", slip: 0.3 } },
            { id: "n4", type: "settle", x: 544, y: 32,  config: {} },
          ],
          edges: [
            { from: "n1", to: "n2" },
            { from: "n2", to: "n3" },
            { from: "n3", to: "n4" },
          ],
        },
        rebalance: {
          label: "Rebalance",
          nodes: [
            { id: "n1", type: "supply", x: 16,  y: 32,  config: { asset: "USDC", amount: "15,000" } },
            { id: "n2", type: "borrow", x: 192, y: 32,  config: { asset: "ETH",  ltv: 40, amount: "3,600" } },
            { id: "n3", type: "settle", x: 368, y: 32,  config: {} },
          ],
          edges: [
            { from: "n1", to: "n2" },
            { from: "n2", to: "n3" },
          ],
        },
      };
      window.__MOCK__.DEFAULT_CONFIG = {
        supply: { asset: "USDC", amount: "10,000" },
        borrow: { asset: "ETH",  ltv: 50, amount: "4,000" },
        swap:   { from: "ETH", to: "USDC", slip: 0.5, amount: "\u224810,200" },
        repeat: { loops: 3 },
        settle: {},
      };

      // VALUE_TO_MOCK_KEY Cipher values
      window.__MOCK__.PORTFOLIO_NET_VALUE = "68,412.07";
      window.__MOCK__.PORTFOLIO_LTV = "30.00";
      window.__MOCK__.DEMO_SUPPLIED_VALUE = "12,456.78";
      window.__MOCK__.DEMO_BORROWED_VALUE = "4,320.50";
      window.__MOCK__.DEMO_STRATS_VALUE = "228,100";
      window.__MOCK__.USER_NET_SUPPLIED = "42,084";
      window.__MOCK__.USER_NET_BORROWED = "5.42 ETH";
      window.__MOCK__.WALLET_BALANCE = "22,508.30";
      window.__MOCK__.PORTFOLIO_CHANGE_24H = "+2.41%";
      window.__MOCK__.POSITION_INTEREST = "142.08";
      window.__MOCK__.HEALTH_AFTER_SUPPLY = "2.84";
      window.__MOCK__.HEALTH_AFTER_BORROW = "1.62";
      window.__MOCK__.GAS_ETH = "0.412";
      window.__MOCK__.EMPTY_PORTFOLIO = "0.00";

      // Demo rows for landing page
      window.__MOCK__.DEMO_ROWS = [
        ["Supplied", "42,084.13", "USDC"],
        ["Borrowed", "18,910.00", "ETH"],
        ["In strategies", "7,418.94", "USDC"],
      ];
    };

    /* ── Fetch + Transform Pipeline ──────────────────── */

    /**
     * Generic fetch pipeline: call adapter method, transform, write to BridgeBus.
     *
     * If demo mode is active, the fetch is skipped entirely to prevent
     * real API responses from overwriting the demo data.
     *
     * @param {Object} spec
     * @param {Function}        spec.fetch      - Async function returning raw data
     * @param {Function|null}   spec.transform  - Transformer fn(rawData) → shaped data
     * @param {string}          spec.event      - BridgeBus event name (e.g. 'data:ticker')
     * @param {string}          spec.name       - Human-readable source name (for error logging)
     * @returns {Promise<*>} Resolves with the transformed data for chaining
     */
    DataFetcherV2.prototype._fetchAndTransform = function (spec) {
      var self = this;

      // Skip real API calls when demo mode is active to prevent
      // async responses from overwriting the demo data.
      if (this._demoStarted) {
        return Promise.resolve();
      }

      return spec.fetch()
        .then(function (raw) {
          var transformed = spec.transform ? spec.transform(raw) : raw;
          if (self._bus) {
            self._bus.set(spec.event, transformed);
          }
          // Write to window.__MOCK__ for backward compatibility with the
          // Babel plugin's mock interceptor (e.g. var X = __MOCK__.X ?? default).
          // This mirrors what _writeMockData does for demo mode, but for
          // live API data.  The ForgeProvider no longer writes __MOCK__ on
          // data events to avoid redundant double-assignments.
          if (typeof window !== 'undefined' && window.__MOCK__) {
            var mockKey = EVENT_TO_MOCK_KEY[spec.event];
            if (mockKey) {
              window.__MOCK__[mockKey] = transformed;
            }
          }
          return transformed;
        })
        .catch(function (err) {
          self._onError(spec.name, err);
        });
    };

    /**
     * Handle fetch errors: log warning, record in BridgeBus meta.errors.
     * Existing domain data in BridgeBus is preserved (stale-while-revalidate).
     *
     * @param {string} source - Data source name
     * @param {Error}  err    - The error
     */
    DataFetcherV2.prototype._onError = function (source, err) {
      var message = err && err.message ? err.message : String(err);
      console.warn('[DataFetcherV2] Fetch failed for "' + source + '": ' + message);

      if (this._bus) {
        this._bus.set('error:fetch', {
          source: source,
          message: message,
          timestamp: new Date().toISOString(),
        });
      }
    };

    /* ── Bridge Resolution ──────────────────────────── */

    /**
     * Resolve the bridge adapter using the shared `getBridge` utility
     * from get-bridge.js (exposed as window.__getBridge for IIFE consumers).
     *
     * Uses the same shared implementation as connect-interceptor.js to
     * avoid duplicate setInterval retry logic.
     *
     * @returns {Promise<Object>}
     * @throws {Error} If window.__getBridge is not available
     */
    DataFetcherV2.prototype._getBridge = function () {
      if (this._bridge) return Promise.resolve(this._bridge);

      var sharedGetBridge = (typeof window !== 'undefined' && window.__getBridge) || null;

      if (!sharedGetBridge) {
        return Promise.reject(new Error('Shared getBridge utility not available'));
      }

      var self = this;
      return sharedGetBridge(10000, 100).then(function (bridge) {
        self._bridge = bridge;
        return bridge;
      });
    };

    /* ── Individual Fetch Functions ─────────────────── */

    DataFetcherV2.prototype._fetchTicker = function () {
      var self = this;
      return this._fetchAndTransform({
        fetch: function () {
          return self._getBridge().then(function (b) { return b.api.stats.getStats(); });
        },
        transform: function (raw) { return self._xf ? self._xf.formatTicker(raw) : raw; },
        event: 'data:ticker',
        name: 'ticker',
      });
    };

    DataFetcherV2.prototype._fetchMarkets = function () {
      var self = this;
      return this._fetchAndTransform({
        fetch: function () {
          return self._getBridge().then(function (b) { return b.api.markets.getMarkets(); });
        },
        transform: function (raw) { return self._xf ? self._xf.transformMarkets(raw) : raw; },
        event: 'data:markets',
        name: 'markets',
      });
    };

    DataFetcherV2.prototype._fetchActivities = function () {
      var self = this;
      return this._fetchAndTransform({
        fetch: function () {
          return self._getBridge().then(function (b) { return b.api.activities.getActivities(); });
        },
        transform: function (raw) { return self._xf ? self._xf.transformActivities(raw) : raw; },
        event: 'data:activities',
        name: 'activities',
      });
    };

    DataFetcherV2.prototype._fetchPositions = function () {
      var self = this;
      return this._fetchAndTransform({
        fetch: function () {
          return self._getBridge().then(function (b) {
            var addr = b.wallet.getAccount();
            if (!addr) throw new Error('No wallet connected');
            return Promise.all([
              b.contract.read('LendingPool', 'getUserAccounts', [addr]),
              b.api.markets.getMarkets(),
            ]).then(function (results) {
              var accounts = results[0] || {};
              return {
                supplies: accounts.supplies || [],
                borrows: accounts.borrows || [],
                markets: results[1] || [],
              };
            });
          });
        },
        transform: function (raw) {
          if (!self._xf) return raw;
          return self._xf.transformPositions(raw.supplies, raw.borrows, raw.markets);
        },
        event: 'data:positions',
        name: 'positions',
      }).then(function (positions) {
        // Compute portfolio metrics and write walletBalance as a separate side effect.
        // Intentionally outside the transform function to keep it pure.
        if (!self._xf || !self._bus || !positions) return;
        var netValue = self._xf.calculateNetValue(positions);
        var ltv = self._xf.calculateLTV(positions);
        self._bus.set('data:walletBalance', {
          netValue: netValue,
          portfolioLTV: ltv.ratio,
          ltvGaugeValue: ltv.gaugeValue,
          balance: null,
        });
      });
    };

    DataFetcherV2.prototype._fetchStrategies = function () {
      var self = this;
      return this._fetchAndTransform({
        fetch: function () {
          return self._getBridge().then(function (b) { return b.api.defiStrategies.getDefiStrategies({}); });
        },
        transform: function (raw) { return self._xf ? self._xf.transformStrategies(raw) : raw; },
        event: 'data:strategies',
        name: 'strategies',
      });
    };

    DataFetcherV2.prototype._fetchProposals = function () {
      var self = this;
      return this._fetchAndTransform({
        fetch: function () {
          return self._getBridge().then(function (b) { return b.api.governance.listProposals(); });
        },
        transform: function (raw) { return self._xf ? self._xf.transformProposals(raw) : raw; },
        event: 'data:proposals',
        name: 'proposals',
      });
    };

    DataFetcherV2.prototype._fetchNodeTypes = function () {
      var self = this;
      return this._fetchAndTransform({
        fetch: function () {
          return self._getBridge().then(function (b) { return b.api.defiModules.getDefiModules(); });
        },
        transform: function (raw) { return self._xf ? self._xf.transformNodeTypes(raw) : raw; },
        event: 'data:nodeTypes',
        name: 'nodeTypes',
      });
    };

    DataFetcherV2.prototype._fetchWalletBalance = function () {
      var self = this;
      return this._fetchAndTransform({
        fetch: function () {
          return self._getBridge().then(function (b) {
            var addr = b.wallet.getAccount();
            if (!addr) throw new Error('No wallet connected');
            return b.wallet.getBalance(addr);
          });
        },
        transform: function (raw) { return raw; },
        event: 'data:walletBalance',
        name: 'walletBalance',
      });
    };

    /* ── Interval Management ────────────────────────── */

    /**
     * Start polling: immediate first fetch, then setInterval at `ms`.
     * Stores the interval ID for later cleanup.
     *
     * Each fetch callback is wrapped in try/catch to ensure a synchronous
     * throw from one fetch does not cancel subsequent polling ticks.
     * Async rejections are handled by _fetchAndTransform's own .catch().
     *
     * @param {'public'|'authed'} group
     * @param {string}   name - Source name (for debugging)
     * @param {Function} fn   - Async fetch function
     * @param {number}   ms   - Polling interval (0 = no interval, just immediate fetch)
     */
    DataFetcherV2.prototype._startInterval = function (group, name, fn, ms) {
      var self = this;

      /**
       * Wrapped fetch that catches synchronous throws so a single failed
       * callback does not break the interval or subsequent polling ticks.
       * @returns {Promise|undefined}
       */
      function safeFetch() {
        try {
          return fn();
        } catch (err) {
          self._onError(name, err);
          return undefined;
        }
      }

      // Immediate first fetch (wrapped in try/catch)
      safeFetch();

      // Start regular interval if ms > 0
      if (ms > 0) {
        var id = setInterval(safeFetch, jitter(ms));
        var entry = { name: name, id: id };
        if (group === 'public') {
          this._publicIntervalIds.push(entry);
        } else {
          this._authIntervalIds.push(entry);
        }
      }
    };

    /**
     * Clear all intervals in a group.
     * @param {'public'|'authed'} group
     */
    DataFetcherV2.prototype._clearIntervalGroup = function (group) {
      var entries;
      if (group === 'public') {
        entries = this._publicIntervalIds;
        this._publicIntervalIds = [];
      } else {
        entries = this._authIntervalIds;
        this._authIntervalIds = [];
      }
      for (var i = 0; i < entries.length; i++) {
        clearInterval(entries[i].id);
      }
    };

    return DataFetcherV2;
  })();

  /* ──────────────────────────────────────────────
     Export to window scope
     ────────────────────────────────────────────── */

  if (typeof window !== 'undefined') {
    window.DataFetcherV2 = DataFetcherV2;
  }
})();
