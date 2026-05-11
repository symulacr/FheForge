import { ethers } from "hardhat";

const O = "0x2c6509681ff9AcE8bBBb113Dcd60dFD836F295fa";
const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("PriceOracle", O, deployer);
  
  // Step 1: Fetch latest price update data from Hermes
  console.log("Fetching Pyth price update from Hermes...");
  const hermesUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH_FEED}`;
  const response = await fetch(hermesUrl);
  if (!response.ok) throw new Error(`Hermes fetch failed: ${response.status}`);
  const data = await response.json() as { binary: { data: string[] }, parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
  
  if (!data.binary?.data?.length) throw new Error("No binary update data from Hermes");
  const updateDataHex = data.binary.data[0];
  console.log(`  Got update data (${updateDataHex.length / 2} bytes)`);
  
  if (data.parsed?.length) {
    const p = data.parsed[0].price;
    const realPrice = Number(p.price) * Math.pow(10, p.expo);
    console.log(`  WETH/USD: $${realPrice.toFixed(2)} (publish_time: ${p.publish_time})`);
  }
  
  // Step 2: Convert hex update data to bytes[] for on-chain call
  // The update data is a hex string — we need to pass it as bytes[]
  const updateDataBytes = "0x" + updateDataHex;
  const updateDataArray: string[] = [updateDataBytes];
  
  // Step 3: Get the update fee
  const fee = await oracle.getPythUpdateFee(updateDataArray);
  console.log(`  Update fee: ${ethers.formatEther(fee)} ETH`);
  
  // Step 4: Call updatePriceFeeds on-chain
  console.log(`  Sending updatePriceFeeds tx with ${ethers.formatEther(fee)} ETH...`);
  const tx = await oracle.updatePriceFeeds(updateDataArray, { value: fee });
  console.log(`  TX hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  Receipt status: ${receipt?.status}`);
  
  // Step 5: Verify the price is now fresh
  console.log("\n=== Verifying price after update ===");
  try {
    const [priceWad, updatedAt] = await oracle.getPriceUsd(
      "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32" // WETH
    );
    console.log(`  WETH Pyth price: $${ethers.formatEther(priceWad)} (updatedAt: ${updatedAt})`);
  } catch (e: unknown) {
    console.log(`  getPriceUsd FAILED: ${(e as Error).message?.slice(0, 120)}`);
  }
  
  try {
    const fallbackPrice = await oracle.getPriceWithFallback(
      "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32"
    );
    console.log(`  WETH getPriceWithFallback: $${ethers.formatEther(fallbackPrice)}`);
  } catch (e: unknown) {
    console.log(`  getPriceWithFallback FAILED: ${(e as Error).message?.slice(0, 120)}`);
  }
  
  const isStale = await oracle.isStale("0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32");
  console.log(`  WETH isStale: ${isStale}`);
}

main().catch(console.error);
