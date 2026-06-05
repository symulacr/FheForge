/**
 * @file get-bridge.js — Shared bridge adapter resolution utility
 *
 * Resolves the bridge adapter synchronously if available, or with polling
 * retry if the adapter is not yet initialized.
 *
 * Available as:
 *   - Default ES module export: `import getBridge from './get-bridge.js'`
 *   - Window global: `window.__getBridge` (for IIFE / non-module consumers)
 *
 * @example
 * ```js
 * import getBridge from './get-bridge.js';
 * const bridge = await getBridge();
 * ```
 *
 * @example
 * ```js
 * // Custom timeout
 * const bridge = await getBridge(5000, 50);
 * ```
 */

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Get the global object (window in browser, globalThis in any environment).
 * @returns {typeof globalThis}
 */
function getGlobal() {
	return typeof window !== "undefined" ? window : globalThis;
}

/**
 * Get the bridge adapter synchronously if available.
 * Falls back to async retry if not yet initialized.
 * The synchronous path eliminates unnecessary microtask hops.
 *
 * @returns {Object|null} Bridge adapter or null if not yet available
 */
function getBridgeSync() {
	const g = getGlobal();
	return g.bridge || null;
}

// ─── Bridge Resolution ───────────────────────────────────────────────────

/**
 * Resolve the bridge adapter, polling at the given interval until timeout.
 *
 * Checks for the bridge synchronously first (eliminates unnecessary microtask
 * hops when the adapter is already available). Falls back to polling at
 * `interval` ms intervals until `timeout` ms has elapsed.
 *
 * @param {number} [timeout=10000] - Maximum time to wait in milliseconds
 * @param {number} [interval=100] - Polling interval in milliseconds
 * @returns {Promise<Object>} The bridge adapter
 */
function getBridge(timeout = 10000, interval = 100) {
	const syncBridge = getBridgeSync();
	if (syncBridge) return Promise.resolve(syncBridge);

	return new Promise((resolve, reject) => {
		let retries = 0;
		const maxRetries = Math.max(1, Math.ceil(timeout / interval));
		const timer = setInterval(() => {
			const b = getBridgeSync();
			if (b) {
				clearInterval(timer);
				resolve(b);
			} else if (++retries >= maxRetries) {
				clearInterval(timer);
				reject(new Error("Bridge adapter not available after timeout"));
			}
		}, interval);
	});
}

// ─── Window Export (for IIFE / non-module consumers) ─────────────────────

if (typeof window !== "undefined") {
	window.__getBridge = getBridge;
}

export default getBridge;
