import { ethers } from "hardhat";

const O = "0x2c6509681ff9AcE8bBBb113Dcd60dFD836F295fa";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("PriceOracle", O, deployer);
  
  // Check USDC feed — we need this for cross-asset borrows
  console.log("=== USDC Feed Check ===");
  const usdcFeedId = await oracle.priceId(USDC);
  console.log(`  USDC priceId: ${usdcFeedId}`);
  
  if (usdcFeedId === ethers.ZeroHash) {
    // USDC/USD Pyth feed ID on arb-sepolia
    // From Pyth docs: Crypto.USDC/USD = 0xeaa020c3a6d7c5025ab4c3eab5e485c9078f5eb0288c7b7f1f7a9eb1e5c93b4d
    // But let's use the correct one for testnet
    console.log("  USDC has no price feed — setting it up...");
    // USDC/USD Pyth price feed ID (same across all EVM chains)
    const USDC_USD_FEED = "0xeaa020c3a6d7c5025ab4c3eab5e485c9078f5eb0288c7b7f1f7a9eb1e5c93b4d";
    await (await oracle.setSource(USDC, USDC_USD_FEED, 6, 86400)).wait();
    console.log("  USDC source set with Pyth feed");
  }
  
  // Fetch and push USDC price update from Hermes
  console.log("\n=== Fetching USDC Pyth update ===");
  const usdcFeedIdNow = await oracle.priceId(USDC);
  const hermesUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH.slice(2)}&ids[]=${usdcFeedIdNow.slice(2)}`;
  
  const response = await fetch(hermesUrl);
  const data = await response.json() as { binary: { data: string[] }, parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
  
  if (!data.binary?.data?.length) throw new Error("No binary update data");
  const updateData = "0x" + data.binary.data[0];
  console.log(`  Got update data (${data.binary.data[0].length / 2} bytes)`);
  
  // Show parsed prices
  for (const p of data.parsed || []) {
    const realPrice = Number(p.price.price) * Math.pow(10, p.price.expo);
    console.log(`  Feed ${p.id.slice(0, 10)}…: $${realPrice.toFixed(4)} (publish_time: ${p.price.publish_time})`);
  }
  
  // Push update on-chain
  const fee = await oracle.getPythUpdateFee([updateData]);
  console.log(`  Fee: ${ethers.formatEther(fee)} ETH`);
  const tx = await oracle.updatePriceFeeds([updateData], { value: fee });
  console.log(`  TX: ${tx.hash}`);
  await tx.wait();
  console.log(`  Update confirmed`);
  
  // Verify both prices
  console.log("\n=== Final Price Verification ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    try {
      const [priceWad, updatedAt] = await oracle.getPriceUsd(addr);
      console.log(`  ${name}: $${ethers.formatEther(priceWad)} (updatedAt: ${updatedAt})`);
    } catch (e: unknown) {
      console.log(`  ${name} getPriceUsd FAILED: ${(e as Error).message?.slice(0, 120)}`);
    }
    
    try {
      const price = await oracle.getPriceWithFallback(addr);
      console.log(`  ${name} getPriceWithFallback: $${ethers.formatEther(price)}`);
    } catch (e: unknown) {
      console.log(`  ${name} getPriceWithFallback FAILED: ${(e as Error).message?.slice(0, 120)}`);
    }
    
    const isStale = await oracle.isStale(addr);
    console.log(`  ${name} isStale: ${isStale}`);
    
    const convertUsd = await oracle.convertToUsd(addr, ethers.parseUnits("1", name === "USDC" ? 6 : 18));
    console.log(`  ${name} convertToUsd(1): $${ethers.formatEther(convertUsd)}`);
  }
  
  // Remove fallback prices — we now use real Pyth
  console.log("\n=== Removing Fallback Prices ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    try {
      const fb = await oracle.fallbackPrices(addr);
      if (fb > 0n) {
        await (await oracle.removeFallbackPrice(addr)).wait();
        console.log(`  ${name} fallback price REMOVED`);
      } else {
        console.log(`  ${name} has no fallback price (already clean)`);
      }
    } catch (e: unknown) {
      console.log(`  ${name} fallback check: ${(e as Error).message?.slice(0, 80)}`);
    }
  }
}

main().catch(console.error);
