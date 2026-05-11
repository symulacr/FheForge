import { ethers } from "hardhat";

const O = "0x2c6509681ff9AcE8bBBb113Dcd60dFD836F295fa";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("PriceOracle", O, deployer);

  // 1. Fix USDC: remove broken Pyth feed, use $1 fallback (correct for stablecoin)
  console.log("=== USDC: Fix to $1 stablecoin fallback ===");
  // Remove the broken Pyth source for USDC
  // Set priceId to zero to disable Pyth path, then set fallback
  // But we can't set priceId to zero via setSource (it checks for zero)
  // Instead, set a very long staleThreshold so Pyth path fails → fallback used
  // OR: just remove the priceId mapping entry... but there's no function for that.
  // Simplest: set the USDC priceId back to the WETH feed (which IS fresh),
  // then set fallback to $1. The getPriceWithFallback will use Pyth (WETH price)
  // first if fresh, then fallback if stale. But that gives wrong price for USDC.
  
  // Best approach: USDC uses getPriceWithFallback which tries Pyth first.
  // If Pyth feed is set but stale/no-data → falls back to fallback price.
  // Since there's no USDC-specific Pyth feed on testnet, we need to:
  // 1. Keep USDC priceId unset (bytes32(0)) → getPriceWithFallback reverts with NoPriceFeed
  // But we CAN'T unset it once set...
  
  // Actually, looking at the code:
  // getPriceWithFallback checks priceId != bytes32(0), then tries Pyth, then fallback.
  // If priceId IS set but Pyth has no data for it → it'll revert in getPriceNoOlderThan
  // before reaching the fallback.
  //
  // The cleanest fix: deploy a new oracle, or modify the contract.
  // But we can also work around: set USDC source to a valid feed that won't go stale,
  // and rely on fallback pricing.
  
  // WAIT: getPriceWithFallback flow is:
  // 1. Check stale via _isPythStale (uses getPriceUnsafe which doesn't revert)
  // 2. If NOT stale → getPriceNoOlderThan (may revert if no data)
  // 3. If stale → use fallback
  //
  // If we set USDC's staleThreshold to 1 second, the price will ALWAYS be stale
  // → always use fallback → always $1. This is the cleanest workaround.

  console.log("  Setting USDC staleThreshold=1 → always stale → always fallback");
  await (await oracle.setSource(USDC, WETH_FEED, 6, 1)).wait(); // staleThreshold=1s, always stale
  console.log("  USDC source set (staleThreshold=1s, always uses fallback)");
  
  // Set $1.00 fallback for USDC (1e18 WAD)
  const ONE_DOLLAR_WAD = ethers.parseEther("1");
  await (await oracle.setFallbackPrice(USDC, ONE_DOLLAR_WAD)).wait();
  console.log("  USDC fallback set to $1.00");

  // 2. Push fresh WETH Pyth update
  console.log("\n=== Pushing fresh WETH Pyth update ===");
  const hermesUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH_FEED.slice(2)}`;
  const resp = await fetch(hermesUrl);
  const data = await resp.json() as { binary: { data: string[] }, parsed: Array<{id: string, price: {price: string, expo: number, publish_time: number}}> };
  const updateData = "0x" + data.binary.data[0];
  
  for (const p of data.parsed || []) {
    console.log(`  WETH: $${(Number(p.price.price) * Math.pow(10, p.price.expo)).toFixed(2)}`);
  }
  
  const fee = await oracle.getPythUpdateFee([updateData]);
  const tx = await oracle.updatePriceFeeds([updateData], { value: fee });
  console.log(`  TX: ${tx.hash}`);
  await tx.wait();
  console.log("  WETH price updated");

  // 3. Verify everything
  console.log("\n=== Final Oracle Verification ===");
  for (const [name, addr] of [["WETH", WETH], ["USDC", USDC]]) {
    console.log(`\n  ${name}:`);
    console.log(`    priceId: ${await oracle.priceId(addr)}`);
    console.log(`    staleThreshold: ${(await oracle.staleThreshold(addr)).toString()}s`);
    
    try {
      const [priceWad, updatedAt] = await oracle.getPriceUsd(addr);
      console.log(`    getPriceUsd: $${ethers.formatEther(priceWad)} (updatedAt: ${updatedAt})`);
    } catch (e: unknown) {
      console.log(`    getPriceUsd: FAIL — ${(e as Error).message?.slice(0, 80)}`);
    }
    
    try {
      const price = await oracle.getPriceWithFallback(addr);
      console.log(`    getPriceWithFallback: $${ethers.formatEther(price)}`);
    } catch (e: unknown) {
      console.log(`    getPriceWithFallback: FAIL — ${(e as Error).message?.slice(0, 80)}`);
    }
    
    const stale = await oracle.isStale(addr);
    console.log(`    isStale: ${stale}`);
    
    const convertUsd = await oracle.convertToUsd(addr, ethers.parseUnits("1", name === "USDC" ? 6 : 18));
    console.log(`    convertToUsd(1 ${name}): $${ethers.formatEther(convertUsd)}`);
  }
}

main().catch(console.error);
