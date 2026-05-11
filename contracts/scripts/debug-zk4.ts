import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";

const DR = require("../deployments/421614.json");
const P = DR.contracts.LendingPool;
const V = DR.contracts.StrategyVault;
const C = DR.contracts.FheForgeComposer;
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const [deployer] = await ethers.getSigners();

  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  const pool = await ethers.getContractAt("LendingPool", P, deployer);

  // Test setAccount with various targets
  const targets = [
    { name: "NO setAccount", addr: "" },
    { name: "setAccount(deployer)", addr: deployer.address },
    { name: "setAccount(Pool)", addr: P },
    { name: "setAccount(Vault)", addr: V },
    { name: "setAccount(Composer)", addr: C },
  ];

  for (const t of targets) {
    console.log(`\n-- ${t.name}: ${t.addr || "(default wallet)"} --`);
    try {
      let builder = client.encryptInputs([Encryptable.uint128(1n)]);
      if (t.addr) builder = builder.setAccount(t.addr);
      const [r] = await builder.execute();
      
      // Try on-chain call
      try {
        await pool.shield.staticCall(USDC, ethers.parseUnits("1", 6), r);
        console.log(`  Pool.shield: SUCCESS`);
      } catch (e: unknown) {
        const data = (e as { data?: string })?.data?.slice(0, 74);
        if (data === "0x7ba5ffb5") {
          console.log(`  Pool.shield: InvalidSigner — STALE KEY MISMATCH`);
        } else {
          console.log(`  Pool.shield: ${data || (e as Error).message?.slice(0, 80)}`);
        }
      }
    } catch (e: unknown) {
      console.log(`  Encrypt FAIL: ${(e as Error).message?.slice(0, 100)}`);
    }
  }

  console.log("\n=== DONE ===");
}

main().catch(console.error);
