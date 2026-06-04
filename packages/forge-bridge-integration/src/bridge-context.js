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

// ─── ForgeProvider ──────────────────────────────────────────────────────────

/**
 * ForgeProvider — React Context provider for bridge state.
 *
 * Uses useSyncExternalStore to subscribe directly to BridgeBus state changes.
 * This eliminates the previous useState/subscription machinery — BridgeBus is
 * the single source of truth and React re-renders when the snapshot changes.
 *
 * Side effects (polling start, transaction listeners) are handled in a
 * lightweight useEffect.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 */
function ForgeProvider({ children }) {
	// ── Subscribe to BridgeBus via useSyncExternalStore ─────────────
	const state = React.useSyncExternalStore(
		(callback) => bridgeBus.subscribe(callback),
		() => bridgeBus.getSnapshot(),
	);

	// Derive context value from snapshot
	const contextValue = React.useMemo(() => ({
		wallet: state.wallet,
		permit: state.permit,
		data: {
			...state.public,
			...state.authed,
		},
		ready: state.meta.dataVersion > 0,
		meta: state.meta,
	}), [state]);

	// ── Side effects: polling + transaction listeners ───────────────
	React.useEffect(() => {
		const unsubFns = [];

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
			}),
		);

		// Start polling on mount
		if (typeof window !== "undefined" && window.DataFetcherV2) {
			if (!window.__forgeProvider__pollingStarted) {
				window.__forgeProvider__pollingStarted = true;
				try {
					const fetcher = window.__dataFetcherV2 || new window.DataFetcherV2({
						bus: bridgeBus,
					});
					window.__dataFetcherV2 = fetcher;
					fetcher.startPublicPolling();
				} catch (err) {
					console.warn("[ForgeProvider] Failed to start polling:", err);
				}
			}
		}

		return function cleanup() {
			unsubFns.forEach(function (fn) { fn(); });
		};
	}, []);

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
 * useBridgeData — returns all data arrays/state directly from BridgeBus.
 *
 * Uses useSyncExternalStore to subscribe to BridgeBus without going through
 * React Context. Screens can call this hook directly for data access.
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
	const state = React.useSyncExternalStore(
		(callback) => bridgeBus.subscribe(callback),
		() => bridgeBus.getSnapshot(),
	);
	return { ...state.public, ...state.authed };
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
