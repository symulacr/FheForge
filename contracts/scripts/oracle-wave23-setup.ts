import { ethers } from "hardhat";

const ORACLE = "0x51374167ec461EdEaacED41A85eB00f024dfCBe9";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function main() {
  const oracle = await ethers.getContractAt("PriceOracle", ORACLE);

  // Remove stale USDC Pyth source
  console.log("Removing USDC Pyth source...");
  let tx = await oracle.removeSource(USDC);
  await tx.wait();
  console.log("  removed");

  // Set USDC $1 fallback
  console.log("Setting USDC $1 fallback...");
  tx = await oracle.setFallbackPrice(USDC, ethers.parseEther("1"));
  await tx.wait();
  console.log("  set");

  // Push fresh WETH Pyth price
  console.log("Pushing fresh WETH Pyth price...");
  const hermesUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH_FEED.slice(2)}`;
  const resp = await fetch(hermesUrl);
  const data = await resp.json() as { binary: { data: string[] } };
  const updateData = "0x" + data.binary.data[0];
  const fee = await oracle.getPythUpdateFee.staticCall([updateData]);
  tx = await oracle.updatePriceFeeds([updateData], { value: fee });
  await tx.wait();
  console.log("  pushed");

  // Verify
  const usdcPrice = await oracle.getPriceWithFallback(USDC);
  console.log("USDC price: $" + ethers.formatEther(usdcPrice));
  const wethPrice = await oracle.getPriceWithFallback(WETH);
  console.log("WETH price: $" + ethers.formatEther(wethPrice));
}

main().catch(console.error);
