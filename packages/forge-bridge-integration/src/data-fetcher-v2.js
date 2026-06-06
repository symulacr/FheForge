/* ──────────────────────────────────────────────
   DataFetcherV2 — Public/authenticated split polling
   for FheForge integration layer.

   Replaces the Phase 5 DataFetcher with two independent modes:
     - Public mode:  ticker (30s), markets (30s) — starts on page load
     - Auth mode:    activities (15s), positions (60s + on-nav),
                     strategies (on-nav), proposals (on-nav),
                     community/templates/nodeTypes (on-nav), walletBalance (60s)

   All fetched data is written to BridgeBus via set().
   Errors preserve stale data and record in meta.errors.
   Start/stop methods are idempotent — safe to call multiple times.
   ────────────────────────────────────────────── */

(() => {
  /* ──────────────────────────────────────────────
     DataFetcherV2
     ────────────────────────────────────────────── */

  // Shared utilities — loaded via script tag (shared-utils.js)
  var _u = (typeof window !== 'undefined' && window.__sharedUtils) || {};

  /**
   * Shorthand for the shared catchDecrypt helper.
   * Captures the bus from the calling instance via closure.
   * @param {Object|null} bus   - BridgeBus instance
   * @param {string}      token - Token address or position ID
   * @returns {(err: Error) => null}
   */
  var _catchDecrypt = function (bus, token) {
    return _u.catchDecrypt
      ? _u.catchDecrypt(bus, token, null)
      : function () { return null; };
  };

  /**
   * Add ±10% jitter to a polling interval to prevent thundering herd.
   * @param {number} interval - Base interval in ms
   * @returns {number} Jittered interval
   */
  var jitter = (interval) => interval * (0.9 + Math.random() * 0.2);

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

  var DataFetcherV2 = /** @class */ (() => {
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
      this._xf =
        options.transformers || (typeof window !== 'undefined' ? window.__transformers : null);

      // Default intervals (ms) — uses module-level DEFAULT_INTERVALS
      // to avoid recreating the defaults object on every instance.
      var custom = options.intervals || {};
      this._pollIntervals = {};
      for (var k in DEFAULT_INTERVALS) {
        if (Object.hasOwn(DEFAULT_INTERVALS, k)) {
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
      this._isFetchingReadiness = false;

      // Concurrency semaphore — caps simultaneous RPC calls to avoid rate limiting
      this._activeFetches = 0;
      this._maxConcurrent = 3;

      // beforeunload leak guard — stops all intervals on page unload
      // to prevent ghost polling processes when user refreshes or navigates away
      this._beforeUnloadHandler = function () {
        this.stopAll();
      }.bind(this);
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
      }

      // Tab visibility handler — pauses polling when tab is hidden to
      // reduce unnecessary API calls and battery/network usage, resumes
      // when tab becomes visible again.
      this._hiddenPaused = false;
      this._visibilityHandler = function () {
        if (typeof document === 'undefined') return;
        if (document.hidden) {
          if (this._publicStarted || this._authStarted) {
            this._hiddenPaused = true;
            this._clearIntervalGroup('public');
            this._clearIntervalGroup('authed');
          }
        } else if (this._hiddenPaused) {
          this._hiddenPaused = false;
          if (this._publicStarted) {
            this._startInterval(
              'public',
              'ticker',
              this._fetchTicker.bind(this),
              this._pollIntervals.ticker,
            );
            this._startInterval(
              'public',
              'markets',
              this._fetchMarkets.bind(this),
              this._pollIntervals.markets,
            );
          }
          if (this._authStarted) {
            this._startInterval(
              'authed',
              'activities',
              this._fetchActivities.bind(this),
              this._pollIntervals.activities,
            );
            this._startInterval(
              'authed',
              'positions',
              this._fetchPositions.bind(this),
              this._pollIntervals.positions,
            );
            this._startInterval(
              'authed',
              'walletBalance',
              this._fetchWalletBalance.bind(this),
              this._pollIntervals.walletBalance,
            );
          }
        }
      }.bind(this);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this._visibilityHandler);
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

      // Fetch backend readiness once on start, then fetch immediately on start and poll at interval.
      this._fetchReadiness();
      this._startInterval(
        'public',
        'ticker',
        this._fetchTicker.bind(this),
        this._pollIntervals.ticker,
      );
      this._startInterval(
        'public',
        'markets',
        this._fetchMarkets.bind(this),
        this._pollIntervals.markets,
      );

      // Proposals are public data — fetch on public polling too
      this._fetchProposals();

      // Community, templates, and nodeTypes are NOT fetched here —
      // those endpoints (/strategies, /defi-strategies, /defi-modules)
      // require JWT auth. They are fetched in startAuthenticatedPolling().
    };

    /**
     * Start authenticated polling:
     *   - activities (15s interval)
     *   - positions  (60s interval + on-nav fetch)
     *   - strategies (on-nav only — no interval)
     *   - proposals  (on-nav only — no interval)
     *   - community  (on-nav only — no interval)
     *   - templates   (on-nav only — no interval)
     *   - nodeTypes   (on-nav only — no interval)
     *   - walletBalance (60s interval)
     *
     * Idempotent — safe to call multiple times.
     * Should be called after wallet connect + JWT login + permit grant.
     */
    DataFetcherV2.prototype.startAuthenticatedPolling = function () {
      if (this._authStarted) return;
      this._authStarted = true;

      // Activities — poll every 15s
      this._startInterval(
        'authed',
        'activities',
        this._fetchActivities.bind(this),
        this._pollIntervals.activities,
      );
      // Positions — poll every 60s (also triggered on navigation separately)
      this._startInterval(
        'authed',
        'positions',
        this._fetchPositions.bind(this),
        this._pollIntervals.positions,
      );
      // Wallet balance — poll every 60s
      this._startInterval(
        'authed',
        'walletBalance',
        this._fetchWalletBalance.bind(this),
        this._pollIntervals.walletBalance,
      );

      // On-nav data sources: fetch immediately once (no interval)
      // Navigation handlers call the dedicated fetch methods when screens change
      this._fetchStrategies();
      this._fetchProposals();
      this._fetchCommunity();
      this._fetchTemplates();
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

      // Remove visibility change listener
      if (this._visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        this._visibilityHandler = null;
      }
      this._hiddenPaused = false;
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
        if (data.community) this._bus.set('data:community', data.community);
        if (data.templates) this._bus.set('data:templates', data.templates);
        if (data.nodeTypes) this._bus.set('data:nodeTypes', data.nodeTypes);
        if (data.walletBalance) this._bus.set('data:walletBalance', data.walletBalance);
      }
    };

    /* ── Demo Data Generation ──────────────────────────── */

    /**
     * Return the canonical demo data set.
     * Source: demo-data.js (loaded as a script tag before this file).
     *
     * @returns {Object} Plain object with all demo data keys
     */
    DataFetcherV2.prototype._generateDemoData = () => {
      var dd = typeof window !== 'undefined' && window.__demoData;
      return dd ? dd.DEMO_DATA : {};
    };

    /**
     * Write demo data to window.__MOCK__ for backward compatibility
     * with the Babel plugin's mock data interceptors.
     *
     * Uses a data-driven loop over MOCK_KEY_MAP, CIPHER_VALUES,
     * DEFAULT_CONFIG, and DEMO_ROWS exported by demo-data.js.
     *
     * @param {Object} data - Demo data from _generateDemoData()
     */
    DataFetcherV2.prototype._writeMockData = function (data) {
      if (typeof window === 'undefined' || !window.__MOCK__) return;

      var dd = window.__demoData || {};

      // MOCK_CONSTANTS — loop over key→__MOCK__ property mapping
      var keyMap = dd.MOCK_KEY_MAP || {};
      var keys = Object.keys(keyMap);
      for (var i = 0; i < keys.length; i++) {
        var dataKey = keys[i];
        window.__MOCK__[keyMap[dataKey]] = data[dataKey];
      }

      // Static builder config
      window.__MOCK__.DEFAULT_CONFIG = dd.DEFAULT_CONFIG || {};

      // Scalar cipher values (VALUE_TO_MOCK_KEY)
      var ciphers = dd.CIPHER_VALUES || {};
      var cipherKeys = Object.keys(ciphers);
      for (var j = 0; j < cipherKeys.length; j++) {
        window.__MOCK__[cipherKeys[j]] = ciphers[cipherKeys[j]];
      }

      // Demo rows for landing page
      window.__MOCK__.DEMO_ROWS = dd.DEMO_ROWS || [];
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
    DataFetcherV2.prototype._unwrapApiResult = (result, source) =>
      _u.unwrapResult ? _u.unwrapResult(result, source) : result;

    DataFetcherV2.prototype._fetchAndTransform = function (spec) {
      // Skip real API calls when demo mode is active to prevent
      // async responses from overwriting the demo data.
      if (this._demoStarted) {
        return Promise.resolve();
      }

      // Concurrency guard — drop the fetch if too many are in flight
      if (this._activeFetches >= this._maxConcurrent) {
        return Promise.resolve();
      }
      this._activeFetches++;

      var self = this;
      return spec
        .fetch()
        .then((raw) => {
          var payload = self._unwrapApiResult(raw, spec.name);
          var transformed = spec.transform ? spec.transform(payload) : payload;
          if (self._bus) {
            self._bus.set(spec.event, transformed);
          }
          // Live fetches write only to BridgeBus. __MOCK__ remains a demo-mode
          // compatibility surface and must not be mutated by real data polling.
          return transformed;
        })
        .catch((err) => {
          self._onError(spec.name, err);
        })
        .finally(function () {
          self._activeFetches--;
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
      var message = err?.message ? err.message : String(err);
      console.warn(`[DataFetcherV2] Fetch failed for "${source}": ${message}`);

      if (this._bus) {
        this._bus.set('error:fetch', {
          source: source,
          message: message,
          timestamp: new Date().toISOString(),
        });
      }

      if (this._publicStarted && source !== 'readiness') {
        this._fetchReadiness();
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

      return sharedGetBridge(10000, 100).then((bridge) => {
        this._bridge = bridge;
        return bridge;
      });
    };

    /**
     * Resolve optional contract read helpers from both supported bridge shapes:
     *   - b.contract.read.getUserPositions(...)
     *   - b.contract.strategyVault.getUserPositions(...)
     *
     * @param {Object} bridge
     * @param {string} helper
     * @returns {Function|null}
     */
    DataFetcherV2.prototype._getContractReadHelper = (bridge, helper) => {
      if (!bridge?.contract) return null;
      if (bridge.contract.read && typeof bridge.contract.read[helper] === 'function') {
        return bridge.contract.read[helper].bind(bridge.contract.read);
      }
      if (helper === 'getUserPositions' && typeof bridge.contract.read === 'function') {
        return (addr) => bridge.contract.read('LendingPool', 'getUserAccounts', [addr]);
      }
      if (
        bridge.contract.strategyVault &&
        typeof bridge.contract.strategyVault[helper] === 'function'
      ) {
        return bridge.contract.strategyVault[helper].bind(bridge.contract.strategyVault);
      }
      if (
        bridge.contract.lendingPool &&
        typeof bridge.contract.lendingPool[helper] === 'function'
      ) {
        return bridge.contract.lendingPool[helper].bind(bridge.contract.lendingPool);
      }
      return null;
    };

    /**
     * Return an empty real-data position payload with explicit status.
     * @param {string} status
     * @param {string} reason
     * @param {Array} markets
     * @returns {{ supplies: Array, borrows: Array, vaultPositions: Array, markets: Array, status: string, reason: string }}
     */
    DataFetcherV2.prototype._emptyPositionsPayload = (status, reason, markets) => ({
      supplies: [],
      borrows: [],
      vaultPositions: [],
      markets: Array.isArray(markets) ? markets : [],
      status: status,
      reason: reason,
    });

    /* ── Individual Fetch Functions ─────────────────── */

    DataFetcherV2.prototype._normalizeReadinessResult = (result, source) => {
      var raw = _u.unwrapResult ? _u.unwrapResult(result, source) : result;
      if (result && typeof result === 'object' && result.status === 'error') {
        var errObj = result.error;
        return {
          status: 'error',
          data: null,
          error: errObj?.message ? errObj.message : String(errObj || (source + ' request failed')),
        };
      }
      return { status: 'success', data: raw, error: null };
    };

    DataFetcherV2.prototype._fetchReadiness = function () {
      if (this._isFetchingReadiness) {
        return Promise.resolve();
      }

      this._isFetchingReadiness = true;
      return this._fetchAndTransform({
        fetch: () =>
          this._getBridge().then((b) => {
            var systemReady = b.api?.system && (b.api.system.getReady || b.api.system.getReadiness);
            var marketsStatus = b.api?.markets?.getStatus;
            return Promise.all([
              systemReady
                ? systemReady.call(b.api.system)
                : Promise.resolve({ status: 'unavailable', data: null, error: null }),
              marketsStatus
                ? marketsStatus.call(b.api.markets)
                : Promise.resolve({ status: 'unavailable', data: null, error: null }),
            ]).then((results) => ({
              ready: this._normalizeReadinessResult(results[0], 'backend readiness'),
              markets: this._normalizeReadinessResult(results[1], 'markets status'),
              checkedAt: new Date().toISOString(),
            }));
          }),
        transform: null,
        event: 'data:readiness',
        name: 'readiness',
      }).finally(() => {
        this._isFetchingReadiness = false;
      });
    };

    DataFetcherV2.prototype._fetchTicker = function () {
      return this._fetchAndTransform({
        fetch: () => this._getBridge().then((b) => b.api.stats.getStats()),
        transform: (raw) => (this._xf ? this._xf.formatTicker(raw) : raw),
        event: 'data:ticker',
        name: 'ticker',
      });
    };

    DataFetcherV2.prototype._fetchMarkets = function () {
      return this._fetchAndTransform({
        fetch: () => this._getBridge().then((b) => b.api.markets.getMarkets()),
        transform: (raw) => (this._xf ? this._xf.transformMarkets(raw) : raw),
        event: 'data:markets',
        name: 'markets',
      });
    };

    DataFetcherV2.prototype._fetchActivities = function () {
      return this._fetchAndTransform({
        fetch: () => this._getBridge().then((b) => b.api.activities.getActivities()),
        transform: (raw) => (this._xf ? this._xf.transformActivities(raw) : raw),
        event: 'data:activities',
        name: 'activities',
      });
    };

    DataFetcherV2.prototype._fetchPositions = function () {
      return this._fetchAndTransform({
        fetch: () =>
          this._getBridge().then((b) => {
            var getAccount = b.wallet && typeof b.wallet.getAccount === 'function'
              ? b.wallet.getAccount.bind(b.wallet) : () => null;
            var addr;
            try { addr = _u.requireConnected ? _u.requireConnected(getAccount) : getAccount(); }
            catch (_) { return this._emptyPositionsPayload('locked', 'No wallet connected', []); }

            // Check if getLendableTokens is available — needed to enumerate positions
            var getLendableTokens = this._getContractReadHelper(b, 'getLendableTokens');
            if (!getLendableTokens) {
              return (
                b.api?.markets && typeof b.api.markets.getMarkets === 'function'
                  ? b.api.markets.getMarkets().catch(() => [])
                  : Promise.resolve([])
              ).then((markets) =>
                this._emptyPositionsPayload(
                  'unavailable',
                  'No getLendableTokens helper available on bridge contract adapter',
                  markets,
                ),
              );
            }

            var getSupplyBalance = this._getContractReadHelper(b, 'getSupplyBalance');
            var getBorrowBalance = this._getContractReadHelper(b, 'getBorrowBalance');
            if (!getSupplyBalance || !getBorrowBalance) {
              return this._emptyPositionsPayload(
                'unavailable',
                'Balance read helpers not available on bridge contract adapter',
                [],
              );
            }

            // Check FHE permit state
            var permitUnlocked =
              b.fhe && typeof b.fhe.permitCheck === 'function' && b.fhe.permitCheck().unlocked;

            return Promise.all([
              Promise.all([
                getLendableTokens().catch(() => []),
                b.api?.markets && typeof b.api.markets.getMarkets === 'function'
                  ? b.api.markets.getMarkets().catch(() => [])
                  : Promise.resolve([]),
              ]),
            ]).then((res) => {
              var tokens = res[0][0];
              var markets = res[0][1] || [];
              var tokenList = Array.isArray(tokens)
                ? tokens
                : tokens && tokens.length > 0
                  ? Array.from(tokens)
                  : [];

              if (tokenList.length === 0) {
                return this._emptyPositionsPayload(
                  'empty',
                  'No lendable tokens registered',
                  markets,
                );
              }

              // Fetch supply and borrow balances via multicall (single RPC batch)
              var getAllBalances =
                b.contract && typeof b.contract.getAllBalances === 'function'
                  ? b.contract.getAllBalances.bind(b.contract)
                  : this._getContractReadHelper(b, 'getAllBalances');
              var balancePromise;
              if (getAllBalances) {
                balancePromise = getAllBalances(tokenList).then((mcResults) => mcResults);
              } else {
                // Fallback to per-token reads
                const balancePromises = [];
                for (let i = 0; i < tokenList.length; i++) {
                  balancePromises.push(
                    Promise.allSettled([
                      getSupplyBalance(tokenList[i]),
                      getBorrowBalance(tokenList[i]),
                    ]).then((settled) => ({ settled: settled })),
                  );
                }
                balancePromise = Promise.all(balancePromises);
              }

              return balancePromise.then((results) => {
                const supplies = [];
                const borrows = [];

                for (let j = 0; j < tokenList.length; j++) {
                  const tkn = tokenList[j];
                  let supplyHandle, borrowHandle;

                  if (getAllBalances) {
                    // Multicall: results are [supply0, borrow0, supply1, borrow1, ...]
                    const sResult = results[j * 2];
                    const bResult = results[j * 2 + 1];
                    supplyHandle = sResult?.success ? sResult.result : null;
                    borrowHandle = bResult?.success ? bResult.result : null;
                  } else {
                    // Per-token: results[j].settled is [supplySettled, borrowSettled]
                    const settled = results[j].settled;
                    supplyHandle = settled[0].status === 'fulfilled' ? settled[0].value : null;
                    borrowHandle = settled[1].status === 'fulfilled' ? settled[1].value : null;
                  }

                  if (permitUnlocked && supplyHandle) {
                    supplies.push(
                      b.fhe
                        .decrypt(supplyHandle)
                        .then((plaintext) => ({ token: tkn, plaintext: plaintext }))
                        .catch(_catchDecrypt(this._bus, tkn)),
                    );
                  } else if (supplyHandle) {
                    supplies.push(Promise.resolve({ token: tkn, encrypted: supplyHandle }));
                  }

                  if (permitUnlocked && borrowHandle) {
                    borrows.push(
                      b.fhe
                        .decrypt(borrowHandle)
                        .then((plaintext) => ({ token: tkn, plaintext: plaintext }))
                        .catch(_catchDecrypt(this._bus, tkn)),
                    );
                  } else if (borrowHandle) {
                    borrows.push(Promise.resolve({ token: tkn, encrypted: borrowHandle }));
                  }
                }

                return Promise.all([Promise.all(supplies), Promise.all(borrows)]).then(
                  (resolved) => {
                    var rawSupplies = resolved[0];
                    var rawBorrows = resolved[1];

                    // Filter out zero balances when decrypted
                    var filteredSupplies = rawSupplies.filter(
                      (s) => !s.plaintext || s.plaintext !== '0',
                    );
                    var filteredBorrows = rawBorrows.filter(
                      (b) => !b.plaintext || b.plaintext !== '0',
                    );

                    // Fetch vault positions via multicall (single RPC batch)
                    var getUserPositions = this._getContractReadHelper(b, 'getUserPositions');
                    var getAllPositionData =
                      b.contract && typeof b.contract.getAllPositionData === 'function'
                        ? b.contract.getAllPositionData.bind(b.contract)
                        : this._getContractReadHelper(b, 'getAllPositionData');
                    var getPosMeta = this._getContractReadHelper(b, 'getPositionMeta');
                    var getCollateral = this._getContractReadHelper(b, 'getCollateral');

                    var vaultPromise;
                    if (getUserPositions && getAllPositionData) {
                      vaultPromise = getUserPositions(addr)
                        .catch(() => [])
                        .then((positionIds) => {
                          if (!positionIds || positionIds.length === 0) return [];
                          return getAllPositionData(positionIds).then((mcResults) => {
                            const rawVault = [];
                            for (let pi = 0; pi < positionIds.length; pi++) {
                              const pid = positionIds[pi];
                              const metaResult = mcResults[pi * 2];
                              const collResult = mcResults[pi * 2 + 1];
                              const meta = metaResult?.success ? metaResult.result : null;
                              const collateral = collResult?.success ? collResult.result : null;
                              if (permitUnlocked && collateral) {
                                rawVault.push(
                                  b.fhe
                                    .decrypt(collateral)
                                    .catch(_catchDecrypt(this._bus, 'vault:' + pid))
                                    .then((plain) => ({
                                      id: pid,
                                      strategyId: meta?.strategyId || 0,
                                      createdAt: meta?.createdAt || 0,
                                      collateral: plain,
                                      collateralEncrypted: collateral,
                                      venue: 'Vault',
                                      side: 'vault',
                                    })),
                                );
                              } else {
                                rawVault.push(
                                  Promise.resolve({
                                    id: pid,
                                    strategyId: meta?.strategyId || 0,
                                    createdAt: meta?.createdAt || 0,
                                    collateral: null,
                                    collateralEncrypted: collateral,
                                    venue: 'Vault',
                                    side: 'vault',
                                  }),
                                );
                              }
                            }
                            return Promise.all(rawVault);
                          });
                        })
                        .then((rawVault) => rawVault.filter((p) => p !== null));
                    } else if (getUserPositions && getPosMeta && getCollateral) {
                      // Fallback to per-position reads
                      vaultPromise = getUserPositions(addr)
                        .catch(() => [])
                        .then((positionIds) => {
                          if (!positionIds || positionIds.length === 0) return [];
                          const posPromises = [];
                          for (let pi = 0; pi < positionIds.length; pi++) {
                            ((pid) => {
                              posPromises.push(
                                Promise.all([getPosMeta(pid), getCollateral(pid)])
                                  .then((res) => {
                                    const meta = res[0],
                                      collateral = res[1];
                                    if (permitUnlocked && collateral) {
                                      return b.fhe
                                        .decrypt(collateral)
                                        .catch(_catchDecrypt(this._bus, 'vault:' + pid))
                                        .then((plain) => ({
                                          id: pid,
                                          strategyId: meta?.strategyId || 0,
                                          createdAt: meta?.createdAt || 0,
                                          collateral: plain,
                                          collateralEncrypted: collateral,
                                          venue: 'Vault',
                                          side: 'vault',
                                        }));
                                    }
                                    return {
                                      id: pid,
                                      strategyId: meta?.strategyId || 0,
                                      createdAt: meta?.createdAt || 0,
                                      collateral: null,
                                      collateralEncrypted: collateral,
                                      venue: 'Vault',
                                      side: 'vault',
                                    };
                                  })
                                  .catch(() => null),
                              );
                            })(positionIds[pi]);
                          }
                          return Promise.all(posPromises);
                        })
                        .then((rawVault) => rawVault.filter((p) => p !== null));
                    } else {
                      vaultPromise = Promise.resolve([]);
                    }

                    return vaultPromise.then((vaultPositions) => {
                      if (
                        filteredSupplies.length === 0 &&
                        filteredBorrows.length === 0 &&
                        vaultPositions.length === 0
                      ) {
                        return this._emptyPositionsPayload(
                          'empty',
                          'No non-zero positions found',
                          markets,
                        );
                      }
                      return {
                        supplies: filteredSupplies,
                        borrows: filteredBorrows,
                        vaultPositions: vaultPositions,
                        markets: markets,
                        status: permitUnlocked ? 'ok' : 'locked',
                      };
                    });
                  },
                );
              });
            });
          }),
        transform: (raw) => {
          if (
            raw &&
            (raw.status === 'locked' ||
              raw.status === 'empty' ||
              raw.status === 'unavailable' ||
              raw.status === 'error')
          ) {
            return {
              items: [],
              status: raw.status,
              reason: raw.reason,
              vaultPositions: raw.vaultPositions || [],
            };
          }
          if (!this._xf) return raw;
          // Build address→decimals map for wei→decimal conversion
          // Uses shared TOKEN_DECIMAL_MAP from ui/utils/token-utils.js when available.
          var TOKEN_DECIMALS = (typeof window !== 'undefined' && window.TOKEN_DECIMAL_MAP) || { ETH: 18, WETH: 18, USDC: 6, USDT: 6, WBTC: 8, PPGS: 8 };
          var _decByAddr = {};
          (Array.isArray(raw.markets) ? raw.markets : []).forEach(function (m) {
            var sym = m.asset || m.symbol;
            var addr = (m.assetAddress || m.address || '').toLowerCase();
            if (sym && addr) _decByAddr[addr] = TOKEN_DECIMALS[sym] || 18;
          });
          function _toDecimal(plaintext, tokenAddr) {
            if (plaintext == null) return null;
            var dec = _decByAddr[String(tokenAddr || '').toLowerCase()] || 18;
            return Number(plaintext) / Math.pow(10, dec);
          }
          var shapedSupplies = (raw.supplies || []).map((s) => ({
            asset: s.token,
            amount: _toDecimal(s.plaintext, s.token),
            tokenAddress: s.token,
          }));
          var shapedBorrows = (raw.borrows || []).map((b) => ({
            asset: b.token,
            amount: _toDecimal(b.plaintext, b.token),
            tokenAddress: b.token,
          }));
          var result = this._xf.transformPositions(shapedSupplies, shapedBorrows, raw.markets);
          if (result && typeof result === 'object' && raw.vaultPositions) {
            result.vaultPositions = raw.vaultPositions;
          }
          return result;
        },
        event: 'data:positions',
        name: 'positions',
      }).then((positions) => {
        // Compute portfolio metrics and write walletBalance as a separate side effect.
        // Intentionally outside the transform function to keep it pure.
        if (!this._xf || !this._bus || !positions) return;
        var positionItems = Array.isArray(positions) ? positions : positions.items;
        var netValue = this._xf.calculateNetValue(positionItems);
        var ltv = this._xf.calculateLTV(positionItems);
        var previousWalletBalance = null;
        if (this._bus && typeof this._bus.getState === 'function') {
          previousWalletBalance = this._bus.getState().authed.walletBalance;
        }
        this._bus.set('data:walletBalance', {
          balance:
            previousWalletBalance && previousWalletBalance.balance != null
              ? previousWalletBalance.balance
              : null,
          nativeBalanceWei: previousWalletBalance?.nativeBalanceWei || null,
          asset: previousWalletBalance?.asset,
          netValue: netValue,
          portfolioLTV: ltv.ratio,
          ltvGaugeValue: ltv.gaugeValue,
        });
      });
    };

    DataFetcherV2.prototype._fetchStrategies = function () {
      return this._fetchAndTransform({
        fetch: () => this._getBridge().then((b) => b.api.defiStrategies.getDefiStrategies({})),
        transform: (raw) => (this._xf ? this._xf.transformStrategies(raw) : raw),
        event: 'data:strategies',
        name: 'strategies',
      });
    };

    DataFetcherV2.prototype._fetchProposals = function () {
      return this._fetchAndTransform({
        fetch: () => this._getBridge().then((b) => b.api.governance.listProposals()),
        transform: (raw) => (this._xf ? this._xf.transformProposals(raw) : raw),
        event: 'data:proposals',
        name: 'proposals',
      });
    };

    DataFetcherV2.prototype._fetchCommunity = function () {
      return this._fetchAndTransform({
        fetch: () =>
          this._getBridge().then((b) => {
            if (b.api?.strategies && typeof b.api.strategies.listStrategies === 'function') {
              return b.api.strategies.listStrategies({});
            }
            throw new Error('Community strategies endpoint not available');
          }),
        transform: (raw) => (this._xf ? this._xf.transformCommunity(raw) : raw),
        event: 'data:community',
        name: 'community',
      });
    };

    DataFetcherV2.prototype._fetchTemplates = function () {
      return this._fetchAndTransform({
        fetch: () =>
          this._getBridge().then((b) => {
            if (b.api?.defiTemplates && typeof b.api.defiTemplates.getTemplates === 'function') {
              return b.api.defiTemplates.getTemplates();
            }
            if (b.api?.defiStrategies && typeof b.api.defiStrategies.getTemplates === 'function') {
              return b.api.defiStrategies.getTemplates();
            }
            return null;
          }),
        transform: (raw) => raw,
        event: 'data:templates',
        name: 'templates',
      });
    };

    DataFetcherV2.prototype._fetchNodeTypes = function () {
      return this._fetchAndTransform({
        fetch: () => this._getBridge().then((b) => b.api.defiModules.getDefiModules()),
        transform: (raw) => (this._xf ? this._xf.transformNodeTypes(raw) : raw),
        event: 'data:nodeTypes',
        name: 'nodeTypes',
      });
    };

    DataFetcherV2.prototype._fetchWalletBalance = function () {
      return this._fetchAndTransform({
        fetch: () =>
          this._getBridge().then((b) => {
            var getAccount = b.wallet && typeof b.wallet.getAccount === 'function'
              ? b.wallet.getAccount.bind(b.wallet) : () => null;
            var addr = _u.requireConnected
              ? _u.requireConnected(getAccount)
              : (function () { var a = getAccount(); if (!a) throw new Error('No wallet connected'); return a; })();
            if (typeof b.wallet.getBalance !== 'function') {
              throw new Error('Wallet balance helper not available');
            }
            return b.wallet.getBalance(addr);
          }),
        transform: (raw) => {
          var previousWalletBalance = null;
          if (this._bus && typeof this._bus.getState === 'function') {
            previousWalletBalance = this._bus.getState().authed.walletBalance;
          }
          return {
            balance:
              typeof raw === 'bigint'
                ? (Number(raw) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 6 })
                : String(raw),
            nativeBalanceWei: String(raw),
            asset: 'ETH',
            netValue: previousWalletBalance?.netValue || null,
            portfolioLTV: previousWalletBalance?.portfolioLTV || null,
            ltvGaugeValue: previousWalletBalance?.ltvGaugeValue,
          };
        },
        event: 'data:walletBalance',
        name: 'walletBalance',
      });
    };

    DataFetcherV2.prototype.refreshAfterTransaction = function () {
      this._fetchTicker();
      this._fetchMarkets();
      if (this._authStarted) {
        this._fetchPositions();
        this._fetchWalletBalance();
        this._fetchActivities();
      }
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
      var _inFlight = null;
      function safeFetch() {
        if (_inFlight) return _inFlight;  // skip if previous tick still running
        try {
          var p = fn();
          if (p && typeof p.then === 'function') {
            _inFlight = p.finally(function() { _inFlight = null; });
          }
          return p;
        } catch (err) {
          self._onError(name, err);
          return undefined;
        }
      }

      // Immediate first fetch (wrapped in try/catch)
      safeFetch();

      // Start regular interval if ms > 0
      if (ms > 0) {
        const id = setInterval(safeFetch, jitter(ms));
        const entry = { name: name, id: id };
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
      let entries;
      if (group === 'public') {
        entries = this._publicIntervalIds;
        this._publicIntervalIds = [];
      } else {
        entries = this._authIntervalIds;
        this._authIntervalIds = [];
      }
      for (let i = 0; i < entries.length; i++) {
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
