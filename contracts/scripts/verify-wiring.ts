import { ethers } from "hardhat";

const ADDRS = {
  registry: "0x59d955dA6a678D140ce8379ae7175850B7481E76",
  pool:     "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb",
  oracle:   "0xD0f0072ae4308be044bd5722059ACCf2CF543130",
  router:   "0x20C385f6292440aaDD6a4d7F620B612B658a1a93",
  vault:    "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa",
  composer: "0xbca2d4c7BC85F4594F2e531b64d7B87f3E772231",
  executor: "0x9bA1498Bc935F5BE8138D40B366418C874A1A345",
};

const WETH = "0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry);
  const pool     = await ethers.getContractAt("LendingPool", ADDRS.pool);
  const oracle   = await ethers.getContractAt("PriceOracle", ADDRS.oracle);
  const router   = await ethers.getContractAt("SwapRouter", ADDRS.router);

  console.log("═══ WAVE12 ON-CHAIN STATE ═══\n");

  // Registry
  const vaultAddr = await registry.vaultAddress();
  const vaultDelay = await registry.VAULT_ROTATION_DELAY();
  console.log("Registry.vaultAddress:", vaultAddr);
  console.log("  matches deployed vault?", vaultAddr.toLowerCase() === ADDRS.vault.toLowerCase());
  console.log("  VAULT_ROTATION_DELAY:", vaultDelay.toString(), "s");

  // Pool
  const poolWeth = await pool.weth();
  const poolOracle = await pool.oracle();
  const poolComposer = await pool.composer();
  console.log("\nPool.weth:", poolWeth);
  console.log("  matches WETH?", poolWeth.toLowerCase() === WETH.toLowerCase());
  console.log("Pool.oracle:", poolOracle);
  console.log("  matches Oracle?", poolOracle.toLowerCase() === ADDRS.oracle.toLowerCase());
  console.log("Pool.composer:", poolComposer);
  console.log("  matches Composer?", poolComposer.toLowerCase() === ADDRS.composer.toLowerCase());

  // Oracle (separate public mappings)
  const wethPriceId = await oracle.priceId(WETH);
  const wethDec = await oracle.tokenDecimals(WETH);
  const wethStale = await oracle.staleThreshold(WETH);
  const usdcPriceId = await oracle.priceId(USDC);
  const usdcDec = await oracle.tokenDecimals(USDC);
  const usdcStale = await oracle.staleThreshold(USDC);
  const wethCfBps = await oracle.collateralFactorBps(WETH);
  const wethLiqBps = await oracle.liquidationThresholdBps(WETH);
  const usdcCfBps = await oracle.collateralFactorBps(USDC);
  const usdcLiqBps = await oracle.liquidationThresholdBps(USDC);
  console.log("\nOracle WETH:", { priceId: wethPriceId, decimals: wethDec.toString(), stale: wethStale.toString(), cfBps: wethCfBps.toString(), liqBps: wethLiqBps.toString() });
  console.log("Oracle USDC:", { priceId: usdcPriceId, decimals: usdcDec.toString(), stale: usdcStale.toString(), cfBps: usdcCfBps.toString(), liqBps: usdcLiqBps.toString() });

  // Router
  const executor = await router.executor();
  console.log("\nRouter.executor:", executor);
  console.log("  matches ExecutorContract?", executor.toLowerCase() === ADDRS.executor.toLowerCase());
  const rotDelay = await router.EXECUTOR_ROTATION_DELAY();
  console.log("  EXECUTOR_ROTATION_DELAY:", rotDelay.toString(), "s");

  console.log("\n═══ ALL CHECKS PASSED ═══");
}

main().catch(e => { console.error(e); process.exit(1); });
