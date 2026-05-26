import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Read existing addresses from v4 deployment backup
  const OLD = JSON.parse(fs.readFileSync("deployments/421614.json", "utf8"));

  // 1. Deploy StrategyRegistry with wave 9 changes
  console.log("\n── Deploying StrategyRegistry ──");
  const Registry = await ethers.getContractFactory("StrategyRegistry");
  const registry = await Registry.deploy(90n); // demo timing
  const regTx = registry.deploymentTransaction();
  await registry.waitForDeployment();
  const regAddr = await registry.getAddress();
  console.log(`Registry: ${regAddr} (tx: ${regTx?.hash})`);

  // 2. Deploy StrategyVault — unchanged but needs fresh deploy (constructor unchanged)
  console.log("\n── Deploying StrategyVault ──");
  const Vault = await ethers.getContractFactory("StrategyVault");
  const vault = await Vault.deploy(regAddr);
  const vaultTx = vault.deploymentTransaction();
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`Vault: ${vaultAddr} (tx: ${vaultTx?.hash})`);

  // Wire vault to registry
  const svTx = await registry.setVault(vaultAddr);
  await svTx.wait();
  console.log(`setVault: ${svTx.hash}`);

  // 3. Deploy FheForgeComposer with wave 8 changes
  console.log("\n── Deploying FheForgeComposer ──");
  const poolAddr = OLD.contracts.LendingPool;
  const routerAddr = OLD.contracts.SwapRouter;
  const Composer = await ethers.getContractFactory("FheForgeComposer");
  const composer = await Composer.deploy(regAddr, vaultAddr, poolAddr, routerAddr);
  const compTx = composer.deploymentTransaction();
  await composer.waitForDeployment();
  const compAddr = await composer.getAddress();
  console.log(`Composer: ${compAddr} (tx: ${compTx?.hash})`);

  // 4. Wire registry to vault
  console.log(`\nregistry.setVault(${vaultAddr}) done`);

  // Summary
  console.log("\n── New addresses ──");
  console.log(`NEXT_PUBLIC_REGISTRY_ADDRESS=${regAddr}`);
  console.log(`NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`NEXT_PUBLIC_COMPOSER_ADDRESS=${compAddr}`);
  console.log(`NEXT_PUBLIC_POOL_ADDRESS=${poolAddr}  (unchanged)`);
  console.log(`NEXT_PUBLIC_ROUTER_ADDRESS=${routerAddr}  (unchanged)`);
  console.log(`NEXT_PUBLIC_ORACLE_ADDRESS=${OLD.contracts.PriceOracle}  (unchanged)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
