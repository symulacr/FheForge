import { ethers } from "hardhat";

const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function main() {
  // Get the actual feed IDs from Hermes catalog
  console.log("=== Hermes USDC Feed Catalog ===");
  const resp = await fetch("https://hermes.pyth.network/v2/price_feeds?query=USDC&asset_type=crypto");
  const feeds = await resp.json() as Array<{id: string, symbol: string, description: string, display_name?: string}>;
  
  const candidates: string[] = [];
  for (const f of feeds) {
    console.log(`  id=${f.id} symbol=${f.symbol} desc=${f.description} display=${f.display_name || "n/a"}`);
    candidates.push(f.id);
  }
  
  // Try each candidate with a price fetch
  console.log("\n=== Testing each feed ID ===");
  for (const id of candidates) {
    try {
      const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id.slice(2)}`;
      const prResp = await fetch(url);
      const prData = await prResp.json() as { parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
      if (prData.parsed?.length) {
        const p = prData.parsed[0].price;
        const realPrice = Number(p.price) * Math.pow(10, p.expo);
        console.log(`  ✓ ${id.slice(0, 20)}…: $${realPrice.toFixed(6)} (expo=${p.expo} publish_time=${p.publish_time})`);
        
        // If price is close to $1, this is likely USDC/USD
        if (Math.abs(realPrice - 1) < 0.1) {
          console.log(`    → THIS IS USDC/USD! Price ≈ $1.00`);
          
          // Now try fetching with BOTH WETH + this USDC feed
          console.log(`\n=== Fetching WETH + USDC combined update ===`);
          const comboUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH_FEED.slice(2)}&ids[]=${id.slice(2)}`;
          const comboResp = await fetch(comboUrl);
          const comboData = await comboResp.json() as { binary: { data: string[] }, parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
          
          console.log(`  Got ${comboData.binary.data[0].length / 2} bytes`);
          for (const p of comboData.parsed || []) {
            const price = Number(p.price.price) * Math.pow(10, p.price.expo);
            console.log(`  Feed ${p.id.slice(0, 10)}…: $${price.toFixed(4)}`);
          }
          
          // Set USDC source on-chain
          const [deployer] = await ethers.getSigners();
          const O = "0x2c6509681ff9AcE8bBBb113Dcd60dFD836F295fa";
          const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
          const oracle = await ethers.getContractAt("PriceOracle", O, deployer);
          
          console.log(`\n=== Setting USDC source to ${id} ===`);
          await (await oracle.setSource(USDC, id, 6, 86400)).wait();
          console.log("  USDC source set");
          
          // Push combined update
          const updateData = "0x" + comboData.binary.data[0];
          const fee = await oracle.getPythUpdateFee([updateData]);
          console.log(`  Fee: ${ethers.formatEther(fee)} ETH`);
          const tx = await oracle.updatePriceFeeds([updateData], { value: fee });
          console.log(`  TX: ${tx.hash}`);
          const receipt = await tx.wait();
          console.log(`  Status: ${receipt?.status}`);
          
          // Verify
          for (const [n, a] of [["WETH", "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32"], ["USDC", USDC]]) {
            try {
              const [priceWad, updatedAt] = await oracle.getPriceUsd(a);
              console.log(`  ${n}: $${ethers.formatEther(priceWad)} (updatedAt: ${updatedAt})`);
            } catch (e: unknown) {
              console.log(`  ${n} FAILED: ${(e as Error).message?.slice(0, 80)}`);
            }
            const stale = await oracle.isStale(a);
            console.log(`  ${n} isStale: ${stale}`);
          }
          
          // Remove fallback prices
          console.log("\n=== Removing fallback prices ===");
          for (const [n, a] of [["WETH", "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32"], ["USDC", USDC]]) {
            try {
              const fb = await oracle.fallbackPrices(a);
              if (fb > 0n) {
                await (await oracle.removeFallbackPrice(a)).wait();
                console.log(`  ${n} fallback REMOVED`);
              } else {
                console.log(`  ${n} no fallback`);
              }
            } catch {
              console.log(`  ${n} fallback not accessible (private)`);
            }
          }
          
          return; // Done!
        }
      }
    } catch (e: unknown) {
      console.log(`  ✗ ${id.slice(0, 20)}…: ${(e as Error).message?.slice(0, 80)}`);
    }
  }
  
  console.log("\nNo USDC/USD feed found on Hermes testnet!");
}

main().catch(console.error);
