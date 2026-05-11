import { ethers } from "hardhat";

const ORACLE = "0xCd18800c5b1ba85eD81A2d201102D37A1B551245";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const WETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function main() {
  const oracle = await ethers.getContractAt("PriceOracle", ORACLE);
  console.log("Removing USDC Pyth source...");
  let tx = await oracle.removeSource(USDC);
  await tx.wait();
  console.log("Setting USDC $1 fallback...");
  tx = await oracle.setFallbackPrice(USDC, ethers.parseEther("1"));
  await tx.wait();
  console.log("Pushing WETH Pyth price...");
  const resp = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${WETH_FEED.slice(2)}`);
  const data = await resp.json() as { binary: { data: string[] } };
  const updateData = "0x" + data.binary.data[0];
  const fee = await oracle.getPythUpdateFee.staticCall([updateData]);
  tx = await oracle.updatePriceFeeds([updateData], { value: fee });
  await tx.wait();
  const usdcP = await oracle.getPriceWithFallback(USDC);
  const wethP = await oracle.getPriceWithFallback(WETH);
  console.log(`USDC: $${ethers.formatEther(usdcP)}`);
  console.log(`WETH: $${ethers.formatEther(wethP)}`);
}
main().catch(console.error);
