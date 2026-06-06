// utils/token-utils.js — Shared decimal lookup, single source of truth
// Loaded as a plain <script> before text/babel screen scripts.

/**
 * Return the number of decimals for a given asset symbol.
 * Uses case-insensitive substring matching so "WBTC.e", "cWBTC", etc. resolve correctly.
 *
 * @param {string} asset - Token symbol (e.g. "USDC", "WBTC", "ETH")
 * @returns {number} Decimal count (6, 8, or 18)
 */
function getDecimalForAsset(asset) {
  var sym = String(asset || "").toUpperCase();
  if (sym.includes("USDC") || sym.includes("USDT")) return 6;
  if (sym.includes("WBTC") || sym.includes("PPGS")) return 8;
  return 18;
}

// Exact-match map for consumers that prefer a lookup table (e.g. data-fetcher-v2.js).
var TOKEN_DECIMAL_MAP = {
  ETH: 18, WETH: 18, BTC: 8, WBTC: 8,
  USDC: 6, USDT: 6, DAI: 18,
  PPGS: 8, MATIC: 18, SOL: 18, LINK: 18,
};

// Expose on window so text/babel scripts and IIFEs can access them.
if (typeof window !== "undefined") {
  window.getDecimalForAsset = getDecimalForAsset;
  window.TOKEN_DECIMAL_MAP = TOKEN_DECIMAL_MAP;
}
