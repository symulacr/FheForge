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
      const detail = err?.data?.slice(0, 20) || err?.shortMessage || String(e).slice(0, 100);
      console.log(`✗ FAIL: ${name} — ${detail}`);
      fail++;
    }
  };

  const pool = await ethers.getContractAt("LendingPool", ADDRS.pool, deployer);
  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);
  const composer = await ethers.getContractAt("FheForgeComposer", ADDRS.composer, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer);

  // Helper: close vault position if exists
  const closeVaultIfOpen = async () => {
    const hasPos = await vault.hasPosition(deployer.address);
    if (hasPos) {
      const deposited = await vault.getDepositedAmount();
      const [eClose] = await client.encryptInputs([Encryptable.uint128(BigInt(deposited))]).execute();
      await (await vault.closePosition(deposited, eClose)).wait();
    }
  };

  // 1. Pool composer address
  await test("Pool.composer == new Composer", async () => {
    const c = await pool.composer();
    if (c.toLowerCase() !== ADDRS.composer.toLowerCase()) throw new Error(`got ${c}`);
  });

  // 2. Pool direct supply
  await test("Pool.supply (user direct)", async () => {
    const amt = ethers.parseUnits("50", 6);
    const [e] = await client.encryptInputs([Encryptable.uint64(BigInt(amt))]).execute();
    await (await pool.supply(USDC, amt, e)).wait();
  });

  // 3. Vault direct openPosition
  await test("Vault.openPosition (user direct)", async () => {
    await closeVaultIfOpen();
    const amt = ethers.parseUnits("50", 6);
    const [eColl] = await client.encryptInputs([Encryptable.uint128(BigInt(amt))]).execute();
    const sid = await registry.strategyCount();
    const iface = new ethers.Interface([
      "function openPosition(address, uint256, (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature), uint256, address)",
    ]);
    const data = iface.encodeFunctionData("openPosition", [USDC, amt, eColl, sid, deployer.address]);
    await (await deployer.sendTransaction({ to: ADDRS.vault, data })).wait();
  });

  // 4. Vault closePosition
  await test("Vault.closePosition", async () => {
    const deposited = await vault.getDepositedAmount();
    const [eClose] = await client.encryptInputs([Encryptable.uint128(BigInt(deposited))]).execute();
    await (await vault.closePosition(deposited, eClose)).wait();
  });

  // 5. Composer with collateral=0, no swap
  await test("Composer.openLeveragedStrategyDirect (no vault, no swap)", async () => {
    const supplyAmt = ethers.parseUnits("50", 6);
    const borrowAmt = ethers.parseUnits("20", 6);
    const [eColl, eSup, eBor] = await client.encryptInputs([
      Encryptable.uint128(0n),
      Encryptable.uint64(BigInt(supplyAmt)),
      Encryptable.uint64(BigInt(borrowAmt)),
    ]).setAccount(ADDRS.composer).execute();
    const sid = await registry.strategyCount();
    const params = {
      strategyName: "E2ETest", workflowHash: ethers.zeroPadValue("0xd00d", 32),
      collateralAmount: 0n, poolSupplyAmount: supplyAmt, poolBorrowAmount: borrowAmt,
      swapDeadlineOffset: 3600, strategyId: sid, swapAmountIn: 0n, swapMinOut: 0n,
      collateralToken: USDC, borrowToken: USDC, swapTokenOut: ethers.ZeroAddress,
      ltvNum: 80, ltvDen: 100, useOracleBorrow: true, apyTarget: 500, loopCount: 1,
      collateralPermit: { amount: 0n, deadline: 0, nonce: 0, signature: "0x" },
    };
    await (await composer.openLeveragedStrategyDirect(params, { collateral: eColl, supplyEnc: eSup, borrowEnc: eBor })).wait();
  });

  // 6. Composer with vault, no swap
  await test("Composer.openLeveragedStrategyDirect (with vault, no swap)", async () => {
    await closeVaultIfOpen();
    const collAmt = ethers.parseUnits("30", 6);
    const supplyAmt = ethers.parseUnits("20", 6);
    const borrowAmt = ethers.parseUnits("10", 6);
    const [eColl, eSup, eBor] = await client.encryptInputs([
      Encryptable.uint128(BigInt(collAmt)),
      Encryptable.uint64(BigInt(supplyAmt)),
      Encryptable.uint64(BigInt(borrowAmt)),
    ]).setAccount(ADDRS.composer).execute();
    const sid = await registry.strategyCount();
    const params = {
      strategyName: "VaultE2E", workflowHash: ethers.zeroPadValue("0xd00d", 32),
      collateralAmount: collAmt, poolSupplyAmount: supplyAmt, poolBorrowAmount: borrowAmt,
      swapDeadlineOffset: 3600, strategyId: sid, swapAmountIn: 0n, swapMinOut: 0n,
      collateralToken: USDC, borrowToken: USDC, swapTokenOut: ethers.ZeroAddress,
      ltvNum: 80, ltvDen: 100, useOracleBorrow: true, apyTarget: 500, loopCount: 1,
      collateralPermit: { amount: 0n, deadline: 0, nonce: 0, signature: "0x" },
    };
    await (await composer.openLeveragedStrategyDirect(params, { collateral: eColl, supplyEnc: eSup, borrowEnc: eBor })).wait();
  });

  // 7-9. Simple checks
  await test("Registry.strategyCount > 0", async () => {
    if ((await registry.strategyCount()) === 0n) throw new Error("No strategies");
  });
  await test("Pool not paused", async () => { if (await pool.paused()) throw new Error("paused"); });
  await test("Vault not paused", async () => { if (await vault.paused()) throw new Error("paused"); });

  console.log(`\n═══ SUMMARY: ${pass} PASS / ${fail} FAIL ═══`);
}

main().catch(console.error);
