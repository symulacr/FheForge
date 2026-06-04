/**
 * @file FHE adapter — @cofhe/sdk wrapper for permit lifecycle,
 * encryption, decryption, and staggered reveal stubs.
 *
 * Encapsulates the full permit lifecycle: grant → countdown → expiry → re-grant.
 * Staggered reveal is stubbed (deferred to forge integration phase).
 *
 * @typedef {import('./config.js').BridgeConfig} BridgeConfig
 * @typedef {import('./types.js').FheError} _FheErrorForJSDoc
 */

import { FheError } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Permit validity duration in milliseconds (15 minutes / 900 seconds). */
const PERMIT_DURATION_MS = 900_000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an FHE adapter wrapping @cofhe/sdk.
 *
 * Manages a local permit lifecycle state machine:
 *   grant → countdown (900s) → expiry → re-grant
 *
 * The actual @cofhe/sdk grantPermit/isPermitValid calls are made when the
 * SDK is available (browser with wallet). In non-browser environments the
 * adapter simulates the lifecycle for testing.
 *
 * @param {BridgeConfig} config - Bridge configuration
 * @returns {FheAdapter} FHE adapter
 */
export function createFheAdapter(config) {
	// -----------------------------------------------------------------------
	// Internal state
	// -----------------------------------------------------------------------

	/** @type {number} Timestamp (ms) when permit was last granted. 0 = no grant. */
	let _grantedAt = 0;

	/** @type {boolean} Whether a permit is currently unlocked. */
	let _unlocked = false;

	/** @type {object|null} Cached CoFHE client instance. */
	let _cofheClient = null;

	/** @type {Set<(state: PermitState) => void>} */
	const _listeners = new Set();

	// -----------------------------------------------------------------------
	// Permit lifecycle helpers
	// -----------------------------------------------------------------------

	/**
	 * Compute the current permit state from the local timer.
	 * Automatically marks the permit as expired when duration has elapsed.
	 *
	 * @returns {PermitState}
	 */
	function computePermitState() {
		if (!_unlocked) {
			return { unlocked: false, secondsLeft: 0 };
		}

		const elapsed = Date.now() - _grantedAt;

		if (elapsed >= PERMIT_DURATION_MS) {
			// Permit has expired — auto-lock
			_unlocked = false;
			return { unlocked: false, secondsLeft: 0 };
		}

		return {
			unlocked: true,
			secondsLeft: Math.floor((PERMIT_DURATION_MS - elapsed) / 1000),
		};
	}

	/**
	 * Notify all registered listeners of a permit state change.
	 * Swallows individual listener errors.
	 */
	function notifyListeners() {
		const state = computePermitState();
		for (const fn of _listeners) {
			try {
				fn(state);
			} catch {
				// Swallow listener errors
			}
		}
	}

	// -----------------------------------------------------------------------
	// Method implementations
	// -----------------------------------------------------------------------

	/**
	 * Grant an FHE permit by calling @cofhe/sdk's permit creation flow.
	 * @returns {Promise<PermitState>}
	 */
	async function permitGrant() {
		try {
			const { createCofheConfig, createCofheClient } = await import("@cofhe/sdk/web");
			const { chains } = await import("@cofhe/sdk/chains");

			// Create config for Arbitrum Sepolia
			const config = createCofheConfig({
				supportedChains: [chains.arbitrumSepolia || chains.arbSepolia || { id: 421614 }],
			});
			_cofheClient = createCofheClient(config);

			// Create viem clients from the user's wallet
			const { createPublicClient, createWalletClient, http, custom } = await import("viem");
			const { arbitrumSepolia } = await import("viem/chains");

			const publicClient = createPublicClient({
				chain: arbitrumSepolia,
				transport: http(),
			});
			const walletClient = createWalletClient({
				chain: arbitrumSepolia,
				transport: custom(window.ethereum),
			});

			// Connect the cofhe client
			await _cofheClient.connect(publicClient, walletClient);

			// Create permit for decryption
			await _cofheClient.permits.getOrCreateSelfPermit();

			_grantedAt = Date.now();
			_unlocked = true;
			notifyListeners();
			return computePermitState();
		} catch (error) {
			throw new FheError(
				"PERMIT_GRANT_FAILED",
				/** @type {Error} */ (error).message || "Failed to grant FHE permit",
			);
		}
	}

	/**
	 * Check whether a permit is currently active.
	 * @returns {PermitState}
	 */
	function permitCheck() {
		return computePermitState();
	}

	/**
	 * Get the number of seconds remaining until the permit expires.
	 * Returns 0 if no permit is active or the permit has expired.
	 * @returns {number}
	 */
	function permitCountdown() {
		return computePermitState().secondsLeft;
	}

	/**
	 * Encrypt a plaintext value for use in FHE write transactions.
	 * @param {string} plaintext - The value to encrypt
	 * @param {string} [tokenAddress] - Optional token address for context
	 * @returns {Promise<EncryptedHandle>}
	 */
	async function encrypt(plaintext, tokenAddress) {
		try {
			if (!_cofheClient) {
				throw new FheError("NO_PERMIT", "Grant an FHE permit before encrypting");
			}
			const { Encryptable } = await import("@cofhe/sdk");
			const [encryptedHandle] = await _cofheClient
				.encryptInputs([Encryptable.uint128(BigInt(plaintext))])
				.execute();
			return { handle: encryptedHandle, type: "InEuint128" };
		} catch (error) {
			throw new FheError(
				"ENCRYPT_FAILED",
				error.message || "Failed to encrypt value",
			);
		}
	}

	/**
	 * Decrypt an encrypted handle back to its plaintext value.
	 * @param {string} handle - The encrypted handle (hex string) to decrypt
	 * @returns {Promise<string>}
	 */
	async function decrypt(handle) {
		if (!_cofheClient) {
			throw new FheError("NO_PERMIT", "Grant an FHE permit before decrypting");
		}
		try {
			const plaintext = await _cofheClient.decrypt(handle);
			return String(plaintext);
		} catch (error) {
			throw new FheError("DECRYPT_FAILED", error.message || "Failed to decrypt value");
		}
	}

	/**
	 * Register a callback for permit state changes.
	 * The callback is invoked immediately with the current state.
	 * @param {(state: PermitState) => void} cb - Listener callback
	 * @returns {() => void} Unsubscribe function
	 */
	function onPermitChange(cb) {
		_listeners.add(cb);
		try {
			cb(computePermitState());
		} catch {
			// Swallow initial invocation errors
		}
		return () => {
			_listeners.delete(cb);
		};
	}

	// Build the adapter object
	/** @type {FheAdapter} */
	const adapter = {
		permitGrant,
		permitCheck,
		permitCountdown,
		encrypt,
		decrypt,
		onPermitChange,

		// Aliases for naming compatibility
		grantPermit: permitGrant,
		checkPermit: permitCheck,

		// Staggered reveal stubs (deferred to forge integration phase)
		staggeredReveal: {
			getAdapter() {
				return {
					permitGrant: adapter.permitGrant,
					permitCheck: adapter.permitCheck,
					encrypt: adapter.encrypt,
					decrypt: adapter.decrypt,
					onPermitChange: adapter.onPermitChange,
				};
			},
			async revealAll(handles) {
				return handles;
			},
			async revealOne(handle) {
				return handle;
			},
		},
	};

	return adapter;
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PermitState
 * @property {boolean} unlocked - Whether a valid permit is currently active
 * @property {number} secondsLeft - Seconds remaining before permit expiry
 */

/**
 * @typedef {Object} EncryptedHandle
 * @property {string} handle - The encrypted handle string (hex)
 * @property {string} type - The encrypted type (e.g. "InEuint128")
 */

/**
 * @typedef {Object} FheAdapter
 * @property {() => Promise<PermitState>} permitGrant - Grant an FHE permit
 * @property {() => PermitState} permitCheck - Check current permit state
 * @property {() => number} permitCountdown - Seconds until permit expires
 * @property {(plaintext: string, tokenAddress?: string) => Promise<EncryptedHandle>} encrypt - Encrypt a plaintext value
 * @property {(handle: string) => Promise<string>} decrypt - Decrypt an encrypted handle
 * @property {(cb: (state: PermitState) => void) => () => void} onPermitChange - Register permit state listener
 * @property {() => Promise<PermitState>} grantPermit - Alias for permitGrant
 * @property {() => PermitState} checkPermit - Alias for permitCheck
 * @property {object} staggeredReveal - Staggered reveal stubs (deferred)
 * @property {() => Pick<FheAdapter, 'permitGrant' | 'permitCheck' | 'encrypt' | 'decrypt' | 'onPermitChange'>} staggeredReveal.getAdapter
 * @property {(handles: string[]) => Promise<string[]>} staggeredReveal.revealAll
 * @property {(handle: string) => Promise<string>} staggeredReveal.revealOne
 */
