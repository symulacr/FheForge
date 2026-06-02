/**
 * @file bridge-init.js
 * Bridge initialization script — loads @fheforge/bridge via importmap ESM import,
 * calls createBridge(config) with production defaults, assigns to window.bridge.
 *
 * Loaded as <script type="module"> in FheForge.html.
 */
import { createBridge } from "@fheforge/bridge/core";

/**
 * Initialize the bridge with production defaults.
 * createBridge() merges user config with DEFAULT_CONFIG:
 *   - apiBaseUrl: https://fheforge-api-production-6465.up.railway.app
 *   - chainId: 421614 (Arbitrum Sepolia)
 *   - rpcUrl: https://sepolia-arbitrum-rpc.publicnode.com
 */
const bridge = createBridge();

/**
 * Expose bridge to window scope for integration adapter and screen wrappers.
 * The integration adapter's getBridgeApi() resolves window.bridge to access
 * wallet, api, contract, and fhe adapters.
 */
window.bridge = bridge;
