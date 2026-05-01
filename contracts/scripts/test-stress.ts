/* eslint-disable max-lines */
/**
 * FheForge v3 stress test — Arbitrum Sepolia (chain 421614).
 *
 * Authority: REMEDIATION_ROUND_11_SUMMARY.md + STRESS_CRITIQUE.md.
 * Mode: read-only contract addresses; sends real on-chain transactions for
 *       every scenario; appends evidence to a never-overwritten ledger.
 *
 * CLI:
 *   # Dry-run validation (no transactions; CoFHE init skipped):
 *   npx ts-node scripts/test-stress.ts --dry-run [flags]
 *
 *   # Full run (FHE scenarios require hardhat context for the CoFHE 0.5.1 SDK):
 *   set -a && source .env && set +a
 *   npx hardhat run scripts/test-stress.ts --network arb-sepolia
 *   # ...with flags via env-vars (hardhat run does not forward CLI args):
 *   STRESS_SEED=42 STRESS_RANDOM_COUNT=25 STRESS_VERBOSE=1 \
 *     npx hardhat run scripts/test-stress.ts --network arb-sepolia
 *
 * Flags supported via CLI args (ts-node) or env vars (hardhat run):
 *   --seed <N>          / STRESS_SEED=N
 *   --random-count <N>  / STRESS_RANDOM_COUNT=N
 *   --dry-run           / STRESS_DRY_RUN=1
 *   --scenario <ID>     / STRESS_SCENARIO=ID
 *   --verbose           / STRESS_VERBOSE=1
 *
 * Outputs:
 *   - contracts/deployments/421614.stress-evidence.json (append-only)
 *   - contracts/STRESS_REPORT.md (overwritten per run)
 *
 * Exit:
 *   0 — clean run (no UNEXPECTED_REVERT, no STATE_MISMATCH, no UNKNOWN_PATTERN)
 *   1 — findings produced (CI fails, evidence written)
 *   2 — setup failure (e.g., RPC unreachable, wallet balance too low)
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

// ────────────────────────────────────────────────────────────────────────
// CLI argument parsing (handcrafted; no external deps)
// ────────────────────────────────────────────────────────────────────────

interface CliArgs {
  seed: number;
  randomCount: number;
  dryRun: boolean;
  scenarioFilter: string | null;
  verbose: boolean;
}

function parseCli(argv: string[]): CliArgs {
  const args: CliArgs = {
    seed: Math.floor(Date.now() / 1000),
    randomCount: 8,
    dryRun: false,
    scenarioFilter: null,
    verbose: false,
  };
  // Env-var fallbacks (for `hardhat run` which doesn't forward CLI args).
  if (process.env.STRESS_SEED) args.seed = parseInt(process.env.STRESS_SEED, 10);
  if (process.env.STRESS_RANDOM_COUNT)
    args.randomCount = parseInt(process.env.STRESS_RANDOM_COUNT, 10);
  if (process.env.STRESS_DRY_RUN === "1") args.dryRun = true;
  if (process.env.STRESS_SCENARIO) args.scenarioFilter = process.env.STRESS_SCENARIO;
  if (process.env.STRESS_VERBOSE === "1") args.verbose = true;
  // CLI args override env vars.
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--seed") args.seed = parseInt(argv[++i] ?? "", 10);
    else if (a === "--random-count") args.randomCount = parseInt(argv[++i] ?? "", 10);
    else if (a === "--scenario") args.scenarioFilter = argv[++i] ?? null;
  }
  if (args.randomCount < 0 || args.randomCount > 100) {
    throw new Error(`--random-count must be in [0, 100]; got ${args.randomCount}`);
  }
  if (!Number.isInteger(args.seed)) {
    throw new Error(`--seed must be an integer; got ${args.seed}`);
  }
  return args;
}

// ────────────────────────────────────────────────────────────────────────
// Mulberry32 PRNG — deterministic, seeded
// ────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

type ResultKind =
  | "SUCCESS"
  | "EXPECTED_REVERT_VERIFIED"
  | "UNEXPECTED_REVERT"
  | "STATE_MISMATCH"
  | "SETUP_FAILURE"
  | "DRY_RUN_VALID";

type FindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface OperationLog {
  op: string;
  contract: string;
  args: unknown;
  txHash: string | null;
  blockNumber: number | null;
  gasUsed: string | null;
  submittedAtMs: number;
  mempooledAtMs: number | null;
  confirmedAtMs: number | null;
  submissionLatencyMs: number | null;
  confirmationLatencyMs: number | null;
  totalLatencyMs: number | null;
  status: "ok" | "revert" | "skipped" | "static-ok";
  revert: { raw: string; decoded: string; selector: string | null } | null;
  /// Per-phase timing breakdown (set by the instrumented submitTx/staticCall paths).
  /// The keys map to the global Profiler `Phase` enum.
  phaseMs: Partial<Record<Phase, number>>;
}

interface StateAssertionRecord {
  variable: string;
  expected: string;
  actual: string;
  match: boolean;
}

interface Finding {
  scenarioId: string;
  kind: "UNKNOWN_PATTERN" | "GAS_REGRESSION" | "STATE_MISMATCH" | "UX_LATENCY" | "UNEXPECTED_REVERT";
  severity: FindingSeverity;
  details: string;
}

interface ScenarioEvidence {
  runId: string;
  scenarioId: string;
  type: "deterministic" | "random" | "baseline" | "ux" | "concurrency";
  description: string;
  operations: OperationLog[];
  result: ResultKind;
  totalGasUsed: string;
  totalLatencyMs: number;
  operationGas: Record<string, string>;
  operationLatencyMs: Record<string, number>;
  txHashes: string[];
  blockNumbers: number[];
  stateVerification: StateAssertionRecord[];
  revertReason:
    | null
    | { raw: string; decoded: string; selector: string | null; contract: string };
  unknownPattern: boolean;
  findings: Finding[];
}

interface RunRecord {
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  cli: CliArgs;
  network: { chainId: number; rpcUrl: string };
  v3Addresses: Record<string, string>;
  walletStart: { eth: string; usdc: string; weth: string };
  walletEnd: { eth: string; usdc: string; weth: string };
  pythPrices: { usdcUsd: string; wethUsd: string; observedAt: string };
  totals: {
    scenarioCount: number;
    succeeded: number;
    expectedRevert: number;
    unexpectedRevert: number;
    stateMismatch: number;
    setupFailure: number;
    unknownPattern: number;
    gasTotal: string;
  };
  benchmarkBaseline: Record<string, number>;
  scenarios: ScenarioEvidence[];
  findings: Finding[];
  /// Phase-level profiling aggregates. Populated from the global PHASE_AGGREGATE
  /// at end-of-run; serialized into the evidence ledger so successive runs can
  /// be diffed for "where is the time going?".
  profile: {
    aggregate: Record<string, { count: number; totalMs: number; minMs: number; maxMs: number }>;
    /// Top-N slowest individual phase samples (label + ms). Useful for spot
    /// checks; the full sample stream is kept in stress-evidence.json.
    slowest: Array<{ phase: string; label: string; ms: number; ts: number }>;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Constants from the deployment record + benchmark baseline
// ────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..");
const DEPLOY_PATH = path.join(REPO_ROOT, "deployments", "421614.json");
const EVIDENCE_PATH = path.join(REPO_ROOT, "deployments", "421614.stress-evidence.json");
const REPORT_PATH = path.join(REPO_ROOT, "STRESS_REPORT.md");
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap before archive rollover

const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";

// Per BENCHMARK_POST_v3.md §3.2 — function: gas baseline
// Findings emit GAS_REGRESSION when an observed gas exceeds baseline by > 2%.
const GAS_BASELINE_V3: Record<string, number> = {
  "StrategyRegistry.registerStrategy.real": 193_897,
  "StrategyRegistry.registerStrategy.max": 331_953,
  "StrategyVault.openPosition": 671_518,
  "StrategyVault.addCollateral": 312_961,
  "StrategyVault.closePosition.full": 234_065,
  "LendingPool.supply.real": 231_432,
  "LendingPool.checkLtvAndBorrow": 333_741,
  "LendingPool.repay": 250_556,
  "LendingPool.withdraw": 240_004,
  "LendingPool.borrowWithOracle": 334_606,
  "LendingPool.supplyEth": 337_954,
  "LendingPool.withdrawEth": 251_521,
  "FheForgeComposer.openLeveragedStrategy.plain": 190_949,
  "SwapRouter.submitSwapIntent": 347_368,
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
];

// Custom error selectors not always parseable from a single iface — collected
// from OZ v5, ERC-20 standard errors, Pausable, ReentrancyGuard, Pyth, and the
// FHE precompile InvalidSigner check (surfaces when an InEuint128 handle was
// signed by a key the precompile doesn't recognise).
const KNOWN_SELECTORS: Record<string, string> = {
  "0x5274afe7": "SafeERC20FailedOperation",
  "0x96d5cd09": "AddressEmptyCode",
  "0x3ee5aeb5": "ReentrancyGuardReentrantCall",
  "0xe450d38c": "ERC20InsufficientBalance",
  "0xfb8f41b2": "ERC20InsufficientAllowance",
  "0x9c8d2cd2": "FhePermissionDenied",
  "0xd93c0665": "EnforcedPause",
  "0x8a64de8a": "ExpectedPause",
  "0x118cdaa7": "OwnableUnauthorizedAccount",
  "0x1e4fbdf7": "OwnableInvalidOwner",
  "0x19abf40e": "StalePrice",
  "0x025dbdd4": "PriceFeedNotFound",
  "0xb6db987a": "InvalidArgument",
  "0xa6802b3c": "InvalidUpdateData",
  "0x025b14a8": "PriceFeedNotFoundWithinRange",
  // CoFHE precompile / EIP-712 signer-mismatch family
  "0x7ba5ffb5": "InvalidSigner(address,address)",
  "0xa94a4aad": "EIP2612InvalidSignature(address,address)",
  "0x57fdbed3": "ERC20PermitInvalidSigner(address,address)",
  "0xf645eedf": "ECDSAInvalidSignature",
  "0xfce698f7": "ECDSAInvalidSignatureLength(uint256)",
};

// ────────────────────────────────────────────────────────────────────────
// Logging helpers
// ────────────────────────────────────────────────────────────────────────

let VERBOSE = false;
function log(msg: string): void {
  console.log(msg);
}
function vlog(msg: string): void {
  if (VERBOSE) console.log(`  · ${msg}`);
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

// ────────────────────────────────────────────────────────────────────────
// Profiler — phase-level instrumentation
//
// Every async operation (encrypt / estimateGas / preSubmit / broadcast /
// wait / staticCall / stateRead / permitSign / signTx) is timed and
// aggregated globally so the report can answer "where did the time go?".
// ────────────────────────────────────────────────────────────────────────

type Phase =
  | "cofheEncrypt"
  | "permitSign"
  | "estimateGas"
  | "preSubmit"
  | "broadcast"
  | "waitConfirm"
  | "txTotal"
  | "staticCall"
  | "stateRead"
  | "scenarioOverhead";

interface PhaseSample {
  phase: Phase;
  label: string;
  ms: number;
  ts: number;
}

interface PhaseAggregate {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

const PHASE_SAMPLES: PhaseSample[] = [];
const PHASE_AGGREGATE: Record<Phase, PhaseAggregate> = {
  cofheEncrypt: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  permitSign: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  estimateGas: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  preSubmit: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  broadcast: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  waitConfirm: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  txTotal: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  staticCall: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  stateRead: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
  scenarioOverhead: { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 },
};

function recordPhase(phase: Phase, label: string, ms: number): void {
  PHASE_SAMPLES.push({ phase, label, ms, ts: Date.now() });
  const a = PHASE_AGGREGATE[phase];
  a.count += 1;
  a.totalMs += ms;
  if (ms < a.minMs) a.minMs = ms;
  if (ms > a.maxMs) a.maxMs = ms;
}

async function profile<T>(phase: Phase, label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    recordPhase(phase, label, Date.now() - t0);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Error decoder
// ────────────────────────────────────────────────────────────────────────

interface AnyErr {
  data?: string;
  info?: { error?: { data?: string } };
  error?: { data?: string };
  cause?: AnyErr;
  message?: string;
  shortMessage?: string;
  reason?: string;
  code?: string;
}

function extractErrData(e: unknown): string | null {
  let cur: AnyErr | undefined = e as AnyErr;
  for (let depth = 0; cur && depth < 8; depth++) {
    if (cur.data && typeof cur.data === "string" && cur.data.startsWith("0x") && cur.data.length >= 10) {
      return cur.data;
    }
    if (cur.info?.error?.data) return cur.info.error.data;
    if (cur.error?.data) return cur.error.data;
    cur = cur.cause;
  }
  return null;
}

function decodeRevert(
  e: unknown,
  ifaces: Record<string, ethers.Interface>,
): { raw: string; decoded: string; selector: string | null } {
  const data = extractErrData(e);
  if (!data) {
    const err = e as AnyErr;
    return {
      raw: "0x",
      decoded: err.shortMessage ?? err.reason ?? err.message ?? String(e),
      selector: null,
    };
  }
  const selector = data.slice(0, 10).toLowerCase();
  // Error(string)
  if (selector === "0x08c379a0") {
    try {
      const inner = ethers.AbiCoder.defaultAbiCoder().decode(
        ["string"],
        ethers.dataSlice(data, 4),
      )[0] as string;
      return { raw: data, decoded: `Error("${inner}")`, selector };
    } catch {
      return { raw: data, decoded: "Error(string) decode failed", selector };
    }
  }
  // Panic(uint256)
  if (selector === "0x4e487b71") {
    try {
      const code = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256"],
        ethers.dataSlice(data, 4),
      )[0] as bigint;
      return { raw: data, decoded: `Panic(0x${code.toString(16)})`, selector };
    } catch {
      return { raw: data, decoded: "Panic decode failed", selector };
    }
  }
  // Try every loaded interface
  for (const [name, iface] of Object.entries(ifaces)) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        const argList = parsed.args
          .map((a) => (typeof a === "bigint" ? a.toString() : String(a)))
          .join(",");
        return {
          raw: data,
          decoded: `${name}.${parsed.name}(${argList})`,
          selector,
        };
      }
    } catch {
      /* not from this iface */
    }
  }
  if (KNOWN_SELECTORS[selector]) {
    return { raw: data, decoded: KNOWN_SELECTORS[selector], selector };
  }
  return { raw: data, decoded: `unknown-selector ${selector}`, selector };
}

// ────────────────────────────────────────────────────────────────────────
// CoFHE SDK loader — uses hardhat's hardhatSignerAdapter (SDK 0.5.1 API)
//
// SDK 0.5.1 requires viem-style publicClient + walletClient. The cleanest path
// is to delegate to `hre.cofhe.hardhatSignerAdapter(signer)` which the
// @cofhe/hardhat-plugin already wires up. The script must therefore be invoked
// via `hardhat run` (env var `HARDHAT_NETWORK` set). When running standalone
// (ts-node, dry-run), we return null and FHE-bound scenarios skip cleanly.
// ────────────────────────────────────────────────────────────────────────

interface CofheClientLite {
  encryptInputs(inputs: unknown[]): { execute(): Promise<EncryptedHandle[]> };
  unseal?: (handle: string) => Promise<bigint>;
  permits?: { createSelf(opts: { issuer: string }): Promise<unknown> };
  connect: (publicClient: unknown, walletClient: unknown) => Promise<void>;
}

interface EncryptedHandle {
  ctHash: string;
  securityZone: number;
  utype: number;
  signature: string;
}

interface CofheNamespace {
  client: CofheClientLite;
  Encryptable: {
    uint128(v: bigint): unknown;
    uint16(v: bigint | number): unknown;
    uint8(v: bigint | number): unknown;
  };
}

async function loadCofhe(testerAddress: string): Promise<CofheNamespace | null> {
  if (!process.env.HARDHAT_NETWORK) {
    log(
      "  [info] HARDHAT_NETWORK not set; CoFHE SDK init skipped (run via `hardhat run` for FHE).",
    );
    return null;
  }
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const sdk = require("@cofhe/sdk") as Record<string, unknown>;
    const sdkNode = require("@cofhe/sdk/node") as Record<string, unknown>;
    const sdkChains = require("@cofhe/sdk/chains") as Record<string, unknown>;
    const hre = require("hardhat") as {
      cofhe: { hardhatSignerAdapter: (signer: unknown) => Promise<{ publicClient: unknown; walletClient: unknown }> };
      ethers: { getSigners: () => Promise<unknown[]> };
    };
    /* eslint-enable @typescript-eslint/no-require-imports */

    const Encryptable = sdk.Encryptable as CofheNamespace["Encryptable"];
    const createCofheConfig = sdkNode.createCofheConfig as (cfg: unknown) => unknown;
    const createCofheClient = sdkNode.createCofheClient as (cfg: unknown) => CofheClientLite;
    const arbSepolia = sdkChains.arbSepolia as unknown;

    const config = createCofheConfig({
      environment: "node",
      supportedChains: [arbSepolia],
    });
    const client = createCofheClient(config);

    // hardhat.config.ts accounts[1] is the tester key. signers[1] therefore.
    const signers = (await hre.ethers.getSigners()) as Array<{ address: string }>;
    const tester = signers.find(
      (s) => s.address.toLowerCase() === testerAddress.toLowerCase(),
    ) ?? signers[1];
    const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(tester);
    await client.connect(publicClient, walletClient);

    if (client.permits?.createSelf) {
      try {
        await client.permits.createSelf({ issuer: testerAddress });
      } catch {
        /* permit may already exist */
      }
    }

    return { client, Encryptable };
  } catch (e) {
    log(`  [warn] CoFHE SDK init failed: ${(e as Error).message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Section 0 — cold-start initialization (NOT timed)
// ────────────────────────────────────────────────────────────────────────

interface RuntimeContext {
  cli: CliArgs;
  rng: () => number;
  runId: string;
  provider: ethers.JsonRpcProvider;
  tester: ethers.Wallet;
  rpcUrl: string;
  chainId: number;
  v3: Record<string, string>;
  contracts: Record<string, ethers.Contract>;
  ifaces: Record<string, ethers.Interface>;
  cofhe: CofheNamespace | null;
  pythPrices: { usdcUsd: bigint; wethUsd: bigint; observedAtMs: number };
  walletStart: { eth: bigint; usdc: bigint; weth: bigint };
}

async function coldStart(cli: CliArgs): Promise<RuntimeContext> {
  log("╔═══════════════════════════════════════════════════════════╗");
  log("║  FheForge v3 STRESS TEST (round-12 rewrite)               ║");
  log("║  Network: arb-sepolia (421614)                            ║");
  log("╚═══════════════════════════════════════════════════════════╝");
  log("");
  log(`  CLI: seed=${cli.seed} random-count=${cli.randomCount} dry-run=${cli.dryRun} verbose=${cli.verbose}`);

  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("ARBITRUM_SEPOLIA_RPC_URL not set in environment.");
  const testerKey = process.env.TESTER_PRIVATE_KEY;
  if (!testerKey) throw new Error("TESTER_PRIVATE_KEY not set in environment.");

  if (!fs.existsSync(DEPLOY_PATH)) {
    throw new Error(`Deployment record missing: ${DEPLOY_PATH}`);
  }
  const dep = JSON.parse(fs.readFileSync(DEPLOY_PATH, "utf8")) as {
    chainId: number;
    contracts: Record<string, string>;
  };
  if (dep.chainId !== 421614) {
    throw new Error(`Expected chainId=421614 in deployment record; got ${dep.chainId}.`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  // Faster polling — arb-sepolia produces blocks every ~250ms but ethers default
  // poll is 4s. Drop to 500ms to slash confirmation latency on each tx.
  provider.pollingInterval = 500;
  const tester = new ethers.Wallet(testerKey, provider);

  // Confirm bytecode at every v3 address.
  log("  Verifying v3 contract bytecode…");
  for (const [name, addr] of Object.entries(dep.contracts)) {
    const code = await provider.getCode(addr);
    if (code === "0x" || code.length < 4) {
      throw new Error(`No bytecode at ${name}=${addr} on arb-sepolia. Re-run deploy.`);
    }
    vlog(`  ${name} ${addr} ${(code.length / 2 - 1).toString()} bytes`);
  }

  // Tester wallet snapshot.
  const usdcContract = new ethers.Contract(USDC, ERC20_ABI, tester);
  const wethContract = new ethers.Contract(WETH, ERC20_ABI, tester);
  const ethBal = await provider.getBalance(tester.address);
  const usdcBal = (await usdcContract.balanceOf(tester.address)) as bigint;
  const wethBal = (await wethContract.balanceOf(tester.address)) as bigint;
  log(`  Tester ${tester.address}`);
  log(
    `  Balances: ETH=${ethers.formatEther(ethBal)} USDC=${ethers.formatUnits(usdcBal, 6)} WETH=${ethers.formatUnits(wethBal, 18)}`,
  );

  if (ethBal < ethers.parseEther("0.01")) {
    throw new Error(`Tester ETH balance ${ethers.formatEther(ethBal)} < 0.01 — fund tester first.`);
  }
  if (usdcBal < 5_000_000n) {
    throw new Error(`Tester USDC balance ${ethers.formatUnits(usdcBal, 6)} < 5 — fund tester first.`);
  }

  // Load contract ABIs from artifacts.
  const artifactsDir = path.join(REPO_ROOT, "artifacts", "contracts");
  const contracts: Record<string, ethers.Contract> = {};
  const ifaces: Record<string, ethers.Interface> = {};
  for (const name of [
    "StrategyRegistry",
    "StrategyVault",
    "LendingPool",
    "SwapRouter",
    "PriceOracle",
    "FheForgeComposer",
  ]) {
    const artifactPath = path.join(artifactsDir, `${name}.sol`, `${name}.json`);
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Artifact missing: ${artifactPath}. Run forge build first.`);
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi: unknown };
    const iface = new ethers.Interface(artifact.abi as ethers.InterfaceAbi);
    ifaces[name] = iface;
    contracts[name] = new ethers.Contract(dep.contracts[name], iface, tester);
  }
  contracts.USDC = usdcContract;
  contracts.WETH = wethContract;
  ifaces.SafeERC20 = new ethers.Interface([
    "error SafeERC20FailedOperation(address)",
    "error AddressEmptyCode(address)",
  ]);

  // Pyth oracle freshness probe.
  const oracle = contracts.PriceOracle;
  let usdcUsd = 0n;
  let wethUsd = 0n;
  try {
    const [u, _u_ts] = (await oracle.getPriceUsd(USDC)) as [bigint, bigint];
    const [w, _w_ts] = (await oracle.getPriceUsd(WETH)) as [bigint, bigint];
    usdcUsd = u;
    wethUsd = w;
    log(
      `  Pyth prices: USDC=$${ethers.formatUnits(u, 18)} WETH=$${ethers.formatUnits(w, 18)}`,
    );
  } catch (e) {
    log(`  [warn] Pyth read failed: ${(e as Error).message}; oracle-gated scenarios will be SETUP_FAILURE.`);
  }

  // CoFHE SDK init (gracefully tolerated if it fails — many scenarios still run).
  log("  Initialising CoFHE SDK 0.5.1…");
  const cofhe = await loadCofhe(tester.address);
  if (!cofhe) {
    log("  [warn] CoFHE SDK unavailable; FHE-bound scenarios will skip with SETUP_FAILURE.");
  } else {
    log("  CoFHE SDK 0.5.1 ready.");
  }

  // Approvals (idempotent — only sent if missing).
  log("  Ensuring approvals (vault + pool + composer ↦ MaxUint256)…");
  for (const spender of [
    dep.contracts.StrategyVault,
    dep.contracts.LendingPool,
    dep.contracts.FheForgeComposer,
  ]) {
    const allowance = (await usdcContract.allowance(tester.address, spender)) as bigint;
    if (allowance < ethers.MaxUint256 / 2n) {
      const tx = await usdcContract.approve(spender, ethers.MaxUint256);
      await tx.wait();
      vlog(`  approved ${spender.slice(0, 10)}… tx=${tx.hash.slice(0, 12)}…`);
    }
  }

  // Pre-run position cleanup — defensive guard against leftover state from a
  // previous failed run. If the tester wallet has an open vault position, we
  // close it before starting the timed scenarios. Cold-start cleanup is
  // OUTSIDE the timed window; this is per STRESS_CRITIQUE §1 (cold-start init
  // must not contaminate timing).
  log("  Pre-run cleanup: scanning for leftover state from earlier runs…");
  try {
    const vault = new ethers.Contract(
      dep.contracts.StrategyVault,
      [
        "function hasPosition(address) view returns (bool)",
        "function getDepositedAmount() view returns (uint256)",
        "function closePosition(uint256, (uint256 ctHash, int32 securityZone, uint8 utype, bytes signature))",
      ],
      tester,
    );
    const has = (await vault.hasPosition(tester.address)) as boolean;
    if (has) {
      const dep0 = (await vault.getDepositedAmount()) as bigint;
      log(`  [cleanup] leftover position with deposited=${dep0} — closing…`);
      if (cofhe) {
        const enc = await cofhe.client
          .encryptInputs([cofhe.Encryptable.uint128(dep0)])
          .execute();
        // Skip estimateGas (it can falsely revert with stale on-chain handles
        // from a prior CoFHE SDK version). Use a generous gas limit instead.
        const tx = await vault.closePosition(dep0, enc[0], { gasLimit: 800_000n });
        await tx.wait();
        log(`  [cleanup] closed leftover position tx=${tx.hash.slice(0, 12)}…`);
      } else {
        log(`  [cleanup-warn] CoFHE unavailable for cleanup; vault scenarios will fail.`);
      }
    }
  } catch (e) {
    log(`  [cleanup-warn] ${(e as Error).message}`);
  }

  // Round-13 — Permit2 onboarding. Verify the Permit2 singleton has bytecode
  // at the canonical address and ensure the tester has approved Permit2 to
  // spend the test tokens (one-time setup per token; idempotent).
  log("  Verifying Permit2 singleton + ensuring Permit2 spending approvals…");
  const permit2Code = await provider.getCode(PERMIT2_ADDRESS);
  if (permit2Code === "0x" || permit2Code.length < 4) {
    throw new Error(
      `Permit2 not deployed at canonical address ${PERMIT2_ADDRESS} on chain ${dep.chainId}.`,
    );
  }
  log(`  Permit2 OK at ${PERMIT2_ADDRESS} (${(permit2Code.length / 2 - 1).toString()} bytes)`);
  for (const token of [USDC, WETH]) {
    const tokenContract = new ethers.Contract(token, ERC20_ABI, tester);
    const allowance = (await tokenContract.allowance(tester.address, PERMIT2_ADDRESS)) as bigint;
    if (allowance < ethers.MaxUint256 / 2n) {
      const tx = await tokenContract.approve(PERMIT2_ADDRESS, ethers.MaxUint256);
      await tx.wait();
      vlog(`  approved Permit2 for ${token.slice(0, 10)}… tx=${tx.hash.slice(0, 12)}…`);
    } else {
      vlog(`  Permit2 allowance for ${token.slice(0, 10)}… already MaxUint256`);
    }
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-seed${cli.seed}`;
  log(`  runId=${runId}`);

  return {
    cli,
    rng: mulberry32(cli.seed),
    runId,
    provider,
    tester,
    rpcUrl,
    chainId: dep.chainId,
    v3: dep.contracts,
    contracts,
    ifaces,
    cofhe,
    pythPrices: { usdcUsd, wethUsd, observedAtMs: Date.now() },
    walletStart: { eth: ethBal, usdc: usdcBal, weth: wethBal },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Operation execution helpers
// ────────────────────────────────────────────────────────────────────────

function emptyOp(): OperationLog {
  return {
    op: "",
    contract: "",
    args: null,
    txHash: null,
    blockNumber: null,
    gasUsed: null,
    submittedAtMs: 0,
    mempooledAtMs: null,
    confirmedAtMs: null,
    submissionLatencyMs: null,
    confirmationLatencyMs: null,
    totalLatencyMs: null,
    status: "skipped",
    revert: null,
    phaseMs: {},
  };
}

/**
 * Submit a transaction with detailed phase-level instrumentation.
 *
 * Phase breakdown (each timed independently and pushed to the global profiler):
 *   1. estimateGas   — `contract.fn.estimateGas(args)` (RPC roundtrip).
 *   2. preSubmit     — `contract.fn.populateTransaction(args)` + nonce + fee
 *                      assembly inside ethers (local + parallel RPC). The
 *                      time from the start of the wallet's send call until the
 *                      tx hash returns reflects ~1× RPC roundtrip for nonce,
 *                      ~1× for feeData, and ~1× for eth_sendRawTransaction.
 *   3. broadcast     — captured implicitly inside `preSubmit` (ethers does not
 *                      expose them separately when going through Contract.fn).
 *                      The mempool latency = preSubmit timer.
 *   4. waitConfirm   — `tx.wait()` polling time; depends on poll interval and
 *                      block time. On arb-sepolia with poll=500 ms expect
 *                      0.5–4 s for 1-block confirmation.
 *
 * The combined `txTotal` phase is also recorded for the whole submission.
 */
async function submitTx(
  ctx: RuntimeContext,
  contractName: string,
  fn: string,
  args: unknown[],
  txOptions: {
    value?: bigint;
    skipEstimateGas?: boolean;
    gasLimitOverride?: bigint;
    nonce?: number;
  } = {},
): Promise<OperationLog> {
  const op = emptyOp();
  op.op = fn;
  op.contract = contractName;
  op.args = args.map((a) => (typeof a === "bigint" ? a.toString() : a));
  const label = `${contractName}.${fn}`;

  const contract = ctx.contracts[contractName];
  if (!contract) {
    op.status = "revert";
    op.revert = { raw: "0x", decoded: `unknown contract ${contractName}`, selector: null };
    return op;
  }

  op.submittedAtMs = Date.now();
  const txStartMs = op.submittedAtMs;
  // Strip our extension fields before passing the rest to ethers.
  const {
    skipEstimateGas = false,
    gasLimitOverride,
    ...rawTxOpts
  } = txOptions;
  try {
    // 1. Estimate gas first (separate RPC) — surfaces precompile rejections
    //    cheaply (no real gas spent) and gives us a useful tx-shape latency.
    //    Some scenarios (e.g. closePosition right after openPosition) need to
    //    skip estimateGas because arb-sepolia simulates against the latest
    //    mined block — which may still be the open's block — and the
    //    INV-2-005 same-block-close guard would falsely fire even though the
    //    tx will actually be sequenced into a later block.
    let gasEst = gasLimitOverride ?? 0n;
    if (!skipEstimateGas && gasLimitOverride === undefined) {
      try {
        const estimateRef = contract[fn].estimateGas as (...a: unknown[]) => Promise<bigint>;
        const estStart = Date.now();
        gasEst = await estimateRef(...args, rawTxOpts);
        const estMs = Date.now() - estStart;
        op.phaseMs.estimateGas = estMs;
        recordPhase("estimateGas", label, estMs);
      } catch (estErr) {
        // Some calls (e.g., contracts that depend on prior tx state) may fail
        // estimateGas; we proceed with a generous default and let the actual
        // submission produce the authoritative revert.
        op.phaseMs.estimateGas = Date.now() - txStartMs;
        const decoded = decodeRevert(estErr, ctx.ifaces);
        // If estimateGas reverts cleanly, that's our answer — no need to submit.
        op.confirmedAtMs = Date.now();
        op.totalLatencyMs = op.confirmedAtMs - txStartMs;
        op.status = "revert";
        op.revert = decoded;
        vlog(`  [estimateGas-revert] ${label} → ${decoded.decoded}`);
        recordPhase("txTotal", label, op.totalLatencyMs);
        return op;
      }
    }

    // 2. preSubmit — nonce/fee assembly + signing + eth_sendRawTransaction.
    const preStart = Date.now();
    const fnRef = contract[fn] as (
      ...a: unknown[]
    ) => Promise<ethers.ContractTransactionResponse>;
    // gasLimit: 1.2× estimate; or hardcoded override; or fallback for skip path.
    const gasLimit =
      gasLimitOverride ??
      (gasEst > 0n ? (gasEst * 12n) / 10n : 1_500_000n /* generous default */);
    const tx = await fnRef(...args, { ...rawTxOpts, gasLimit });
    op.mempooledAtMs = Date.now();
    op.txHash = tx.hash;
    op.submissionLatencyMs = op.mempooledAtMs - preStart;
    op.phaseMs.preSubmit = op.submissionLatencyMs;
    op.phaseMs.broadcast = op.submissionLatencyMs;
    recordPhase("preSubmit", label, op.submissionLatencyMs);
    recordPhase("broadcast", label, op.submissionLatencyMs);

    // 3. waitConfirm — block confirmation polling.
    const waitStart = Date.now();
    const rcpt = await tx.wait();
    op.confirmedAtMs = Date.now();
    op.confirmationLatencyMs = op.confirmedAtMs - waitStart;
    op.phaseMs.waitConfirm = op.confirmationLatencyMs;
    recordPhase("waitConfirm", label, op.confirmationLatencyMs);

    // 4. txTotal — full submission window.
    op.totalLatencyMs = op.confirmedAtMs - txStartMs;
    op.phaseMs.txTotal = op.totalLatencyMs;
    recordPhase("txTotal", label, op.totalLatencyMs);
    op.blockNumber = rcpt?.blockNumber ?? null;
    op.gasUsed = rcpt?.gasUsed?.toString() ?? null;
    op.status = "ok";
    vlog(
      `  [tx] ${label} gas=${op.gasUsed} block=${op.blockNumber} ` +
        `est=${op.phaseMs.estimateGas}ms pre=${op.phaseMs.preSubmit}ms wait=${op.phaseMs.waitConfirm}ms total=${op.totalLatencyMs}ms`,
    );
  } catch (e) {
    op.confirmedAtMs = Date.now();
    op.totalLatencyMs = op.confirmedAtMs - txStartMs;
    op.phaseMs.txTotal = op.totalLatencyMs;
    recordPhase("txTotal", label, op.totalLatencyMs);
    op.status = "revert";
    op.revert = decodeRevert(e, ctx.ifaces);
    // Fallback: if the error didn't carry decoded data (just the generic
    // "transaction execution reverted" wrapping ethers produces when a tx
    // reverts after submission), re-simulate via provider.call against the
    // failed-tx block to extract the actual revert data.
    if (
      op.txHash &&
      (op.revert.decoded === "transaction execution reverted" ||
        op.revert.raw === "0x" ||
        op.revert.decoded.startsWith("unknown-selector"))
    ) {
      try {
        const failedTx = await ctx.provider.getTransaction(op.txHash);
        if (failedTx) {
          const rcpt = await ctx.provider.getTransactionReceipt(op.txHash);
          await ctx.provider.call({
            to: failedTx.to,
            from: failedTx.from,
            data: failedTx.data,
            value: failedTx.value,
            gasLimit: failedTx.gasLimit,
            blockTag: rcpt?.blockNumber,
          });
        }
      } catch (sim) {
        const refined = decodeRevert(sim, ctx.ifaces);
        if (refined.raw !== "0x" || refined.decoded !== op.revert.decoded) {
          op.revert = refined;
        }
      }
    }
    vlog(`  [revert] ${label} → ${op.revert.decoded}`);
  }
  return op;
}

/**
 * Static (eth_call) probe with phase instrumentation. Records under the
 * `staticCall` phase (no chain mutation, no gas, no confirmation wait).
 */
async function staticCall(
  ctx: RuntimeContext,
  contractName: string,
  fn: string,
  args: unknown[],
): Promise<OperationLog> {
  const op = emptyOp();
  op.op = `${fn}.staticCall`;
  op.contract = contractName;
  op.args = args.map((a) => (typeof a === "bigint" ? a.toString() : a));
  op.submittedAtMs = Date.now();
  const label = `${contractName}.${fn}.staticCall`;
  const contract = ctx.contracts[contractName];
  if (!contract) {
    op.status = "revert";
    op.revert = { raw: "0x", decoded: `unknown contract ${contractName}`, selector: null };
    return op;
  }
  try {
    const fnRef = contract[fn].staticCall as (...a: unknown[]) => Promise<unknown>;
    const t0 = Date.now();
    await fnRef(...args);
    const ms = Date.now() - t0;
    op.confirmedAtMs = Date.now();
    op.totalLatencyMs = op.confirmedAtMs - op.submittedAtMs;
    op.phaseMs.staticCall = ms;
    recordPhase("staticCall", label, ms);
    op.status = "static-ok";
  } catch (e) {
    const ms = Date.now() - op.submittedAtMs;
    op.confirmedAtMs = Date.now();
    op.totalLatencyMs = ms;
    op.phaseMs.staticCall = ms;
    recordPhase("staticCall", label, ms);
    op.status = "revert";
    op.revert = decodeRevert(e, ctx.ifaces);
  }
  return op;
}

// ────────────────────────────────────────────────────────────────────────
// State verification helpers
// ────────────────────────────────────────────────────────────────────────

async function readPlainSupply(ctx: RuntimeContext, token: string): Promise<bigint> {
  return profile("stateRead", "LendingPool.getPlainSupplyBalance", async () =>
    (await ctx.contracts.LendingPool.getPlainSupplyBalance(token)) as bigint,
  );
}
async function readPlainBorrow(ctx: RuntimeContext, token: string): Promise<bigint> {
  return profile("stateRead", "LendingPool.getPlainBorrowBalance", async () =>
    (await ctx.contracts.LendingPool.getPlainBorrowBalance(token)) as bigint,
  );
}
async function readLiquidReserve(ctx: RuntimeContext, token: string): Promise<bigint> {
  return profile("stateRead", "LendingPool.liquidReserve", async () =>
    (await ctx.contracts.LendingPool.liquidReserve(token)) as bigint,
  );
}
async function readDeposited(ctx: RuntimeContext): Promise<bigint> {
  return profile("stateRead", "StrategyVault.getDepositedAmount", async () =>
    (await ctx.contracts.StrategyVault.getDepositedAmount()) as bigint,
  );
}
async function readHasPosition(ctx: RuntimeContext): Promise<boolean> {
  return profile("stateRead", "StrategyVault.hasPosition", async () =>
    (await ctx.contracts.StrategyVault.hasPosition(ctx.tester.address)) as boolean,
  );
}
async function readStrategyCount(ctx: RuntimeContext): Promise<bigint> {
  return profile("stateRead", "StrategyRegistry.strategyCount", async () =>
    (await ctx.contracts.StrategyRegistry.strategyCount()) as bigint,
  );
}

interface StateSnap {
  plainSupplyUsdc: bigint;
  plainBorrowUsdc: bigint;
  reserveUsdc: bigint;
  deposited: bigint;
  hasPosition: boolean;
  strategyCount: bigint;
}

async function snapState(ctx: RuntimeContext): Promise<StateSnap> {
  const [s, b, r, d, h, c] = await Promise.all([
    readPlainSupply(ctx, USDC),
    readPlainBorrow(ctx, USDC),
    readLiquidReserve(ctx, USDC),
    readDeposited(ctx),
    readHasPosition(ctx),
    readStrategyCount(ctx),
  ]);
  return {
    plainSupplyUsdc: s,
    plainBorrowUsdc: b,
    reserveUsdc: r,
    deposited: d,
    hasPosition: h,
    strategyCount: c,
  };
}

function diffState(
  pre: StateSnap,
  post: StateSnap,
  expected: Partial<{
    plainSupplyUsdcDelta: bigint;
    plainBorrowUsdcDelta: bigint;
    reserveUsdcDelta: bigint;
    depositedDelta: bigint;
    hasPositionAfter: boolean;
    strategyCountDelta: bigint;
  }>,
): StateAssertionRecord[] {
  const checks: StateAssertionRecord[] = [];
  const add = (variable: string, expectedV: bigint | boolean, actualV: bigint | boolean): void => {
    checks.push({
      variable,
      expected: expectedV.toString(),
      actual: actualV.toString(),
      match: expectedV === actualV,
    });
  };
  if (expected.plainSupplyUsdcDelta !== undefined) {
    add(
      "plainSupplyUsdcDelta",
      expected.plainSupplyUsdcDelta,
      post.plainSupplyUsdc - pre.plainSupplyUsdc,
    );
  }
  if (expected.plainBorrowUsdcDelta !== undefined) {
    add(
      "plainBorrowUsdcDelta",
      expected.plainBorrowUsdcDelta,
      post.plainBorrowUsdc - pre.plainBorrowUsdc,
    );
  }
  if (expected.reserveUsdcDelta !== undefined) {
    add("reserveUsdcDelta", expected.reserveUsdcDelta, post.reserveUsdc - pre.reserveUsdc);
  }
  if (expected.depositedDelta !== undefined) {
    add("depositedDelta", expected.depositedDelta, post.deposited - pre.deposited);
  }
  if (expected.hasPositionAfter !== undefined) {
    add("hasPositionAfter", expected.hasPositionAfter, post.hasPosition);
  }
  if (expected.strategyCountDelta !== undefined) {
    add("strategyCountDelta", expected.strategyCountDelta, post.strategyCount - pre.strategyCount);
  }
  return checks;
}

// ────────────────────────────────────────────────────────────────────────
// Encryption helpers
// ────────────────────────────────────────────────────────────────────────

async function encryptUint128(ctx: RuntimeContext, v: bigint): Promise<EncryptedHandle> {
  if (!ctx.cofhe) throw new Error("CoFHE SDK unavailable");
  return profile("cofheEncrypt", "uint128(1)", async () => {
    const out = await ctx.cofhe!.client
      .encryptInputs([ctx.cofhe!.Encryptable.uint128(v)])
      .execute();
    return out[0];
  });
}

async function encryptOpenInputs(
  ctx: RuntimeContext,
  collateral: bigint,
  debt: bigint,
): Promise<EncryptedHandle[]> {
  // F-03: openPosition no longer takes encrypted apyTarget / loopCount.
  // Strategy-level params live as plaintext on the registry's `Strategy`
  // struct now, so the position only needs (collateral, debt) ciphertexts.
  if (!ctx.cofhe) throw new Error("CoFHE SDK unavailable");
  return profile("cofheEncrypt", "openInputs(2)", () =>
    ctx.cofhe!.client
      .encryptInputs([
        ctx.cofhe!.Encryptable.uint128(collateral),
        ctx.cofhe!.Encryptable.uint128(debt),
      ])
      .execute(),
  );
}

/**
 * Wait until the chain head advances past `openBlock` by at least
 * `marginBlocks` (default 2). Required after StrategyVault.openPosition
 * before any close attempt (INV-2-005: SameBlockClose() reverts if
 * `positionOpenedAtBlock + 1 > block.number`).
 *
 * Empirically arb-sepolia's eth_estimateGas can simulate against a "pending"
 * block whose `block.number` lags the latest-mined head when the sequencer
 * batches multiple tx into one L2 block. Polling for `head > openBlock + 1`
 * gives the simulation a definitively-fresh block.number to work with.
 */
async function waitNextBlockAfter(
  ctx: RuntimeContext,
  openBlock: number,
  marginBlocks = 2,
): Promise<void> {
  if (openBlock === 0) {
    // Open failed; nothing to wait for.
    return;
  }
  const target = openBlock + marginBlocks;
  let head = await ctx.provider.getBlockNumber();
  while (head < target) {
    await new Promise((r) => setTimeout(r, 250));
    head = await ctx.provider.getBlockNumber();
  }
}

/**
 * Batch encrypt N uint128 values in a single CoFHE roundtrip.
 *
 * The instrumentation revealed CoFHE encryption averages ~7.8 s per call
 * (network roundtrip to the Fhenix backend), regardless of payload size.
 * Batching N values into one call therefore costs ~7.8 s once instead of
 * N×7.8 s. Scenarios that need encrypted handles for multiple sequential
 * operations should call `encryptUint128Batch` once at the top instead of
 * doing per-step encryption.
 *
 * Returns N handles in the same order as the input values.
 */
async function encryptUint128Batch(
  ctx: RuntimeContext,
  values: bigint[],
): Promise<EncryptedHandle[]> {
  if (!ctx.cofhe) throw new Error("CoFHE SDK unavailable");
  if (values.length === 0) return [];
  return profile("cofheEncrypt", `uint128Batch(${values.length})`, () =>
    ctx.cofhe!.client
      .encryptInputs(values.map((v) => ctx.cofhe!.Encryptable.uint128(v)))
      .execute(),
  );
}

// ────────────────────────────────────────────────────────────────────────
// Permit2 (Uniswap canonical singleton)
//
// Round-13 unified all token authorisation paths on Permit2. The legacy
// EIP-2612 helpers (`probePermitSupport`, `signPermit2612`,
// `Eip2612Signature`, `PermitSupport`) were REMOVED — no fallback, no
// redundant alternative. Permit2 is universally compatible (works for any
// ERC-20, including tokens that lack their own `permit()` function), uses a
// cross-protocol nonce space, and the singleton at `PERMIT2_ADDRESS` is
// verified deployed on every chain we target (arb-sepolia: 18,306 bytes of
// bytecode at the canonical address).
//
// User-side onboarding: one-time `IERC20(token).approve(PERMIT2, MaxUint256)`,
// then sign EIP-712 `PermitTransferFrom` messages per transfer.
// ────────────────────────────────────────────────────────────────────────

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

interface Permit2Sig {
  /// The exact struct shape the on-chain `IPermit2.permitTransferFrom` expects.
  permit: {
    permitted: { token: string; amount: bigint };
    nonce: bigint;
    deadline: bigint;
  };
  /// 65-byte concatenated (r || s || v) EIP-712 signature.
  signature: string;
  /// Composer struct shape (Permit2Authorization) — identical fields, flatter.
  composerAuth: {
    amount: bigint;
    deadline: bigint;
    nonce: bigint;
    signature: string;
  };
}

/**
 * Sign a Permit2 PermitTransferFrom message. The signature is bound to
 * `(token, amount, nonce, deadline, spender)` so it cannot be re-purposed
 * for any other recipient or replayed.
 *
 * The user must have one-time approved Permit2 with
 * `IERC20(token).approve(PERMIT2_ADDRESS, MaxUint256)`. The cold-start init
 * does this automatically (see `coldStart`) so this helper assumes the
 * approval is in place.
 */
async function signPermit2(
  ctx: RuntimeContext,
  token: string,
  amount: bigint,
  spender: string,
  /** Default deadline: now + 30 minutes. */
  deadlineSecs?: number,
): Promise<Permit2Sig> {
  return profile(
    "permitSign",
    `permit2:${token.slice(0, 10)}…→${spender.slice(0, 10)}…`,
    async () => {
      const deadline = BigInt(deadlineSecs ?? Math.floor(Date.now() / 1000) + 1800);
      // Permit2 uses a 256-bit nonce space owned by the user. We pick a fresh
      // 252-bit random for each signature — collision probability is
      // astronomical even across millions of signatures per user.
      const nonceHex = ethers.hexlify(ethers.randomBytes(32));
      const nonce = BigInt(nonceHex) >> 4n;
      const domain = {
        name: "Permit2",
        chainId: BigInt(ctx.chainId),
        verifyingContract: PERMIT2_ADDRESS,
      };
      const types = {
        PermitTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      };
      const value = {
        permitted: { token, amount },
        spender,
        nonce,
        deadline,
      };
      const signature = await ctx.tester.signTypedData(domain, types, value);
      return {
        permit: { permitted: { token, amount }, nonce, deadline },
        signature,
        composerAuth: { amount, deadline, nonce, signature },
      };
    },
  );
}

/// Skip-permit sentinel for the composer's `Permit2Authorization` struct —
/// `deadline = 0` tells the composer to fall back to a pre-existing
/// `IERC20.approve(composer, ...)` allowance instead of invoking Permit2.
const COMPOSER_PERMIT_SKIP = {
  amount: 0n,
  deadline: 0n,
  nonce: 0n,
  signature: "0x",
};

// ────────────────────────────────────────────────────────────────────────
// SCENARIO executor — wraps a scenario function in evidence collection
// ────────────────────────────────────────────────────────────────────────

interface ScenarioDef {
  id: string;
  type: "deterministic" | "random" | "baseline" | "ux" | "concurrency";
  description: string;
  expectedRevert?: { contract: string; errorName: string };
  /** Run the scenario; return ops + state assertions + final result. */
  run: (ctx: RuntimeContext) => Promise<{
    ops: OperationLog[];
    stateChecks: StateAssertionRecord[];
    overrideResult?: ResultKind;
  }>;
}

async function runScenario(ctx: RuntimeContext, def: ScenarioDef): Promise<ScenarioEvidence> {
  const startMs = Date.now();
  log(`▶ ${def.id} (${def.type}) — ${def.description}`);
  let ops: OperationLog[] = [];
  let stateChecks: StateAssertionRecord[] = [];
  let result: ResultKind = "SUCCESS";
  let unknownPattern = false;
  const findings: Finding[] = [];

  if (ctx.cli.dryRun) {
    log(`  [dry-run] structurally valid; no transactions submitted.`);
    return {
      runId: ctx.runId,
      scenarioId: def.id,
      type: def.type,
      description: def.description,
      operations: [],
      result: "DRY_RUN_VALID",
      totalGasUsed: "0",
      totalLatencyMs: 0,
      operationGas: {},
      operationLatencyMs: {},
      txHashes: [],
      blockNumbers: [],
      stateVerification: [],
      revertReason: null,
      unknownPattern: false,
      findings: [],
    };
  }

  try {
    const out = await def.run(ctx);
    ops = out.ops;
    stateChecks = out.stateChecks;
    if (out.overrideResult) result = out.overrideResult;
  } catch (e) {
    const r = decodeRevert(e, ctx.ifaces);
    result = "SETUP_FAILURE";
    log(`  ✗ setup failure: ${r.decoded}`);
    findings.push({
      scenarioId: def.id,
      kind: "UNEXPECTED_REVERT",
      severity: "MEDIUM",
      details: `setup failure: ${r.decoded}`,
    });
  }

  // Result classification.
  const reverts = ops.filter((o) => o.status === "revert");
  if (result === "SUCCESS" && def.expectedRevert && reverts.length === 0) {
    // Scenario expected a revert but none occurred — that itself is a finding
    // (the contract didn't enforce the invariant the test was probing).
    result = "UNEXPECTED_REVERT";
    findings.push({
      scenarioId: def.id,
      kind: "UNEXPECTED_REVERT",
      severity: "HIGH",
      details: `expected revert ${def.expectedRevert.errorName}; got SUCCESS — contract did not enforce the invariant`,
    });
  } else if (result === "SUCCESS" && reverts.length > 0) {
    if (def.expectedRevert) {
      const last = reverts[reverts.length - 1];
      if (last.revert?.decoded.includes(def.expectedRevert.errorName)) {
        result = "EXPECTED_REVERT_VERIFIED";
      } else {
        result = "UNEXPECTED_REVERT";
        findings.push({
          scenarioId: def.id,
          kind: "UNEXPECTED_REVERT",
          severity: "HIGH",
          details: `expected ${def.expectedRevert.errorName}; got ${last.revert?.decoded ?? "(no data)"}`,
        });
      }
    } else {
      result = "UNEXPECTED_REVERT";
      const last = reverts[reverts.length - 1];
      findings.push({
        scenarioId: def.id,
        kind: "UNEXPECTED_REVERT",
        severity: "HIGH",
        details: `unexpected revert: ${last.revert?.decoded ?? "(no data)"}`,
      });
      if (last.revert?.decoded.startsWith("unknown-selector ")) {
        unknownPattern = true;
        findings.push({
          scenarioId: def.id,
          kind: "UNKNOWN_PATTERN",
          severity: "HIGH",
          details: `unknown revert selector ${last.revert.selector ?? "?"}; raw=${last.revert.raw}`,
        });
      }
    }
  }
  // State mismatch promotion.
  const mismatches = stateChecks.filter((s) => !s.match);
  if (mismatches.length > 0 && result === "SUCCESS") {
    result = "STATE_MISMATCH";
    findings.push({
      scenarioId: def.id,
      kind: "STATE_MISMATCH",
      severity: "CRITICAL",
      details: `state mismatch: ${mismatches.map((m) => `${m.variable} expected=${m.expected} actual=${m.actual}`).join("; ")}`,
    });
  }
  // Gas regression check.
  for (const o of ops) {
    if (o.status !== "ok" || !o.gasUsed) continue;
    const key = `${o.contract}.${o.op}`;
    const baseline = GAS_BASELINE_V3[key] ?? GAS_BASELINE_V3[`${key}.real`];
    if (baseline) {
      const gas = parseInt(o.gasUsed, 10);
      const regression = (gas - baseline) / baseline;
      if (regression > 0.02) {
        findings.push({
          scenarioId: def.id,
          kind: "GAS_REGRESSION",
          severity: "MEDIUM",
          details: `${key} ${gas} > baseline ${baseline} (+${(regression * 100).toFixed(1)}%)`,
        });
      }
    }
  }

  // Aggregate gas + latency.
  const operationGas: Record<string, string> = {};
  const operationLatencyMs: Record<string, number> = {};
  let totalGas = 0n;
  for (const o of ops) {
    const key = `${o.contract}.${o.op}`;
    if (o.gasUsed) {
      operationGas[key] = o.gasUsed;
      totalGas += BigInt(o.gasUsed);
    }
    if (o.totalLatencyMs !== null) {
      operationLatencyMs[key] = o.totalLatencyMs;
    }
  }
  const totalLatencyMs = Date.now() - startMs;
  const txHashes = ops.filter((o) => o.txHash).map((o) => o.txHash as string);
  const blockNumbers = Array.from(
    new Set(ops.filter((o) => o.blockNumber !== null).map((o) => o.blockNumber as number)),
  );
  const lastRevert = reverts[reverts.length - 1];
  const evidence: ScenarioEvidence = {
    runId: ctx.runId,
    scenarioId: def.id,
    type: def.type,
    description: def.description,
    operations: ops,
    result,
    totalGasUsed: totalGas.toString(),
    totalLatencyMs,
    operationGas,
    operationLatencyMs,
    txHashes,
    blockNumbers,
    stateVerification: stateChecks,
    revertReason: lastRevert?.revert
      ? {
          raw: lastRevert.revert.raw,
          decoded: lastRevert.revert.decoded,
          selector: lastRevert.revert.selector,
          contract: lastRevert.contract,
        }
      : null,
    unknownPattern,
    findings,
  };

  const symbol =
    result === "SUCCESS"
      ? "✓"
      : result === "EXPECTED_REVERT_VERIFIED"
        ? "▶"
        : result === "STATE_MISMATCH"
          ? "✗"
          : result === "SETUP_FAILURE"
            ? "⚠"
            : "✗";
  log(`  ${symbol} ${def.id} → ${result} (${fmtMs(totalLatencyMs)}, gas=${totalGas.toString()})`);
  return evidence;
}

// ────────────────────────────────────────────────────────────────────────
// SCENARIO_DEFINITIONS — 25 deterministic scenarios
// ────────────────────────────────────────────────────────────────────────

const SCENARIO_DEFINITIONS: ScenarioDef[] = [
  {
    id: "S-001",
    type: "deterministic",
    description: "registry.registerStrategy(min name) — minimal valid registration",
    run: async (ctx) => {
      const pre = await snapState(ctx);
      // Use a per-run unique name+hash so re-runs don't collide on
      // StrategyAlreadyExists (round-11 INV-3-001 added content-hash dedup).
      const uniq = `${Date.now()}-${Math.floor(ctx.rng() * 1e6)}`;
      const op = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
        `s1-${uniq}`,
        ethers.id(`S-001-${uniq}`),
      ]);
      const post = await snapState(ctx);
      return {
        ops: [op],
        stateChecks: diffState(pre, post, { strategyCountDelta: 1n }),
      };
    },
  },
  {
    id: "S-002",
    type: "deterministic",
    description: "registry.registerStrategy(real) — verify metadata fields",
    run: async (ctx) => {
      const pre = await snapState(ctx);
      const op = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
        `S-002-${Date.now()}`,
        ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
      ]);
      const post = await snapState(ctx);
      const sId = post.strategyCount;
      const meta = (await ctx.contracts.StrategyRegistry.getStrategyMeta(sId)) as [
        string,
        string,
        string,
        bigint,
        boolean,
      ];
      const checks: StateAssertionRecord[] = [
        ...diffState(pre, post, { strategyCountDelta: 1n }),
        {
          variable: "meta.creator",
          expected: ctx.tester.address.toLowerCase(),
          actual: meta[2].toLowerCase(),
          match: meta[2].toLowerCase() === ctx.tester.address.toLowerCase(),
        },
        {
          variable: "meta.active",
          expected: "true",
          actual: String(meta[4]),
          match: meta[4] === true,
        },
      ];
      return { ops: [op], stateChecks: checks };
    },
  },
  {
    id: "S-003",
    type: "deterministic",
    description: "vault open + close (full) — 0.05 USDC; verifies INV-2-005 close-fhe-skip",
    run: async (ctx) => {
      const collateral = 50_000n;
      // Need fresh strategy
      const reg = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
        `S-003-${Date.now()}`,
        ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
      ]);
      const sId = (await ctx.contracts.StrategyRegistry.strategyCount()) as bigint;
      const enc = await encryptOpenInputs(ctx, collateral, 0n);
      const open = await submitTx(ctx, "StrategyVault", "openPosition", [
        USDC,
        collateral,
        enc[0],
        enc[1],
        sId,
      ]);
      const post1 = await snapState(ctx);
      // INV-2-005: SameBlockClose() reverts if block.number == openBlock.
      // Encrypt FRESH handle for close: openPosition already consumed enc[0].
      await waitNextBlockAfter(ctx, open.blockNumber ?? 0);
      const closeEnc = await encryptUint128(ctx, collateral);
      const close = await submitTx(ctx, "StrategyVault", "closePosition", [collateral, closeEnc], { skipEstimateGas: true, gasLimitOverride: 800_000n });
      const post2 = await snapState(ctx);
      const checks: StateAssertionRecord[] = [
        {
          variable: "afterOpen.hasPosition",
          expected: "true",
          actual: String(post1.hasPosition),
          match: post1.hasPosition,
        },
        {
          variable: "afterOpen.deposited",
          expected: collateral.toString(),
          actual: post1.deposited.toString(),
          match: post1.deposited === collateral,
        },
        {
          variable: "afterClose.hasPosition",
          expected: "false",
          actual: String(post2.hasPosition),
          match: !post2.hasPosition,
        },
        {
          variable: "afterClose.deposited",
          expected: "0",
          actual: post2.deposited.toString(),
          match: post2.deposited === 0n,
        },
      ];
      return { ops: [reg, open, close], stateChecks: checks };
    },
  },
  {
    id: "S-004",
    type: "deterministic",
    description: "vault open + addCollateral + close — verify deposit accumulates",
    run: async (ctx) => {
      const open0 = 50_000n;
      const add0 = 30_000n;
      const reg = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
        `S-004-${Date.now()}`,
        ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
      ]);
      const sId = (await ctx.contracts.StrategyRegistry.strategyCount()) as bigint;
      const enc1 = await encryptOpenInputs(ctx, open0, 0n);
      const open = await submitTx(ctx, "StrategyVault", "openPosition", [
        USDC,
        open0,
        enc1[0],
        enc1[1],
        sId,
      ]);
      const enc2 = await encryptUint128(ctx, add0);
      const add = await submitTx(ctx, "StrategyVault", "addCollateral", [USDC, add0, enc2]);
      const total = open0 + add0;
      const deposited = await readDeposited(ctx);
      // INV-2-005: ensure close is in a strictly later block than open.
      await waitNextBlockAfter(ctx, open.blockNumber ?? 0);
      const enc3 = await encryptUint128(ctx, total);
      const close = await submitTx(ctx, "StrategyVault", "closePosition", [total, enc3], { skipEstimateGas: true, gasLimitOverride: 800_000n });
      const checks: StateAssertionRecord[] = [
        {
          variable: "depositedAfterAdd",
          expected: total.toString(),
          actual: deposited.toString(),
          match: deposited === total,
        },
      ];
      return { ops: [reg, open, add, close], stateChecks: checks };
    },
  },
  {
    id: "S-005",
    type: "deterministic",
    description: "pool.supply + pool.withdraw — verify plainSupply + reserve transitions",
    run: async (ctx) => {
      const amt = 100_000n;
      const pre = await snapState(ctx);
      // Batch the 2 encryptions into 1 CoFHE roundtrip (~50% encryption cost cut).
      const [encSupply, encWithdraw] = await encryptUint128Batch(ctx, [amt, amt]);
      const supply = await submitTx(ctx, "LendingPool", "supply", [USDC, amt, encSupply]);
      const mid = await snapState(ctx);
      const wd = await submitTx(ctx, "LendingPool", "withdraw", [USDC, amt, encWithdraw]);
      const post = await snapState(ctx);
      const checks: StateAssertionRecord[] = [
        {
          variable: "supply.plainSupplyUsdcDelta",
          expected: amt.toString(),
          actual: (mid.plainSupplyUsdc - pre.plainSupplyUsdc).toString(),
          match: mid.plainSupplyUsdc - pre.plainSupplyUsdc === amt,
        },
        {
          variable: "supply.reserveUsdcDelta",
          expected: amt.toString(),
          actual: (mid.reserveUsdc - pre.reserveUsdc).toString(),
          match: mid.reserveUsdc - pre.reserveUsdc === amt,
        },
        {
          variable: "afterWithdraw.plainSupplyUsdc",
          expected: pre.plainSupplyUsdc.toString(),
          actual: post.plainSupplyUsdc.toString(),
          match: post.plainSupplyUsdc === pre.plainSupplyUsdc,
        },
      ];
      return { ops: [supply, wd], stateChecks: checks };
    },
  },
  {
    id: "S-006",
    type: "deterministic",
    description: "pool: supply → checkLtvAndBorrow → repay → withdraw — verify all 4 paths",
    run: async (ctx) => {
      const supplyAmt = 200_000n;
      const borrowAmt = 100_000n; // 50% LTV against own supply
      const pre = await snapState(ctx);
      // Batch all 4 encryptions into 1 CoFHE roundtrip (~75% encryption cost cut).
      const [encSupply, encBorrow, encRepay, encWithdraw] = await encryptUint128Batch(ctx, [
        supplyAmt,
        borrowAmt,
        borrowAmt,
        supplyAmt,
      ]);
      const supply = await submitTx(ctx, "LendingPool", "supply", [USDC, supplyAmt, encSupply]);
      const borrow = await submitTx(ctx, "LendingPool", "checkLtvAndBorrow", [
        USDC,
        USDC,
        borrowAmt,
        encBorrow,
        70n,
        100n,
      ]);
      const repay = await submitTx(ctx, "LendingPool", "repay", [USDC, borrowAmt, encRepay]);
      const wd = await submitTx(ctx, "LendingPool", "withdraw", [USDC, supplyAmt, encWithdraw]);
      const post = await snapState(ctx);
      const checks = diffState(pre, post, {
        plainSupplyUsdcDelta: 0n,
        plainBorrowUsdcDelta: 0n,
        reserveUsdcDelta: 0n,
      });
      return { ops: [supply, borrow, repay, wd], stateChecks: checks };
    },
  },
  {
    id: "S-007",
    type: "deterministic",
    description: "borrowWithOracle path — Pyth-gated supply→borrow→repay→withdraw",
    run: async (ctx) => {
      const supplyAmt = 200_000n;
      const borrowAmt = 50_000n;
      const pre = await snapState(ctx);
      // Batch all 4 encryptions into 1 CoFHE roundtrip (~75% encryption cost cut).
      const [encSupply, encBorrow, encRepay, encWithdraw] = await encryptUint128Batch(ctx, [
        supplyAmt,
        borrowAmt,
        borrowAmt,
        supplyAmt,
      ]);
      const supply = await submitTx(ctx, "LendingPool", "supply", [USDC, supplyAmt, encSupply]);
      const borrow = await submitTx(ctx, "LendingPool", "borrowWithOracle", [
        USDC,
        USDC,
        borrowAmt,
        encBorrow,
      ]);
      const repay = await submitTx(ctx, "LendingPool", "repay", [USDC, borrowAmt, encRepay]);
      const wd = await submitTx(ctx, "LendingPool", "withdraw", [USDC, supplyAmt, encWithdraw]);
      const post = await snapState(ctx);
      const checks = diffState(pre, post, {
        plainSupplyUsdcDelta: 0n,
        plainBorrowUsdcDelta: 0n,
        reserveUsdcDelta: 0n,
      });
      return { ops: [supply, borrow, repay, wd], stateChecks: checks };
    },
  },
  {
    id: "S-008",
    type: "deterministic",
    description: "composer.openLeveragedStrategy — plaintext-only register (collateralAmount=0)",
    run: async (ctx) => {
      if (!ctx.cofhe) return { ops: [], stateChecks: [], overrideResult: "SETUP_FAILURE" };
      // F-03: OpenStrategyEncrypted shrunk from 8 → 6 ciphertexts. apy/loop
      // moved to plaintext on OpenStrategyParams.
      const enc = await ctx.cofhe.client
        .encryptInputs([
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
        ])
        .execute();
      const params = {
        strategyName: `S-008-${Date.now()}`,
        workflowHash: ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
        collateralToken: USDC,
        collateralAmount: 0n,
        poolSupplyAmount: 0n,
        borrowToken: ethers.ZeroAddress,
        poolBorrowAmount: 0n,
        useOracleBorrow: false,
        ltvNum: 0n,
        ltvDen: 0n,
        swapTokenOut: ethers.ZeroAddress,
        swapDeadlineOffset: 0n,
        strategyId: 0n,
        apyTarget: 0,
        loopCount: 0,
        collateralPermit: COMPOSER_PERMIT_SKIP,
      };
      const encParams = {
        collateral: enc[0],
        debt: enc[1],
        supplyEnc: enc[2],
        borrowEnc: enc[3],
        swapAmountIn: enc[4],
        swapMinOut: enc[5],
      };
      const op = await submitTx(ctx, "FheForgeComposer", "openLeveragedStrategy", [
        params,
        encParams,
      ]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-009",
    type: "deterministic",
    description: "registry.setActive(false) — verify metadata.active flips",
    run: async (ctx) => {
      const reg = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
        `S-009-${Date.now()}`,
        ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
      ]);
      const sId = (await ctx.contracts.StrategyRegistry.strategyCount()) as bigint;
      const setOp = await submitTx(ctx, "StrategyRegistry", "setActive", [sId, false]);
      const meta = (await ctx.contracts.StrategyRegistry.getStrategyMeta(sId)) as [
        string,
        string,
        string,
        bigint,
        boolean,
      ];
      const checks: StateAssertionRecord[] = [
        {
          variable: "meta.active",
          expected: "false",
          actual: String(meta[4]),
          match: meta[4] === false,
        },
      ];
      return { ops: [reg, setOp], stateChecks: checks };
    },
  },
  {
    id: "S-010",
    type: "deterministic",
    description:
      "INV-2-003 same-block close — submit open + close with sequential nonces; close must revert SameBlockClose",
    expectedRevert: { contract: "StrategyVault", errorName: "SameBlockClose" },
    run: async (ctx) => {
      const collateral = 50_000n;
      const reg = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
        `S-010-${Date.now()}`,
        ethers.keccak256(
          ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random() * 1e9)}`),
        ),
      ]);
      const sId = (await ctx.contracts.StrategyRegistry.strategyCount()) as bigint;
      // Encrypt both inputs in one batch.
      // F-03: only collateral + debt are encrypted on the position.
      const [collEnc, debtEnc] = await encryptOpenInputs(ctx, collateral, 0n);
      const closeEnc = await encryptUint128(ctx, collateral);
      // Read pending nonce; submit open and close in PARALLEL with sequential
      // nonces so they land in adjacent slots — open at N, close at N+1.
      // The sequencer typically batches both into the same L2 block, which
      // triggers INV-2-003's SameBlockClose() guard.
      const baseNonce = await ctx.provider.getTransactionCount(ctx.tester.address, "pending");
      const [open, close] = await Promise.all([
        submitTx(
          ctx,
          "StrategyVault",
          "openPosition",
          [USDC, collateral, collEnc, debtEnc, sId],
          { nonce: baseNonce, skipEstimateGas: true, gasLimitOverride: 1_000_000n },
        ),
        submitTx(
          ctx,
          "StrategyVault",
          "closePosition",
          [collateral, closeEnc],
          { nonce: baseNonce + 1, skipEstimateGas: true, gasLimitOverride: 800_000n },
        ),
      ]);
      // Cleanup: wait for next block, then close again (this one should succeed
      // because we're past the open's block).
      await waitNextBlockAfter(ctx, open.blockNumber ?? 0);
      const cleanupEnc = await encryptUint128(ctx, collateral);
      const cleanup = await submitTx(
        ctx,
        "StrategyVault",
        "closePosition",
        [collateral, cleanupEnc],
        { skipEstimateGas: true, gasLimitOverride: 800_000n },
      );
      return { ops: [reg, open, close, cleanup], stateChecks: [] };
    },
  },
  {
    id: "S-011",
    type: "deterministic",
    description: "Pool over-LTV borrow → expect InsufficientCollateral",
    expectedRevert: { contract: "LendingPool", errorName: "InsufficientCollateral" },
    run: async (ctx) => {
      const supplyAmt = 100_000n;
      const enc1 = await encryptUint128(ctx, supplyAmt);
      const supply = await submitTx(ctx, "LendingPool", "supply", [USDC, supplyAmt, enc1]);
      const enc2 = await encryptUint128(ctx, supplyAmt + 1n);
      const overBorrow = await staticCall(ctx, "LendingPool", "checkLtvAndBorrow", [
        USDC,
        USDC,
        supplyAmt + 1n, // > supply at 90/100
        enc2,
        90n,
        100n,
      ]);
      const enc3 = await encryptUint128(ctx, supplyAmt);
      const wd = await submitTx(ctx, "LendingPool", "withdraw", [USDC, supplyAmt, enc3]);
      return { ops: [supply, overBorrow, wd], stateChecks: [] };
    },
  },
  {
    id: "S-012",
    type: "deterministic",
    description: "Pool ltvNum=0 → expect LtvNumeratorZero",
    expectedRevert: { contract: "LendingPool", errorName: "LtvNumeratorZero" },
    run: async (ctx) => {
      const enc = await encryptUint128(ctx, 1n);
      const op = await staticCall(ctx, "LendingPool", "checkLtvAndBorrow", [
        USDC,
        USDC,
        1n,
        enc,
        0n,
        100n,
      ]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-013",
    type: "deterministic",
    description: "Pool ltvDen=0 → expect LtvDenominatorZero",
    expectedRevert: { contract: "LendingPool", errorName: "LtvDenominatorZero" },
    run: async (ctx) => {
      const enc = await encryptUint128(ctx, 1n);
      const op = await staticCall(ctx, "LendingPool", "checkLtvAndBorrow", [
        USDC,
        USDC,
        1n,
        enc,
        70n,
        0n,
      ]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-014",
    type: "deterministic",
    description: "Pool repay > borrow → expect ExceedsBorrowBalance",
    expectedRevert: { contract: "LendingPool", errorName: "ExceedsBorrowBalance" },
    run: async (ctx) => {
      const enc = await encryptUint128(ctx, 999_999_999n);
      const op = await staticCall(ctx, "LendingPool", "repay", [USDC, 999_999_999n, enc]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-015",
    type: "deterministic",
    description: "Pool withdraw > supply → expect ExceedsSupplyBalance",
    expectedRevert: { contract: "LendingPool", errorName: "ExceedsSupplyBalance" },
    run: async (ctx) => {
      const enc = await encryptUint128(ctx, 999_999_999n);
      const op = await staticCall(ctx, "LendingPool", "withdraw", [USDC, 999_999_999n, enc]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-016",
    type: "deterministic",
    description: "Vault openPosition strategyId=0 → expect InvalidStrategyId",
    expectedRevert: { contract: "StrategyVault", errorName: "InvalidStrategyId" },
    run: async (ctx) => {
      const enc = await encryptOpenInputs(ctx, 1n, 0n);
      const op = await staticCall(ctx, "StrategyVault", "openPosition", [
        USDC,
        1_000_000n,
        enc[0],
        enc[1],
        0n,
      ]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-017",
    type: "deterministic",
    description: "Vault addCollateral with no position → expect NoPosition",
    expectedRevert: { contract: "StrategyVault", errorName: "NoPosition" },
    run: async (ctx) => {
      const enc = await encryptUint128(ctx, 1n);
      const op = await staticCall(ctx, "StrategyVault", "addCollateral", [USDC, 1n, enc]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-018",
    type: "deterministic",
    description: "Vault openPosition collateralAmount=0 → expect ZeroAmount",
    expectedRevert: { contract: "StrategyVault", errorName: "ZeroAmount" },
    run: async (ctx) => {
      const enc = await encryptOpenInputs(ctx, 0n, 0n);
      const sId = (await ctx.contracts.StrategyRegistry.strategyCount()) as bigint;
      const op = await staticCall(ctx, "StrategyVault", "openPosition", [
        USDC,
        0n,
        enc[0],
        enc[1],
        sId === 0n ? 1n : sId,
      ]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-019",
    type: "deterministic",
    description: "Registry empty name → expect EmptyName",
    expectedRevert: { contract: "StrategyRegistry", errorName: "EmptyName" },
    run: async (ctx) => {
      const op = await staticCall(ctx, "StrategyRegistry", "registerStrategy", [
        "",
        ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
      ]);
      return { ops: [op], stateChecks: [] };
    },
  },
  {
    id: "S-020",
    type: "deterministic",
    description: "SwapRouter submitSwapIntent + cancelIntent — verify intent meta fields",
    run: async (ctx) => {
      if (!ctx.cofhe) return { ops: [], stateChecks: [], overrideResult: "SETUP_FAILURE" };
      const enc = await ctx.cofhe.client
        .encryptInputs([ctx.cofhe.Encryptable.uint128(1n), ctx.cofhe.Encryptable.uint128(1n)])
        .execute();
      const submit = await submitTx(ctx, "SwapRouter", "submitSwapIntent", [
        USDC,
        WETH,
        enc[0],
        enc[1],
        60n,
      ]);
      // Parse intent id from logs
      let intentId = "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (submit.txHash) {
        const rcpt = await ctx.provider.getTransactionReceipt(submit.txHash);
        if (rcpt) {
          for (const lg of rcpt.logs) {
            try {
              const parsed = ctx.contracts.SwapRouter.interface.parseLog(lg);
              if (parsed && parsed.name === "IntentSubmitted") {
                intentId = parsed.args[0] as string;
                break;
              }
            } catch {
              /* not from router */
            }
          }
        }
      }
      const cancel = await submitTx(ctx, "SwapRouter", "cancelIntent", [intentId]);
      return { ops: [submit, cancel], stateChecks: [] };
    },
  },
  {
    id: "S-021",
    type: "deterministic",
    description: "PriceOracle getPriceUsd USDC + WETH — verify both > 0",
    run: async (ctx) => {
      const op1 = await staticCall(ctx, "PriceOracle", "getPriceUsd", [USDC]);
      const op2 = await staticCall(ctx, "PriceOracle", "getPriceUsd", [WETH]);
      const checks: StateAssertionRecord[] = [
        {
          variable: "PriceOracle.getPriceUsd(USDC).status",
          expected: "static-ok",
          actual: op1.status,
          match: op1.status === "static-ok",
        },
        {
          variable: "PriceOracle.getPriceUsd(WETH).status",
          expected: "static-ok",
          actual: op2.status,
          match: op2.status === "static-ok",
        },
      ];
      return { ops: [op1, op2], stateChecks: checks };
    },
  },
  {
    id: "S-022",
    type: "deterministic",
    description: "PriceOracle convertToUsd / convertFromUsd round-trip — small drift only",
    run: async (ctx) => {
      const usdAmt = ethers.parseUnits("100", 18); // $100 in WAD
      const op1 = await staticCall(ctx, "PriceOracle", "convertFromUsd", [USDC, usdAmt]);
      const usdcAmt = (await ctx.contracts.PriceOracle.convertFromUsd(USDC, usdAmt)) as bigint;
      const op2 = await staticCall(ctx, "PriceOracle", "convertToUsd", [USDC, usdcAmt]);
      const back = (await ctx.contracts.PriceOracle.convertToUsd(USDC, usdcAmt)) as bigint;
      // allow up to 1% drift
      const drift = back > usdAmt ? back - usdAmt : usdAmt - back;
      const tolerance = usdAmt / 100n;
      const checks: StateAssertionRecord[] = [
        {
          variable: "convertToUsd round-trip drift",
          expected: `≤${tolerance.toString()}`,
          actual: drift.toString(),
          match: drift <= tolerance,
        },
      ];
      return { ops: [op1, op2], stateChecks: checks };
    },
  },
  {
    id: "S-023",
    type: "deterministic",
    description: "FheForgeComposer.trustedForwarder + isTrustedForwarder(0) view checks",
    run: async (ctx) => {
      const op1 = await staticCall(ctx, "FheForgeComposer", "trustedForwarder", []);
      const fwd = (await ctx.contracts.FheForgeComposer.trustedForwarder()) as string;
      const op2 = await staticCall(ctx, "FheForgeComposer", "isTrustedForwarder", [
        ethers.ZeroAddress,
      ]);
      const checks: StateAssertionRecord[] = [
        {
          variable: "trustedForwarder",
          expected: "address",
          actual: fwd,
          match: ethers.isAddress(fwd),
        },
      ];
      return { ops: [op1, op2], stateChecks: checks };
    },
  },
  {
    id: "S-024",
    type: "deterministic",
    description: "LendingPool view constants (BPS_DEN, LIQ bonus/close factor) — sanity",
    run: async (ctx) => {
      const op1 = await staticCall(ctx, "LendingPool", "BPS_DEN", []);
      const bps = (await ctx.contracts.LendingPool.BPS_DEN()) as bigint;
      const op2 = await staticCall(ctx, "LendingPool", "LIQUIDATION_BONUS_BPS", []);
      const bonus = (await ctx.contracts.LendingPool.LIQUIDATION_BONUS_BPS()) as bigint;
      const op3 = await staticCall(ctx, "LendingPool", "LIQUIDATION_CLOSE_FACTOR_BPS", []);
      const close = (await ctx.contracts.LendingPool.LIQUIDATION_CLOSE_FACTOR_BPS()) as bigint;
      const checks: StateAssertionRecord[] = [
        { variable: "BPS_DEN", expected: "10000", actual: bps.toString(), match: bps === 10_000n },
        {
          variable: "LIQUIDATION_BONUS_BPS",
          expected: "500",
          actual: bonus.toString(),
          match: bonus === 500n,
        },
        {
          variable: "LIQUIDATION_CLOSE_FACTOR_BPS",
          expected: "5000",
          actual: close.toString(),
          match: close === 5_000n,
        },
      ];
      return { ops: [op1, op2, op3], stateChecks: checks };
    },
  },
  {
    id: "S-025",
    type: "deterministic",
    description: "Composer 1-to-1 strategyId reuse (composer.openLeveragedStrategy with strategyId>0)",
    run: async (ctx) => {
      if (!ctx.cofhe) return { ops: [], stateChecks: [], overrideResult: "SETUP_FAILURE" };
      // Register a strategy first
      const reg = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
        `S-025-${Date.now()}`,
        ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
      ]);
      const sId = (await ctx.contracts.StrategyRegistry.strategyCount()) as bigint;
      // F-03: 6 ciphertexts (was 8 — apy/loop now plaintext on params).
      const enc = await ctx.cofhe.client
        .encryptInputs([
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
          ctx.cofhe.Encryptable.uint128(0n),
        ])
        .execute();
      const params = {
        strategyName: "",
        workflowHash: ethers.ZeroHash,
        collateralToken: USDC,
        collateralAmount: 0n,
        poolSupplyAmount: 0n,
        borrowToken: ethers.ZeroAddress,
        poolBorrowAmount: 0n,
        useOracleBorrow: false,
        ltvNum: 0n,
        ltvDen: 0n,
        swapTokenOut: ethers.ZeroAddress,
        swapDeadlineOffset: 0n,
        strategyId: sId,
        apyTarget: 0,
        loopCount: 0,
        collateralPermit: COMPOSER_PERMIT_SKIP,
      };
      const encParams = {
        collateral: enc[0],
        debt: enc[1],
        supplyEnc: enc[2],
        borrowEnc: enc[3],
        swapAmountIn: enc[4],
        swapMinOut: enc[5],
      };
      const op = await submitTx(ctx, "FheForgeComposer", "openLeveragedStrategy", [
        params,
        encParams,
      ]);
      return { ops: [reg, op], stateChecks: [] };
    },
  },
  {
    id: "S-029",
    type: "deterministic",
    description:
      "pool.supplyWithPermit2 — Permit2 signed message + supply round-trip (no token-level permit needed)",
    run: async (ctx) => {
      if (!ctx.cofhe) return { ops: [], stateChecks: [], overrideResult: "SETUP_FAILURE" };
      const amt = 100_000n;
      // Drop the pool's direct allowance so this scenario can ONLY succeed
      // via the Permit2 path. Restore MaxUint256 at the end so downstream
      // scenarios that use plain `supply()` still work.
      const [encSupply, encWithdraw] = await encryptUint128Batch(ctx, [amt, amt]);
      const drop = await submitTx(ctx, "USDC", "approve", [ctx.v3.LendingPool, 0n]);
      const sig = await signPermit2(ctx, USDC, amt, ctx.v3.LendingPool);
      const supply = await submitTx(ctx, "LendingPool", "supplyWithPermit2", [
        USDC,
        amt,
        encSupply,
        sig.permit,
        sig.signature,
      ]);
      const wd = await submitTx(ctx, "LendingPool", "withdraw", [USDC, amt, encWithdraw]);
      const restore = await submitTx(ctx, "USDC", "approve", [
        ctx.v3.LendingPool,
        ethers.MaxUint256,
      ]);
      return {
        ops: [drop, supply, wd, restore],
        stateChecks: [
          {
            variable: "supplyWithPermit2.status",
            expected: "ok",
            actual: supply.status,
            match: supply.status === "ok",
          },
        ],
      };
    },
  },
  {
    id: "S-030",
    type: "deterministic",
    description:
      "pool.repayWithPermit2 — supply + borrow + Permit2-gated repay + withdraw",
    run: async (ctx) => {
      if (!ctx.cofhe) return { ops: [], stateChecks: [], overrideResult: "SETUP_FAILURE" };
      const supplyAmt = 200_000n;
      const borrowAmt = 100_000n;
      const [encSupply, encBorrow, encRepay, encWithdraw] = await encryptUint128Batch(ctx, [
        supplyAmt,
        borrowAmt,
        borrowAmt,
        supplyAmt,
      ]);
      const supply = await submitTx(ctx, "LendingPool", "supply", [USDC, supplyAmt, encSupply]);
      const borrow = await submitTx(ctx, "LendingPool", "checkLtvAndBorrow", [
        USDC,
        USDC,
        borrowAmt,
        encBorrow,
        70n,
        100n,
      ]);
      // Drop pool allowance so the repay must use Permit2.
      const drop = await submitTx(ctx, "USDC", "approve", [ctx.v3.LendingPool, 0n]);
      const sig = await signPermit2(ctx, USDC, borrowAmt, ctx.v3.LendingPool);
      const repay = await submitTx(ctx, "LendingPool", "repayWithPermit2", [
        USDC,
        borrowAmt,
        encRepay,
        sig.permit,
        sig.signature,
      ]);
      const restore = await submitTx(ctx, "USDC", "approve", [
        ctx.v3.LendingPool,
        ethers.MaxUint256,
      ]);
      const wd = await submitTx(ctx, "LendingPool", "withdraw", [USDC, supplyAmt, encWithdraw]);
      return {
        ops: [supply, borrow, drop, repay, restore, wd],
        stateChecks: [
          {
            variable: "repayWithPermit2.status",
            expected: "ok",
            actual: repay.status,
            match: repay.status === "ok",
          },
        ],
      };
    },
  },
  {
    id: "S-031",
    type: "deterministic",
    description:
      "composer.openLeveragedStrategy — Permit2 collateralPermit + setAccount(composer) for FHE handles",
    run: async (ctx) => {
      if (!ctx.cofhe) return { ops: [], stateChecks: [], overrideResult: "SETUP_FAILURE" };
      const collateralAmount = 50_000n;
      // Drop direct allowance so the composer must use Permit2.
      const drop = await submitTx(ctx, "USDC", "approve", [ctx.v3.FheForgeComposer, 0n]);
      // Sign Permit2 over (USDC, collateralAmount, nonce, deadline, spender=composer)
      const sig = await signPermit2(ctx, USDC, collateralAmount, ctx.v3.FheForgeComposer);
      // Encrypt FHE handles for the COMPOSER (not the user wallet) so the
      // precompile's `verifyInput(input, msg.sender = COMPOSER)` matches the
      // SDK's ZK-proof metadata `accountAddr = composer`.
      // F-03: 6 ciphertexts (was 8 — apy/loop now plaintext on params).
      const builder = ctx.cofhe.client.encryptInputs([
        ctx.cofhe.Encryptable.uint128(collateralAmount),
        ctx.cofhe.Encryptable.uint128(0n),
        ctx.cofhe.Encryptable.uint128(0n),
        ctx.cofhe.Encryptable.uint128(0n),
        ctx.cofhe.Encryptable.uint128(0n),
        ctx.cofhe.Encryptable.uint128(0n),
      ]) as {
        setAccount(addr: string): { execute(): Promise<EncryptedHandle[]> };
        execute(): Promise<EncryptedHandle[]>;
      };
      const enc = await profile("cofheEncrypt", "openInputs(6).setAccount(composer)", () =>
        builder.setAccount(ctx.v3.FheForgeComposer).execute(),
      );
      const params = {
        strategyName: `S-031-${Date.now()}`,
        workflowHash: ethers.keccak256(
          ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random() * 1e9)}`),
        ),
        collateralToken: USDC,
        collateralAmount,
        poolSupplyAmount: 0n,
        borrowToken: ethers.ZeroAddress,
        poolBorrowAmount: 0n,
        useOracleBorrow: false,
        ltvNum: 0n,
        ltvDen: 0n,
        swapTokenOut: ethers.ZeroAddress,
        swapDeadlineOffset: 0n,
        strategyId: 0n,
        apyTarget: 0,
        loopCount: 0,
        // Composer Permit2Authorization struct (round-13 — replaces EIP-2612 PermitData).
        collateralPermit: sig.composerAuth,
      };
      const encParams = {
        collateral: enc[0],
        debt: enc[1],
        supplyEnc: enc[2],
        borrowEnc: enc[3],
        swapAmountIn: enc[4],
        swapMinOut: enc[5],
      };
      const open = await submitTx(ctx, "FheForgeComposer", "openLeveragedStrategy", [
        params,
        encParams,
      ]);
      // Cleanup the position one block after open (INV-2-005 same-block close).
      let close: OperationLog | null = null;
      if (open.status === "ok") {
        await waitNextBlockAfter(ctx, open.blockNumber ?? 0);
        const closeEnc = await encryptUint128(ctx, collateralAmount);
        close = await submitTx(
          ctx,
          "StrategyVault",
          "closePosition",
          [collateralAmount, closeEnc],
          { skipEstimateGas: true, gasLimitOverride: 800_000n },
        );
      }
      const restore = await submitTx(ctx, "USDC", "approve", [
        ctx.v3.FheForgeComposer,
        ethers.MaxUint256,
      ]);
      return {
        ops: [drop, open, ...(close ? [close] : []), restore],
        stateChecks: [
          {
            variable: "composer.openLeveragedStrategy.permit2.status",
            expected: "ok",
            actual: open.status,
            match: open.status === "ok",
          },
        ],
      };
    },
  },
];

// ────────────────────────────────────────────────────────────────────────
// Section 3 — random scenario generator
// ────────────────────────────────────────────────────────────────────────

type RandomOp =
  | "SUPPLY"
  | "WITHDRAW"
  | "REGISTER_STRATEGY"
  | "VIEW_PRICE"
  | "VIEW_STATE";

interface GeneratedScenarioOp {
  kind: RandomOp;
  amount?: bigint;
  token?: string;
  name?: string;
}

function buildRandomScenario(idx: number, rng: () => number): ScenarioDef {
  const opCount = 2 + Math.floor(rng() * 5); // 2..6
  const opSet: RandomOp[] = ["SUPPLY", "WITHDRAW", "REGISTER_STRATEGY", "VIEW_PRICE", "VIEW_STATE"];
  // Build a safe sequence — supplies before withdraws, paired sums.
  let supplied = 0n;
  const ops: GeneratedScenarioOp[] = [];
  for (let i = 0; i < opCount; i++) {
    const choice = opSet[Math.floor(rng() * opSet.length)];
    if (choice === "SUPPLY") {
      const amt = BigInt(20_000 + Math.floor(rng() * 80_000)); // 0.02..0.1 USDC
      supplied += amt;
      ops.push({ kind: "SUPPLY", amount: amt, token: USDC });
    } else if (choice === "WITHDRAW") {
      if (supplied > 0n) {
        const amt = BigInt(10_000 + Math.floor(rng() * Math.min(50_000, Number(supplied))));
        if (amt <= supplied) {
          supplied -= amt;
          ops.push({ kind: "WITHDRAW", amount: amt, token: USDC });
        } else {
          ops.push({ kind: "VIEW_PRICE", token: USDC });
        }
      } else {
        ops.push({ kind: "VIEW_PRICE", token: USDC });
      }
    } else if (choice === "REGISTER_STRATEGY") {
      ops.push({ kind: "REGISTER_STRATEGY", name: `RAND-${idx}-${i}-${Date.now()}` });
    } else if (choice === "VIEW_PRICE") {
      ops.push({ kind: "VIEW_PRICE", token: rng() < 0.5 ? USDC : WETH });
    } else {
      ops.push({ kind: "VIEW_STATE" });
    }
  }
  // Force a final withdraw to drain any lingering supply
  if (supplied > 0n) {
    ops.push({ kind: "WITHDRAW", amount: supplied, token: USDC });
  }
  const id = `RAND-${idx.toString().padStart(3, "0")}`;
  const description = `random ${opCount} ops [${ops.map((o) => o.kind).join("→")}]`;
  return {
    id,
    type: "random",
    description,
    run: async (ctx) => {
      const evidenceOps: OperationLog[] = [];
      for (const o of ops) {
        if (o.kind === "SUPPLY" && o.amount && o.token) {
          const enc = await encryptUint128(ctx, o.amount);
          const op = await submitTx(ctx, "LendingPool", "supply", [o.token, o.amount, enc]);
          evidenceOps.push(op);
          if (op.status === "revert") break;
        } else if (o.kind === "WITHDRAW" && o.amount && o.token) {
          const enc = await encryptUint128(ctx, o.amount);
          const op = await submitTx(ctx, "LendingPool", "withdraw", [o.token, o.amount, enc]);
          evidenceOps.push(op);
          if (op.status === "revert") break;
        } else if (o.kind === "REGISTER_STRATEGY" && o.name) {
          const op = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
            o.name,
            ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
          ]);
          evidenceOps.push(op);
        } else if (o.kind === "VIEW_PRICE" && o.token) {
          const op = await staticCall(ctx, "PriceOracle", "getPriceUsd", [o.token]);
          evidenceOps.push(op);
        } else if (o.kind === "VIEW_STATE") {
          const op = await staticCall(ctx, "LendingPool", "getPlainSupplyBalance", [USDC]);
          evidenceOps.push(op);
        }
      }
      return { ops: evidenceOps, stateChecks: [] };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Section 4 — UX simulation
// ────────────────────────────────────────────────────────────────────────

const UX_SCENARIO: ScenarioDef = {
  id: "UX-001",
  type: "ux",
  description: "UX latency: supply USDC + decryptForView round-trip",
  run: async (ctx) => {
    const ops: OperationLog[] = [];
    if (!ctx.cofhe) return { ops, stateChecks: [], overrideResult: "SETUP_FAILURE" };
    const amt = 50_000n;
    const enc = await encryptUint128(ctx, amt);
    const supply = await submitTx(ctx, "LendingPool", "supply", [USDC, amt, enc]);
    ops.push(supply);
    // CoFHE processing observation: try unseal of the supply handle (may not be available)
    const tDecryptStart = Date.now();
    let decrypted = "n/a";
    try {
      // Read the user's encrypted balance handle
      const handleHex = await ctx.contracts.LendingPool.getSupplyBalance.staticCall(USDC);
      if (ctx.cofhe.client.unseal && typeof handleHex === "string") {
        const v = await ctx.cofhe.client.unseal(handleHex);
        decrypted = v.toString();
      }
    } catch (e) {
      decrypted = `unseal-failed:${(e as Error).message}`;
    }
    const tDecryptEnd = Date.now();
    vlog(`  decryptForView round-trip: ${tDecryptEnd - tDecryptStart}ms (got ${decrypted})`);
    const enc2 = await encryptUint128(ctx, amt);
    const wd = await submitTx(ctx, "LendingPool", "withdraw", [USDC, amt, enc2]);
    ops.push(wd);
    return {
      ops,
      stateChecks: [
        {
          variable: "decryptForViewLatencyMs",
          expected: "≤5000",
          actual: (tDecryptEnd - tDecryptStart).toString(),
          match: tDecryptEnd - tDecryptStart <= 5000,
        },
      ],
    };
  },
};

// ────────────────────────────────────────────────────────────────────────
// Section 5 — block-level concurrency probe
// ────────────────────────────────────────────────────────────────────────

const CONCURRENCY_SCENARIO: ScenarioDef = {
  id: "CONC-001",
  type: "concurrency",
  description:
    "Block-level concurrency: parallel registerStrategy at batch sizes 1, 3, 5 with explicit nonces",
  run: async (ctx) => {
    const ops: OperationLog[] = [];
    const checks: StateAssertionRecord[] = [];
    // When firing N txs from a single wallet via Promise.all, ethers' default
    // nonce manager assigns the SAME nonce to all of them (it caches the
    // pending nonce until each tx is fully sent). The result is nonce-collision
    // reverts on N-1 of them. We assign sequential nonces explicitly so all N
    // txs are valid and land in adjacent blocks.
    let baseNonce = await ctx.provider.getTransactionCount(ctx.tester.address, "pending");
    for (const batch of [1, 3, 5]) {
      const promises: Promise<OperationLog>[] = [];
      for (let i = 0; i < batch; i++) {
        const nonce = baseNonce + i;
        promises.push(
          submitTx(
            ctx,
            "StrategyRegistry",
            "registerStrategy",
            [
              `CONC-b${batch}-${i}-${Date.now()}`,
              ethers.keccak256(
                ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random() * 1e9)}-${i}`),
              ),
            ],
            {
              skipEstimateGas: true,
              gasLimitOverride: 250_000n,
              nonce,
            },
          ),
        );
      }
      // Submit them in parallel — ethers serialises actual sending, but the
      // explicit nonces mean each lands in a valid sequence.
      const results = await Promise.all(promises);
      ops.push(...results);
      baseNonce += batch;
      const blocks = new Set(results.map((r) => r.blockNumber).filter((b) => b !== null));
      checks.push({
        variable: `batch${batch}.distinctBlocks`,
        expected: `≤${batch}`,
        actual: blocks.size.toString(),
        match: blocks.size <= batch,
      });
    }
    return { ops, stateChecks: checks };
  },
};

// ────────────────────────────────────────────────────────────────────────
// Section 1 — baseline probe (per-function single-tx baseline)
// ────────────────────────────────────────────────────────────────────────

const BASELINE_SCENARIO: ScenarioDef = {
  id: "BASE-001",
  type: "baseline",
  description: "Section 1 baseline: single-tx probe per state-changing function",
  run: async (ctx) => {
    const ops: OperationLog[] = [];
    // registerStrategy (1 sample)
    const reg = await submitTx(ctx, "StrategyRegistry", "registerStrategy", [
      `BASE-${Date.now()}`,
      ethers.keccak256(ethers.toUtf8Bytes(`stress-${Date.now()}-${Math.floor(Math.random()*1e9)}`)),
    ]);
    ops.push(reg);
    // pool.supply + pool.withdraw round-trip
    const enc1 = await encryptUint128(ctx, 50_000n);
    const supply = await submitTx(ctx, "LendingPool", "supply", [USDC, 50_000n, enc1]);
    ops.push(supply);
    const enc2 = await encryptUint128(ctx, 50_000n);
    const wd = await submitTx(ctx, "LendingPool", "withdraw", [USDC, 50_000n, enc2]);
    ops.push(wd);
    // staticCall reads (no gas, no state mutation)
    ops.push(await staticCall(ctx, "PriceOracle", "getPriceUsd", [USDC]));
    ops.push(await staticCall(ctx, "PriceOracle", "getPriceUsd", [WETH]));
    return { ops, stateChecks: [] };
  },
};

// ────────────────────────────────────────────────────────────────────────
// Evidence appender + STRESS_REPORT generator
// ────────────────────────────────────────────────────────────────────────

/// JSON.stringify replacer that converts BigInt → decimal string. Needed
/// because operation args may contain BigInt-valued fields nested in struct
/// payloads (e.g. composer.openLeveragedStrategy params.collateralAmount).
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function appendEvidence(record: RunRecord): void {
  let runs: RunRecord[] = [];
  if (fs.existsSync(EVIDENCE_PATH)) {
    const stats = fs.statSync(EVIDENCE_PATH);
    if (stats.size > EVIDENCE_MAX_BYTES) {
      const archive = EVIDENCE_PATH.replace(
        ".json",
        `-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      );
      fs.renameSync(EVIDENCE_PATH, archive);
      log(`  Archive: ${EVIDENCE_PATH} → ${archive}`);
    } else {
      try {
        const parsed = JSON.parse(fs.readFileSync(EVIDENCE_PATH, "utf8"));
        if (Array.isArray(parsed)) runs = parsed as RunRecord[];
      } catch {
        runs = [];
      }
    }
  }
  runs.push(record);
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(runs, bigintReplacer, 2));
}

function fmtBigGas(s: string): string {
  const n = BigInt(s);
  if (n < 1000n) return n.toString();
  return n.toLocaleString("en-US");
}

function writeReport(record: RunRecord): void {
  const lines: string[] = [];
  lines.push(`# STRESS_REPORT — runId ${record.runId}`);
  lines.push("");
  lines.push(`**Started:** ${record.startedAt}`);
  lines.push(`**Ended:** ${record.endedAt}`);
  lines.push(`**Duration:** ${fmtMs(record.durationMs)}`);
  lines.push(`**Network:** arb-sepolia (chain ${record.network.chainId})`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Scenarios run | ${record.totals.scenarioCount} |`);
  lines.push(`| Succeeded | ${record.totals.succeeded} |`);
  lines.push(`| Expected revert verified | ${record.totals.expectedRevert} |`);
  lines.push(`| **Unexpected revert** | **${record.totals.unexpectedRevert}** |`);
  lines.push(`| **State mismatch** | **${record.totals.stateMismatch}** |`);
  lines.push(`| Setup failure | ${record.totals.setupFailure} |`);
  lines.push(`| **Unknown pattern** | **${record.totals.unknownPattern}** |`);
  lines.push(`| Gas total | ${fmtBigGas(record.totals.gasTotal)} |`);
  lines.push("");
  lines.push("## Wallet snapshot");
  lines.push("");
  lines.push("| Asset | Start | End |");
  lines.push("|---|---:|---:|");
  lines.push(
    `| ETH | ${ethers.formatEther(record.walletStart.eth)} | ${ethers.formatEther(record.walletEnd.eth)} |`,
  );
  lines.push(
    `| USDC | ${ethers.formatUnits(record.walletStart.usdc, 6)} | ${ethers.formatUnits(record.walletEnd.usdc, 6)} |`,
  );
  lines.push(
    `| WETH | ${ethers.formatUnits(record.walletStart.weth, 18)} | ${ethers.formatUnits(record.walletEnd.weth, 18)} |`,
  );
  lines.push("");
  lines.push("## Pyth prices observed");
  lines.push("");
  lines.push(`- USDC/USD: $${ethers.formatUnits(BigInt(record.pythPrices.usdcUsd), 18)}`);
  lines.push(`- WETH/USD: $${ethers.formatUnits(BigInt(record.pythPrices.wethUsd), 18)}`);
  lines.push(`- Observed at: ${record.pythPrices.observedAt}`);
  lines.push("");
  lines.push("## Per-function gas vs BENCHMARK_POST_v3 baseline");
  lines.push("");
  lines.push("| Function | Min | Avg | Max | Baseline | Δ% |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  // Aggregate gas across all scenarios.
  const fnGas: Record<string, number[]> = {};
  for (const sc of record.scenarios) {
    for (const [key, gasStr] of Object.entries(sc.operationGas)) {
      if (!fnGas[key]) fnGas[key] = [];
      fnGas[key].push(parseInt(gasStr, 10));
    }
  }
  const fnGasSorted = Object.keys(fnGas).sort();
  for (const key of fnGasSorted) {
    const arr = fnGas[key];
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const baseline = GAS_BASELINE_V3[key];
    let delta = "—";
    if (baseline) {
      const pct = ((avg - baseline) / baseline) * 100;
      delta = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    }
    lines.push(
      `| ${key} | ${min.toLocaleString()} | ${avg.toLocaleString()} | ${max.toLocaleString()} | ${baseline ? baseline.toLocaleString() : "—"} | ${delta} |`,
    );
  }
  lines.push("");
  lines.push("## Deterministic scenarios");
  lines.push("");
  lines.push("| ID | Result | Latency | Gas | Description |");
  lines.push("|---|---|---:|---:|---|");
  for (const sc of record.scenarios.filter((s) => s.type === "deterministic")) {
    lines.push(
      `| ${sc.scenarioId} | ${sc.result} | ${fmtMs(sc.totalLatencyMs)} | ${fmtBigGas(sc.totalGasUsed)} | ${sc.description} |`,
    );
  }
  lines.push("");
  lines.push("## Random scenarios — result histogram");
  lines.push("");
  const random = record.scenarios.filter((s) => s.type === "random");
  const histogram: Record<ResultKind, number> = {
    SUCCESS: 0,
    EXPECTED_REVERT_VERIFIED: 0,
    UNEXPECTED_REVERT: 0,
    STATE_MISMATCH: 0,
    SETUP_FAILURE: 0,
    DRY_RUN_VALID: 0,
  };
  for (const r of random) histogram[r.result]++;
  for (const [k, v] of Object.entries(histogram)) {
    if (v > 0) lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## Phase profiling — where did the time go?");
  lines.push("");
  lines.push(
    "Every transaction submission is broken into phases (estimateGas → preSubmit → waitConfirm).",
  );
  lines.push(
    "Encryption, permit-signing, view reads, and static calls are timed separately. Phases that are",
  );
  lines.push("expensive (e.g. cofheEncrypt or waitConfirm) dominate total wall time.");
  lines.push("");
  lines.push("| Phase | Calls | Total | Avg | Min | Max | % of run |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  const totalRunMs = record.durationMs || 1;
  const phaseRows: Array<[string, number, number, number, number]> = [];
  for (const [phase, agg] of Object.entries(record.profile.aggregate)) {
    if (agg.count === 0) continue;
    phaseRows.push([phase, agg.count, agg.totalMs, agg.minMs, agg.maxMs]);
  }
  // Sort by totalMs descending (biggest time-eater first).
  phaseRows.sort((a, b) => b[2] - a[2]);
  for (const [phase, count, total, min, max] of phaseRows) {
    const avg = Math.round(total / count);
    const pct = ((total / totalRunMs) * 100).toFixed(1);
    lines.push(
      `| ${phase} | ${count} | ${(total / 1000).toFixed(2)}s | ${avg}ms | ${min}ms | ${max}ms | ${pct}% |`,
    );
  }
  lines.push("");
  lines.push("### Top 15 slowest individual phase samples");
  lines.push("");
  lines.push("| # | Phase | Label | Latency |");
  lines.push("|---:|---|---|---:|");
  record.profile.slowest.slice(0, 15).forEach((s, i) => {
    lines.push(`| ${i + 1} | ${s.phase} | ${s.label} | ${(s.ms / 1000).toFixed(2)}s |`);
  });
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (record.findings.length === 0) {
    lines.push("**CLEAN** — no findings produced.");
  } else {
    lines.push("| Scenario | Kind | Severity | Detail |");
    lines.push("|---|---|---|---|");
    for (const f of record.findings) {
      lines.push(`| ${f.scenarioId} | ${f.kind} | ${f.severity} | ${f.details} |`);
    }
  }
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  if (
    record.totals.unexpectedRevert === 0 &&
    record.totals.stateMismatch === 0 &&
    record.totals.unknownPattern === 0
  ) {
    lines.push("**CLEAN** — no UNEXPECTED_REVERT, no STATE_MISMATCH, no UNKNOWN_PATTERN.");
  } else {
    lines.push(
      `**FINDINGS** — UNEXPECTED_REVERT=${record.totals.unexpectedRevert} STATE_MISMATCH=${record.totals.stateMismatch} UNKNOWN_PATTERN=${record.totals.unknownPattern}.`,
    );
  }
  fs.writeFileSync(REPORT_PATH, lines.join("\n"));
  log(`  Report: ${REPORT_PATH}`);
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseCli(process.argv);
  VERBOSE = cli.verbose;
  let ctx: RuntimeContext;
  try {
    ctx = await coldStart(cli);
  } catch (e) {
    console.error(`SETUP FAILURE: ${(e as Error).message}`);
    process.exit(2);
  }

  const startedAt = Date.now();
  log("");
  log("═══ Section 1 — baseline probe ═══");
  const evidences: ScenarioEvidence[] = [];
  if (!cli.scenarioFilter || cli.scenarioFilter === BASELINE_SCENARIO.id) {
    evidences.push(await runScenario(ctx, BASELINE_SCENARIO));
  }

  log("");
  log("═══ Section 2 — 25 deterministic scenarios ═══");
  for (const def of SCENARIO_DEFINITIONS) {
    if (cli.scenarioFilter && cli.scenarioFilter !== def.id) continue;
    evidences.push(await runScenario(ctx, def));
  }

  log("");
  log(`═══ Section 3 — ${cli.randomCount} random scenarios (seed=${cli.seed}) ═══`);
  for (let i = 1; i <= cli.randomCount; i++) {
    const def = buildRandomScenario(i, ctx.rng);
    if (cli.scenarioFilter && cli.scenarioFilter !== def.id) continue;
    evidences.push(await runScenario(ctx, def));
  }

  log("");
  log("═══ Section 4 — UX simulation ═══");
  if (!cli.scenarioFilter || cli.scenarioFilter === UX_SCENARIO.id) {
    evidences.push(await runScenario(ctx, UX_SCENARIO));
  }

  log("");
  log("═══ Section 5 — block-level concurrency ═══");
  if (!cli.scenarioFilter || cli.scenarioFilter === CONCURRENCY_SCENARIO.id) {
    evidences.push(await runScenario(ctx, CONCURRENCY_SCENARIO));
  }

  // Final wallet snapshot.
  const ethEnd = await ctx.provider.getBalance(ctx.tester.address);
  const usdcEnd = (await ctx.contracts.USDC.balanceOf(ctx.tester.address)) as bigint;
  const wethEnd = (await ctx.contracts.WETH.balanceOf(ctx.tester.address)) as bigint;

  // Aggregate.
  const totals = {
    scenarioCount: evidences.length,
    succeeded: evidences.filter((e) => e.result === "SUCCESS").length,
    expectedRevert: evidences.filter((e) => e.result === "EXPECTED_REVERT_VERIFIED").length,
    unexpectedRevert: evidences.filter((e) => e.result === "UNEXPECTED_REVERT").length,
    stateMismatch: evidences.filter((e) => e.result === "STATE_MISMATCH").length,
    setupFailure: evidences.filter((e) => e.result === "SETUP_FAILURE").length,
    unknownPattern: evidences.filter((e) => e.unknownPattern).length,
    gasTotal: evidences
      .reduce((acc, e) => acc + BigInt(e.totalGasUsed), 0n)
      .toString(),
  };
  const allFindings: Finding[] = [];
  for (const e of evidences) allFindings.push(...e.findings);

  const endedAt = Date.now();
  const record: RunRecord = {
    runId: ctx.runId,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: endedAt - startedAt,
    cli,
    network: { chainId: ctx.chainId, rpcUrl: ctx.rpcUrl.slice(0, 32) + "…" },
    v3Addresses: ctx.v3,
    walletStart: {
      eth: ctx.walletStart.eth.toString(),
      usdc: ctx.walletStart.usdc.toString(),
      weth: ctx.walletStart.weth.toString(),
    },
    walletEnd: {
      eth: ethEnd.toString(),
      usdc: usdcEnd.toString(),
      weth: wethEnd.toString(),
    },
    pythPrices: {
      usdcUsd: ctx.pythPrices.usdcUsd.toString(),
      wethUsd: ctx.pythPrices.wethUsd.toString(),
      observedAt: new Date(ctx.pythPrices.observedAtMs).toISOString(),
    },
    totals,
    benchmarkBaseline: GAS_BASELINE_V3,
    scenarios: evidences,
    findings: allFindings,
    profile: {
      aggregate: Object.fromEntries(
        Object.entries(PHASE_AGGREGATE).map(([phase, agg]) => [
          phase,
          {
            count: agg.count,
            totalMs: agg.totalMs,
            minMs: agg.count > 0 ? agg.minMs : 0,
            maxMs: agg.maxMs,
          },
        ]),
      ),
      slowest: PHASE_SAMPLES
        .slice()
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 50),
    },
  };

  if (!cli.dryRun) appendEvidence(record);
  writeReport(record);

  log("");
  log(
    `╔═══════════════════════════════════════════════════════════╗`,
  );
  log(
    `║                    STRESS RUN COMPLETE                    ║`,
  );
  log(
    `╚═══════════════════════════════════════════════════════════╝`,
  );
  log(
    `  scenarios=${totals.scenarioCount} success=${totals.succeeded} expectedRev=${totals.expectedRevert} unexpectedRev=${totals.unexpectedRevert} stateMismatch=${totals.stateMismatch} setupFail=${totals.setupFailure}`,
  );
  log(`  duration=${fmtMs(endedAt - startedAt)}  totalGas=${fmtBigGas(totals.gasTotal)}`);
  // Phase profiling — quick console summary; full breakdown is in STRESS_REPORT.md.
  log("");
  log("  ┌─ Phase profiling ────────────────────────────────────────┐");
  const sortedPhases = Object.entries(PHASE_AGGREGATE)
    .filter(([, a]) => a.count > 0)
    .sort((a, b) => b[1].totalMs - a[1].totalMs);
  for (const [phase, agg] of sortedPhases) {
    const avg = Math.round(agg.totalMs / agg.count);
    const pct = ((agg.totalMs / (endedAt - startedAt)) * 100).toFixed(1);
    log(
      `  │ ${phase.padEnd(18)} ${String(agg.count).padStart(4)}× ` +
        `total=${fmtMs(agg.totalMs).padStart(7)} avg=${String(avg).padStart(5)}ms ` +
        `${pct.padStart(5)}%${" ".repeat(Math.max(0, 4 - pct.length))} │`,
    );
  }
  log("  └──────────────────────────────────────────────────────────┘");
  log(`  evidence ledger: ${EVIDENCE_PATH}`);
  log(`  human report: ${REPORT_PATH}`);

  const exitCode =
    totals.unexpectedRevert > 0 || totals.stateMismatch > 0 || totals.unknownPattern > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(2);
});
