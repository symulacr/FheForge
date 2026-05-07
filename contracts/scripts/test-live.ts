




























import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable, type CofheClient } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import * as fs from "fs";
import * as path from "path";

interface Evidence {
  network: string;
  chainId: number;
  timestamp: string;
  contracts: Record<string, string>;
  pass: { label: string; tx?: string; info?: string }[];
  fail: { label: string; info: string }[];
}

const evidence: Evidence = {
  network: "",
  chainId: 0,
  timestamp: new Date().toISOString(),
  contracts: {},
  pass: [],
  fail: [],
};

function pass(label: string, info?: string, tx?: string) {
  evidence.pass.push({ label, info, tx });
  const txStr = tx ? ` | tx: ${tx.slice(0, 12)}…` : "";
  console.log(`  ✓ ${label}${info ? ": " + info : ""}${txStr}`);
}
function fail(label: string, info: string) {
  evidence.fail.push({ label, info });
  console.log(`  ✗ ${label}: ${info}`);
}

interface DeploymentRecord {
  network: string;
  chainId: number;
  contracts: {
    StrategyRegistry: string;
    StrategyVault: string;
    LendingPool: string;
    SwapRouter: string;
  };
  swapExecutor: string;
}

function loadDeployment(chainId: number): DeploymentRecord {
  const p = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(p)) throw new Error(`No deployment record at ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║      FheForge Live Breaker — Arbitrum Sepolia        ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const provider = ethers.provider;
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const dep = loadDeployment(chainId);
  evidence.network = network.name;
  evidence.chainId = chainId;
  evidence.contracts = { ...dep.contracts };


  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const tester = signers[1] ?? signers[0];
  if (!signers[1]) {
    console.log("⚠ TESTER_PRIVATE_KEY not in hardhat.config accounts; using deployer for tester role");
  }

  console.log(`Network:   ${network.name} (chain ${chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Tester:    ${tester.address}`);
  console.log(`Vault:     ${dep.contracts.StrategyVault}`);
  console.log(`Registry:  ${dep.contracts.StrategyRegistry}`);
  console.log(`Pool:      ${dep.contracts.LendingPool}`);
  console.log(`Router:    ${dep.contracts.SwapRouter}\n`);


  const registry = await ethers.getContractAt(
    "StrategyRegistry",
    dep.contracts.StrategyRegistry,
    tester,
  );
  const vault = await ethers.getContractAt(
    "StrategyVault",
    dep.contracts.StrategyVault,
    tester,
  );
  const pool = await ethers.getContractAt(
    "LendingPool",
    dep.contracts.LendingPool,
    tester,
  );
  const router = await ethers.getContractAt(
    "SwapRouter",
    dep.contracts.SwapRouter,
    tester,
  );

  const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const erc20 = await ethers.getContractAt(
    [
      "function balanceOf(address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
      "function allowance(address,address) view returns (uint256)",
      "function transfer(address,uint256) returns (bool)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
    ],
    USDC,
    tester,
  );


  console.log("── 1. Read-only state ──");
  try {
    const [owner, vAddr, sCount, registryAtVault, executor] = await Promise.all([
      registry.OWNER(),
      registry.vaultAddress(),
      registry.strategyCount(),
      vault.REGISTRY(),
      router.EXECUTOR(),
    ]);
    if (owner.toLowerCase() === deployer.address.toLowerCase())
      pass("Registry.OWNER", owner);
    else fail("Registry.OWNER", `expected ${deployer.address}, got ${owner}`);
    if (vAddr.toLowerCase() === dep.contracts.StrategyVault.toLowerCase())
      pass("Registry.vaultAddress", vAddr);
    else
      fail(
        "Registry.vaultAddress",
        `expected ${dep.contracts.StrategyVault}, got ${vAddr}`,
      );
    pass("Registry.strategyCount", sCount.toString());
    if (registryAtVault.toLowerCase() === dep.contracts.StrategyRegistry.toLowerCase())
      pass("Vault.REGISTRY", registryAtVault);
    else
      fail(
        "Vault.REGISTRY",
        `expected ${dep.contracts.StrategyRegistry}, got ${registryAtVault}`,
      );
    if (executor.toLowerCase() === dep.swapExecutor.toLowerCase())
      pass("Router.EXECUTOR", executor);
    else
      fail("Router.EXECUTOR", `expected ${dep.swapExecutor}, got ${executor}`);
  } catch (e: unknown) {
    fail("Read-only state", (e as Error).message);
  }


  console.log("\n── 2. Registry.registerStrategy (tester) ──");
  let strategyId: bigint;
  try {
    const tx = await registry.registerStrategy(
      "FheForge live-breaker strategy",
      ethers.zeroPadValue("0xdeadbeef", 32),
    );
    const rcpt = await tx.wait();
    strategyId = await registry.strategyCount();
    pass(
      "Registry.registerStrategy",
      `id=${strategyId} block=${rcpt!.blockNumber}`,
      tx.hash,
    );
    const meta = await registry.getStrategyMeta(strategyId);
    if (meta[0] !== "FheForge live-breaker strategy")
      fail("Registry.getStrategyMeta", `name mismatch: ${meta[0]}`);
    else if (meta[2].toLowerCase() !== tester.address.toLowerCase())
      fail("Registry.getStrategyMeta.creator", `expected ${tester.address}`);
    else if (!meta[4]) fail("Registry.getStrategyMeta.active", "expected true");
    else
      pass(
        "Registry.getStrategyMeta",
        `name="${meta[0]}" creator=${meta[2]} active=${meta[4]}`,
      );
  } catch (e: unknown) {
    fail("Registry.registerStrategy", (e as Error).message);
    return;
  }


  console.log("\n── 3. Registry revert paths ──");


  function decodeRegistryError(e: unknown): string {
    const err = e as { data?: string; message?: string };
    if (err.data && typeof err.data === "string") {
      try {
        const parsed = registry.interface.parseError(err.data);
        if (parsed) return parsed.name;
      } catch {

      }
    }
    return err.message ?? String(e);
  }

  try {
    await (
      registry.connect(deployer) as typeof registry
    ).setVault.staticCall(ethers.ZeroAddress);
    fail("Registry.setVault(0)", "expected revert ZeroAddress");
  } catch (e: unknown) {
    const msg = decodeRegistryError(e);
    if (msg.includes("ZeroAddress"))
      pass("Registry.setVault(0) reverts ZeroAddress");
    else if (msg.includes("VaultAlreadySet"))
      pass("Registry.setVault reverts VaultAlreadySet");
    else fail("Registry.setVault(0)", msg);
  }
  try {
    await registry.setVault.staticCall(deployer.address);
    fail("Registry.setVault(non-owner)", "expected revert OnlyOwner");
  } catch (e: unknown) {
    const msg = decodeRegistryError(e);
    if (msg.includes("OnlyOwner")) pass("Registry.setVault reverts OnlyOwner");
    else if (msg.includes("VaultAlreadySet"))
      pass("Registry.setVault reverts VaultAlreadySet (already set)");
    else fail("Registry.setVault non-owner", msg);
  }
  try {


    await registry.incrementTvl.staticCall(strategyId, ethers.ZeroHash);
    fail("Registry.incrementTvl(non-vault)", "expected revert OnlyVault");
  } catch (e: unknown) {
    const msg = decodeRegistryError(e);
    if (msg.includes("OnlyVault"))
      pass("Registry.incrementTvl reverts OnlyVault");
    else fail("Registry.incrementTvl non-vault", msg);
  }
  try {
    await registry.decrementTvl.staticCall(strategyId, ethers.ZeroHash);
    fail("Registry.decrementTvl(non-vault)", "expected revert OnlyVault");
  } catch (e: unknown) {
    const msg = decodeRegistryError(e);
    if (msg.includes("OnlyVault"))
      pass("Registry.decrementTvl reverts OnlyVault");
    else fail("Registry.decrementTvl non-vault", msg);
  }


  console.log("\n── 4. CoFHE client (tester signer, testnet) ──");
  let cofheClient: CofheClient | null = null;
  try {
    const config = createCofheConfig({
      environment: "node",
      supportedChains: [arbSepolia],
    });
    cofheClient = createCofheClient(config);
    if (!cofheClient) fail("CoFHE.createCofheClient", "client is null");
    const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(tester);
    await cofheClient.connect(publicClient, walletClient);
    await cofheClient.permits.createSelf({ issuer: tester.address });
    pass(
      "CoFHE.createCofheClient + connect + permit",
      "tester self-permit issued",
    );
  } catch (e: unknown) {
    fail("CoFHE.createCofheClient", (e as Error).message);
  }
  if (!cofheClient) {
    console.log("\n⚠ Skipping FHE-dependent sections; CoFHE client unavailable");
    writeReport();
    return;
  }


  console.log("\n── 5. Vault.openPosition (tester USDC) ──");
  const collateral = 5_000_000n;
  const apy = 650n;
  const loop = 2n;
  try {
    const usdcBal = await erc20.balanceOf(tester.address);
    if (usdcBal < collateral)
      throw new Error(
        `tester USDC balance ${usdcBal} insufficient for ${collateral}`,
      );
    const allowance = await erc20.allowance(tester.address, dep.contracts.StrategyVault);
    if (allowance < collateral) {
      const tx = await erc20.approve(dep.contracts.StrategyVault, ethers.MaxUint256);
      await tx.wait();
      pass("USDC.approve(vault, MAX)", "fresh approval", tx.hash);
    } else {
      pass("USDC.allowance(tester→vault)", `${allowance}`);
    }
    const hp = await vault.hasPosition(tester.address);
    if (hp) {
      console.log("    (position already exists; closing first)");
      const dep0 = await vault.getDepositedAmount();
      const tx0 = await vault.closePosition(dep0);
      await tx0.wait();
      pass("Vault.closePosition (cleanup)", `withdrew ${dep0}`, tx0.hash);
    }



    const enc = await cofheClient
      .encryptInputs([
        Encryptable.uint64(collateral),
      ])
      .execute();
    pass("CoFHE.encryptInputs", `1 ciphertext produced`);

    const tx = await vault.openPosition(
      USDC,
      collateral,
      enc[0],
      strategyId,
      tester.address,
    );
    const rcpt = await tx.wait();
    pass(
      "Vault.openPosition",
      `block=${rcpt!.blockNumber} gas=${rcpt!.gasUsed}`,
      tx.hash,
    );

    const [hpAfter, depAfter, meta] = await Promise.all([
      vault.hasPosition(tester.address),
      vault.getDepositedAmount(),
      vault.getPositionMeta(),
    ]);
    if (!hpAfter) fail("Vault.hasPosition(tester)", "expected true after open");
    else pass("Vault.hasPosition(tester)", "true");
    if (depAfter !== collateral)
      fail("Vault.getDepositedAmount", `expected ${collateral} got ${depAfter}`);
    else pass("Vault.getDepositedAmount", `${depAfter}`);
    if (meta[0] !== strategyId)
      fail("Vault.getPositionMeta.strategyId", `expected ${strategyId} got ${meta[0]}`);
    else pass("Vault.getPositionMeta", `strategyId=${meta[0]} createdAt=${meta[1]}`);
  } catch (e: unknown) {
    fail("Vault.openPosition", (e as Error).message);
  }


  console.log("\n── 6. Vault revert paths ──");
  function decodeVaultError(e: unknown): string {
    const err = e as { data?: string; message?: string };
    if (err.data && typeof err.data === "string") {
      try {
        const parsed = vault.interface.parseError(err.data);
        if (parsed) return parsed.name;
      } catch {

      }
    }
    return err.message ?? String(e);
  }

  try {
    const dummy = await cofheClient
      .encryptInputs([
        Encryptable.uint64(1n),
      ])
      .execute();
    await vault.openPosition.staticCall(
      USDC,
      1_000_000n,
      dummy[0],
      1n,
      tester.address,
    );
    fail(
      "Vault.openPosition (already-exists)",
      "expected revert PositionAlreadyExists",
    );
  } catch (e: unknown) {
    const msg = decodeVaultError(e);
    if (msg.includes("PositionAlreadyExists"))
      pass("Vault.openPosition reverts PositionAlreadyExists");
    else fail("Vault.openPosition (already-exists)", msg);
  }
  try {
    await vault.closePosition.staticCall(0);
    fail("Vault.closePosition(0)", "expected revert ZeroAmount");
  } catch (e: unknown) {
    const msg = decodeVaultError(e);
    if (msg.includes("ZeroAmount") || msg.includes("NoPosition"))
      pass(`Vault.closePosition(0) reverts ${msg}`);
    else fail("Vault.closePosition(0)", msg);
  }


  console.log("\n── 7. Vault.addCollateral ──");
  const addAmount = 2_000_000n;
  try {
    const enc = await cofheClient
      .encryptInputs([Encryptable.uint64(addAmount)])
      .execute();
    const tx = await vault.addCollateral(USDC, addAmount, enc[0], tester.address);
    const rcpt = await tx.wait();
    pass(
      "Vault.addCollateral",
      `+${addAmount} block=${rcpt!.blockNumber}`,
      tx.hash,
    );
    const dAfter = await vault.getDepositedAmount();
    if (dAfter !== collateral + addAmount)
      fail(
        "Vault.getDepositedAmount after addCollateral",
        `expected ${collateral + addAmount} got ${dAfter}`,
      );
    else pass("Vault.getDepositedAmount after addCollateral", `${dAfter}`);
  } catch (e: unknown) {
    fail("Vault.addCollateral", (e as Error).message);
  }


  console.log("\n── 8. Vault.getCollateral ──");
  try {
    const ctHash = await vault.getCollateral.staticCall();
    pass("Vault.getCollateral.staticCall", `ctHash=${ctHash.toString().slice(0, 24)}…`);
  } catch (e: unknown) {
    fail("Vault.getCollateral.staticCall", (e as Error).message);
  }


  console.log("\n── 9. Vault.closePosition ──");
  try {
    const total = collateral + addAmount;
    const tx = await vault.closePosition(total);
    const rcpt = await tx.wait();
    pass(
      "Vault.closePosition",
      `withdrew ${total} block=${rcpt!.blockNumber}`,
      tx.hash,
    );
    const [hp, dep0] = await Promise.all([
      vault.hasPosition(tester.address),
      vault.getDepositedAmount(),
    ]);
    if (hp) fail("Vault.hasPosition (after close)", "expected false");
    else pass("Vault.hasPosition (after close)", "false");
    if (dep0 !== 0n)
      fail("Vault.getDepositedAmount (after close)", `expected 0 got ${dep0}`);
    else pass("Vault.getDepositedAmount (after close)", "0");
  } catch (e: unknown) {
    fail("Vault.closePosition", (e as Error).message);
  }


  console.log("\n── 10. LendingPool.supply ──");
  const supplyAmount = 5_000_000n;
  try {
    const allowance = await erc20.allowance(tester.address, dep.contracts.LendingPool);
    if (allowance < supplyAmount) {
      const tx = await erc20.approve(dep.contracts.LendingPool, ethers.MaxUint256);
      await tx.wait();
      pass("USDC.approve(pool, MAX)", "fresh approval", tx.hash);
    }
    const enc = await cofheClient
      .encryptInputs([Encryptable.uint64(supplyAmount)])
      .execute();
    const tx = await pool.supplyToLending(USDC, supplyAmount, enc[0], tester.address);
    const rcpt = await tx.wait();
    pass(
      "Pool.supplyToLending",
      `${supplyAmount} block=${rcpt!.blockNumber}`,
      tx.hash,
    );
    const plain = await pool.getPlainSupplyBalance(USDC);
    if (plain < supplyAmount)
      fail("Pool.getPlainSupplyBalance", `expected >= ${supplyAmount} got ${plain}`);
    else pass("Pool.getPlainSupplyBalance", `${plain}`);
    const ctSupply = await pool.getSupplyBalance.staticCall(USDC);
    pass(
      "Pool.getSupplyBalance.staticCall",
      `ctHash=${ctSupply.toString().slice(0, 24)}…`,
    );
  } catch (e: unknown) {
    fail("Pool.supplyToLending", (e as Error).message);
  }


  console.log("\n── 11. LendingPool.borrowFromLending ──");
  const borrowAmount = 1_000_000n;
  try {
    const enc = await cofheClient
      .encryptInputs([Encryptable.uint64(borrowAmount)])
      .execute();
    const tx = await pool.borrowFromLending(
      USDC,
      borrowAmount,
      enc[0],
      tester.address,
    );
    const rcpt = await tx.wait();
    pass(
      "Pool.borrowFromLending",
      `${borrowAmount} block=${rcpt!.blockNumber}`,
      tx.hash,
    );
    const plain = await pool.getPlainBorrowBalance(USDC);
    if (plain < borrowAmount)
      fail("Pool.getPlainBorrowBalance", `expected >= ${borrowAmount} got ${plain}`);
    else pass("Pool.getPlainBorrowBalance", `${plain}`);
    const ctBorrow = await pool.getBorrowBalance.staticCall(USDC);
    pass(
      "Pool.getBorrowBalance.staticCall",
      `ctHash=${ctBorrow.toString().slice(0, 24)}…`,
    );
  } catch (e: unknown) {
    fail("Pool.borrowFromLending", (e as Error).message);
  }


  console.log("\n── 12. LendingPool.repay ──");
  try {
    const enc = await cofheClient
      .encryptInputs([Encryptable.uint64(borrowAmount)])
      .execute();
    const tx = await pool.repay(USDC, borrowAmount, enc[0]);
    const rcpt = await tx.wait();
    pass("Pool.repay", `${borrowAmount} block=${rcpt!.blockNumber}`, tx.hash);
    const plain = await pool.getPlainBorrowBalance(USDC);
    if (plain !== 0n)
      fail("Pool.getPlainBorrowBalance after repay", `expected 0 got ${plain}`);
    else pass("Pool.getPlainBorrowBalance after repay", "0");
  } catch (e: unknown) {
    fail("Pool.repay", (e as Error).message);
  }


  console.log("\n── 13. LendingPool.withdraw ──");
  try {
    const enc = await cofheClient
      .encryptInputs([Encryptable.uint64(supplyAmount)])
      .execute();
    const tx = await pool.withdraw(USDC, supplyAmount, enc[0]);
    const rcpt = await tx.wait();
    pass(
      "Pool.withdraw",
      `${supplyAmount} block=${rcpt!.blockNumber}`,
      tx.hash,
    );
    const plain = await pool.getPlainSupplyBalance(USDC);
    if (plain !== 0n)
      fail("Pool.getPlainSupplyBalance after withdraw", `expected 0 got ${plain}`);
    else pass("Pool.getPlainSupplyBalance after withdraw", "0");
  } catch (e: unknown) {
    fail("Pool.withdraw", (e as Error).message);
  }


  console.log("\n── 14. SwapRouter (tester submits, tester cancels) ──");
  try {
    const amountIn = 1_000_000n;
    const minOut = 990_000n;

    const tx = await router.submitSwapIntent(
      USDC,
      "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
      amountIn,
      minOut,
      3600n,
    );
    const rcpt = await tx.wait();
    let intentId: string | null = null;
    if (rcpt && rcpt.logs) {
      for (const log of rcpt.logs) {
        try {
          const parsed = router.interface.parseLog(log);
          if (parsed && parsed.name === "IntentSubmitted") {
            intentId = parsed.args[0];
            break;
          }
        } catch {

        }
      }
    }
    if (!intentId) throw new Error("IntentSubmitted event not found");
    pass(
      "Router.submitSwapIntent",
      `intentId=${intentId.slice(0, 12)}…`,
      tx.hash,
    );

    const meta = await router.getIntentMeta(intentId);
    if (meta[0].toLowerCase() !== USDC.toLowerCase())
      fail("Router.getIntentMeta.tokenIn", `expected ${USDC} got ${meta[0]}`);
    else pass("Router.getIntentMeta", `tokenIn=${meta[0]} user=${meta[2]}`);

    const ctIn = await router.getAmountIn.staticCall(intentId);
    pass(
      "Router.getAmountIn.staticCall",
      `ctHash=${ctIn.toString().slice(0, 24)}…`,
    );

    const cancelTx = await router.cancelIntent(intentId);
    await cancelTx.wait();
    pass("Router.cancelIntent", `cancelled`, cancelTx.hash);


    const metaAfter = await router.getIntentMeta(intentId);
    if (metaAfter[2] !== ethers.ZeroAddress)
      fail("Router.getIntentMeta after cancel", `expected zero address user`);
    else pass("Router.getIntentMeta after cancel", "user=0x0 (cleared)");
  } catch (e: unknown) {
    fail("Router intent flow", (e as Error).message);
  }


  console.log("\n── 15. SwapRouter revert paths ──");
  function decodeRouterError(e: unknown): string {
    const err = e as { data?: string; message?: string };
    if (err.data && typeof err.data === "string") {
      try {
        const parsed = router.interface.parseError(err.data);
        if (parsed) return parsed.name;
      } catch {

      }
    }
    return err.message ?? String(e);
  }

  try {
    await router.executeIntent.staticCall(ethers.ZeroHash, 1);
    fail("Router.executeIntent(non-executor)", "expected revert NotExecutor");
  } catch (e: unknown) {
    const msg = decodeRouterError(e);
    if (msg.includes("NotExecutor"))
      pass("Router.executeIntent reverts NotExecutor (tester is not executor)");
    else fail("Router.executeIntent non-executor", msg);
  }
  try {
    await router.cancelIntent.staticCall(ethers.ZeroHash);
    fail("Router.cancelIntent(unknown)", "expected revert NotCreator");
  } catch (e: unknown) {
    const msg = decodeRouterError(e);
    if (msg.includes("NotCreator"))
      pass("Router.cancelIntent(unknown) reverts NotCreator");
    else fail("Router.cancelIntent unknown", msg);
  }
  try {
    await router.submitSwapIntent.staticCall(
      USDC,
      USDC,
      1n,
      1n,
      3600n,
    );
    fail("Router.submitSwapIntent(same token)", "expected revert SameToken");
  } catch (e: unknown) {
    const msg = decodeRouterError(e);
    if (msg.includes("SameToken"))
      pass("Router.submitSwapIntent reverts SameToken");
    else fail("Router.submitSwapIntent same-token", msg);
  }

  writeReport();
}

function writeReport() {
  const out = path.join(
    __dirname,
    "..",
    "deployments",
    `${evidence.chainId}.breaker-evidence.json`,
  );
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║                   FINAL REPORT                       ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(
    `\n  PASS: ${evidence.pass.length}  FAIL: ${evidence.fail.length}\n`,
  );
  if (evidence.fail.length > 0) {
    console.log("FAILURES:");
    for (const f of evidence.fail) console.log(`  ✗ ${f.label}: ${f.info}`);
  }
  console.log(`\n  Evidence: ${out}`);
  if (evidence.fail.length > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
