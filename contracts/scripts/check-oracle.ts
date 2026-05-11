import { ethers } from "hardhat";

const O = "0x2c6509681ff9AcE8bBBb113Dcd60dFD836F295fa";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const PYTH = "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF";

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("PriceOracle", O, deployer);
  
  // Check Pyth address
  console.log("Pyth address:", await oracle.PYTH());
  console.log("Owner:", await oracle.OWNER());
  console.log("Default stale threshold:", (await oracle.DEFAULT_STALE_THRESHOLD()).toString(), "seconds");
  console.log("Staleness threshold:", (await oracle.stalenessThreshold()).toString(), "seconds");
  
  // Check registered tokens
  console.log("\n=== WETH ===");
  console.log("  priceId:", await oracle.priceId(WETH));
  console.log("  tokenDecimals:", (await oracle.tokenDecimals(WETH)).toString());
  console.log("  staleThreshold:", (await oracle.staleThreshold(WETH)).toString());
  console.log("  collateralFactorBps:", (await oracle.collateralFactorBps(WETH)).toString());
  console.log("  liquidationThresholdBps:", (await oracle.liquidationThresholdBps(WETH)).toString());
  console.log("  hasFallback:", await oracle.hasFallback(WETH));
  try {
    const fallback = await oracle.fallbackPrices(WETH);
    console.log("  fallbackPrice:", ethers.formatEther(fallback));
  } catch { console.log("  fallbackPrice: not set"); }
  console.log("  isStale:", await oracle.isStale(WETH));
  
  console.log("\n=== USDC ===");
  console.log("  priceId:", await oracle.priceId(USDC));
  console.log("  tokenDecimals:", (await oracle.tokenDecimals(USDC)).toString());
  console.log("  staleThreshold:", (await oracle.staleThreshold(USDC)).toString());
  console.log("  collateralFactorBps:", (await oracle.collateralFactorBps(USDC)).toString());
  console.log("  liquidationThresholdBps:", (await oracle.liquidationThresholdBps(USDC)).toString());
  console.log("  hasFallback:", await oracle.hasFallback(USDC));
  try {
    const fallback = await oracle.fallbackPrices(USDC);
    console.log("  fallbackPrice:", ethers.formatEther(fallback));
  } catch { console.log("  fallbackPrice: not set"); }
  console.log("  isStale:", await oracle.isStale(USDC));
  
  // Try to get price from Pyth directly
  console.log("\n=== Pyth Price Check ===");
  try {
    const [price, updatedAt] = await oracle.getPriceUsd(WETH);
    console.log(`  WETH Pyth price: $${ethers.formatEther(price)} (updated: ${updatedAt})`);
  } catch (e: unknown) {
    console.log(`  WETH Pyth price FAILED: ${(e as Error).message?.slice(0, 100)}`);
  }
  try {
    const price = await oracle.getPriceWithFallback(WETH);
    console.log(`  WETH fallback price: $${ethers.formatEther(price)}`);
  } catch (e: unknown) {
    console.log(`  WETH fallback FAILED: ${(e as Error).message?.slice(0, 100)}`);
  }
  
  // Check the Pyth contract on-chain
  console.log("\n=== On-chain Pyth Contract ===");
  const pythCode = await ethers.provider.getCode(PYTH);
  console.log(`  Pyth at ${PYTH}: ${pythCode === "0x" ? "NO CODE" : "HAS CODE (" + pythCode.length + " chars)"}`);
  
  // Try to get WETH feed data from Pyth directly
  const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  try {
    const pyth = await ethers.getContractAt([
      "function getPriceUnsafe(bytes32) view returns (int64 price, uint64 conf, int32 expo, uint publishTime)"
    ], PYTH, deployer);
    const p = await pyth.getPriceUnsafe(WETH_FEED);
    console.log(`  WETH Pyth raw: price=${p.price} conf=${p.conf} expo=${p.expo} publishTime=${p.publishTime}`);
  } catch (e: unknown) {
    console.log(`  Pyth getPriceUnsafe FAILED: ${(e as Error).message?.slice(0, 100)}`);
  }
}

main().catch(console.error);
