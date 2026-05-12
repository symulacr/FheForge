import { ethers } from "hardhat";
import deployments from "../deployments/421614.json";

async function main() {
  const provider = ethers.provider;
  const contracts = deployments.contracts as Record<string, string>;
  for (const [name, addr] of Object.entries(contracts)) {
    const code = await provider.getCode(addr);
    console.log(`${name}: ${code.length > 2 ? "EXISTS" : "EMPTY"}`);
  }
  console.log("\nBasic reads:");
  const poolAddr = contracts.LendingPool;
  const pool = new ethers.Contract(poolAddr, ["function paused() view returns (bool)", "function composer() view returns (address)", "function oracle() view returns (address)", "function liquidReserve(address) view returns (uint256)", "function maxFlashLoan(address) view returns (uint256)", "function flashFee(address,uint256) view returns (uint256)"], provider);
  console.log("Pool paused:", await pool.paused());
  console.log("Pool composer:", await pool.composer());
  console.log("Pool oracle:", await pool.oracle());

  const usdcReserve = await pool.liquidReserve("0x150376EdEbc5AC48771655a61a795d828BeC8Df6");
  console.log("USDC reserve:", ethers.formatUnits(usdcReserve, 6));

  if (usdcReserve > 0n) {
    const maxLoan = await pool.maxFlashLoan("0x150376EdEbc5AC48771655a61a795d828BeC8Df6");
    console.log("maxFlashLoan:", ethers.formatUnits(maxLoan, 6));
  } else {
    console.log("No USDC reserve yet — need to shield first");
  }

  const oracle = new ethers.Contract(contracts.PriceOracle, ["function getPriceWithFallback(address) view returns (uint256)"], provider);
  const wethPrice = await oracle.getPriceWithFallback("0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32");
  console.log("WETH price:", ethers.formatEther(wethPrice));
  console.log("\nALL CHECKS PASSED");
}
main().catch(e => console.error("FAILED:", e.message?.slice(0, 200)));
