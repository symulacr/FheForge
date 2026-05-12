/**
 * Strategy Builder — Generate + execute random strategies across 20 tokens
 * Uses StrategyExecutor pipeline with checkpointing for gas-limited execution
 */
import { ethers } from "hardhat";
import deployments from "../deployments/421614.json";

const TOKENS = [
  { symbol: "WETH", addr: "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32", decimals: 18 },
  { symbol: "USDC", addr: "0x150376EdEbc5AC48771655a61a795d828BeC8Df6", decimals: 6 },
  { symbol: "WBTC", addr: "0x5FbDB2315678afecb367f032d93F642f64180aa3", decimals: 8 },
  { symbol: "ARB", addr: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", decimals: 18 },
  { symbol: "LINK", addr: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9", decimals: 18 },
  { symbol: "DAI", addr: "0x0165878A594ca255338adfa4d48449f69242Eb8F", decimals: 18 },
  { symbol: "SOL", addr: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6", decimals: 18 },
  { symbol: "AVAX", addr: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788", decimals: 18 },
  { symbol: "DOGE", addr: "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0", decimals: 18 },
  { symbol: "UNI", addr: "0x9A676e781A523b5d0C0e43731313A708CB607508", decimals: 18 },
  { symbol: "OP", addr: "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1", decimals: 18 },
  { symbol: "PYTH", addr: "0x68B1D87F95878fE05B998F19b66F4baba5De1aed", decimals: 18 },
  { symbol: "AAVE", addr: "0xc6e7DF5E7b4f2A278906862b61205850344D4e7d", decimals: 18 },
  { symbol: "NEAR", addr: "0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1", decimals: 18 },
  { symbol: "GMX", addr: "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f", decimals: 18 },
];

const SWAP_FEE = 500; // 0.05% Uniswap V3 fee tier

const ADDRS = deployments.contracts as Record<string, string>;

// Action type constants (must match StrategyExecutor.sol)
const SHIELD_SUPPLY = "0x00000001";
const BORROW_LTV = "0x00000002";
const SWAP_INTENT = "0x00000003";
const REPAY_DEBT = "0x00000004";
const DEPOSIT_VAULT = "0x00000005";
const ADD_COLLATERAL = "0x00000006";
const WITHDRAW_VAULT = "0x00000007";
const SWAP_UNISWAP_V3 = "0x00000008";

interface Action {
  actionType: string;
  params: string;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Strategy generators — each produces an Action[] pipeline
const STRATEGY_TEMPLATES = [
  // 1. Simple supply + borrow
  (tokens: typeof TOKENS): Action[] => {
    const supply = pick(tokens.filter(t => t.symbol === "USDC" || t.symbol === "DAI"));
    const borrow = pick(tokens);
    const supplyAmt = ethers.parseUnits("100", supply.decimals);
    const borrowAmt = ethers.parseUnits("20", borrow.decimals);
    return [
      { actionType: SHIELD_SUPPLY, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [supply.addr, supplyAmt]) },
      { actionType: BORROW_LTV, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [borrow.addr, borrowAmt]) },
    ];
  },

  // 2. Supply → Swap → Supply different token
  (tokens: typeof TOKENS): Action[] => {
    const tokenA = pick(tokens);
    let tokenB = pick(tokens);
    while (tokenB.symbol === tokenA.symbol) tokenB = pick(tokens);
    const amt = ethers.parseUnits("50", tokenA.decimals);
    return [
      { actionType: SHIELD_SUPPLY, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [tokenA.addr, amt]) },
      { actionType: SWAP_UNISWAP_V3, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "uint256", "uint256"], [tokenA.addr, tokenB.addr, SWAP_FEE, amt, 0n]) },
    ];
  },

  // 3. Supply → Borrow → Repay
  (tokens: typeof TOKENS): Action[] => {
    const supply = pick(tokens.filter(t => t.symbol === "USDC" || t.symbol === "DAI"));
    const borrow = pick(tokens);
    const supplyAmt = ethers.parseUnits("100", supply.decimals);
    const borrowAmt = ethers.parseUnits("30", borrow.decimals);
    return [
      { actionType: SHIELD_SUPPLY, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [supply.addr, supplyAmt]) },
      { actionType: BORROW_LTV, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [borrow.addr, borrowAmt]) },
      { actionType: REPAY_DEBT, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [borrow.addr, borrowAmt]) },
    ];
  },

  // 4. Supply → Deposit to Vault
  (tokens: typeof TOKENS): Action[] => {
    const token = pick(tokens);
    const amt = ethers.parseUnits("50", token.decimals);
    return [
      { actionType: SHIELD_SUPPLY, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [token.addr, amt]) },
      { actionType: DEPOSIT_VAULT, params: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "uint256"], [token.addr, amt, 0n]) },
    ];
  },
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Strategy Builder — Wave29");
  console.log("Deployer:", await signer.getAddress());

  const executorAddr = ADDRS.StrategyExecutor;
  const executorArtifact = require("../artifacts/contracts/StrategyExecutor.sol/StrategyExecutor.json");
  const executor = new ethers.Contract(executorAddr, executorArtifact.abi, signer);

  const erc20Abi = ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];
  const poolArtifact = require("../artifacts/contracts/LendingPool.sol/LendingPool.json");
  const pool = new ethers.Contract(ADDRS.LendingPool, poolArtifact.abi, signer);

  // Mint USDC to deployer for testing (MockERC20)
  const usdcContract = new ethers.Contract(TOKENS[1].addr, ["function balanceOf(address) view returns (uint256)"], signer);
  const usdcBal = await usdcContract.balanceOf(await signer.getAddress());
  console.log(`USDC balance: ${ethers.formatUnits(usdcBal, 6)}`);

  // Approve executor for USDC + WETH
  const usdc = new ethers.Contract(TOKENS[1].addr, erc20Abi, signer);
  const weth = new ethers.Contract(TOKENS[0].addr, erc20Abi, signer);
  await usdc.approve(executorAddr, ethers.parseUnits("10000", 6));
  await weth.approve(executorAddr, ethers.parseEther("10"));
  console.log("Approved executor for USDC + WETH");

  // Also approve Pool directly for shield operations
  await usdc.approve(ADDRS.LendingPool, ethers.parseUnits("10000", 6));
  await weth.approve(ADDRS.LendingPool, ethers.parseEther("10"));

  // Generate + execute 10 random strategies
  let passCount = 0;
  let failCount = 0;

  for (let i = 0; i < 10; i++) {
    const template = pick(STRATEGY_TEMPLATES);
    const actions = template(TOKENS);
    const strategyId = ethers.keccak256(ethers.toUtf8Bytes(`strategy-${i}-${Date.now()}`));

    console.log(`\n--- Strategy ${i + 1} (template ${STRATEGY_TEMPLATES.indexOf(template) + 1}, ${actions.length} actions) ---`);
    for (const action of actions) {
      const typeNames: Record<string, string> = {
        [SHIELD_SUPPLY]: "SHIELD_SUPPLY",
        [BORROW_LTV]: "BORROW_LTV",
        [SWAP_INTENT]: "SWAP_INTENT",
        [REPAY_DEBT]: "REPAY_DEBT",
        [DEPOSIT_VAULT]: "DEPOSIT_VAULT",
        [ADD_COLLATERAL]: "ADD_COLLATERAL",
        [WITHDRAW_VAULT]: "WITHDRAW_VAULT",
        [SWAP_UNISWAP_V3]: "SWAP_UNISWAP_V3",
      };
      console.log(`  ${typeNames[action.actionType] || action.actionType}`);
    }

    try {
      const tx = await executor.executePipeline(strategyId, actions.map(a => ({
        actionType: a.actionType,
        params: a.params,
      })), { gasLimit: 10000000n });
      const receipt = await tx.wait();
      console.log(`  PASS (gas: ${receipt.gasUsed})`);
      passCount++;
    } catch (err: any) {
      console.error(`  FAIL: ${err.message?.slice(0, 200)}`);
      failCount++;
    }
  }

  console.log(`\n═══ SUMMARY: ${passCount} PASS / ${failCount} FAIL ═══`);
}

main().catch((err) => {
  console.error("Script failed:", err.message?.slice(0, 500));
  process.exit(1);
});
