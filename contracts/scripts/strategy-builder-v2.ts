/**
 * Strategy Builder v2 — Execute strategies with real CoFHE encrypted inputs
 * Uses StrategyExecutor pipeline with InEuint128 per action
 */
import { ethers } from "hardhat";
import hre from "hardhat";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import deployments from "../deployments/421614.json";

const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";

const ADDRS = deployments.contracts as Record<string, string>;

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Strategy Builder v2 — Wave30 (CoFHE encrypted)");

  // Init CoFHE client
  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(signer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();
  console.log("CoFHE client connected");

  const executorAddr = ADDRS.StrategyExecutor;
  const executorArtifact = require("../artifacts/contracts/StrategyExecutor.sol/StrategyExecutor.json");
  const executor = new ethers.Contract(executorAddr, executorArtifact.abi, signer);

  // Approve executor for USDC + WETH
  const erc20Abi = ["function approve(address,uint256) returns (bool)"];
  const usdc = new ethers.Contract(USDC, erc20Abi, signer);
  const weth = new ethers.Contract(WETH, erc20Abi, signer);
  await usdc.approve(executorAddr, ethers.parseUnits("10000", 6));
  await weth.approve(executorAddr, ethers.parseEther("10"));
  console.log("Approved executor for USDC + WETH");

  // Strategy 1: Shield 10 USDC
  console.log("\n--- Strategy 1: SHIELD_SUPPLY 10 USDC ---");
  const shieldAmt = BigInt(ethers.parseUnits("10", 6));
  const encResult = await client.encryptInputs([Encryptable.uint128(shieldAmt)]).execute();

  const strategyId = ethers.keccak256(ethers.toUtf8Bytes("strategy-1-" + Date.now()));
  const actions = [{
    actionType: "0x00000001", // SHIELD_SUPPLY
    params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [USDC, shieldAmt]),
    encAmount: encResult[0],
  }];

  try {
    const tx = await executor.executePipeline(strategyId, actions, { gasLimit: 10000000n });
    const receipt = await tx.wait();
    console.log(`PASS! Gas: ${receipt.gasUsed}`);
  } catch (err: any) {
    console.error(`FAIL: ${err.message?.slice(0, 400)}`);
  }

  // Verify the shield worked
  const poolArtifact = require("../artifacts/contracts/LendingPool.sol/LendingPool.json");
  const pool = new ethers.Contract(ADDRS.LendingPool, poolArtifact.abi, signer);
  const reserve = await pool.liquidReserve(USDC);
  console.log(`USDC reserve after shield: ${ethers.formatUnits(reserve, 6)}`);

  // Strategy 2: Shield 10 USDC + Borrow 2 USDC
  console.log("\n--- Strategy 2: SHIELD_SUPPLY + BORROW_LTV ---");
  const borrowAmt = BigInt(ethers.parseUnits("2", 6));
  const encBorrow = await client.encryptInputs([Encryptable.uint128(borrowAmt)]).execute();

  const strategyId2 = ethers.keccak256(ethers.toUtf8Bytes("strategy-2-" + Date.now()));
  const actions2 = [
    {
      actionType: "0x00000001",
      params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [USDC, shieldAmt]),
      encAmount: encResult[0], // reuse same encryption
    },
    {
      actionType: "0x00000002",
      params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [USDC, borrowAmt]),
      encAmount: encBorrow[0],
    },
  ];

  try {
    const tx = await executor.executePipeline(strategyId2, actions2, { gasLimit: 10000000n });
    const receipt = await tx.wait();
    console.log(`PASS! Gas: ${receipt.gasUsed}`);
  } catch (err: any) {
    console.error(`FAIL: ${err.message?.slice(0, 400)}`);
  }

  console.log("\n--- Done ---");
}

main().catch((err) => { console.error("Script failed:", err.message?.slice(0, 500)); process.exit(1); });
