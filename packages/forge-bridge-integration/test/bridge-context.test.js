/**
 * ForgeProvider / BridgeContext Tests
 *
 * Covers all expected behavior from VAL-REARCH-PROVIDER-001 through 015:
 * - BridgeContext created with wallet, permit, data state fields
 * - ForgeProvider subscribes to BridgeBus events via useEffect
 * - ForgeProvider re-renders on BridgeBus data events (useState update)
 * - ForgeProvider unsubscribes on unmount (effect cleanup)
 * - useBridge() returns full context object
 * - useWallet() returns { connected, address, chainId }
 * - usePermit() returns { unlocked, secondsLeft }
 * - useBridgeData() returns all data arrays
 * - No key={dataVersion} — context updates trigger re-render not re-mount
 * - ForgeProvider writes domain data to window.__MOCK__
 * - Public data polling starts on mount
 *
 * IMPORTANT: ForgeProvider uses the imported bridgeBus singleton internally,
 * so all tests must interact with the singleton (imported as `bridgeBus`).
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import bridgeBus from '../src/bridge-bus.js';
import {
	BridgeContext,
	ForgeProvider,
	useBridge,
	useWallet,
	usePermit,
	useBridgeData,
} from '../src/bridge-context.js';

// Save original DataFetcherV2 so tests in other files (data-fetcher-v2.test.js)
// are not affected when this file replaces window.DataFetcherV2 with mocks.
const _originalDataFetcherV2 = typeof window !== 'undefined' ? window.DataFetcherV2 : null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Reset React mock state, BridgeBus singleton, window.__MOCK__
 * and the polling guard before each test.
 */
function resetGlobalState() {
	if (typeof __REACT_MOCK__ !== 'undefined') {
		__REACT_MOCK__.reset();
	}
	// Reset BridgeBus singleton state (preserves listeners)
	bridgeBus.reset();
	window.__MOCK__ = {};
	window.__forgeProvider__pollingStarted = false;
	// Restore original DataFetcherV2 so tests in other files are not affected
	if (_originalDataFetcherV2) {
		window.DataFetcherV2 = _originalDataFetcherV2;
	}
}

/**
 * Mount the ForgeProvider (simulates React rendering).
 * Triggers the component function (useState, useEffect, etc.)
 * ForgeProvider subscribes to the imported bridgeBus singleton internally.
 */
function mountProvider() {
	ForgeProvider({ children: 'test-child' });
}

/**
 * Simulate provider unmount by running cleanup functions.
 */
function unmountProvider() {
	if (typeof __REACT_MOCK__ !== 'undefined') {
		__REACT_MOCK__.runCleanups();
	}
}

/**
 * Set the BridgeContext value directly for testing hooks.
 */
function setContextValue(value) {
	BridgeContext._value = value;
}

/**
 * Reset BridgeContext to default value.
 */
function resetContextValue() {
	BridgeContext._value = {
		wallet: { connected: false, address: null, chainId: null },
		permit: { unlocked: false, secondsLeft: 0 },
		data: {
			ticker: null,
			markets: null,
			activities: null,
			positions: null,
			strategies: null,
			proposals: null,
			community: null,
			nodeTypes: null,
			walletBalance: null,
			portfolioNetValue: null,
			portfolioLTV: null,
		},
		meta: { dataVersion: 0, errors: [] },
	};
}

// ─── State Stack Mapping ────────────────────────────────────────────────────
// ForgeProvider calls useState 4 times:
//   0: wallet  { connected, address, chainId }
//   1: permit  { unlocked, secondsLeft }
//   2: data    { ticker, markets, ... }
//   3: dataVersion  number
// After mounting, stateStack[0..3] reflect these values.

beforeEach(() => {
	resetGlobalState();
	resetContextValue();
});

afterEach(() => {
	unmountProvider();
});

// ─── VAL-REARCH-PROVIDER-001: BridgeContext ──────────────────────────────────

describe('BridgeContext (VAL-REARCH-PROVIDER-001)', () => {
	it('is created with createContext and has Provider/Consumer', () => {
		expect(BridgeContext).toBeDefined();
		expect(typeof BridgeContext.Provider).toBe('function');
		expect(typeof BridgeContext.Consumer).toBe('function');
	});

	it('has default value with wallet domain', () => {
		expect(BridgeContext._defaultValue).toHaveProperty('wallet');
		expect(BridgeContext._defaultValue.wallet).toHaveProperty('connected', false);
		expect(BridgeContext._defaultValue.wallet).toHaveProperty('address', null);
		expect(BridgeContext._defaultValue.wallet).toHaveProperty('chainId', null);
	});

	it('has default value with permit domain', () => {
		expect(BridgeContext._defaultValue).toHaveProperty('permit');
		expect(BridgeContext._defaultValue.permit).toHaveProperty('unlocked', false);
		expect(BridgeContext._defaultValue.permit).toHaveProperty('secondsLeft', 0);
	});

	it('has default value with data domain (11 fields, all null)', () => {
		expect(BridgeContext._defaultValue).toHaveProperty('data');
		const data = BridgeContext._defaultValue.data;
		expect(data).toHaveProperty('ticker', null);
		expect(data).toHaveProperty('markets', null);
		expect(data).toHaveProperty('activities', null);
		expect(data).toHaveProperty('positions', null);
		expect(data).toHaveProperty('strategies', null);
		expect(data).toHaveProperty('proposals', null);
		expect(data).toHaveProperty('community', null);
		expect(data).toHaveProperty('nodeTypes', null);
		expect(data).toHaveProperty('walletBalance', null);
		expect(data).toHaveProperty('portfolioNetValue', null);
		expect(data).toHaveProperty('portfolioLTV', null);
	});

	it('has default value with meta domain containing dataVersion and errors', () => {
		expect(BridgeContext._defaultValue).toHaveProperty('meta');
		expect(BridgeContext._defaultValue.meta).toHaveProperty('dataVersion', 0);
		expect(BridgeContext._defaultValue.meta).toHaveProperty('errors');
	});
});

// ─── VAL-REARCH-PROVIDER-005: useBridge() ────────────────────────────────────

describe('useBridge() (VAL-REARCH-PROVIDER-005)', () => {
	it('returns the full context object with wallet, permit, data, meta', () => {
		const mockValue = {
			wallet: { connected: true, address: '0xabc', chainId: 421614 },
			permit: { unlocked: true, secondsLeft: 900 },
			data: {
				ticker: ['⧫ 182,944,108'],
				markets: [{ asset: 'ETH', supplyApy: '3.45%' }],
				activities: [],
				positions: [],
				strategies: [],
				proposals: [],
				community: [],
				nodeTypes: {},
				walletBalance: '10000',
				portfolioNetValue: '12,000.00',
				portfolioLTV: '30.00',
			},
			meta: { dataVersion: 5, errors: [] },
		};
		setContextValue(mockValue);

		const result = useBridge();
		expect(result).toBe(mockValue);
		expect(result).toHaveProperty('wallet');
		expect(result).toHaveProperty('permit');
		expect(result).toHaveProperty('data');
		expect(result).toHaveProperty('meta');
	});

	it('returns wallet with connected, address, chainId', () => {
		setContextValue({
			wallet: { connected: true, address: '0xabc', chainId: 421614 },
			permit: { unlocked: false, secondsLeft: 0 },
			data: { ticker: null, markets: null, activities: null, positions: null, strategies: null, proposals: null, community: null, nodeTypes: null, walletBalance: null, portfolioNetValue: null, portfolioLTV: null },
			meta: { dataVersion: 0, errors: [] },
		});
		const result = useBridge();
		expect(result.wallet.connected).toBe(true);
		expect(result.wallet.address).toBe('0xabc');
		expect(result.wallet.chainId).toBe(421614);
	});
});

// ─── VAL-REARCH-PROVIDER-006: useWallet() ────────────────────────────────────

describe('useWallet() (VAL-REARCH-PROVIDER-006)', () => {
	it('returns { connected, address, chainId }', () => {
		setContextValue({
			wallet: { connected: true, address: '0xabc', chainId: 421614 },
			permit: { unlocked: false, secondsLeft: 0 },
			data: { ticker: null, markets: null, activities: null, positions: null, strategies: null, proposals: null, community: null, nodeTypes: null, walletBalance: null, portfolioNetValue: null, portfolioLTV: null },
			meta: { dataVersion: 0, errors: [] },
		});

		const wallet = useWallet();
		expect(wallet).toHaveProperty('connected', true);
		expect(wallet).toHaveProperty('address', '0xabc');
		expect(wallet).toHaveProperty('chainId', 421614);
	});

	it('returns default values when not connected', () => {
		setContextValue({
			wallet: { connected: false, address: null, chainId: null },
			permit: { unlocked: false, secondsLeft: 0 },
			data: { ticker: null, markets: null, activities: null, positions: null, strategies: null, proposals: null, community: null, nodeTypes: null, walletBalance: null, portfolioNetValue: null, portfolioLTV: null },
			meta: { dataVersion: 0, errors: [] },
		});

		const wallet = useWallet();
		expect(wallet.connected).toBe(false);
		expect(wallet.address).toBeNull();
		expect(wallet.chainId).toBeNull();
	});
});

// ─── VAL-REARCH-PROVIDER-007: usePermit() ────────────────────────────────────

describe('usePermit() (VAL-REARCH-PROVIDER-007)', () => {
	it('returns { unlocked, secondsLeft }', () => {
		setContextValue({
			wallet: { connected: false, address: null, chainId: null },
			permit: { unlocked: true, secondsLeft: 850 },
			data: { ticker: null, markets: null, activities: null, positions: null, strategies: null, proposals: null, community: null, nodeTypes: null, walletBalance: null, portfolioNetValue: null, portfolioLTV: null },
			meta: { dataVersion: 0, errors: [] },
		});

		const permit = usePermit();
		expect(permit).toHaveProperty('unlocked', true);
		expect(permit).toHaveProperty('secondsLeft', 850);
	});

	it('returns default state when permit not granted', () => {
		setContextValue({
			wallet: { connected: false, address: null, chainId: null },
			permit: { unlocked: false, secondsLeft: 0 },
			data: { ticker: null, markets: null, activities: null, positions: null, strategies: null, proposals: null, community: null, nodeTypes: null, walletBalance: null, portfolioNetValue: null, portfolioLTV: null },
			meta: { dataVersion: 0, errors: [] },
		});

		const permit = usePermit();
		expect(permit.unlocked).toBe(false);
		expect(permit.secondsLeft).toBe(0);
	});
});

// ─── VAL-REARCH-PROVIDER-008: useBridgeData() ────────────────────────────────

describe('useBridgeData() (VAL-REARCH-PROVIDER-008)', () => {
	it('returns all data arrays', () => {
		const dataState = {
			ticker: ['⧫ 182,944,108'],
			markets: [{ asset: 'ETH', supplyApy: '3.45%' }],
			activities: [{ id: 'act-1', what: 'Supplied 10 ETH' }],
			positions: [{ id: 'pos-1', side: 'supply', asset: 'ETH' }],
			strategies: [{ id: 'strat-1', name: 'Yield Optimizer' }],
			proposals: [{ id: 'prop-1', title: 'Increase ETH CF' }],
			community: [{ id: 'member-1' }],
			nodeTypes: { supply: { label: 'Supply' } },
			walletBalance: '15000',
			portfolioNetValue: '12,000.00',
			portfolioLTV: '30.00',
		};

		setContextValue({
			wallet: { connected: false, address: null, chainId: null },
			permit: { unlocked: false, secondsLeft: 0 },
			data: dataState,
			meta: { dataVersion: 0, errors: [] },
		});

		const data = useBridgeData();
		expect(data).toEqual(dataState);
		expect(data).toHaveProperty('ticker');
		expect(data).toHaveProperty('markets');
		expect(data).toHaveProperty('activities');
		expect(data).toHaveProperty('positions');
		expect(data).toHaveProperty('strategies');
		expect(data).toHaveProperty('proposals');
		expect(data).toHaveProperty('community');
		expect(data).toHaveProperty('nodeTypes');
		expect(data).toHaveProperty('walletBalance');
		expect(data).toHaveProperty('portfolioNetValue');
		expect(data).toHaveProperty('portfolioLTV');
	});
});

// ─── VAL-REARCH-PROVIDER-009: ForgeProvider subscribes, re-renders ──────────

describe('ForgeProvider — BridgeBus subscription and re-render (VAL-REARCH-PROVIDER-009)', () => {
	it('subscribes to all BridgeBus events on mount', () => {
		// Spy on BridgeBus.on to verify events are subscribed.
		// IMPORTANT: the spy MUST pass the callback to originalOn so listeners
		// are properly registered. We save and restore bridgeBus.on afterwards.
		const originalOn = bridgeBus.on.bind(bridgeBus);
		const registeredEvents = [];
		const onSpy = mock(function (event, callback) {
			registeredEvents.push(event);
			return originalOn(event, callback);
		});
		bridgeBus.on = onSpy;

		mountProvider();

		expect(registeredEvents).toContain('wallet:connected');
		expect(registeredEvents).toContain('wallet:disconnected');
		expect(registeredEvents).toContain('wallet:networkChanged');
		expect(registeredEvents).toContain('permit:granted');
		expect(registeredEvents).toContain('permit:expired');
		expect(registeredEvents).toContain('permit:tick');
		expect(registeredEvents).toContain('data:ticker');
		expect(registeredEvents).toContain('data:markets');
		expect(registeredEvents).toContain('data:activities');
		expect(registeredEvents).toContain('data:positions');
		expect(registeredEvents).toContain('data:strategies');
		expect(registeredEvents).toContain('data:proposals');
		expect(registeredEvents).toContain('data:nodeTypes');
		expect(registeredEvents).toContain('data:walletBalance');
		expect(registeredEvents).toContain('error:*');

		// Restore original on method — CRITICAL so subsequent tests work!
		bridgeBus.on = originalOn;

		// Verify spy was called the expected number of times
		// 15 subscriptions total
		expect(registeredEvents.length).toBeGreaterThanOrEqual(15);
	});

	it('updates wallet state on wallet:connected event', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('wallet:connected', {
			connected: true,
			address: '0xABC123',
			chainId: 421614,
		});

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[0]).toHaveProperty('connected', true);
		expect(stateStack[0]).toHaveProperty('address', '0xABC123');
		expect(stateStack[0]).toHaveProperty('chainId', 421614);
	});

	it('updates wallet state on wallet:disconnected event', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('wallet:connected', {
			connected: true,
			address: '0xABC123',
			chainId: 421614,
		});

		bridgeBus.set('wallet:disconnected', {
			connected: false,
			address: null,
			chainId: null,
		});

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[0]).toHaveProperty('connected', false);
		expect(stateStack[0]).toHaveProperty('address', null);
	});

	it('shallow-merges wallet state preserving unchanged fields', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('wallet:connected', {
			connected: true,
			address: '0xabc',
			chainId: 421614,
		});

		bridgeBus.set('wallet:networkChanged', {
			chainId: 1,
		});

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[0]).toHaveProperty('connected', true);
		expect(stateStack[0]).toHaveProperty('address', '0xabc');
		expect(stateStack[0]).toHaveProperty('chainId', 1);
	});

	it('updates permit state on permit:granted event', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('permit:granted', {
			unlocked: true,
			secondsLeft: 900,
		});

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[1]).toHaveProperty('unlocked', true);
		expect(stateStack[1]).toHaveProperty('secondsLeft', 900);
	});

	it('updates permit countdown on permit:tick event', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('permit:granted', { unlocked: true, secondsLeft: 900 });
		bridgeBus.set('permit:tick', { secondsLeft: 899 });

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[1]).toHaveProperty('unlocked', true);
		expect(stateStack[1]).toHaveProperty('secondsLeft', 899);
	});

	it('updates data state on data:ticker event', () => {
		resetGlobalState();
		mountProvider();

		const tickerData = ['⧫ 182,944,108', 'GAS: —'];
		bridgeBus.set('data:ticker', tickerData);

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[2]).toHaveProperty('ticker');
		expect(stateStack[2].ticker).toEqual(tickerData);
	});

	it('updates data state on data:markets event', () => {
		resetGlobalState();
		mountProvider();

		const marketsData = [{ asset: 'ETH', supplyApy: '3.45%' }];
		bridgeBus.set('data:markets', marketsData);

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[2].markets).toEqual(marketsData);
	});

	it('updates data state on data:positions event', () => {
		resetGlobalState();
		mountProvider();

		const positionsData = [{ id: 'pos-1', side: 'supply', asset: 'ETH' }];
		bridgeBus.set('data:positions', positionsData);

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[2].positions).toEqual(positionsData);
	});

	it('updates data version on error:* events', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('error:fetch', { message: 'Network error', source: 'ticker' });

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[3]).toBeGreaterThanOrEqual(1);
	});

	it('multiple data events update state independently', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('data:ticker', ['⧫ 182,944,108']);
		bridgeBus.set('data:markets', [{ asset: 'ETH' }]);
		bridgeBus.set('data:activities', [{ id: 'act-1' }]);
		bridgeBus.set('data:positions', [{ id: 'pos-1' }]);

		const stateStack = __REACT_MOCK__.getStateStack();
		expect(stateStack[2].ticker).toEqual(['⧫ 182,944,108']);
		expect(stateStack[2].markets).toEqual([{ asset: 'ETH' }]);
		expect(stateStack[2].activities).toEqual([{ id: 'act-1' }]);
		expect(stateStack[2].positions).toEqual([{ id: 'pos-1' }]);
	});
});

// ─── VAL-REARCH-PROVIDER-010: Unsubscribe on unmount ────────────────────────

describe('ForgeProvider — unsubscribe on unmount (VAL-REARCH-PROVIDER-010)', () => {
	it('calls all unsubscribe functions on effect cleanup', () => {
		resetGlobalState();

		let unsubscribeCallCount = 0;

		// Wrap bridgeBus.on to return a tracking unsub function
		const originalOn = bridgeBus.on.bind(bridgeBus);
		bridgeBus.on = function (event, callback) {
			const unsub = originalOn(event, callback);
			return function () {
				unsubscribeCallCount++;
				unsub();
			};
		};

		mountProvider();

		// Run effect cleanups
		unmountProvider();

		// Restore original
		bridgeBus.on = originalOn;

		// Each subscription callback should have been called
		expect(unsubscribeCallCount).toBeGreaterThan(0);
		// Should be at least 15 (wallet: 3 + permit: 3 + data: 8 + error:*: 1)
		expect(unsubscribeCallCount).toBeGreaterThanOrEqual(15);
	});

	it('state does not change after cleanup runs (subscriptions removed)', () => {
		resetGlobalState();
		mountProvider();

		const stateBefore = __REACT_MOCK__.getStateStack()[2];

		// Unmount (run cleanups) — this removes all bridgeBus listeners
		unmountProvider();

		// Emit events — should be no-op since listeners were removed
		bridgeBus.set('data:ticker', ['NEW DATA']);

		const stateAfter = __REACT_MOCK__.getStateStack()[2];
		expect(stateAfter.ticker).toBe(stateBefore.ticker);
	});
});

// ─── VAL-REARCH-PROVIDER-011: No key={dataVersion} ──────────────────────────

describe('No key={dataVersion} pattern (VAL-REARCH-PROVIDER-011)', () => {
	// VAL-REARCH-PROVIDER-011: Context updates trigger re-render, not re-mount.
	// ForgeProvider must NOT use key={dataVersion} as a JSX attribute on children.
	it('ForgeProvider uses React.useState for state (not re-mount)', () => {
		const source = require('fs').readFileSync(
			require('path').resolve(import.meta.dirname, '../src/bridge-context.js'),
			'utf-8',
		);
		expect(source).toContain('React.useState');
		expect(source).toContain('BridgeContext.Provider');
		// Verify no React.createElement(..., { key: dataVersion }) pattern
		// (the "no key={dataVersion} pattern" text is only in comments, which is fine)
		expect(source).not.toMatch(/key\s*:\s*dataVersion/);
	});
});

// ─── VAL-REARCH-PROVIDER-014: ForgeProvider does NOT write to window.__MOCK__ ──
//
// __MOCK__ writes were moved to data-fetcher-v2.js (_writeMockData for demo mode,
// _fetchAndTransform for live API).  The ForgeProvider only updates React state
// on BridgeBus data events — it should NOT also write to __MOCK__, which would
// create redundant double-assignments when startDemoMode() calls both
// _writeMockData() and this._bus.set().

describe('ForgeProvider does not write __MOCK__ (VAL-REARCH-PROVIDER-014)', () => {
	it('does not write ticker data to window.__MOCK__.TICKER_ITEMS', () => {
		resetGlobalState();
		mountProvider();

		const ticker = ['⧫ 182,944,108', 'GAS: —'];
		bridgeBus.set('data:ticker', ticker);

		// __MOCK__ writes now happen in data-fetcher-v2.js, not in ForgeProvider
		expect(window.__MOCK__.TICKER_ITEMS).toBeUndefined();
	});

	it('does not write markets data to window.__MOCK__.L_MARKETS', () => {
		resetGlobalState();
		mountProvider();

		const markets = [{ asset: 'ETH', supplyApy: '3.45%' }];
		bridgeBus.set('data:markets', markets);

		expect(window.__MOCK__.L_MARKETS).toBeUndefined();
	});

	it('does not write activities data to window.__MOCK__.D_ACTIVITY', () => {
		resetGlobalState();
		mountProvider();

		const activities = [{ id: 'act-1', what: 'Supplied 10 ETH' }];
		bridgeBus.set('data:activities', activities);

		expect(window.__MOCK__.D_ACTIVITY).toBeUndefined();
	});

	it('does not write positions data to window.__MOCK__.D_POSITIONS', () => {
		resetGlobalState();
		mountProvider();

		const positions = [{ id: 'pos-1', side: 'supply', asset: 'ETH' }];
		bridgeBus.set('data:positions', positions);

		expect(window.__MOCK__.D_POSITIONS).toBeUndefined();
	});

	it('does not write strategies data to window.__MOCK__.D_STRATS', () => {
		resetGlobalState();
		mountProvider();

		const strats = [{ id: 'strat-1', name: 'Yield Optimizer' }];
		bridgeBus.set('data:strategies', strats);

		expect(window.__MOCK__.D_STRATS).toBeUndefined();
	});

	it('does not write proposals data to window.__MOCK__.PROPOSALS', () => {
		resetGlobalState();
		mountProvider();

		const proposals = [{ id: 'prop-1', title: 'Increase ETH CF' }];
		bridgeBus.set('data:proposals', proposals);

		expect(window.__MOCK__.PROPOSALS).toBeUndefined();
	});

	it('does not write nodeTypes data to window.__MOCK__.NODE_TYPES', () => {
		resetGlobalState();
		mountProvider();

		const nodeTypes = { supply: { label: 'Supply' } };
		bridgeBus.set('data:nodeTypes', nodeTypes);

		expect(window.__MOCK__.NODE_TYPES).toBeUndefined();
	});

	it('does not write walletBalance to __MOCK__ (no backward compat key)', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('data:walletBalance', '15000');
		expect(window.__MOCK__.WALLET_BALANCE).toBeUndefined();
	});

	it('does not throw when window.__MOCK__ is undefined', () => {
		resetGlobalState();

		const savedMock = window.__MOCK__;
		delete window.__MOCK__;

		mountProvider();

		expect(function () {
			bridgeBus.set('data:ticker', ['test']);
		}).not.toThrow();

		window.__MOCK__ = savedMock;
	});
});

// ─── VAL-REARCH-PROVIDER-015: Public data polling starts on mount ──────────

describe('Public data polling on mount (VAL-REARCH-PROVIDER-015)', () => {
	it('calls DataFetcherV2.startPublicPolling on mount', () => {
		resetGlobalState();

		let startPublicPollingCalled = false;
		let createdOptions = null;

		// Use a plain constructor (not mock) so `new` works correctly
		window.DataFetcherV2 = function DataFetcherV2(options) {
			createdOptions = options;
			this.startPublicPolling = function () {
				startPublicPollingCalled = true;
			};
			this.stopAll = function () {};
		};

		mountProvider();

		expect(startPublicPollingCalled).toBe(true);
		expect(createdOptions).not.toBeNull();
		expect(createdOptions).toHaveProperty('bus');
		expect(createdOptions.bus).toBe(bridgeBus);
	});

	it('calls startPublicPolling only once regardless of mount count', () => {
		resetGlobalState();

		let callCount = 0;
		window.DataFetcherV2 = function DataFetcherV2() {
			this.startPublicPolling = function () {
				callCount++;
			};
			this.stopAll = function () {};
		};

		mountProvider();
		mountProvider();
		mountProvider();

		expect(callCount).toBe(1);
	});
});

// ─── Component rendering ─────────────────────────────────────────────────────

describe('ForgeProvider — component rendering', () => {
	it('renders children wrapped in ForgeErrorBoundary > BridgeContext.Provider', () => {
		resetGlobalState();

		const children = 'test-content';
		const result = ForgeProvider({ children: children });

		// Outer wrapper is ForgeErrorBoundary (class component)
		expect(result).toHaveProperty('comp');
		expect(result.comp.name).toBe('ForgeErrorBoundary');
		// First child of ForgeErrorBoundary is BridgeContext.Provider
		expect(Array.isArray(result.children)).toBe(true);
		const providerEl = result.children[0];
		expect(providerEl).toHaveProperty('comp', BridgeContext.Provider);
		// Children are inside BridgeContext.Provider
		expect(providerEl.children).toContain(children);
	});

	it('provider value contains correct initial state', () => {
		resetGlobalState();

		ForgeProvider({ children: 'test' });

		const stateStack = __REACT_MOCK__.getStateStack();

		expect(stateStack[0]).toEqual({
			connected: false,
			address: null,
			chainId: null,
		});

		expect(stateStack[1]).toEqual({
			unlocked: false,
			secondsLeft: 0,
		});

		expect(stateStack[2]).toHaveProperty('ticker', null);
		expect(stateStack[2]).toHaveProperty('markets', null);
		expect(stateStack[2]).toHaveProperty('activities', null);
		expect(stateStack[2]).toHaveProperty('positions', null);
		expect(stateStack[2]).toHaveProperty('strategies', null);
		expect(stateStack[2]).toHaveProperty('proposals', null);
		expect(stateStack[2]).toHaveProperty('community', null);
		expect(stateStack[2]).toHaveProperty('nodeTypes', null);
		expect(stateStack[2]).toHaveProperty('walletBalance', null);

		expect(stateStack[3]).toBe(0);
	});
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
	it('handles missing DataFetcherV2 without throwing', () => {
		resetGlobalState();

		const saved = window.DataFetcherV2;
		delete window.DataFetcherV2;

		expect(function () {
			mountProvider();
		}).not.toThrow();

		window.DataFetcherV2 = saved;
	});

	it('handles DataFetcherV2 constructor throwing without breaking provider', () => {
		resetGlobalState();

		window.DataFetcherV2 = function DataFetcherV2() {
			throw new Error('Constructor failed');
		};

		expect(function () {
			mountProvider();
		}).not.toThrow();
	});

	it('walletBalance event does not write to __MOCK__', () => {
		resetGlobalState();
		mountProvider();

		bridgeBus.set('data:walletBalance', '15000.50');

		const mockKeys = Object.keys(window.__MOCK__);
		expect(mockKeys).not.toContain('WALLET_BALANCE');
	});
});
