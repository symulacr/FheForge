import { ethers } from "hardhat";

const ADDRS = {
  pool: "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb",
  router: "0x20C385f6292440aaDD6a4d7F620B612B658a1a93",
  vault: "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa",
  composer: "0xbca2d4c7BC85F4594F2e531b64d7B87f3E772231",
};
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH = "0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";

async function main() {
  const [deployer] = await ethers.getSigners();

  // Pool state
  const pool = await ethers.getContractAt("LendingPool", ADDRS.pool);
  const weth = await pool.weth();
  const oracle = await pool.oracle();
  const composer = await pool.composer();
  const paused = await pool.paused();
  const psUSDC = await pool.getPlainSupplyBalance(USDC);
  const pbUSDC = await pool.getPlainBorrowBalance(USDC);
  const psWETH = await pool.getPlainSupplyBalance(WETH);
  const pbWETH = await pool.getPlainBorrowBalance(WETH);
  console.log("=== Pool State ===");
  console.log("weth:", weth);
  console.log("oracle:", oracle);
  console.log("composer:", composer);
  console.log("paused:", paused);
  console.log("plainSupply USDC:", ethers.formatUnits(psUSDC, 6));
  console.log("plainBorrow USDC:", ethers.formatUnits(pbUSDC, 6));
  console.log("plainSupply WETH:", ethers.formatEther(psWETH));
  console.log("plainBorrow WETH:", ethers.formatEther(pbWETH));

  // WETH balance of Pool
  const wethToken = await ethers.getContractAt("ERC20", WETH);
  const poolWethBal = await wethToken.balanceOf(ADDRS.pool);
  console.log("Pool WETH balance:", ethers.formatEther(poolWethBal));

  // USDC balance of Pool
  const usdcToken = await ethers.getContractAt("ERC20", USDC);
  const poolUsdcBal = await usdcToken.balanceOf(ADDRS.pool);
  console.log("Pool USDC balance:", ethers.formatUnits(poolUsdcBal, 6));

  // Pool liquidReserve
  try {
    const lrUsdc = await pool.liquidReserve(USDC);
    console.log("liquidReserve USDC:", ethers.formatUnits(lrUsdc, 6));
    const lrWeth = await pool.liquidReserve(WETH);
    console.log("liquidReserve WETH:", ethers.formatEther(lrWeth));
  } catch (e: any) { console.log("liquidReserve: not public / error:", e?.message?.slice(0,100)); }

  // Vault state
  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault);
  const regAddr = await vault.REGISTRY();
  try {
    const hasPos = await vault.hasPosition(deployer.address);
    console.log("\n=== Vault State ===");
    console.log("REGISTRY:", regAddr);
    console.log("hasPosition:", hasPos);
    if (hasPos) {
      const dep = await vault.getDepositedAmount();
      console.log("depositedAmount:", dep.toString());
    }
  } catch (e: any) { console.log("Vault error:", e?.message?.slice(0,200)); }

  // Router state
  const router = await ethers.getContractAt("SwapRouter", ADDRS.router);
  const exec = await router.executor();
  const rPaused = await router.paused();
  const minOff = await router.MIN_DEADLINE_OFFSET();
  const maxOff = await router.MAX_DEADLINE_OFFSET();
  console.log("\n=== Router State ===");
  console.log("executor:", exec);
  console.log("paused:", rPaused);
  console.log("minDeadline:", minOff.toString(), "maxDeadline:", maxOff.toString());

  // Router USDC balance (escrow)
  const routerUsdcBal = await usdcToken.balanceOf(ADDRS.router);
  console.log("Router USDC balance:", ethers.formatUnits(routerUsdcBal, 6));

  // Composer state
  const comp = await ethers.getContractAt("FheForgeComposer", ADDRS.composer);
  console.log("\n=== Composer State ===");
  const OWNER = await comp.OWNER();
  const POOL = await comp.POOL();
  const VAULT = await comp.VAULT();
  const ROUTER = await comp.ROUTER();
  const REGISTRY = await comp.REGISTRY();
  console.log("OWNER:", OWNER);
  console.log("POOL:", POOL);
  console.log("VAULT:", VAULT);
  console.log("ROUTER:", ROUTER);
  console.log("REGISTRY:", REGISTRY);
}

main().catch(e => { console.error(e); process.exit(1); });
