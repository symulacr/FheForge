import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("StrategyVault", "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa", deployer);
  console.log("hasPosition:", await vault.hasPosition(deployer.address));
  try {
    const tx = await vault.emergencyWithdraw();
    await tx.wait();
    console.log("✓ emergencyWithdraw — tx:", tx.hash);
  } catch (e: unknown) {
    console.log("✗ emergencyWithdraw failed:", String(e).slice(0, 300));
  }
  console.log("hasPosition after:", await vault.hasPosition(deployer.address));
}

main().catch(console.error);
