import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";

const ADDRS = {
  pool:     "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb",
  vault:    "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa",
  composer: "0xeF1EdEcB5Df34C732561685F5Efa788947Dd68b8",
  registry: "0x59d955dA6a678D140ce8379ae7175850B7481E76",
};
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const [deployer] = await ethers.getSigners();
  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();
  console.log("CoFHE ready");

  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer);
  const usdc = await ethers.getContractAt("IERC20", USDC, deployer);

  const hasPos = await vault.hasPosition(deployer.address);
  console.log("hasPosition:", hasPos);
  if (hasPos) { console.log("Position exists, aborting"); return; }

  // Ensure approvals
  const appTx = await usdc.approve(ADDRS.vault, ethers.parseUnits("200", 6));
  await appTx.wait();
  console.log("Approved USDC for Vault");

  // Test: Open vault position directly
  const collAmt = ethers.parseUnits("100", 6);
  const [eColl] = await client.encryptInputs([Encryptable.uint128(BigInt(collAmt))]).execute();
  console.log("Encrypted collateral, ctHash:", eColl.ctHash.toString().slice(0,16));

  const stratCount = await registry.strategyCount();
  console.log("strategyId:", stratCount.toString());

  // Try staticCall first for full error
  try {
    const result = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"].staticCall(
      USDC, collAmt, eColl, stratCount, deployer.address
    );
    console.log("staticCall returned:", result);
  } catch (e: unknown) {
    const msg = String(e);
    console.log("staticCall FAILED:", msg.slice(0, 500));
    // Try to decode custom error
    try {
      const iface = new ethers.Interface([
        "error InvalidSigner(address,address)",
        "error ACLNotAllowed()", 
        "error SameBlockClose()",
        "error PositionAlreadyExists()",
        "error InsufficientReserve()",
        "error InvalidLTV(uint128,uint128)",
      ]);
      if (typeof e === "object" && e !== null && "data" in e) {
        const data = (e as {data:string}).data;
        const decoded = iface.parseError(data);
        if (decoded) console.log("Decoded:", decoded.name, decoded.args?.toString());
      }
    } catch { /* no decode */ }
  }
}

main().catch(console.error);
