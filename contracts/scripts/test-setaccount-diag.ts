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
  console.log("Deployer:", deployer.address);

  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();
  console.log("CoFHE ready");

  const pool = await ethers.getContractAt("LendingPool", ADDRS.pool, deployer);
  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);

  // Step 1: Test Pool.supply with setAccount(composer) — Composer is msg.sender to Pool
  console.log("\n── Step 1: Pool.supplyToLending with setAccount(composer) ──");
  const supplyAmt = ethers.parseUnits("100", 6);
  const [eSupply] = await client.encryptInputs([Encryptable.uint64(BigInt(supplyAmt))])
    .setAccount(ADDRS.composer).execute();
  console.log("Encrypted supply with setAccount(composer), ctHash:", eSupply.ctHash.toString().slice(0,16));

  // Impersonate Composer to call Pool.supplyToLending
  // We can't actually do this from deployer — but we CAN test if Pool validates the input
  // Instead, let's test the simpler case: deployer calls Pool.supply (direct path) with default setAccount
  console.log("\n── Step 1b: Pool.supply (direct user call, default account) ──");
  const [eSupply2] = await client.encryptInputs([Encryptable.uint64(BigInt(supplyAmt))]).execute();
  try {
    const tx = await pool.supply(USDC, supplyAmt, eSupply2);
    await tx.wait();
    console.log("✓ Pool.supply succeeded — tx:", tx.hash);
  } catch (e: unknown) {
    console.log("✗ Pool.supply failed:", String(e).slice(0, 300));
  }

  // Step 2: Test Vault.openPosition with setAccount(composer) — Composer calls Vault
  console.log("\n── Step 2: Vault.openPosition with setAccount(composer) ──");
  const collAmt = ethers.parseUnits("100", 6);
  const [eColl] = await client.encryptInputs([Encryptable.uint128(BigInt(collAmt))])
    .setAccount(ADDRS.composer).execute();
  console.log("Encrypted collateral with setAccount(composer), ctHash:", eColl.ctHash.toString().slice(0,16));

  // Try calling Vault.openPosition directly as deployer (msg.sender = deployer ≠ composer)
  // This should fail with InvalidSigner because the signature was created for composer
  const hasPos = await vault.hasPosition(deployer.address);
  if (!hasPos) {
    try {
      // Ensure approval
      const usdc = await ethers.getContractAt("IERC20", USDC, deployer);
      const appTx = await usdc.approve(ADDRS.vault, collAmt);
      await appTx.wait();
      
      // Deployer calls Vault.openPosition with encrypted input that has setAccount(composer)
      // This should FAIL because msg.sender to Vault = deployer, but signature says composer
      const tx = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](
        USDC, collAmt, eColl, 5n, deployer.address
      );
      await tx.wait();
      console.log("✗ UNEXPECTED: Vault.openPosition succeeded with wrong setAccount (should have failed)");
    } catch (e: unknown) {
      const msg = String(e);
      console.log("✓ Vault.openPosition correctly rejected wrong setAccount:", msg.slice(0, 200));
      if (msg.includes("InvalidSigner")) console.log("  → InvalidSigner confirmed: signature account ≠ msg.sender");
    }
  } else {
    console.log("Vault position exists — skipping");
  }

  // Step 3: Test direct user path — deployer encrypts for themselves, calls Vault directly
  console.log("\n── Step 3: Vault.openPosition with default setAccount (user) ──");
  if (!hasPos) {
    const [eColl2] = await client.encryptInputs([Encryptable.uint128(BigInt(collAmt))]).execute();
    try {
      const tx = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](
        USDC, collAmt, eColl2, 5n, deployer.address
      );
      await tx.wait();
      console.log("✓ Vault.openPosition succeeded with default setAccount — tx:", tx.hash);
    } catch (e: unknown) {
      console.log("✗ Vault.openPosition failed:", String(e).slice(0, 300));
    }
  }

  console.log("\n═══ Test Complete ═══");
}

main().catch(console.error);
