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
  console.log("Deployer:", deployer.address);

  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  const composer = await ethers.getContractAt("FheForgeComposer", ADDRS.composer, deployer);
  const pool = await ethers.getContractAt("LendingPool", ADDRS.pool, deployer);

  // Step 1: Supply to Pool (direct, as user)
  const supplyAmt = ethers.parseUnits("1000", 6);
  const [eSup] = await client.encryptInputs([Encryptable.uint64(BigInt(supplyAmt))]).execute();
  try { await (await pool.supply(USDC, supplyAmt, eSup)).wait(); console.log("✓ Pool.supply:", supplyAmt.toString()); } catch { console.log("Pool.supply failed"); }

  // Step 2: Test ONLY Pool.supplyToLending via Composer (setAccount=composer)
  console.log("\n── Test: Composer→Pool.supplyToLending with setAccount(composer) ──");
  const supplyViaComposer = ethers.parseUnits("100", 6);
  const [eSupComp] = await client.encryptInputs([Encryptable.uint64(BigInt(supplyViaComposer))])
    .setAccount(ADDRS.composer).execute();
  
  // Composer must approve Pool for USDC
  const usdc = await ethers.getContractAt("IERC20", USDC, deployer);
  // First, user transfers USDC to Composer
  await (await usdc.transfer(ADDRS.composer, supplyViaComposer)).wait();
  console.log("Transferred USDC to Composer");
  
  // Now Composer calls Pool.supplyToLending
  // But we can't call Composer directly to do this — Composer doesn't have a raw "supplyToPool" function.
  // Instead, let's test by having deployer (as Composer owner) do a low-level call
  
  // Actually, let's just test the full openLeveragedStrategyDirect flow
  // but with collateralAmount=0 (no vault, just pool supply + borrow)
  console.log("\n── Test: openLeveragedStrategyDirect with collateral=0 ──");
  
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer);
  const stratCount = await registry.strategyCount();
  
  const borrowAmt = ethers.parseUnits("40", 6);
  // For collateral=0: no vault open, just pool supply+borrow
  const [eSup2, eBor] = await client.encryptInputs([
    Encryptable.uint64(BigInt(supplyViaComposer)),
    Encryptable.uint64(BigInt(borrowAmt)),
  ]).setAccount(ADDRS.composer).execute();
  
  // No collateral encryption needed when collateralAmount=0
  // But the struct still needs it — use a dummy
  const [eDummyColl] = await client.encryptInputs([Encryptable.uint128(0n)]).setAccount(ADDRS.composer).execute();
  
  const params = {
    strategyName: "NoCollateral",
    workflowHash: ethers.zeroPadValue("0xd00d", 32),
    collateralAmount: 0n,  // NO vault position
    poolSupplyAmount: supplyViaComposer,
    poolBorrowAmount: borrowAmt,
    swapDeadlineOffset: 3600,
    strategyId: stratCount,
    swapAmountIn: borrowAmt,
    swapMinOut: 0n,
    collateralToken: USDC,
    borrowToken: USDC,
    swapTokenOut: USDC,  // same token, no actual swap
    ltvNum: 80,
    ltvDen: 100,
    useOracleBorrow: true,
    apyTarget: 500,
    loopCount: 1,
    collateralPermit: { amount: 0n, deadline: 0, nonce: 0, signature: "0x" },
  };
  const enc = { collateral: eDummyColl, supplyEnc: eSup2, borrowEnc: eBor };
  
  try {
    const tx = await composer.openLeveragedStrategyDirect(params, enc);
    await tx.wait();
    console.log("✓✓✓ SUCCESS:", tx.hash);
  } catch (e: unknown) {
    const msg = String(e);
    let reason = "unknown";
    if (typeof e === "object" && e !== null && "data" in e) {
      const data = (e as {data:string}).data;
      console.log("Error data:", data?.slice(0, 100));
      // Try all contract error selectors
      const allErrors = [
        "InvalidSigner(address,address)", "ACLNotAllowed()", "NotComposer()",
        "ERC20InsufficientBalance(address,uint256,uint256)",
        "ERC20InsufficientAllowance(address,uint256,uint256)",
        "InsufficientReserve()", "Euint64Overflow()", "ZeroAmount()",
        "PositionAlreadyExists()", "SameBlockClose()", "InvalidStrategyId()",
        "ZeroAddress()", "TokenMismatch()", "NoPosition()", "ExceedsDeposit()",
        "OnlyOwner()", "PriceTooOld(uint256)", "InvalidLTV(uint128,uint128)",
      ];
      for (const err of allErrors) {
        if (ethers.id(err).slice(0,10) === data?.slice(0,10)) {
          reason = err;
          break;
        }
      }
    }
    console.log("✗ FAILED:", reason, "—", msg.slice(0, 200));
  }
}

main().catch(console.error);
