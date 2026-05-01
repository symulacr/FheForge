/**
 * post-deploy-test.js
 * Runs against the live testnet deployment recorded in deployments/<chainId>.json.
 * Calls every public read function on each contract; records txhashes for state-changing
 * calls into post-deploy-evidence.json.
 *
 * Coverage:
 *   StrategyRegistry: OWNER, vaultAddress, strategyCount, registerStrategy, getStrategyMeta
 *   StrategyVault:    REGISTRY, hasPosition, getDepositedAmount
 *   LendingPool:      getPlainSupplyBalance, getPlainBorrowBalance
 *   SwapRouter:       EXECUTOR
 *   Native ETH:       deployer & tester balances
 *   USDC ERC-20:      tester balance, approve(vault), approve(pool)
 *
 * FHE-mutating calls (openPosition, supply, repay, etc.) require the off-chain
 * Encryptable SDK and the cofhe coprocessor; covered separately by the
 * hardhat suite under test/StrategyVault.test.ts (mock-FHE).
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const provider = hre.ethers.provider;
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const recordPath = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(recordPath)) {
    throw new Error(`No deployment record at ${recordPath}`);
  }
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const { StrategyRegistry, StrategyVault, LendingPool, SwapRouter } =
    record.contracts;

  const [deployer] = await hre.ethers.getSigners();
  const testerKey = process.env.TESTER_PRIVATE_KEY;
  if (!testerKey) throw new Error("TESTER_PRIVATE_KEY env var missing");
  const tester = new hre.ethers.Wallet(testerKey, provider);

  console.log(`\n=== POST-DEPLOY TEST on ${network.name} (chainId ${chainId}) ===`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Tester:   ${tester.address}\n`);

  const evidence = {
    network: network.name,
    chainId,
    timestamp: new Date().toISOString(),
    contracts: record.contracts,
    reads: {},
    writes: {},
    pass: [],
    fail: [],
  };
  const pass = (label, info) => {
    console.log(`  ✓ ${label}: ${info ?? "ok"}`);
    evidence.pass.push(label);
  };
  const fail = (label, info) => {
    console.log(`  ✗ ${label}: ${info}`);
    evidence.fail.push({ label, info });
  };

  // ── 1. StrategyRegistry reads ──────────────────────────────────────────
  console.log("── 1. StrategyRegistry ──");
  const regAbi = [
    "function OWNER() view returns (address)",
    "function vaultAddress() view returns (address)",
    "function strategyCount() view returns (uint256)",
    "function getStrategyMeta(uint256) view returns (string,bytes32,address,uint256,bool)",
    "function registerStrategy(string,bytes32) returns (uint256)",
    "event StrategyRegistered(uint256 indexed id, address indexed creator, string name)",
  ];
  const registry = new hre.ethers.Contract(StrategyRegistry, regAbi, deployer);
  try {
    const [owner, vaultAddr, count] = await Promise.all([
      registry.OWNER(),
      registry.vaultAddress(),
      registry.strategyCount(),
    ]);
    evidence.reads.registry = {
      OWNER: owner,
      vaultAddress: vaultAddr,
      strategyCount: count.toString(),
    };
    if (owner.toLowerCase() === deployer.address.toLowerCase()) {
      pass("Registry.OWNER", owner);
    } else {
      fail("Registry.OWNER", `expected ${deployer.address}, got ${owner}`);
    }
    if (vaultAddr.toLowerCase() === StrategyVault.toLowerCase()) {
      pass("Registry.vaultAddress", vaultAddr);
    } else {
      fail("Registry.vaultAddress", `expected ${StrategyVault}, got ${vaultAddr}`);
    }
    pass("Registry.strategyCount", count.toString());
  } catch (e) {
    fail("Registry reads", e.message);
  }

  // Register a strategy
  try {
    const tx = await registry.registerStrategy(
      "FheForge Live Test Strategy",
      hre.ethers.ZeroHash,
    );
    const rcpt = await tx.wait();
    evidence.writes.registerStrategy = { tx: tx.hash, block: rcpt.blockNumber };
    pass("Registry.registerStrategy", `tx=${tx.hash}`);
    const newCount = await registry.strategyCount();
    const meta = await registry.getStrategyMeta(newCount);
    evidence.reads.firstStrategy = {
      id: newCount.toString(),
      name: meta[0],
      creator: meta[2],
      active: meta[4],
    };
    pass(
      "Registry.getStrategyMeta",
      `id=${newCount} name="${meta[0]}" active=${meta[4]}`,
    );
  } catch (e) {
    fail("Registry.registerStrategy", e.message);
  }

  // ── 2. StrategyVault reads ─────────────────────────────────────────────
  console.log("\n── 2. StrategyVault ──");
  const vaultAbi = [
    "function REGISTRY() view returns (address)",
    "function hasPosition(address) view returns (bool)",
    "function getDepositedAmount() view returns (uint256)",
  ];
  const vault = new hre.ethers.Contract(StrategyVault, vaultAbi, tester);
  try {
    const [regAddr, hasPos, deposited] = await Promise.all([
      vault.REGISTRY(),
      vault.hasPosition(tester.address),
      vault.getDepositedAmount(),
    ]);
    evidence.reads.vault = {
      REGISTRY: regAddr,
      hasPosition: hasPos,
      depositedAmount: deposited.toString(),
    };
    if (regAddr.toLowerCase() === StrategyRegistry.toLowerCase()) {
      pass("Vault.REGISTRY", regAddr);
    } else {
      fail("Vault.REGISTRY", `expected ${StrategyRegistry}, got ${regAddr}`);
    }
    pass("Vault.hasPosition(tester)", `${hasPos}`);
    pass("Vault.getDepositedAmount(tester)", `${deposited}`);
  } catch (e) {
    fail("Vault reads", e.message);
  }

  // ── 3. LendingPool reads ───────────────────────────────────────────────
  console.log("\n── 3. LendingPool ──");
  const poolAbi = [
    "function getPlainSupplyBalance(address) view returns (uint256)",
    "function getPlainBorrowBalance(address) view returns (uint256)",
  ];
  const pool = new hre.ethers.Contract(LendingPool, poolAbi, tester);
  const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  try {
    const [supply, borrow] = await Promise.all([
      pool.getPlainSupplyBalance(USDC),
      pool.getPlainBorrowBalance(USDC),
    ]);
    evidence.reads.pool = {
      USDC,
      supply: supply.toString(),
      borrow: borrow.toString(),
    };
    pass("Pool.getPlainSupplyBalance(tester,USDC)", `${supply}`);
    pass("Pool.getPlainBorrowBalance(tester,USDC)", `${borrow}`);
  } catch (e) {
    fail("Pool reads", e.message);
  }

  // ── 4. SwapRouter reads ────────────────────────────────────────────────
  console.log("\n── 4. SwapRouter ──");
  const routerAbi = ["function EXECUTOR() view returns (address)"];
  const router = new hre.ethers.Contract(SwapRouter, routerAbi, tester);
  try {
    const exec = await router.EXECUTOR();
    evidence.reads.router = { EXECUTOR: exec };
    if (exec.toLowerCase() === record.swapExecutor.toLowerCase()) {
      pass("Router.EXECUTOR", exec);
    } else {
      fail("Router.EXECUTOR", `expected ${record.swapExecutor}, got ${exec}`);
    }
  } catch (e) {
    fail("Router reads", e.message);
  }

  // ── 5. ERC-20 USDC approvals from tester to vault + pool ───────────────
  console.log("\n── 5. USDC approvals from tester ──");
  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
  ];
  const usdc = new hre.ethers.Contract(USDC, erc20Abi, tester);
  try {
    const bal = await usdc.balanceOf(tester.address);
    evidence.reads.testerUsdcBalance = bal.toString();
    pass("USDC.balanceOf(tester)", `${hre.ethers.formatUnits(bal, 6)}`);

    const tx1 = await usdc.approve(StrategyVault, hre.ethers.MaxUint256);
    const r1 = await tx1.wait();
    evidence.writes.approveVault = { tx: tx1.hash, block: r1.blockNumber };
    pass("USDC.approve(vault, MAX)", `tx=${tx1.hash}`);

    const tx2 = await usdc.approve(LendingPool, hre.ethers.MaxUint256);
    const r2 = await tx2.wait();
    evidence.writes.approvePool = { tx: tx2.hash, block: r2.blockNumber };
    pass("USDC.approve(pool, MAX)", `tx=${tx2.hash}`);

    const allowVault = await usdc.allowance(tester.address, StrategyVault);
    const allowPool = await usdc.allowance(tester.address, LendingPool);
    evidence.reads.testerAllowances = {
      vault: allowVault.toString(),
      pool: allowPool.toString(),
    };
    pass("USDC.allowance(tester→vault)", `${allowVault}`);
    pass("USDC.allowance(tester→pool)", `${allowPool}`);
  } catch (e) {
    fail("USDC tester approvals", e.message);
  }

  // ── 6. Final balance snapshot ──────────────────────────────────────────
  console.log("\n── 6. Final balances ──");
  const ethDep = await provider.getBalance(deployer.address);
  const ethTest = await provider.getBalance(tester.address);
  evidence.reads.finalBalances = {
    deployer: hre.ethers.formatEther(ethDep),
    tester: hre.ethers.formatEther(ethTest),
  };
  console.log(`  Deployer ETH: ${hre.ethers.formatEther(ethDep)}`);
  console.log(`  Tester   ETH: ${hre.ethers.formatEther(ethTest)}`);

  // Write evidence
  const evidencePath = path.join(
    __dirname,
    "..",
    "deployments",
    `${chainId}.evidence.json`,
  );
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence written to ${evidencePath}`);
  console.log(`\n=== SUMMARY: ${evidence.pass.length} pass | ${evidence.fail.length} fail ===`);
  if (evidence.fail.length > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
