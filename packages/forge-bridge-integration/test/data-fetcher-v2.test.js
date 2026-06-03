/**
 * DataFetcherV2 Tests
 *
 * Comprehensive tests covering:
 * - Separate startPublicPolling() and startAuthenticatedPolling() methods (VAL-REARCH-DATA-001)
 * - Public polling starts on page load without wallet (VAL-REARCH-DATA-002)
 * - Authenticated polling starts on wallet connect, stops on disconnect (VAL-REARCH-DATA-003)
 * - Ticker polls 30s, markets 30s (VAL-REARCH-DATA-004)
 * - Activity polls 15s, positions/strategies/proposals/nodeTypes fetch on navigation (VAL-REARCH-DATA-005)
 * - Error handling preserves stale data with warning (VAL-REARCH-DATA-006)
 * - All 9 transformer functions pass tests (VAL-REARCH-DATA-007)
 * - Public data reaches BridgeBus state (VAL-REARCH-DATA-008)
 * - No double-registration on repeated start (VAL-REARCH-DATA-009)
 * - Disconnect clears auth data, preserves public data (VAL-REARCH-DATA-010)
 * - Idempotent start/stop
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BridgeBus } from '../src/bridge-bus.js';
import '../src/data-fetcher-v2.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create mock transformers that match the real transformer signatures.
 * Each function returns a predictable transformed value for testing.
 */
function createMockTransformers() {
  return {
    formatTicker: mock((stats) => ['⧫ ' + (stats.blockNumber || '—'), 'GAS: —']),
    transformMarkets: mock((apiMarkets) => (apiMarkets || []).map(function (m) {
      return { asset: m.asset || 'UNKNOWN', supplyApy: m.supplyApy != null ? m.supplyApy + '%' : '—' };
    })),
    transformActivities: mock((apiActivities) => (apiActivities || []).map(function (a) {
      return { id: a.id, what: a.description || a.type, kind: a.kind || a.action };
    })),
    transformPositions: mock((supplies, borrows, markets) => {
      var positions = [];
      if (Array.isArray(supplies)) supplies.forEach(function (s) {
        positions.push({ id: s.id || 'sup-1', side: 'supply', asset: s.asset, amount: s.amountUsd });
      });
      if (Array.isArray(borrows)) borrows.forEach(function (b) {
        positions.push({ id: b.id || 'bor-1', side: 'borrow', asset: b.asset, amount: b.amountUsd });
      });
      return positions;
    }),
    transformStrategies: mock((apiStrategies) => (apiStrategies || []).map(function (s) {
      return { id: s.id, name: s.name, apy: s.apy };
    })),
    transformProposals: mock((apiProposals) => (apiProposals || []).map(function (p) {
      return { id: p.id, title: p.title, status: (p.status || 'pending').toLowerCase() };
    })),
    transformNodeTypes: mock((modules) => {
      var types = {};
      if (Array.isArray(modules)) modules.forEach(function (m) {
        types[m.id] = { label: m.action, protocol: m.protocol };
      });
      return types;
    }),
    calculateNetValue: mock((positions) => '12,000.00'),
    calculateLTV: mock((positions) => ({ ratio: '30.00', gaugeValue: 30 })),
  };
}

/**
 * Create a mock bridge adapter that simulates API calls.
 * All methods return resolved promises with controllable data.
 * Use `setMockData(source, value)` to configure what each endpoint returns.
 */
function createMockBridge() {
  var mockData = {
    stats: { blockNumber: '182,944,108', gasPrice: '0.014', poolTvl: '$8.42M' },
    markets: [{ asset: 'ETH', supplyApy: 3.45, borrowApy: 5.67 }],
    activities: [{ id: 'act-1', description: 'Supplied 10 ETH', kind: 'supply' }],
    positionsSupplies: [{ id: 'pos-1', asset: 'ETH', amountUsd: '5000' }],
    positionsBorrows: [{ id: 'pos-2', asset: 'USDC', amountUsd: '2000' }],
    strategies: [{ id: 'strat-1', name: 'Yield Optimizer', apy: 12.5 }],
    proposals: [{ id: 'prop-1', title: 'Increase ETH CF', status: 'ACTIVE' }],
    modules: [{ id: 'supply', action: 'supply', protocol: 'AAVE' }],
    walletBalance: '10000.50',
    account: '0x1234567890abcdef',
  };

  var bridge = {
    api: {
      stats: {
        getStats: mock(function () { return Promise.resolve(mockData.stats); }),
      },
      markets: {
        getMarkets: mock(function () { return Promise.resolve(mockData.markets); }),
      },
      activities: {
        getActivities: mock(function () { return Promise.resolve(mockData.activities); }),
      },
      defiStrategies: {
        getDefiStrategies: mock(function () { return Promise.resolve(mockData.strategies); }),
      },
      governance: {
        listProposals: mock(function () { return Promise.resolve(mockData.proposals); }),
      },
      defiModules: {
        getDefiModules: mock(function () { return Promise.resolve(mockData.modules); }),
      },
    },
    contract: {
      read: mock(function (contractName, method, args) {
        return Promise.resolve({
          supplies: mockData.positionsSupplies,
          borrows: mockData.positionsBorrows,
        });
      }),
    },
    wallet: {
      getAccount: mock(function () { return mockData.account; }),
      getBalance: mock(function (addr) { return Promise.resolve(mockData.walletBalance); }),
    },
    _setMockData: function (source, value) { mockData[source] = value; },
    _getMockData: function (source) { return mockData[source]; },
  };

  return bridge;
}

/**
 * Create mock BridgeBus on/set/getState spies.
 * Wraps a real BridgeBus but adds spy capabilities.
 */
function createSpiedBus() {
  var bus = new BridgeBus();
  // Spy on set
  var originalSet = bus.set.bind(bus);
  bus.set = mock(function (event, data) {
    return originalSet(event, data);
  });
  return bus;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DataFetcherV2', function () {
  var bridge;
  var xf;
  var bus;
  var fetcher;

  beforeEach(function () {
    bridge = createMockBridge();
    xf = createMockTransformers();
    bus = createSpiedBus();
    // Ensure bus starts in public mode so writes are accepted
    bus.start();
  });

  afterEach(function () {
    if (fetcher) {
      fetcher.stopAll();
      fetcher = null;
    }
    // Clean up any lingering intervals
    var maxId = setTimeout(function () {}, 0);
    for (var i = 0; i <= maxId; i++) {
      clearInterval(i);
    }
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-001: Separate public/authenticated methods
     ────────────────────────────────────────────── */
  describe('method existence (VAL-REARCH-DATA-001)', function () {
    it('has startPublicPolling method', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(typeof fetcher.startPublicPolling).toBe('function');
    });

    it('has startAuthenticatedPolling method', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(typeof fetcher.startAuthenticatedPolling).toBe('function');
    });

    it('has stopAuthenticatedPolling method', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(typeof fetcher.stopAuthenticatedPolling).toBe('function');
    });

    it('has stopPublicPolling method', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(typeof fetcher.stopPublicPolling).toBe('function');
    });

    it('has stopAll method', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(typeof fetcher.stopAll).toBe('function');
    });

    it('has on-nav fetch methods', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(typeof fetcher.fetchPositions).toBe('function');
      expect(typeof fetcher.fetchStrategies).toBe('function');
      expect(typeof fetcher.fetchProposals).toBe('function');
      expect(typeof fetcher.fetchNodeTypes).toBe('function');
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-002: Public mode starts on page load, no wallet
     ────────────────────────────────────────────── */
  describe('startPublicPolling (VAL-REARCH-DATA-002)', function () {
    it('fetches ticker immediately on start (async)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      // Bridge API calls happen asynchronously (via _getBridge().then())
      // so we wait briefly for the microtask queue to flush
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(bridge.api.stats.getStats).toHaveBeenCalled();
          resolve();
        }, 10);
      });
    });

    it('fetches markets immediately on start (async)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(bridge.api.markets.getMarkets).toHaveBeenCalled();
          resolve();
        }, 10);
      });
    });

    it('writes ticker to BridgeBus via data:ticker event', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      // After the ticker fetch resolves
      return new Promise(function (resolve) {
        setTimeout(function () {
          var found = false;
          for (var i = 0; i < bus.set.mock.calls.length; i++) {
            var call = bus.set.mock.calls[i];
            if (call[0] === 'data:ticker') {
              found = true;
              expect(call[1]).toBeDefined();
              break;
            }
          }
          expect(found).toBe(true);
          resolve();
        }, 50);
      });
    });

    it('writes markets to BridgeBus via data:markets event', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          var found = false;
          for (var i = 0; i < bus.set.mock.calls.length; i++) {
            if (bus.set.mock.calls[i][0] === 'data:markets') {
              found = true;
              break;
            }
          }
          expect(found).toBe(true);
          resolve();
        }, 50);
      });
    });

    it('does NOT require wallet connection (bridge.wallet.getAccount not called)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      expect(bridge.wallet.getAccount).not.toHaveBeenCalled();
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-004: Public polling intervals
     ────────────────────────────────────────────── */
  describe('polling intervals — public (VAL-REARCH-DATA-004)', function () {
    it('ticker fetches on start and at interval', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { ticker: 50 },  // 50ms for fast test
      });

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startPublicPolling();
          // Wait for microtask + first interval tick
          setTimeout(function () {
            // Should have been called at least 2 times (immediate + 1 interval tick)
            expect(bridge.api.stats.getStats.mock.calls.length).toBeGreaterThanOrEqual(2);
            resolve();
          }, 70);
        }, 10);
      });
    });

    it('markets fetches on start and at interval', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { markets: 50 },
      });

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startPublicPolling();
          setTimeout(function () {
            expect(bridge.api.markets.getMarkets.mock.calls.length).toBeGreaterThanOrEqual(2);
            resolve();
          }, 70);
        }, 10);
      });
    });

    it('uses custom interval from options', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { ticker: 100, markets: 200 },
      });
      // Verify the interval values are stored correctly
      expect(fetcher._pollIntervals.ticker).toBe(100);
      expect(fetcher._pollIntervals.markets).toBe(200);
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-003: Authenticated mode starts/stops on wallet
     ────────────────────────────────────────────── */
  describe('startAuthenticatedPolling (VAL-REARCH-DATA-003)', function () {
    it('fetches activities immediately on start (async)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(bridge.api.activities.getActivities).toHaveBeenCalled();
          resolve();
        }, 10);
      });
    });

    it('fetches positions immediately on start (async)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(bridge.contract.read).toHaveBeenCalled();
          resolve();
        }, 10);
      });
    });

    it('fetches strategies immediately on start (on-nav type, async)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(bridge.api.defiStrategies.getDefiStrategies).toHaveBeenCalled();
          resolve();
        }, 10);
      });
    });

    it('fetches proposals immediately on start (on-nav type, async)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(bridge.api.governance.listProposals).toHaveBeenCalled();
          resolve();
        }, 10);
      });
    });

    it('fetches nodeTypes immediately on start (on-nav type, async)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(bridge.api.defiModules.getDefiModules).toHaveBeenCalled();
          resolve();
        }, 10);
      });
    });

    it('fetches walletBalance immediately on start (async)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(bridge.wallet.getBalance).toHaveBeenCalled();
          resolve();
        }, 10);
      });
    });

    it('writes auth data to BridgeBus via data:activities', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          var found = false;
          for (var i = 0; i < bus.set.mock.calls.length; i++) {
            if (bus.set.mock.calls[i][0] === 'data:activities') {
              found = true;
              break;
            }
          }
          expect(found).toBe(true);
          resolve();
        }, 50);
      });
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-005: Authenticated polling intervals
     ────────────────────────────────────────────── */
  describe('polling intervals — authenticated (VAL-REARCH-DATA-005)', function () {
    it('activities polls at interval', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { activities: 50 },
      });

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          setTimeout(function () {
            expect(bridge.api.activities.getActivities.mock.calls.length).toBeGreaterThanOrEqual(2);
            resolve();
          }, 70);
        }, 10);
      });
    });

    it('positions polls at interval (and also on-nav)', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { positions: 50 },
      });

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          setTimeout(function () {
            expect(bridge.contract.read.mock.calls.length).toBeGreaterThanOrEqual(2);
            resolve();
          }, 70);
        }, 10);
      });
    });

    it('strategies does NOT have an interval (on-nav only)', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
      });

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          // Wait for initial async fetch then check no interval ticks
          setTimeout(function () {
            expect(bridge.api.defiStrategies.getDefiStrategies.mock.calls.length).toBe(1);
            resolve();
          }, 80);
        }, 10);
      });
    });

    it('proposals does NOT have an interval (on-nav only)', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
      });

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          setTimeout(function () {
            expect(bridge.api.governance.listProposals.mock.calls.length).toBe(1);
            resolve();
          }, 100);
        }, 10);
      });
    });

    it('nodeTypes does NOT have an interval (on-nav only)', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
      });

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          setTimeout(function () {
            expect(bridge.api.defiModules.getDefiModules.mock.calls.length).toBe(1);
            resolve();
          }, 100);
        }, 10);
      });
    });

    it('walletBalance polls at interval', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { walletBalance: 50 },
      });

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          setTimeout(function () {
            expect(bridge.wallet.getBalance.mock.calls.length).toBeGreaterThanOrEqual(2);
            resolve();
          }, 70);
        }, 10);
      });
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-006: Error handling preserves stale data
     ────────────────────────────────────────────── */
  describe('error handling (VAL-REARCH-DATA-006)', function () {
    it('preserves existing ticker data in BridgeBus on fetch error', function () {
      // Set up initial data
      bus.set('data:ticker', ['⧫ 182,944,108']);
      bus.set('data:markets', [{ asset: 'ETH', supplyApy: '3.45%' }]);

      // Make the ticker API fail
      bridge.api.stats.getStats = mock(function () {
        return Promise.reject(new Error('Network error'));
      });

      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();

      return new Promise(function (resolve) {
        setTimeout(function () {
          var state = bus.getState();
          // Stale data preserved
          expect(state.public.ticker).toEqual(['⧫ 182,944,108']);
          expect(state.public.markets).toEqual([{ asset: 'ETH', supplyApy: '3.45%' }]);
          // Error recorded in meta.errors
          expect(state.meta.errors.length).toBeGreaterThanOrEqual(1);
          resolve();
        }, 50);
      });
    });

    it('records error details in BridgeBus meta.errors', function () {
      bridge.api.stats.getStats = mock(function () {
        return Promise.reject(new Error('API timeout'));
      });

      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();

      return new Promise(function (resolve) {
        setTimeout(function () {
          var state = bus.getState();
          var errors = state.meta.errors;
          expect(errors.length).toBeGreaterThanOrEqual(1);
          var lastErr = errors[errors.length - 1];
          expect(lastErr).toHaveProperty('source', 'ticker');
          expect(lastErr).toHaveProperty('message');
          resolve();
        }, 50);
      });
    });

    it('does not throw when BridgeBus is not available', function () {
      bridge.api.stats.getStats = mock(function () {
        return Promise.reject(new Error('Fail'));
      });

      // Create fetcher with no bus
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: null, transformers: xf });
      // Should not throw
      expect(function () {
        fetcher.startPublicPolling();
      }).not.toThrow();
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-007: All 9 transformer functions used
     ────────────────────────────────────────────── */
  describe('transformer usage (VAL-REARCH-DATA-007)', function () {
    it('calls formatTicker when fetching ticker', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(xf.formatTicker).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('calls transformMarkets when fetching markets', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(xf.transformMarkets).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('calls transformActivities when fetching activities', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(xf.transformActivities).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('calls transformPositions when fetching positions', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(xf.transformPositions).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('calls transformStrategies when fetching strategies', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(xf.transformStrategies).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('calls transformProposals when fetching proposals', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(xf.transformProposals).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('calls transformNodeTypes when fetching node types', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(xf.transformNodeTypes).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('calls calculateNetValue and calculateLTV when fetching positions', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(xf.calculateNetValue).toHaveBeenCalled();
          expect(xf.calculateLTV).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-008: Public data reaches BridgeBus state
     ────────────────────────────────────────────── */
  describe('data reaches BridgeBus (VAL-REARCH-DATA-008)', function () {
    it('ticker data stored in state.public.ticker', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          // The raw ticker from bridge should be transformed and set
          // Check that bus.set was called with 'data:ticker'
          var tickerCalls = bus.set.mock.calls.filter(function (c) { return c[0] === 'data:ticker'; });
          expect(tickerCalls.length).toBeGreaterThanOrEqual(1);
          resolve();
        }, 50);
      });
    });

    it('markets data stored in state.public.markets', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      return new Promise(function (resolve) {
        setTimeout(function () {
          var marketCalls = bus.set.mock.calls.filter(function (c) { return c[0] === 'data:markets'; });
          expect(marketCalls.length).toBeGreaterThanOrEqual(1);
          resolve();
        }, 50);
      });
    });

    it('public data reaches BridgeBus state via getState()', function () {
      // Use a real set to put data in, then verify
      bus.set('data:ticker', ['⧫ 182,944,108']);
      bus.set('data:markets', [{ asset: 'ETH' }]);
      var state = bus.getState();
      expect(state.public.ticker).toEqual(['⧫ 182,944,108']);
      expect(state.public.markets).toEqual([{ asset: 'ETH' }]);
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-009: No double-registration on repeated start
     ────────────────────────────────────────────── */
  describe('idempotent start (VAL-REARCH-DATA-009)', function () {
    it('startPublicPolling called twice does not create duplicate intervals', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { ticker: 50, markets: 50 },
      });

      // Call start twice — second call should be a no-op
      fetcher.startPublicPolling();
      fetcher.startPublicPolling();

      // Ensure only one set of intervals was created (check interval IDs length)
      expect(fetcher._publicStarted).toBe(true);
      expect(fetcher._publicIntervalIds.length).toBe(2); // 2 sources: ticker, markets

      return new Promise(function (resolve) {
        setTimeout(function () {
          var tickerCalls = bridge.api.stats.getStats.mock.calls.length;
          var marketCalls = bridge.api.markets.getMarkets.mock.calls.length;

          // Both should have ticked at similar rates (not 2x due to dupe intervals)
          expect(tickerCalls).toBeGreaterThanOrEqual(2);
          expect(marketCalls).toBeGreaterThanOrEqual(2);

          // If there were duplicate intervals, calls would be ~2x higher
          expect(tickerCalls).toBeLessThanOrEqual(8);
          expect(marketCalls).toBeLessThanOrEqual(8);

          resolve();
        }, 120);
      });
    });

    it('startAuthenticatedPolling called twice does not create duplicate intervals', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { activities: 50, positions: 50, walletBalance: 50 },
      });

      // Call start twice — second call should be a no-op
      fetcher.startAuthenticatedPolling();
      fetcher.startAuthenticatedPolling();

      // Ensure only one set of intervals was created
      expect(fetcher._authStarted).toBe(true);
      expect(fetcher._authIntervalIds.length).toBe(3); // 3 interval sources

      return new Promise(function (resolve) {
        setTimeout(function () {
          var activityCalls = bridge.api.activities.getActivities.mock.calls.length;
          expect(activityCalls).toBeGreaterThanOrEqual(2);
          expect(activityCalls).toBeLessThanOrEqual(8);
          resolve();
        }, 120);
      });
    });
  });

  /* ──────────────────────────────────────────────
     VAL-REARCH-DATA-010: Disconnect clears auth, preserves public
     ────────────────────────────────────────────── */
  describe('stopAuthenticatedPolling (VAL-REARCH-DATA-010)', function () {
    it('stops intervals when stopAuthenticatedPolling is called', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { activities: 20, positions: 30, walletBalance: 40 },
      });

      fetcher.startAuthenticatedPolling();
      var countAfterStart = bridge.api.activities.getActivities.mock.calls.length;

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.stopAuthenticatedPolling();
          var countBeforeStop = bridge.api.activities.getActivities.mock.calls.length;

          // Wait a bit more to ensure no more calls happen
          setTimeout(function () {
            var countAfterStop = bridge.api.activities.getActivities.mock.calls.length;
            // Should not have increased since stop
            expect(countAfterStop).toBe(countBeforeStop);
            resolve();
          }, 60);
        }, 30);
      });
    });

    it('clears authed state in BridgeBus via disableAuthenticated', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();

      // First, simulate some data being set
      bus.set('data:ticker', ['public ticker']);
      bus.set('data:positions', [{ id: 'pos-1' }]);
      bus.enableAuthenticated();

      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.stopAuthenticatedPolling();
          var state = bus.getState();

          // Auth data cleared (disableAuthenticated resets authed domain to defaults)
          expect(state.authed.positions).toBeNull();
          expect(state.authed.strategies).toBeNull();
          // Public data preserved
          expect(state.public.ticker).toEqual(['public ticker']);
          // authEnabled should be false
          expect(bus.isAuthenticated()).toBe(false);
          resolve();
        }, 50);
      });
    });

    it('is idempotent — calling twice does not error', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();
      fetcher.stopAuthenticatedPolling();

      expect(function () {
        fetcher.stopAuthenticatedPolling();
        fetcher.stopAuthenticatedPolling();
      }).not.toThrow();
    });
  });

  /* ──────────────────────────────────────────────
     On-nav fetch methods
     ────────────────────────────────────────────── */
  describe('on-nav fetch methods', function () {
    beforeEach(function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
    });

    it('fetchPositions re-fetches positions on demand', function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          // Wait for initial async fetch to complete
          setTimeout(function () {
            var callsBefore = bridge.contract.read.mock.calls.length;
            fetcher.fetchPositions();
            // Wait for on-nav async fetch
            setTimeout(function () {
              expect(bridge.contract.read.mock.calls.length).toBeGreaterThan(callsBefore);
              resolve();
            }, 10);
          }, 10);
        }, 10);
      });
    });

    it('fetchStrategies re-fetches strategies on demand', function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          setTimeout(function () {
            var callsBefore = bridge.api.defiStrategies.getDefiStrategies.mock.calls.length;
            fetcher.fetchStrategies();
            setTimeout(function () {
              expect(bridge.api.defiStrategies.getDefiStrategies.mock.calls.length).toBeGreaterThan(callsBefore);
              resolve();
            }, 10);
          }, 10);
        }, 10);
      });
    });

    it('fetchProposals re-fetches proposals on demand', function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          setTimeout(function () {
            var callsBefore = bridge.api.governance.listProposals.mock.calls.length;
            fetcher.fetchProposals();
            setTimeout(function () {
              expect(bridge.api.governance.listProposals.mock.calls.length).toBeGreaterThan(callsBefore);
              resolve();
            }, 10);
          }, 10);
        }, 10);
      });
    });

    it('fetchNodeTypes re-fetches node types on demand', function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          fetcher.startAuthenticatedPolling();
          setTimeout(function () {
            var callsBefore = bridge.api.defiModules.getDefiModules.mock.calls.length;
            fetcher.fetchNodeTypes();
            setTimeout(function () {
              expect(bridge.api.defiModules.getDefiModules.mock.calls.length).toBeGreaterThan(callsBefore);
              resolve();
            }, 10);
          }, 10);
        }, 10);
      });
    });
  });

  /* ──────────────────────────────────────────────
     Constructor options
     ────────────────────────────────────────────── */
  describe('constructor options', function () {
    it('accepts custom interval overrides', function () {
      var customIntervals = { ticker: 5000, markets: 10000 };
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: customIntervals,
      });
      expect(fetcher._pollIntervals.ticker).toBe(5000);
      expect(fetcher._pollIntervals.markets).toBe(10000);
      // Other intervals should still use defaults
      expect(fetcher._pollIntervals.activities).toBe(15000);
      expect(fetcher._pollIntervals.positions).toBe(60000);
      expect(fetcher._pollIntervals.walletBalance).toBe(60000);
    });

    it('defaults to window globals when no options provided', function () {
      // Just test that constructor doesn't throw when no options
      expect(function () {
        var f = new window.DataFetcherV2();
        f.stopAll();
      }).not.toThrow();
    });
  });

  /* ──────────────────────────────────────────────
     Stop methods
     ────────────────────────────────────────────── */
  describe('stop methods', function () {
    it('stopPublicPolling clears public intervals and sets flag', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { ticker: 30, markets: 30 },
      });
      fetcher.startPublicPolling();
      fetcher.stopPublicPolling();

      expect(fetcher._publicStarted).toBe(false);
      expect(fetcher._publicIntervalIds.length).toBe(0);
    });

    it('stopAll stops everything', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { ticker: 30, markets: 30, activities: 30 },
      });
      fetcher.startPublicPolling();
      fetcher.startAuthenticatedPolling();
      fetcher.stopAll();

      expect(fetcher._publicStarted).toBe(false);
      expect(fetcher._authStarted).toBe(false);
      expect(fetcher._publicIntervalIds.length).toBe(0);
      expect(fetcher._authIntervalIds.length).toBe(0);
    });
  });

  /* ──────────────────────────────────────────────
     Edge Cases
     ────────────────────────────────────────────── */
  describe('edge cases', function () {
    it('fetchPositions returns early if auth not started', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      // Auth not started yet
      fetcher.fetchPositions();
      expect(bridge.contract.read).not.toHaveBeenCalled();
    });

    it('fetchStrategies returns early if auth not started', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.fetchStrategies();
      expect(bridge.api.defiStrategies.getDefiStrategies).not.toHaveBeenCalled();
    });

    it('fetchProposals returns early if auth not started', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.fetchProposals();
      expect(bridge.api.governance.listProposals).not.toHaveBeenCalled();
    });

    it('fetchNodeTypes returns early if auth not started', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.fetchNodeTypes();
      expect(bridge.api.defiModules.getDefiModules).not.toHaveBeenCalled();
    });

    it('handles empty bridge responses gracefully', function () {
      bridge.api.stats.getStats = mock(function () { return Promise.resolve(null); });
      bridge.api.markets.getMarkets = mock(function () { return Promise.resolve(null); });

      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(function () {
        fetcher.startPublicPolling();
      }).not.toThrow();

      return new Promise(function (resolve) {
        setTimeout(function () {
          // Transformers were called (with null/empty, which they handle)
          expect(xf.formatTicker).toHaveBeenCalledWith(null);
          expect(xf.transformMarkets).toHaveBeenCalledWith(null);
          resolve();
        }, 50);
      });
    });

    it('handles missing wallet account gracefully in positions fetch', function () {
      bridge.wallet.getAccount = mock(function () { return null; });

      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startAuthenticatedPolling();

      return new Promise(function (resolve) {
        setTimeout(function () {
          // Should not throw — error is caught and logged
          var errors = bus.getState().meta.errors;
          expect(errors.length).toBeGreaterThanOrEqual(1);
          resolve();
        }, 50);
      });
    });
  });

  /* ──────────────────────────────────────────────
     Demo Mode Tests (VAL-POSTFIX-DATA-001)
     ────────────────────────────────────────────── */
  describe('startDemoMode', function () {
    beforeEach(function () {
      // Reset window.__MOCK__ before each demo mode test
      if (typeof window !== 'undefined' && window.__MOCK__) {
        // Clear all keys so we start fresh
        Object.keys(window.__MOCK__).forEach(function (k) { delete window.__MOCK__[k]; });
      }
    });

    it('has startDemoMode method', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(typeof fetcher.startDemoMode).toBe('function');
    });

    it('populates 25+ keys in window.__MOCK__', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      // Ensure __MOCK__ exists
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      var keyCount = Object.keys(window.__MOCK__).length;
      expect(keyCount).toBeGreaterThanOrEqual(25);
    });

    it('populates MOCK_CONSTANTS keys (TICKER_ITEMS, L_MARKETS, etc.)', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.TICKER_ITEMS).toBeDefined();
      expect(window.__MOCK__.L_MARKETS).toBeDefined();
      expect(window.__MOCK__.D_ACTIVITY).toBeDefined();
      expect(window.__MOCK__.D_POSITIONS).toBeDefined();
      expect(window.__MOCK__.D_STRATS).toBeDefined();
      expect(window.__MOCK__.PROPOSALS).toBeDefined();
      expect(window.__MOCK__.NODE_TYPES).toBeDefined();
      expect(window.__MOCK__.COMMUNITY).toBeDefined();
      expect(window.__MOCK__.TEMPLATES).toBeDefined();
      expect(window.__MOCK__.DEFAULT_CONFIG).toBeDefined();
      expect(window.__MOCK__.DEMO_ROWS).toBeDefined();
    });

    it('TICKER_ITEMS has 4+ realistic items', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.TICKER_ITEMS.length).toBeGreaterThanOrEqual(4);
    });

    it('L_MARKETS has 5+ market entries', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.L_MARKETS.length).toBeGreaterThanOrEqual(5);
      window.__MOCK__.L_MARKETS.forEach(function (m) {
        expect(m.asset).toBeDefined();
        expect(m.supplyApy).toBeDefined();
        expect(m.borrowApy).toBeDefined();
      });
    });

    it('D_ACTIVITY has 6+ activity entries', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.D_ACTIVITY.length).toBeGreaterThanOrEqual(6);
      window.__MOCK__.D_ACTIVITY.forEach(function (a) {
        expect(a.id).toBeDefined();
        expect(a.what).toBeDefined();
        expect(a.kind).toBeDefined();
      });
    });

    it('D_POSITIONS has 5+ position entries', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.D_POSITIONS.length).toBeGreaterThanOrEqual(5);
      window.__MOCK__.D_POSITIONS.forEach(function (p) {
        expect(p.id).toBeDefined();
        expect(p.venue).toBeDefined();
        expect(p.asset).toBeDefined();
        expect(p.side).toBeDefined();
        expect(p.amount).toBeDefined();
      });
    });

    it('D_STRATS has 3+ strategy entries', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.D_STRATS.length).toBeGreaterThanOrEqual(3);
      window.__MOCK__.D_STRATS.forEach(function (s) {
        expect(s.id).toBeDefined();
        expect(s.name).toBeDefined();
        expect(s.apy).toBeDefined();
      });
    });

    it('PROPOSALS has 5+ proposal entries', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.PROPOSALS.length).toBeGreaterThanOrEqual(5);
      window.__MOCK__.PROPOSALS.forEach(function (p) {
        expect(p.id).toBeDefined();
        expect(p.title).toBeDefined();
        expect(p.status).toBeDefined();
      });
    });

    it('COMMUNITY has 5+ community entries', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.COMMUNITY.length).toBeGreaterThanOrEqual(5);
      window.__MOCK__.COMMUNITY.forEach(function (c) {
        expect(c.id).toBeDefined();
        expect(c.name).toBeDefined();
        expect(c.author).toBeDefined();
        expect(c.apy).toBeDefined();
      });
    });

    it('NODE_TYPES has all 5 node type definitions', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      var nt = window.__MOCK__.NODE_TYPES;
      expect(nt.supply).toBeDefined();
      expect(nt.borrow).toBeDefined();
      expect(nt.swap).toBeDefined();
      expect(nt.repeat).toBeDefined();
      expect(nt.settle).toBeDefined();
      expect(nt.supply.label).toBeDefined();
      expect(nt.supply.kicker).toBeDefined();
      expect(nt.supply.swatch).toBeDefined();
      expect(nt.supply.desc).toBeDefined();
    });

    it('writes data to BridgeBus events when bus is available', function () {
      // Use a bus with start() called so it accepts public domain writes
      bus.start();
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startDemoMode();

      // Check that data events were emitted
      var state = bus.getState();
      expect(state.public.ticker).toBeDefined();
      expect(Array.isArray(state.public.ticker)).toBe(true);
      expect(state.public.markets).toBeDefined();
      expect(Array.isArray(state.public.markets)).toBe(true);
      expect(state.public.activities).toBeDefined();
      expect(Array.isArray(state.public.activities)).toBe(true);
      expect(state.authed.positions).toBeDefined();
      expect(Array.isArray(state.authed.positions)).toBe(true);
      expect(state.authed.strategies).toBeDefined();
      expect(Array.isArray(state.authed.strategies)).toBe(true);
      expect(state.authed.proposals).toBeDefined();
      expect(Array.isArray(state.authed.proposals)).toBe(true);
      expect(state.authed.nodeTypes).toBeDefined();
      expect(state.authed.walletBalance).toBeDefined();
    });

    it('is idempotent — second call does not overwrite data', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      var keyCount1 = Object.keys(window.__MOCK__).length;

      // Call again
      fetcher.startDemoMode();
      var keyCount2 = Object.keys(window.__MOCK__).length;

      // Should have same number of keys (not doubled)
      expect(keyCount2).toBe(keyCount1);
    });

    it('generates realistic ticker items with crypto pairs', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      var ticker = window.__MOCK__.TICKER_ITEMS;
      expect(Array.isArray(ticker)).toBe(true);
      ticker.forEach(function (item) {
        expect(typeof item).toBe('string');
        expect(item.length).toBeGreaterThan(0);
      });
    });

    it('VALUE_TO_MOCK_KEY Cipher values are populated', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher.startDemoMode();
      expect(window.__MOCK__.PORTFOLIO_NET_VALUE).toBeDefined();
      expect(window.__MOCK__.PORTFOLIO_LTV).toBeDefined();
      expect(window.__MOCK__.DEMO_SUPPLIED_VALUE).toBeDefined();
      expect(window.__MOCK__.DEMO_BORROWED_VALUE).toBeDefined();
      expect(window.__MOCK__.WALLET_BALANCE).toBeDefined();
      expect(window.__MOCK__.DEMO_ROWS).toBeDefined();
    });

    it('works without a BridgeBus (safe fallback)', function () {
      // No bus — _writeMockData still writes to __MOCK__
      window.__MOCK__ = window.__MOCK__ || {};
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: null, transformers: xf });
      expect(function () {
        fetcher.startDemoMode();
      }).not.toThrow();
      expect(window.__MOCK__.TICKER_ITEMS).toBeDefined();
      expect(window.__MOCK__.L_MARKETS).toBeDefined();
    });
  });

  /* ──────────────────────────────────────────────
     beforeunload leak guard
     ────────────────────────────────────────────── */
  describe('beforeunload leak guard', function () {
    it('registers a beforeunload listener on construction', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      expect(fetcher._beforeUnloadHandler).toBeDefined();
      expect(typeof fetcher._beforeUnloadHandler).toBe('function');
    });

    it('stopAll removes the beforeunload listener', function () {
      fetcher = new window.DataFetcherV2({ bridge: bridge, bus: bus, transformers: xf });
      fetcher.startPublicPolling();
      fetcher.stopAll();
      expect(fetcher._beforeUnloadHandler).toBeNull();
    });

    it('beforeunload handler calls stopAll', function () {
      fetcher = new window.DataFetcherV2({
        bridge: bridge,
        bus: bus,
        transformers: xf,
        intervals: { ticker: 50, markets: 50, activities: 50 },
      });
      fetcher.startPublicPolling();
      fetcher.startAuthenticatedPolling();
      expect(fetcher._publicStarted).toBe(true);
      expect(fetcher._authStarted).toBe(true);

      // Simulate beforeunload
      fetcher._beforeUnloadHandler();
      expect(fetcher._publicStarted).toBe(false);
      expect(fetcher._authStarted).toBe(false);
      expect(fetcher._publicIntervalIds.length).toBe(0);
      expect(fetcher._authIntervalIds.length).toBe(0);
    });
  });
});
