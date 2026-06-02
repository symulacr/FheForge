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

      // Default intervals (ms)
      var defaults = {
        ticker: 30000,
        markets: 30000,
        activities: 15000,
        positions: 60000,
        walletBalance: 60000,
      };
      var custom = options.intervals || {};
      this._pollIntervals = {};
      for (var k in defaults) {
        if (defaults.hasOwnProperty(k)) {
          this._pollIntervals[k] = custom[k] != null ? custom[k] : defaults[k];
        }
      }

      // Interval tracking — each entry: { name, id }
      this._publicIntervalIds = [];
      this._authIntervalIds = [];

      // Start guards
      this._publicStarted = false;
      this._authStarted = false;
    }

    /* ── Public API ──────────────────────────────────────── */

    /**
     * Start public polling: ticker (30s) and markets (30s).
     * Idempotent — safe to call multiple times.
     * Does NOT require wallet connection.
     */
    DataFetcherV2.prototype.startPublicPolling = function () {
      if (this._publicStarted) return;
      this._publicStarted = true;

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
     */
    DataFetcherV2.prototype.stopAll = function () {
      this.stopPublicPolling();
      this.stopAuthenticatedPolling();
    };

    /* ── Fetch + Transform Pipeline ──────────────────── */

    /**
     * Generic fetch pipeline: call adapter method, transform, write to BridgeBus.
     *
     * @param {Object} spec
     * @param {Function}        spec.fetch      - Async function returning raw data
     * @param {Function|null}   spec.transform  - Transformer fn(rawData) → shaped data
     * @param {string}          spec.event      - BridgeBus event name (e.g. 'data:ticker')
     * @param {string}          spec.name       - Human-readable source name (for error logging)
     * @returns {Promise<void>}
     */
    DataFetcherV2.prototype._fetchAndTransform = function (spec) {
      var self = this;
      return spec.fetch()
        .then(function (raw) {
          var transformed = spec.transform ? spec.transform(raw) : raw;
          if (self._bus) {
            self._bus.set(spec.event, transformed);
          }
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
     * Resolve the bridge adapter, retrying if not yet loaded.
     * @returns {Promise<Object>}
     */
    DataFetcherV2.prototype._getBridge = function () {
      var self = this;
      if (this._bridge) return Promise.resolve(this._bridge);

      return new Promise(function (resolve, reject) {
        var retries = 0;
        var check = setInterval(function () {
          self._bridge = (typeof window !== 'undefined' ? window.bridge : null);
          if (self._bridge) {
            clearInterval(check);
            resolve(self._bridge);
          } else if (++retries > 20) {
            clearInterval(check);
            reject(new Error('Bridge adapter not loaded'));
          }
        }, 100);
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
          var positions = self._xf.transformPositions(raw.supplies, raw.borrows, raw.markets);

          // Also compute portfolio metrics and write to walletBalance
          var netValue = self._xf.calculateNetValue(positions);
          var ltv = self._xf.calculateLTV(positions);

          if (self._bus) {
            // Write positions
            self._bus.set('data:positions', positions);
            // Write wallet balance with portfolio metrics
            self._bus.set('data:walletBalance', {
              netValue: netValue,
              portfolioLTV: ltv.ratio,
              ltvGaugeValue: ltv.gaugeValue,
              balance: null,
            });
          }
          return positions;
        },
        event: 'data:positions',
        name: 'positions',
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
     * @param {'public'|'authed'} group
     * @param {string}   name - Source name (for debugging)
     * @param {Function} fn   - Async fetch function
     * @param {number}   ms   - Polling interval (0 = no interval, just immediate fetch)
     */
    DataFetcherV2.prototype._startInterval = function (group, name, fn, ms) {
      // Immediate first fetch
      fn();

      // Start regular interval if ms > 0
      if (ms > 0) {
        var id = setInterval(fn, ms);
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

  window.DataFetcherV2 = DataFetcherV2;
})();
