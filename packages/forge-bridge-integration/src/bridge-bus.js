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

/** @type {BridgeState} */
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

/**
 * @typedef {{
 *   public:    { ticker: *, markets: *, activities: * },
 *   authed:    { positions: *, strategies: *, proposals: *, nodeTypes: *, walletBalance: * },
 *   wallet:    { connected: boolean, address: ?string, chainId: ?number },
 *   permit:    { unlocked: boolean, secondsLeft: number },
 *   meta:      { dataVersion: number, errors: Array<*> }
 * }} BridgeState
 */

// ─── Event Mapping ──────────────────────────────────────────────────────────

/**
 * Maps event names to their target domain and optional sub-key.
 * Domain-level events (wallet:*, permit:*) merge into the entire domain.
 * Sub-key events (data:*) write to a specific key within a domain.
 */
const EVENT_MAP = {
	// Events → public domain
	"data:ticker": { domain: "public", key: "ticker" },
	"data:markets": { domain: "public", key: "markets" },
	"data:activities": { domain: "public", key: "activities" },
	// Events → authed domain
	"data:positions": { domain: "authed", key: "positions" },
	"data:strategies": { domain: "authed", key: "strategies" },
	"data:proposals": { domain: "authed", key: "proposals" },
	"data:community": { domain: "authed", key: "community" },
	"data:templates": { domain: "authed", key: "templates" },
	"data:nodeTypes": { domain: "authed", key: "nodeTypes" },
	"data:walletBalance": { domain: "authed", key: "walletBalance" },
	// Events → public domain (readiness)
	"data:readiness": { domain: "public", key: "readiness" },
	// Events → wallet domain (shallow-merge into entire domain)
	"wallet:connected": { domain: "wallet", key: null },
	"wallet:disconnected": { domain: "wallet", key: null },
	"wallet:networkChanged": { domain: "wallet", key: null },
	// Events → permit domain (shallow-merge into entire domain)
	"permit:granted": { domain: "permit", key: null },
	"permit:expired": { domain: "permit", key: null },
	"permit:tick": { domain: "permit", key: null },
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

	/**
	 * Reset state to defaults, preserving listeners.
	 * Called from constructor and reset().
	 */
	_resetState() {
		this._state = JSON.parse(JSON.stringify(DEFAULT_STATE));
	}

	// ── Public API ─────────────────────────────────────────────────────────

	/**
	 * Subscribe to a named event.
	 *
	 * @param {string} event - Event name (e.g. 'data:ticker', 'wallet:connected', 'error:*')
	 * @param {(data: any, eventName: string) => void} callback - Handler invoked with (payload, eventName)
	 * @returns {() => void} Unsubscribe function — calling it removes this listener.
	 */
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

	/**
	 * Update state for a given event and notify listeners.
	 *
	 * For data events (data:ticker, data:markets, etc.), the payload is assigned
	 * to the corresponding sub-key within the domain.
	 *
	 * For domain events (wallet:*, permit:*), the payload is shallow-merged into
	 * the entire domain — unchanged fields are preserved.
	 *
	 * For error events (error:*), the error is appended to meta.errors and
	 * existing domain data is preserved (stale-while-revalidate).
	 *
	 * @param {string} event - Event name
	 * @param {*} data - Data to store / merge
	 */
	set(event, data) {
		// Error events: always handled regardless of EVENT_MAP entry.
		// Preserve existing domain data, record in meta.errors.
		// Push directly to avoid creating a new array on every error.
		if (event.startsWith("error:")) {
			this._state.meta.dataVersion++;
			this._state.meta.errors.push(data);
			// LRU eviction: trim oldest errors when cap is exceeded
			if (this._state.meta.errors.length > this._maxErrors) {
				this._state.meta.errors = this._state.meta.errors.slice(-this._maxErrors);
			}
			this._emit(event, data);
			return;
		}

		const mapping = EVENT_MAP[event];

		if (mapping) {
			const { domain, key } = mapping;

			// Domain-level merge (wallet, permit)
			if (key === null) {
				this._state[domain] = { ...this._state[domain], ...data };
			}
			// Sub-key assignment (data events)
			else {
				this._state[domain][key] = data;
			}

			this._state.meta.dataVersion++;

			// If writing to authed domain but auth not yet enabled, skip emit
			if (domain === "authed" && !this._authEnabled && this._started) {
				return;
			}

			this._emit(event, this._getDomainData(domain, key));
		} else if (event === "reset") {
			this._resetState();
			this._emit("reset", this.getState());
		} else {
			// Unmapped event — emit but don't store in state
			this._emit(event, data);
		}
	}

	/**
	 * Return a deep-cloned snapshot of the current state.
	 * @returns {BridgeState}
	 */
	getState() {
		return JSON.parse(JSON.stringify(this._state));
	}

	/**
	 * Reset all state to defaults and emit 'reset' event.
	 * Also resets started/auth flags.
	 * Listener subscriptions are preserved (only state is cleared).
	 */
	reset() {
		this._resetState();
		this._started = false;
		this._authEnabled = false;
		this._emit("reset", this.getState());
	}

	/**
	 * Update multiple domains in a single coalesced notification cycle.
	 *
	 * All state mutations are applied first, then each event is emitted exactly
	 * once. Listeners see the final state after all updates.
	 *
	 * @param {Array<{event: string, data: *}>} updates - Batch of updates to apply
	 */
	dispatchBatch(updates) {
		if (updates.length === 0) return;

		// Track unique successfully-updated events for coalesced emission
		const eventsToEmit = [];

		for (const { event, data } of updates) {
			const mapping = EVENT_MAP[event];

			// Error events are always processed regardless of EVENT_MAP
			if (event.startsWith("error:")) {
				this._state.meta.errors.push(data);
				if (!eventsToEmit.includes(event)) eventsToEmit.push(event);
				continue;
			}

			if (mapping) {
				const { domain, key } = mapping;

				if (key === null) {
					this._state[domain] = { ...this._state[domain], ...data };
				} else {
					this._state[domain][key] = data;
				}

				// Track for emission deduplication
				if (!eventsToEmit.includes(event)) {
					eventsToEmit.push(event);
				}
			}
		}

		this._state.meta.dataVersion++;

		// LRU eviction: trim oldest errors when cap is exceeded
		if (this._state.meta.errors.length > this._maxErrors) {
			this._state.meta.errors = this._state.meta.errors.slice(-this._maxErrors);
		}

		// Emit all events once, after all state changes are applied
		for (const event of eventsToEmit) {
			const mapping = EVENT_MAP[event];
			if (mapping) {
				const { domain, key } = mapping;
				this._emit(event, this._getDomainData(domain, key));
			}
		}
	}

	/**
	 * Start BridgeBus in public-only mode.
	 *
	 * Begins accepting writes to the public domain (ticker, markets, activities).
	 * Authenticated domain writes are deferred until enableAuthenticated() is called
	 * (typically after wallet connect).
	 *
	 * Safe to call multiple times — idempotent.
	 * Emits 'started' event with { mode: 'public' } on first call.
	 */
	start() {
		if (this._started) return;
		this._started = true;
		this._authEnabled = false;
		this._emit("started", { mode: "public" });
	}

	/**
	 * Enable authenticated data writes.
	 *
	 * Called after wallet connect + JWT login + permit grant.
	 * From this point, writes to the authed domain are accepted and emitted.
	 * Emits 'authenticated' event with `true`.
	 */
	enableAuthenticated() {
		this._authEnabled = true;
		this._emit("authenticated", true);
	}

	/**
	 * Disable authenticated data writes (on wallet disconnect).
	 *
	 * Clears authed domain data back to defaults (preserves public domain data).
	 * Emits 'authenticated' event with `false`.
	 */
	disableAuthenticated() {
		this._authEnabled = false;
		this._state.authed = JSON.parse(JSON.stringify(DEFAULT_STATE.authed));
		this._emit("authenticated", false);
	}

	/**
	 * Check if public-only mode is active.
	 * @returns {boolean}
	 */
	isPublicOnly() {
		return this._started && !this._authEnabled;
	}

	/**
	 * Check if authenticated mode is active.
	 * @returns {boolean}
	 */
	isAuthenticated() {
		return this._started && this._authEnabled;
	}

	// ── Internal ────────────────────────────────────────────────────────────

	/**
	 * Emit an event to all registered listeners, including wildcard listeners.
	 *
	 * If a listener throws, the error is caught and logged to prevent one
	 * listener's failure from breaking others.
	 *
	 * @param {string} event - Event name
	 * @param {*} data - Event payload
	 */
	_emit(event, data) {
		// Exact-match listeners
		const listeners = this._listeners.get(event);
		if (listeners) {
			for (const cb of listeners) {
				try {
					cb(data, event);
				} catch (err) {
					console.error(`[BridgeBus] Listener error for "${event}":`, err);
				}
			}
		}

		// Wildcard listeners (error:* catches all error:xxx events)
		if (event.startsWith("error:")) {
			const wildcardListeners = this._listeners.get("error:*");
			if (wildcardListeners) {
				for (const cb of wildcardListeners) {
					try {
						cb(data, event);
					} catch (err) {
						console.error(`[BridgeBus] Wildcard listener error for "${event}":`, err);
					}
				}
			}
		}
	}

	/**
	 * Get domain data for event emission.
	 * For sub-key events, returns the value at that key.
	 * For domain events, returns the entire domain object.
	 *
	 * @param {string} domain - Domain name
	 * @param {string|null} key - Sub-key or null for whole domain
	 * @returns {*}
	 */
	_getDomainData(domain, key) {
		if (key === null) {
			return this._state[domain];
		}
		return this._state[domain][key];
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
