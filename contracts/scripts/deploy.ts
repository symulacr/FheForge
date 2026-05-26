import { ethers, artifacts } from "hardhat";
import * as hardhat from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ──────────────────────────────────────────────
// Types & network access
// ──────────────────────────────────────────────

interface NetworkConfig {
  name: string;
  config: { chainId?: number };
}
const network: NetworkConfig = (hardhat as unknown as { network: NetworkConfig }).network;

const UNISWAP_V3_ROUTER = "0x101F443B4d1b059569D643917553c771E1b9663E";

const CONTRACTS = [
  "StrategyRegistry",
  "StrategyVault",
  "LendingPool",
  "SwapRouter",
  "PriceOracle",
  "FheForgeComposer",
] as const;

const PRODUCTION_CHAIN_IDS = new Set<number>([1, 42161, 10, 137, 8453, 43114]);

// Gas optimization config
const GAS_CONFIG = {
  maxFeePerGas: BigInt("50000000000"),  // 50 gwei
  maxPriorityFeePerGas: BigInt("100000000"),  // 0.1 gwei
};

// ──────────────────────────────────────────────
// Timing parameters (demo vs. production)
// ──────────────────────────────────────────────

interface TimingParams {
  vaultRotationDelay: bigint;
  minDeadlineOffset: bigint;
  maxDeadlineOffset: bigint;
  executorRotationDelay: bigint;
  defaultStaleThreshold: bigint;
  modeLabel: "production" | "demo";
}

function selectTimingParams(chainId: number): TimingParams {
  const demoEnabled = process.env.DEMO_MODE === "1";
  if (demoEnabled && PRODUCTION_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `DEMO_MODE=1 cannot be used on production chain ${chainId}. Demo timings are intended for testnets only.`
    );
  }
  if (demoEnabled) {
    return {
      vaultRotationDelay: 90n,
      minDeadlineOffset: 5n,
      maxDeadlineOffset: 300n,
      executorRotationDelay: 90n,
      defaultStaleThreshold: 86400n,
      modeLabel: "demo",
    };
  }
  return {
    vaultRotationDelay: 172800n,
    minDeadlineOffset: 30n,
    maxDeadlineOffset: 604800n,
    executorRotationDelay: 172800n,
    defaultStaleThreshold: 86400n,
    modeLabel: "production",
  };
}

// ──────────────────────────────────────────────
// Idempotency helper
// ──────────────────────────────────────────────

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
  mode: string;
  wave?: number;
  timing: Record<string, string>;
  contracts: Record<string, string>;
  deploymentTxs: Record<string, string | null>;
  swapExecutor: string;
  weth: string;
  forwarder?: string;
  tokens?: Record<string, string>;
  notes?: string;
  waveDescription?: string;
}

function deploymentRecordPath(chainId: number): string {
  const dir = path.join(__dirname, "..", "deployments");
  return path.join(dir, `${chainId}.json`);
}

function loadDeploymentRecord(chainId: number): DeploymentRecord | null {
  const filePath = deploymentRecordPath(chainId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as DeploymentRecord;
  } catch {
    console.warn(`Could not parse deployment record at ${filePath}, proceeding with fresh deploy.`);
    return null;
  }
}

// ──────────────────────────────────────────────
// Verification helper
// ──────────────────────────────────────────────

async function tryVerify(name: string, addr: string, args: unknown[]): Promise<boolean> {
  if (!process.env.ETHERSCAN_API_KEY) return false;
  try {
    await (hardhat as any).run("verify:verify", { address: addr, constructorArguments: args });
    console.log(`  ✓ Verified ${name}`);
    return true;
  } catch (e: any) {
    if (e?.message?.includes("Already Verified") || e?.message?.includes("already verified")) {
      console.log(`  ✓ ${name} already verified`);
      return true;
    }
    console.log(`  ⚠ ${name} verify failed: ${String(e).slice(0, 150)}`);
    return false;
  }
}

// ──────────────────────────────────────────────
// Main deploy function
// ──────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer available");
  const chainId = network.config.chainId ?? 0;
  const timing = selectTimingParams(chainId);

  console.log(
    `\n━━━ FheForge Deployment — ${network.name} (chainId ${chainId}) — mode: ${timing.modeLabel} ━━━\n`
  );
  console.log(
    `  vaultRotationDelay     = ${timing.vaultRotationDelay}s\n` +
    `  executorRotationDelay  = ${timing.executorRotationDelay}s\n` +
    `  minDeadlineOffset      = ${timing.minDeadlineOffset}s\n` +
    `  maxDeadlineOffset      = ${timing.maxDeadlineOffset}s\n` +
    `  defaultStaleThreshold  = ${timing.defaultStaleThreshold}s`
  );
  console.log(`  Deployer: ${deployer.address}\n`);

  // ── Idempotency check ──────────────────────
  const existing = loadDeploymentRecord(chainId);
  if (existing && existing.contracts) {
    const allDeployed = CONTRACTS.every((name) => existing.contracts[name]);
    const hasForwarder = Boolean(existing.forwarder);
    if (allDeployed && hasForwarder) {
      // Verify contracts actually exist on-chain (not self-destructed or stale)
      const addrsToCheck = [existing.forwarder, ...Object.values(existing.contracts)].filter(Boolean) as string[];
      const codes = await Promise.all(addrsToCheck.map((a) => ethers.provider.getCode(a)));
      const allHaveCode = codes.every((c) => c !== "0x");
      if (!allHaveCode) {
        console.log("Deployment record stale (some contracts missing on-chain code) — re-deploying.\n");
      } else {
        console.log("All contracts already deployed. Exiting (idempotent).");
        console.log("Existing deployment record:");
        for (const [name, addr] of Object.entries(existing.contracts)) {
          console.log(`  ${name.padEnd(18)} ${addr}`);
        }
        if (existing.forwarder) console.log(`  Forwarder          ${existing.forwarder}`);
        if (existing.tokens) {
          for (const [name, addr] of Object.entries(existing.tokens)) {
            console.log(`  ${name.padEnd(18)} ${addr}`);
          }
        }
        return;
      }
    } else {
      console.log("Partial deployment record found — proceeding with full deploy.\n");
    }
  }

  // ────────────────────────────────────────────
  // Level 0 — Parallel: Forwarder + Mock tokens
  // ────────────────────────────────────────────

  console.log("── Level 0: Deploying Forwarder + Mock Tokens (parallel) ──");

  const Forwarder = await ethers.getContractFactory("MinimalForwarder");
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const tokens: Record<string, string> = {};
  const tokenTxs: Record<string, string | null> = {};

  interface TokenSpec {
    symbol: string;
    envOverride: string | undefined;
    label: string;
  }
  const tokenSpecs: TokenSpec[] = [
    { symbol: "MCK", envOverride: undefined, label: "MockERC20-MCK" },
    { symbol: "USDC", envOverride: undefined, label: "MockERC20-USDC" },
    { symbol: "WETH", envOverride: undefined, label: "MockERC20-WETH" },
  ];

  // Deploy all independent contracts in parallel
  const [forwarder, ...tokenResults] = await Promise.all([
    (async () => {
      const f = await Forwarder.deploy(GAS_CONFIG);
      await f.waitForDeployment();
      return f;
    })(),
    ...tokenSpecs.map(async (spec) => {
      if (spec.envOverride && ethers.isAddress(spec.envOverride)) {
        return { label: spec.label, address: spec.envOverride, txHash: null, isOverride: true };
      }
      const token = await MockERC20.deploy(GAS_CONFIG);
      const tx = token.deploymentTransaction();
      await token.waitForDeployment();
      const addr = await token.getAddress();
      return { label: spec.label, address: addr, txHash: tx?.hash ?? null, isOverride: false };
    }),
  ]);

  const forwarderAddr = await forwarder.getAddress();
  const forwarderDeployTx = forwarder.deploymentTransaction();
  console.log(`MinimalForwarder: ${forwarderAddr} (tx: ${forwarderDeployTx?.hash ?? "n/a"})`);

  for (const tc of tokenResults) {
    tokens[tc.label] = tc.address;
    tokenTxs[tc.label] = tc.txHash;
    const source = tc.isOverride ? "env override" : `tx: ${tc.txHash}`;
    console.log(`  ${tc.label.padEnd(18)} ${tc.address} (${source})`);
  }
  console.log("");

  // ────────────────────────────────────────────
  // Level 1 — Parallel: Registry, Pool, Router, Oracle
  // ────────────────────────────────────────────

  console.log("── Level 1: Deploying Core Contracts (parallel) ──");

  const Registry = await ethers.getContractFactory("StrategyRegistry");
  const Pool = await ethers.getContractFactory("LendingPool");

  const executor = process.env.SWAP_EXECUTOR_ADDRESS ?? deployer.address;
  const Router = await ethers.getContractFactory("SwapRouter");

  const PYTH_BY_CHAIN: Record<number, string> = {
    421614: "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF",
    84532: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729",
    31337: process.env.PYTH_LOCAL_OVERRIDE ?? "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF",
  };
  const pythAddr = PYTH_BY_CHAIN[chainId];
  if (!pythAddr) {
    throw new Error(`No Pyth contract address configured for chain ${chainId}`);
  }

  const Oracle = await ethers.getContractFactory("PriceOracle");

  // Deploy Registry, Pool, Router, Oracle in parallel (no inter-dependencies)
  const [registry, pool, router, oracle] = await Promise.all([
    (async () => {
      const c = await Registry.deploy(timing.vaultRotationDelay, GAS_CONFIG);
      await c.waitForDeployment();
      return c;
    })(),
    (async () => {
      const c = await Pool.deploy(GAS_CONFIG);
      await c.waitForDeployment();
      return c;
    })(),
    (async () => {
      const c = await Router.deploy(
        executor,
        timing.minDeadlineOffset,
        timing.maxDeadlineOffset,
        timing.executorRotationDelay,
        UNISWAP_V3_ROUTER,
        GAS_CONFIG,
      );
      await c.waitForDeployment();
      return c;
    })(),
    (async () => {
      const c = await Oracle.deploy(pythAddr, timing.defaultStaleThreshold, GAS_CONFIG);
      await c.waitForDeployment();
      return c;
    })(),
  ]);

  const registryAddr = await registry.getAddress();
  const poolAddr = await pool.getAddress();
  const routerAddr = await router.getAddress();
  const oracleAddr = await oracle.getAddress();
  const registryDeployTx = registry.deploymentTransaction();
  const poolDeployTx = pool.deploymentTransaction();
  const routerDeployTx = router.deploymentTransaction();
  const oracleDeployTx = oracle.deploymentTransaction();
  console.log(`StrategyRegistry:  ${registryAddr} (tx: ${registryDeployTx?.hash ?? "n/a"})`);
  console.log(`LendingPool:       ${poolAddr} (tx: ${poolDeployTx?.hash ?? "n/a"})`);
  console.log(`SwapRouter:        ${routerAddr} (tx: ${routerDeployTx?.hash ?? "n/a"})  executor: ${executor}`);
  console.log(`PriceOracle:       ${oracleAddr} (tx: ${oracleDeployTx?.hash ?? "n/a"})`);

  // ────────────────────────────────────────────
  // Deploy StrategyVault (needs registryAddr from Level 1)
  // ────────────────────────────────────────────

  const Vault = await ethers.getContractFactory("StrategyVault");
  const vault = await Vault.deploy(registryAddr, GAS_CONFIG);
  const vaultDeployTx = vault.deploymentTransaction();
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`StrategyVault:     ${vaultAddr} (tx: ${vaultDeployTx?.hash ?? "n/a"})`);

  const setVaultTx = await registry.setVault(vaultAddr);
  await setVaultTx.wait();
  console.log(`  → registry.setVault(${vaultAddr})  (tx: ${setVaultTx.hash})`);

  // ────────────────────────────────────────────
  // Deploy FheForgeComposer (needs all core addresses)
  // ────────────────────────────────────────────

  const Composer = await ethers.getContractFactory("FheForgeComposer");
  const composer = await Composer.deploy(
    registryAddr,
    vaultAddr,
    poolAddr,
    routerAddr,
    GAS_CONFIG,
  );
  const composerDeployTx = composer.deploymentTransaction();
  await composer.waitForDeployment();
  const composerAddr = await composer.getAddress();
  console.log(`FheForgeComposer:  ${composerAddr} (tx: ${composerDeployTx?.hash ?? "n/a"})`);

  // ────────────────────────────────────────────
  // 9. Wire up cross-contract dependencies
  // ────────────────────────────────────────────

  console.log("\n── Wiring Dependencies ──");

  const setOracleTx = await pool.setOracle(oracleAddr);
  await setOracleTx.wait();
  console.log(`  pool.setOracle(${oracleAddr})  (tx: ${setOracleTx.hash})`);

  const wethAddr = process.env.WETH_ADDRESS ?? tokens["MockERC20-WETH"] ?? "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
  const setWethTx = await pool.setWeth(wethAddr);
  await setWethTx.wait();
  console.log(`  pool.setWeth(${wethAddr})  (tx: ${setWethTx.hash})\n`);

  // ────────────────────────────────────────────
  // 10. Verify all contracts (best-effort, parallel)
  // ────────────────────────────────────────────

  console.log("── Contract Verification ──");
  const hasKey = Boolean(process.env.ETHERSCAN_API_KEY);
  if (hasKey) {
    const verifyItems: [string, string, unknown[]][] = [
      ["StrategyRegistry", registryAddr, [timing.vaultRotationDelay.toString()]],
      ["StrategyVault", vaultAddr, [registryAddr]],
      ["LendingPool", poolAddr, []],
      ["SwapRouter", routerAddr, [executor, timing.minDeadlineOffset.toString(), timing.maxDeadlineOffset.toString(), timing.executorRotationDelay.toString(), UNISWAP_V3_ROUTER]],
      ["PriceOracle", oracleAddr, [pythAddr, timing.defaultStaleThreshold.toString()]],
      ["FheForgeComposer", composerAddr, [registryAddr, vaultAddr, poolAddr, routerAddr]],
    ];
    // Verify in parallel — these are independent
    const results = await Promise.all(
      verifyItems.map(([n, a, args]) => tryVerify(n, a, args))
    );
    const verified = results.filter(Boolean).length;
    console.log(`\n  ${verified}/${verifyItems.length} contracts verified`);
  } else {
    console.log("  ⚠ ETHERSCAN_API_KEY not set — skipping verification");
  }

  // ────────────────────────────────────────────
  // 11. Export ABIs to ui/abis/
  // ────────────────────────────────────────────

  const abiDir = path.join(__dirname, "..", "..", "ui", "abis");
  fs.mkdirSync(abiDir, { recursive: true });
  for (const name of CONTRACTS) {
    const artifact = await artifacts.readArtifact(name);
    fs.writeFileSync(
      path.join(abiDir, `${name}.json`),
      JSON.stringify(artifact.abi, null, 2),
    );
  }
  console.log(`ABIs exported to ${abiDir}`);

  // ────────────────────────────────────────────
  // ────────────────────────────────────────────

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const waveNum = process.env.DEPLOY_WAVE ? parseInt(process.env.DEPLOY_WAVE, 10) : undefined;

  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    mode: timing.modeLabel,
    wave: waveNum,
    timing: {
      vaultRotationDelay: timing.vaultRotationDelay.toString(),
      executorRotationDelay: timing.executorRotationDelay.toString(),
      minDeadlineOffset: timing.minDeadlineOffset.toString(),
      maxDeadlineOffset: timing.maxDeadlineOffset.toString(),
      defaultStaleThreshold: timing.defaultStaleThreshold.toString(),
    },
    contracts: {
      StrategyRegistry: registryAddr,
      StrategyVault: vaultAddr,
      LendingPool: poolAddr,
      SwapRouter: routerAddr,
      PriceOracle: oracleAddr,
      FheForgeComposer: composerAddr,
    },
    deploymentTxs: {
      MinimalForwarder: forwarderDeployTx?.hash ?? null,
      StrategyRegistry: registryDeployTx?.hash ?? null,
      StrategyVault: vaultDeployTx?.hash ?? null,
      LendingPool: poolDeployTx?.hash ?? null,
      SwapRouter: routerDeployTx?.hash ?? null,
      PriceOracle: oracleDeployTx?.hash ?? null,
      FheForgeComposer: composerDeployTx?.hash ?? null,
      ...tokenTxs,
      setVault: setVaultTx.hash,
      setOracle: setOracleTx.hash,
      setWeth: setWethTx.hash,
    },
    swapExecutor: executor,
    weth: wethAddr,
    forwarder: forwarderAddr,
    tokens,
    notes: process.env.DEPLOY_NOTES || undefined,
    waveDescription: process.env.DEPLOY_DESCRIPTION || undefined,
  };

  fs.writeFileSync(
    deploymentRecordPath(chainId),
    JSON.stringify(record, null, 2),
  );
  console.log(`Deployment record written to deployments/${chainId}.json`);

  // ────────────────────────────────────────────
  // 13. Export addresses to .env file
  // ────────────────────────────────────────────

  const envPath = path.join(__dirname, "..", "deployments", `${chainId}.env`);
  const envLines: string[] = [
    `# FheForge deployment — ${network.name} (chainId ${chainId}) — ${new Date().toISOString()}`,
    `NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`,
    `NEXT_PUBLIC_POOL_ADDRESS=${poolAddr}`,
    `NEXT_PUBLIC_ROUTER_ADDRESS=${routerAddr}`,
    `NEXT_PUBLIC_REGISTRY_ADDRESS=${registryAddr}`,
    `NEXT_PUBLIC_ORACLE_ADDRESS=${oracleAddr}`,
    `NEXT_PUBLIC_COMPOSER_ADDRESS=${composerAddr}`,
    `NEXT_PUBLIC_FORWARDER_ADDRESS=${forwarderAddr}`,
  ];
  for (const [label, addr] of Object.entries(tokens)) {
    envLines.push(`NEXT_PUBLIC_${label.replace(/[^A-Z0-9]/g, "_").toUpperCase()}_ADDRESS=${addr}`);
  }
  fs.writeFileSync(envPath, envLines.join("\n") + "\n");
  console.log(`Addresses exported to ${envPath}`);

  // ────────────────────────────────────────────
  // 14. Environment variable summary
  // ────────────────────────────────────────────

  console.log("\n── Environment Variables for UI / Backend ──");
  console.log(`NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`NEXT_PUBLIC_POOL_ADDRESS=${poolAddr}`);
  console.log(`NEXT_PUBLIC_ROUTER_ADDRESS=${routerAddr}`);
  console.log(`NEXT_PUBLIC_REGISTRY_ADDRESS=${registryAddr}`);
  console.log(`NEXT_PUBLIC_ORACLE_ADDRESS=${oracleAddr}`);
  console.log(`NEXT_PUBLIC_COMPOSER_ADDRESS=${composerAddr}`);
  console.log(`NEXT_PUBLIC_FORWARDER_ADDRESS=${forwarderAddr}`);
  for (const [label, addr] of Object.entries(tokens)) {
    console.log(`NEXT_PUBLIC_${label.replace(/[^A-Z0-9]/g, "_").toUpperCase()}_ADDRESS=${addr}`);
  }

  // ────────────────────────────────────────────
  // ────────────────────────────────────────────

  if (process.env.AUTO_FUND_TESTER === "1") {
    const testerAddress = process.env.TESTER_ADDRESS;
    if (testerAddress && ethers.isAddress(testerAddress)) {
      const balance = await ethers.provider.getBalance(deployer.address);
      const transferAmount = balance / 4n;
      if (transferAmount > 0n) {
        console.log(
          `\nFunding tester ${testerAddress} with ${ethers.formatEther(transferAmount)} ETH`
        );
        const fundTx = await deployer.sendTransaction({
          to: testerAddress,
          value: transferAmount,
        });
        await fundTx.wait();
        console.log(`Tester funded. Tx: ${fundTx.hash}`);
      }
    }
  }

  console.log("\n━━━ Deployment Complete ━━━\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
