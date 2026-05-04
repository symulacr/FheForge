









import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import * as fs from "fs";
import * as path from "path";

async function main(): Promise<void> {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "421614.json"), "utf8"),
  ) as { contracts: Record<string, string> };

  const signers = await ethers.getSigners();
  const tester = signers[1];
  console.log(`Cleanup wallet: ${tester.address}`);


  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(tester);
  await client.connect(publicClient, walletClient);
  await client.permits.createSelf({ issuer: tester.address });


  const vault = await ethers.getContractAt("StrategyVault", dep.contracts.StrategyVault, tester);
  const has = (await vault.hasPosition(tester.address)) as boolean;
  if (has) {
    const dep0 = (await vault.getDepositedAmount()) as bigint;
    console.log(`Closing leftover vault position with deposited=${dep0}…`);
    try {
      const enc = await client.encryptInputs([Encryptable.uint128(dep0)]).execute();
      const tx = await vault.closePosition(dep0, enc[0]);
      await tx.wait();
      console.log(`  ✓ closed tx=${tx.hash}`);
    } catch (e) {
      console.log(`  ✗ ${(e as Error).message.slice(0, 200)}`);
    }
  } else {
    console.log("✓ no vault position");
  }


  const pool = await ethers.getContractAt("LendingPool", dep.contracts.LendingPool, tester);
  const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const supply = (await pool.getPlainSupplyBalance(USDC)) as bigint;
  const borrow = (await pool.getPlainBorrowBalance(USDC)) as bigint;
  console.log(`Pool USDC supply=${supply} borrow=${borrow}`);
  if (borrow > 0n) {
    try {
      const enc = await client.encryptInputs([Encryptable.uint128(borrow)]).execute();
      const tx = await pool.repay(USDC, borrow, enc[0]);
      await tx.wait();
      console.log(`  ✓ repaid ${borrow} tx=${tx.hash}`);
    } catch (e) {
      console.log(`  ✗ repay: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  if (supply > 0n) {
    try {
      const enc = await client.encryptInputs([Encryptable.uint128(supply)]).execute();
      const tx = await pool.withdraw(USDC, supply, enc[0]);
      await tx.wait();
      console.log(`  ✓ withdrew ${supply} tx=${tx.hash}`);
    } catch (e) {
      console.log(`  ✗ withdraw: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  console.log("\nFinal state:");
  console.log(`  hasPosition: ${await vault.hasPosition(tester.address)}`);
  console.log(`  poolSupply: ${await pool.getPlainSupplyBalance(USDC)}`);
  console.log(`  poolBorrow: ${await pool.getPlainBorrowBalance(USDC)}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
