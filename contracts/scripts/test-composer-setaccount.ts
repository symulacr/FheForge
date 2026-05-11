import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";

const ADDRS = {
  registry: "0x59d955dA6a678D140ce8379ae7175850B7481E76",
  pool:     "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb",
  vault:    "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa",
  composer: "0xbca2d4c7BC85F4594F2e531b64d7B87f3E772231",
};
const WETH = "0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();
  console.log("CoFHE client ready");

  const composer = await ethers.getContractAt("FheForgeComposer", ADDRS.composer, deployer);
  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);
  const pool = await ethers.getContractAt("LendingPool", ADDRS.pool, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer);

  const hasPos = await vault.hasPosition(deployer.address);
  const stratCount = await registry.strategyCount();
  console.log("strategyId:", stratCount.toString(), "hasPosition:", hasPos);
  if (hasPos) { console.log("ABORT: position exists"); return; }

  // Test 1: WITHOUT setAccount (default = deployer address)
  console.log("\n── Test A: encrypt WITHOUT setAccount (default user) ──");
  const collAmt = ethers.parseUnits("200", 6);
  const borrowAmt = ethers.parseUnits("80", 6);
  const [eCollA, eSupA, eBorA] = await client.encryptInputs([
    Encryptable.uint128(BigInt(collAmt)),
    Encryptable.uint64(BigInt(collAmt)),
    Encryptable.uint64(BigInt(borrowAmt)),
  ]).execute();
  const params = {
    strategyName: "Test A", workflowHash: ethers.zeroPadValue("0xd00d", 32),
    collateralAmount: collAmt, poolSupplyAmount: collAmt, poolBorrowAmount: borrowAmt,
    swapDeadlineOffset: 3600, strategyId: stratCount, swapAmountIn: borrowAmt, swapMinOut: 0n,
    collateralToken: USDC, borrowToken: USDC, swapTokenOut: WETH,
    ltvNum: 80, ltvDen: 100, useOracleBorrow: true, apyTarget: 500, loopCount: 1,
    collateralPermit: { amount: 0n, deadline: 0, nonce: 0, signature: "0x" },
  };
  const encA = { collateral: eCollA, supplyEnc: eSupA, borrowEnc: eBorA };
  try {
    await composer.openLeveragedStrategyDirect.staticCall(params, encA);
    console.log("A: staticCall succeeded");
  } catch (e: unknown) {
    console.log("A: staticCall FAILED:", String(e).slice(0, 300));
  }

  // Test 2: WITH setAccount(composer)
  console.log("\n── Test B: encrypt WITH setAccount(composer) ──");
  const [eCollB, eSupB, eBorB] = await client.encryptInputs([
    Encryptable.uint128(BigInt(collAmt)),
    Encryptable.uint64(BigInt(collAmt)),
    Encryptable.uint64(BigInt(borrowAmt)),
  ]).setAccount(ADDRS.composer).execute();
  const encB = { collateral: eCollB, supplyEnc: eSupB, borrowEnc: eBorB };
  try {
    await composer.openLeveragedStrategyDirect.staticCall(params, encB);
    console.log("B: staticCall succeeded — sending real tx...");
    const tx = await composer.openLeveragedStrategyDirect(params, encB);
    await tx.wait();
    console.log("✓ SUCCESS — tx:", tx.hash);
  } catch (e: unknown) {
    console.log("B: staticCall FAILED:", String(e).slice(0, 300));
  }
}

main().catch(console.error);
