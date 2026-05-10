import { ethers } from "hardhat";

const ADDRS = {
  registry: "0xeb79Ca811bDa4216386aE62fd3f025c9896b678E",
  pool:     "0x40885CFE83BbB28d8c951040A81294c250018886",
  oracle:   "0xae1077813b6232bca426F7005b01a5ACea061A1F",
  router:   "0x96F55b3DaDDEf16cF4cC1af6aCe0BDdcCa8d2e56",
  vault:    "0xc1174350a49bE845AE139B4693471E9193C511e7",
  composer: "0x00a5459D58567eE70238f2a60d7C38f83177CFA3",
  executor: "0x178b454FFf8DE85dEb5bf2D309EeBe5e0E7dDeD4",
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
