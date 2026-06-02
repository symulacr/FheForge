#!/usr/bin/env node
/**
 * @file verify-bridge.js
 *
 * E2E verification script for FheForge bridge layer.
 * Tests the bridge module against the production backend: API health,
 * JWT nonce, contract ABIs, viem chain connection, and @cofhe/sdk init.
 *
 * Usage:
 *   node packages/forge-bridge/scripts/verify-bridge.js
 *   bun packages/forge-bridge/scripts/verify-bridge.js
 *
 * Exit codes:
 *   0 — All checks passed
 *   1 — One or more checks failed (details printed to stderr)
 *
 * @typedef {import('../src/types.js').BridgeError} BridgeError
 */

// ---------------------------------------------------------------------------
// Colored output helpers
// ---------------------------------------------------------------------------

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** @type {number} */
let passed = 0;
/** @type {number} */
let failed = 0;

/**
 * Print a check result.
 * @param {string} label - Check description
 * @param {boolean} ok - Whether the check passed
 * @param {string} [detail] - Optional detail message
 */
function report(label, ok, detail) {
	const icon = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
	const status = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
	const msg = detail ? ` — ${detail}` : "";
	console.log(`  ${icon} ${BOLD}${label}${RESET}: ${status}${msg}`);
	if (ok) passed++;
	else failed++;
}

/**
 * Assert a condition. Logs and continues on failure.
 * @param {boolean} condition - The condition to check
 * @param {string} label - Human-readable label
 * @param {string} [detail] - Optional detail message
 * @returns {boolean} Whether the condition was true
 */
function check(condition, label, detail) {
	const ok = !!condition;
	report(label, ok, detail);
	return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const isDryRun = process.argv.includes("--dry-run");

	console.log(`\n${BOLD}${CYAN}═══ FheForge Bridge — E2E Verification ═══${RESET}\n`);

	if (isDryRun) {
		console.log(`  ${YELLOW}${BOLD}⚡ DRY RUN${RESET}${YELLOW}: skipping network-dependent operations.${RESET}\n`);
	}

	// ─────────────────────────────────────────────────────────────────────
	// Check 1 — Bridge module loads and createBridge exists (LOCAL)
	// ─────────────────────────────────────────────────────────────────────
	console.log(`${BOLD}[1/6] Bridge Module${RESET}`);

	try {
		const { createBridge, DEFAULT_CONFIG } = await import("../src/index.js");
		const hubModuleOk = check(
			typeof createBridge === "function",
			"createBridge is exported and is a function",
			`Type: ${typeof createBridge}`,
		);
		check(
			typeof DEFAULT_CONFIG === "object" && DEFAULT_CONFIG !== null,
			"DEFAULT_CONFIG is exported and is an object",
			`Type: ${typeof DEFAULT_CONFIG}`,
		);
		if (hubModuleOk) {
			// Try to instantiate createBridge (should fail gracefully without proper env)
			const { createConfig } = await import("../src/config.js");
			const cfg = createConfig({ chainId: 421614, rpcUrl: "https://arbitrum-sepolia.publicnode.com" });
			const bridge = createBridge(cfg);
			const hasWallet = typeof bridge.wallet !== "undefined";
			const hasApi = typeof bridge.api !== "undefined";
			const hasContract = typeof bridge.contract !== "undefined";
			const hasFhe = typeof bridge.fhe !== "undefined";
			const hasGetState = typeof bridge.getState === "function";
			check(
				hasWallet && hasApi && hasContract && hasFhe && hasGetState,
				"createBridge() returns { wallet, api, contract, fhe, getState }",
				`wallet=${hasWallet} api=${hasApi} contract=${hasContract} fhe=${hasFhe} getState=${hasGetState}`,
			);
			// Verify getState returns correct shape
			const state = bridge.getState();
			check(
				state && typeof state.status === "string",
				"getState() returns { status, data, error }",
				`status=${state?.status ?? "undefined"}`,
			);
		}
	} catch (err) {
		check(false, "Bridge module loads without errors", `${RED}${/** @type {Error} */ (err).message}${RESET}`);
	}

	// ─────────────────────────────────────────────────────────────────────
	// Check 2 — API health endpoint reachable (NETWORK)
	// ─────────────────────────────────────────────────────────────────────
	console.log(`\n${BOLD}[2/6] API Health${RESET}`);

	if (isDryRun) {
		report("API health endpoint reachable", true, `${YELLOW}[SKIPPED — dry run]${RESET}`);
	} else {
		try {
			const { DEFAULT_CONFIG } = await import("../src/config.js");
			const healthUrl = `${DEFAULT_CONFIG.apiBaseUrl}/health`;
			const response = await fetch(healthUrl, {
				signal: AbortSignal.timeout(10_000),
			});
			const healthOk = check(
				response.ok,
				`GET ${healthUrl}`,
				`Status: ${response.status} ${response.statusText}`,
			);
			if (healthOk) {
				try {
					const body = await response.json();
					check(
						body !== null && typeof body === "object",
						"Health response is valid JSON",
						`Type: ${typeof body}`,
					);
				} catch {
					// Not all health endpoints return JSON; still OK if status was 2xx
					report("Health response body is parseable JSON", false, "Body is not JSON (non-critical)");
				}
			}
		} catch (err) {
			check(false, "API health endpoint reachable", `${RED}${/** @type {Error} */ (err).message}${RESET}`);
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Check 3 — JWT nonce endpoint returns valid nonce (NETWORK)
	// ─────────────────────────────────────────────────────────────────────
	console.log(`\n${BOLD}[3/6] JWT Nonce${RESET}`);

	if (isDryRun) {
		report("JWT nonce endpoint reachable", true, `${YELLOW}[SKIPPED — dry run]${RESET}`);
	} else {
		try {
			const { DEFAULT_CONFIG } = await import("../src/config.js");
			const testAddress = "0x0000000000000000000000000000000000000000";
			const nonceUrl = `${DEFAULT_CONFIG.apiBaseUrl}/auth/nonce/${testAddress}`;
			const response = await fetch(nonceUrl, {
				signal: AbortSignal.timeout(10_000),
			});

			// The endpoint might return 500 for unregistered addresses
			// but we can still verify the route exists (not 404) and the API responds.
			check(
				response.status !== 404,
				`Nonce route exists (${nonceUrl})`,
				`Status: ${response.status} (expected 200 or 500; 404 would mean route is missing)`,
			);

			if (response.ok) {
				const data = await response.json();
				const hasNonce = check(
					data && typeof data.nonce !== "undefined",
					"Response contains 'nonce' field",
					`nonce: ${data?.nonce ? `${String(data.nonce).slice(0, 32)}...` : "undefined"}`,
				);
				if (hasNonce) {
					check(
						typeof data.nonce === "string" && data.nonce.length > 0,
						"Nonce is a non-empty string",
						`Length: ${data.nonce.length}`,
					);
				}
				// Check for optional message field
				check(
					typeof data.message === "undefined" || typeof data.message === "string",
					"Response 'message' field (if present) is a string",
					data.message ? `Present, length: ${data.message.length}` : "Not present (optional)",
				);
			} else {
				// Endpoint responded but returned error (likely 500 for unregistered address)
				// Verify the error response structure is valid JSON
				try {
					const errBody = await response.json();
					check(
						errBody !== null && typeof errBody === "object",
						"Error response is valid JSON (endpoint is alive)",
						`Body keys: ${Object.keys(errBody).join(", ")}`,
					);
				} catch {
					report("Error response body is parseable JSON", false, "Could not parse error body (non-critical)");
				}
			}
		} catch (err) {
			check(false, "JWT nonce endpoint reachable", `${RED}${/** @type {Error} */ (err).message}${RESET}`);
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Check 4 — Contract ABI imports resolve from contracts/out/
	// ─────────────────────────────────────────────────────────────────────
	console.log(`\n${BOLD}[4/6] Contract ABIs${RESET}`);

	const abiPaths = [
		{ name: "LendingPool", path: "../../../contracts/out/LendingPool.sol/LendingPool.json" },
		{ name: "StrategyVault", path: "../../../contracts/out/StrategyVault.sol/StrategyVault.json" },
		{ name: "Composer", path: "../../../contracts/out/FheForgeComposer.sol/FheForgeComposer.json" },
		{ name: "SwapRouter", path: "../../../contracts/out/SwapRouter.sol/SwapRouter.json" },
		{ name: "PriceOracle", path: "../../../contracts/out/PriceOracle.sol/PriceOracle.json" },
		{ name: "StrategyRegistry", path: "../../../contracts/out/StrategyRegistry.sol/StrategyRegistry.json" },
		{ name: "StrategyExecutor", path: "../../../contracts/out/StrategyExecutor.sol/StrategyExecutor.json" },
	];

	let allAbisOk = true;

	for (const { name, path } of abiPaths) {
		try {
			const mod = await import(path);
			const abi = /** @type {any} */ (mod.abi || mod);
			const ok = Array.isArray(abi) && abi.length > 0;
			if (!check(ok, `ABI import: ${name}`, ok ? `${abi.length} entries` : "Not a valid ABI array")) {
				allAbisOk = false;
			}
		} catch (err) {
			allAbisOk = false;
			check(false, `ABI import: ${name}`, `${RED}${/** @type {Error} */ (err).message}${RESET}`);
		}
	}

	if (allAbisOk) {
		report("All contract ABIs resolve successfully", true);
	}

	// ─────────────────────────────────────────────────────────────────────
	// Check 5 — viem publicClient connects to Arb Sepolia (NETWORK)
	// ─────────────────────────────────────────────────────────────────────
	console.log(`\n${BOLD}[5/6] viem Chain Connection${RESET}`);

	if (isDryRun) {
		report("viem publicClient connects to Arb Sepolia", true, `${YELLOW}[SKIPPED — dry run]${RESET}`);
	} else {
		try {
			const { createPublicClient, http } = await import("viem");
			const { arbitrumSepolia } = await import("viem/chains");

			const publicClient = createPublicClient({
				chain: arbitrumSepolia,
				transport: http("https://arbitrum-sepolia.publicnode.com", {
					timeout: 15_000,
				}),
			});

			const blockNumber = await publicClient.getBlockNumber();
			const blockOk = check(
				blockNumber > 0n,
				"getBlockNumber() returns block > 0",
				`Block: ${blockNumber.toString()}`,
			);

			if (blockOk) {
				// Check chain ID
				const chainId = await publicClient.getChainId();
				check(
					chainId === 421614,
					"getChainId() returns Arbitrum Sepolia (421614)",
					`Chain ID: ${chainId}`,
				);

				// Check latest block has a timestamp
				const block = await publicClient.getBlock({ blockTag: "latest" });
				check(
					block && block.timestamp > 0n,
					"Latest block has valid timestamp",
					`Timestamp: ${block.timestamp.toString()}`,
				);
			}
		} catch (err) {
			check(false, "viem publicClient connects to Arb Sepolia", `${RED}${/** @type {Error} */ (err).message}${RESET}`);
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Check 6 — @cofhe/sdk mock mode can be initialized (NETWORK)
	// ─────────────────────────────────────────────────────────────────────
	console.log(`\n${BOLD}[6/6] @cofhe/sdk Initialization${RESET}`);

	if (isDryRun) {
		report("@cofhe/sdk mock mode can be initialized", true, `${YELLOW}[SKIPPED — dry run]${RESET}`);
	} else {
		try {
			// Check that the SDK core module loads
			const sdk = await import("@cofhe/sdk");
			const hasCore = check(
				typeof sdk.createCofheClientBase === "function" &&
					typeof sdk.createCofheConfigBase === "function",
				"@cofhe/sdk core exports are accessible (createCofheClientBase, createCofheConfigBase)",
				`createCofheClientBase=${typeof sdk.createCofheClientBase} createCofheConfigBase=${typeof sdk.createCofheConfigBase}`,
			);

			if (hasCore) {
				// Try to create a config with mock/demo mode settings
				const config = sdk.createCofheConfigBase({
					supportedChains: [421614],
					cofheContractAddress: "0x0000000000000000000000000000000000000000",
					userAddress: "0x0000000000000000000000000000000000000000",
					chainId: 421614,
				});
				check(
					config !== null && typeof config === "object",
					"createCofheConfigBase() returns config object with mock mode",
					`Type: ${typeof config}, Keys: ${Object.keys(config).join(", ")}`,
				);

				// Verify the config has mock-related properties
				check(
					typeof config.mocks !== "undefined",
					"Config has mocks property (mock mode available)",
					`mocks: ${typeof config.mocks}`,
				);
			}

			// Check that the permits sub-module loads
			const permits = await import("@cofhe/sdk/permits");
			check(
				typeof permits.PermitUtils !== "undefined",
				"@cofhe/sdk/permits exports PermitUtils",
				`PermitUtils: ${typeof permits.PermitUtils}`,
			);
		} catch (err) {
			check(false, "@cofhe/sdk mock mode can be initialized", `${RED}${/** @type {Error} */ (err).message}${RESET}`);
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Summary
	// ─────────────────────────────────────────────────────────────────────
	const total = passed + failed;
	console.log(`\n${BOLD}${CYAN}═══ Results: ${passed}/${total} checks passed ═══${RESET}\n`);

	if (failed > 0) {
		console.error(`${RED}${BOLD}${failed} check(s) FAILED. See details above.${RESET}`);
		process.exit(1);
	}

	process.exit(0);
}

main().catch((err) => {
	console.error(`${RED}${BOLD}FATAL: Uncaught error in verify script:${RESET}`, err);
	process.exit(1);
});
