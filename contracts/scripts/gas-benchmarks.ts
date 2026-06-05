/**
 * gas-benchmarks.ts
 * Standalone Hardhat script that profiles _verifyEquality, FHE re-encryption,
 * and rebase operations, and outputs structured results.
 *
 * Usage:
 *   npx hardhat run scripts/gas-benchmarks.ts --network hardhat
 *
 * Output:
 *   - Console table showing gas costs for each operation
 *   - contracts/deployments/gas_benchmarks.json
 *
 * ═══════════════════════════════════════════════════════════════════
 * Overview of what was built:
 *   New file:   contracts/test/GasBenchHelper.sol
 *   New file:   scripts/gas-benchmarks.ts
 *
 * GasBenchHelper.sol — test contract inheriting FheForgeBase that
 * exposes individual FHE operations for profiling:
 *   - benchVerifyEquality: full _verifyEquality path (FHE.asEuint128 →
 *     FHE.eq → FHE.select → FHE.allowThis)
 *   - benchReencrypt: sealed-input conversion (FHE.asEuint128 only)
 *   - benchEqSelect: full equality check path (asEuint128×2 → eq →
 *     select → allowThis)
 *   - benchRebaseStep: rebalance unit (verifyEquality + safeIncrease)
 *
 * gas-benchmarks.ts — standalone Hardhat script that deploys
 * GasBenchHelper, initializes the CoFHE client on the `hardhat`
 * chain (mock mode), runs four benchmark suites at various input
 * sizes, and writes structured results.
 *
 * Output contract: contracts/deployments/gas_benchmarks.json
 *   (follows existing deployment-report pattern)
 * ═══════════════════════════════════════════════════════════════════
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TASK_COFHE_MOCKS_DEPLOY } from "@cofhe/hardhat-plugin";
import { Encryptable } from "@cofhe/sdk";
import { hardhat } from "@cofhe/sdk/chains";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
/**
 * gas-benchmarks.ts
 * Standalone Hardhat script that profiles _verifyEquality, FHE re-encryption,
 * and rebase operations, and outputs structured results.
 *
 * Usage:
 *   npx hardhat run scripts/gas-benchmarks.ts --network hardhat
 *
 * Output:
 *   - Console table showing gas costs for each operation
 *   - contracts/deployments/gas_benchmarks.json
 *
 * ═══════════════════════════════════════════════════════════════════
 * Overview of what was built:
 *   New file:   contracts/test/GasBenchHelper.sol
 *   New file:   scripts/gas-benchmarks.ts
 *
 * GasBenchHelper.sol — test contract inheriting FheForgeBase that
 * exposes individual FHE operations for profiling:
 *   - benchVerifyEquality: full _verifyEquality path (FHE.asEuint128 →
 *     FHE.eq → FHE.select → FHE.allowThis)
 *   - benchReencrypt: sealed-input conversion (FHE.asEuint128 only)
 *   - benchEqSelect: full equality check path (asEuint128×2 → eq →
 *     select → allowThis)
 *   - benchRebaseStep: rebalance unit (verifyEquality + safeIncrease)
 *
 * gas-benchmarks.ts — standalone Hardhat script that deploys
 * GasBenchHelper, initializes the CoFHE client on the `hardhat`
 * chain (mock mode), runs four benchmark suites at various input
 * sizes, and writes structured results.
 *
 * Output contract: contracts/deployments/gas_benchmarks.json
 *   (follows existing deployment-report pattern)
 * ═══════════════════════════════════════════════════════════════════
 */
import hre, { ethers } from "hardhat";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface GasBenchmarkEntry {
	operation: string;
	inputSize: string;
	gasUsed: number;
	etherCost: string;
	timestamp: string;
}

interface BenchmarkOutput {
	timestamp: string;
	network: number;
	networkName: string;
	gasPriceGwei: number;
	results: GasBenchmarkEntry[];
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

const _GWEI = 1_000_000_000n;

function _gweiToEth(gwei: bigint): string {
	return ethers.formatUnits(gwei, 18);
}

function calcEtherCost(gasUsed: number, gasPrice: bigint): string {
	const costWei = BigInt(gasUsed) * gasPrice;
	return ethers.formatEther(costWei);
}

/// CoFHE mock address constants
const TASK_MANAGER_ADDRESS = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";
const HASH_MASK_FOR_METADATA = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000n;
const UINT_TYPE_MASK = 0x7fn;
const _TRIVIALLY_ENCRYPTED_MASK = 0x80n;

/// Compute the same appendedHash that MockTaskManager.verifyInput produces:
///   (ctHash & ~0xffff) | ((isTrivial_bit | utype) << 8 | securityZone)
function computeAppendedHash(ctHash: bigint, utype: number, securityZone: number): bigint {
	const isTrivial = 0n; // false – SDK inputs are NOT trivially encrypted
	const typeByte = isTrivial | (BigInt(utype) & UINT_TYPE_MASK);
	const metadata = (typeByte << 8n) | BigInt(securityZone & 0xff);
	return (ctHash & HASH_MASK_FOR_METADATA) | metadata;
}

/// Call MOCK_setInEuintKey on the deployed MockTaskManager so that the
/// mock precompile can look up the plaintext value for a ctHash.
async function registerMockValue(
	taskManager: ethers.Contract,
	ctHash: bigint,
	value: bigint,
	utype: number = 5, // EUINT128_TFHE
	securityZone: number = 0,
) {
	const appendedHash = computeAppendedHash(ctHash, utype, securityZone);
	// The value may already be stored under the raw ctHash; also store under
	// the appended (post-verifyInput) hash to be safe.
	const tx1 = await taskManager.MOCK_setInEuintKey(ctHash, value);
	await tx1.wait();
	if (appendedHash !== ctHash) {
		const tx2 = await taskManager.MOCK_setInEuintKey(appendedHash, value);
		await tx2.wait();
	}
}

// ═══════════════════════════════════════════════════════════
// Benchmark runner
// ═══════════════════════════════════════════════════════════

async function measureGas(
	label: string,
	inputLabel: string,
	fn: () => Promise<{ tx: ethers.TransactionResponse; receipt: ethers.TransactionReceipt }>,
	gasPrice: bigint,
): Promise<GasBenchmarkEntry> {
	const { receipt } = await fn();
	const gasUsed = Number(receipt.gasUsed);
	return {
		operation: label,
		inputSize: inputLabel,
		gasUsed,
		etherCost: calcEtherCost(gasUsed, gasPrice),
		timestamp: new Date().toISOString(),
	};
}

async function runBatch(
	helper: ethers.Contract,
	taskManager: ethers.Contract,
	cofhe: ReturnType<typeof createCofheClient>,
	_deployer: ethers.Signer,
	gasPrice: bigint,
): Promise<GasBenchmarkEntry[]> {
	const results: GasBenchmarkEntry[] = [];

	// ── 1. FHE re-encryption (sealed input → asEuint128) ──
	const testSizes = [
		{ label: "0", value: 0n },
		{ label: "10_000 (1e4)", value: ethers.parseUnits("1", 4) },
		{ label: "1_000_000 (1e6)", value: ethers.parseUnits("1", 6) },
		{ label: "1_000_000_000_000 (1e12)", value: ethers.parseUnits("1", 12) },
		{ label: "100_000_000_000_000_000 (1e18)", value: ethers.parseUnits("1", 18) },
	];

	console.log(
		"\n▸ Benchmark 1: _verifyEquality with dual InEuint128 inputs (avoids trivialEncrypt revert)",
	);
	for (const size of testSizes) {
		try {
			const [encHandle, encClaimed] = await cofhe
				.encryptInputs([Encryptable.uint128(size.value), Encryptable.uint128(size.value)])
				.execute();
			// Pre-register plaintexts so the mock precompile can look them up during eq
			await registerMockValue(taskManager, BigInt(encHandle.ctHash), size.value);
			await registerMockValue(taskManager, BigInt(encClaimed.ctHash), size.value);
			const entry = await measureGas(
				"_verifyEquality (dual In)",
				size.label,
				async () => {
					const tx = await helper.benchVerifyEqualityDual(encHandle, encClaimed);
					const receipt = await tx.wait();
					return { tx, receipt };
				},
				gasPrice,
			);
			results.push(entry);
			console.log(`  ✓ _verifyEquality dual(${size.label}): ${entry.gasUsed} gas`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			console.log(`  ✗ _verifyEquality dual(${size.label}) failed: ${msg.slice(0, 100)}`);
		}
	}

	// ── 2. FHE re-encryption (sealed => plaintext conversion) ──
	console.log("\n▸ Benchmark 2: FHE re-encryption (sealed input → asEuint128)");
	for (const size of testSizes) {
		try {
			const [encrypted] = await cofhe.encryptInputs([Encryptable.uint128(size.value)]).execute();
			await registerMockValue(taskManager, BigInt(encrypted.ctHash), size.value);
			const entry = await measureGas(
				"FHE re-encryption (asEuint128)",
				size.label,
				async () => {
					const tx = await helper.benchReencrypt(encrypted);
					const receipt = await tx.wait();
					return { tx, receipt };
				},
				gasPrice,
			);
			results.push(entry);
			console.log(`  ✓ asEuint128(${size.label}): ${entry.gasUsed} gas`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			console.log(`  ✗ asEuint128(${size.label}) failed: ${msg.slice(0, 100)}`);
		}
	}

	// ── 3. Full equality-check path (eq + select + allowThis) ──
	console.log("\n▸ Benchmark 3: eq + select + allowThis (full equality path)");
	for (const size of testSizes) {
		try {
			const [encHandle, encClaimed] = await cofhe
				.encryptInputs([Encryptable.uint128(size.value), Encryptable.uint128(size.value)])
				.execute();
			await registerMockValue(taskManager, BigInt(encHandle.ctHash), size.value);
			await registerMockValue(taskManager, BigInt(encClaimed.ctHash), size.value);
			const entry = await measureGas(
				"eq + select + allowThis",
				size.label,
				async () => {
					const tx = await helper.benchEqSelect(encHandle, encClaimed);
					const receipt = await tx.wait();
					return { tx, receipt };
				},
				gasPrice,
			);
			results.push(entry);
			console.log(`  ✓ eq+select(${size.label}): ${entry.gasUsed} gas`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			console.log(`  ✗ eq+select(${size.label}) failed: ${msg.slice(0, 100)}`);
		}
	}

	// ── 4. Rebase operation step (verifyEquality + safeIncrease) ──
	console.log("\n▸ Benchmark 4: Rebase step (verifyEquality + safeIncrease)");
	for (const size of testSizes) {
		try {
			const [encHandle, encClaimed] = await cofhe
				.encryptInputs([Encryptable.uint128(size.value), Encryptable.uint128(size.value)])
				.execute();
			await registerMockValue(taskManager, BigInt(encHandle.ctHash), size.value);
			await registerMockValue(taskManager, BigInt(encClaimed.ctHash), size.value);
			const entry = await measureGas(
				"Rebase step (verify + safeIncrease)",
				size.label,
				async () => {
					const tx = await helper.benchRebaseStep(encHandle, encClaimed);
					const receipt = await tx.wait();
					return { tx, receipt };
				},
				gasPrice,
			);
			results.push(entry);
			console.log(`  ✓ Rebase step(${size.label}): ${entry.gasUsed} gas`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			console.log(`  ✗ Rebase step(${size.label}) failed: ${msg.slice(0, 100)}`);
		}
	}

	return results;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
	console.log("\n╔══════════════════════════════════════════════════╗");
	console.log("║      FheForge Gas Benchmarks                    ║");
	console.log("╚══════════════════════════════════════════════════╝\n");

	const [deployer] = await ethers.getSigners();
	const networkInfo = await ethers.provider.getNetwork();
	const chainId = Number(networkInfo.chainId);
	const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? 20_000_000_000n;

	console.log(`Network:   ${networkInfo.name ?? "unknown"} (${chainId})`);
	console.log(`Deployer:  ${deployer.address}`);
	console.log(`Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);

	// ── Deploy CoFHE mocks (required on hardhat before any FHE op) ──
	console.log("\n▸ Deploying CoFHE mocks...");
	try {
		await hre.run(TASK_COFHE_MOCKS_DEPLOY);
		console.log("  ✓ CoFHE mocks deployed");
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error("  ✗ Mock deployment failed:", msg.slice(0, 120));
		process.exit(1);
	}

	// ── Deploy GasBenchHelper ──
	console.log("\n▸ Deploying GasBenchHelper...");
	const GasBenchHelper = await ethers.getContractFactory("GasBenchHelper");
	const helper = await GasBenchHelper.connect(deployer).deploy();
	await helper.waitForDeployment();
	const helperAddress = await helper.getAddress();
	console.log(`  Deployed: ${helperAddress}`);

	// ── CoFHE Client Initialization ──
	console.log("\n▸ Initializing CoFHE client (mock mode for hardhat)...");
	let cofhe: ReturnType<typeof createCofheClient> | undefined;
	try {
		const client = createCofheClient(
			createCofheConfig({
				environment: "node",
				supportedChains: [hardhat],
			}),
		);
		const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
		await client.connect(publicClient, walletClient);
		await client.permits.createSelf({ issuer: deployer.address });
		cofhe = client;
		console.log("  ✓ CoFHE client ready (mock mode)");
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error("  ✗ CoFHE initialization failed:", msg.slice(0, 120));
		console.log("  Falling back to gas estimation...");
	}

	if (!cofhe) {
		console.log("\nCoFHE client is required for FHE benchmarks. Exiting.");
		process.exit(1);
	}

	// ── Get handle to MockTaskManager for pre-registering plaintexts ──
	const taskManager = await ethers.getContractAt(
		[
			"function MOCK_setInEuintKey(uint256 ctHash, uint256 value) public",
			"function mockStorage(uint256) view returns (uint256)",
			"function inMockStorage(uint256) view returns (bool)",
		],
		TASK_MANAGER_ADDRESS,
	);

	// ── Run benchmarks ──
	const results = await runBatch(helper, taskManager, cofhe, deployer, gasPrice);

	// ── Output ──
	console.log("\n\n═══════════════════════════════════════════════════");
	console.log("           GAS BENCHMARK RESULTS");
	console.log("═══════════════════════════════════════════════════");

	console.table(
		results.map((r) => ({
			operation: r.operation,
			"input-size": r.inputSize,
			"gas-used": r.gasUsed.toLocaleString(),
			"ether-cost": r.etherCost,
		})),
	);

	const output: BenchmarkOutput = {
		timestamp: new Date().toISOString(),
		network: chainId,
		networkName: networkInfo.name ?? "unknown",
		gasPriceGwei: Number(ethers.formatUnits(gasPrice, "gwei")),
		results,
	};

	const deploymentsDir = path.join(__dirname, "..", "deployments");
	fs.mkdirSync(deploymentsDir, { recursive: true });
	const outPath = path.join(deploymentsDir, "gas_benchmarks.json");
	fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
	console.log(`\n✓ Results written to ${outPath}`);
	console.log(`  Total benchmarks: ${results.length}`);
}

main().catch((e: unknown) => {
	console.error("\n✗ Benchmark script failed:", e);
	process.exit(1);
});
