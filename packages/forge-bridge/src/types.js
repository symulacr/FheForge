/**
 * @typedef {'api' | 'contract' | 'wallet' | 'cofhe' | 'network'} BridgeErrorSource
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
		this.name = "BridgeError";
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
		super(code, message, "wallet", recoverable);
		this.name = "WalletError";
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
		super(code, message, "api", recoverable);
		this.name = "ApiError";
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
		super(code, message, "contract", recoverable);
		this.name = "ContractError";
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
		super(code, message, "cofhe", recoverable);
		this.name = "FheError";
	}
}
