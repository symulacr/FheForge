/** @file FHE adapter — @cofhe/sdk wrapper for permits, encrypt & decrypt. */

import { FheError } from './types.js';

const PERMIT_DURATION_MS = 900_000;

/** Create an FHE adapter wrapping @cofhe/sdk. */
export function createFheAdapter(_config) {
  let _grantedAt = 0;
  let _unlocked = false;
  let _cofheClient = null;
  const _listeners = new Set();

  /** @returns {object} _cofheClient or throws */
  function requireClient() {
    if (!_cofheClient) throw new FheError('NO_PERMIT', 'Grant an FHE permit first');
    return _cofheClient;
  }

  /** @returns {PermitState} */
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

  /** Notify listeners of a permit state change. */
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

  /** Grant an FHE permit via @cofhe/sdk. */
  async function permitGrant() {
    try {
      const { createCofheConfig, createCofheClient } = await import('@cofhe/sdk/web');
      const { chains } = await import('@cofhe/sdk/chains');

      // Create config for Arbitrum Sepolia
      const config = createCofheConfig({
        supportedChains: [chains.arbitrumSepolia || chains.arbSepolia || { id: 421614 }],
      });
      _cofheClient = createCofheClient(config);

      // Create viem clients from the user's wallet
      const { createPublicClient, createWalletClient, http, custom } = await import('viem');
      const { arbitrumSepolia } = await import('viem/chains');

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
        'PERMIT_GRANT_FAILED',
        /** @type {Error} */ (error).message || 'Failed to grant FHE permit',
      );
    }
  }

  /** @returns {PermitState} */
  function permitCheck() {
    return computePermitState();
  }

  /** Encrypt a plaintext value for FHE write transactions. */
  async function encrypt(plaintext, _tokenAddress) {
    try {
      const client = requireClient();
      const { Encryptable } = await import('@cofhe/sdk');
      const [encryptedHandle] = await client
        .encryptInputs([Encryptable.uint128(BigInt(plaintext))])
        .execute();
      return encryptedHandle;
    } catch (error) {
      throw new FheError('ENCRYPT_FAILED', error.message || 'Failed to encrypt value');
    }
  }

  /** Decrypt an encrypted handle back to plaintext. */
  async function decrypt(handle) {
    const client = requireClient();
    try {
      const plaintext = await client.decrypt(handle);
      return String(plaintext);
    } catch (error) {
      throw new FheError('DECRYPT_FAILED', error.message || 'Failed to decrypt value');
    }
  }

  /** Decrypt a handle for use in a transaction, returning a signature. */
  async function decryptForExecute(ctHash) {
    const client = requireClient();
    try {
      const result = await client.decryptForTx(ctHash).withoutPermit().execute();
      return { plaintext: String(result.decryptedValue), signature: result.signature };
    } catch (error) {
      throw new FheError(
        'DECRYPT_FOR_TX_FAILED',
        error.message || `Failed to decrypt ${ctHash} for transaction`,
      );
    }
  }

  /** Register a callback for permit state changes. */
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
    encrypt,
    decrypt,
    decryptForExecute,
    onPermitChange,

    // Aliases for naming compatibility
    grantPermit: permitGrant,
  };

  return adapter;
}

/** @typedef {{ unlocked: boolean, secondsLeft: number }} PermitState */
/** @typedef {string} InEuint128 - Encrypted handle for an euint128 value */
/** @typedef {{ permitGrant: () => Promise<PermitState>, permitCheck: () => PermitState, encrypt: (plaintext: string, tokenAddress?: string) => Promise<InEuint128>, decrypt: (handle: string) => Promise<string>, decryptForExecute: (ctHash: string) => Promise<{plaintext: string, signature: string}>, onPermitChange: (cb: (state: PermitState) => void) => () => void, grantPermit: () => Promise<PermitState> }} FheAdapter */
