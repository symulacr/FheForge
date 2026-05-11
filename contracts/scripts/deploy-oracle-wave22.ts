import { ethers } from "hardhat";
import * as fs from "fs";
import hre from "hardhat";

const DEPLOY_PATH = "./deployments/421614.json";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const PYTH = "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployRecord = JSON.parse(fs.readFileSync(DEPLOY_PATH, "utf8"));
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // 1. Deploy new PriceOracle
  console.log("\n=== Deploying new PriceOracle ===");
  const Oracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await Oracle.deploy(PYTH, 86400); // defaultStaleThreshold=24h
  await oracle.waitForDeployment();
  const newOracleAddr = await oracle.getAddress();
  console.log("New Oracle:", newOracleAddr);

  // 2. Configure sources
  console.log("\n=== Configuring sources ===");
  // WETH: real Pyth feed
  await (await oracle.setSource(WETH, WETH_FEED, 18, 86400)).wait();
  console.log("WETH source set (real Pyth)");
  // USDC: no Pyth feed on testnet, will use $1 fallback
  // Don't set source — leave priceId as bytes32(0) → fallback path
  console.log("USDC: no Pyth source (will use $1 fallback)");

  // Collateral factors
  await (await oracle.setCollateralFactor(WETH, 8000, 8500)).wait(); // 80% LTV, 85% liq
  console.log("WETH collateral: 80% LTV, 85% liquidation");
  await (await oracle.setCollateralFactor(USDC, 9000, 9500)).wait(); // 90% LTV, 95% liq
  console.log("USDC collateral: 90% LTV, 95% liquidation");

  // Fallback for USDC: $1.00
  await (await oracle.setFallbackPrice(USDC, ethers.parseEther("1"))).wait();
  console.log("USDC fallback: $1.00");

  // 3. Push WETH price from Hermes
  console.log("\n=== Pushing WETH Pyth price ===");
  const hermesUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH_FEED.slice(2)}`;
  const resp = await fetch(hermesUrl);
  const data = await resp.json() as { binary: { data: string[] }, parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
  const updateData = "0x" + data.binary.data[0];
  for (const p of data.parsed || []) {
    console.log(`  WETH: $${(Number(p.price.price) * Math.pow(10, p.price.expo)).toFixed(2)}`);
  }
  const fee = await oracle.getPythUpdateFee([updateData]);
  const tx = await oracle.updatePriceFeeds([updateData], { value: fee });
  await tx.wait();
  console.log("WETH price pushed on-chain");

  // 4. Verify
  console.log("\n=== Verification ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    try {
      const price = await oracle.getPriceWithFallback(addr);
      console.log(`  ${name}: $${ethers.formatEther(price)}`);
    } catch (e: unknown) {
      console.log(`  ${name}: FAIL — ${(e as Error).message?.slice(0, 80)}`);
    }
    const stale = await oracle.isStale(addr);
    console.log(`  ${name} isStale: ${stale}`);
    const convert = await oracle.convertToUsd(addr, ethers.parseUnits("1", name === "USDC" ? 6 : 18));
    console.log(`  ${name} convertToUsd(1): $${ethers.formatEther(convert)}`);
  }

  // 5. Update all contracts to use new oracle
  console.log("\n=== Updating contract references ===");
  const pool = await ethers.getContractAt("LendingPool", deployRecord.contracts.LendingPool, deployer);
  const vault = await ethers.getContractAt("StrategyVault", deployRecord.contracts.StrategyVault, deployer);
  
  // Check if Pool has setOracle or similar
  try {
    const currentOracle = await pool.oracle();
    console.log(`  Pool.oracle: ${currentOracle}`);
    if (currentOracle !== ethers.ZeroAddress) {
      await (await pool.setOracle(newOracleAddr)).wait();
      console.log("  Pool oracle updated");
    }
  } catch (e: unknown) {
    console.log(`  Pool.oracle: ${(e as Error).message?.slice(0, 60)}`);
  }
  
  try {
    const currentOracle = await vault.oracle();
    console.log(`  Vault.oracle: ${currentOracle}`);
    if (currentOracle !== ethers.ZeroAddress) {
      await (await vault.setOracle(newOracleAddr)).wait();
      console.log("  Vault oracle updated");
    }
  } catch (e: unknown) {
    console.log(`  Vault.oracle: ${(e as Error).message?.slice(0, 60)}`);
  }

  // 6. Update deployment record
  deployRecord.contracts.PriceOracle = newOracleAddr;
  deployRecord.wave = 22;
  deployRecord.waveDescription = "New PriceOracle with real Pyth + stablecoin fallback";
  fs.writeFileSync(DEPLOY_PATH, JSON.stringify(deployRecord, null, 2));
  console.log(`\nDeployment record updated (wave 22)`);

  // 7. Regenerate ABIs
  console.log("Regenerating oracle ABI...");
  const artifact = await hre.artifacts.readArtifact("PriceOracle");
  const abiPath = "../ui/abis/PriceOracle.json";
  fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
  console.log("ABI synced to ui/abis/PriceOracle.json");
}

main().catch(console.error);
