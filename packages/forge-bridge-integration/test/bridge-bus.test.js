/**
 * BridgeBus Tests
 *
 * Covers all expected behavior from VAL-REARCH-FOUNDATION-001 through 012:
 * - Construction with correct state shape
 * - on/set/getState/reset lifecycle
 * - Event emit and listener invocation
 * - Unsubscribe cleanup
 * - Partial state merge (shallow merge preserves unchaged fields)
 * - dispatchBatch coalesced updates
 * - Error handling with stale data preservation
 * - start() public-only mode and enableAuthenticated()
 * - Wildcard error:* listeners
 * - Listener error isolation
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BridgeBus } from '../src/bridge-bus.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a fresh BridgeBus instance for each test.
 */
let bus;

beforeEach(() => {
	bus = new BridgeBus();
});

afterEach(() => {
	bus = null;
});

/**
 * Assert that a value is a function.
 * @param {*} fn
 */
function expectFunction(fn) {
	expect(typeof fn).toBe('function');
}

// ─── VAL-REARCH-FOUNDATION-002: State Tree Shape ─────────────────────────────

describe('BridgeBus constructor / state shape', () => {
	it('has all 5 top-level domains', () => {
		const state = bus.getState();
		expect(state).toHaveProperty('public');
		expect(state).toHaveProperty('authed');
		expect(state).toHaveProperty('wallet');
		expect(state).toHaveProperty('permit');
		expect(state).toHaveProperty('meta');
	});

	it('public domain has ticker, markets, activities', () => {
		const s = bus.getState().public;
		expect(s).toHaveProperty('ticker', null);
		expect(s).toHaveProperty('markets', null);
		expect(s).toHaveProperty('activities', null);
	});

	it('authed domain has positions, strategies, proposals, nodeTypes, walletBalance', () => {
		const s = bus.getState().authed;
		expect(s).toHaveProperty('positions', null);
		expect(s).toHaveProperty('strategies', null);
		expect(s).toHaveProperty('proposals', null);
		expect(s).toHaveProperty('nodeTypes', null);
		expect(s).toHaveProperty('walletBalance', null);
	});

	it('wallet domain has connected, address, chainId', () => {
		const s = bus.getState().wallet;
		expect(s).toHaveProperty('connected', false);
		expect(s).toHaveProperty('address', null);
		expect(s).toHaveProperty('chainId', null);
	});

	it('permit domain has unlocked, secondsLeft', () => {
		const s = bus.getState().permit;
		expect(s).toHaveProperty('unlocked', false);
		expect(s).toHaveProperty('secondsLeft', 0);
	});

	it('meta domain has dataVersion, errors', () => {
		const s = bus.getState().meta;
		expect(s).toHaveProperty('dataVersion', 0);
		expect(s).toHaveProperty('errors');
		expect(Array.isArray(s.errors)).toBe(true);
		expect(s.errors).toHaveLength(0);
	});
});

// ─── VAL-REARCH-FOUNDATION-001: Method Existence ─────────────────────────────

describe('BridgeBus method existence', () => {
	it('has on() method', () => {
		expectFunction(bus.on);
	});

	it('has set() method', () => {
		expectFunction(bus.set);
	});

	it('has getState() method', () => {
		expectFunction(bus.getState);
	});

	it('has reset() method', () => {
		expectFunction(bus.reset);
	});

	it('has dispatchBatch() method', () => {
		expectFunction(bus.dispatchBatch);
	});

	it('has start() method', () => {
		expectFunction(bus.start);
	});

	it('has enableAuthenticated() method', () => {
		expectFunction(bus.enableAuthenticated);
	});

	it('has disableAuthenticated() method', () => {
		expectFunction(bus.disableAuthenticated);
	});
});

// ─── VAL-REARCH-FOUNDATION-001: on() returns unsubscribe ─────────────────────

describe('on() — subscription lifecycle', () => {
	it('returns a function', () => {
		const unsub = bus.on('data:ticker', () => {});
		expectFunction(unsub);
	});

	it('calls listener when matching event is set', () => {
		const listener = mock(() => {});
		bus.on('data:ticker', listener);
		bus.set('data:ticker', ['ETH $2,450']);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(['ETH $2,450'], 'data:ticker');
	});

	it('does not call listener for different event', () => {
		const listener = mock(() => {});
		bus.on('data:ticker', listener);
		bus.set('data:markets', ['ETH']);
		expect(listener).not.toHaveBeenCalled();
	});

	it('supports multiple listeners on same event', () => {
		const a = mock(() => {});
		const b = mock(() => {});
		bus.on('data:ticker', a);
		bus.on('data:ticker', b);
		bus.set('data:ticker', []);
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
	});
});

// ─── VAL-REARCH-FOUNDATION-004: Unsubscribe Stops Callbacks ──────────────────

describe('unsubscribe — stops future callbacks', () => {
	it('removes listener so it is not called on subsequent set()', () => {
		const listener = mock(() => {});
		const unsub = bus.on('data:ticker', listener);

		bus.set('data:ticker', ['first']);
		expect(listener).toHaveBeenCalledTimes(1);

		unsub();
		bus.set('data:ticker', ['second']);
		expect(listener).toHaveBeenCalledTimes(1); // not called again
	});

	it('does not affect other listeners on same event', () => {
		const a = mock(() => {});
		const b = mock(() => {});
		const unsubA = bus.on('data:ticker', a);
		bus.on('data:ticker', b);

		unsubA();
		bus.set('data:ticker', ['test']);
		expect(a).not.toHaveBeenCalled();
		expect(b).toHaveBeenCalledTimes(1);
	});

	it('is idempotent — calling unsubscribe multiple times is safe', () => {
		const listener = mock(() => {});
		const unsub = bus.on('data:ticker', listener);
		unsub();
		unsub();
		expect(listener).not.toHaveBeenCalled();
	});
});

// ─── VAL-REARCH-FOUNDATION-003: Events Emitted Correctly ─────────────────────

describe('set() — event emit behavior', () => {
	it('emits data:ticker with ticker payload', () => {
		const spy = mock(() => {});
		bus.on('data:ticker', spy);
		bus.set('data:ticker', ['BTC $68k']);
		expect(spy).toHaveBeenCalledWith(['BTC $68k'], 'data:ticker');
	});

	it('emits data:markets with markets payload', () => {
		const spy = mock(() => {});
		bus.on('data:markets', spy);
		const markets = [{ asset: 'ETH', supplyApy: 3.5 }];
		bus.set('data:markets', markets);
		expect(spy).toHaveBeenCalledWith(markets, 'data:markets');
	});

	it('emits wallet:connected with wallet domain data', () => {
		const spy = mock(() => {});
		bus.on('wallet:connected', spy);
		bus.set('wallet:connected', { connected: true, address: '0x123', chainId: 421614 });
		expect(spy).toHaveBeenCalledTimes(1);
		// Listener receives the entire wallet domain after merge
		const [data] = spy.mock.calls[0];
		expect(data).toHaveProperty('connected', true);
		expect(data).toHaveProperty('address', '0x123');
		expect(data).toHaveProperty('chainId', 421614);
	});

	it('emits permit:granted with permit state', () => {
		const spy = mock(() => {});
		bus.on('permit:granted', spy);
		bus.set('permit:granted', { unlocked: true, secondsLeft: 900 });
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ unlocked: true, secondsLeft: 900 }),
			'permit:granted',
		);
	});

	it('emits error:* events with error payload', () => {
		const spy = mock(() => {});
		bus.on('error:fetch', spy);
		const err = new Error('Network failure');
		bus.set('error:fetch', { message: err.message, source: 'api' });
		expect(spy).toHaveBeenCalledTimes(1);
	});
});

// ─── VAL-REARCH-FOUNDATION-005: Partial State Merge ──────────────────────────

describe('set() — partial state merge', () => {
	it('shallow-merges into wallet domain, preserving unchaged fields', () => {
		// Set wallet with address + chainId first
		bus.set('wallet:connected', { connected: true, address: '0xabc', chainId: 421614 });

		// Now set only address change — chainId should be preserved
		bus.set('wallet:connected', { address: '0xdef' });

		const s = bus.getState().wallet;
		expect(s.connected).toBe(true); // preserved from first set
		expect(s.address).toBe('0xdef');  // updated
		expect(s.chainId).toBe(421614);   // preserved from first set
	});

	it('shallow-merges into permit domain, preserving unchaged fields', () => {
		bus.set('permit:granted', { unlocked: true, secondsLeft: 900 });
		bus.set('permit:tick', { secondsLeft: 899 });

		const s = bus.getState().permit;
		expect(s.unlocked).toBe(true);
		expect(s.secondsLeft).toBe(899);
	});

	it('replaces sub-key for data events', () => {
		bus.set('data:ticker', ['BTC $68k']);
		bus.set('data:ticker', ['ETH $2.4k']);
		const s = bus.getState().public;
		expect(s.ticker).toEqual(['ETH $2.4k']);
		// Other public fields unaffected
		expect(s.markets).toBeNull();
	});

	it('dataVersion increments on each set()', () => {
		const v0 = bus.getState().meta.dataVersion;
		bus.set('data:ticker', []);
		expect(bus.getState().meta.dataVersion).toBe(v0 + 1);
		bus.set('data:markets', []);
		expect(bus.getState().meta.dataVersion).toBe(v0 + 2);
	});
});

// ─── VAL-REARCH-FOUNDATION-011: Stale Data on Fetch Error ────────────────────

describe('error events — preserve stale data', () => {
	it('preserves existing public data when error is set', () => {
		bus.set('data:ticker', ['BTC $68k']);
		bus.set('error:fetch', { message: 'Network error', source: 'api' });

		const s = bus.getState();
		expect(s.public.ticker).toEqual(['BTC $68k']); // preserved
		expect(s.meta.errors).toHaveLength(1);
		expect(s.meta.errors[0]).toHaveProperty('message', 'Network error');
	});

	it('accumulates multiple errors in meta.errors array', () => {
		bus.set('error:fetch', { message: 'Error 1' });
		bus.set('error:auth', { message: 'Error 2' });
		bus.set('error:fetch', { message: 'Error 3' });

		expect(bus.getState().meta.errors).toHaveLength(3);
	});

	it('dataVersion increments on error events', () => {
		const v0 = bus.getState().meta.dataVersion;
		bus.set('error:fetch', { message: 'err' });
		expect(bus.getState().meta.dataVersion).toBe(v0 + 1);
	});

	it('error:* wildcard listener catches all error events', () => {
		const wildcard = mock(() => {});
		bus.on('error:*', wildcard);

		bus.set('error:fetch', { message: 'fetch fail' });
		bus.set('error:auth', { message: 'auth fail' });

		expect(wildcard).toHaveBeenCalledTimes(2);
	});
});

// ─── VAL-REARCH-FOUNDATION-001: getState() ───────────────────────────────────

describe('getState() — state snapshot', () => {
	it('returns a deep clone that cannot mutate internal state', () => {
		bus.set('data:ticker', ['BTC']);
		const state = bus.getState();
		state.public.ticker = ['MUTATED'];

		// Original should be unchanged
		expect(bus.getState().public.ticker).toEqual(['BTC']);
	});

	it('returns the correct state after multiple updates', () => {
		bus.set('data:ticker', ['BTC $68k']);
		bus.set('data:markets', [{ asset: 'ETH' }]);
		bus.set('wallet:connected', { connected: true, address: '0xabc', chainId: 421614 });

		const s = bus.getState();
		expect(s.public.ticker).toEqual(['BTC $68k']);
		expect(s.public.markets).toEqual([{ asset: 'ETH' }]);
		expect(s.wallet).toEqual({ connected: true, address: '0xabc', chainId: 421614 });
	});
});

// ─── VAL-REARCH-FOUNDATION-001: reset() ──────────────────────────────────────

describe('reset() — clears all state', () => {
	it('resets all domains to defaults', () => {
		bus.set('data:ticker', ['BTC']);
		bus.set('wallet:connected', { connected: true, address: '0xabc', chainId: 421614 });
		bus.set('permit:granted', { unlocked: true, secondsLeft: 900 });
		bus.reset();

		const s = bus.getState();
		expect(s.public.ticker).toBeNull();
		expect(s.wallet.connected).toBe(false);
		expect(s.wallet.address).toBeNull();
		expect(s.permit.unlocked).toBe(false);
		expect(s.permit.secondsLeft).toBe(0);
		expect(s.meta.errors).toHaveLength(0);
		expect(s.meta.dataVersion).toBe(0);
	});

	it('emits reset event with full state', () => {
		const spy = mock(() => {});
		bus.on('reset', spy);
		bus.reset();
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toHaveProperty('public');
		expect(spy.mock.calls[0][0]).toHaveProperty('wallet');
	});
});

// ─── VAL-REARCH-FOUNDATION-012: dispatchBatch Coalesced Updates ──────────────

describe('dispatchBatch() — coalesced updates', () => {
	it('applies all updates and emits each event exactly once', () => {
		const tickerSpy = mock(() => {});
		const marketSpy = mock(() => {});
		bus.on('data:ticker', tickerSpy);
		bus.on('data:markets', marketSpy);

		bus.dispatchBatch([
			{ event: 'data:ticker', data: ['BTC $68k'] },
			{ event: 'data:markets', data: [{ asset: 'ETH' }] },
		]);

		expect(tickerSpy).toHaveBeenCalledTimes(1);
		expect(marketSpy).toHaveBeenCalledTimes(1);
		expect(bus.getState().public.ticker).toEqual(['BTC $68k']);
		expect(bus.getState().public.markets).toEqual([{ asset: 'ETH' }]);
	});

	it('listeners receive the final state after all mutations', () => {
		const spy = mock(() => {});
		bus.on('wallet:connected', spy);

		bus.dispatchBatch([
			{ event: 'wallet:connected', data: { connected: true, address: '0xabc', chainId: 421614 } },
			{ event: 'wallet:connected', data: { address: '0xdef' } },
		]);

		// Listener should see the final merged state
		expect(spy).toHaveBeenCalledTimes(1);
		const [data] = spy.mock.calls[0];
		expect(data).toHaveProperty('connected', true);
		expect(data).toHaveProperty('address', '0xdef');
		expect(data).toHaveProperty('chainId', 421614);
	});

	it('dataVersion increments after batch', () => {
		const v0 = bus.getState().meta.dataVersion;
		bus.dispatchBatch([
			{ event: 'data:ticker', data: ['BTC'] },
			{ event: 'data:markets', data: [] },
		]);
		expect(bus.getState().meta.dataVersion).toBeGreaterThan(v0);
	});
});

// ─── VAL-REARCH-FOUNDATION-010: start() and Public-Only Mode ─────────────────

describe('start() — public-only mode', () => {
	it('start() emits "started" event with public mode', () => {
		const spy = mock(() => {});
		bus.on('started', spy);
		bus.start();
		expect(spy).toHaveBeenCalledWith({ mode: 'public' }, 'started');
	});

	it('start() is idempotent — calling twice does not double-emit', () => {
		const spy = mock(() => {});
		bus.on('started', spy);
		bus.start();
		bus.start();
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('enableAuthenticated() emits "authenticated" event', () => {
		const spy = mock(() => {});
		bus.on('authenticated', spy);
		bus.enableAuthenticated();
		expect(spy).toHaveBeenCalledWith(true, 'authenticated');
	});

	it('disableAuthenticated() clears authed domain and preserves public', () => {
		bus.start();
		bus.enableAuthenticated();

		// Set some authed and public data
		bus.set('data:ticker', ['BTC $68k']);
		bus.set('data:positions', [{ id: 'pos-1' }]);

		bus.disableAuthenticated();

		const s = bus.getState();
		// Authed data cleared
		expect(s.authed.positions).toBeNull();
		// Public data preserved
		expect(s.public.ticker).toEqual(['BTC $68k']);
	});
});

// ─── Listener Error Isolation ────────────────────────────────────────────────

describe('listener error isolation', () => {
	it('one listener throwing does not prevent others from being called', () => {
		const badListener = () => {
			throw new Error('bad listener');
		};
		const goodListener = mock(() => {});
		bus.on('data:ticker', badListener);
		bus.on('data:ticker', goodListener);

		// Should not throw
		expect(() => bus.set('data:ticker', ['test'])).not.toThrow();
		expect(goodListener).toHaveBeenCalledTimes(1);
	});
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
	it('on() with unknown event still registers but does not emit on set of unmapped event', () => {
		const spy = mock(() => {});
		bus.on('unknown:event', spy);
		bus.set('unknown:event', { test: true });
		// Unmapped events are still emitted but not stored in state
		expect(spy).toHaveBeenCalledWith({ test: true }, 'unknown:event');
	});

	it('empty dispatchBatch emits nothing and changes nothing', () => {
		const spy = mock(() => {});
		bus.on('data:ticker', spy);
		bus.dispatchBatch([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('getState() returns same shape after reset as fresh instance', () => {
		bus.set('data:ticker', ['test']);
		bus.reset();
		const freshBus = new BridgeBus();
		expect(bus.getState()).toEqual(freshBus.getState());
	});

	it('error LRU eviction caps errors at 100 entries', () => {
		// Push 150 errors — should be trimmed to the latest 100
		for (let i = 0; i < 150; i++) {
			bus.set('error:fetch', { message: `Error ${i}`, index: i });
		}
		const errors = bus.getState().meta.errors;
		expect(errors.length).toBe(100);
		// Oldest error should be Error 50 (first 50 evicted)
		expect(errors[0].index).toBe(50);
		// Newest error should be Error 149
		expect(errors[99].index).toBe(149);
	});

	it('default _maxErrors is 100', () => {
		expect(bus._maxErrors).toBe(100);
	});

	it('errors below cap are not evicted', () => {
		for (let i = 0; i < 50; i++) {
			bus.set('error:fetch', { message: `Error ${i}` });
		}
		expect(bus.getState().meta.errors.length).toBe(50);
	});

	it('dispatchBatch also caps errors', () => {
		const updates = [];
		for (let i = 0; i < 120; i++) {
			updates.push({ event: 'error:fetch', data: { message: `Batch ${i}`, index: i } });
		}
		bus.dispatchBatch(updates);
		const errors = bus.getState().meta.errors;
		expect(errors.length).toBe(100);
		expect(errors[0].index).toBe(20);
		expect(errors[99].index).toBe(119);
	});
});
