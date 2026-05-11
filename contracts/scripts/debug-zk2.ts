import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";

const deployRecord = require("../deployments/421614.json");
const ADDRS: Record<string, string> = {};
for (const [name, addr] of Object.entries(deployRecord.contracts)) {
  ADDRS[name.toLowerCase()] = addr as string;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const C = ADDRS["fheforgecomposer"];
  const P = ADDRS["lendingpool"];
  const TM = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";

  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  // Test A: Direct Pool.shield — NO setAccount — should work
  console.log("\n═══ Test A: Pool.shield NO setAccount ═══");
  const [rA] = await client.encryptInputs([Encryptable.uint128(1n)]).execute();
  console.log(`  Encrypted: ctHash=${rA.ctHash.toString().slice(0,16)}… sigLen=${rA.signature?.length}`);
  const pool = await ethers.getContractAt("LendingPool", P, deployer);
  const usdc = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
  try {
    const tx = await pool.shield(usdc, ethers.parseUnits("1", 6), rA);
    const receipt = await tx.wait();
    console.log(`  Pool.shield TX: ${receipt?.status === 1 ? 'SUCCESS' : 'FAILED'}`);
  } catch (e: unknown) {
    const data = (e as { data?: string })?.data?.slice(0, 74);
    console.log(`  FAIL: ${data || (e as Error).message?.slice(0, 100)}`);
  }

  // Test B: Pool.shield — WITH setAccount(deployer) — deployer is msg.sender
  console.log("\n═══ Test B: Pool.shield WITH setAccount(deployer) ═══");
  const [rB] = await client.encryptInputs([Encryptable.uint128(1n)])
    .setAccount(deployer.address)
    .execute();
  try {
    const tx = await pool.shield(usdc, ethers.parseUnits("1", 6), rB);
    const receipt = await tx.wait();
    console.log(`  Pool.shield setAccount(deployer) TX: ${receipt?.status === 1 ? 'SUCCESS' : 'FAILED'}`);
  } catch (e: unknown) {
    const data = (e as { data?: string })?.data?.slice(0, 74);
    console.log(`  FAIL: ${data || (e as Error).message?.slice(0, 100)}`);
  }

  // Test C: Pool.shield — WITH setAccount(Pool) — Pool is NOT msg.sender
  console.log("\n═══ Test C: Pool.shield WITH setAccount(Pool) — expect InvalidSigner ═══");
  const [rC] = await client.encryptInputs([Encryptable.uint128(1n)])
    .setAccount(P)
    .execute();
  try {
    const tx = await pool.shield(usdc, ethers.parseUnits("1", 6), rC);
    await tx.wait();
    console.log(`  UNEXPECTED SUCCESS`);
  } catch (e: unknown) {
    const data = (e as { data?: string })?.data?.slice(0, 138);
    console.log(`  REVERT: ${data}`);
    // Decode InvalidSigner params
    if (data?.startsWith("0x7ba5ffb5")) {
      const addr1 = "0x" + data.slice(10, 74).slice(-40);
      const addr2 = "0x" + data.slice(74, 138).slice(-40);
      console.log(`  InvalidSigner(signer=${addr1}, expected=${addr2})`);
    }
  }

  // Test D: Composer.openPosition — WITH setAccount(Composer)
  console.log("\n═══ Test D: Composer.openPosition WITH setAccount(Composer) ═══");
  console.log(`  Composer address: ${C}`);
  console.log(`  Deployer address: ${deployer.address}`);
  console.log(`  msg.sender for openPosition = deployer`);
  console.log(`  msg.sender for FHE.asEuint128 inside Composer = Composer`);
  
  // The key insight: when deployer calls composer.openPosition(),
  // inside Composer, FHE.asEuint128 runs with msg.sender = Composer
  // The ZK proof has account = Composer → should match
  
  // But let's verify: what does the TaskManager see as msg.sender
  // when Composer calls verifyInput?
  // Composer calls: ITaskManager(TM).verifyInput(input, msg.sender)
  // Inside Composer, msg.sender = Composer → so sender param = Composer
  // TaskManager checks: account_in_proof == sender_param (Composer)
  // And: signature is valid (signed by authorized ZK verifier)
  
  const [eColl] = await client.encryptInputs([Encryptable.uint128(50n)])
    .setAccount(C)
    .execute();
  
  // Try just the first FHE.asEuint128 call inside Composer
  // We can't call it directly but we CAN trace the error
  const composer = await ethers.getContractAt("FheForgeComposer", C, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS["strategyregistry"], deployer);
  const strategyId = await registry.strategyCount();
  
  const params = {
    strategyName: "", workflowHash: ethers.zeroPadValue("0x00", 32),
    collateralAmount: ethers.parseUnits("50", 6),
    poolSupplyAmount: ethers.parseUnits("30", 6),
    poolBorrowAmount: ethers.parseUnits("10", 6),
    swapDeadlineOffset: 0, strategyId, swapAmountIn: 0, swapMinOut: 0,
    collateralToken: usdc, borrowToken: usdc, swapTokenOut: ethers.ZeroAddress,
    ltvNum: 80, ltvDen: 100, useOracleBorrow: false, apyTarget: 500, loopCount: 1,
  };
  const [eSupply, eBorrow] = await client.encryptInputs([
    Encryptable.uint128(30n),
    Encryptable.uint128(10n),
  ]).setAccount(C).execute();
  
  const enc = { collateral: eColl, supplyEnc: eSupply, borrowEnc: eBorrow };
  
  try {
    console.log(`  Calling openPosition...`);
    const tx = await composer.openPosition(params, enc, { gasLimit: 5000000 });
    const receipt = await tx.wait();
    console.log(`  TX: ${receipt?.status === 1 ? 'SUCCESS' : 'FAILED'}`);
  } catch (e: unknown) {
    const err = e as { data?: string; message?: string };
    const data = err?.data?.slice(0, 138) || '';
    console.log(`  REVERT DATA: ${data || 'none'}`);
    if (data.startsWith("0x7ba5ffb5")) {
      const addr1 = "0x" + data.slice(10, 74).slice(-40);
      const addr2 = "0x" + data.slice(74, 138).slice(-40);
      console.log(`  InvalidSigner(signer=${addr1}, expected=${addr2})`);
    }
    console.log(`  MSG: ${err?.message?.slice(0, 200)}`);
  }

  // Test E: What if we DON'T use setAccount for composer?
  console.log("\n═══ Test E: Composer.openPosition WITHOUT setAccount ═══");
  const [eColl2, eSupply2, eBorrow2] = await client.encryptInputs([
    Encryptable.uint128(50n),
    Encryptable.uint128(30n),
    Encryptable.uint128(10n),
  ]).execute(); // NO setAccount
  
  const enc2 = { collateral: eColl2, supplyEnc: eSupply2, borrowEnc: eBorrow2 };
  try {
    console.log(`  Calling openPosition (no setAccount)...`);
    const tx = await composer.openPosition(params, enc2, { gasLimit: 5000000 });
    const receipt = await tx.wait();
    console.log(`  TX: ${receipt?.status === 1 ? 'SUCCESS' : 'FAILED'}`);
  } catch (e: unknown) {
    const err = e as { data?: string; message?: string };
    const data = err?.data?.slice(0, 138) || '';
    console.log(`  REVERT DATA: ${data || 'none'}`);
    if (data.startsWith("0x7ba5ffb5")) {
      const addr1 = "0x" + data.slice(10, 74).slice(-40);
      const addr2 = "0x" + data.slice(74, 138).slice(-40);
      console.log(`  InvalidSigner(signer=${addr1}, expected=${addr2})`);
    }
    console.log(`  MSG: ${err?.message?.slice(0, 200)}`);
  }

  console.log("\n═══ DONE ═══");
}

main().catch(console.error);
