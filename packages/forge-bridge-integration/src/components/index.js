/**
 * @file components/index.js — Barrel export for bridge UI components
 *
 * Re-export all shared components for ESM consumers.
 * Components are also registered on window.__BRIDGE_COMPONENTS
 * by their individual modules.
 *
 * @example
 * ```js
 * import { CipherValue, StatusBadge, EncryptedDisplay } from './components/index.js';
 * ```
 */

export { default as CipherValue } from './cipher-value.js';
export { default as StatusBadge } from './status-badge.js';
export { default as EncryptedDisplay } from './encrypted-display.js';
