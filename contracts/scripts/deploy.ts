import { ethers, artifacts } from "hardhat";
import * as hardhat from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface NetworkConfig {
  name: string;
  config: { chainId?: number };
}
const network: NetworkConfig = (hardhat as unknown as { network: NetworkConfig })
  .network;

const CONTRACTS = [
  "StrategyRegistry",
  "StrategyVault",
  "LendingPool",
  "SwapRouter",
  "PriceOracle",
  "FheForgeComposer",
] as const;

// Production-mode L1/L2 chain IDs that MUST never accept demo-mode parameters.
const PRODUCTION_CHAIN_IDS = new Set<number>([
  1, // Ethereum mainnet
  42161, // Arbitrum One
  10, // Optimism
  137, // Polygon
  8453, // Base
  43114, // Avalanche C
]);

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
      `DEMO_MODE=1 cannot be used on production chain ${chainId}. ` +
        `Demo timings are intended for testnets only.`,
    );
  }
  if (demoEnabled) {
    // 5-min demo budget: longest cycle (rotation + accept) ≈ 100 s.
    return {
      vaultRotationDelay: 90n,
      minDeadlineOffset: 5n,
      maxDeadlineOffset: 300n,
      executorRotationDelay: 90n,
      defaultStaleThreshold: 86400n, // KEEP 1 day — Chainlink USDC heartbeat
      modeLabel: "demo",
    };
  }
  return {
    vaultRotationDelay: 172800n, // 48 h
    minDeadlineOffset: 30n,
    maxDeadlineOffset: 604800n, // 7 days
    executorRotationDelay: 172800n,
    defaultStaleThreshold: 86400n, // 1 day
    modeLabel: "production",
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer available");
  const chainId = network.config.chainId ?? 0;
  const timing = selectTimingParams(chainId);
  console.log(
    `Deploying on ${network.name} (chainId ${chainId}) — mode: ${timing.modeLabel}`,
  );
  console.log(
    `  vaultRotationDelay     = ${timing.vaultRotationDelay}s\n` +
      `  executorRotationDelay  = ${timing.executorRotationDelay}s\n` +
      `  minDeadlineOffset      = ${timing.minDeadlineOffset}s\n` +
      `  maxDeadlineOffset      = ${timing.maxDeadlineOffset}s\n` +
      `  defaultStaleThreshold  = ${timing.defaultStaleThreshold}s`,
  );
  console.log(`Deployer: ${deployer.address}`);

  const Registry = await ethers.getContractFactory("StrategyRegistry");
  const registry = await Registry.deploy(timing.vaultRotationDelay);
  const registryDeployTx = registry.deploymentTransaction();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(
    `StrategyRegistry: ${registryAddr} (tx: ${registryDeployTx?.hash ?? "n/a"})`,
  );

  const Vault = await ethers.getContractFactory("StrategyVault");
  const vault = await Vault.deploy(registryAddr);
  const vaultDeployTx = vault.deploymentTransaction();
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(
    `StrategyVault:    ${vaultAddr} (tx: ${vaultDeployTx?.hash ?? "n/a"})`,
  );

  const setVaultTx = await registry.setVault(vaultAddr);
  await setVaultTx.wait();
  console.log(`Vault wired to registry (tx: ${setVaultTx.hash})`);

  const Pool = await ethers.getContractFactory("LendingPool");
  const pool = await Pool.deploy();
  const poolDeployTx = pool.deploymentTransaction();
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(
    `LendingPool:      ${poolAddr} (tx: ${poolDeployTx?.hash ?? "n/a"})`,
  );

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
    `SwapRouter:       ${routerAddr} (tx: ${routerDeployTx?.hash ?? "n/a"}) (executor: ${executor})`,
  );

  // Pyth Network contract — chain → address.
  // arb-sepolia (421614): 0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF (per Pyth docs).
  // base-sepolia (84532): 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729.
  const PYTH_BY_CHAIN: Record<number, string> = {
    421614: "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF",
    84532: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729",
    31337: process.env.PYTH_LOCAL_OVERRIDE ?? "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF",
  };
  const pythAddr = PYTH_BY_CHAIN[chainId];
  if (!pythAddr) throw new Error(`No Pyth contract address configured for chain ${chainId}`);
  const Oracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await Oracle.deploy(pythAddr, timing.defaultStaleThreshold);
  const oracleDeployTx = oracle.deploymentTransaction();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`PriceOracle:      ${oracleAddr} (tx: ${oracleDeployTx?.hash ?? "n/a"})`);

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
  console.log(`FheForgeComposer: ${composerAddr} (tx: ${composerDeployTx?.hash ?? "n/a"})`);

  // Wire oracle + WETH into the pool. Tokens + Chainlink feeds are configured by
  // a follow-up admin script (configure-oracle.ts) so deploys are idempotent and
  // re-deployable without baking testnet addresses into the deployer logic.
  const setOracleTx = await pool.setOracle(oracleAddr);
  await setOracleTx.wait();
  console.log(`Pool.setOracle:   ${oracleAddr} (tx: ${setOracleTx.hash})`);

  const wethAddr = process.env.WETH_ADDRESS ?? "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73"; // arb-sepolia WETH
  const setWethTx = await pool.setWeth(wethAddr);
  await setWethTx.wait();
  console.log(`Pool.setWeth:     ${wethAddr} (tx: ${setWethTx.hash})`);

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

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const record = {
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
      StrategyRegistry: registryDeployTx?.hash ?? null,
      StrategyVault: vaultDeployTx?.hash ?? null,
      LendingPool: poolDeployTx?.hash ?? null,
      SwapRouter: routerDeployTx?.hash ?? null,
      PriceOracle: oracleDeployTx?.hash ?? null,
      FheForgeComposer: composerDeployTx?.hash ?? null,
      setVault: setVaultTx.hash,
      setOracle: setOracleTx.hash,
      setWeth: setWethTx.hash,
    },
    swapExecutor: executor,
    weth: wethAddr,
  };
  fs.writeFileSync(
    path.join(deploymentsDir, `${chainId}.json`),
    JSON.stringify(record, null, 2),
  );
  console.log(`Deployment record written to deployments/${chainId}.json`);

  console.log("\nEnvironment variables for UI / backend:");
  console.log(`NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`NEXT_PUBLIC_POOL_ADDRESS=${poolAddr}`);
  console.log(`NEXT_PUBLIC_ROUTER_ADDRESS=${routerAddr}`);
  console.log(`NEXT_PUBLIC_REGISTRY_ADDRESS=${registryAddr}`);
  console.log(`NEXT_PUBLIC_ORACLE_ADDRESS=${oracleAddr}`);
  console.log(`NEXT_PUBLIC_COMPOSER_ADDRESS=${composerAddr}`);

  // Optional: auto-forward 25% of remaining deployer balance to the tester
  // wallet so end-to-end hardhat scripts can run as the tester. Disabled by
  // default; enable with AUTO_FUND_TESTER=1 + TESTER_ADDRESS=0x...
  if (process.env.AUTO_FUND_TESTER === "1") {
    const testerAddress = process.env.TESTER_ADDRESS;
    if (testerAddress && ethers.isAddress(testerAddress)) {
      const balance = await ethers.provider.getBalance(deployer.address);
      const transferAmount = balance / 4n;
      if (transferAmount > 0n) {
        console.log(
          `\nFunding tester ${testerAddress} with ${ethers.formatEther(transferAmount)} ETH`,
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
