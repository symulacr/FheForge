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
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";

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
  const pool = await ethers.getContractAt("LendingPool", ADDRS.pool, deployer);
  const usdc = await ethers.getContractAt("IERC20", USDC, deployer);

  // Pre-checks
  console.log("Vault paused:", await vault.paused());
  console.log("hasPosition:", await vault.hasPosition(deployer.address));
  console.log("USDC balance:", ethers.formatUnits(await usdc.balanceOf(deployer.address), 6));
  console.log("USDC→Composer allowance:", ethers.formatUnits(await usdc.allowance(deployer.address, ADDRS.composer), 6));
  console.log("USDC→Vault allowance:", ethers.formatUnits(await usdc.allowance(deployer.address, ADDRS.vault), 6));
  console.log("USDC→Pool allowance:", ethers.formatUnits(await usdc.allowance(deployer.address, ADDRS.pool), 6));

  // Ensure sufficient Composer allowance for direct transferFrom
  const maxApproval = ethers.parseUnits("1000000", 6);
  let appComp = await usdc.allowance(deployer.address, ADDRS.composer);
  if (appComp < maxApproval) {
    const tx = await usdc.approve(ADDRS.composer, maxApproval);
    await tx.wait();
    console.log("Approved USDC for Composer");
  }

  // Test step-by-step:
  // 1. Supply to Pool (direct, user call)
  const supplyAmt = ethers.parseUnits("1000", 6);
  const [eSupply] = await client.encryptInputs([Encryptable.uint64(BigInt(supplyAmt))]).execute();
  try {
    const tx = await pool.supply(USDC, supplyAmt, eSupply);
    await tx.wait();
    console.log("✓ Pool.supply:", tx.hash);
  } catch (e) { console.log("Pool.supply failed:", String(e).slice(0, 200)); }

  // 2. Open Vault position directly (user call, default setAccount)
  const collAmt = ethers.parseUnits("100", 6);
  let appVault = await usdc.allowance(deployer.address, ADDRS.vault);
  if (appVault < collAmt) {
    const tx = await usdc.approve(ADDRS.vault, collAmt);
    await tx.wait();
    console.log("Approved USDC for Vault");
  }

  const stratCount = await (await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer)).strategyCount();
  const [eColl] = await client.encryptInputs([Encryptable.uint128(BigInt(collAmt))]).execute();
  
  try {
    const tx = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](
      USDC, collAmt, eColl, stratCount, deployer.address
    );
    await tx.wait();
    console.log("✓ Vault.openPosition (direct):", tx.hash);
  } catch (e: unknown) {
    const msg = String(e);
    console.log("✗ Vault.openPosition failed:", msg.slice(0, 300));
    // Try to decode the error
    if (typeof e === "object" && e !== null && "data" in e) {
      const data = (e as {data:string}).data;
      console.log("  Error data:", data.slice(0, 100));
      const iface = new ethers.Interface([
        "error InvalidSigner(address,address)",
        "error ACLNotAllowed()",
        "error PositionAlreadyExists()",
        "error ERC20InsufficientAllowance(address,uint256,uint256)",
        "error ERC20InsufficientBalance(address,uint256,uint256)",
      ]);
      try {
        const decoded = iface.parseError(data);
        console.log("  Decoded:", decoded?.name, decoded?.args?.map(String));
      } catch { console.log("  Could not decode error data"); }
    }
  }

  // 3. If Vault position opened, try Composer flow
  const hasPos = await vault.hasPosition(deployer.address);
  if (hasPos) {
    console.log("\nVault position opened — closing via emergencyWithdraw to test Composer flow");
    const tx = await vault.emergencyWithdraw();
    await tx.wait();
    console.log("Closed:", tx.hash);
  }

  // 4. Composer openLeveragedStrategyDirect with setAccount
  console.log("\n═══ Composer Test with setAccount(composer) ═══");
  const [eCollC, eSupC, eBorC] = await client.encryptInputs([
    Encryptable.uint128(BigInt(collAmt)),
    Encryptable.uint64(BigInt(collAmt)),
    Encryptable.uint64(BigInt(ethers.parseUnits("40", 6))),
  ]).setAccount(ADDRS.composer).execute();

  const params = {
    strategyName: "Leveraged Direct",
    workflowHash: ethers.zeroPadValue("0xd00d", 32),
    collateralAmount: collAmt,
    poolSupplyAmount: collAmt,
    poolBorrowAmount: ethers.parseUnits("40", 6),
    swapDeadlineOffset: 3600,
    strategyId: stratCount,
    swapAmountIn: ethers.parseUnits("40", 6),
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
  const enc = { collateral: eCollC, supplyEnc: eSupC, borrowEnc: eBorC };

  try {
    const tx = await composer.openLeveragedStrategyDirect(params, enc);
    await tx.wait();
    console.log("✓✓✓ Composer.openLeveragedStrategyDirect SUCCESS:", tx.hash);
  } catch (e: unknown) {
    const msg = String(e);
    console.log("✗ Composer failed:", msg.slice(0, 400));
    if (typeof e === "object" && e !== null && "data" in e) {
      const data = (e as {data:string}).data;
      console.log("  Error data:", data.slice(0, 100));
    }
  }
}

main().catch(console.error);
