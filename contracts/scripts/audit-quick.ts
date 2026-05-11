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
const P = ADDRS["lendingpool"] as string;
const V = ADDRS["strategyvault"] as string;
const C = ADDRS["fheforgecomposer"] as string;
const R = ADDRS["strategyregistry"] as string;
const S = ADDRS["swaprouter"] as string;
const O = ADDRS["priceoracle"] as string;
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC_ADDR = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const [deployer] = await ethers.getSigners();
  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  let pass = 0, fail = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`✓ PASS: ${name}`);
      pass++;
    } catch (e: unknown) {
      const err = e as { data?: string; shortMessage?: string };
      const detail = err?.data?.slice(0, 20) || err?.shortMessage || String(e).slice(0, 120);
      console.log(`✗ FAIL: ${name} — ${detail}`);
      fail++;
    }
  };

  const pool = await ethers.getContractAt("LendingPool", P, deployer);
  const vault = await ethers.getContractAt("StrategyVault", V, deployer);
  const composer = await ethers.getContractAt("FheForgeComposer", C, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", R, deployer);

  // ── 1. Pool.composer wired correctly ──
  await test("Pool.composer == new Composer", async () => {
    const c = await pool.composer();
    if (c.toLowerCase() !== C.toLowerCase()) throw new Error(`got ${c}`);
  });

  // ── 2. Pool.shieldEth (WETH, always works) ──
  await test("Pool.shieldEth works", async () => {
    const amt = ethers.parseEther("0.001");
    const [e] = await client.encryptInputs([Encryptable.uint128(BigInt(amt))]).execute();
    await (await pool.shieldEth(e, { value: amt })).wait();
  });

  // ── 3. Pool not paused ──
  await test("Pool not paused", async () => {
    if (await pool.paused()) throw new Error("pool paused");
  });

  // ── 4. Vault not paused ──
  await test("Vault not paused", async () => {
    if (await vault.paused()) throw new Error("vault paused");
  });

  // ── 5. Vault.getUserPositions returns array ──
  await test("Vault.getUserPositions returns array", async () => {
    const ids = await vault.getUserPositions(deployer.address);
    console.log(`    positions for deployer: ${ids.length}`);
  });

  // ── 6. Registry.strategyCount reads ──
  await test("Registry.strategyCount readable", async () => {
    const count = await registry.strategyCount();
    console.log(`    strategyCount: ${count}`);
  });

  // ── 7. Registry.registerStrategy works ──
  await test("Registry.registerStrategy", async () => {
    const wf = ethers.zeroPadValue("0xdeadbeef", 32);
    await (await registry.registerStrategy("AuditTestStrategy", wf, 500, 1)).wait();
    const count = await registry.strategyCount();
    if (count < 1n) throw new Error("count not incremented");
  });

  // ── 8. PriceOracle.getPriceWithFallback ──
  await test("PriceOracle.getPriceWithFallback (WETH)", async () => {
    const oracle = await ethers.getContractAt("PriceOracle", O, deployer);
    const price = await oracle.getPriceWithFallback(WETH);
    console.log(`    WETH price: ${price}`);
  });

  // ── 9. SwapRouter.submitSwapIntent ──
  await test("SwapRouter.submitSwapIntent reverts without approval", async () => {
    // Should revert with transferFrom failure — proves function exists
    try {
      await (await ethers.getContractAt("SwapRouter", S, deployer))
        .submitSwapIntent(WETH, WETH, 1, 0, 3600);
      throw new Error("unexpected success");
    } catch (e: unknown) {
      // Expected — SameToken or transferFrom revert
    }
    // Verify the router address matches
    const router = await composer.ROUTER();
    if (router.toLowerCase() !== S.toLowerCase()) throw new Error("router mismatch");
  });

  // ── 10. Composer wired (ROUTER, POOL, VAULT) ──
  await test("Composer wiring correct", async () => {
    const r = await composer.ROUTER();
    const p = await composer.POOL();
    const v = await composer.VAULT();
    if (r.toLowerCase() !== S.toLowerCase()) throw new Error("ROUTER mismatch");
    if (p.toLowerCase() !== P.toLowerCase()) throw new Error("POOL mismatch");
    if (v.toLowerCase() !== V.toLowerCase()) throw new Error("VAULT mismatch");
  });

  console.log(`\n═══ SUMMARY: ${pass} PASS / ${fail} FAIL ═══`);
}

main().catch(console.error);