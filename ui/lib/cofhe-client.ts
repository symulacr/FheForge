"use client";

import type { CofheClient, CofheConfig } from "@cofhe/sdk";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { Ethers6Adapter } from "@cofhe/sdk/adapters";
import { chains } from "@cofhe/sdk/chains";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/web";
import type { AbstractSigner, Provider, Wallet } from "ethers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Ethers6Signer = AbstractSigner | Wallet;

export interface EncryptedHandle {
	ctHash: bigint;
	securityZone: number;
	utype: number;
	signature: string;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: CofheClient<CofheConfig> | null = null;

/**
 * Returns the singleton CoFHE client instance.
 * Throws if called server-side (no DOM / no `window`).
 */
export function getCofheClient(): CofheClient<CofheConfig> {
	if (!_instance) {
		throw new Error("CoFHE client not initialised — call initCofheClient(provider, signer) first");
	}
	return _instance;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialises the CoFHE client singleton from an ethers.js v6 Provider + Signer.
 *
 * 1. Wraps the ethers provider/signer via `Ethers6Adapter` to produce viem
 *    `publicClient` and `walletClient`.
 * 2. Creates a CoFHE client configuration for supported chains.
 * 3. Instantiates the CoFHE client and connects it, creating a self-permit.
 *
 * Safe to call multiple times — subsequent calls are no-ops as long as the
 * client is already connected to the same chain.
 *
 * @param provider  An ethers v6 Provider (e.g. `JsonRpcProvider`).
 * @param signer    An ethers v6 signer (e.g. `Wallet`, `JsonRpcSigner`).
 * @param supportedChainIds  Optional array of chain IDs to support (defaults to
 *                           `[arbSepolia, baseSepolia, sepolia]`).
 */
export async function initCofheClient(
	provider: Provider,
	signer: Ethers6Signer,
	supportedChainIds?: number[],
): Promise<CofheClient<CofheConfig>> {
	if (typeof window === "undefined") {
		throw new Error("CoFHE client is only available in browser context");
	}

	// Return existing connected instance when already initialised.
	if (_instance && _instance.connected) {
		return _instance;
	}

	// 1. Derive viem clients from ethers provider/signer.
	const { publicClient, walletClient } = await Ethers6Adapter(provider, signer);

	// 2. Resolve supported chain objects.
	const supportedChains = resolveChains(supportedChainIds);

	// 3. Create config and client.
	const config = createCofheConfig({ supportedChains });
	const client = createCofheClient(config);

	// 4. Connect (this sets account, chainId, and registers the viem clients).
	await client.connect(publicClient, walletClient);

	// 5. Ensure a self-permit exists so encryption/decryption can proceed.
	await client.permits.getOrCreateSelfPermit();

	_instance = client;
	return _instance;
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

/**
 * Encrypts a `bigint` value as a euint128.
 *
 * Shortcut around:
 * ```
 * await cofheClient.encryptInputs([Encryptable.uint128(value)]).execute()
 * ```
 */
export async function encryptUint128(value: bigint): Promise<EncryptedHandle[]> {
	const client = getCofheClient();
	const handles = (await client
		.encryptInputs([Encryptable.uint128(value)])
		.execute()) as EncryptedHandle[];
	return handles;
}

/**
 * Encrypts a `bigint` value as a euint64.
 *
 * Shortcut around:
 * ```
 * await cofheClient.encryptInputs([Encryptable.uint64(value)]).execute()
 * ```
 */
export async function encryptUint64(value: bigint): Promise<EncryptedHandle[]> {
	const client = getCofheClient();
	const handles = (await client
		.encryptInputs([Encryptable.uint64(value)])
		.execute()) as EncryptedHandle[];
	return handles;
}

// ---------------------------------------------------------------------------
// Decryption helpers
// ---------------------------------------------------------------------------

/**
 * Decrypts an encrypted handle for on-chain viewing (via CoFHE `/sealoutput`).
 *
 * Uses the active permit for the connected account + chain.
 *
 * @param ctHash   Ciphertext hash of the encrypted value.
 * @param utype    FheTypes enum (default `FheTypes.Uint128`).
 * @returns        Decrypted bigint value.
 */
export async function decryptForView(
	ctHash: bigint,
	utype: FheTypes = FheTypes.Uint128,
): Promise<bigint> {
	const client = getCofheClient();
	const result = await client.decryptForView(ctHash, utype).withPermit().execute();
	return result as bigint;
}
/**
 * Decrypts an encrypted handle for use in an on-chain transaction
 * (via the CoFHE threshold network).
 *
 * Requires selecting a permit. Defaults to the active permit via
 * `withPermit()`.
 *
 * @param ctHash   Ciphertext hash of the encrypted value.
 * @returns        `DecryptForTxResult` containing the plaintext / proof material.
 */
export async function decryptForTx(ctHash: bigint) {
	const client = getCofheClient();
	const result = await client.decryptForTx(ctHash).withPermit().execute();
	return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveChains(chainIds?: number[]) {
	const all = [chains.arbSepolia, chains.baseSepolia, chains.sepolia];
	if (!chainIds || chainIds.length === 0) {
		return all;
	}
	return all.filter((c) => chainIds.includes(c.id));
}
