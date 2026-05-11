import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  const prev = JSON.parse(fs.readFileSync("deployments/421614.json", "utf8"));
  console.log("Previous deployment:", prev.wave, prev.contracts);

  // Only redeploy Composer (token flow fix)
  console.log("\n═══ Redeploying Composer ═══");
  const Composer = await ethers.getContractFactory("FheForgeComposer");
  const composer = await Composer.deploy(
    prev.contracts.StrategyRegistry,
    prev.contracts.StrategyVault,
    prev.contracts.LendingPool,
    prev.contracts.SwapRouter,
  );
  await composer.waitForDeployment();
  const composerAddr = await composer.getAddress();
  console.log("✓ New Composer:", composerAddr);

  // Update deployment record
  prev.wave = 16;
  prev.mode = "wave16";
  prev.deployedAt = new Date().toISOString();
  prev.contracts.FheForgeComposer = composerAddr;
  fs.writeFileSync("deployments/421614.json", JSON.stringify(prev, null, 2));
  console.log("✓ Deployment record updated to wave16");

  // Verify on Sourcify
  console.log("\n═══ Verifying on Sourcify ═══");
  try {
    await hre.run("verify:verify", { address: composerAddr, constructorArguments: [
      prev.contracts.StrategyRegistry,
      prev.contracts.StrategyVault,
      prev.contracts.LendingPool,
      prev.contracts.SwapRouter,
    ]});
    console.log("✓ Verified");
  } catch (e) { console.log("Verify:", String(e).slice(0, 200)); }

  console.log("\n═══ Wave16 Deploy Complete ═══");
  console.log("Composer:", composerAddr);
}

main().catch(console.error);
