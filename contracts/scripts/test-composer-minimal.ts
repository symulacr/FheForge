import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";

const POOL = "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb";
const COMPOSER = "0xeF1EdEcB5Df34C732561685F5Efa788947Dd68b8";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

async function main() {
  const [deployer] = await ethers.getSigners();
  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  // Test: Composer flow with collateral=0, no swap
  console.log("Minimal Composer test (collateral=0, no swap)...");
  const supplyAmt = ethers.parseUnits("100", 6);
  const borrowAmt = ethers.parseUnits("40", 6);

  const [eColl, eSup, eBor] = await client.encryptInputs([
    Encryptable.uint128(0n),
    Encryptable.uint64(BigInt(supplyAmt)),
    Encryptable.uint64(BigInt(borrowAmt)),
  ]).setAccount(COMPOSER).execute();

  const registry = await ethers.getContractAt("StrategyRegistry", "0x59d955dA6a678D140ce8379ae7175850B7481E76", deployer);
  const stratCount = await registry.strategyCount();
  const composer = await ethers.getContractAt("FheForgeComposer", COMPOSER, deployer);

  const params = {
    strategyName: "MinTest",
    workflowHash: ethers.zeroPadValue("0xd00d", 32),
    collateralAmount: 0n,
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
    console.log("✓✓✓ SUCCESS:", tx.hash);
  } catch (e: unknown) {
    const err = e as { data?: string; info?: { error?: { data?: string } }; message?: string };
    const data = err?.data || err?.info?.error?.data;
    console.log("✗ Error data:", data?.slice(0, 100));
    console.log("✗ Message:", String(err?.message || err).slice(0, 300));

    // Try decoding with all known interfaces
    const iface = new ethers.Interface([
      "error InvalidSigner(address,address)",
      "error NotComposer()",
      "error ACLNotAllowed()",
      "error InvalidEncryptedInput(uint8,uint8)",
      "error SecurityZoneOutOfBounds(int32)",
      "error InsufficientReserve()",
      "error ERC20InsufficientBalance(address,uint256,uint256)",
      "error ERC20InsufficientAllowance(address,uint256,uint256)",
      "error SameBlockClose()",
      "error ZeroAmount()",
      "error ZeroAddress()",
      "error PositionAlreadyExists()",
    ]);
    if (data) {
      try {
        const decoded = iface.parseError(data);
        console.log("✗ Decoded:", decoded?.name, decoded?.args?.toString());
      } catch {
        console.log("✗ Could not decode error data");
      }
    }
  }
}

main().catch(console.error);
