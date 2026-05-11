import { ethers } from "hardhat";

const O = "0x2c6509681ff9AcE8bBBb113Dcd60dFD836F295fa";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("PriceOracle", O, deployer);
  
  // Check current state
  console.log("Current USDC priceId:", await oracle.priceId(USDC));
  console.log("Current WETH priceId:", await oracle.priceId(WETH));
  
  // The USDC priceId is WRONG — it's set to the WETH feed!
  // Need to find the correct USDC/USD Pyth feed ID
  // Let's search Pyth price feed catalog
  console.log("\nSearching Pyth price feed catalog for USDC/USD...");
  const catalogUrl = "https://hermes.pyth.network/v2/price_feeds?query=USDC&asset_type=crypto";
  const resp = await fetch(catalogUrl);
  const catalog = await resp.json() as Array<{id: string, symbol: string, description: string}>;
  
  let usdcFeedId = "";
  for (const feed of catalog) {
    if (feed.symbol === "USDC" && feed.description?.includes("USD")) {
      console.log(`  Found: ${feed.symbol} — ${feed.description} — id: ${feed.id}`);
      usdcFeedId = feed.id;
      break;
    }
  }
  
  if (!usdcFeedId) {
    // Try alternate: Crypto.USDC/USD
    // The canonical USDC/USD ID from Pyth
    console.log("  Using known USDC/USD feed ID from Pyth docs");
    usdcFeedId = "0xeaa020c3a6d7c5025ab4c3eab5e485c9078f5eb0288c7b7f1f7a9eb1e5c93b4d";
  }
  
  // Fix the USDC source
  console.log(`\nSetting USDC source to ${usdcFeedId}...`);
  await (await oracle.setSource(USDC, usdcFeedId, 6, 86400)).wait();
  console.log("  USDC source set");
  
  // Also set collateral factor for USDC if not set
  const usdcLtv = await oracle.collateralFactorBps(USDC);
  console.log(`  USDC collateralFactorBps: ${usdcLtv}`);
  if (usdcLtv === 0n) {
    await (await oracle.setCollateralFactor(USDC, 9000, 9500)).wait();
    console.log("  USDC collateral factor set: 90% LTV, 95% liquidation");
  }
  
  // Now push both WETH and USDC price updates
  console.log("\n=== Fetching price updates for WETH + USDC ===");
  const hermesUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH_FEED.slice(2)}&ids[]=${usdcFeedId.slice(2)}`;
  const response = await fetch(hermesUrl);
  const data = await response.json() as { binary: { data: string[] }, parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
  
  if (!data.binary?.data?.length) throw new Error("No binary update data from Hermes");
  const updateData = "0x" + data.binary.data[0];
  
  for (const p of data.parsed || []) {
    const realPrice = Number(p.price.price) * Math.pow(10, p.price.expo);
    console.log(`  Feed ${p.id.slice(0, 10)}…: $${realPrice.toFixed(4)}`);
  }
  
  const fee = await oracle.getPythUpdateFee([updateData]);
  console.log(`  Fee: ${ethers.formatEther(fee)} ETH`);
  const tx = await oracle.updatePriceFeeds([updateData], { value: fee });
  console.log(`  TX: ${tx.hash}`);
  await tx.wait();
  console.log("  Update confirmed");
  
  // Verify
  console.log("\n=== Final Verification ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    try {
      const [priceWad, updatedAt] = await oracle.getPriceUsd(addr);
      console.log(`  ${name}: $${ethers.formatEther(priceWad)} (updatedAt: ${updatedAt})`);
    } catch (e: unknown) {
      console.log(`  ${name} getPriceUsd FAILED: ${(e as Error).message?.slice(0, 120)}`);
    }
    const isStale = await oracle.isStale(addr);
    console.log(`  ${name} isStale: ${isStale}`);
  }
  
  // Remove fallback prices
  console.log("\n=== Removing Fallback Prices ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    try {
      const fb = await oracle.fallbackPrices(addr);
      if (fb > 0n) {
        await (await oracle.removeFallbackPrice(addr)).wait();
        console.log(`  ${name} fallback price REMOVED`);
      } else {
        console.log(`  ${name} no fallback to remove`);
      }
    } catch {
      console.log(`  ${name} fallback not accessible`);
    }
  }
}

main().catch(console.error);
