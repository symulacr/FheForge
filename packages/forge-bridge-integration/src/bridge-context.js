/**
 * @file bridge-context.js — ForgeProvider React Context + hooks
 *
 * BridgeContext provides wallet, permit, and data state from BridgeBus
 * to the React component tree. ForgeProvider subscribes to BridgeBus
 * events in useEffect and updates state via useState, triggering React
 * re-renders WITHOUT re-mounting (no dataVersion-as-key pattern).
 *
 * Backward compatibility: demo-mode data can still be written by DataFetcherV2,
 * but ForgeProvider itself only consumes BridgeBus runtime events.
 *
 * Browser usage:
 *   ReactDOM.createRoot(document.getElementById('root'))
 *     .render(React.createElement(ForgeProvider, null,
 *       React.createElement(App)
 *     ));
 *
 * In components:
 *   const bridge = useBridge();    // full context
 *   const wallet = useWallet();    // { connected, address, chainId }
 *   const permit = usePermit();    // { unlocked, secondsLeft }
 *   const data = useBridgeData();  // all data arrays
 */

import bridgeBus from './bridge-bus.js';

// ─── Default Context Value ──────────────────────────────────────────────────

/** @type {BridgeContextValue} */
const DEFAULT_CONTEXT_VALUE = {
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
		templates: null,
		nodeTypes: null,
		walletBalance: null,
		portfolioNetValue: null,
		portfolioLTV: null,
		readiness: null,
	},
	ready: false,
	meta: { dataVersion: 0, errors: [] },
};

// ─── ForgeErrorBoundary — catches render errors ──────────────────────────────

// Guard: ensure React is defined at module scope. In production bundlers React is
// a global, but during Bun/Node module evaluation (strict ES module mode) the
// free identifier `React` does not resolve to globalThis.React.  This fallback
// lets the class definition and React.createElement calls survive without a
// global React when the module is loaded outside a browser context.
var React = globalThis.React || { Component: class Component {} };

/**
 * ForgeErrorBoundary — React error boundary that catches render errors
 * in the component tree beneath ForgeProvider.
 *
 * Prevents a single render crash from breaking the entire UI. Logs the
 * error and displays a fallback UI when a catastrophic render failure occurs.
 *
 * Error boundaries only catch errors during React rendering lifecycle
 * (render, useEffect, event handlers). They do NOT catch async errors
 * or errors thrown in setTimeouts/intervals.
 *
 * @extends {React.Component}
 */
class ForgeErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	/**
	 * Update state so the next render shows the fallback UI.
	 * @param {Error} error - The error that was thrown
	 * @returns {{ hasError: boolean, error: Error }}
	 */
	static getDerivedStateFromError(error) {
		return { hasError: true, error };
	}

	/**
	 * Log error details to the console for debugging.
	 * @param {Error} error - The error that was thrown
	 * @param {Object} errorInfo - React error info (component stack)
	 */
	componentDidCatch(error, errorInfo) {
		console.error('[ForgeErrorBoundary] Caught render error:', error.message || error);
		if (errorInfo && errorInfo.componentStack) {
			console.warn('[ForgeErrorBoundary] Component stack:', errorInfo.componentStack);
		}
	}

	render() {
		if (this.state.hasError) {
			// Fallback UI when error boundary catches a render error.
			// Shows a minimal error message so the user knows something went wrong,
			// while keeping the page functional (navigation, sidebar, etc.)
			return React.createElement(
				'div',
				{
					style: {
						padding: '24px',
						margin: '16px',
						border: '1px solid var(--destructive, #ef4444)',
						background: 'var(--card, #111111)',
						color: 'var(--destructive, #ef4444)',
						fontFamily: 'JetBrains Mono, monospace',
						fontSize: '0.875rem',
					},
				},
				React.createElement(
					'div',
					{ style: { fontWeight: 500, marginBottom: '8px' } },
					'[forge] render error',
				),
				React.createElement(
					'div',
					{ style: { color: 'var(--muted, #888)', fontSize: '0.75rem' } },
					this.state.error && this.state.error.message
						? String(this.state.error.message)
						: 'An unexpected error occurred in the UI.',
				),
			);
		}

		return this.props.children;
	}
}

// ─── Context ────────────────────────────────────────────────────────────────

/**
 * BridgeContext — React Context holding all bridge state.
 *
 * Shape:
 *   { wallet: { connected, address, chainId },
 *     permit: { unlocked, secondsLeft },
 *     data:   { ticker, markets, activities, positions, strategies,
 *               proposals, community, templates, nodeTypes, walletBalance,
 *               portfolioNetValue, portfolioLTV },
 *     meta:   { dataVersion, errors } }
 *
 * @type {React.Context<BridgeContextValue>}
 */
const BridgeContext = React.createContext(DEFAULT_CONTEXT_VALUE);

// ─── Data event handler descriptors ─────────────────────────────────────────
// Each entry maps a BridgeBus data event to the corresponding key
// in the `data` React state object.
//
// NOTE: window.__MOCK__ writes are NO LONGER performed here.
// DataFetcherV2 writes __MOCK__ only for explicit demo mode. Live
// polling writes to BridgeBus without mutating mock globals.
// This avoids redundant double-assignments and keeps real data out
// of the mock compatibility surface.

const DATA_EVENT_MAP = [
	{ event: "data:ticker", stateKey: "ticker" },
	{ event: "data:markets", stateKey: "markets" },
	{ event: "data:activities", stateKey: "activities" },
	{ event: "data:positions", stateKey: "positions" },
	{ event: "data:strategies", stateKey: "strategies" },
	{ event: "data:proposals", stateKey: "proposals" },
	{ event: "data:community", stateKey: "community" },
	{ event: "data:templates", stateKey: "templates" },
	{ event: "data:nodeTypes", stateKey: "nodeTypes" },
	{ event: "data:walletBalance", stateKey: "walletBalance" },
	{ event: "data:readiness", stateKey: "readiness" },
];

// ─── ForgeProvider ──────────────────────────────────────────────────────────

/**
 * ForgeProvider — React Context provider for bridge state.
 *
 * Subscribes to BridgeBus events in useEffect and stores state via useState.
 * On every BridgeBus data/wallet/permit update:
 *   1. Updates local React state (triggers targeted re-render, not re-mount)
 *
 * On mount:
 *   - Calls DataFetcherV2.startPublicPolling() to begin public data fetching
 *
 * On unmount:
 *   - Unsubscribes from all BridgeBus events (effect cleanup)
 *
 * No dataVersion-as-key — state updates via Context.Provider value change
 * trigger React re-renders naturally, preserving component state (scroll,
 * selections, form inputs).
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 */
function ForgeProvider({ children }) {
	// ── Wallet state ──────────────────────────────────────────────────
	const [wallet, setWallet] = React.useState({
		connected: false,
		address: null,
		chainId: null,
	});

	// ── Permit state ──────────────────────────────────────────────────
	const [permit, setPermit] = React.useState({
		unlocked: false,
		secondsLeft: 0,
	});

	// ── Data state ────────────────────────────────────────────────────
	const [data, setData] = React.useState({
		ticker: null,
		markets: null,
		activities: null,
		positions: null,
		strategies: null,
		proposals: null,
		community: null,
		templates: null,
		nodeTypes: null,
		walletBalance: null,
		portfolioNetValue: null,
		portfolioLTV: null,
		readiness: null,
	});

	// Track data version for meta updates without deep-cloning state
	const [dataVersion, setDataVersion] = React.useState(0);

	// ── Error state ───────────────────────────────────────────────────
	// Collects errors from BridgeBus error:* events so they surface to UI
	// through the BridgeContext. Each error is { source, message, timestamp }.
	// Uses a ref to accumulate errors without triggering re-render on each
	// push — the dataVersion increment handles re-render triggering.
	const [errors, setErrors] = React.useState([]);
	const errorsRef = React.useRef([]);

	// ── Ready state ──────────────────────────────────────────────────
	// false until the first successful data fetch completes
	const [ready, setReady] = React.useState(false);

	// ── Memoize context value ─────────────────────────────────────────
	// Prevents unnecessary child re-renders when state hasn't changed
	const contextValue = React.useMemo(
		() => ({
			wallet,
			permit,
			data,
			ready,
			meta: { dataVersion, errors },
		}),
		[wallet, permit, data, dataVersion, errors, ready],
	);

	// ── BridgeBus subscription (mount/unmount effect) ─────────────────
	React.useEffect(() => {
		const unsubFns = [];

		// --- Wallet event subscriptions ---
		// Each handler does a shallow merge into wallet state
		unsubFns.push(
			bridgeBus.on("wallet:connected", (walletData) => {
				setWallet((prev) => ({ ...prev, ...walletData }));
			}),
		);
		unsubFns.push(
			bridgeBus.on("wallet:disconnected", (walletData) => {
				setWallet((prev) => ({ ...prev, ...walletData }));
			}),
		);
		// --- Permit event subscriptions ---
		// Each handler does a shallow merge into permit state
		unsubFns.push(
			bridgeBus.on("permit:granted", (permitData) => {
				setPermit((prev) => ({ ...prev, ...permitData }));
			}),
		);
		unsubFns.push(
			bridgeBus.on("permit:expired", (permitData) => {
				setPermit((prev) => ({ ...prev, ...permitData }));
			}),
		);
		unsubFns.push(
			bridgeBus.on("permit:tick", (permitData) => {
				setPermit((prev) => ({ ...prev, ...permitData }));
			}),
		);

		// --- Data event subscriptions ---
		// Update React state on each BridgeBus data event.
		//
		// NOTE: window.__MOCK__ is NOT written here. DataFetcherV2 writes
		// __MOCK__ only for explicit demo mode; live data stays on BridgeBus.
		DATA_EVENT_MAP.forEach(({ event, stateKey }) => {
			unsubFns.push(
				bridgeBus.on(event, (payload) => {
					setData((prev) => {
						const next = { ...prev, [stateKey]: payload };
						if (stateKey === "walletBalance" && payload) {
							next.portfolioNetValue = payload.netValue != null ? payload.netValue : prev.portfolioNetValue;
							next.portfolioLTV = payload.portfolioLTV != null ? payload.portfolioLTV : prev.portfolioLTV;
						}
						return next;
					});
					setDataVersion((prev) => prev + 1);
					// Mark bridge as ready on first successful data fetch
					setReady(true);
				}),
			);
		});

		// --- Error event subscription (wildcard) ---
		// Collects error events and stores them in React state so they
		// surface through BridgeContext (VAL-POSTFIX-ERROR-001).
		// Uses errorsRef to accumulate errors across effect cycles without
		// losing prior errors on cleanup. Errors are capped at 50 to prevent
		// unbounded memory growth in long-running sessions.
		unsubFns.push(
			bridgeBus.on("error:*", (errorData) => {
				errorsRef.current.push(errorData);
				// Cap error history at 50 entries
				if (errorsRef.current.length > 50) {
					errorsRef.current = errorsRef.current.slice(-50);
				}
				setErrors([].concat(errorsRef.current));
				setDataVersion((prev) => prev + 1);
			}),
		);

		unsubFns.push(
			bridgeBus.on("transaction:confirmed", () => {
				if (typeof window !== "undefined" && window.__dataFetcherV2 && typeof window.__dataFetcherV2.refreshAfterTransaction === "function") {
					window.__dataFetcherV2.refreshAfterTransaction();
				}
			}),
		);

		unsubFns.push(
			bridgeBus.on("transaction:failed", (data) => {
				console.warn("Transaction failed:", data);
				// Could show a toast notification here
			}),
		);

		// ── Start polling on mount ─────────────────────────────
		if (typeof window !== "undefined" && window.DataFetcherV2) {
			if (!window.__forgeProvider__pollingStarted) {
				window.__forgeProvider__pollingStarted = true;
				try {
					const fetcher = window.__dataFetcherV2 || new window.DataFetcherV2({
						bus: bridgeBus,
					});
					window.__dataFetcherV2 = fetcher;
					// Start real public polling for ticker and markets.
					// Demo/mock population is intentionally not auto-started here.
					fetcher.startPublicPolling();
				} catch (err) {
					console.warn("[ForgeProvider] Failed to start polling:", err);
				}
			}
		}

		// ── Cleanup: unsubscribe all on unmount ───────────────────
		return function cleanup() {
			unsubFns.forEach(function (fn) {
				fn();
			});
		};
	}, []); // Empty deps = subscribe on mount, cleanup on unmount only

	// ── Render: wrap children in ForgeErrorBoundary + BridgeContext.Provider ───
	// The error boundary catches render errors in the component tree so one
	// screen's failure doesn't break the entire app. BridgeContext.Provider
	// delivers bridge state updates via React context (no re-mount).
	return React.createElement(
		ForgeErrorBoundary,
		null,
		React.createElement(
			BridgeContext.Provider,
			{ value: contextValue },
			children,
		),
	);
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * useBridge — returns the full BridgeContext value.
 *
 * @returns {BridgeContextValue} { wallet, permit, data, meta }
 */
function useBridge() {
	return React.useContext(BridgeContext);
}

/**
 * useWallet — returns wallet connection state.
 *
 * @returns {{ connected: boolean, address: string|null, chainId: number|null }}
 */
function useWallet() {
	const ctx = React.useContext(BridgeContext);
	return ctx.wallet;
}

/**
 * usePermit — returns permit state.
 *
 * @returns {{ unlocked: boolean, secondsLeft: number }}
 */
function usePermit() {
	const ctx = React.useContext(BridgeContext);
	return ctx.permit;
}

/**
 * useBridgeData — returns all data arrays/state.
 *
 * @returns {{
 *   ticker: *,
 *   markets: *,
 *   activities: *,
 *   positions: *,
 *   strategies: *,
 *   proposals: *,
 *   community: *,
 *   templates: *,
 *   nodeTypes: *,
 *   walletBalance: *,
 *   portfolioNetValue: *,
 *   portfolioLTV: *,
 *   readiness: *
 * }}
 */
function useBridgeData() {
	const ctx = React.useContext(BridgeContext);
	return ctx.data;
}

// ─── Expose ForgeProvider globally ───────────────────────────────────────────
// The Babel plugin v2 references ForgeProvider as a bare global identifier
// (React.createElement(ForgeProvider, ...)), so it must be available on window.
if (typeof window !== 'undefined') {
	window.ForgeProvider = ForgeProvider;
	window.BridgeContext = BridgeContext;
	window.useBridge = useBridge;
	window.useWallet = useWallet;
	window.usePermit = usePermit;
	window.useBridgeData = useBridgeData;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { BridgeContext, ForgeProvider, useBridge, useWallet, usePermit, useBridgeData };
