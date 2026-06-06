/* ──────────────────────────────────────────────
   Shared utilities for forge-bridge-integration.

   Consolidates repeated patterns from data-fetcher-v2.js
   and other integration-layer modules.
   ────────────────────────────────────────────── */

/**
 * Unwrap a { status, data } API result.
 *
 * @param {*}      result - Raw API result
 * @param {string} source - Human-readable source name (for error messages)
 * @returns {*} The unwrapped data
 * @throws {Error} If result.status === 'error'
 */
function unwrapResult(result, source) {
  if (
    result &&
    typeof result === 'object' &&
    result.status === 'success' &&
    Object.hasOwn(result, 'data')
  ) {
    return result.data;
  }
  if (result && typeof result === 'object' && result.status === 'error') {
    throw result.error || new Error((source || 'Request') + ' failed');
  }
  return result;
}

/**
 * Return a `.catch` handler for FHE decrypt failures.
 * Logs a warning, emits `error:decrypt` on the bus, and returns a
 * fallback value so the caller's Promise chain continues.
 *
 * @param {Object|null} bus     - BridgeBus instance (or null)
 * @param {string}      token   - Token address or position ID (for logging)
 * @param {*}           fallback - Value to return on failure (default: null)
 * @returns {(err: Error) => *}
 */
function catchDecrypt(bus, token, fallback) {
  if (fallback === undefined) fallback = null;
  return function (err) {
    console.warn(
      '[DataFetcherV2] Decrypt failed for ' + token + ':',
      err?.message || err,
    );
    if (bus) {
      bus.set('error:decrypt', {
        token: token,
        message: err?.message || 'Decrypt failed',
      });
    }
    return fallback;
  };
}

/**
 * Check that a wallet account is connected; throw if not.
 *
 * @param {Function} getAccountFn - A function that returns the account address (or null)
 * @returns {string} The connected account address
 * @throws {Error} If no wallet is connected
 */
function requireConnected(getAccountFn) {
  var addr =
    typeof getAccountFn === 'function' ? getAccountFn() : null;
  if (!addr) {
    throw new Error('No wallet connected');
  }
  return addr;
}

// Expose on window for IIFE consumers
if (typeof window !== 'undefined') {
  window.__sharedUtils = {
    unwrapResult: unwrapResult,
    catchDecrypt: catchDecrypt,
    requireConnected: requireConnected,
  };
}
