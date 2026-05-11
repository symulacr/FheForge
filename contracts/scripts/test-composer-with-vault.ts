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
  oracle:   "0xD0f0072ae4308be044bd5722059ACCf2CF543130",
};
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const [deployer] = await ethers.getSigners();
  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  const composer = await ethers.getContractAt("FheForgeComposer", ADDRS.composer, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer);
  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);

  // First close any existing position
  try {
    const pos = await vault.positions(deployer.address);
    if (pos.strategyId > 0n) {
      console.log("Closing existing vault position...");
      const [eClose] = await client.encryptInputs([Encryptable.uint128(0n)]).execute();
      await (await vault.closePosition(eClose)).wait();
      console.log("Position closed");
    }
  } catch { /* no position */ }

  // Test: Full Composer flow WITH vault (non-zero collateral) but NO swap
  console.log("\n═══ Composer with collateral + supply + borrow (no swap) ═══");
  const collAmt = ethers.parseUnits("100", 6);
  const supplyAmt = ethers.parseUnits("50", 6);
  const borrowAmt = ethers.parseUnits("20", 6);

  const [eColl, eSup, eBor] = await client.encryptInputs([
    Encryptable.uint128(BigInt(collAmt)),
    Encryptable.uint64(BigInt(supplyAmt)),
    Encryptable.uint64(BigInt(borrowAmt)),
  ]).setAccount(ADDRS.composer).execute();

  const stratCount = await registry.strategyCount();

  const params = {
    strategyName: "VaultNoSwap",
    workflowHash: ethers.zeroPadValue("0xd00d", 32),
    collateralAmount: collAmt,
    poolSupplyAmount: supplyAmt,
    poolBorrowAmount: borrowAmt,
    swapDeadlineOffset: 3600,
    strategyId: stratCount,
    swapAmountIn: 0n,
    swapMinOut: 0n,
    collateralToken: USDC,
    borrowToken: USDC,
    swapTokenOut: ethers.ZeroAddress,  // NO SWAP
    ltvNum: 80,
    ltvDen: 100,
    useOracleBorrow: true,
    apyTarget: 500,
    loopCount: 1,
    collateralPermit: { amount: 0n, deadline: 0, nonce: 0, signature: "0x" },
  };
  const enc = { collateral: eColl, supplyEnc: eSup, borrowEnc: eBor };

  try {
    const tx = await composer.openLeveragedStrategyDirect(params, enc);
    const rc = await tx.wait();
    console.log("✓✓✓ SUCCESS with vault:", tx.hash);
  } catch (e: unknown) {
    const err = e as { data?: string; info?: { error?: { data?: string } }; message?: string };
    const data = err?.data || err?.info?.error?.data;
    console.log("✗ Error data:", data?.slice(0, 200));
    console.log("✗ Message:", String(err?.message || err).slice(0, 500));
  }
}

main().catch(console.error);
