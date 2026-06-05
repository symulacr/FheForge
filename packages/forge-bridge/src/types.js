/**
 * @typedef {'api' | 'contract' | 'wallet' | 'cofhe' | 'network' | 'config'} BridgeErrorSource
 */

/**
 * @typedef {Object} BridgeStateSnapshot
 * @property {string|null} address - Connected wallet address or null
 * @property {number} chainId - Current chain ID
 * @property {boolean} connected - Whether wallet is connected
 * @property {boolean} hasJwt - Whether a JWT token is available
 */

/**
 * @typedef {Object} BridgeFheSnapshot
 * @property {boolean} permitUnlocked - Whether FHE permit is active
 * @property {number} permitSecondsLeft - Seconds remaining before permit expiry
 */

/**
 * @typedef {Object} BridgeStateData
 * @property {BridgeStateSnapshot | null} wallet - Wallet adapter state (null if wallet not initialized)
 * @property {BridgeFheSnapshot | null} fhe - FHE adapter state (null if FHE not initialized)
 * @property {import('./config.js').BridgeConfig} config - Active configuration
 */

/**
 * @typedef {Object} BridgeState
 * @property {'idle' | 'loading' | 'success' | 'error'} status - Current status
 * @property {BridgeStateData | null} data - State data
 * @property {{ code: string, message: string, source: string, recoverable: boolean } | null} error - Error info if status is 'error'
 */

/**
 * @typedef {Object} BridgeResult
 * @property {import('./wallet.js').WalletAdapter} [wallet] - Wallet adapter (present on success)
 * @property {import('./api.js').ApiAdapter} [api] - API adapter (present on success)
 * @property {import('./contract.js').ContractAdapter} [contract] - Contract adapter (present on success)
 * @property {import('./fhe.js').FheAdapter} [fhe] - FHE adapter (present on success)
 * @property {() => BridgeState} getState - Returns a snapshot of all adapter states
 * @property {import('./types.js').BridgeError} [error] - Error if initialization failed
 */

/**
 * Base error class for all bridge adapter errors.
 */
export class BridgeError extends Error {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} message - Human-readable error message
   * @param {BridgeErrorSource} source - Source of the error
   * @param {boolean} recoverable - Whether the error is recoverable
   */
  constructor(code, message, source, recoverable) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.source = source;
    this.recoverable = recoverable;
  }
}

/**
 * Error thrown by the wallet adapter during wagmi connection/signing operations.
 */
export class WalletError extends BridgeError {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} message - Human-readable error message
   * @param {boolean} [recoverable=true] - Whether the error is recoverable
   */
  constructor(code, message, recoverable = true) {
    super(code, message, 'wallet', recoverable);
    this.name = 'WalletError';
  }
}

/**
 * Error thrown by the API adapter during HTTP requests.
 */
export class ApiError extends BridgeError {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} message - Human-readable error message
   * @param {number} [statusCode] - HTTP status code
   * @param {boolean} [recoverable=false] - Whether the error is recoverable
   */
  constructor(code, message, statusCode, recoverable = false) {
    super(code, message, 'api', recoverable);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Error thrown by the contract adapter during viem read/write operations.
 */
export class ContractError extends BridgeError {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} message - Human-readable error message
   * @param {boolean} [recoverable=false] - Whether the error is recoverable
   */
  constructor(code, message, recoverable = false) {
    super(code, message, 'contract', recoverable);
    this.name = 'ContractError';
  }
}

/**
 * Error thrown by the FHE adapter during CoFHE SDK operations.
 */
export class FheError extends BridgeError {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} message - Human-readable error message
   * @param {boolean} [recoverable=true] - Whether the error is recoverable
   */
  constructor(code, message, recoverable = true) {
    super(code, message, 'cofhe', recoverable);
    this.name = 'FheError';
  }
}
