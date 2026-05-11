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
const WETH = "0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  const composer = await ethers.getContractAt("FheForgeComposer", ADDRS.composer, deployer);
  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer);

  const hasPos = await vault.hasPosition(deployer.address);
  console.log("hasPosition:", hasPos);
  if (hasPos) {
    console.log("Closing vault position via emergencyWithdraw...");
    try {
      const tx = await vault.emergencyWithdraw();
      await tx.wait();
      console.log("✓ Closed:", tx.hash);
    } catch {
      console.log("emergencyWithdraw failed (SameBlockClose?) — trying closePosition");
      const vDep = await vault.getDepositedAmount();
      const [eClose] = await client.encryptInputs([Encryptable.uint128(BigInt(vDep))]).execute();
      try {
        const tx = await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](vDep, eClose);
        await tx.wait();
        console.log("✓ closePosition:", tx.hash);
      } catch (e) { console.log("closePosition also failed:", String(e).slice(0,200)); }
    }
  }

  // Recheck
  const hasPos2 = await vault.hasPosition(deployer.address);
  if (hasPos2) { console.log("ABORT: still has position"); return; }
  console.log("Position cleared — proceeding with Composer test");

  const stratCount = await registry.strategyCount();
  console.log("strategyId:", stratCount.toString());

  // Composer flow with setAccount(composer)
  console.log("\n═══ Composer openLeveragedStrategyDirect + setAccount(composer) ═══");
  const collAmt = ethers.parseUnits("100", 6);
  const borrowAmt = ethers.parseUnits("40", 6);

  const [eColl, eSup, eBor] = await client.encryptInputs([
    Encryptable.uint128(BigInt(collAmt)),
    Encryptable.uint64(BigInt(collAmt)),
    Encryptable.uint64(BigInt(borrowAmt)),
  ]).setAccount(ADDRS.composer).execute();
  console.log("Encrypted with setAccount(composer)");

  const params = {
    strategyName: "Leveraged Direct",
    workflowHash: ethers.zeroPadValue("0xd00d", 32),
    collateralAmount: collAmt,
    poolSupplyAmount: collAmt,
    poolBorrowAmount: borrowAmt,
    swapDeadlineOffset: 3600,
    strategyId: stratCount,
    swapAmountIn: borrowAmt,
    swapMinOut: 0n,
    collateralToken: USDC,
    borrowToken: USDC,
    swapTokenOut: WETH,
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
    const receipt = await tx.wait();
    console.log("✓✓✓ SUCCESS — tx:", tx.hash, "gas:", receipt?.gasUsed?.toString());
  } catch (e: unknown) {
    const msg = String(e);
    console.log("✗ FAILED:", msg.slice(0, 400));
    if (typeof e === "object" && e !== null && "data" in e) {
      console.log("  Error data:", (e as {data:string}).data.slice(0, 100));
    }
  }
}

main().catch(console.error);
