import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";

const ADDRS = {
  pool:  "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb",
  vault: "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa",
};
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const [deployer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);

  const hasPos = await vault.hasPosition(deployer.address);
  console.log("hasPosition:", hasPos);
  if (!hasPos) { console.log("No position to close"); return; }

  const depAmt = await vault.getDepositedAmount();
  console.log("depositedAmount:", ethers.formatUnits(depAmt, 6));

  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  const [eClose] = await client.encryptInputs([Encryptable.uint128(BigInt(depAmt))]).execute();
  console.log("Closing position...");
  try {
    const tx = await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](depAmt, eClose);
    await tx.wait();
    console.log("✓ Position closed — tx:", tx.hash);
  } catch (e: unknown) {
    console.log("✗ Close failed:", String(e).slice(0, 400));
  }
}

main().catch(console.error);
