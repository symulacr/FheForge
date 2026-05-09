import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync("deployments/421614.json", "utf8"));
  console.log("Deployer:", deployer.address);

  // 1. Deploy new SwapRouter (deployer = OWNER, ExecutorContract = executor)
  console.log("\n── Deploying ExecutorContract first (to use as SwapRouter executor) ──");
  const ExecContract = await ethers.getContractFactory("ExecutorContract");
  const execContract = await ExecContract.deploy();
  await execContract.waitForDeployment();
  const execAddr = await execContract.getAddress();
  console.log("ExecutorContract:", execAddr);

  console.log("\n── Deploying SwapRouter (deployer as OWNER, ExecutorContract as executor) ──");
  const Router = await ethers.getContractFactory("SwapRouter");
  const router = await Router.deploy(
    execAddr,     // executor = ExecutorContract
    60n,          // minDeadlineOffset = 60s
    86400n,       // maxDeadlineOffset = 1 day
    90n,          // executorRotationDelay = 90s (DEMO_MODE)
  );
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("SwapRouter:", routerAddr);

  // 2. Deploy new LendingPool (with onlyComposer gate + setComposer)
  console.log("\n── Deploying LendingPool ──");
  const Pool = await ethers.getContractFactory("LendingPool");
  const pool = await Pool.deploy();
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("Pool:", poolAddr);

  // 3. Deploy new PriceOracle (with ZeroAmount guard)
  console.log("\n── Deploying PriceOracle ──");
  const PYTH = "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF";
  const Oracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await Oracle.deploy(PYTH, 86400n);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("Oracle:", oracleAddr);

  // 4. Deploy new StrategyVault (FHE ACL fix in closePosition)
  console.log("\n── Deploying StrategyVault ──");
  const Vault = await ethers.getContractFactory("StrategyVault");
  const vault = await Vault.deploy(dep.contracts.StrategyRegistry);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("Vault:", vaultAddr);

  // 5. Wire registry → vault (timelocked rotation — 90s delay)
  console.log("\n── Rotating vault on registry ──");
  const registry = await ethers.getContractAt("StrategyRegistry", dep.contracts.StrategyRegistry);
  const rotationDelay = await registry.VAULT_ROTATION_DELAY();
  console.log("Vault rotation delay:", rotationDelay.toString(), "seconds");
  await (await registry.proposeVault(vaultAddr)).wait();
  console.log("Registry.proposeVault done — waiting", rotationDelay.toString(), "s for timelock...");
  await new Promise(resolve => setTimeout(resolve, Number(rotationDelay) * 1000 + 2000));
  await (await registry.acceptVault()).wait();
  console.log("Registry.acceptVault done");

  // 6. Deploy new FheForgeComposer (references new SwapRouter)
  console.log("\n── Deploying FheForgeComposer ──");
  const Composer = await ethers.getContractFactory("FheForgeComposer");
  const composer = await Composer.deploy(
    dep.contracts.StrategyRegistry,
    vaultAddr,
    poolAddr,
    routerAddr,    // NEW SwapRouter address
  );
  await composer.waitForDeployment();
  const composerAddr = await composer.getAddress();
  console.log("Composer:", composerAddr);

  // 7. Wire LendingPool dependencies
  console.log("\n── Wiring LendingPool ──");
  const WETH = dep.weth;
  await (await pool.setWeth(WETH)).wait();
  console.log("Pool.setWeth done");
  await (await pool.setOracle(oracleAddr)).wait();
  console.log("Pool.setOracle done");

  // 8. CRITICAL: Wire setComposer
  await (await pool.setComposer(composerAddr)).wait();
  console.log("Pool.setComposer(", composerAddr, ") done");

  // 9. Wire PriceOracle sources
  console.log("\n── Wiring PriceOracle ──");
  const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
  const WETH_PYTH_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  await (await oracle.setSource(WETH, WETH_PYTH_ID, 18, 86400n)).wait();
  await (await oracle.setSource(USDC, WETH_PYTH_ID, 6, 86400n)).wait();
  await (await oracle.setCollateralFactor(USDC, 8000, 8500)).wait();
  await (await oracle.setCollateralFactor(WETH, 8000, 8500)).wait();
  console.log("Oracle feeds set");

  // 10. Update deployment record
  dep.contracts.SwapRouter = routerAddr;
  dep.contracts.LendingPool = poolAddr;
  dep.contracts.PriceOracle = oracleAddr;
  dep.contracts.StrategyVault = vaultAddr;
  dep.contracts.FheForgeComposer = composerAddr;
  dep.contracts.ExecutorContract = execAddr;
  dep.wave = 11;
  dep.deployedAt = new Date().toISOString();
  dep.notes = "Wave 11: full redeploy with SwapRouter owned by deployer, ExecutorContract as executor, all wiring complete";
  fs.writeFileSync("deployments/421614.json", JSON.stringify(dep, null, 2));

  console.log("\n── NEW ADDRESSES ──");
  console.log("SWAP_ROUTER:", routerAddr);
  console.log("EXECUTOR:", execAddr);
  console.log("POOL:", poolAddr);
  console.log("ORACLE:", oracleAddr);
  console.log("VAULT:", vaultAddr);
  console.log("COMPOSER:", composerAddr);
  console.log("REGISTRY:", dep.contracts.StrategyRegistry, "(unchanged)");

  console.log("\n── ENV VARS FOR UI ──");
  console.log(`NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=${routerAddr}`);
  console.log(`NEXT_PUBLIC_ROUTER_ADDRESS=${routerAddr}`);
  console.log(`NEXT_PUBLIC_POOL_ADDRESS=${poolAddr}`);
  console.log(`NEXT_PUBLIC_ORACLE_ADDRESS=${oracleAddr}`);
  console.log(`NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`NEXT_PUBLIC_COMPOSER_ADDRESS=${composerAddr}`);
  console.log(`NEXT_PUBLIC_REGISTRY_ADDRESS=${dep.contracts.StrategyRegistry}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
