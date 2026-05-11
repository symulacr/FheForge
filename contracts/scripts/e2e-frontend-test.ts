/**
 * FheForge — Frontend E2E Test Guide
 *
 * The Composer flow requires the user's wallet to be msg.sender for CoFHE FHE input validation.
 * Scripts cannot test this because the FHE mock checks input signatures against msg.sender.
 *
 * This script does everything EXCEPT the Composer flow (which requires browser + wallet).
 * For Composer, follow the manual test steps below.
 *
 * Usage:
 *   npx hardhat run scripts/e2e-frontend-test.ts --network arb-sepolia
 */
import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
const WETH  = "0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";
const USDC  = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

const ADDRS = {
  registry:  "0x59d955dA6a678D140ce8379ae7175850B7481E76",
  pool:      "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb",
  oracle:    "0xD0f0072ae4308be044bd5722059ACCf2CF543130",
  router:    "0x20C385f6292440aaDD6a4d7F620B612B658a1a93",
  vault:     "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa",
  composer:  "0xbca2d4c7BC85F4594F2e531b64d7B87f3E772231",
  executor:  "0x9bA1498Bc935F5BE8138D40B366418C874A1A345",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Setup CoFHE client
  const config = createCofheConfig({ environment: "node", supportedChains: [arbSepolia] });
  const client = await createCofheClient(config);
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();
  console.log("CoFHE client connected + permit ready");

  const enc64 = async (v: bigint) => {
    const [r] = await client.encryptInputs([Encryptable.uint64(v)]).execute();
    return r;
  };
  const enc128 = async (v: bigint) => {
    const [r] = await client.encryptInputs([Encryptable.uint128(v)]).execute();
    return r;
  };

  // Get contracts
  const pool = await ethers.getContractAt("LendingPool", ADDRS.pool, deployer);
  const vault = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer);
  const usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", USDC, deployer);

  // ═══ STEP 1: Approvals ═══
  console.log("\n═══ Step 1: Token Approvals ═══");
  for (const [name, addr] of [["Pool", ADDRS.pool], ["Vault", ADDRS.vault], ["Composer", ADDRS.composer]]) {
    const a = await usdc.allowance(deployer.address, addr);
    if (a < ethers.parseUnits("100000", 6)) {
      const tx = await usdc.approve(addr, ethers.MaxUint256);
      await tx.wait();
      console.log(`  USDC approved for ${name}`);
    } else {
      console.log(`  USDC already approved for ${name}`);
    }
  }

  // ═══ STEP 2: Supply USDC ═══
  console.log("\n═══ Step 2: Supply USDC ═══");
  const supplyAmt = ethers.parseUnits("1000", 6);
  const encSupply = BigInt(supplyAmt);
  const eSupply = await enc64(encSupply);
  const txSupply = await pool.supply(USDC, supplyAmt, eSupply);
  await txSupply.wait();
  console.log(`  Supplied ${ethers.formatUnits(supplyAmt, 6)} USDC — tx: ${txSupply.hash}`);

  // ═══ STEP 3: decryptForView on supply balance ═══
  console.log("\n═══ Step 3: decryptForView ═══");
  const ctSupply = await pool.getSupplyBalance.staticCall(USDC);
  const decResult = await client.decryptForView({ ctHash: BigInt(ctSupply.toString()), utype: FheTypes.Uint64 });
  console.log(`  Supply balance decrypted: ${decResult?.toString?.() ?? "failed"}`);

  // ═══ STEP 4: Borrow USDC ═══
  console.log("\n═══ Step 4: Borrow USDC ═══");
  const borrowAmt = ethers.parseUnits("400", 6);
  const eBorrow = await enc64(BigInt(borrowAmt));
  const txBorrow = await pool.checkLtvAndBorrow(USDC, USDC, borrowAmt, eBorrow, 80, 100);
  await txBorrow.wait();
  console.log(`  Borrowed ${ethers.formatUnits(borrowAmt, 6)} USDC — tx: ${txBorrow.hash}`);

  // ═══ STEP 5: Vault Position ═══
  console.log("\n═══ Step 5: Vault Position ═══");
  const hasPos = await vault.hasPosition(deployer.address);
  if (!hasPos) {
    const collAmt = ethers.parseUnits("500", 6);
    const eColl = await enc128(BigInt(collAmt));
    const stratCount = await registry.strategyCount();
    const sid = stratCount > 0n ? stratCount : 0n;
    if (sid > 0n) {
      const txVault = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](
        USDC, collAmt, eColl, sid, deployer.address
      );
      await txVault.wait();
      console.log(`  Opened vault position: ${ethers.formatUnits(collAmt, 6)} USDC — tx: ${txVault.hash}`);
    } else {
      console.log("  No strategy registered — skipping vault open");
    }
  } else {
    console.log("  Vault position already exists");
  }

  // ═══ STEP 6: Get encrypted TVL via new getter ═══
  console.log("\n═══ Step 6: getEncryptedTvl ═══");
  const stratCount2 = await registry.strategyCount();
  if (stratCount2 > 0n) {
    try {
      const ctTvl = await registry.getEncryptedTvl.staticCall(stratCount2);
      const decTvl = await client.decryptForView({ ctHash: BigInt(ctTvl.toString()), utype: FheTypes.Uint128 });
      console.log(`  TVL for strategy ${stratCount2}: ${decTvl?.toString?.() ?? "decrypt failed"}`);
    } catch (e: unknown) {
      console.log(`  getEncryptedTvl failed: ${String(e).slice(0, 200)}`);
    }
  }

  // ═══ MANUAL COMPOSER TEST INSTRUCTIONS ═══
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║  COMPOSER FLOW — Requires Frontend + Real Wallet      ║");
  console.log("╠════════════════════════════════════════════════════════╣");
  console.log("║                                                        ║");
  console.log("║  The CoFHE mock on testnet requires FHE input signer  ║");
  console.log("║  == msg.sender to the consuming contract. Scripts     ║");
  console.log("║  can't test Composer because it intermediates and      ║");
  console.log("║  changes msg.sender.                                   ║");
  console.log("║                                                        ║");
  console.log("║  To test openLeveragedStrategyDirect:                  ║");
  console.log("║  1. cd ui && npm run dev                               ║");
  console.log("║  2. Connect wallet (MetaMask) to Arb Sepolia           ║");
  console.log("║  3. Go to Strategy Builder page                       ║");
  console.log("║  4. Build a leveraged strategy                        ║");
  console.log("║  5. Click 'Open Strategy' (uses Direct path)          ║");
  console.log("║  6. Sign FHE encryption in wallet                     ║");
  console.log("║  7. Sign tx in wallet                                 ║");
  console.log("║  8. Verify position opened in Vault                   ║");
  console.log("║                                                        ║");
  console.log("║  Contract addresses (Wave 15):                         ║");
  console.log(`║  Registry:  ${ADDRS.registry}  ║`);
  console.log(`║  Pool:      ${ADDRS.pool}  ║`);
  console.log(`║  Vault:     ${ADDRS.vault}  ║`);
  console.log(`║  Composer:  ${ADDRS.composer}  ║`);
  console.log("║                                                        ║");
  console.log("╚════════════════════════════════════════════════════════╝");

  console.log("\n═══ E2E Script Complete ═══");
}

main().catch(console.error);
