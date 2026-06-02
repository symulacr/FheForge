/* ──────────────────────────────────────────────
   Integration Adapter — DataFetcher, StateManager,
   and lifecycle for bridge-to-__MOCK__ data flow.
   Loaded LAST after all forge screens and app are in place.
   ────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────
     StateManager — window.__MOCK__ + __BRIDGE__ ops
     ────────────────────────────────────────────── */

  var StateManager = {
    /* Set a single mock data key */
    setMockData: function (key, value) {
      window.__BRIDGE__.setMockData(key, value);
    },

    /* Batch-set multiple mock data keys, notify once */
    setBatchMockData: function (data) {
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        // Never overwrite TEMPLATES or DEFAULT_CONFIG
        if (k === 'TEMPLATES' || k === 'DEFAULT_CONFIG') continue;
        window.__MOCK__[k] = data[k];
      }
      window.__BRIDGE__.notify();
    },

    /* Get a single mock data value */
    getMockData: function (key) {
      return window.__BRIDGE__.getMockData(key);
    },

    /* Clear all mock data (on disconnect) */
    clearMockData: function () {
      window.__MOCK__ = {};
      window.__BRIDGE__.notify();
    },
  };

  /* ──────────────────────────────────────────────
     DataFetcher — Per-screen fetch + polling
     ────────────────────────────────────────────── */

  var DataFetcher = {
    _intervals: {},
    _fetchFns: {},
    _running: false,

    /* Register a fetch function with optional polling interval (ms) */
    register: function (name, fetchFn, intervalMs) {
      this._fetchFns[name] = { fn: fetchFn, interval: intervalMs };
    },

    /* Start all registered fetchers */
    startAll: function () {
      if (this._running) return;
      this._running = true;

      var names = Object.keys(this._fetchFns);
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var cfg = this._fetchFns[name];

        // Immediate first fetch
        this._fetchOne(name);

        // Start interval if polling configured
        if (cfg.interval && cfg.interval > 0) {
          var self = this;
          this._intervals[name] = setInterval(function () {
            self._fetchOne(name);
          }, cfg.interval);
        }
      }
    },

    /* Stop all fetchers and clear intervals */
    stopAll: function () {
      this._running = false;
      var names = Object.keys(this._intervals);
      for (var i = 0; i < names.length; i++) {
        clearInterval(this._intervals[names[i]]);
      }
      this._intervals = {};
    },

    /* Fetch a single data source, with error handling */
    _fetchOne: function (name) {
      var cfg = this._fetchFns[name];
      if (!cfg) return;

      var self = this;
      cfg.fn()
        .then(function (data) {
          // Success — data already written to __MOCK__ by fetchFn
          self._onSuccess(name, data);
        })
        .catch(function (err) {
          // Failure — do NOT clear __MOCK__, keep stale data
          self._onError(name, err);
        });
    },

    _onSuccess: function (name, data) {
      // Could add logging/metrics here
    },

    _onError: function (name, err) {
      console.error('[DataFetcher] Fetch failed for "' + name + '":', err);
      // Stale data preserved in __MOCK__
    },
  };

  /* ──────────────────────────────────────────────
     Register default fetch functions
     These assume window.bridge is available from
     the bridge adapter layer.
     ────────────────────────────────────────────── */

  function registerDefaultFetchers() {
    // Ticker — poll stats every 30s
    DataFetcher.register('ticker', function () {
      return getBridgeApi()
        .then(function (api) { return api.stats.getStats(); })
        .then(function (stats) {
          var ticker = window.__transformers.formatTicker(stats);
          StateManager.setMockData('TICKER_ITEMS', ticker);
        });
    }, 30000);

    // Markets — poll every 30s
    DataFetcher.register('markets', function () {
      return getBridgeApi()
        .then(function (api) { return api.markets.getMarkets(); })
        .then(function (markets) {
          var transformed = window.__transformers.transformMarkets(markets);
          StateManager.setMockData('L_MARKETS', transformed);
        });
    }, 30000);

    // Activity — poll every 15s
    DataFetcher.register('activity', function () {
      return getBridgeApi()
        .then(function (api) { return api.activities.getActivities(); })
        .then(function (activities) {
          var transformed = window.__transformers.transformActivities(activities);
          StateManager.setMockData('D_ACTIVITY', transformed);
        });
    }, 15000);

    // Positions — fetch on navigation
    DataFetcher.register('positions', function () {
      return getBridgeApi()
        .then(function (api) { return Promise.all([
          api.contract.read('LendingPool', 'getUserAccounts', [window.bridge.wallet.getAccount()]),
          api.markets.getMarkets(),
        ]); })
        .then(function (results) {
          var supplies = results[0] && results[0].supplies ? results[0].supplies : [];
          var borrows = results[0] && results[0].borrows ? results[0].borrows : [];
          var markets = results[1] || [];
          var transformed = window.__transformers.transformPositions(supplies, borrows, markets);
          StateManager.setMockData('D_POSITIONS', transformed);

          // Update portfolio metrics
          if (window.__transformers) {
            var netValue = window.__transformers.calculateNetValue(transformed);
            var ltv = window.__transformers.calculateLTV(transformed);
            StateManager.setBatchMockData({
              PORTFOLIO_NET_VALUE: netValue,
              PORTFOLIO_LTV: ltv.ratio,
              LTV_GAUGE_VALUE: ltv.gaugeValue,
            });
          }
        });
    }, 0); // No interval — called on nav

    // Strategies — fetch on navigation
    DataFetcher.register('strategies', function () {
      return getBridgeApi()
        .then(function (api) { return api.defiStrategies.getDefiStrategies({}); })
        .then(function (strategies) {
          var transformed = window.__transformers.transformStrategies(strategies);
          StateManager.setMockData('D_STRATS', transformed);
        });
    }, 0);

    // Governance proposals — fetch on mount
    DataFetcher.register('proposals', function () {
      return getBridgeApi()
        .then(function (api) { return api.governance.listProposals(); })
        .then(function (proposals) {
          var transformed = window.__transformers.transformProposals(proposals);
          StateManager.setMockData('PROPOSALS', transformed);
        });
    }, 0);

    // Community strategies — fetch on mount
    DataFetcher.register('community', function () {
      return getBridgeApi()
        .then(function (api) { return api.strategies.listStrategies(); })
        .then(function (strategies) {
          var transformed = window.__transformers.transformStrategies(strategies);
          StateManager.setMockData('COMMUNITY', transformed);
        });
    }, 0);

    // Node types — fetch on mount
    DataFetcher.register('nodeTypes', function () {
      return getBridgeApi()
        .then(function (api) { return api.defiModules.getDefiModules(); })
        .then(function (modules) {
          var transformed = window.__transformers.transformNodeTypes(modules);
          StateManager.setMockData('NODE_TYPES', transformed);
        });
    }, 0);

    // Wallet balance — on connect / periodic
    DataFetcher.register('walletBalance', function () {
      return getBridgeApi()
        .then(function (api) {
          var addr = api.wallet.getAccount();
          if (!addr) throw new Error('No wallet connected');
          return api.wallet.getBalance(addr);
        })
        .then(function (balance) {
          StateManager.setMockData('WALLET_BALANCE', balance);
        });
    }, 60000);
  }

  /* ──────────────────────────────────────────────
     Bridge API helper
     ────────────────────────────────────────────── */

  function getBridgeApi() {
    return new Promise(function (resolve, reject) {
      if (window.bridge) return resolve(window.bridge);
      // If bridge not yet loaded, retry
      var retries = 0;
      var check = setInterval(function () {
        retries++;
        if (window.bridge) {
          clearInterval(check);
          resolve(window.bridge);
        } else if (retries > 20) {
          clearInterval(check);
          reject(new Error('Bridge adapter not loaded'));
        }
      }, 100);
    });
  }

  /* ──────────────────────────────────────────────
     Lifecycle — Start/stop on connection state
     ────────────────────────────────────────────── */

  var Lifecycle = {
    _started: false,

    start: function () {
      if (this._started) return;
      this._started = true;
      registerDefaultFetchers();
      DataFetcher.startAll();
    },

    stop: function () {
      this._started = false;
      DataFetcher.stopAll();
      // Do NOT clear __MOCK__ — stale cache for re-connect
    },

    isRunning: function () {
      return this._started;
    },
  };

  /* ──────────────────────────────────────────────
     Auto-start when bridge connects
     ────────────────────────────────────────────── */

  function initLifecycle() {
    // If bridge already connected, start immediately
    if (window.bridge && window.bridge.wallet && window.bridge.wallet.isConnected()) {
      Lifecycle.start();
    }

    // Listen for connection changes via polling
    var wasConnected = !!(window.bridge && window.bridge.wallet && window.bridge.wallet.isConnected());
    setInterval(function () {
      var isConnected = !!(window.bridge && window.bridge.wallet && window.bridge.wallet.isConnected());
      if (isConnected && !wasConnected) {
        Lifecycle.start();
      } else if (!isConnected && wasConnected) {
        Lifecycle.stop();
      }
      wasConnected = isConnected;
    }, 1000);
  }

  /* ──────────────────────────────────────────────
     Initialize on DOM ready
     ────────────────────────────────────────────── */

  function init() {
    // Clear TEMPLATES and DEFAULT_CONFIG from any prior mock reset
    var templates = window.__MOCK__ && window.__MOCK__.TEMPLATES;
    var defaultConfig = window.__MOCK__ && window.__MOCK__.DEFAULT_CONFIG;

    window.__MOCK__ = window.__MOCK__ || {};
    window.__MOCK__.TEMPLATES = templates || [];
    window.__MOCK__.DEFAULT_CONFIG = defaultConfig || {};

    initLifecycle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ──────────────────────────────────────────────
     Public API
     ────────────────────────────────────────────── */

  window.__integration = {
    StateManager: StateManager,
    DataFetcher: DataFetcher,
    Lifecycle: Lifecycle,
  };
})();
