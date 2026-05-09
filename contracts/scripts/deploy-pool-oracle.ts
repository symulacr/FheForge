import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const [d] = await ethers.getSigners();
  const a = d.address;
  const dep = JSON.parse(fs.readFileSync("deployments/421614.json", "utf8"));

  console.log("Deployer:", a);

  // 1. Deploy fresh LendingPool
  console.log("
Deploying LendingPool...");
  const Pool = await ethers.getContractFactory("LendingPool");
  const pool = await Pool.deploy();
  const poolTx = pool.deploymentTransaction();
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`Pool: ${poolAddr} (tx: ${poolTx?.hash})`);

  // Verify OWNER
  const poolOwner = await pool.OWNER();
  console.log(`Pool OWNER: ${poolOwner} (match deployer: ${poolOwner === a})`);

  // 2. Deploy fresh PriceOracle
  console.log("
Deploying PriceOracle...");
  const PYTH = "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF";
  const Oracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await Oracle.deploy(PYTH, 86400n);
  const oracleTx = oracle.deploymentTransaction();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`Oracle: ${oracleAddr} (tx: ${oracleTx?.hash})`);

  // 3. Set WETH on pool
  const WETH = "0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";
  const swTx = await pool.setWeth(WETH);
  await swTx.wait();
  console.log(`Pool.setWeth: ${swTx.hash}`);

  // 4. Set oracle on pool
  const soTx = await pool.setOracle(oracleAddr);
  await soTx.wait();
  console.log(`Pool.setOracle: ${soTx.hash}`);

  // 5. Wire oracle for MockERC20
  const MOCK_USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
  const MOCK_WETH = "0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";
  // Pyth ETH/USD price ID on Arbitrum Sepolia
  const ETH_USD_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  // Use WETH price feed for both tokens (demo)
  const ssTx = await oracle.setSource(MOCK_WETH, ETH_USD_ID, 18, 86400n);
  await ssTx.wait();
  console.log(`Oracle.setSource(WETH): ${ssTx.hash}`);

  const ss2Tx = await oracle.setSource(MOCK_USDC, ETH_USD_ID, 6, 86400n);
  await ss2Tx.wait();
  console.log(`Oracle.setSource(USDC): ${ss2Tx.hash}`);

  const cfTx = await oracle.setCollateralFactor(MOCK_USDC, 8000, 8500);
  await cfTx.wait();
  console.log(`Oracle.setCollateralFactor(USDC): ${cfTx.hash}`);

  const cf2Tx = await oracle.setCollateralFactor(MOCK_WETH, 8000, 8500);
  await cf2Tx.wait();
  console.log(`Oracle.setCollateralFactor(WETH): ${cf2Tx.hash}`);

  // 6. Wire Composer to new pool
  const cmp = await ethers.getContractAt("FheForgeComposer", dep.contracts.FheForgeComposer, d);
  try {
    const cOwner = await (cmp as any).OWNER();
    if (cOwner.toLowerCase() === a.toLowerCase()) {
      S = { pool: poolAddr };
      console.log(`
Composer.OWNER is deployer, but POOL is immutable. Need redeploy Composer too.`);
      console.log(`Composer.pool() old: ${dep.contracts.LendingPool}`);
    }
  } catch { console.log("Composer POOL is immutable - redeploy Composer"); }

  // Deploy Composer with new pool
  console.log("
Deploying FheForgeComposer with new pool...");
  const Composer = await ethers.getContractFactory("FheForgeComposer");
  const composer = await Composer.deploy(
    dep.contracts.StrategyRegistry,
    dep.contracts.StrategyVault,
    poolAddr,
    dep.contracts.SwapRouter,
  );
  const compTx = composer.deploymentTransaction();
  await composer.waitForDeployment();
  const compAddr = await composer.getAddress();
  console.log(`Composer: ${compAddr} (tx: ${compTx?.hash})`);

  // Write updated deploy record
  dep.contracts.LendingPool = poolAddr;
  dep.contracts.PriceOracle = oracleAddr;
  dep.contracts.FheForgeComposer = compAddr;
  dep.notes = "Wave 9 full redeploy: Pool+Oracle+Composer fresh (all owned by 0x4855...)";
  fs.writeFileSync("deployments/421614.json", JSON.stringify(dep, null, 2));

  console.log("
=== New Addresses ===");
  console.log(`NEXT_PUBLIC_POOL_ADDRESS=${poolAddr}`);
  console.log(`NEXT_PUBLIC_ORACLE_ADDRESS=${oracleAddr}`);
  console.log(`NEXT_PUBLIC_COMPOSER_ADDRESS=${compAddr}`);
}
main().catch(e=>{console.error(e);process.exit(1)});
