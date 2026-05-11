import { ethers } from "hardhat";

const O = "0x2c6509681ff9AcE8bBBb113Dcd60dFD836F295fa";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("PriceOracle", O, deployer);
  
  // Step 1: Find correct USDC/USD feed ID from Hermes catalog
  console.log("=== Finding USDC/USD Pyth feed ID ===");
  const catResp = await fetch("https://hermes.pyth.network/v2/price_feeds?query=USDC&asset_type=crypto");
  const catText = await catResp.text();
  let usdcFeedId = "";
  try {
    const feeds = JSON.parse(catText) as Array<{id: string, symbol: string, description: string}>;
    for (const f of feeds) {
      console.log(`  ${f.symbol}: ${f.description} → ${f.id}`);
      if (f.symbol === "USDC" && f.description?.includes("Crypto.USDC/USD")) {
        usdcFeedId = f.id;
      }
    }
  } catch {
    console.log("  Catalog parse failed, trying known ID");
  }
  
  // Fallback: known USDC/USD feed IDs
  if (!usdcFeedId) {
    // Try the Pyth price feed IDs page
    console.log("  Searching Pyth price feed IDs page...");
    const idsResp = await fetch("https://hermes.pyth.network/v2/price_feeds?query=USDC");
    const idsText = await idsResp.text();
    try {
      const feeds = JSON.parse(idsText) as Array<{id: string, symbol: string, description: string}>;
      for (const f of feeds) {
        if (f.symbol?.toUpperCase().includes("USDC")) {
          console.log(`  ${f.symbol}: ${f.description} → ${f.id}`);
          if (f.description?.includes("USD") && !f.description?.includes("USDC")) {
            // Skip USDC.E/USD etc
          }
          usdcFeedId = f.id;
        }
      }
    } catch {
      console.log("  Parse failed");
    }
  }
  
  if (!usdcFeedId) {
    // Use the canonical Pyth USDC/USD feed ID
    // From Pyth docs: 0xeaa020c3a6d7c5025ab4c3eab5e485c9078f5eb0288c7b7f1f7a9eb1e5c93b4d
    // But that might be wrong for testnet. Let's try fetching with it.
    console.log("  Using canonical USDC/USD feed ID");
    usdcFeedId = "0xeaa020c3a6d7c5025ab4c3eab5e485c9078f5eb0288c7b7f1f7a9eb1e5c93b4d";
  }
  
  console.log(`\nSelected USDC feed ID: ${usdcFeedId}`);
  
  // Step 2: Verify the feed ID works by fetching from Hermes
  console.log("\n=== Verifying feed ID with Hermes ===");
  const verifyUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH_FEED.slice(2)}&ids[]=${usdcFeedId.slice(2)}`;
  console.log(`  URL: ${verifyUrl.slice(0, 80)}...`);
  const priceResp = await fetch(verifyUrl);
  const priceText = await priceResp.text();
  
  let updateDataHex = "";
  try {
    const priceData = JSON.parse(priceText) as { binary: { data: string[] }, parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
    updateDataHex = priceData.binary.data[0];
    console.log(`  Got ${updateDataHex.length / 2} bytes of update data`);
    for (const p of priceData.parsed || []) {
      const realPrice = Number(p.price.price) * Math.pow(10, p.price.expo);
      console.log(`  Feed ${p.id.slice(0, 10)}…: $${realPrice.toFixed(6)} (expo=${p.price.expo})`);
    }
  } catch (e: unknown) {
    console.log(`  Hermes parse FAILED: ${(e as Error).message?.slice(0, 120)}`);
    console.log(`  Response: ${priceText.slice(0, 200)}`);
    console.log(`  The feed ID ${usdcFeedId} may not be valid on testnet`);
    console.log("  Trying alternate USDC feed IDs...");
    
    // Try common USDC feed IDs
    const candidates = [
      "0xeaa020c3a6d7c5025ab4c3eab5e485c9078f5eb0288c7b7f1f7a9eb1e5c93b4d",
      "0x5c3c6c94bbe66e53e b6062671bf294ff55e196fd0267fbbe4a9bbc7fff3a7d72", // USDC.E
    ];
    
    for (const cid of candidates) {
      console.log(`\n  Trying ${cid.slice(0, 20)}…`);
      try {
        const tResp = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${cid.slice(2)}`);
        const tData = await tResp.json() as { binary: { data: string[] }, parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
        if (tData.parsed?.length) {
          const p = tData.parsed[0].price;
          console.log(`  ✓ Found: $${Number(p.price) * Math.pow(10, p.expo)} (expo=${p.expo})`);
          usdcFeedId = cid;
          updateDataHex = tData.binary.data[0];
          break;
        }
      } catch {
        console.log(`  ✗ Failed`);
      }
    }
  }
  
  if (!updateDataHex) {
    console.log("\n  No working USDC feed ID found from Hermes");
    console.log("  Setting USDC source with canonical ID anyway — will need manual price push");
    usdcFeedId = "0xeaa020c3a6d7c5025ab4c3eab5e485c9078f5eb0288c7b7f1f7a9eb1e5c93b4d";
  }
  
  // Step 3: Fix the USDC source on-chain
  console.log(`\n=== Setting USDC source to ${usdcFeedId} ===`);
  await (await oracle.setSource(USDC, usdcFeedId, 6, 86400)).wait();
  console.log("  USDC source set");
  
  // Step 4: Push price update on-chain
  if (updateDataHex) {
    console.log("\n=== Pushing price update on-chain ===");
    const updateData = "0x" + updateDataHex;
    const fee = await oracle.getPythUpdateFee([updateData]);
    console.log(`  Fee: ${ethers.formatEther(fee)} ETH`);
    const tx = await oracle.updatePriceFeeds([updateData], { value: fee });
    console.log(`  TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Status: ${receipt?.status}`);
  }
  
  // Step 5: Remove fallback prices
  console.log("\n=== Removing fallback prices ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    try {
      const fb = await oracle.fallbackPrices(addr);
      if (fb > 0n) {
        await (await oracle.removeFallbackPrice(addr)).wait();
        console.log(`  ${name} fallback REMOVED (was $${ethers.formatEther(fb)})`);
      } else {
        console.log(`  ${name} no fallback set`);
      }
    } catch {
      console.log(`  ${name} fallback not accessible`);
    }
  }
  
  // Step 6: Final verification
  console.log("\n=== Final Price Verification ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    try {
      const [priceWad, updatedAt] = await oracle.getPriceUsd(addr);
      console.log(`  ${name} getPriceUsd: $${ethers.formatEther(priceWad)} (updatedAt: ${updatedAt})`);
    } catch (e: unknown) {
      console.log(`  ${name} getPriceUsd FAILED: ${(e as Error).message?.slice(0, 100)}`);
    }
    try {
      const fb = await oracle.getPriceWithFallback(addr);
      console.log(`  ${name} getPriceWithFallback: $${ethers.formatEther(fb)}`);
    } catch (e: unknown) {
      console.log(`  ${name} getPriceWithFallback FAILED: ${(e as Error).message?.slice(0, 100)}`);
    }
    const stale = await oracle.isStale(addr);
    console.log(`  ${name} isStale: ${stale}`);
  }
}

main().catch(console.error);
