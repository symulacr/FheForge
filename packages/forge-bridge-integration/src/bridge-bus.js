/**
 * @file BridgeBus — Singleton event emitter with reactive state store.
 *
 * Central data bus for the FheForge integration layer. Holds state domains
 * for public data, authenticated data, wallet state, permit state, and meta.
 * Components subscribe to domain events and receive partial state updates.
 *
 * Events follow the pattern:
 *   - data:<key> — public or authed data updates (ticker, markets, positions, etc.)
 *   - wallet:<action> — wallet state changes (connected, disconnected, networkChanged)
 *   - permit:<action> — permit state changes (granted, expired, tick)
 *   - error:<source> — error events (fetch, auth, etc.) — wildcard error:* catches all
 *
 * @example
 * ```js
 * import bridgeBus from './bridge-bus.js';
 *
 * // Subscribe to ticker updates
 * const unsub = bridgeBus.on('data:ticker', (ticker) => { ... });
 *
 * // Update ticker data — merges into state.public.ticker, emits 'data:ticker'
 * bridgeBus.set('data:ticker', ['ETH $2,450', 'BTC $68,412']);
 *
 * // Get current state snapshot
 * const state = bridgeBus.getState();
 *
 * // Clean up listener
 * unsub();
 * ```
 *
 * State shape (VAL-REARCH-FOUNDATION-002):
 *   public:  { ticker, markets, activities }
 *   authed:  { positions, strategies, proposals, nodeTypes, walletBalance }
 *   wallet:  { connected, address, chainId }
 *   permit:  { unlocked, secondsLeft }
 *   meta:    { dataVersion, errors }
 */

// ─── Default State ──────────────────────────────────────────────────────────

const DEFAULT_STATE = Object.freeze({
  public: {
    ticker: null,
    markets: null,
    activities: null,
  },
  authed: {
    positions: null,
    strategies: null,
    proposals: null,
    nodeTypes: null,
    walletBalance: null,
  },
  wallet: {
    connected: false,
    address: null,
    chainId: null,
  },
  permit: {
    unlocked: false,
    secondsLeft: 0,
  },
  meta: {
    dataVersion: 0,
    errors: [],
  },
});

// ─── Event Mapping ──────────────────────────────────────────────────────────

const EVENT_MAP = {
  // Events → public domain
  'data:ticker': { domain: 'public', key: 'ticker' },
  'data:markets': { domain: 'public', key: 'markets' },
  'data:activities': { domain: 'public', key: 'activities' },
  // Events → authed domain
  'data:positions': { domain: 'authed', key: 'positions' },
  'data:strategies': { domain: 'authed', key: 'strategies' },
  'data:proposals': { domain: 'authed', key: 'proposals' },
  'data:community': { domain: 'authed', key: 'community' },
  'data:templates': { domain: 'authed', key: 'templates' },
  'data:nodeTypes': { domain: 'authed', key: 'nodeTypes' },
  'data:walletBalance': { domain: 'authed', key: 'walletBalance' },
  // Events → public domain (readiness)
  'data:readiness': { domain: 'public', key: 'readiness' },
  // Events → wallet domain (shallow-merge into entire domain)
  'wallet:connected': { domain: 'wallet', key: null },
  'wallet:disconnected': { domain: 'wallet', key: null },
  'wallet:networkChanged': { domain: 'wallet', key: null },
  // Events → permit domain (shallow-merge into entire domain)
  'permit:granted': { domain: 'permit', key: null },
  'permit:expired': { domain: 'permit', key: null },
  'permit:tick': { domain: 'permit', key: null },
};

// ─── BridgeBus Class ────────────────────────────────────────────────────────

export class BridgeBus {
  constructor() {
    this._resetState();
    this._listeners = new Map();
    this._started = false;
    this._authEnabled = false;
    this._maxErrors = 100;
  }

  /** Reset state to defaults, preserving listeners. */
  _resetState() {
    this._state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Subscribe to a named event; returns unsubscribe function. */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    const self = this;
    return function unsubscribe() {
      const set = self._listeners.get(event);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          self._listeners.delete(event);
        }
      }
    };
  }

  /** Update state for a given event and notify listeners. */
  set(event, data) {
    if (event.startsWith('error:')) {
      this._state.meta.errors = this._recordError(this._state.meta.errors, data);
      this._emitEvent(event, data, true);
      return;
    }

    if (event === 'reset') {
      this._resetState();
      this._emitEvent('reset', this.getState());
      return;
    }

    const next = { ...this._state };
    if (!this._applyUpdate(next, event, data)) {
      // Unmapped event — emit but don't store in state
      this._emitEvent(event, data);
      return;
    }
    next.meta = { ...next.meta, dataVersion: next.meta.dataVersion + 1 };
    this._state = next;

    const { domain, key } = EVENT_MAP[event];
    this._emitEvent(event, this._getDomainData(domain, key));
  }

  /** Subscribe to state changes for useSyncExternalStore. */
  subscribe(callback) {
    return this.on('_change', callback);
  }

  /** Return current mutable state snapshot for useSyncExternalStore. */
  getSnapshot() {
    return this._state;
  }

  /** Return a deep-cloned snapshot of the current state. */
  getState() {
    return JSON.parse(JSON.stringify(this._state));
  }

  /** Reset all state to defaults and emit 'reset' event. Preserves listeners. */
  reset() {
    this._resetState();
    this._started = false;
    this._authEnabled = false;
    this._emitEvent('reset', this.getState());
  }

  /** Update multiple domains in a single coalesced notification cycle. */
  dispatchBatch(updates) {
    if (updates.length === 0) return;

    const eventsToEmit = [];
    const errorEventsToEmit = [];
    let hasDataUpdates = false;

    const next = { ...this._state };
    // Work on a fresh errors array for error accumulation
    let errors = [...next.meta.errors];

    for (const { event, data } of updates) {
      if (event.startsWith('error:')) {
        errors = this._recordError(errors, data);
        if (!errorEventsToEmit.includes(event)) errorEventsToEmit.push(event);
        continue;
      }

      if (this._applyUpdate(next, event, data)) {
        hasDataUpdates = true;
        if (!eventsToEmit.includes(event)) eventsToEmit.push(event);
      }
    }

    // Apply accumulated errors to current state (in-place for error-only batches)
    this._state.meta.errors = errors;

    if (hasDataUpdates) {
      next.meta.errors = errors;
      next.meta.dataVersion++;
      this._state = next;
    }

    // Emit errors, then data events, then _change once
    for (const event of errorEventsToEmit) this._emitEvent(event, null, true, true);
    for (const event of eventsToEmit) {
      const { domain, key } = EVENT_MAP[event];
      this._emitEvent(event, this._getDomainData(domain, key), false, true);
    }
    if (hasDataUpdates || errorEventsToEmit.length > 0) {
      this._emit(this._listeners, '_change', this._state);
    }
  }

  /** Start BridgeBus in public-only mode. Idempotent. */
  start() {
    if (this._started) return;
    this._started = true;
    this._authEnabled = false;
    this._emitEvent('started', { mode: 'public' });
  }

  /** Enable authenticated data writes. Replays deferred authed data. */
  enableAuthenticated() {
    this._authEnabled = true;
    for (const [key, mapping] of Object.entries(EVENT_MAP)) {
      if (mapping.domain === 'authed' && this._state.authed[mapping.key] != null) {
        this._emit(this._listeners, key, this._state.authed[mapping.key]);
      }
    }
    this._emitEvent('authenticated', true);
  }

  /** Disable authenticated data writes and clear authed domain. */
  disableAuthenticated() {
    this._authEnabled = false;
    this._state.authed = JSON.parse(JSON.stringify(DEFAULT_STATE.authed));
    this._emitEvent('authenticated', false);
  }

  /** Check if public-only mode is active. */
  isPublicOnly() {
    return this._started && !this._authEnabled;
  }

  /** Check if authenticated mode is active. */
  isAuthenticated() {
    return this._started && this._authEnabled;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  /** Apply an event mapping to `next` state. Returns true if applied. */
  _applyUpdate(next, event, data) {
    const mapping = EVENT_MAP[event];
    if (!mapping) return false;
    const { domain, key } = mapping;
    if (domain === 'authed' && !this._authEnabled && this._started) return false;
    next[domain] = key === null
      ? { ...next[domain], ...data }
      : { ...next[domain], [key]: data };
    return true;
  }

  /** Append error to `errors`, LRU-trim to maxErrors. Returns the (possibly new) array. */
  _recordError(errors, data) {
    const result = [...errors, data];
    return result.length > this._maxErrors ? result.slice(-this._maxErrors) : result;
  }

  /** Emit event to exact-match and wildcard listeners. */
  _emitEvent(event, data, withWildcard = false, skipChange = false) {
    this._emit(this._listeners, event, data);
    if (withWildcard && event.startsWith('error:')) {
      this._emit(this._listeners, 'error:*', data);
    }
    if (!skipChange && event !== '_change') {
      this._emit(this._listeners, '_change', this._state);
    }
  }

  /** Invoke all listeners for `event` from `map`, catching per-listener errors. */
  _emit(map, event, data) {
    const listeners = map.get(event);
    if (!listeners) return;
    for (const cb of listeners) {
      try { cb(data, event); }
      catch (err) { console.error(`[BridgeBus] Listener error for "${event}":`, err); }
    }
  }

  /** Get domain data for event emission. */
  _getDomainData(domain, key) {
    return key === null ? this._state[domain] : this._state[domain][key];
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

/**
 * Pre-created singleton instance for application-wide use.
 * In the browser, this should be attached to window.__bridgeBus.
 *
 * For testing, import BridgeBus directly and create isolated instances.
 *
 * @type {BridgeBus}
 */
const bridgeBus = new BridgeBus();
export default bridgeBus;
