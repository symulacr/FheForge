/**
 * @file bridge-components.js — Unified bridge UI component registry
 *
 * Central registry that ensures all shared UI components are exposed
 * via window.__BRIDGE_COMPONENTS for backward compatibility with
 * IIFE-loaded forge screens.
 *
 * Importing this module triggers each component's self-registration
 * on window.__BRIDGE_COMPONENTS.
 *
 * Browser screens can then use:
 *   const { CipherValue, StatusBadge, EncryptedDisplay } = window.__BRIDGE_COMPONENTS;
 *
 * @example
 * ```js
 * import './bridge-components.js';
 * // window.__BRIDGE_COMPONENTS now has CipherValue, StatusBadge, EncryptedDisplay
 * ```
 */

// Import component modules to trigger window.__BRIDGE_COMPONENTS registration
import "./cipher-value.js";
import "./status-badge.js";
import "./encrypted-display.js";

// Re-export for ESM consumers
export { default as CipherValue } from "./cipher-value.js";
export { default as EncryptedDisplay } from "./encrypted-display.js";
export { default as StatusBadge } from "./status-badge.js";

// ─── Registration Verification ─────────────────────────────────────────

if (typeof window !== "undefined") {
	window.__BRIDGE_COMPONENTS = window.__BRIDGE_COMPONENTS || {};

	const EXPECTED = ["CipherValue", "StatusBadge", "EncryptedDisplay"];
	for (let i = 0; i < EXPECTED.length; i++) {
		const name = EXPECTED[i];
		if (!window.__BRIDGE_COMPONENTS[name]) {
			if (typeof console !== "undefined" && console.warn) {
				console.warn(`[bridge-components] Missing component: ${name}`);
			}
		}
	}
}
