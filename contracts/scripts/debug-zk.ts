import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";

const deployRecord = require("../deployments/421614.json");
const ADDRS: Record<string, string> = {};
for (const [name, addr] of Object.entries(deployRecord.contracts)) {
  ADDRS[name.toLowerCase()] = addr as string;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const P = ADDRS["lendingpool"];
  const C = ADDRS["fheforgecomposer"];

  // Step 1: Check ZK verifier endpoint reachability
  console.log("\n═══ STEP 1: ZK Verifier Endpoint Reachability ═══");
  for (const url of [
    "https://testnet-cofhe.fhenix.zone",
    "https://testnet-cofhe-vrf.fhenix.zone",
    "https://testnet-cofhe-tn.fhenix.zone",
  ]) {
    try {
      const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) });
      console.log(`  ${url} → HTTP ${resp.status}`);
    } catch (e: unknown) {
      const msg = (e as Error).message?.slice(0, 80);
      console.log(`  ${url} → FAIL: ${msg}`);
    }
  }

  // Step 2: Create SDK client and trace encryption pipeline
  console.log("\n═══ STEP 2: SDK Client Setup ═══");
  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();
  console.log(`  Client connected: ${client.connected}`);
  console.log(`  Deployer: ${deployer.address}`);

  // Step 3: Test encryptInputs WITHOUT setAccount (direct call pattern)
  console.log("\n═══ STEP 3: Encrypt WITHOUT setAccount (direct Pool call) ═══");
  try {
    const [r1] = await client.encryptInputs([Encryptable.uint128(100n)])
      .onStep((step, ctx) => {
        console.log(`  Step: ${step} ${ctx?.isStart ? 'START' : 'END'} ${ctx?.duration ? ctx.duration + 'ms' : ''}`);
      })
      .execute();
    console.log(`  SUCCESS: ctHash=${r1.ctHash.toString().slice(0,16)}… utype=${r1.utype} zone=${r1.securityZone}`);
    console.log(`  Signature length: ${r1.signature?.length || 'none'}`);
  } catch (e: unknown) {
    const msg = (e as Error).message?.slice(0, 200);
    console.log(`  FAIL: ${msg}`);
  }

  // Step 4: Test encryptInputs WITH setAccount(Pool) — this SHOULD fail with InvalidSigner
  console.log("\n═══ STEP 4: Encrypt WITH setAccount(Pool) — expect on-chain revert ═══");
  try {
    const [r2] = await client.encryptInputs([Encryptable.uint128(100n)])
      .setAccount(P)
      .onStep((step, ctx) => {
        console.log(`  Step: ${step} ${ctx?.isStart ? 'START' : 'END'} ${ctx?.duration ? ctx.duration + 'ms' : ''}`);
      })
      .execute();
    console.log(`  Encryption OK: ctHash=${r2.ctHash.toString().slice(0,16)}… — but on-chain call will fail InvalidSigner`);
    // Try the on-chain call to confirm
    const pool = await ethers.getContractAt("LendingPool", P, deployer);
    const usdc = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
    try {
      await pool.shield(usdc, ethers.parseUnits("1", 6), r2);
      console.log(`  UNEXPECTED: shield with setAccount(Pool) SUCCEEDED — setAccount may not be enforced`);
    } catch (err: unknown) {
      const data = (err as { data?: string })?.data?.slice(0, 10);
      console.log(`  On-chain revert: ${data || (err as Error).message?.slice(0, 80)}`);
    }
  } catch (e: unknown) {
    const msg = (e as Error).message?.slice(0, 200);
    console.log(`  Encrypt FAIL: ${msg}`);
  }

  // Step 5: Test encryptInputs WITH setAccount(Composer) — cross-contract pattern
  console.log("\n═══ STEP 5: Encrypt WITH setAccount(Composer) — cross-contract ═══");
  try {
    const [r3] = await client.encryptInputs([Encryptable.uint128(50n)])
      .setAccount(C)
      .onStep((step, ctx) => {
        console.log(`  Step: ${step} ${ctx?.isStart ? 'START' : 'END'} ${ctx?.duration ? ctx.duration + 'ms' : ''}`);
      })
      .execute();
    console.log(`  SUCCESS: ctHash=${r3.ctHash.toString().slice(0,16)}… utype=${r3.utype}`);
    console.log(`  Signature length: ${r3.signature?.length || 'none'}`);
  } catch (e: unknown) {
    const msg = (e as Error).message?.slice(0, 200);
    console.log(`  FAIL: ${msg}`);
  }

  // Step 6: Encrypt 3 inputs for composer.openPosition — the actual failing call
  console.log("\n═══ STEP 6: Encrypt 3 inputs for composer.openPosition ═══");
  try {
    const results = await client.encryptInputs([
      Encryptable.uint128(50n),   // collateral
      Encryptable.uint128(30n),   // supply
      Encryptable.uint128(10n),   // borrow
    ])
      .setAccount(C)
      .onStep((step, ctx) => {
        console.log(`  Step: ${step} ${ctx?.isStart ? 'START' : 'END'} ${ctx?.duration ? ctx.duration + 'ms' : ''}`);
      })
      .execute();
    console.log(`  SUCCESS: ${results.length} inputs encrypted`);
    for (let i = 0; i < results.length; i++) {
      console.log(`    [${i}] ctHash=${results[i].ctHash.toString().slice(0,16)}… utype=${results[i].utype} sigLen=${results[i].signature?.length || 0}`);
    }
  } catch (e: unknown) {
    const msg = (e as Error).message?.slice(0, 300);
    console.log(`  FAIL: ${msg}`);
  }

  // Step 7: Verify on-chain — try composer.openPosition with encrypted inputs
  console.log("\n═══ STEP 7: On-chain composer.openPosition attempt ═══");
  try {
    const [eColl, eSupply, eBorrow] = await client.encryptInputs([
      Encryptable.uint128(50n),
      Encryptable.uint128(30n),
      Encryptable.uint128(10n),
    ]).setAccount(C).execute();
    
    const composer = await ethers.getContractAt("FheForgeComposer", C, deployer);
    const usdc = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
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
    const enc = { collateral: eColl, supplyEnc: eSupply, borrowEnc: eBorrow };
    
    console.log(`  Calling composer.openPosition with setAccount(${C.slice(0,10)}…)`);
    const tx = await composer.openPosition(params, enc);
    console.log(`  TX HASH: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  TX STATUS: ${receipt?.status === 1 ? 'SUCCESS' : 'FAILED'}`);
  } catch (e: unknown) {
    const err = e as { data?: string; shortMessage?: string; message?: string };
    // Extract full error details
    console.log(`  REVERT DATA: ${err?.data?.slice(0, 74) || 'none'}`);
    console.log(`  SHORT MSG: ${err?.shortMessage?.slice(0, 120) || 'none'}`);
    console.log(`  FULL MSG (first 300): ${err?.message?.slice(0, 300) || 'none'}`);
  }

  console.log("\n═══ DONE ═══");
}

main().catch(console.error);
