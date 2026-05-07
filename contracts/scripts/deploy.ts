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

const CONTRACTS = [
  "StrategyRegistry",
  "StrategyVault",
  "LendingPool",
  "SwapRouter",
  "PriceOracle",
  "FheForgeComposer",
] as const;

const PRODUCTION_CHAIN_IDS = new Set<number>([1, 42161, 10, 137, 8453, 43114]);

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
  timing: Record<string, string>;
  contracts: Record<string, string>;
  deploymentTxs: Record<string, string | null>;
  swapExecutor: string;
  weth: string;
  forwarder?: string;
  tokens?: Record<string, string>;
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
    console.log("Partial deployment record found — proceeding with full deploy.\n");
  }

  // ────────────────────────────────────────────
  // 1. Deploy ERC-2771 MinimalForwarder
  // ────────────────────────────────────────────

  console.log("── Deploying ERC-2771 Forwarder ──");
  const Forwarder = await ethers.getContractFactory("MinimalForwarder");
  const forwarder = await Forwarder.deploy();
  const forwarderDeployTx = forwarder.deploymentTransaction();
  await forwarder.waitForDeployment();
  const forwarderAddr = await forwarder.getAddress();
  console.log(
    `MinimalForwarder: ${forwarderAddr} (tx: ${forwarderDeployTx?.hash ?? "n/a"})\n`
  );

  // ────────────────────────────────────────────
  // 2. Deploy MockERC20 test tokens
  // ────────────────────────────────────────────

  console.log("── Deploying MockERC20 Test Tokens ──");

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

  for (const spec of tokenSpecs) {
    if (spec.envOverride && ethers.isAddress(spec.envOverride)) {
      tokens[spec.label] = spec.envOverride;
      tokenTxs[spec.label] = null;
      console.log(`  ${spec.label.padEnd(18)} ${spec.envOverride} (env override)`);
    } else {
      const token = await MockERC20.deploy();
      const tokenDeployTx = token.deploymentTransaction();
      await token.waitForDeployment();
      const tokenAddr = await token.getAddress();
      tokens[spec.label] = tokenAddr;
      tokenTxs[spec.label] = tokenDeployTx?.hash ?? null;
      console.log(`  ${spec.label.padEnd(18)} ${tokenAddr} (tx: ${tokenDeployTx?.hash ?? "n/a"})`);
    }
  }
  console.log("");

  // ────────────────────────────────────────────
  // 3. Deploy StrategyRegistry
  // ────────────────────────────────────────────

  console.log("── Deploying Core Contracts ──");

  const Registry = await ethers.getContractFactory("StrategyRegistry");
  const registry = await Registry.deploy(timing.vaultRotationDelay);
  const registryDeployTx = registry.deploymentTransaction();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(
    `StrategyRegistry:  ${registryAddr} (tx: ${registryDeployTx?.hash ?? "n/a"})`
  );

  // ────────────────────────────────────────────
  // 4. Deploy StrategyVault & wire to registry
  // ────────────────────────────────────────────

  const Vault = await ethers.getContractFactory("StrategyVault");
  const vault = await Vault.deploy(registryAddr);
  const vaultDeployTx = vault.deploymentTransaction();
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(
    `StrategyVault:     ${vaultAddr} (tx: ${vaultDeployTx?.hash ?? "n/a"})`
  );

  const setVaultTx = await registry.setVault(vaultAddr);
  await setVaultTx.wait();
  console.log(`  → registry.setVault(${vaultAddr})  (tx: ${setVaultTx.hash})`);

  // ────────────────────────────────────────────
  // 5. Deploy LendingPool
  // ────────────────────────────────────────────

  const Pool = await ethers.getContractFactory("LendingPool");
  const pool = await Pool.deploy();
  const poolDeployTx = pool.deploymentTransaction();
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(
    `LendingPool:       ${poolAddr} (tx: ${poolDeployTx?.hash ?? "n/a"})`
  );

  // ────────────────────────────────────────────
  // 6. Deploy SwapRouter
  // ────────────────────────────────────────────

  const executor = process.env.SWAP_EXECUTOR_ADDRESS ?? deployer.address;
  const Router = await ethers.getContractFactory("SwapRouter");
  const router = await Router.deploy(
    executor,
    timing.minDeadlineOffset,
    timing.maxDeadlineOffset,
    timing.executorRotationDelay,
  );
  const routerDeployTx = router.deploymentTransaction();
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log(
    `SwapRouter:        ${routerAddr} (tx: ${routerDeployTx?.hash ?? "n/a"})  executor: ${executor}`
  );

  // ────────────────────────────────────────────
  // 7. Deploy PriceOracle
  // ────────────────────────────────────────────

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
  const oracle = await Oracle.deploy(pythAddr, timing.defaultStaleThreshold);
  const oracleDeployTx = oracle.deploymentTransaction();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(
    `PriceOracle:       ${oracleAddr} (tx: ${oracleDeployTx?.hash ?? "n/a"})`
  );

  // ────────────────────────────────────────────
  // 8. Deploy FheForgeComposer
  // ────────────────────────────────────────────

  const Composer = await ethers.getContractFactory("FheForgeComposer");
  const composer = await Composer.deploy(
    registryAddr,
    vaultAddr,
    poolAddr,
    routerAddr,
  );
  const composerDeployTx = composer.deploymentTransaction();
  await composer.waitForDeployment();
  const composerAddr = await composer.getAddress();
  console.log(
    `FheForgeComposer:  ${composerAddr} (tx: ${composerDeployTx?.hash ?? "n/a"})`
  );

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
  // 10. Export ABIs to ui/abis/
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
  // 11. Write deployment record
  // ────────────────────────────────────────────

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    mode: timing.modeLabel,
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
  };

  fs.writeFileSync(
    deploymentRecordPath(chainId),
    JSON.stringify(record, null, 2),
  );
  console.log(`Deployment record written to deployments/${chainId}.json`);

  // ────────────────────────────────────────────
  // 12. Environment variable summary
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
  // 13. Optional: auto-fund tester
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
