import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";

const POOL = "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb";

async function main() {
  const [deployer] = await ethers.getSigners();
  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  // Test supplyEth — encrypt 0.01 ETH as euint64
  const amount = ethers.parseEther("0.01");
  console.log("Encrypting", ethers.formatEther(amount), "ETH as euint64...");
  const [encAmt] = await client.encryptInputs([Encryptable.uint64(BigInt(amount))]).execute();
  console.log("Encrypted:", { utype: encAmt.utype, securityZone: encAmt.securityZone });

  const pool = await ethers.getContractAt("LendingPool", POOL, deployer);
  try {
    const tx = await pool.supplyEth(encAmt, { value: amount });
    await tx.wait();
    console.log("✓ supplyEth SUCCESS:", tx.hash);
  } catch (e: unknown) {
    const err = e as { data?: string; shortMessage?: string };
    console.log("✗ supplyEth FAIL:", err?.data?.slice(0, 20) || err?.shortMessage || String(e).slice(0, 200));
  }
}

main().catch(console.error);
