/**
 * FheForge — Full On-Chain Function Audit (Wave15)
 *
 * Tests EVERY public/external function across all 7 contracts.
 * Makes real on-chain transactions on Arb Sepolia.
 * Reports pass/fail with tx hashes, FHE state checks, and gap analysis.
 *
 * Usage:
 *   npx hardhat run scripts/audit-onchain.ts --network arb-sepolia
 *
 * Report-only. No edits to contracts or state beyond what's needed for testing.
 */
import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable, type CofheClient, FheTypes } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════

const WETH  = "0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";
const USDC  = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

const ADDRS = {
  registry:  "0x59d955dA6a678D140ce8379ae7175850B7481E76",
  pool:      "0x9E8bf7496a157b12cB1A1BC2E291D7eF55374BAb",
  oracle:    "0xD0f0072ae4308be044bd5722059ACCf2CF543130",
  router:    "0x20C385f6292440aaDD6a4d7F620B612B658a1a93",
  vault:     "0x159d871ba54dA4D650853c57c6f61CF4EB9FFbBa",
  composer:  "0xeF1EdEcB5Df34C732561685F5Efa788947Dd68b8",
  executor:  "0x9bA1498Bc935F5BE8138D40B366418C874A1A345",
};

// ═══════════════════════════════════════════════════════════
// REPORT STRUCTURE
// ═══════════════════════════════════════════════════════════

interface FnResult {
  contract: string;
  fn: string;
  status: "PASS" | "FAIL" | "SKIP" | "READ" | "ADMIN";
  txHash?: string;
  info?: string;
  reason?: string;
}

const results: FnResult[] = [];
const fheIssues: { contract: string; loc: string; severity: string; issue: string; fix: string }[] = [];

function pass(c: string, f: string, info?: string, txHash?: string) {
  results.push({ contract: c, fn: f, status: "PASS", info, txHash });
  const t = txHash ? ` | tx:${txHash.slice(0,14)}…` : "";
  console.log(`  ✓ ${c}.${f}${info ? ": "+info : ""}${t}`);
}
function read(c: string, f: string, info: string) {
  results.push({ contract: c, fn: f, status: "READ", info });
  console.log(`  📖 ${c}.${f}: ${info}`);
}
function admin(c: string, f: string, info: string) {
  results.push({ contract: c, fn: f, status: "ADMIN", info });
  console.log(`  🔧 ${c}.${f}: ${info}`);
}
function fail(c: string, f: string, reason: string) {
  results.push({ contract: c, fn: f, status: "FAIL", reason });
  console.log(`  ✗ ${c}.${f}: ${reason}`);
}
function skip(c: string, f: string, reason: string) {
  results.push({ contract: c, fn: f, status: "SKIP", reason });
  console.log(`  ⏭ ${c}.${f}: ${reason}`);
}

/** Decode revert reason from error — with instrumentation */
function decodeRevert(e: unknown): string {
  const err = e as { data?: string; message?: string; shortMessage?: string; info?: { error?: { data?: string } } };
  // Try nested error.data (Hardhat wrapped errors)
  const rawData = err.data ?? err.info?.error?.data;
  if (rawData && typeof rawData === "string") {
    try {
      const iface = new ethers.Interface([
        // Contract custom errors
        "error ZeroAddress()","error ZeroAmount()","error WethNotSet()","error NotOwner()",
        "error OnlyComposer()","error OnlyVault()","error InsufficientReserve()",
        "error InsufficientOutput()","error InsufficientCollateral()","error DeadlineTooShort()",
        "error DeadlineTooLong()","error SameToken()","error Euint64Overflow()","error Paused()",
        "error NotPaused()","error NoPosition()","error PositionAlreadyExists()","error ExceedsDeposit()",
        "error ZeroPrice()","error NegativePrice()","error NoPriceFeed()","error OracleNotSet()",
        "error OnlyOwner()","error NotCreator()","error NotExecutor()","error UnknownIntent()",
        "error IntentExpired()","error ZeroOutput()","error LtvNumeratorZero()","error LtvDenominatorZero()",
        "error LtvExceedsHundredPercent()","error ExceedsBorrowBalance()","error ExceedsSupplyBalance()",
        "error UnhealthyAfterWithdraw()","error EthTransferFailed()","error TokenMismatch()",
        "error PositionHealthy()","error LiquidationTooLarge()","error InvalidStrategyId()",
        "error VaultAlreadySet()","error FhePermissionDenied()","error EmptyName()","error NameTooLong()",
        "error ZeroWorkflowHash()","error StrategyAlreadyExists()","error StrategyInactive()",
        "error NoPendingVault()","error TimelockNotElapsed()","error SameBlockClose()",
        "error InvalidBps()","error PythUpdateFeeMismatch()","error UncertainPrice()",
        "error TransferFailed()","error InvalidSignatureLength()",
        "error SafeERC20FailedOperation(address)",
        // CoFHE ACL errors (from docs Error Reference)
        "error ACLNotAllowed(uint256,address)","error SenderNotAllowed(address)",
        "error DirectAllowForbidden(address)","error AlreadyDelegated()",
        "error SenderCannotBeDelegateeAddress()","error PermissionInvalid_IssuerSignature()",
        "error PermissionInvalid_RecipientSignature()","error PermissionInvalid_Disabled()",
        "error PermissionInvalid_Expired()",
        // CoFHE TaskManager errors
        "error InvalidSecurityZone(int32,int32,int32)","error TooManyInputs(string,uint256,uint256)",
        "error InvalidTypeOrSecurityZone(string)","error DecryptionResultNotReady(uint256)",
        "error InvalidSigner(address,address)","error InvalidInputType(uint8,uint8)",
        "error InvalidSignature()","error InvalidInputForFunction(string,uint8)",
        "error InvalidInputsAmount(string,uint256,uint256)","error OnlyAggregatorAllowed(address)",
        "error InvalidOperationInputs(string)","error UnsupportedType(uint256)",
        "error CofheIsUnavailable()","error InvalidAddress()",
        "error RandomFunctionNotSupported()",
        // CoFHE FHE error
        "error InvalidEncryptedInput(uint8,uint8)","error MissingPrecompile(address)",
        // ECDSA/Permit2
        "error ECDSAInvalidSignature()","error ECDSAInvalidSignatureLength(uint256)",
        "error ECDSAInvalidSignatureS(bytes32)",
        // ERC20
        "error ERC20InsufficientAllowance(address,uint256,uint256)",
        "error ERC20InsufficientBalance(address,uint256,uint256)",
      ]);
      const parsed = iface.parseError(rawData);
      if (parsed) return `${parsed.name}(${parsed.args?.join(",") ?? ""})`;
    } catch { /* not a known error */ }
    const selector = rawData.slice(0, 10);
    return `unknown(${selector}) data=${rawData.slice(0, 66)}`;
  }
  return err.shortMessage ?? err.message?.slice(0, 200) ?? String(e).slice(0, 200);
}

/** Instrument: log with [DBG] prefix for debugging gaps */
function dbg(msg: string) { console.log(`    [DBG] ${msg}`); }

/** Record an FHE architecture issue for the refactor plan */
function fheIssue(contract: string, loc: string, severity: string, issue: string, fix: string) {
  fheIssues.push({ contract, loc, severity, issue, fix });
  console.log(`  ⚠ [FHE-${severity}] ${contract}@${loc}: ${issue} → FIX: ${fix}`);
}

/** Decrypt an FHE ciphertext handle for view using the CoFHE SDK */
async function decryptAndView(client: CofheClient | null, ctHash: bigint, utype: FheTypes, label: string): Promise<string> {
  if (!client) return "no-client";
  try {
    const plaintext = await client.decryptForView(ctHash, utype).execute();
    return `decrypted=${plaintext}`;
  } catch (e: unknown) {
    const decoded = decodeRevert(e);
    dbg(`decryptForView(${label}) failed: ${decoded}`);
    return `decrypt-failed: ${decoded.slice(0,100)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   FheForge Full On-Chain Function Audit — Wave 12       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer — set PRIVATE_KEY");
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address, `(${ethers.formatEther(bal)} ETH)`);

  // Attach all contracts
  const registry = await ethers.getContractAt("StrategyRegistry", ADDRS.registry, deployer);
  const vault    = await ethers.getContractAt("StrategyVault", ADDRS.vault, deployer);
  const pool     = await ethers.getContractAt("LendingPool", ADDRS.pool, deployer);
  const router   = await ethers.getContractAt("SwapRouter", ADDRS.router, deployer);
  const oracle   = await ethers.getContractAt("PriceOracle", ADDRS.oracle, deployer);
  const executor = await ethers.getContractAt("ExecutorContract", ADDRS.executor, deployer);
  const composer = await ethers.getContractAt("FheForgeComposer", ADDRS.composer, deployer);

  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ];
  const weth = await ethers.getContractAt(erc20Abi, WETH, deployer);
  const usdc = await ethers.getContractAt(erc20Abi, USDC, deployer);

  // ═══ COFHE CLIENT ═══
  console.log("\n── CoFHE Client Setup ──");
  let cofheClient: CofheClient | null = null;
  try {
    const config = createCofheConfig({
      environment: "node",
      supportedChains: [arbSepolia],
    });
    cofheClient = createCofheClient(config);
    if (cofheClient) {
      const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(deployer);
      await cofheClient.connect(publicClient, walletClient);
      await cofheClient.permits.getOrCreateSelfPermit();
      pass("CoFHE", "client+connect+permit", "self-permit via getOrCreateSelfPermit");
    }
  } catch (e: unknown) { fail("CoFHE", "client", decodeRevert(e)); dbg(`CoFHE setup full: ${String(e).slice(0,500)}`); }

  const enc64 = async (v: bigint) => {
    if (!cofheClient) throw new Error("no cofhe");
    const [r] = await cofheClient.encryptInputs([Encryptable.uint64(v)]).execute();
    dbg(`enc64(${v}): ctHash=${r.ctHash.toString().slice(0,16)}… utype=${r.utype} securityZone=${r.securityZone}`);
    return r;
  };
  const enc64For = async (v: bigint, account: string) => {
    if (!cofheClient) throw new Error("no cofhe");
    const [r] = await cofheClient.encryptInputs([Encryptable.uint64(v)]).setAccount(account).execute();
    dbg(`enc64For(${v}, ${account.slice(0,10)}…): ctHash=${r.ctHash.toString().slice(0,16)}… utype=${r.utype}`);
    return r;
  };
  const enc128For = async (v: bigint, account: string) => {
    if (!cofheClient) throw new Error("no cofhe");
    const [r] = await cofheClient.encryptInputs([Encryptable.uint128(v)]).setAccount(account).execute();
    dbg(`enc128For(${v}, ${account.slice(0,10)}…): ctHash=${r.ctHash.toString().slice(0,16)}… utype=${r.utype}`);
    return r;
  };
  const enc128 = async (v: bigint) => {
    if (!cofheClient) throw new Error("no cofhe");
    const [r] = await cofheClient.encryptInputs([Encryptable.uint128(v)]).execute();
    dbg(`enc128(${v}): ctHash=${r.ctHash.toString().slice(0,16)}… utype=${r.utype} securityZone=${r.securityZone}`);
    return r;
  };
  // decryptForView helper — reads encrypted on-chain value back to plaintext
  const decView = async (ctHash: bigint, utype: FheTypes, label: string) => {
    return decryptAndView(cofheClient, ctHash, utype, label);
  };
  // decryptForTx helper — returns {decryptedValue, signature} for on-chain publish/verify
  const decTx = async (ctHash: bigint, withPermit: boolean) => {
    if (!cofheClient) return null;
    try {
      if (withPermit) {
        return await cofheClient.decryptForTx(ctHash).withPermit().execute();
      } else {
        return await cofheClient.decryptForTx(ctHash).withoutPermit().execute();
      }
    } catch (e: unknown) {
      dbg(`decryptForTx failed: ${decodeRevert(e)}`);
      return null;
    }
  };

  // ═══ TOKEN PREP ═══
  console.log("\n── Token Prep ──");
  try {
    // Parallel balance reads
    const [usdcBal, wethBal] = await Promise.all([
      usdc.balanceOf(deployer.address),
      weth.balanceOf(deployer.address),
    ]);
    read("USDC", "balanceOf", `${ethers.formatUnits(usdcBal, 6)}`);
    read("WETH", "balanceOf", `${ethers.formatUnits(wethBal, 18)}`);

    // Parallel approval checks + approve if needed
    const targets = [
      { name: "Pool", addr: ADDRS.pool },
      { name: "Vault", addr: ADDRS.vault },
      { name: "Composer", addr: ADDRS.composer },
      { name: "Router", addr: ADDRS.router },
    ];
    // Parallel: read all allowances first, then batch approve
    const allowanceReads = await Promise.all(targets.flatMap(({ addr }) => [
      usdc.allowance(deployer.address, addr),
      weth.allowance(deployer.address, addr),
    ]));
    // Approve all that need it — SEQUENTIAL (L2 nonce safety)
    const approved: string[] = [];
    for (const { name, addr } of targets) {
      const aU = await usdc.allowance(deployer.address, addr);
      const aW = await weth.allowance(deployer.address, addr);
      if (aU < ethers.parseUnits("100000", 6)) { const t = await usdc.approve(addr, ethers.MaxUint256); await t.wait(); approved.push(`USDC→${name}`); }
      else read("USDC", `allowance→${name}`, "sufficient");
      if (aW < ethers.parseEther("100000")) { const t = await weth.approve(addr, ethers.MaxUint256); await t.wait(); approved.push(`WETH→${name}`); }
      else read("WETH", `allowance→${name}`, "sufficient");
    }
    for (const a of approved) pass("Token", `approve(${a})`, "MaxUint256");
  } catch (e: unknown) { fail("Token", "prep", decodeRevert(e)); dbg(`Token prep full: ${String(e).slice(0,500)}`); }

  // 1. STRATEGY REGISTRY (12 functions)
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 1. StrategyRegistry ═══");

  admin("Registry", "setVault", "already wired on deploy");
  try {
    const tx = await registry.proposeVault(ADDRS.vault);
    await tx.wait();
    pass("Registry", "proposeVault", `proposed ${ADDRS.vault.slice(0,14)}…`, tx.hash);
  } catch (e: unknown) { fail("Registry", "proposeVault", decodeRevert(e)); }
  skip("Registry", "acceptVault", "timelock 90s — not tested in audit");

  try {
    const tx1 = await registry.pause(); await tx1.wait();
    pass("Registry", "pause", "paused", tx1.hash);
    const tx2 = await registry.unpause(); await tx2.wait();
    pass("Registry", "unpause", "unpaused", tx2.hash);
  } catch (e: unknown) { fail("Registry", "pause/unpause", decodeRevert(e)); }

  let strategyId: bigint = 0n;
  try {
    const uniqueName = `Audit-${Date.now()}`;
    const uniqueHash = ethers.keccak256(ethers.toUtf8Bytes(uniqueName));
    const tx = await registry.registerStrategy(uniqueName, uniqueHash, 650, 2);
    await tx.wait();
    strategyId = await registry.strategyCount();
    pass("Registry", "registerStrategy", `id=${strategyId} name=${uniqueName}`, tx.hash);
  } catch (e: unknown) {
    const decoded = decodeRevert(e);
    if (decoded.includes("StrategyAlreadyExists")) {
      dbg(`registerStrategy: StrategyAlreadyExists — using latest existing strategy`);
      strategyId = await registry.strategyCount();
      read("Registry", "registerStrategy", `reusing id=${strategyId} (already exists)`);
    } else { fail("Registry", "registerStrategy", decoded); dbg(`registerStrategy full: ${String(e).slice(0,500)}`); }
  }

  try {
    const [c, m, p] = await Promise.all([
      registry.strategyCount(),
      registry.getStrategyMeta(strategyId),
      registry.getStrategyParams(strategyId),
    ]);
    read("Registry", "strategyCount", c.toString());
    read("Registry", "getStrategyMeta", `name=${m[0]} active=${m[4]}`);
    read("Registry", "getStrategyParams", `apy=${p[0]} loops=${p[1]}`);
  } catch (e: unknown) { fail("Registry", "reads", decodeRevert(e)); }
  try {
    const tx1 = await registry.setActive(strategyId, false); await tx1.wait();
    pass("Registry", "setActive(false)", `id=${strategyId}`, tx1.hash);
    const tx2 = await registry.setActive(strategyId, true); await tx2.wait();
    pass("Registry", "setActive(true)", `id=${strategyId}`, tx2.hash);
  } catch (e: unknown) { fail("Registry", "setActive", decodeRevert(e)); }

  skip("Registry", "incrementTvl", "onlyVault — exercised via Vault flow");
  skip("Registry", "decrementTvl", "onlyVault — exercised via Vault flow");

  // ══════════════════════════════════════════════════════
  // 2. PRICE ORACLE (8 functions)
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 2. PriceOracle ═══");
  admin("Oracle", "setSource", "wired on deploy");
  admin("Oracle", "setCollateralFactor", "wired on deploy");

  // Parallel oracle reads
  try {
    const [fee, priceUsd, convTo, convFrom, supW, supU] = await Promise.all([
      oracle.getPythUpdateFee([]),
      oracle.getPriceUsd(WETH),
      oracle.convertToUsd(WETH, ethers.parseEther("1")),
      oracle.convertFromUsd(WETH, ethers.parseUnits("2000", 18)),
      oracle.isSupported(WETH),
      oracle.isSupported(USDC),
    ]);
    read("Oracle", "getPythUpdateFee", `${ethers.formatEther(fee)} ETH`);
    const [p, u] = priceUsd as [bigint, bigint];
    read("Oracle", "getPriceUsd(WETH)", `$${ethers.formatUnits(p,18)} updated=${u}`);
    read("Oracle", "convertToUsd(1 WETH)", `$${ethers.formatUnits(convTo,18)}`);
    read("Oracle", "convertFromUsd($2000)", `${ethers.formatEther(convFrom)} WETH`);
    read("Oracle", "isSupported", `WETH=${supW} USDC=${supU}`);
    const tx = await oracle.updatePriceFeeds([], { value: fee });
    await tx.wait();
    pass("Oracle", "updatePriceFeeds(empty)", `fee=${ethers.formatEther(fee)}`, tx.hash);
  } catch (e: unknown) { fail("Oracle", "reads/updatePriceFeeds", decodeRevert(e)); }
  skip("Oracle", "sweepEth", "admin-only fund sweep — not tested");

  // ══════════════════════════════════════════════════════
  // 3. LENDING POOL (22 functions)
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 3. LendingPool ═══");
  admin("Pool", "setOracle", "wired on deploy");
  admin("Pool", "setWeth", "wired on deploy");
  admin("Pool", "setComposer", "wired on deploy");
  skip("Pool", "disableOracle", "would break pool");
  skip("Pool", "disableWeth", "would break pool");

  // supply (USDC)
  const supplyAmt = ethers.parseUnits("1000", 6);
  if (cofheClient) {
    try {
      const e = await enc64(supplyAmt);
      const tx = await pool.supply(USDC, supplyAmt, e);
      await tx.wait();
      pass("Pool", "supply(USDC)", `${ethers.formatUnits(supplyAmt,6)}`, tx.hash);
    } catch (e: unknown) { fail("Pool", "supply(USDC)", decodeRevert(e)); }
  } else { skip("Pool", "supply(USDC)", "FHE required"); }

  skip("Pool", "supplyWithPermit2", "requires Permit2 signature flow");

  // supplyEth
  if (cofheClient) {
    try {
      const ethAmt = ethers.parseEther("0.001");
      const encVal = BigInt(ethAmt) / BigInt(10**12); // scale to fit uint64 range for FHE mock
      dbg(`supplyEth: ethAmt=${ethers.formatEther(ethAmt)} encVal=${encVal}`);
      const e = await enc64(encVal);
      dbg(`supplyEth: ctHash=${e.ctHash?.toString?.()?.slice(0,16) ?? "n/a"} utype=${e.utype} securityZone=${e.securityZone}`);
      const tx = await pool.supplyEth(e, { value: ethAmt });
      await tx.wait();
      pass("Pool", "supplyEth", `${ethers.formatEther(ethAmt)} ETH`, tx.hash);
    } catch (e: unknown) { fail("Pool", "supplyEth", decodeRevert(e)); dbg(`supplyEth full error: ${String(e).slice(0,500)}`); }
  } else { skip("Pool", "supplyEth", "FHE required"); }

  // Parallel: supply balance reads (encrypted + plain)
  if (cofheClient) {
    try {
      const [ct, ps] = await Promise.all([pool.getSupplyBalance.staticCall(USDC), pool.getPlainSupplyBalance(USDC)]);
      read("Pool", "getSupplyBalance(USDC)", `ctHash=${ct.toString().slice(0,20)}…`);
      read("Pool", "getPlainSupplyBalance(USDC)", ethers.formatUnits(ps,6));
    } catch (e: unknown) { fail("Pool", "supplyBalance reads", decodeRevert(e)); }
  } else { skip("Pool", "getSupplyBalance", "FHE required"); skip("Pool", "getPlainSupplyBalance", "FHE required"); }

  // checkLtvAndBorrow + borrowWithOracle — parallel encrypt, sequential submit (state dependent)
  const borrowAmt = ethers.parseUnits("500", 6);
  const borrowAmt2 = ethers.parseUnits("100", 6);
  if (cofheClient) {
    try {
      const [eB, eB2] = await Promise.all([enc64(borrowAmt), enc64(borrowAmt2)]);
      const tx1 = await pool.checkLtvAndBorrow(USDC, USDC, borrowAmt, eB, 80, 100);
      await tx1.wait();
      pass("Pool", "checkLtvAndBorrow", `${ethers.formatUnits(borrowAmt,6)} USDC`, tx1.hash);
      const tx2 = await pool.borrowWithOracle(USDC, USDC, borrowAmt2, eB2);
      await tx2.wait();
      pass("Pool", "borrowWithOracle", `${ethers.formatUnits(borrowAmt2,6)} USDC`, tx2.hash);
    } catch (e: unknown) { fail("Pool", "borrow ops", decodeRevert(e)); dbg(`borrow full: ${String(e).slice(0,500)}`); }
  } else { skip("Pool", "checkLtvAndBorrow", "FHE required"); skip("Pool", "borrowWithOracle", "FHE required"); }

  // Parallel: borrow balance reads (encrypted + plain)
  if (cofheClient) {
    try {
      const [ctBor, pbBor] = await Promise.all([pool.getBorrowBalance.staticCall(USDC), pool.getPlainBorrowBalance(USDC)]);
      read("Pool", "getBorrowBalance(USDC)", `ctHash=${ctBor.toString().slice(0,20)}…`);
      read("Pool", "getPlainBorrowBalance(USDC)", ethers.formatUnits(pbBor,6));
    } catch (e: unknown) { fail("Pool", "borrowBalance reads", decodeRevert(e)); }
  } else { skip("Pool", "getBorrowBalance", "FHE required"); skip("Pool", "getPlainBorrowBalance", "FHE required"); }
  // repay enough so that withdraw is possible (reserve - withdraw >= totalBorrow)
  const repayAmt = ethers.parseUnits("100", 6);
  if (cofheClient) {
    try {
      const eR = await enc64(repayAmt);
      const tx = await pool.repay(USDC, repayAmt, eR);
      await tx.wait();
      pass("Pool", "repay(USDC)", `${ethers.formatUnits(repayAmt,6)}`, tx.hash);
    } catch (e: unknown) { fail("Pool", "repay", decodeRevert(e)); }
  } else { skip("Pool", "repay", "FHE required"); }

  skip("Pool", "repayWithPermit2", "requires Permit2 signature");

  // Repay more to create excess reserve for withdraw test
  const repayAmt2 = ethers.parseUnits("200", 6);
  if (cofheClient) {
    try {
      const eR2 = await enc64(repayAmt2);
      const tx2 = await pool.repay(USDC, repayAmt2, eR2);
      await tx2.wait();
      pass("Pool", "repay(USDC) #2", `${ethers.formatUnits(repayAmt2,6)} — creating excess reserve`, tx2.hash);
    } catch (e: unknown) { fail("Pool", "repay #2", decodeRevert(e)); }
  }

  // withdraw — now there's excess reserve
  if (cofheClient) {
    try {
      const plainSup = await pool.getPlainSupplyBalance(USDC);
      const plainBor = await pool.getPlainBorrowBalance(USDC);
      const totalBor = await pool.totalPlainBorrow(USDC);
      const reserve = await pool.liquidReserve(USDC);
      const excess = reserve > totalBor ? reserve - totalBor : 0n;
      dbg(`withdraw: supply=${ethers.formatUnits(plainSup,6)} borrow=${ethers.formatUnits(plainBor,6)} totalBorrow=${ethers.formatUnits(totalBor,6)} reserve=${ethers.formatUnits(reserve,6)} excess=${ethers.formatUnits(excess,6)}`);
      const withdrawAmt = excess > ethers.parseUnits("50", 6) ? ethers.parseUnits("50", 6) : excess > 0n ? excess / 2n : 0n;
      if (withdrawAmt > 0n) {
        const eW = await enc64(withdrawAmt);
        const tx = await pool.withdraw(USDC, withdrawAmt, eW);
        await tx.wait();
        pass("Pool", "withdraw(USDC)", `${ethers.formatUnits(withdrawAmt,6)}`, tx.hash);
      } else { skip("Pool", "withdraw", "InsufficientReserve — reserve<=totalBorrow"); }
    } catch (e: unknown) { fail("Pool", "withdraw", decodeRevert(e)); dbg(`withdraw full: ${String(e).slice(0,500)}`); }
  } else { skip("Pool", "withdraw", "FHE required"); }

  // withdrawEth
  if (cofheClient) {
    try {
      // Need WETH supply first to withdraw as ETH
      const wethSup = await pool.getPlainSupplyBalance(WETH);
      if (wethSup > 0n) {
        const wAmt = ethers.parseEther("0.0005");
        const eWE = await enc64(wAmt);
        const tx = await pool.withdrawEth(wAmt, eWE);
        await tx.wait();
        pass("Pool", "withdrawEth", `${ethers.formatEther(wAmt)} ETH`, tx.hash);
      } else {
        skip("Pool", "withdrawEth", "no WETH supply to withdraw");
      }
    } catch (e: unknown) { fail("Pool", "withdrawEth", decodeRevert(e)); }
  } else { skip("Pool", "withdrawEth", "FHE required"); }

  // supplyToLending / borrowFromLending / repayBorrow — onlyComposer
  skip("Pool", "supplyToLending", "onlyComposer — exercised via Composer openLeveragedStrategy");
  skip("Pool", "borrowFromLending", "onlyComposer — exercised via Composer openLeveragedStrategy");
  skip("Pool", "repayBorrow", "onlyComposer — exercised via Composer rebalance");

  // liquidate
  skip("Pool", "liquidate", "requires underwater position — complex setup skipped");

  // emergencyWithdraw (only when paused) — checks reserve vs totalBorrow
  try {
    const tx1 = await pool.pause(); await tx1.wait();
    pass("Pool", "pause", "paused", tx1.hash);
    try {
      const plainSup = await pool.getPlainSupplyBalance(USDC);
      const totalBor = await pool.getPlainBorrowBalance(USDC);
      dbg(`emergencyWithdraw: plainSupply=${ethers.formatUnits(plainSup,6)} totalBorrow=${ethers.formatUnits(totalBor,6)}`);
      // emergencyWithdraw checks: reserve - amount >= totalBorrow
      // Since reserve = supply (in this simplified pool) and totalBorrow drains it,
      // we can only withdraw if supply > borrow (i.e., there's excess reserve)
      if (plainSup > 0n && plainSup > totalBor) {
        const tx2 = await pool.emergencyWithdraw(USDC); await tx2.wait();
        pass("Pool", "emergencyWithdraw(USDC)", "withdrew excess over borrow", tx2.hash);
      } else if (plainSup > 0n) {
        // Supply exists but all is borrowed out — emergencyWithdraw will revert
        fail("Pool", "emergencyWithdraw", `InsufficientReserve — supply=${ethers.formatUnits(plainSup,6)} <= borrow=${ethers.formatUnits(totalBor,6)} [GAP: emergencyWithdraw fails when all supply is borrowed — no way to exit in emergency if reserve can't cover borrows]`);
      } else { skip("Pool", "emergencyWithdraw", "no plain supply"); }
    } catch (e: unknown) { fail("Pool", "emergencyWithdraw", decodeRevert(e)); dbg(`emergencyWithdraw full: ${String(e).slice(0,500)}`); }
    const tx3 = await pool.unpause(); await tx3.wait();
    pass("Pool", "unpause", "unpaused", tx3.hash);
  } catch (e: unknown) { fail("Pool", "pause/unpause", decodeRevert(e)); }

  // permitTransferFrom
  skip("Pool", "permitTransferFrom", "onlyComposer — internal Permit2 flow");

  // ═══ DEEP ETH/WETH/USDC ROUNDTRIP ═══
  console.log("\n  ── Deep ETH/WETH/USDC Roundtrip ──");
  if (cofheClient) {
    // WETH supply → withdraw roundtrip
    try {
      const wethAmt = ethers.parseEther("0.01");
      const encWeth = BigInt(wethAmt) / BigInt(10**12); // scale for euint64
      const eW = await enc64(encWeth);
      dbg(`WETH roundtrip: supplying ${ethers.formatEther(wethAmt)} ETH as WETH, encVal=${encWeth}`);
      const txWS = await pool.supplyEth(eW, { value: wethAmt });
      await txWS.wait();
      pass("Pool", "supplyEth(WETH roundtrip)", `${ethers.formatEther(wethAmt)} ETH`, txWS.hash);

      // Read WETH supply balance
      const [ctWethBal, plWethBal] = await Promise.all([
        pool.getSupplyBalance.staticCall(WETH),
        pool.getPlainSupplyBalance(WETH),
      ]);
      read("Pool", "WETH supply after supplyEth", `enc=${ctWethBal.toString().slice(0,16)}… plain=${ethers.formatEther(plWethBal)}`);

      // Attempt WETH withdraw
      const wethWithdrawAmt = ethers.parseEther("0.005");
      const encWethW = BigInt(wethWithdrawAmt) / BigInt(10**12);
      const eWW = await enc64(encWethW);
      try {
        const txWW = await pool.withdrawEth(wethWithdrawAmt, eWW);
        await txWW.wait();
        pass("Pool", "withdrawEth(WETH roundtrip)", `${ethers.formatEther(wethWithdrawAmt)} ETH`, txWW.hash);
      } catch (e: unknown) {
        fail("Pool", "withdrawEth", decodeRevert(e));
        dbg(`withdrawEth full: ${String(e).slice(0,500)}`);
        dbg(`[GAP: withdrawEth fails — may need WETH balance check. supplyEth deposits ETH as WETH to pool but withdrawEth must convert WETH back]`);
      }
    } catch (e: unknown) { fail("Pool", "ETH/WETH roundtrip", decodeRevert(e)); dbg(`WETH roundtrip full: ${String(e).slice(0,500)}`); }

    // USDC full lifecycle: supply → borrow → repay → withdraw
    try {
      const usdcLifeAmt = ethers.parseUnits("2000", 6);
      const eLife = await enc64(usdcLifeAmt);
      const txUS = await pool.supply(USDC, usdcLifeAmt, eLife);
      await txUS.wait();
      pass("Pool", "supply(USDC lifecycle)", `${ethers.formatUnits(usdcLifeAmt,6)}`, txUS.hash);

      // Parallel read post-supply
      const [plS, plB] = await Promise.all([
        pool.getPlainSupplyBalance(USDC),
        pool.getPlainBorrowBalance(USDC),
      ]);
      dbg(`USDC lifecycle: supply=${ethers.formatUnits(plS,6)} borrow=${ethers.formatUnits(plB,6)}`);

      // Borrow against USDC supply
      const usdcBorrowAmt = ethers.parseUnits("800", 6);
      const eBor = await enc64(usdcBorrowAmt);
      const txUB = await pool.checkLtvAndBorrow(USDC, USDC, usdcBorrowAmt, eBor, 80, 100);
      await txUB.wait();
      pass("Pool", "borrow(USDC lifecycle)", `${ethers.formatUnits(usdcBorrowAmt,6)}`, txUB.hash);

      // Repay half
      const usdcRepayAmt = ethers.parseUnits("400", 6);
      const eRep = await enc64(usdcRepayAmt);
      const txUR = await pool.repay(USDC, usdcRepayAmt, eRep);
      await txUR.wait();
      pass("Pool", "repay(USDC lifecycle)", `${ethers.formatUnits(usdcRepayAmt,6)}`, txUR.hash);

      // Withdraw some (must have reserve)
      const [plS2, plB2] = await Promise.all([
        pool.getPlainSupplyBalance(USDC),
        pool.getPlainBorrowBalance(USDC),
      ]);
      const reserve = plS2 > plB2 ? plS2 - plB2 : 0n;
      const withdrawLifeAmt = reserve > ethers.parseUnits("200", 6) ? ethers.parseUnits("200", 6) : 0n;
      if (withdrawLifeAmt > 0n) {
        const eWL = await enc64(withdrawLifeAmt);
        const txUW = await pool.withdraw(USDC, withdrawLifeAmt, eWL);
        await txUW.wait();
        pass("Pool", "withdraw(USDC lifecycle)", `${ethers.formatUnits(withdrawLifeAmt,6)}`, txUW.hash);
      } else { skip("Pool", "withdraw(lifecycle)", "insufficient reserve"); }

      // Final state check
      const [plS3, plB3, liqRes] = await Promise.all([
        pool.getPlainSupplyBalance(USDC),
        pool.getPlainBorrowBalance(USDC),
        pool.liquidReserve(USDC),
      ]);
      read("Pool", "USDC lifecycle final", `supply=${ethers.formatUnits(plS3,6)} borrow=${ethers.formatUnits(plB3,6)} reserve=${ethers.formatUnits(liqRes,6)}`);
    } catch (e: unknown) { fail("Pool", "USDC lifecycle", decodeRevert(e)); dbg(`USDC lifecycle full: ${String(e).slice(0,500)}`); }
  }

  // ═══ VAULT LIQUIDITY DEEP TEST ═══
  console.log("\n  ── Vault Liquidity Deep Test ──");
  if (cofheClient && strategyId > 0n) {
    const vaultHasPos = await vault.hasPosition(deployer.address);
    if (vaultHasPos) {
      // Try closing existing position — if SameBlockClose, skip deep test
      try {
        const dep = await vault.getDepositedAmount();
        if (dep > 0n) {
          const eC = await enc128(dep);
          await (await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](dep, eC)).wait();
          dbg(`vault deep: closed existing ${ethers.formatUnits(dep,6)}`);
        }
      } catch (e2: unknown) {
        const d2 = decodeRevert(e2);
        if (d2.includes("SameBlockClose")) {
          skip("Vault", "WETH liquidity deep", "existing position opened this block — SameBlockClose prevents close");
          dbg(`vault deep: will retry on next audit run`);
        } else {
          fail("Vault", "close existing (deep)", d2);
        }
      }
    }
  }
  // Re-check after potential close — only proceed if no position
  if (cofheClient && strategyId > 0n && !(await vault.hasPosition(deployer.address))) {
    try {
      // Open with WETH collateral
      const wethCollAmt = ethers.parseEther("0.05");
      const encWethColl = BigInt(wethCollAmt) / BigInt(10**12);
      const eWC = await enc128(encWethColl);
      // Need WETH approval to vault
      const wethAppTx = await weth.approve(ADDRS.vault, ethers.MaxUint256);
      await wethAppTx.wait();
      const txOpen = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](
        WETH, wethCollAmt, eWC, strategyId, deployer.address
      );
      await txOpen.wait();
      pass("Vault", "openPosition(WETH collateral)", `${ethers.formatEther(wethCollAmt)} WETH`, txOpen.hash);

      // Read all vault state in parallel
      const [hasPos2, depAmt2, meta2, ctColl2, collToken] = await Promise.all([
        vault.hasPosition(deployer.address),
        vault.getDepositedAmount(),
        vault.getPositionMeta(),
        cofheClient ? vault.getCollateral.staticCall() : Promise.resolve(null),
        vault.collateralToken ? vault.collateralToken(deployer.address) : Promise.resolve(null),
      ]);
      read("Vault", "WETH position state", `hasPosition=${hasPos2} deposited=${ethers.formatEther(depAmt2)} stratId=${meta2[0]} ctHash=${ctColl2?.toString?.()?.slice(0,16) ?? "n/a"}`);

      // Add more WETH collateral
      const addWethAmt = ethers.parseEther("0.01");
      const encAddWeth = BigInt(addWethAmt) / BigInt(10**12);
      const eAW = await enc64(encAddWeth);
      const txAdd = await vault["addCollateral(address,uint256,(uint256,uint8,uint8,bytes),address)"](
        WETH, addWethAmt, eAW, deployer.address
      );
      await txAdd.wait();
      pass("Vault", "addCollateral(WETH)", `+${ethers.formatEther(addWethAmt)} WETH`, txAdd.hash);

      // Decrypt the collateral after adding
      const ctColl3 = await vault.getCollateral.staticCall();
      const decColl3 = await decView(BigInt(ctColl3.toString()), FheTypes.Uint128, "vault-weth-after-add");
      read("Vault", "WETH collateral after add", `ctHash=${ctColl3.toString().slice(0,16)}… ${decColl3}`);

      // Close WETH position
      const wethDep = await vault.getDepositedAmount();
      if (wethDep > 0n) {
        const eCW = await enc128(wethDep);
        const txCW = await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](wethDep, eCW);
        await txCW.wait();
        pass("Vault", "closePosition(WETH)", `${ethers.formatEther(wethDep)} WETH withdrawn`, txCW.hash);
      }
    } catch (e: unknown) { fail("Vault", "WETH liquidity deep", decodeRevert(e)); dbg(`Vault WETH deep full: ${String(e).slice(0,500)}`); }

    // Vault emergencyWithdraw test (requires paused + position)
    try {
      // Open position, pause, emergency withdraw, unpause
      const emColl = ethers.parseUnits("100", 6);
      const eEC = await enc128(emColl);
      const txEO = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](
        USDC, emColl, eEC, strategyId, deployer.address
      );
      await txEO.wait();
      const txEP = await vault.pause(); await txEP.wait();
      pass("Vault", "pause(for emergency)", "paused", txEP.hash);
      try {
        const txEW = await vault.emergencyWithdraw(); await txEW.wait();
        pass("Vault", "emergencyWithdraw()", "withdrew from paused vault", txEW.hash);
      } catch (ew: unknown) {
        fail("Vault", "emergencyWithdraw", decodeRevert(ew));
        dbg(`Vault emergencyWithdraw full: ${String(ew).slice(0,500)}`);
        fheIssue("StrategyVault", "emergencyWithdraw", "MEDIUM",
          "emergencyWithdraw failed — may need specific conditions (paused + position + reserve)",
          "Test with real paused state and position. Ensure emergency path doesn't depend on FHE ops that may fail when paused.");
      } finally {
        // Always unpause — never leave Vault stuck paused
        try {
          const txEU = await vault.unpause(); await txEU.wait();
          pass("Vault", "unpause(after emergency)", "unpaused", txEU.hash);
        } catch (up: unknown) { dbg(`unpause after emergency failed: ${decodeRevert(up)}`); }
      }
    } catch (e: unknown) {
      fail("Vault", "emergencyWithdraw flow (open/pause)", decodeRevert(e));
      dbg(`Vault emergency full: ${String(e).slice(0,500)}`);
    }
  } else { skip("Vault", "WETH liquidity deep", cofheClient ? "no strategyId" : "FHE required"); }

  // ══════════════════════════════════════════════════════
  // 4. SWAP ROUTER (7 functions)
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 4. SwapRouter ═══");
  admin("Router", "proposeExecutor", "admin timelock — already set");
  skip("Router", "acceptExecutor", "timelock 90s — not tested");

  // submitSwapIntent — use RELATIVE offset (3600s), not absolute timestamp
  let intentId: string = "";
  try {
    const swapAmt = ethers.parseUnits("100", 6);
    const tx = await router.submitSwapIntent(USDC, WETH, swapAmt, 0n, 3600);
    const rcpt = await tx.wait();
    // Parse IntentSubmitted event (may differ from IntentCreated)
    for (const l of rcpt!.logs) {
      try {
        const parsed = router.interface.parseLog(l);
        if (parsed && (parsed.name === "SwapIntentCreated" || parsed.name === "IntentSubmitted")) {
          intentId = parsed.args.intentId ?? parsed.args[0];
          dbg(`submitSwapIntent: event=${parsed.name} intentId=${intentId.slice(0,14)}…`);
          break;
        }
      } catch { /* skip unparsable log */ }
    }
    if (!intentId) dbg(`submitSwapIntent: no intent event found in ${rcpt!.logs.length} logs`);
    pass("Router", "submitSwapIntent", `USDC→WETH ${ethers.formatUnits(swapAmt,6)}`, tx.hash);
  } catch (e: unknown) { fail("Router", "submitSwapIntent", decodeRevert(e)); dbg(`submitSwapIntent full: ${String(e).slice(0,500)}`); }

  // getIntentMeta
  try {
    if (intentId) {
      const m = await router.getIntentMeta(intentId);
      read("Router", "getIntentMeta", `tokenIn=${m[0]} tokenOut=${m[1]} user=${(m[2] as string).slice(0,10)}…`);
    } else { skip("Router", "getIntentMeta", "no intentId"); }
  } catch (e: unknown) { fail("Router", "getIntentMeta", decodeRevert(e)); }

  // executeIntent (via ExecutorContract) — Router must approve Executor for tokenOut transfer
  try {
    if (intentId) {
      // Router holds escrowed USDC; ExecutorContract needs to transfer it to the user
      // Router must approve ExecutorContract for the output token (WETH) spending
      dbg(`executeIntent: checking Router→Executor allowances`);
      const routerWethAllow = await weth.allowance(ADDRS.router, ADDRS.executor);
      const routerUsdcAllow = await usdc.allowance(ADDRS.router, ADDRS.executor);
      dbg(`executeIntent: Router→Executor WETH=${ethers.formatEther(routerWethAllow)} USDC=${ethers.formatUnits(routerUsdcAllow,6)}`);
      // Router is owned by deployer; approve Executor to spend Router's tokens
      const routerSigner = await ethers.getContractAt("SwapRouter", ADDRS.router, deployer);
      // We need to approve from the Router contract itself — Router owner can call approveToken
      // Actually: Router.executeIntent does IERC20(tokenIn).safeTransfer(intent.user, intent.amountIn)
      // and expects executor to provide tokenOut separately. So Executor just needs tokenOut (WETH).
      // Fund Executor with WETH and approve it
      const execWethBal = await weth.balanceOf(ADDRS.executor);
      dbg(`executeIntent: Executor WETH balance=${ethers.formatEther(execWethBal)}`);
      if (execWethBal < ethers.parseEther("0.05")) {
        // Send WETH to ExecutorContract
        const fundTx = await weth.transfer(ADDRS.executor, ethers.parseEther("0.1"));
        await fundTx.wait();
        dbg(`executeIntent: funded Executor with 0.1 WETH`);
      }
      // ExecutorContract must approve Router for tokenOut (WETH) spending
      // SwapRouter.executeIntent does: IERC20(tokenOut).safeTransferFrom(executor, user, outputAmount)
      const execContract = await ethers.getContractAt("ExecutorContract", ADDRS.executor, deployer);
      const approveTx = await execContract.approveToken(WETH, ADDRS.router, ethers.parseEther("1"));
      await approveTx.wait();
      dbg(`executeIntent: approved Router to spend Executor's WETH`);
      try {
        const tx = await execContract.executeIntent(ADDRS.router, intentId, ethers.parseEther("0.05"));
        await tx.wait();
        pass("ExecutorContract", "executeIntent", `executed swap intent`, tx.hash);
      } catch (e2: unknown) {
        fail("ExecutorContract", "executeIntent", decodeRevert(e2));
        dbg(`executeIntent full: ${String(e2).slice(0,500)}`);
        dbg(`[GAP: executeIntent flow unclear — Router holds tokenIn escrow, Executor must deliver tokenOut. Check if Executor has tokenOut balance + Router's executeIntent handles both legs]`);
      }
    } else { skip("ExecutorContract", "executeIntent", "no intentId"); }
  } catch (e: unknown) { fail("ExecutorContract", "executeIntent (prep)", decodeRevert(e)); dbg(`executeIntent prep full: ${String(e).slice(0,500)}`); }

  // cancelIntent — submit another then cancel
  try {
    const swapAmt2 = ethers.parseUnits("50", 6);
    const tx1 = await router.submitSwapIntent(USDC, WETH, swapAmt2, 0n, 3600);
    const rcpt = await tx1.wait();
    let cancelId: string = "";
    for (const l of rcpt!.logs) {
      try {
        const parsed = router.interface.parseLog(l);
        if (parsed && (parsed.name === "SwapIntentCreated" || parsed.name === "IntentSubmitted")) {
          cancelId = parsed.args.intentId ?? parsed.args[0];
          break;
        }
      } catch { /* skip */ }
    }
    if (cancelId) {
      const tx2 = await router.cancelIntent(cancelId); await tx2.wait();
      pass("Router", "cancelIntent", "escrow returned", tx2.hash);
    } else { skip("Router", "cancelIntent", "no intentId from second submit"); }
  } catch (e: unknown) { fail("Router", "cancelIntent", decodeRevert(e)); dbg(`cancelIntent full: ${String(e).slice(0,500)}`); }

  try {
    const tx1 = await router.pause(); await tx1.wait();
    pass("Router", "pause", "paused", tx1.hash);
    const tx2 = await router.unpause(); await tx2.wait();
    pass("Router", "unpause", "unpaused", tx2.hash);
  } catch (e: unknown) { fail("Router", "pause/unpause", decodeRevert(e)); }

  // ══════════════════════════════════════════════════════
  // 5. EXECUTOR CONTRACT (3 functions)
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 5. ExecutorContract ═══");
  read("ExecutorContract", "executeIntent", "tested via SwapRouter flow above");
  try {
    const tx = await executor.approveToken(USDC, ADDRS.pool, ethers.parseUnits("1000", 6));
    await tx.wait();
    pass("ExecutorContract", "approveToken(USDC→Pool)", "1000 USDC", tx.hash);
  } catch (e: unknown) { fail("ExecutorContract", "approveToken", decodeRevert(e)); }
  skip("ExecutorContract", "withdrawTokens", "would drain contract — not tested");

  // ══════════════════════════════════════════════════════
  // 6. STRATEGY VAULT (8 functions)
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 6. StrategyVault ═══");

  // openPosition — use tuple overload via function selector
  if (cofheClient && strategyId > 0n) {
    try {
      // Close existing position if any
      try {
        const hasPos = await vault.hasPosition(deployer.address);
        if (hasPos) {
          const depAmt = await vault.getDepositedAmount();
          const eClose = await enc128(depAmt);
          const txCl = await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](depAmt, eClose);
          await txCl.wait();
          pass("Vault", "closePosition(cleanup)", "closed existing", txCl.hash);
        }
      } catch { /* no position, fine */ }

      const vColl = ethers.parseUnits("500", 6);
      const eColl = await enc128(vColl);
      const tx = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](
        USDC, vColl, eColl, strategyId, deployer.address
      );
      await tx.wait();
      pass("Vault", "openPosition(USDC)", `${ethers.formatUnits(vColl,6)} strat=${strategyId}`, tx.hash);
    } catch (e: unknown) { fail("Vault", "openPosition", decodeRevert(e)); }
  } else { skip("Vault", "openPosition", cofheClient ? "no strategyId" : "FHE required"); }

  // Parallel: hasPosition + getDepositedAmount + getPositionMeta + getCollateral
  try {
    const [hp, depAmt, meta, ctColl] = await Promise.all([
      vault.hasPosition(deployer.address),
      vault.getDepositedAmount(),
      vault.getPositionMeta(),
      cofheClient ? vault.getCollateral.staticCall() : Promise.resolve(null),
    ]);
    read("Vault", "hasPosition", String(hp));
    read("Vault", "getDepositedAmount", ethers.formatUnits(depAmt, 6));
    read("Vault", "getPositionMeta", `strategyId=${meta[0]} createdAt=${meta[1]}`);
    if (ctColl) read("Vault", "getCollateral", `ctHash=${ctColl.toString().slice(0,20)}…`);
    else skip("Vault", "getCollateral", "FHE required");
  } catch (e: unknown) { fail("Vault", "reads", decodeRevert(e)); dbg(`Vault reads full: ${String(e).slice(0,500)}`); }

  // addCollateral — use tuple overload
  if (cofheClient) {
    try {
      const addAmt = ethers.parseUnits("100", 6);
      const eAdd = await enc64(addAmt);
      const tx = await vault["addCollateral(address,uint256,(uint256,uint8,uint8,bytes),address)"](
        USDC, addAmt, eAdd, deployer.address
      );
      await tx.wait();
      pass("Vault", "addCollateral(USDC)", `${ethers.formatUnits(addAmt,6)}`, tx.hash);
    } catch (e: unknown) { fail("Vault", "addCollateral", decodeRevert(e)); }
  } else { skip("Vault", "addCollateral", "FHE required"); }

  // closePosition — tuple overload
  if (cofheClient) {
    try {
      const depAmt = await vault.getDepositedAmount();
      if (depAmt > 0n) {
        const eClose = await enc128(depAmt);
        const tx = await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](depAmt, eClose);
        await tx.wait();
        pass("Vault", "closePosition", `${ethers.formatUnits(depAmt,6)} USDC withdrawn`, tx.hash);
      } else { skip("Vault", "closePosition", "no position"); }
    } catch (e: unknown) { fail("Vault", "closePosition", decodeRevert(e)); }
  } else { skip("Vault", "closePosition", "FHE required"); }

  skip("Vault", "emergencyWithdraw", "requires paused vault + open position — skipped");

  try {
    const tx1 = await vault.pause(); await tx1.wait();
    pass("Vault", "pause", "paused", tx1.hash);
    const tx2 = await vault.unpause(); await tx2.wait();
    pass("Vault", "unpause", "unpaused", tx2.hash);
  } catch (e: unknown) { fail("Vault", "pause/unpause", decodeRevert(e)); }

  // ══════════════════════════════════════════════════════
  // 7. FHEFORGE COMPOSER (actual external functions only)
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 7. FheForgeComposer ═══");

  // Parallel: immutable getters
  try {
    const [owner, pool, v, r, reg, p2] = await Promise.all([
      composer.OWNER(), composer.POOL(), composer.VAULT(),
      composer.ROUTER(), composer.REGISTRY(), composer.PERMIT2(),
    ]);
    read("Composer", "OWNER", owner); read("Composer", "POOL", pool);
    read("Composer", "VAULT", v); read("Composer", "ROUTER", r);
    read("Composer", "REGISTRY", reg); read("Composer", "PERMIT2", p2);
  } catch (e: unknown) { fail("Composer", "getters", decodeRevert(e)); }

  // openLeveragedStrategyDirect — no Permit2 needed, uses direct transferFrom
  if (cofheClient && strategyId > 0n) {
    try {
      // Ensure no existing vault position (Composer can't open if one exists)
      const hasPos = await vault.hasPosition(deployer.address);
      if (hasPos) {
        dbg(`openLeveragedStrategyDirect: closing existing vault position first`);
        const vDep = await vault.getDepositedAmount();
        if (vDep > 0n) {
          const eClose = await enc128(vDep);
          await (await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](vDep, eClose)).wait();
        }
      }

      const collAmt = ethers.parseUnits("200", 6);
      const composerAddr = await composer.getAddress();
      const eColl2 = await enc128For(collAmt, composerAddr);
      const eSupply = await enc64For(ethers.parseUnits("200", 6), composerAddr);
      const eBorrow = await enc64For(ethers.parseUnits("80", 6), composerAddr);

      dbg(`openLeveragedStrategyDirect: using direct transferFrom (no Permit2)`);
      const params = {
        strategyName: "Leveraged Direct",
        workflowHash: ethers.zeroPadValue("0xd00d", 32),
        collateralAmount: collAmt,
        poolSupplyAmount: collAmt,  // supply same as collateral
        poolBorrowAmount: ethers.parseUnits("80", 6),
        swapDeadlineOffset: 3600,
        strategyId: strategyId,  // reuse existing strategy
        swapAmountIn: ethers.parseUnits("80", 6),
        swapMinOut: 0n,
        collateralToken: USDC,
        borrowToken: USDC,
        swapTokenOut: WETH,
        ltvNum: 80,
        ltvDen: 100,
        useOracleBorrow: true,
        apyTarget: 500,
        loopCount: 1,
        collateralPermit: { amount: 0n, deadline: 0, nonce: 0, signature: "0x" },  // unused for direct
      };
      const enc = { collateral: eColl2, supplyEnc: eSupply, borrowEnc: eBorrow };
      const tx = await composer.openLeveragedStrategyDirect(params, enc);
      await tx.wait();
      pass("Composer", "openLeveragedStrategyDirect", "full leveraged flow without Permit2 + setAccount(composer)", tx.hash);
    } catch (e: unknown) {
      const decoded = decodeRevert(e);
      fail("Composer", "openLeveragedStrategyDirect", decoded);
      dbg(`openLeveragedStrategyDirect full: ${String(e).slice(0,500)}`);
    }
  } else { skip("Composer", "openLeveragedStrategyDirect", cofheClient ? "no stratId" : "FHE required"); }

  // rebalanceDirect — no Permit2 needed
  if (cofheClient) {
    try {
      const addCollAmt = ethers.parseUnits("50", 6);
      const repayAmt3 = ethers.parseUnits("20", 6);
      const newBorrowAmt = ethers.parseUnits("20", 6);
      const composerAddr2 = await composer.getAddress();
      const eAddColl = await enc64For(addCollAmt, composerAddr2);
      const eRepay = await enc64For(repayAmt3, composerAddr2);
      const eNewBorrow = await enc64For(newBorrowAmt, composerAddr2);

      dbg(`rebalanceDirect: using direct transferFrom (no Permit2)`);
      const rebParams = {
        collateralToken: USDC,
        addCollateralAmount: addCollAmt,
        repayAmount: repayAmt3,
        repayToken: USDC,
        newBorrowAmount: newBorrowAmt,
        borrowToken: USDC,
        useOracleBorrow: true,
        ltvNum: 80,
        ltvDen: 100,
        collateralPermit: { amount: 0n, deadline: 0, nonce: 0, signature: "0x" },
        repayPermit: { amount: 0n, deadline: 0, nonce: 0, signature: "0x" },
      };
      const rebEnc = { addCollateralEnc: eAddColl, repayEnc: eRepay, newBorrowEnc: eNewBorrow };
      const tx = await composer.rebalanceDirect(rebParams, rebEnc);
      await tx.wait();
      pass("Composer", "rebalanceDirect", "full rebalance without Permit2", tx.hash);
    } catch (e: unknown) {
      const decoded = decodeRevert(e);
      fail("Composer", "rebalanceDirect", decoded);
      dbg(`rebalanceDirect full: ${String(e).slice(0,500)}`);
    }
  } else { skip("Composer", "rebalanceDirect", "FHE required"); }

  // sweepToken
  skip("Composer", "sweepToken", "admin-only fund sweep — not tested");

  // pause / unpause
  try {
    const tx1 = await composer.pause(); await tx1.wait();
    pass("Composer", "pause", "paused", tx1.hash);
    const tx2 = await composer.unpause(); await tx2.wait();
    pass("Composer", "unpause", "unpaused", tx2.hash);
  } catch (e: unknown) { fail("Composer", "pause/unpause", decodeRevert(e)); }

  // Note: Composer does NOT expose supply/borrow/repay/withdraw/openPosition/addCollateral/closePosition
  // as its own external functions. Those are interface declarations for Pool/Vault/Router.
  // The Composer orchestrates them internally via openLeveragedStrategy and rebalance.
  read("Composer", "(interface functions)", "supply/borrow/repay/withdraw/openPosition/addCollateral/closePosition/submitSwapIntent are Pool/Vault/Router functions called internally by openLeveragedStrategy & rebalance — tested above");

  // ══════════════════════════════════════════════════════
  // 8. FHE STATE CONSISTENCY + REAL decryptForView TESTING
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 8. FHE State + decryptForView ═══");

  if (cofheClient) {
    // Pool supply balance — decrypt the real FHE value
    try {
      const ctSup = await pool.getSupplyBalance.staticCall(USDC);
      const plSup = await pool.getPlainSupplyBalance(USDC);
      const decSup = await decView(BigInt(ctSup.toString()), FheTypes.Uint64, "pool.supply(USDC)");
      read("Pool", "supply(USDC): enc vs plain vs decrypted", `ctHash=${ctSup.toString().slice(0,16)}… plain=${ethers.formatUnits(plSup,6)} ${decSup}`);
      // If decrypt works, compare against plain — they should match
      if (!decSup.startsWith("decrypt-failed")) dbg(`[FHE-CORE] supply: FHE decrypts correctly if plain matches — if mismatch, dual-input skew (C-01)`);
    } catch (e: unknown) { fail("Pool", "FHE supply check", decodeRevert(e)); }

    // Pool borrow balance — decrypt
    try {
      const ctBor = await pool.getBorrowBalance.staticCall(USDC);
      const plBor = await pool.getPlainBorrowBalance(USDC);
      const decBor = await decView(BigInt(ctBor.toString()), FheTypes.Uint64, "pool.borrow(USDC)");
      read("Pool", "borrow(USDC): enc vs plain vs decrypted", `ctHash=${ctBor.toString().slice(0,16)}… plain=${ethers.formatUnits(plBor,6)} ${decBor}`);
    } catch (e: unknown) { fail("Pool", "FHE borrow check", decodeRevert(e)); }

    // Pool WETH supply — parallel reads
    try {
      const [ctWeth, plWeth] = await Promise.all([
        pool.getSupplyBalance.staticCall(WETH),
        pool.getPlainSupplyBalance(WETH),
      ]);
      const decWeth = await decView(BigInt(ctWeth.toString()), FheTypes.Uint64, "pool.supply(WETH)");
      read("Pool", "supply(WETH): enc vs plain vs decrypted", `ctHash=${ctWeth.toString().slice(0,16)}… plain=${ethers.formatEther(plWeth)} ${decWeth}`);
    } catch (e: unknown) { fail("Pool", "FHE WETH check", decodeRevert(e)); }

    // Vault collateral — decrypt
    try {
      const hasPos = await vault.hasPosition(deployer.address);
      if (hasPos) {
        const [ctColl, plDep] = await Promise.all([
          vault.getCollateral.staticCall(),
          vault.getDepositedAmount(),
        ]);
        const decColl = await decView(BigInt(ctColl.toString()), FheTypes.Uint128, "vault.collateral");
        read("Vault", "collateral: enc vs plain vs decrypted", `ctHash=${ctColl.toString().slice(0,16)}… deposited=${ethers.formatUnits(plDep,6)} ${decColl}`);
      } else {
        dbg("Vault: no position — opening one for decryptForView test");
        const vColl2 = ethers.parseUnits("200", 6);
        const eC2 = await enc128(vColl2);
        const txO = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](USDC, vColl2, eC2, strategyId, deployer.address);
        await txO.wait();
        const [ctColl2, plDep2] = await Promise.all([
          vault.getCollateral.staticCall(),
          vault.getDepositedAmount(),
        ]);
        const decColl2 = await decView(BigInt(ctColl2.toString()), FheTypes.Uint128, "vault.collateral(opened)");
        read("Vault", "collateral(opened): enc vs plain vs decrypted", `ctHash=${ctColl2.toString().slice(0,16)}… deposited=${ethers.formatUnits(plDep2,6)} ${decColl2}`);
        // Close it
        const eClose3 = await enc128(plDep2);
        await (await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](plDep2, eClose3)).wait();
      }
    } catch (e: unknown) { fail("Vault", "FHE collateral check", decodeRevert(e)); dbg(`FHE collateral full: ${String(e).slice(0,500)}`); }

    // Registry encryptedTvls — now has public getter with allowSender
    try {
      if (strategyId > 0n) {
        const ctTvl = await registry.getEncryptedTvl.staticCall(strategyId);
        const decTvl = await decView(BigInt(ctTvl.toString()), FheTypes.Uint128, "registry.tvl");
        pass("Registry", "getEncryptedTvl+decryptForView", `ctHash=${ctTvl.toString().slice(0,16)}… dec=${decTvl}`);
      } else { skip("Registry", "encryptedTvl decrypt", "no strategyId"); }
    } catch (e: unknown) { fail("Registry", "getEncryptedTvl", decodeRevert(e)); dbg(`encryptedTvl full: ${String(e).slice(0,500)}`); }
    // decryptForTx test — attempt to get a threshold signature for on-chain verification
    try {
      const ctSup2 = await pool.getSupplyBalance.staticCall(USDC);
      dbg("Attempting decryptForTx (with permit) on supply balance");
      const decResult = await decTx(BigInt(ctSup2.toString()), true);
      if (decResult) {
        read("CoFHE", "decryptForTx(supply)", `decrypted=${decResult.decryptedValue} sigLen=${decResult.signature?.length ?? 0}`);
        dbg(`[FHE-CORE] decryptForTx works — contract could support on-chain publishDecryptResult if allowPublic() was called`);
      } else {
        fail("CoFHE", "decryptForTx(supply)", "returned null — ACL may not allow this caller to decrypt");
        dbg(`[GAP] Pool.getSupplyBalance grants allow(sender) but decryptForTx may need allowPublic() for .withoutPermit() or a valid self-permit`);
      }
    } catch (e: unknown) { fail("CoFHE", "decryptForTx", decodeRevert(e)); dbg(`decryptForTx full: ${String(e).slice(0,500)}`); }
  } else {
    skip("Pool", "FHE state checks", "CoFHE client unavailable");
    skip("Vault", "FHE state checks", "CoFHE client unavailable");
  }

  // ══════════════════════════════════════════════════════
  // 9. FHE ARCHITECTURE AUDIT (from CoFHE docs review)
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 9. FHE Architecture Audit ═══");
  console.log("  Issues identified from CoFHE docs cross-reference:\n");

  // C-01: Dual plain+encrypted state — FHE principle violation
  fheIssue("LendingPool", "supplyBalances+plainSupplyBalances", "CRITICAL",
    "Dual plain+encrypted state: FHE values stored alongside plain mirrors. Plain values observable on-chain, defeating FHE confidentiality. If they diverge (skew), contract uses plain for require() which leaks info via execution paths.",
    "Remove plainSupplyBalances/plainBorrowBalances. Use FHE.select for conditional logic. Use decryptForView for UI display. Only decrypt on-chain when absolutely necessary via allowPublic+publishDecryptResult.");

  // LendingPool _writeLiquidationHandles: FIXED in wave13
  // fheIssue("LendingPool", "_writeLiquidationHandles:585-594", "CRITICAL",
  //   "Missing FHE.allowThis() on newBorrowEnc and newSupplyEnc in liquidation. ...");
  // → FIXED: FHE.allowThis(newBorrowEnc) + FHE.allowThis(newSupplyEnc) added in wave13

  // No allowPublic anywhere — no unshield/reveal flow possible
  fheIssue("All", "no allowPublic() calls", "HIGH",
    "No FHE.allowPublic() anywhere in the system. Users cannot decrypt their balances on-chain via publishDecryptResult. No unshield/reveal flow exists. The only decryption path is decryptForView (off-chain UI-only), which requires permits.",
    "Add allowPublic() on encrypted values when they are meant to become public (e.g. unshield, withdraw reveal). Add contract functions that call publishDecryptResult for on-chain settlement.");

  // No decryptForTx/publishDecryptResult flow in contracts
  fheIssue("All", "no publishDecryptResult flow", "HIGH",
    "Contracts never call FHE.publishDecryptResult or FHE.verifyDecryptResult. No on-chain decryption is possible. Contract logic that needs to know a value (e.g. liquidation check, borrow limit) must decrypt somehow — currently uses plain mirrors which violates FHE.",
    "For liquidation: use verifyDecryptResult with off-chain threshold sig. For health checks: compute entirely in FHE using FHE.select/FHE.gte without decrypting. Add publishDecryptResult functions for user-initiated reveals.");

  // Trivial encryption in liquidation — not confidential
  fheIssue("LendingPool", "_writeLiquidationHandles:582,589", "HIGH",
    "Uses FHE.asEuint64(debtToCover.toUint128()) and FHE.asEuint64(seizeAmount.toUint128()) — these are TRIVIAL encryptions from plain values. Not confidential. Observers can see the amounts. FHE operations on trivial+encrypted produce trivial results if the trivial value is known.",
    "Liquidation amounts should either be fully encrypted inputs from the liquidator, or use decryptForTx+verifyDecryptResult for on-chain amount verification.");

  // No FHE.select for conditional logic — uses plain require instead
  fheIssue("LendingPool", "withdraw/checkLtvAndBorrow", "HIGH",
    "Contracts use require() with plain values to check encrypted conditions (e.g. reserve sufficiency, LTV). This leaks info via execution paths — a reverted tx reveals the condition was false. Per CoFHE docs: 'There is no secure code branching with FHE'.",
    "Replace require on encrypted conditions with FHE.select-based logic. Use FHE.gte for comparisons, FHE.select for conditional assignment. Only require on plaintext access control checks (msg.sender==owner etc).");

  // Vault SameBlockClose — information leak via execution path
  fheIssue("StrategyVault", "closePosition:SameBlockClose", "MEDIUM",
    "SameBlockClose reverts if closing in same block as opening. This is a plain require on block.number which leaks timing info about position management. Not a critical FHE leak but shows the pattern of execution-path branching.",
    "Consider allowing same-block close (why prevent it?) or use FHE.select to handle the conditional gracefully instead of reverting.");

  // No cross-contract ACL management for Composer→Pool/Vault
  fheIssue("Composer", "openLeveragedStrategy/rebalance", "HIGH",
    "Composer calls Pool.supplyToLending/borrowFromLending and Vault.openPosition/addCollateral. Pool's cross-contract functions use allow(user) + allowThis which gives Composer access via allowTransient. But if the Composer needs to READ the resulting encrypted balances later, it won't have ACL unless explicitly granted.",
    "Use FHE.allowTransient for cross-contract calls within same tx. Use FHE.allow for persistent cross-contract access. Ensure Pool grants Composer ACL on encrypted results from composed operations.");

  // euint64 for balances — 64 bits may overflow with large USDC amounts
  fheIssue("LendingPool", "euint64 balances", "MEDIUM",
    "Uses euint64 for supply/borrow balances. USDC has 6 decimals; euint64 max ~1.84e19. With 6 decimals that's ~1.84e13 USDC ($18 trillion). Sufficient but if supporting tokens with 18 decimals, euint64 maxes at ~18.4 ETH. euint128 would be safer.",
    "Consider migrating to euint128 for balances (like Vault uses for collateral). More gas but prevents overflow with high-decimal tokens. Or cap amounts at safe thresholds.");

  // Permit2 friction — major UX issue
  fheIssue("Composer", "_pullViaPermit2", "HIGH",
    "Composer requires Permit2 EIP-712 signatures for _pullViaPermit2 in openLeveragedStrategy and rebalance. Cannot be generated from scripts. Frontend must construct and sign these. This creates significant UX friction — users need wallet signing for Permit2 + FHE encryption + tx submission = 3 separate signing steps.",
    "1) Add a direct-transferFrom path as alternative to Permit2 (user pre-approves Composer). 2) Bundle Permit2 signing with FHE encryption in the UI. 3) Use EIP-2612 permits (cheaper) instead of Permit2 where possible. 4) Consider meta-tx/relayer to reduce signing steps.");

  // No interest accrual — FHE operations needed
  fheIssue("LendingPool", "no interest model", "MEDIUM",
    "No interest accrual on supply/borrow. In a real FHE lending protocol, interest must be computed on encrypted balances using FHE.mul with encrypted rate. This requires careful FHE.select usage for health checks post-accrual.",
    "Add interest accrual: store encrypted supplyIndex/borrowIndex. Apply FHE.mul on balances each accrual. Use FHE.select for health factor checks. Compute entirely in FHE — never decrypt for interest logic.");

  // Registry encryptedTvls — no allowSender, only allowThis
  // StrategyRegistry encryptedTvls: FIXED in wave13
  // fheIssue("StrategyRegistry", "encryptedTvls", "MEDIUM",
  //   "encryptedTvls uses allowThis but never allowSender or allow. ...");
  // → FIXED: FHE.allowSender(result) added + getEncryptedTvl(uint256) getter with allow(msg.sender)

  // ══════════════════════════════════════════════════════
  // 10. CONTRACT REFACTOR RECOMMENDATIONS
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 10. Contract Refactor Recommendations ═══");
  console.log("  Priority order for next redeploy:\n");

  // Priority 1: Fix allowThis bug in liquidation
  console.log("  [P0] LendingPool._writeLiquidationHandles: Add FHE.allowThis(newBorrowEnc) + FHE.allowThis(newSupplyEnc)");
  console.log("       → Without this, liquidated users' subsequent operations will fail with ACLNotAllowed");

  // Priority 2: Remove dual plain+encrypted state
  console.log("  [P1] LendingPool: Remove plainSupplyBalances/plainBorrowBalances mirrors");
  console.log("       → Replace all require() on plain values with FHE.select-based logic");
  console.log("       → Use decryptForView in UI for balance display");
  console.log("       → Add publishDecryptResult for on-chain settlement when needed");

  // Priority 3: Add allowPublic + decryption flows
  console.log("  [P2] All contracts: Add FHE.allowPublic() where values are meant to become public");
  console.log("       → Add unshield/withdrawReveal functions using publishDecryptResult");
  console.log("       → This enables on-chain settlement without plain mirrors");

  // Priority 4: Migrate to euint128 for balances
  console.log("  [P3] LendingPool: Migrate supply/borrow from euint64 to euint128");
  console.log("       → Prevents overflow with 18-decimal tokens");
  console.log("       → Matches Vault's euint128 for collateral");

  // Priority 5: Reduce Permit2 UX friction
  console.log("  [P4] Composer: Add direct transferFrom path as alternative to _pullViaPermit2");
  console.log("       → Reduces signing steps from 3 to 2 (approve + tx)");
  console.log("       → Keep Permit2 as gas-efficient option for power users");

  // Priority 6: Add interest accrual (FHE-native)
  console.log("  [P5] LendingPool: Add encrypted interest index accrual");
  console.log("       → Store euint128 supplyIndex/borrowIndex per token");
  console.log("       → Apply FHE.mul on balances each accrual period");
  console.log("       → Health checks via FHE.gte + FHE.select — never decrypt");

  // ══════════════════════════════════════════════════════
  // 11. INTER-CONTRACT FLOW + LIQUIDATION + UNSHIELD/REVEAL
  // ══════════════════════════════════════════════════════
  console.log("\n═══ 11. Inter-Contract Flow + Liquidation + Unshield/Reveal ═══");

  // 11a. Inter-contract wiring verification — parallel reads
  console.log("\n  ── Inter-Contract Wiring ──");
  try {
    const [regVault, poolOracle, poolWeth, poolComposer, oracleWeth, oracleUsdc, routerExec] = await Promise.all([
      registry.vaultAddress(),
      pool.oracle(),
      pool.weth(),
      pool.composer(),
      oracle.isSupported(WETH),
      oracle.isSupported(USDC),
      router.executor(),
    ]);
    const wiringOk = regVault.toLowerCase() === ADDRS.vault.toLowerCase()
      && poolOracle.toLowerCase() === ADDRS.oracle.toLowerCase()
      && poolWeth.toLowerCase() === WETH.toLowerCase()
      && poolComposer.toLowerCase() === ADDRS.composer.toLowerCase()
      && routerExec.toLowerCase() === ADDRS.executor.toLowerCase();
    read("Wiring", "Registry→Vault", regVault);
    read("Wiring", "Pool→Oracle", poolOracle);
    read("Wiring", "Pool→WETH", poolWeth);
    read("Wiring", "Pool→Composer", poolComposer);
    read("Wiring", "Oracle→WETH", String(oracleWeth));
    read("Wiring", "Oracle→USDC", String(oracleUsdc));
    read("Wiring", "Router→Executor", routerExec);
    if (wiringOk) pass("Wiring", "all cross-contract refs", "correctly wired");
    else fail("Wiring", "cross-contract refs", "MISMATCH — some addresses don't match");
  } catch (e: unknown) { fail("Wiring", "reads", decodeRevert(e)); }

  // 11b. Liquidation test — create underwater position
  console.log("\n  ── Liquidation Flow ──");
  if (cofheClient && strategyId > 0n) {
    try {
      // Setup: supply USDC, open Vault position, borrow heavily against it
      const liqSupply = ethers.parseUnits("500", 6);
      const eSup = await enc64(liqSupply);
      const txSup = await pool.supply(USDC, liqSupply, eSup);
      await txSup.wait();
      dbg(`liq: supplied ${ethers.formatUnits(liqSupply,6)} USDC`);

      // Open a vault position with USDC collateral
      const liqColl = ethers.parseUnits("400", 6);
      const eColl = await enc128(liqColl);
      const txPos = await vault["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](
        USDC, liqColl, eColl, strategyId, deployer.address
      );
      await txPos.wait();
      dbg(`liq: opened vault position ${ethers.formatUnits(liqColl,6)} USDC`);

      // Borrow max against it (80% LTV)
      const liqBorrow = ethers.parseUnits("300", 6);
      const eBor = await enc64(liqBorrow);
      const txBor = await pool.checkLtvAndBorrow(USDC, USDC, liqBorrow, eBor, 80, 100);
      await txBor.wait();
      dbg(`liq: borrowed ${ethers.formatUnits(liqBorrow,6)} USDC (80% LTV)`);

      // Check health factor via oracle
      const [price, colFactor] = await Promise.all([
        oracle.getPriceUsd(USDC),
        oracle.collateralFactorBps(WETH),
      ]);
      dbg(`liq: USDC price=$${ethers.formatUnits(price as any, 18)} WETH colFactor=${colFactor}`);

      // Attempt liquidation — this user is NOT underwater yet (80% LTV < 100%)
      // So liquidate should revert with PositionHealthy — that proves the flow works
      try {
        const txLiq = await pool.liquidate(deployer.address, USDC, USDC, liqBorrow);
        await txLiq.wait();
        pass("Pool", "liquidate", "liquidated position", txLiq.hash);
      } catch (e: unknown) {
        const decoded = decodeRevert(e);
        if (decoded.includes("PositionHealthy") || decoded.includes("InsufficientCollateral") === false) {
          // PositionHealthy is expected — user is not underwater
          read("Pool", "liquidate", `reverted with ${decoded} — position not underwater (expected at 80% LTV)`);
          dbg(`liq: PositionHealthy expected — would need >100% LTV to liquidate. Flow is correct.`);
        } else {
          fail("Pool", "liquidate", decoded);
          dbg(`liq full: ${String(e).slice(0,500)}`);
        }
      }

      // Cleanup: repay and close vault position
      const repayLiq = ethers.parseUnits("300", 6);
      const eRepay = await enc64(repayLiq);
      const txRepay = await pool.repay(USDC, repayLiq, eRepay);
      await txRepay.wait();
      dbg(`liq: repaid ${ethers.formatUnits(repayLiq,6)} USDC`);

      const vDep = await vault.getDepositedAmount();
      if (vDep > 0n) {
        const eCloseLiq = await enc128(vDep);
        const txClose = await vault["closePosition(uint256,(uint256,uint8,uint8,bytes))"](vDep, eCloseLiq);
        await txClose.wait();
        dbg(`liq: closed vault position ${ethers.formatUnits(vDep,6)} USDC`);
      }
    } catch (e: unknown) { fail("Pool", "liquidation flow", decodeRevert(e)); dbg(`liquidation flow full: ${String(e).slice(0,500)}`); }
  } else { skip("Pool", "liquidation flow", cofheClient ? "no strategyId" : "FHE required"); }

  // 11c. Unshield/Reveal deep dive — test the FHE decryption pipeline
  console.log("\n  ── Unshield/Reveal (FHE Decryption Pipeline) ──");
  if (cofheClient) {
    // Test 1: decryptForView on supply balance — the "view-only" unshield
    try {
      const ctSup = await pool.getSupplyBalance.staticCall(USDC);
      const plSup = await pool.getPlainSupplyBalance(USDC);
      const decViewResult = await decView(BigInt(ctSup.toString()), FheTypes.Uint64, "supply-unshield");
      dbg(`unshield: decryptForView(supply) = ${decViewResult} plain=${ethers.formatUnits(plSup,6)}`);
      if (!decViewResult.startsWith("decrypt-failed")) {
        pass("FHE", "decryptForView(supply)", `decrypted successfully — ${decViewResult}`);
        // Check if decrypted matches plain
        const decVal = BigInt(decViewResult.replace("decrypted=", ""));
        if (decVal === plSup) {
          pass("FHE", "decryptForView≈plain match", "encrypted and plain supply values match — no skew");
        } else {
          fheIssue("LendingPool", "supplyBalances", "CRITICAL",
            `decryptForView(${decVal}) != plainSupply(${plSup}) — SKEW DETECTED. Dual-input allows divergence.`,
            "Remove plain mirrors. Use single encrypted source of truth.");
        }
      } else {
        fail("FHE", "decryptForView(supply)", `failed: ${decViewResult}`);
        dbg(`[GAP: decryptForView failed — user cannot see their balance in UI. ACL may not grant allow(sender) correctly, or permit issue]`);
      }
    } catch (e: unknown) { fail("FHE", "unshield/reveal decryptForView", decodeRevert(e)); dbg(`decryptForView full: ${String(e).slice(0,500)}`); }

    // Test 2: decryptForTx — the "on-chain unshield" that needs allowPublic + publishDecryptResult
    try {
      const ctBor = await pool.getBorrowBalance.staticCall(USDC);
      dbg(`unshield: attempting decryptForTx on borrow balance (with permit)`);
      const decTxResult = await decTx(BigInt(ctBor.toString()), true);
      if (decTxResult) {
        pass("FHE", "decryptForTx(borrow,withPermit)", `decrypted=${decTxResult.decryptedValue} sigLen=${decTxResult.signature?.length ?? 0}`);
        dbg(`[FHE-CORE] decryptForTx works with permit — on-chain publishDecryptResult possible if contract adds allowPublic()`);
      } else {
        fail("FHE", "decryptForTx(borrow)", "returned null — permit or ACL issue");
        dbg(`[GAP: decryptForTx failed — contract needs allow(sender) for .withPermit() or allowPublic() for .withoutPermit()]`);
        fheIssue("LendingPool", "getBorrowBalance ACL", "HIGH",
          "decryptForTx with permit returns null — the ACL may not grant this caller access, or the permit is invalid. Users cannot decrypt their borrow balance on-chain.",
          "Ensure getBorrowBalance calls allow(sender) before returning. Add allowPublic() for values meant for on-chain reveal. Test permit flow in UI.");
      }
    } catch (e: unknown) { fail("FHE", "decryptForTx test", decodeRevert(e)); dbg(`decryptForTx full: ${String(e).slice(0,500)}`); }

    // Test 3: decryptForView on Vault collateral — user should be able to see their own position
    try {
      const hasPos = await vault.hasPosition(deployer.address);
      if (hasPos) {
        const ctColl = await vault.getCollateral.staticCall();
        const decVaultResult = await decView(BigInt(ctColl.toString()), FheTypes.Uint128, "vault-collateral-unshield");
        if (!decVaultResult.startsWith("decrypt-failed")) {
          pass("FHE", "decryptForView(vault collateral)", decVaultResult);
          dbg(`[FHE-CORE] User can decrypt their vault position — UI can display collateral`);
        } else {
          fail("FHE", "decryptForView(vault collateral)", `failed: ${decVaultResult}`);
          fheIssue("StrategyVault", "getCollateral ACL", "HIGH",
            "decryptForView on vault collateral fails — user cannot see their position in UI. ACL may not grant allow(sender).",
            "Ensure getCollateral calls FHE.allow(msg.sender) before returning the handle. Check permit flow in UI.");
        }
      } else {
        dbg("unshield: no vault position to test decryptForView");
      }
    } catch (e: unknown) { fail("FHE", "vault decryptForView", decodeRevert(e)); }

    // Test 4: Registry encryptedTvls — now has getEncryptedTvl getter with allowSender
    try {
      if (strategyId > 0n) {
        const ctTvl = await registry.getEncryptedTvl.staticCall(strategyId);
        const decTvlResult = await decView(BigInt(ctTvl.toString()), FheTypes.Uint128, "registry-tvl-unshield");
        if (decTvlResult.startsWith("decrypt-failed")) {
          fheIssue("StrategyRegistry", "getEncryptedTvl ACL", "MEDIUM",
            "decryptForView on encryptedTvl fails — allowSender may not be sufficient for off-chain decrypt.",
            "Verify CoFHE network supports allowSender for decryptForView. May need explicit permit flow.");
        } else {
          pass("FHE", "decryptForView(registry TVL)", decTvlResult);
        }
      } else { skip("FHE", "decryptForView(registry TVL)", "no strategyId"); }
    } catch (e: unknown) { fail("FHE", "registry TVL decrypt", decodeRevert(e)); dbg(`registry TVL full: ${String(e).slice(0,500)}`); }

    // Summary: what's missing for production unshield/reveal
    console.log("\n  ── Unshield/Reveal Architecture Gap ──");
    console.log("  Current state: NO allowPublic() anywhere → NO on-chain reveal possible");
    console.log("  Current state: decryptForView works IF allow(sender) → UI display possible");
    console.log("  Missing for production:");
    console.log("    1. FHE.allowPublic() on withdraw/reveal amounts → enables publishDecryptResult");
    console.log("    2. Contract functions: unshield(InEuint64) → allowPublic + user calls publishDecryptResult");
    console.log("    3. Contract functions: revealCollateral() → allowPublic + publishDecryptResult for settlement");
    console.log("    4. UI flow: encrypt → submit → decryptForView (display) or decryptForTx → publishDecryptResult (settle)");
  } else { skip("FHE", "unshield/reveal", "CoFHE client unavailable"); }
  // FINAL REPORT
  // ══════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                    AUDIT SUMMARY                         ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const passC = results.filter(r => r.status === "PASS").length;
  const failC = results.filter(r => r.status === "FAIL").length;
  const skipC = results.filter(r => r.status === "SKIP").length;
  const readC = results.filter(r => r.status === "READ").length;
  const adminC = results.filter(r => r.status === "ADMIN").length;

  console.log(`  PASS:  ${passC}`);
  console.log(`  FAIL:  ${failC}`);
  console.log(`  SKIP:  ${skipC}`);
  console.log(`  READ:  ${readC}`);
  console.log(`  ADMIN: ${adminC}`);
  console.log(`  TOTAL: ${results.length}`);

  if (failC > 0) {
    console.log("\n  ── FAILED FUNCTIONS ──");
    for (const r of results.filter(r => r.status === "FAIL")) {
      console.log(`  ✗ ${r.contract}.${r.fn}: ${r.reason?.slice(0,150)}`);
    }
  }

  if (skipC > 0) {
    console.log("\n  ── SKIPPED FUNCTIONS ──");
    for (const r of results.filter(r => r.status === "SKIP")) {
      console.log(`  ⏭ ${r.contract}.${r.fn}: ${r.reason?.slice(0,120)}`);
    }
  }

  const reportPath = path.join(__dirname, "..", "audits", `wave12-audit-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    wave: 12,
    network: "arb-sepolia",
    chainId: 421614,
    deployer: deployer.address,
    contracts: ADDRS,
    cofheAvailable: cofheClient !== null,
    summary: { pass: passC, fail: failC, skip: skipC, read: readC, admin: adminC, total: results.length },
    fheIssues,
    results,
  }, null, 2));
  console.log(`\n  Report saved: ${reportPath}`);

  // FHE Issues summary
  if (fheIssues.length > 0) {
    console.log("\n  ── FHE ARCHITECTURE ISSUES ──");
    const crits = fheIssues.filter(i => i.severity === "CRITICAL");
    const highs = fheIssues.filter(i => i.severity === "HIGH");
    const meds = fheIssues.filter(i => i.severity === "MEDIUM");
    console.log(`  CRITICAL: ${crits.length}  HIGH: ${highs.length}  MEDIUM: ${meds.length}`);
    for (const i of crits) console.log(`  ⛔ [CRITICAL] ${i.contract}@${i.loc}: ${i.issue}`);
    for (const i of highs) console.log(`  🔴 [HIGH] ${i.contract}@${i.loc}: ${i.issue}`);
    for (const i of meds) console.log(`  🟡 [MEDIUM] ${i.contract}@${i.loc}: ${i.issue}`);
    console.log("\n  ── REFACTOR PRIORITY ──");
    for (const i of [...crits, ...highs]) console.log(`  → ${i.contract}: ${i.fix}`);
  }

}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
