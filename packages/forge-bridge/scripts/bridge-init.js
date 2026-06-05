/**
 * @file bridge-init.js
 * Bridge initialization script — loads @fheforge/bridge via importmap ESM import,
 * calls createBridge(config) with production defaults, assigns to window.bridge.
 * Initializes BridgeBus singleton after bridge creation.
 *
 * Loaded as <script type="module"> in FheForge.html.
 */
import { createBridge } from '@fheforge/bridge/core';
import bridgeBus from '../../forge-bridge-integration/src/bridge-bus.js';

/**
 * Initialize the bridge with production defaults.
 * createBridge() merges user config with DEFAULT_CONFIG:
 *   - apiBaseUrl: https://fheforge-api-production-6465.up.railway.app
 *   - chainId: 421614 (Arbitrum Sepolia)
 *   - rpcUrl: https://sepolia-arbitrum-rpc.publicnode.com
 */

// Auto-detect local dev environment
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  window.__FHEFORGE_CONFIG__ = window.__FHEFORGE_CONFIG__ || {};
  window.__FHEFORGE_CONFIG__.apiBaseUrl =
    window.__FHEFORGE_CONFIG__.apiBaseUrl || 'http://localhost:3001';
}

const bridge = createBridge();

/**
 * Expose bridge to window scope for integration adapter and screen wrappers.
 * The integration adapter's getBridgeApi() resolves window.bridge to access
 * wallet, api, contract, and fhe adapters.
 */
window.bridge = bridge;

/**
 * Initialize BridgeBus singleton — central event emitter and reactive state store.
 * BridgeBus manages 5 state domains: public, authed, wallet, permit, meta.
 * Components subscribe via on(event, callback) and receive updates via set().
 *
 * @see packages/forge-bridge-integration/src/bridge-bus.js
 */
window.__bridgeBus = bridgeBus;

/**
 * Start BridgeBus in public-only mode.
 * Begins accepting writes to public domain (ticker, markets, activities).
 * Authenticated domain writes are deferred until enableAuthenticated() is called
 * (typically after wallet connect → JWT login → permit grant).
 */
bridgeBus.start();
