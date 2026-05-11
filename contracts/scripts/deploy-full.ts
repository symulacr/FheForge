/**
 * FheForge — Unified Deploy, Wire & Verify
 *
 * Usage:
 *   npx hardhat run scripts/deploy-full.ts --network arb-sepolia
 *
 * Flow:
 *   1. Pre-flight checks (signer, balance, existing deployment)
 *   2. Deploy Level 0 — independent contracts (sequential, nonce-safe)
 *   3. Deploy Level 1 — Vault (needs Registry)
 *   4. Deploy Level 2 — Composer (needs Registry + Vault + Pool + Router)
 *   5. Wire — all admin setters (sequential, nonce-safe)
 *      a. Registry: proposeVault → wait timelock → acceptVault
 *      b. Pool: setWeth, setOracle, setComposer
 *      c. Oracle: setSource (WETH, USDC), setCollateralFactor (USDC, WETH)
 *      d. Router: proposeExecutor → wait timelock → acceptExecutor
 *   6. Verify — try source-verify for each contract (best-effort)
 *   7. Save deployment record + print UI env vars
 *
 * All txs are sequential to avoid nonce conflicts on Arbitrum Sepolia.
 * Timelocked rotations (vault, executor) use configurable delays with
 * a 3s safety margin beyond the on-chain minimum.
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════
// CONFIG — edit these for your network / wave
// ═══════════════════════════════════════════════════════════

const WAVE = 25;
const NETWORK_ID = 421614; // arb-sepolia

// External addresses (Arbitrum Sepolia)
const PYTH_ADDR   = "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF";
const WETH_ADDR   = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC_ADDR   = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH_PYTH   = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const UNISWAP_V3_ROUTER = "0x101F443B4d1b059569D643917553c771E1b9663E";
const USDC_PYTH   = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

// Constructor args
const REGISTRY_VAULT_ROTATION_DELAY = 90n;   // seconds (demo mode)
const ORACLE_STALE_THRESHOLD        = 86400n; // 24h
const ROUTER_MIN_DEADLINE           = 60n;    // 60s
const ROUTER_MAX_DEADLINE           = 86400n; // 1 day
const ROUTER_EXECUTOR_ROT_DELAY     = 90n;    // seconds (demo mode)

// Oracle config
const COLLATERAL_FACTOR_LTV    = 8000;  // 80%
const COLLATERIAL_FACTOR_LIQUID = 8500;  // 85%
const ORACLE_DECIMALS_WETH = 18;
const ORACLE_DECIMALS_USDC = 6;

// Timelock safety margin (ms beyond on-chain delay)
const TIMELOCK_MARGIN_MS = 4000;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/** Deploy a contract, wait for confirmation, log address. */
async function deploy(
  name: string,
  artifact: string,
  args: unknown[] = [],
): Promise<ethers.Contract> {
  const factory = await ethers.getContractFactory(artifact);
  console.log(`  → ${name}...`);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ✓ ${name}: ${addr}`);
  return contract;
}

/** Send a tx, wait for 1 confirmation, log step. */
async function send(
  label: string,
  fn: () => Promise<ethers.ContractTransactionResponse>,
): Promise<void> {
  console.log(`  → ${label}...`);
  const tx = await fn();
  await tx.wait();
  console.log(`  ✓ ${label}`);
}

/** Wait for a timelock (on-chain delay + margin). */
async function waitForTimelock(
  label: string,
  delaySeconds: bigint,
): Promise<void> {
  const ms = Number(delaySeconds) * 1000 + TIMELOCK_MARGIN_MS;
  console.log(`  ⏳ ${label} — waiting ${delaySeconds}s (+ margin)...`);
  await new Promise<void>(r => setTimeout(r, ms));
}

/** Best-effort source verification. */
async function tryVerify(
  name: string,
  addr: string,
  args: unknown[],
): Promise<void> {
  try {
    await hre.run("verify:verify", {
      address: addr,
      constructorArguments: args,
    });
    console.log(`  ✓ Verified ${name}`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes("Already Verified") || msg.includes("already verified")) {
      console.log(`  ✓ ${name} already verified`);
    } else {
      console.log(`  ⚠ ${name} verify failed: ${msg.slice(0, 150)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  // ── Pre-flight ──────────────────────────────────────────
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) throw new Error("No signer — set PRIVATE_KEY in .env");

  const bal = await ethers.provider.getBalance(deployer);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  if (bal < ethers.parseEther("0.05")) {
    throw new Error("Balance too low — need at least 0.05 ETH");
  }

  const hasEtherscanKey = Boolean(process.env.ETHERSCAN_API_KEY);
  console.log("Etherscan API key:", hasEtherscanKey ? "configured" : "MISSING — Sourcify-only verification");

  // Load or create deployment record
  const depPath = path.join(__dirname, "..", "deployments", `${NETWORK_ID}.json`);
  let dep: Record<string, any> = {};
  if (fs.existsSync(depPath)) {
    dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
    console.log("Existing deployment wave:", dep.wave ?? "unknown");
  }

  // ── Level 0: Independent contracts ──────────────────────
  console.log("\n═══ LEVEL 0: Deploy ═══");

  const registry = await deploy("StrategyRegistry", "StrategyRegistry", [
    REGISTRY_VAULT_ROTATION_DELAY,
  ]);

  const pool = await deploy("LendingPool", "LendingPool");

  const oracle = await deploy("PriceOracle", "PriceOracle", [
    PYTH_ADDR,
    ORACLE_STALE_THRESHOLD,
  ]);

  const executor = await deploy("ExecutorContract", "ExecutorContract");

  const router = await deploy("SwapRouter", "SwapRouter", [
    await executor.getAddress(), // executor_
    ROUTER_MIN_DEADLINE,         // minDeadlineOffset_
    ROUTER_MAX_DEADLINE,         // maxDeadlineOffset_
    ROUTER_EXECUTOR_ROT_DELAY,   // executorRotationDelay_
    UNISWAP_V3_ROUTER,          // uniswapV3Router_
  ]);

  const tokenRegistry = await deploy("TokenRegistry", "TokenRegistry");

  // ── Level 1: Vault (depends on Registry) ────────────────
  console.log("\n═══ LEVEL 1: Deploy ═══");

  const vault = await deploy("StrategyVault", "StrategyVault", [
    await registry.getAddress(),
  ]);

  // ── Level 2: Composer (depends on Registry, Vault, Pool, Router) ──
  console.log("\n═══ LEVEL 2: Deploy ═══");

  const composer = await deploy("FheForgeComposer", "FheForgeComposer", [
    await registry.getAddress(),
    await vault.getAddress(),
    await pool.getAddress(),
    await router.getAddress(),
  ]);

  // ── Level 3: StrategyExecutor ──────────────────────────────
  console.log("\n═══ LEVEL 3: StrategyExecutor ═══");

  const strategyExecutor = await deploy("StrategyExecutor", "StrategyExecutor", [
    await pool.getAddress(),
    await vault.getAddress(),
    await router.getAddress(),
  ]);

  // ── Addresses for wiring ────────────────────────────────
  const addrs = {
    registry:  await registry.getAddress(),
    pool:      await pool.getAddress(),
    oracle:    await oracle.getAddress(),
    router:    await router.getAddress(),
    vault:     await vault.getAddress(),
    composer:  await composer.getAddress(),
    executor:  await executor.getAddress(),
    tokenRegistry: await tokenRegistry.getAddress(),
    strategyExecutor: await strategyExecutor.getAddress(),
  };

  // ── Wiring ─────────────────────────────────────────────
  console.log("\n═══ WIRING ═══");

  // 1. Registry: rotate vault (timelocked)
  await send("proposeVault", () => registry.proposeVault(addrs.vault));
  await waitForTimelock("vault rotation", REGISTRY_VAULT_ROTATION_DELAY);
  await send("acceptVault", () => registry.acceptVault());

  // 2. Pool: connect WETH, Oracle, Composer
  await send("pool.setWeth",      () => pool.setWeth(WETH_ADDR));
  await send("pool.setOracle",    () => pool.setOracle(addrs.oracle));
  await send("pool.setComposer",  () => pool.setComposer(addrs.composer));

  // 3. Oracle: register price feeds + collateral factors
  await send("oracle.setSource WETH", () =>
    oracle.setSource(WETH_ADDR, WETH_PYTH, ORACLE_DECIMALS_WETH, ORACLE_STALE_THRESHOLD));
  await send("oracle.setSource USDC", () =>
    oracle.setSource(USDC_ADDR, USDC_PYTH, ORACLE_DECIMALS_USDC, ORACLE_STALE_THRESHOLD));
  await send("oracle.setCollateralFactor USDC", () =>
    oracle.setCollateralFactor(USDC_ADDR, COLLATERAL_FACTOR_LTV, COLLATERIAL_FACTOR_LIQUID));
  await send("oracle.setCollateralFactor WETH", () =>
    oracle.setCollateralFactor(WETH_ADDR, COLLATERAL_FACTOR_LTV, COLLATERIAL_FACTOR_LIQUID));

  // 3b. Oracle: batch feeds deferred to oracle-wave25-setup.ts (need mock token addresses first)

  // 4. Router: rotate executor (timelocked — set to ExecutorContract)
  //    Constructor already set initial executor, but if we need to
  //    rotate to a new one, do it here. Skip if already correct.
  const currentExec = await router.executor();
  if (currentExec.toLowerCase() !== addrs.executor.toLowerCase()) {
    await send("proposeExecutor", () => router.proposeExecutor(addrs.executor));
    await waitForTimelock("executor rotation", ROUTER_EXECUTOR_ROT_DELAY);
    await send("acceptExecutor", () => router.acceptExecutor());
  } else {
    console.log("  ✓ executor already set — skipping rotation");
  }

  // ── Verification ────────────────────────────────────────
  console.log("\n═══ VERIFICATION ═══");

  const verifyItems: [string, string, unknown[]][] = [
    ["StrategyRegistry",  addrs.registry,  [REGISTRY_VAULT_ROTATION_DELAY]],
    ["LendingPool",       addrs.pool,      []],
    ["PriceOracle",       addrs.oracle,    [PYTH_ADDR, ORACLE_STALE_THRESHOLD.toString()]],
    ["ExecutorContract",  addrs.executor,  []],
    ["SwapRouter",        addrs.router,    [addrs.executor, ROUTER_MIN_DEADLINE.toString(), ROUTER_MAX_DEADLINE.toString(), ROUTER_EXECUTOR_ROT_DELAY.toString(), UNISWAP_V3_ROUTER]],
    ["StrategyVault",     addrs.vault,     [addrs.registry]],
    ["FheForgeComposer",  addrs.composer,  [addrs.registry, addrs.vault, addrs.pool, addrs.router]],
    ["TokenRegistry",     addrs.tokenRegistry, []],
    ["StrategyExecutor",  addrs.strategyExecutor, [addrs.pool, addrs.vault, addrs.router]],
  ];

  for (const [name, addr, args] of verifyItems) {
    await tryVerify(name, addr, args);
  }

  // ── Save deployment record ──────────────────────────────
  dep.contracts = dep.contracts ?? {};
  dep.contracts.StrategyRegistry  = addrs.registry;
  dep.contracts.LendingPool       = addrs.pool;
  dep.contracts.PriceOracle       = addrs.oracle;
  dep.contracts.SwapRouter        = addrs.router;
  dep.contracts.ExecutorContract  = addrs.executor;
  dep.contracts.StrategyVault     = addrs.vault;
  dep.contracts.FheForgeComposer  = addrs.composer;
  dep.contracts.TokenRegistry     = addrs.tokenRegistry;
  dep.contracts.StrategyExecutor  = addrs.strategyExecutor;
  dep.swapExecutor = addrs.executor;
  dep.weth = WETH_ADDR;
  dep.wave = WAVE;
  dep.network = "arb-sepolia";
  dep.chainId = NETWORK_ID;
  dep.deployer = deployer.address;
  dep.deployedAt = new Date().toISOString();
  dep.mode = `wave${WAVE}`;
  dep.notes = `Wave ${WAVE}: C-03 minAmountOut, C-04 escrow, C-08 ZeroPrice, C-12 overflow guard, H-06 ComposerSet, full redeploy`;

  fs.mkdirSync(path.dirname(depPath), { recursive: true });
  fs.writeFileSync(depPath, JSON.stringify(dep, null, 2));
  console.log("\n  ✓ Deployment record saved to", depPath);

  // ── UI env vars ─────────────────────────────────────────
  console.log("\n═══ UI ENV VARS (paste into ui/.env.local) ═══");
  console.log(`NEXT_PUBLIC_REGISTRY_ADDRESS=${addrs.registry}`);
  console.log(`NEXT_PUBLIC_POOL_ADDRESS=${addrs.pool}`);
  console.log(`NEXT_PUBLIC_ORACLE_ADDRESS=${addrs.oracle}`);
  console.log(`NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=${addrs.router}`);
  console.log(`NEXT_PUBLIC_VAULT_ADDRESS=${addrs.vault}`);
  console.log(`NEXT_PUBLIC_COMPOSER_ADDRESS=${addrs.composer}`);
  console.log(`NEXT_PUBLIC_TOKEN_REGISTRY_ADDRESS=${addrs.tokenRegistry}`);
  console.log(`NEXT_PUBLIC_UNISWAP_V3_ROUTER=${UNISWAP_V3_ROUTER}`);
  console.log(`NEXT_PUBLIC_STRATEGY_EXECUTOR_ADDRESS=${addrs.strategyExecutor}`);
  console.log(`NEXT_PUBLIC_TOKEN_WETH=${WETH_ADDR}`);
  console.log(`NEXT_PUBLIC_TOKEN_USDC=${USDC_ADDR}`);
  console.log(`PRICE_ORACLE_ADDRESS=${addrs.oracle}`);

  console.log("\n═══ DONE ═══");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
