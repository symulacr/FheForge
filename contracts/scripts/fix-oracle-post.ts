import { ethers } from "hardhat";
import * as fs from "fs";

const DEPLOY_PATH = "./deployments/421614.json";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployRecord = JSON.parse(fs.readFileSync(DEPLOY_PATH, "utf8"));
  const oracle = await ethers.getContractAt("PriceOracle", deployRecord.contracts.PriceOracle, deployer);
  
  // Fix 1: Set tokenDecimals for USDC even without Pyth source
  // We need to set the source with correct decimals even though we'll remove it
  // OR: the convertToUsd function uses tokenDecimals[token] which defaults to WAD_DECIMALS=18
  // For USDC (6 decimals), we need to set it.
  // Best: set source temporarily, then remove it but keep decimals
  console.log("Fix 1: Setting USDC tokenDecimals=6");
  const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  await (await oracle.setSource(USDC, WETH_FEED, 6, 1)).wait(); // sets decimals=6
  console.log("  USDC source set (decimals=6)");
  
  // Now remove the source so getPriceWithFallback uses fallback
  await (await oracle.removeSource(USDC)).wait();
  console.log("  USDC source removed (decimals preserved in tokenDecimals mapping)");
  
  // Verify the decimals are still set
  const dec = await oracle.tokenDecimals(USDC);
  console.log(`  USDC tokenDecimals: ${dec}`);
  
  // Verify convertToUsd
  const convertUsd = await oracle.convertToUsd(USDC, ethers.parseUnits("1", 6));
  console.log(`  USDC convertToUsd(1): $${ethers.formatEther(convertUsd)}`);
  
  // Verify getPriceWithFallback still works
  const price = await oracle.getPriceWithFallback(USDC);
  console.log(`  USDC getPriceWithFallback: $${ethers.formatEther(price)}`);
  
  // Fix 2: Check Vault oracle reference
  console.log("\nFix 2: Checking Vault oracle reference");
  const vaultAddr = deployRecord.contracts.StrategyVault;
  const vault = await ethers.getContractAt("StrategyVault", vaultAddr, deployer);
  
  // Vault might store oracle differently — check storage
  // Try the ORACLE immutable or the owner pattern
  try {
    // Try reading the oracle address from common slots
    for (let i = 0; i < 20; i++) {
      const val = await ethers.provider.getStorage(vaultAddr, i);
      if (val !== ethers.ZeroHash) {
        try {
          const addr = ethers.getAddress("0x" + val.slice(-40));
          if (addr.toLowerCase() === deployRecord.contracts.PriceOracle?.toLowerCase() || 
              addr.toLowerCase() === "0x2c6509681ff9AcE8bBBb113Dcd60dFD836F295fa".toLowerCase()) {
            console.log(`  Vault slot ${i}: ${addr} (old oracle)`);
          }
        } catch {}
      }
    }
  } catch {}
  
  // Check if vault has an oracle() function
  const vaultCode = await ethers.provider.getCode(vaultAddr);
  // Search for known selectors
  const oracleSelector = ethers.id("oracle()").slice(0, 10);
  const getOracleSelector = ethers.id("getOracle()").slice(0, 10);
  const ORACLESelector = ethers.id("ORACLE()").slice(0, 10);
  
  for (const sel of [oracleSelector, getOracleSelector, ORACLESelector]) {
    if (vaultCode.includes(sel.slice(2))) {
      console.log(`  Vault has selector ${sel} — calling it`);
      try {
        const result = await ethers.provider.call({ to: vaultAddr, data: sel });
        const addr = ethers.getAddress("0x" + result.slice(-40));
        console.log(`  Vault oracle: ${addr}`);
      } catch (e: unknown) {
        console.log(`  Call failed: ${(e as Error).message?.slice(0, 80)}`);
      }
    }
  }
  
  // The Vault uses the Pool's oracle indirectly via borrowWithOracle
  // The Pool is the one that needs the oracle, and we already updated it
  console.log("\n=== Final Verification ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    const price = await oracle.getPriceWithFallback(addr);
    const convert = await oracle.convertToUsd(addr, ethers.parseUnits("1", name === "USDC" ? 6 : 18));
    console.log(`  ${name}: price=$${ethers.formatEther(price)} convertToUsd(1)=$${ethers.formatEther(convert)}`);
  }
  
  // Verify Pool oracle works
  console.log("\n=== Pool Oracle Test ===");
  const pool = await ethers.getContractAt("LendingPool", deployRecord.contracts.LendingPool, deployer);
  try {
    const poolOracle = await pool.oracle();
    console.log(`  Pool.oracle: ${poolOracle}`);
    console.log(`  Matches new oracle: ${poolOracle.toLowerCase() === deployRecord.contracts.PriceOracle.toLowerCase()}`);
  } catch (e: unknown) {
    console.log(`  Pool.oracle check failed: ${(e as Error).message?.slice(0, 80)}`);
  }
}

main().catch(console.error);
