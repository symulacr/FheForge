import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("StrategyVault", "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa", deployer);
  const pool = await ethers.getContractAt("LendingPool", "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb", deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", "0x59d955dA6a678D140ce8379ae7175850B7481E76", deployer);

  console.log("Vault paused:", await vault.paused());
  console.log("Pool paused:", await pool.paused());
  console.log("Registry paused:", await registry.paused());

  if (await vault.paused()) {
    const tx = await vault.unpause();
    await tx.wait();
    console.log("Vault unpaused — tx:", tx.hash);
  }
  if (await pool.paused()) {
    const tx = await pool.unpause();
    await tx.wait();
    console.log("Pool unpaused — tx:", tx.hash);
  }
  if (await registry.paused()) {
    const tx = await registry.unpause();
    await tx.wait();
    console.log("Registry unpaused — tx:", tx.hash);
  }

  console.log("After fix — Vault:", await vault.paused(), "Pool:", await pool.paused(), "Registry:", await registry.paused());
}

main().catch(console.error);
