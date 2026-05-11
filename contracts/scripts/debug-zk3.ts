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

  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  // CRITICAL TEST: When deployer calls Composer.openPosition,
  // inside Composer, FHE.asEuint128 runs with msg.sender = Composer
  // If we use setAccount(Composer), then account_in_proof = Composer = msg.sender
  // This should PASS the account check even though signer key is stale
  //
  // But Test D FAILED with data=null (different error than InvalidSigner)
  // Let me debug with full error extraction

  console.log("\n═══ Re-test: Composer.openPosition WITH setAccount(Composer) ═══");
  console.log(`  Composer: ${C}`);
  console.log(`  Deployer: ${deployer.address}`);
  
  // Approve tokens first
  const usdc = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
  const erc20Abi = [
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
  ];
  const usdcContract = await ethers.getContractAt(erc20Abi, usdc, deployer);
  await (await usdcContract.approve(C, ethers.MaxUint256)).wait();
  
  // Approve pool too
  await (await usdcContract.approve(P, ethers.MaxUint256)).wait();
  
  // Shield to pool first
  const pool = await ethers.getContractAt("LendingPool", P, deployer);
  const [eShield] = await client.encryptInputs([Encryptable.uint128(ethers.parseUnits("1000", 6))]).execute();
  try {
    await (await pool.shield(usdc, ethers.parseUnits("1000", 6), eShield)).wait();
    console.log("  Pre-shield: SUCCESS");
  } catch (e) {
    console.log(`  Pre-shield FAIL: ${(e as Error).message?.slice(0, 80)}`);
  }

  // Now test composer.openPosition with setAccount(Composer)
  const composer = await ethers.getContractAt("FheForgeComposer", C, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS["strategyregistry"], deployer);
  const strategyId = await registry.strategyCount();

  const collAmt = ethers.parseUnits("50", 6);
  const supplyAmt = ethers.parseUnits("30", 6);
  const borrowAmt = ethers.parseUnits("10", 6);
  
  const [eColl, eSupply, eBorrow] = await client.encryptInputs([
    Encryptable.uint128(BigInt(collAmt)),
    Encryptable.uint128(BigInt(supplyAmt)),
    Encryptable.uint128(BigInt(borrowAmt)),
  ]).setAccount(C).execute();

  const params = {
    strategyName: "", workflowHash: ethers.zeroPadValue("0x00", 32),
    collateralAmount: collAmt, poolSupplyAmount: supplyAmt, poolBorrowAmount: borrowAmt,
    swapDeadlineOffset: 0, strategyId, swapAmountIn: 0, swapMinOut: 0,
    collateralToken: usdc, borrowToken: usdc, swapTokenOut: ethers.ZeroAddress,
    ltvNum: 80, ltvDen: 100, useOracleBorrow: false, apyTarget: 500, loopCount: 1,
  };
  const enc = { collateral: eColl, supplyEnc: eSupply, borrowEnc: eBorrow };

  // Use staticCall first to get the revert reason without spending gas
  console.log("\n  staticCall test...");
  try {
    const result = await composer.openPosition.staticCall(params, enc);
    console.log(`  staticCall SUCCESS: strategyId=${result[0]} intentId=${result[1]}`);
  } catch (e: unknown) {
    const err = e as { data?: string; shortMessage?: string; message?: string; info?: { error?: { data?: string } } };
    console.log(`  staticCall FAIL`);
    console.log(`    data: ${err?.data?.slice(0, 138) || 'none'}`);
    console.log(`    shortMessage: ${err?.shortMessage?.slice(0, 120) || 'none'}`);
    // Try to extract error from inner error
    const innerData = (err as { error?: { data?: string } })?.error?.data;
    if (innerData) console.log(`    inner data: ${innerData.slice(0, 138)}`);
    // Try to decode using known selectors
    const sel = err?.data?.slice(0, 10) || '';
    if (sel === '0x7ba5ffb5') {
      const a1 = "0x" + (err?.data || '').slice(10, 74).slice(-40);
      const a2 = "0x" + (err?.data || '').slice(74, 138).slice(-40);
      console.log(`    InvalidSigner(signer=${a1}, expected=${a2})`);
    }
    if (sel === '0xd0d25976') {
      const a1 = "0x" + (err?.data || '').slice(10, 74).slice(-40);
      console.log(`    SenderNotAllowed(sender=${a1})`);
    }
    if (sel === '0x1f2a2005') console.log('    ZeroAmount()');
    if (sel === '0x28b35f21') console.log('    InsufficientReserve()');
    if (sel === '0x3a23d825') console.log('    InsufficientCollateral()');
    if (sel === '0xceb51810') console.log('    NotComposer()');
  }

  // Also test: what happens with setAccount(deployer) for composer?
  console.log("\n═══ Test: Composer.openPosition WITH setAccount(deployer) ═══");
  const [eColl2, eSupply2, eBorrow2] = await client.encryptInputs([
    Encryptable.uint128(BigInt(collAmt)),
    Encryptable.uint128(BigInt(supplyAmt)),
    Encryptable.uint128(BigInt(borrowAmt)),
  ]).setAccount(deployer.address).execute();
  
  const enc2 = { collateral: eColl2, supplyEnc: eSupply2, borrowEnc: eBorrow2 };
  try {
    const result = await composer.openPosition.staticCall(params, enc2);
    console.log(`  SUCCESS: strategyId=${result[0]} intentId=${result[1]}`);
  } catch (e: unknown) {
    const err = e as { data?: string };
    console.log(`  FAIL: ${err?.data?.slice(0, 74) || (e as Error).message?.slice(0, 100)}`);
  }

  console.log("\n═══ DONE ═══");
}

main().catch(console.error);
