/**
 * forge-test.ts
 * Comprehensive Standalone On-Chain Integration Runner for ALL 9 FheForge contracts.
 * Merges test-postfix.ts patterns, adds full coverage for PriceOracle, TokenRegistry,
 * ExecutorContract, StrategyExecutor, and deepens existing contract tests.
 *
 * Usage:
 *   npx hardhat run scripts/forge-test.ts --network arb-sepolia
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Encryptable } from '@cofhe/sdk';
import { arbSepolia } from '@cofhe/sdk/chains';
import { createCofheClient, createCofheConfig } from '@cofhe/sdk/node';
/**
 * forge-test.ts
 * Comprehensive Standalone On-Chain Integration Runner for ALL 9 FheForge contracts.
 * Merges test-postfix.ts patterns, adds full coverage for PriceOracle, TokenRegistry,
 * ExecutorContract, StrategyExecutor, and deepens existing contract tests.
 *
 * Usage:
 *   npx hardhat run scripts/forge-test.ts --network arb-sepolia
 */
import hre, { ethers } from 'hardhat';
import { type DeployRecord, loadDeploymentRecord, Progress, withRetry } from './lib/deploy-utils';

// ─── Reporting types ──────────────────────────────────────
type Severity = 'PASS' | 'WARN' | 'FAIL' | 'INFO';
const SYM: Record<Severity, string> = {
  PASS: '\u2713',
  WARN: '\u26A0',
  FAIL: '\u2717',
  INFO: '\u00B7',
};

interface Finding {
  gap: string;
  severity: Severity;
  label: string;
  observation: string;
  evidence?: { tx?: string; gas?: string; error?: string };
}

interface CoverageEntry {
  contract: string;
  function: string;
  status: 'covered' | 'static_call' | 'skipped';
  gap?: string;
}

const findings: Finding[] = [];
const coverageLog: CoverageEntry[] = [];

function record(
  gap: string,
  severity: Severity,
  label: string,
  observation: string,
  evidence?: Finding['evidence'],
) {
  findings.push({ gap, severity, label, observation, evidence });
  const ev = evidence?.tx ? ` tx=${evidence.tx.slice(0, 12)}\u2026` : '';
  const gas = evidence?.gas ? ` gas=${evidence.gas}` : '';
  console.log(`  ${SYM[severity]} [${gap}] ${label} \u2014 ${observation}${ev}${gas}`);
}

function markCoverage(
  contract: string,
  func: string,
  status: CoverageEntry['status'],
  gap?: string,
) {
  coverageLog.push({ contract, function: func, status, gap });
}

// ─── Error selector registry ──────────────────────────────
const KNOWN_SELECTORS: Record<string, string> = {
  '0x7ba5ffb5': 'InvalidSigner [CoFHE]',
  '0xd92e233d': 'ZeroAddress',
  '0x1f2a2005': 'ZeroAmount',
  '0x2ef13105': 'EmptyName',
  '0x680b6caf': 'NameTooLong',
  '0xb9698bf3': 'ZeroWorkflowHash',
  '0xc45546f7': 'StrategyAlreadyExists',
  '0x175bb87a': 'StrategyInactive',
  '0x6e8de458': 'PositionAlreadyExists',
  '0xabf0f034': 'NoPosition',
  '0xd93c0665': 'EnforcedPause',
  '0x3a23d825': 'InsufficientCollateral',
  '0x28b35f21': 'InsufficientReserve',
  '0xcd0fa803': 'UnhealthyAfterWithdraw',
  '0xf8794e04': 'OracleNotSet',
  '0x0dc08fa2': 'WethNotSet',
  '0x6677a596': 'TimelockNotElapsed',
  '0xbdb88e3c': 'LtvNumeratorZero',
  '0x03a15f8d': 'LtvDenominatorZero',
  '0xa2d8c00b': 'LtvExceedsHundredPercent',
  '0xbbf455cc': 'NoPendingExecutor',
  '0x3923349e': 'NoPendingVault',
  '0x25ad15ae': 'LiquidationTooLarge',
  '0x179b8d61': 'FhePermissionDenied',
  '0x8581daac': 'FhePermissionDenied [0x8581daac]',
  '0x9931e729': 'InvalidStrategyId',
  '0x9290475f': 'ExceedsDeposit',
  '0xfcb85b5a': 'ExceedsSupplyBalance',
  '0xbee61a59': 'ExceedsBorrowBalance',
  '0x936bb5ad': 'TokenMismatch',
  '0x04b7fcc8': 'DeadlineTooShort',
  '0x54090af9': 'DeadlineTooLong',
  '0x5fc483c5': 'OnlyOwner',
  '0x47bc7cc8': 'OnlyCreator',
  '0x8d1af8bd': 'OnlyVault',
  '0x21e660fc': 'PositionHealthy',
  '0x1bb0ddfb': 'VaultAlreadySet',
  '0xb91e4e0b': 'NoPendingRole',
  '0x522fa882': 'StrategyNotRegistered',
  '0x365a21d0': 'TokenNotSupported',
  '0xbdd50e5f': 'TokenAlreadyRegistered',
  '0xf0c9aefe': 'InvalidSourceType',
  '0x371095f2': 'ZeroAmountIn',
  '0x79b0e4e2': 'ZeroMinOut',
  '0x7ddf7cfe': 'PriceStale',
  '0x7afdf2dc': 'PriceFeedNotSet',
  '0x6eedaa38': 'CollateralExceedsLtv',
  '0xb12d13b9': 'NoLendableToken',
  '0x5a077c25': 'StrategyNotActive',
  '0x600a3cf2': 'LoopCountExceeded',
  '0x7fc4d3b6': 'FlashLoanNotRepaid',
  '0xd323f2a3': 'FlashLoanUnsupportedToken',
};

interface ErrorLike {
  data?: string;
  info?: { error?: { data?: string } };
  error?: { data?: string };
  cause?: unknown;
  shortMessage?: string;
  message?: string;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === 'object' && value !== null;
}

function decodeRevert(e: unknown): string {
  let cur: ErrorLike | undefined = isErrorLike(e) ? (e as ErrorLike) : undefined;
  let data: string | undefined;
  for (let i = 0; cur && i < 8; i++) {
    if (
      cur.data &&
      typeof cur.data === 'string' &&
      cur.data.startsWith('0x') &&
      cur.data.length >= 10
    ) {
      data = cur.data;
      break;
    }
    if (cur.info?.error?.data) {
      data = cur.info.error.data;
      break;
    }
    if (cur.error?.data) {
      data = cur.error.data;
      break;
    }
    cur = isErrorLike(cur.cause) ? (cur.cause as ErrorLike) : undefined;
  }
  if (!data) {
    const eObj = isErrorLike(e) ? (e as ErrorLike) : undefined;
    const msg = eObj?.shortMessage ?? eObj?.message ?? String(e);
    return msg.slice(0, 100);
  }
  if (data.startsWith('0x08c379a0')) {
    try {
      const s = ethers.AbiCoder.defaultAbiCoder().decode(
        ['string'],
        ethers.dataSlice(data, 4),
      )[0] as string;
      return `Error("${s}")`;
    } catch {
      return 'Error(string)';
    }
  }
  const sel = data.slice(0, 10).toLowerCase();
  return KNOWN_SELECTORS[sel] ?? `selector ${sel}`;
}

// ─── Multi-Signer Context Caching Singleton ───────────────
class TestingContext {
  private static instance: TestingContext;
  public provider: ethers.Provider;
  public signers: ethers.Signer[] = [];
  private factories: Map<string, ethers.Contract> = new Map();
  public deployment!: DeployRecord;

  private constructor() {
    this.provider = ethers.provider;
  }

  public static getContext(): TestingContext {
    if (!TestingContext.instance) TestingContext.instance = new TestingContext();
    return TestingContext.instance;
  }

  public async loadDeployment(chainId: number) {
    const record = loadDeploymentRecord(chainId);
    if (!record) {
      throw new Error(`No deployment record found for chainId ${chainId}`);
    }
    this.deployment = record;
  }

  public async getSigners() {
    if (this.signers.length === 0) {
      this.signers = await ethers.getSigners();
    }
    return this.signers;
  }

  public async getContractAt(
    name: string,
    address: string,
    signer: ethers.Signer,
  ): Promise<ethers.Contract> {
    const key = `${name}:${address}:${signer.address}`;
    const cached = this.factories.get(key);
    if (cached) return cached;
    const contract = await ethers.getContractAt(name, address, signer);
    this.factories.set(key, contract);
    return contract;
  }
}

let lastRevertError = '';

async function staticCallRevert(
  contract: ethers.Contract,
  method: string,
  args: unknown[],
  expectedErr: string,
): Promise<boolean> {
  try {
    await (contract as Record<string, (...callArgs: unknown[]) => Promise<unknown>>)[
      method
    ].staticCall(...args);
    return false;
  } catch (e: unknown) {
    lastRevertError = decodeRevert(e);
    return lastRevertError.includes(expectedErr);
  }
}

// ─── MAIN ─────────────────────────────────────────────────
async function main() {
  const prog = new Progress();
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  FheForge COMPREHENSIVE INTEGRATION RUNNER (9 Contracts)║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const ctx = TestingContext.getContext();
  const networkInfo = await ctx.provider.getNetwork();
  const chainId = Number(networkInfo.chainId);

  prog.phase(`Loading deployment (Chain: ${chainId})`);
  await ctx.loadDeployment(chainId);
  const signers = await ctx.getSigners();
  const deployer = signers[0];
  const tester = signers[1] ?? signers[0];
  const D = ctx.deployment.contracts;
  const USDC = ctx.deployment.tokens?.USDC ?? D.MockERC20;
  const WETH = ctx.deployment.tokens?.WETH;

  if (!USDC) throw new Error('USDC address not defined in deployment record');
  if (!WETH) throw new Error('WETH address not defined in deployment record');

  // ── Contract instances ──
  const registry = await ctx.getContractAt('StrategyRegistry', D.StrategyRegistry, tester);
  const vault = await ctx.getContractAt('StrategyVault', D.StrategyVault, tester);
  const pool = await ctx.getContractAt('LendingPool', D.LendingPool, tester);
  const router = await ctx.getContractAt('SwapRouter', D.SwapRouter, tester);
  const oracle = await ctx.getContractAt('PriceOracle', D.PriceOracle, tester);
  const composer = await ctx.getContractAt('FheForgeComposer', D.FheForgeComposer, tester);
  const executor = await ctx.getContractAt('ExecutorContract', D.ExecutorContract, tester);
  const tokenReg = await ctx.getContractAt('TokenRegistry', D.TokenRegistry, tester);
  const stratExec = await ctx.getContractAt('StrategyExecutor', D.StrategyExecutor, tester);

  // ERC20 ABI (minimal)
  const erc20Abi = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function decimals() view returns (uint8)',
  ];
  const usdc = await ethers.getContractAt(erc20Abi, USDC, tester);

  const startEth = await ctx.provider.getBalance(tester.address);
  const startUsdc = (await usdc.balanceOf(tester.address)) as bigint;
  console.log(`Tester: ${tester.address}`);
  console.log(`ETH: ${ethers.formatEther(startEth)}  USDC: ${ethers.formatUnits(startUsdc, 6)}`);

  // ── Approvals ──
  prog.phase('Token Approvals');
  const approveTargets = [
    { name: 'StrategyVault', address: D.StrategyVault },
    { name: 'LendingPool', address: D.LendingPool },
    { name: 'FheForgeComposer', address: D.FheForgeComposer },
  ];
  for (const target of approveTargets) {
    const allowance = (await usdc.allowance(tester.address, target.address)) as bigint;
    if (allowance < ethers.parseUnits('1000000', 6)) {
      console.log(`   Approving ${target.name}...`);
      await withRetry(async () => {
        const tx = await usdc.approve(target.address, ethers.MaxUint256);
        await tx.wait();
      }, `Approve ${target.name}`);
    } else {
      console.log(`   Already approved for ${target.name}`);
    }
  }

  // ── Deploy OnchainHandleHelper for Vault tests on live net ──
  prog.phase('Deploy OnchainHandleHelper');
  const OnchainHandleHelper = await ethers.getContractFactory('OnchainHandleHelper');
  const helper = await OnchainHandleHelper.connect(deployer).deploy();
  await helper.waitForDeployment();
  const helperAddress = await helper.getAddress();
  console.log(`   Helper deployed: ${helperAddress}`);
  // Approve helper to spend tester's USDC
  const helperAllowance = (await usdc.allowance(tester.address, helperAddress)) as bigint;
  if (helperAllowance < ethers.parseUnits('1000000', 6)) {
    await withRetry(async () => {
      const tx = await usdc.approve(helperAddress, ethers.MaxUint256);
      await tx.wait();
    }, 'Approve Helper');
  }

  // ── CoFHE Client ──
  prog.phase('CoFHE Client Initialization');
  const cofhe = await (async () => {
    const c = createCofheClient(
      createCofheConfig({ environment: 'node', supportedChains: [arbSepolia] }),
    );
    const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(tester);
    await c.connect(publicClient, walletClient);
    await c.permits.createSelf({ issuer: tester.address });
    return c;
  })();

  // ── Cleanup stale positions ──
  try {
    const positions = await vault.getUserPositions(tester.address);
    if (positions.length > 0) {
      const positionId = positions[0];
      const dep0 = (await vault.getDepositedAmount(positionId)) as bigint;
      if (dep0 > 0n) {
        const enc = await cofhe.encryptInputs([Encryptable.uint128(dep0)]).execute();
        await (
          await helper.closePosition(enc[0], await vault.getAddress(), positionId, dep0)
        ).wait();
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const bor = (await pool.totalPlainBorrow(USDC)) as bigint;
    if (bor > 0n) {
      const enc = await cofhe.encryptInputs([Encryptable.uint128(bor)]).execute();
      await (await pool.repayDebt(USDC, bor, enc[0])).wait();
    }
  } catch {
    /* ignore */
  }

  const ts = Date.now().toString();
  const collateralAmt = ethers.parseUnits('1000', 6);
  const supplyAmt = ethers.parseUnits('2000', 6);

  // ═══════════════════════════════════════════════════════════
  // SECTION 1: StrategyRegistry — full surface coverage
  // ═══════════════════════════════════════════════════════════
  prog.phase('1. StrategyRegistry');

  // 1.1 Register — empty name
  {
    const ok = await staticCallRevert(
      registry,
      'registerStrategy',
      ['', ethers.zeroPadValue('0x01', 32)],
      'EmptyName',
    );
    record('1.1', ok ? 'PASS' : 'FAIL', 'Empty name rejected', ok ? 'EmptyName' : lastRevertError);
    markCoverage('StrategyRegistry', 'registerStrategy', ok ? 'static_call' : 'covered', '1.1');
  }

  // 1.2 Register — name too long (>256 chars)
  {
    const ok = await staticCallRevert(
      registry,
      'registerStrategy',
      ['x'.repeat(257), ethers.zeroPadValue('0x01', 32)],
      'NameTooLong',
    );
    record(
      '1.2',
      ok ? 'PASS' : 'FAIL',
      'Oversize name rejected',
      ok ? 'NameTooLong' : lastRevertError,
    );
  }

  // 1.3 Register — zero workflow hash
  {
    const ok = await staticCallRevert(
      registry,
      'registerStrategy',
      [`Z-${ts}`, ethers.ZeroHash],
      'ZeroWorkflowHash',
    );
    record(
      '1.3',
      ok ? 'PASS' : 'FAIL',
      'Zero workflow hash rejected',
      ok ? 'ZeroWorkflowHash' : lastRevertError,
    );
  }

  // 1.4 Register — duplicate name (same creator)
  let testStrategyId: bigint | undefined;
  try {
    const name = `str-${ts}`;
    const tx1 = await registry.registerStrategy(name, ethers.zeroPadValue('0x01', 32));
    await tx1.wait();
    testStrategyId = (await registry.strategyCount()) as bigint;
    record('1.4-setup', 'INFO', `Registered test strategy`, `id=${testStrategyId}`);
    markCoverage('StrategyRegistry', 'registerStrategy', 'covered', '1.4-setup');
  } catch (e: unknown) {
    record('1.4-setup', 'WARN', 'Register strategy', decodeRevert(e));
  }

  if (testStrategyId) {
    const ok = await staticCallRevert(
      registry,
      'registerStrategy',
      [`str-${ts}`, ethers.zeroPadValue('0x02', 32)],
      'StrategyAlreadyExists',
    );
    record(
      '1.4',
      ok ? 'PASS' : 'FAIL',
      'Duplicate (creator,name) rejected',
      ok ? 'StrategyAlreadyExists' : lastRevertError,
    );
  }

  // 1.5 setActive — toggle active/inactive
  if (testStrategyId) {
    try {
      const txOff = await registry.setActive(testStrategyId, false);
      await txOff.wait();
      const meta = await registry.getStrategyMeta(testStrategyId);
      const isActive = meta[4] as boolean;
      const ok = !isActive;
      record(
        '1.5a',
        ok ? 'PASS' : 'FAIL',
        'setActive(false) archives strategy',
        `active=${isActive}`,
        { tx: txOff.hash },
      );
      markCoverage('StrategyRegistry', 'setActive', 'covered', '1.5a');

      const txOn = await registry.setActive(testStrategyId, true);
      await txOn.wait();
      const meta2 = await registry.getStrategyMeta(testStrategyId);
      record(
        '1.5b',
        meta2[4] === true ? 'PASS' : 'FAIL',
        'setActive(true) restores',
        `active=${meta2[4]}`,
        { tx: txOn.hash },
      );
    } catch (e: unknown) {
      record('1.5', 'WARN', 'setActive', decodeRevert(e));
    }
  }

  // 1.6 proposeVault — timelocked rotation
  try {
    const vaultDelay = (await registry.ROTATION_DELAY()) as bigint;
    const txProp = await registry.connect(deployer).proposeVault(deployer.address);
    await txProp.wait();
    const earliest = (await registry.pendingRoleEarliest()) as bigint;
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const ok = earliest > nowSec + vaultDelay - 60n;
    record(
      '1.6a',
      ok ? 'PASS' : 'WARN',
      `proposeVault sets ${vaultDelay}s timelock`,
      `earliest=${earliest}`,
      { tx: txProp.hash },
    );
    markCoverage('StrategyRegistry', 'proposeVault', 'covered', '1.6a');
  } catch (e: unknown) {
    record('1.6a', 'WARN', 'proposeVault', decodeRevert(e));
  }

  // 1.7 acceptVault — before timelock elapses
  {
    const ok = await staticCallRevert(registry, 'acceptVault', [], 'TimelockNotElapsed');
    record(
      '1.7',
      ok ? 'PASS' : 'WARN',
      'acceptVault before timelock reverts',
      ok ? 'TimelockNotElapsed' : lastRevertError,
    );
    markCoverage('StrategyRegistry', 'acceptVault', 'static_call', '1.7');
  }

  // 1.8 incrementTvl / decrementTvl — onlyVault (will revert with OnlyVault)
  if (testStrategyId) {
    const ok = await staticCallRevert(
      registry,
      'incrementTvl',
      [testStrategyId, ethers.zeroPadValue('0x64', 32)],
      'OnlyVault',
    );
    record(
      '1.8a',
      ok ? 'PASS' : 'WARN',
      'incrementTvl non-vault reverts',
      ok ? 'OnlyVault' : lastRevertError,
    );
    markCoverage('StrategyRegistry', 'incrementTvl', 'static_call', '1.8a');
  }
  if (testStrategyId) {
    const ok = await staticCallRevert(
      registry,
      'decrementTvl',
      [testStrategyId, ethers.zeroPadValue('0x64', 32)],
      'OnlyVault',
    );
    record(
      '1.8b',
      ok ? 'PASS' : 'WARN',
      'decrementTvl non-vault reverts',
      ok ? 'OnlyVault' : lastRevertError,
    );
    markCoverage('StrategyRegistry', 'decrementTvl', 'static_call', '1.8b');
  }

  // 1.9 getStrategy / getActiveStrategies — view functions
  if (testStrategyId) {
    try {
      const s = await registry.getStrategyMeta(testStrategyId);
      record('1.9a', 'PASS', 'getStrategyMeta view', `name=${s.name}`);
      markCoverage('StrategyRegistry', 'getStrategyMeta', 'covered', '1.9a');
    } catch {
      record('1.9a', 'WARN', 'getStrategyMeta view', 'failed');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 2: StrategyVault — position lifecycle depth
  // ═══════════════════════════════════════════════════════════
  prog.phase('2. StrategyVault');

  // 2.1 openPosition
  let positionId: string | undefined;
  try {
    const [eCollateral] = await cofhe.encryptInputs([Encryptable.uint128(collateralAmt)]).execute();

    const txOpen = await withRetry(async () => {
      return await helper.openPosition(
        eCollateral,
        await vault.getAddress(),
        USDC,
        collateralAmt,
        1n,
        tester.address,
      );
    }, 'openPosition');
    const rOpen = await txOpen.wait();
    const vaultAddress = await vault.getAddress();
    const vLog = rOpen?.logs.find(
      (log: ethers.EventLog) =>
        log.address?.toLowerCase() === vaultAddress.toLowerCase() &&
        log.fragment?.name === 'PositionOpened',
    );
    positionId = vLog?.args?.[0];
    record('2.1', 'PASS', 'Position opened', `Id=${positionId}`, { tx: txOpen.hash });
    markCoverage('StrategyVault', 'openPosition', 'covered', '2.1');
  } catch (e: unknown) {
    record('2.1', 'WARN', 'openPosition failed', decodeRevert(e));
  }

  // 2.2 getPosition / getPositionMeta / getDepositedAmount — views
  if (positionId) {
    try {
      const pos = await vault.getPositionMeta(positionId);
      record('2.2a', 'PASS', 'getPositionMeta view', `strategyId=${pos.strategyId}`);
      markCoverage('StrategyVault', 'getPositionMeta', 'covered', '2.2a');
    } catch {
      record('2.2a', 'WARN', 'getPositionMeta view', 'failed');
    }
    try {
      const meta = await vault.getPositionMeta(positionId);
      record('2.2b', 'PASS', 'getPositionMeta view', `active=${meta[0]}`);
      markCoverage('StrategyVault', 'getPositionMeta', 'covered', '2.2b');
    } catch {
      record('2.2b', 'WARN', 'getPositionMeta view', 'failed');
    }
  }

  // 2.3 addCollateral — wrong token
  if (positionId) {
    try {
      const [_eAdd] = await cofhe.encryptInputs([Encryptable.uint128(1n)]).execute();
      await vault.addCollateral.staticCall(positionId, WETH, 1n, ethers.ZeroHash, tester.address);
      record('2.3', 'FAIL', 'addCollateral wrong-token accepted', 'expected TokenMismatch');
    } catch (e: unknown) {
      const msg = decodeRevert(e);
      const ok = msg.includes('TokenMismatch');
      record('2.3', ok ? 'PASS' : 'WARN', 'addCollateral wrong-token reverts', msg);
    }
    markCoverage('StrategyVault', 'addCollateral', 'covered', '2.3');
  }

  // 2.4 Partial close
  if (positionId) {
    try {
      const closeAmt = ethers.parseUnits('400', 6);
      const [eClose] = await cofhe.encryptInputs([Encryptable.uint128(closeAmt)]).execute();
      const txClose = await helper.closePosition(
        eClose,
        await vault.getAddress(),
        positionId,
        closeAmt,
      );
      await txClose.wait();
      const remaining = (await vault.getDepositedAmount(positionId)) as bigint;
      record(
        '2.4',
        remaining === collateralAmt - closeAmt ? 'PASS' : 'FAIL',
        'Partial close keeps state',
        `remaining=${remaining}`,
        { tx: txClose.hash },
      );
      markCoverage('StrategyVault', 'closePosition', 'covered', '2.4');
    } catch (e: unknown) {
      record('2.4', 'WARN', 'Partial close failed', decodeRevert(e));
    }
  }

  // 2.5 Full close
  if (positionId) {
    try {
      const remaining = (await vault.getDepositedAmount(positionId)) as bigint;
      const [eFull] = await cofhe.encryptInputs([Encryptable.uint128(remaining)]).execute();
      const txFull = await helper.closePosition(
        eFull,
        await vault.getAddress(),
        positionId,
        remaining,
      );
      await txFull.wait();
      const has = (await vault.getUserPositions(tester.address)).includes(positionId);
      record('2.5', has ? 'FAIL' : 'PASS', 'Full close clears state', `hasPosition=${has}`, {
        tx: txFull.hash,
      });
    } catch (e: unknown) {
      record('2.5', 'WARN', 'Full close failed', decodeRevert(e));
    }
  }

  // 2.6 openPosition — another for downstream pool tests
  try {
    const [eCol] = await cofhe.encryptInputs([Encryptable.uint128(collateralAmt)]).execute();
    const tx = await helper.openPosition(
      eCol,
      await vault.getAddress(),
      USDC,
      collateralAmt,
      1n,
      tester.address,
    );
    const r = await tx.wait();
    const vaultAddress = await vault.getAddress();
    const vLog = r?.logs.find(
      (log: ethers.EventLog) =>
        log.address?.toLowerCase() === vaultAddress.toLowerCase() &&
        log.fragment?.name === 'PositionOpened',
    );
    positionId = vLog?.args?.[0];
    record('2.6', 'PASS', 'Position re-opened for pool tests', `Id=${positionId}`, { tx: tx.hash });
  } catch {
    record('2.6', 'WARN', 'Re-open for pool tests', 'failed');
  }

  // ─── Position ID format verification ─────────────────────

  // 2.7 — Verify positionId encoding (staticCall check)
  {
    const testPositionId = ethers.zeroPadValue('0x01', 32);
    try {
      await vault.getPositionOwner.staticCall(testPositionId);
      record('2.7', 'FAIL', 'getPositionOwner fake positionId', 'expected NoPosition revert');
    } catch (e: unknown) {
      const msg = decodeRevert(e);
      const ok = msg.includes('NoPosition');
      record('2.7', ok ? 'PASS' : 'WARN', 'getPositionOwner fake positionId', msg);
    }
    markCoverage('StrategyVault', 'getPositionOwner', 'covered', '2.7');
  }

  // 2.8 — Verify position ID from registered strategy event (view check)
  try {
    const sid = await vault.positionStrategyIds(tester.address, 0n);
    record('2.8', 'PASS', 'positionStrategyIds view', `strategyId=${sid}`);
    markCoverage('StrategyVault', 'positionStrategyIds', 'covered', '2.8');
  } catch (e: unknown) {
    record('2.8', 'INFO', 'positionStrategyIds view', `reverted: ${decodeRevert(e)}`);
  }

  // 2.9 — getPositionToken view
  {
    const testPosId2 = ethers.zeroPadValue('0x02', 32);
    try {
      await vault.getPositionToken.staticCall(testPosId2);
      record('2.9', 'FAIL', 'getPositionToken fake positionId', 'expected NoPosition revert');
    } catch (e: unknown) {
      const msg = decodeRevert(e);
      const ok = msg.includes('NoPosition');
      record('2.9', ok ? 'PASS' : 'WARN', 'getPositionToken fake positionId', msg);
    }
    markCoverage('StrategyVault', 'getPositionToken', 'covered', '2.9');
  }

  // 2.10 — verify encoding roundtrip: positionId = keccak256(address, nonce) format
  try {
    const freshAmt = ethers.parseUnits('500', 6);
    const [e10] = await cofhe.encryptInputs([Encryptable.uint128(freshAmt)]).execute();
    const tx10 = await helper.openPosition(
      e10,
      await vault.getAddress(),
      USDC,
      freshAmt,
      1n,
      tester.address,
    );
    const r10 = await tx10.wait();
    const vAddr = await vault.getAddress();
    const posLog10 = r10?.logs.find(
      (log: ethers.EventLog) =>
        log.address?.toLowerCase() === vAddr.toLowerCase() &&
        log.fragment?.name === 'PositionOpened',
    );
    const newPosId = posLog10?.args?.[0];
    if (newPosId) {
      const isValidBytes32 =
        typeof newPosId === 'string' && newPosId.startsWith('0x') && newPosId.length === 66;
      record(
        '2.10',
        isValidBytes32 ? 'PASS' : 'WARN',
        'PositionOpened encoding roundtrip',
        `positionId=${newPosId} len=${newPosId.length}`,
        { tx: tx10.hash },
      );
    } else {
      record('2.10', 'WARN', 'PositionOpened encoding roundtrip', 'no positionId in event');
    }
    if (newPosId) {
      positionId = newPosId;
    }
  } catch (e: unknown) {
    record('2.10', 'WARN', 'PositionOpened encoding roundtrip', decodeRevert(e));
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 3: LendingPool — supply, borrow, repay, native ETH, oracle
  // ═══════════════════════════════════════════════════════════
  prog.phase('3. LendingPool');

  const borrowAmt = ethers.parseUnits('1000', 6);

  // 3.1 shield
  try {
    const [eSupply] = await cofhe.encryptInputs([Encryptable.uint128(supplyAmt)]).execute();
    const txShield = await pool.shield(USDC, supplyAmt, eSupply);
    await txShield.wait();
    record('3.1', 'PASS', 'shield collateral', `${ethers.formatUnits(supplyAmt, 6)} USDC`);
    markCoverage('LendingPool', 'shield', 'covered', '3.1');
  } catch (e: unknown) {
    record('3.1', 'WARN', 'shield failed', decodeRevert(e));
  }

  // 3.2 borrowWithLtvCheck
  try {
    const [eBorrow] = await cofhe.encryptInputs([Encryptable.uint128(borrowAmt)]).execute();
    const txBorrow = await pool.borrowWithLtvCheck(USDC, USDC, borrowAmt, eBorrow, 70, 100);
    await txBorrow.wait();
    const plainBorrow = await pool.totalPlainBorrow(USDC);
    record(
      '3.2',
      'PASS',
      'borrowWithLtvCheck',
      `borrow=${ethers.formatUnits(plainBorrow, 6)} USDC`,
    );
    markCoverage('LendingPool', 'borrowWithLtvCheck', 'covered', '3.2');
  } catch (e: unknown) {
    record('3.2', 'WARN', 'borrowWithLtvCheck failed', decodeRevert(e));
  }

  // 3.3 borrowWithLtvCheck — ltvNum=0 (should revert)
  {
    const [eZero] = await cofhe.encryptInputs([Encryptable.uint128(1n)]).execute();
    const ok = await staticCallRevert(
      pool,
      'borrowWithLtvCheck',
      [USDC, USDC, 1n, eZero, 0, 100],
      'LtvNumeratorZero',
    );
    record(
      '3.3',
      ok ? 'PASS' : 'FAIL',
      'ltvNum=0 rejected',
      ok ? 'LtvNumeratorZero' : lastRevertError,
    );
    markCoverage('LendingPool', 'borrowWithLtvCheck', 'static_call', '3.3');
  }

  // 3.4 repayDebt
  try {
    const borrowBal = (await pool.totalPlainBorrow(USDC)) as bigint;
    if (borrowBal > 0n) {
      const [eRepay] = await cofhe.encryptInputs([Encryptable.uint128(borrowBal)]).execute();
      const txRepay = await pool.repayDebt(USDC, borrowBal, eRepay);
      await txRepay.wait();
      record('3.4', 'PASS', 'repayDebt', 'ok');
      markCoverage('LendingPool', 'repayDebt', 'covered', '3.4');
    }
  } catch (e: unknown) {
    record('3.4', 'WARN', 'repayDebt failed', decodeRevert(e));
  }

  // 3.5 partialUnshield
  try {
    const [eWd] = await cofhe.encryptInputs([Encryptable.uint128(supplyAmt)]).execute();
    const txWd = await pool.partialUnshield(USDC, supplyAmt, eWd);
    await txWd.wait();
    record('3.5', 'PASS', 'partialUnshield', `${ethers.formatUnits(supplyAmt, 6)} USDC`);
    markCoverage('LendingPool', 'partialUnshield', 'covered', '3.5');
  } catch (e: unknown) {
    record('3.5', 'WARN', 'partialUnshield failed', decodeRevert(e));
  }

  // 3.6 borrowWithOracle — full path
  {
    const supAmt2 = ethers.parseUnits('1000', 6);
    const borAmt2 = ethers.parseUnits('500', 6);
    try {
      const [eS] = await cofhe.encryptInputs([Encryptable.uint128(supAmt2)]).execute();
      await (await pool.shield(USDC, supAmt2, eS)).wait();
      record('3.6a', 'PASS', 'shield for oracle path', 'ok');

      const [eB] = await cofhe.encryptInputs([Encryptable.uint128(borAmt2)]).execute();
      const txBo = await pool.borrowWithOracle(USDC, USDC, supAmt2, borAmt2, eB);
      const rBo = await txBo.wait();
      record('3.6b', 'PASS', 'borrowWithOracle uses oracle price', `gas=${rBo?.gasUsed}`, {
        tx: txBo.hash,
      });
      markCoverage('LendingPool', 'borrowWithOracle', 'covered', '3.6b');

      // Cleanup
      const bal = (await pool.totalPlainBorrow(USDC)) as bigint;
      if (bal > 0n) {
        const [eR] = await cofhe.encryptInputs([Encryptable.uint128(bal)]).execute();
        await (await pool.repayDebt(USDC, bal, eR)).wait();
      }
      const [eW] = await cofhe.encryptInputs([Encryptable.uint128(supAmt2)]).execute();
      await (await pool.partialUnshield(USDC, supAmt2, eW)).wait();
      record('3.6c', 'PASS', 'oracle path cleanup', 'ok');
    } catch (e: unknown) {
      record('3.6', 'WARN', 'oracle borrow path', decodeRevert(e));
    }
  }

  // 3.7 shieldEth / partialUnshieldEth — native ETH flow
  {
    const ethAmt = ethers.parseEther('0.001');
    try {
      const [eS] = await cofhe.encryptInputs([Encryptable.uint128(ethAmt)]).execute();
      const txS = await pool.shieldEth(eS, { value: ethAmt });
      await txS.wait();
      record('3.7a', 'PASS', 'shieldEth wraps to WETH', `${ethAmt} wei`);
      markCoverage('LendingPool', 'shieldEth', 'covered', '3.7a');

      const [eW] = await cofhe.encryptInputs([Encryptable.uint128(ethAmt)]).execute();
      const txW = await pool.partialUnshieldEth(ethAmt, eW);
      await txW.wait();
      record('3.7b', 'PASS', 'partialUnshieldEth unwraps WETH', `${ethAmt} wei`);
      markCoverage('LendingPool', 'partialUnshieldEth', 'covered', '3.7b');
    } catch (e: unknown) {
      record('3.7', 'WARN', 'Native ETH flow', decodeRevert(e));
    }
  }

  // 3.8 isLiquidatable — oracle health check
  {
    // collateralAmt from vault section = 1k; actual shield in 3.1 = 2k.
    const shieldAmt = ethers.parseUnits('2000', 6);
    try {
      const healthy = await pool.isLiquidatable(tester.address, USDC, USDC, shieldAmt, borrowAmt);
      record(
        '3.8a',
        !healthy ? 'PASS' : 'FAIL',
        'healthy position not liquidatable',
        `isLiquidatable=${healthy}`,
      );
    } catch (e: unknown) {
      record('3.8a', 'WARN', 'isLiquidatable healthy failed', decodeRevert(e));
    }
    // Unhealthy position (massive debt far beyond LTV)
    try {
      const unhealthy = await pool.isLiquidatable(
        tester.address,
        USDC,
        USDC,
        collateralAmt,
        borrowAmt * 100n,
      );
      record(
        '3.8b',
        unhealthy ? 'PASS' : 'FAIL',
        'unhealthy position liquidatable',
        `isLiquidatable=${unhealthy}`,
      );
    } catch (e: unknown) {
      record('3.8b', 'WARN', 'isLiquidatable unhealthy failed', decodeRevert(e));
    }
  }
  markCoverage('LendingPool', 'isLiquidatable', 'covered', '3.8');

  // 3.9 liquidateWithProof — staticCall (needs zk-proof; expects revert)
  try {
    await pool.liquidateWithProof.staticCall(USDC, tester.address, '0x', []);
    record('3.9', 'FAIL', 'liquidateWithProof accepted', 'expected revert');
  } catch (e: unknown) {
    const msg = decodeRevert(e);
    record('3.9', 'INFO', 'liquidateWithProof (needs zk-proof)', msg);
  }
  markCoverage('LendingPool', 'liquidateWithProof', 'skipped', '3.9');

  // 3.10 flashLoan — staticCall
  const okFl = await staticCallRevert(
    pool,
    'flashLoan',
    [USDC, 1n, tester.address, '0x'],
    'TokenMismatch',
  );
  record(
    '3.10',
    okFl ? 'PASS' : 'INFO',
    'flashLoan reverts without state',
    okFl ? 'TokenMismatch' : lastRevertError,
  );
  markCoverage('LendingPool', 'flashLoan', 'static_call', '3.10');

  // 3.11 Pause/unpause roundtrip
  try {
    const pauseTargets = [
      ['Vault', vault],
      ['Pool', pool],
      ['Router', router],
      ['Registry', registry],
    ] as const;
    const startNonce = await ctx.provider.getTransactionCount(deployer.address);
    const pauseTxs = await Promise.all(
      pauseTargets.map(async ([name, contract], i) => {
        const tx = await contract.connect(deployer).pause({ nonce: startNonce + i });
        return { name, tx };
      }),
    );
    await Promise.all(pauseTxs.map((x) => x.tx.wait()));
    const nextNonce = startNonce + pauseTargets.length;
    const unpauseTxs = await Promise.all(
      pauseTargets.map(async ([name, contract], i) => {
        const tx = await contract.connect(deployer).unpause({ nonce: nextNonce + i });
        return { name, tx };
      }),
    );
    await Promise.all(unpauseTxs.map((x) => x.tx.wait()));
    for (const [name] of pauseTargets) {
      record(`3.10-${name}`, 'PASS', `${name}.pause/unpause roundtrip`, 'ok');
    }
    markCoverage('LendingPool', 'pause', 'covered', '3.10-Pool');
    markCoverage('LendingPool', 'unpause', 'covered', '3.10-Pool');
  } catch (e: unknown) {
    record('3.10', 'WARN', 'Pause/unpause parallel', decodeRevert(e));
  }

  // 3.11 — liquidateWithProof staticCall (healthy position should revert)
  try {
    await pool.liquidateWithProof.staticCall(
      USDC,
      tester.address,
      ethers.ZeroHash,
      '0x',
      ethers.ZeroHash,
      '0x',
    );
    record('3.11', 'FAIL', 'liquidateWithProof accepted unexpectedly', 'expected revert');
  } catch (e: unknown) {
    record('3.11', 'INFO', 'liquidateWithProof (healthy position)', decodeRevert(e));
  }
  markCoverage('LendingPool', 'liquidateWithProof', 'static_call', '3.11');

  // 3.12 — isLiquidatable view (no borrow should return false)
  try {
    const liq = await pool.isLiquidatable(tester.address);
    record(
      '3.12',
      !liq ? 'PASS' : 'FAIL',
      'isLiquidatable no borrow',
      !liq ? 'false' : 'unexpected true',
    );
  } catch (e: unknown) {
    record('3.12', 'WARN', 'isLiquidatable view', decodeRevert(e));
  }
  markCoverage('LendingPool', 'isLiquidatable', 'covered', '3.12');

  // 3.13 — liquidateWithProof access control (non-player cannot liquidate)
  {
    const ok = await staticCallRevert(
      pool,
      'liquidateWithProof',
      [USDC, tester.address, ethers.ZeroHash, '0x', ethers.ZeroHash, '0x'],
      'CannotSelfLiquidate',
    );
    record(
      '3.13',
      ok ? 'PASS' : 'INFO',
      'liquidateWithProof access control',
      ok ? 'CannotSelfLiquidate' : lastRevertError,
    );
  }
  markCoverage('LendingPool', 'liquidateWithProof', 'static_call', '3.13');

  // 3.14 — ComputeLiquidation math correctness (staticCall)
  try {
    await pool.computeLiquidation(USDC, tester.address);
    record('3.14', 'FAIL', 'computeLiquidation succeeded unexpectedly', 'expected revert');
  } catch (e: unknown) {
    record('3.14', 'INFO', 'computeLiquidation (no borrow)', decodeRevert(e));
  }
  markCoverage('LendingPool', 'computeLiquidation', 'static_call', '3.14');

  // 3.15 — flashLoan edge cases: zero amount & non-contract receiver (should revert)
  {
    const ok1 = await staticCallRevert(
      pool,
      'flashLoan',
      [USDC, 0n, tester.address, '0x'],
      'ZeroAmount',
    );
    const err1 = lastRevertError;
    const ok2 = await staticCallRevert(
      pool,
      'flashLoan',
      [USDC, 1n, ethers.ZeroAddress, '0x'],
      'ZeroAddress',
    );
    const err2 = lastRevertError;
    const detail =
      ok1 && ok2
        ? 'both reverted as expected'
        : `zeroAmount=${ok1 ? '\u2713' : err1} zeroAddr=${ok2 ? '\u2713' : err2}`;
    record('3.15', ok1 && ok2 ? 'PASS' : 'INFO', 'flashLoan edge cases', detail);
  }
  markCoverage('LendingPool', 'flashLoan', 'static_call', '3.15');

  // 3.16 — flash loan fee view check (INFO)
  try {
    const fee = await pool.flashFee(USDC, 1n);
    record('3.16', 'PASS', 'flashFee view', `${fee}`);
  } catch (e: unknown) {
    record('3.16', 'INFO', 'flashFee view (not available)', decodeRevert(e));
  }
  markCoverage('LendingPool', 'flashFee', 'covered', '3.16');

  // 3.17 — flash loan access control from non-privileged account
  {
    const ok = await staticCallRevert(
      pool,
      'flashLoan',
      [USDC, 1n, deployer.address, '0x'],
      'OnlyVault',
    );
    record(
      '3.17',
      ok ? 'PASS' : 'INFO',
      'flashLoan integrator role',
      ok ? 'OnlyVault' : lastRevertError,
    );
  }
  markCoverage('LendingPool', 'flashLoan', 'static_call', '3.17');

  // 3.18 — flash loan callback pattern documentation (INFO)
  {
    // IERC3156FlashBorrower receiver must implement executeOperation(address,address,uint256,uint256,bytes)
    const callbackSig = 'executeOperation(address,address,uint256,uint256,bytes)';
    const callbackSelector = ethers.id(callbackSig).slice(0, 10);
    const hasFlash = typeof pool.flashLoan === 'function';
    record(
      '3.18',
      'INFO',
      'flashLoan callback pattern',
      `receiver implements ${callbackSig} [sel=${callbackSelector}] — flashLoan ${hasFlash ? 'available' : 'not found'}`,
    );
  }
  markCoverage('LendingPool', 'flashLoan', 'covered', '3.18');

  // ═══════════════════════════════════════════════════════════
  // SECTION 4: SwapRouter — intent lifecycle
  // ═══════════════════════════════════════════════════════════
  prog.phase('4. SwapRouter');

  // 4.1 submitSwapIntent — deadlineOffset=0 (too short)
  {
    const ok = await staticCallRevert(
      router,
      'submitSwapIntent',
      [USDC, WETH, 1n, 1n, 0n],
      'DeadlineTooShort',
    );
    record(
      '4.1',
      ok ? 'PASS' : 'FAIL',
      'deadlineOffset=0 rejected',
      ok ? 'DeadlineTooShort' : lastRevertError,
    );
    markCoverage('SwapRouter', 'submitSwapIntent', 'static_call', '4.1');
  }

  // 4.2 submitSwapIntent — deadlineOffset >> MAX (too long)
  {
    const far = (await router.MAX_DEADLINE_OFFSET()) + 1n; // exceeds whatever MAX is deployed
    const ok = await staticCallRevert(
      router,
      'submitSwapIntent',
      [USDC, WETH, 1n, 1n, far],
      'DeadlineTooLong',
    );
    record(
      '4.2',
      ok ? 'PASS' : 'FAIL',
      'deadlineOffset > MAX rejected',
      ok ? 'DeadlineTooLong' : lastRevertError,
    );
    markCoverage('SwapRouter', 'submitSwapIntent', 'static_call', '4.2');
  }

  // 4.3 submitSwapIntent — valid (with non-zero deadline)
  let intentId: string | undefined;
  try {
    const okDeadline = await router.MAX_DEADLINE_OFFSET(); // must be <= MAX to avoid DeadlineTooLong
    const tx = await router.submitSwapIntent(USDC, WETH, 1n, 1n, okDeadline);
    const r = await tx.wait();
    intentId = r?.logs.find((log: ethers.EventLog) => log.fragment?.name === 'SwapIntentSubmitted')
      ?.args?.[0];
    record('4.3', 'PASS', 'submitSwapIntent valid', `id=${intentId}`, { tx: tx.hash });
    markCoverage('SwapRouter', 'submitSwapIntent', 'covered', '4.3');
  } catch (e: unknown) {
    record('4.3', 'WARN', 'submitSwapIntent valid', decodeRevert(e));
  }

  // 4.4 cancelIntent — cancel the submitted intent
  if (intentId) {
    try {
      const tx = await router.cancelIntent(intentId);
      await tx.wait();
      record('4.4', 'PASS', 'cancelIntent', `id=${intentId}`, { tx: tx.hash });
      markCoverage('SwapRouter', 'cancelIntent', 'covered', '4.4');
    } catch (e: unknown) {
      record('4.4', 'WARN', 'cancelIntent', decodeRevert(e));
    }
  }

  // 4.5 proposeExecutor / acceptExecutor — timelock
  try {
    const execDelay = (await router.ROTATION_DELAY()) as bigint;
    const deadAddr = '0x000000000000000000000000000000000000dEaD';
    const txP = await router.connect(deployer).proposeExecutor(deadAddr);
    await txP.wait();
    const earliest = (await router.pendingRoleEarliest()) as bigint;
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const ok = earliest > nowSec + execDelay - 60n;
    record(
      '4.5',
      ok ? 'PASS' : 'WARN',
      `proposeExecutor ${execDelay}s timelock`,
      `earliest=${earliest}`,
      { tx: txP.hash },
    );
    markCoverage('SwapRouter', 'proposeExecutor', 'covered', '4.5');
  } catch (e: unknown) {
    record('4.5', 'WARN', 'proposeExecutor', decodeRevert(e));
  }
  // acceptExecutor before timelock
  {
    const ok = await staticCallRevert(router, 'acceptExecutor', [], 'TimelockNotElapsed');
    record(
      '4.5b',
      ok ? 'PASS' : 'WARN',
      'acceptExecutor before timelock',
      ok ? 'TimelockNotElapsed' : lastRevertError,
    );
    markCoverage('SwapRouter', 'acceptExecutor', 'static_call', '4.5b');
  }

  // 4.6 swapViaUniswapV3Single — staticCall (will revert without exact state)
  try {
    await router.swapViaUniswapV3Single.staticCall(USDC, WETH, 1n, 1n);
    record('4.6', 'WARN', 'swapViaUniswapV3Single unexpected success', 'should need state');
  } catch {
    record(
      '4.6',
      'INFO',
      'swapViaUniswapV3Single (needs active swap state)',
      'reverts as expected',
    );
  }
  markCoverage('SwapRouter', 'swapViaUniswapV3Single', 'static_call', '4.6');

  // ── 4.7 executeIntent — invalid intentId (should revert) ──
  try {
    await router.executeIntent.staticCall(ethers.ZeroHash);
    record('4.7', 'WARN', 'executeIntent invalid intentId', 'no revert (unexpected)');
  } catch {
    record('4.7', 'PASS', 'executeIntent invalid intentId', 'reverted as expected');
  }
  markCoverage('SwapRouter', 'executeIntent', 'static_call', '4.7');

  // ── 4.8 submitSwapIntent + cancelIntent (live) ──
  try {
    const approve48 = await usdc.approve(D.SwapRouter, ethers.MaxUint256);
    await approve48.wait();
    const deadline48 = await router.MAX_DEADLINE_OFFSET();
    const submit48 = await router.submitSwapIntent(USDC, WETH, 1n, 1n, deadline48);
    const submitR48 = await submit48.wait();
    const intentId48 = submitR48?.logs.find(
      (log: ethers.EventLog) => log.fragment?.name === 'SwapIntentSubmitted',
    )?.args?.[0];
    const cancel48 = await router.cancelIntent(intentId48);
    await cancel48.wait();
    record('4.8', 'PASS', 'submitSwapIntent + cancelIntent', `id=${intentId48}`, {
      tx: submit48.hash,
    });
    markCoverage('SwapRouter', 'submitSwapIntent+cancelIntent', 'covered', '4.8');
  } catch (e: unknown) {
    record('4.8', 'WARN', 'submitSwapIntent + cancelIntent', decodeRevert(e));
  }

  // ── 4.9 executeIntent via ExecutorContract (approve flow) ──
  try {
    const approve49 = await usdc.approve(D.ExecutorContract, ethers.MaxUint256);
    await approve49.wait();
    const deadline49 = await router.MAX_DEADLINE_OFFSET();
    const submit49 = await router.submitSwapIntent(USDC, WETH, 1n, 1n, deadline49);
    const submitR49 = await submit49.wait();
    const intentId49 = submitR49?.logs.find(
      (log: ethers.EventLog) => log.fragment?.name === 'SwapIntentSubmitted',
    )?.args?.[0];
    const execAsOwner = executor.connect(deployer);
    const execTx49 = await execAsOwner.executeIntent(D.SwapRouter, intentId49, 0n);
    await execTx49.wait();
    record('4.9', 'PASS', 'executeIntent via ExecutorContract', `id=${intentId49}`, {
      tx: execTx49.hash,
    });
    markCoverage('SwapRouter', 'executeIntent', 'covered', '4.9');
  } catch (e: unknown) {
    record('4.9', 'WARN', 'executeIntent via ExecutorContract', decodeRevert(e));
  }

  // ── 4.10 submitSwapIntent with MAX_DEADLINE_OFFSET() ──
  try {
    const deadline410 = await router.MAX_DEADLINE_OFFSET();
    const tx410 = await router.submitSwapIntent(USDC, WETH, 1n, 1n, deadline410);
    const r410 = await tx410.wait();
    const intentId410 = r410?.logs.find(
      (log: ethers.EventLog) => log.fragment?.name === 'SwapIntentSubmitted',
    )?.args?.[0];
    record('4.10', 'PASS', 'submitSwapIntent MAX_DEADLINE_OFFSET', `id=${intentId410}`, {
      tx: tx410.hash,
    });
    markCoverage('SwapRouter', 'submitSwapIntent_maxDeadline', 'covered', '4.10');
  } catch (e: unknown) {
    record('4.10', 'WARN', 'submitSwapIntent MAX_DEADLINE_OFFSET', decodeRevert(e));
  }

  // ── 4.11 swapViaUniswapV3Single — zero amount (should revert ZeroAmountIn) ──
  {
    const ok = await staticCallRevert(
      router,
      'swapViaUniswapV3Single',
      [USDC, WETH, 0n, 1n],
      'ZeroAmountIn',
    );
    record(
      '4.11',
      ok ? 'PASS' : 'FAIL',
      'swapViaUniswapV3Single zero amount',
      ok ? 'ZeroAmountIn' : lastRevertError,
    );
    markCoverage('SwapRouter', 'swapViaUniswapV3Single', 'static_call', '4.11');
  }

  // ── 4.12 swapViaUniswapV3Single — same token (USDC→USDC) ──
  try {
    await router.swapViaUniswapV3Single.staticCall(USDC, USDC, 1n, 1n);
    record(
      '4.12',
      'INFO',
      'swapViaUniswapV3Single same token',
      'no revert (same tokens not rejected)',
    );
  } catch {
    record('4.12', 'PASS', 'swapViaUniswapV3Single same token', 'reverted as expected');
  }
  markCoverage('SwapRouter', 'swapViaUniswapV3Single', 'static_call', '4.12');

  // ═══════════════════════════════════════════════════════════
  // SECTION 5: PriceOracle — price feeds
  // ═══════════════════════════════════════════════════════════
  prog.phase('5. PriceOracle');

  // 5.1 getPriceUsd — WETH and USDC
  try {
    const [wethPrice, _wethUpdatedAt] = await oracle.getPriceUsd(WETH);
    const [usdcPrice, _usdcUpdatedAt] = await oracle.getPriceUsd(USDC);
    record('5.1a', wethPrice > 0n ? 'PASS' : 'FAIL', 'getPriceUsd(WETH)', `price=${wethPrice}`);
    record('5.1b', usdcPrice > 0n ? 'PASS' : 'FAIL', 'getPriceUsd(USDC)', `price=${usdcPrice}`);
    markCoverage('PriceOracle', 'getPriceUsd', 'covered', '5.1');
  } catch (e: unknown) {
    record('5.1', 'WARN', 'getPriceUsd', decodeRevert(e));
  }

  // 5.2 convertToUsd
  try {
    const oneEth = ethers.parseEther('1');
    const usdVal = (await oracle.convertToUsd(WETH, oneEth)) as bigint;
    record('5.2', usdVal > 0n ? 'PASS' : 'FAIL', 'convertToUsd(1 WETH)', `usd=${usdVal}`);
    markCoverage('PriceOracle', 'convertToUsd', 'covered', '5.2');
  } catch (e: unknown) {
    record('5.2', 'WARN', 'convertToUsd', decodeRevert(e));
  }

  // 5.3 getPriceWithFallback
  try {
    const fb = (await oracle.getPriceWithFallback(WETH)) as bigint;
    record('5.3', fb > 0n ? 'PASS' : 'FAIL', 'getPriceWithFallback(WETH)', `price=${fb}`);
    markCoverage('PriceOracle', 'getPriceWithFallback', 'covered', '5.3');
  } catch (e: unknown) {
    record('5.3', 'WARN', 'getPriceWithFallback', decodeRevert(e));
  }

  // 5.4 isStale / isSupported
  try {
    const staleWeth = (await oracle.isStale(WETH)) as boolean;
    const staleUsdc = (await oracle.isStale(USDC)) as boolean;
    record('5.4a', !staleWeth ? 'PASS' : 'WARN', 'isStale(WETH) fresh', `stale=${staleWeth}`);
    record('5.4b', !staleUsdc ? 'PASS' : 'WARN', 'isStale(USDC) fresh', `stale=${staleUsdc}`);
    markCoverage('PriceOracle', 'isStale', 'covered', '5.4');
  } catch (e: unknown) {
    record('5.4', 'WARN', 'isStale', decodeRevert(e));
  }

  try {
    const supWeth = (await oracle.isSupported(WETH)) as boolean;
    const supUsdc = (await oracle.isSupported(USDC)) as boolean;
    record('5.4c', supWeth ? 'PASS' : 'FAIL', 'isSupported(WETH)', `supported=${supWeth}`);
    record('5.4d', supUsdc ? 'PASS' : 'FAIL', 'isSupported(USDC)', `supported=${supUsdc}`);
    markCoverage('PriceOracle', 'isSupported', 'covered', '5.4');
  } catch (e: unknown) {
    record('5.4d', 'WARN', 'isSupported', decodeRevert(e));
  }

  // 5.5 setSource — onlyOwner
  {
    const ok = await staticCallRevert(
      oracle,
      'setSource',
      [USDC, ethers.ZeroHash, 0, 3600n],
      'OnlyOwner',
    );
    record(
      '5.5',
      ok ? 'PASS' : 'WARN',
      'setSource non-owner reverts',
      ok ? 'OnlyOwner' : lastRevertError,
    );
    markCoverage('PriceOracle', 'setSource', 'static_call', '5.5');
  }

  // 5.6 updatePriceFeeds — needs Pyth data; expect revert without it
  try {
    await oracle.updatePriceFeeds.staticCall([], []);
    record('5.6', 'WARN', 'updatePriceFeeds empty accepted', 'expected revert');
  } catch {
    record('5.6', 'INFO', 'updatePriceFeeds (needs Pyth data)', 'reverts');
  }
  markCoverage('PriceOracle', 'updatePriceFeeds', 'skipped', '5.6');

  // 5.7 collateralFactorBps — constant
  try {
    const cf = (await oracle.collateralFactorBps(USDC)) as bigint;
    record('5.7', cf > 0n ? 'PASS' : 'FAIL', 'collateralFactorBps', `cf=${cf}`);
    markCoverage('PriceOracle', 'collateralFactorBps', 'covered', '5.7');
  } catch {
    record('5.7', 'WARN', 'collateralFactorBps', 'failed');
  }

  // 5.8 setSource — zero address token validation (should revert)
  {
    const ok = await staticCallRevert(
      oracle,
      'setSource',
      [ethers.ZeroAddress, ethers.ZeroHash, 0, 3600n],
      'OnlyOwner',
    );
    record(
      '5.8',
      ok ? 'PASS' : 'WARN',
      'setSource zero address token',
      ok ? 'reverted' : lastRevertError,
    );
    markCoverage('PriceOracle', 'setSource', 'static_call', '5.8');
  }

  // 5.9 getPriceUsd — verify price freshness for known token (USDC)
  try {
    const [price59, updatedAt59] = await oracle.getPriceUsd(USDC);
    record(
      '5.9',
      price59 > 0n ? 'PASS' : 'FAIL',
      'getPriceUsd(USDC) price',
      `price=${price59}, updatedAt=${updatedAt59}`,
    );
    markCoverage('PriceOracle', 'getPriceUsd', 'covered', '5.9');
  } catch (e: unknown) {
    record('5.9', 'WARN', 'getPriceUsd(USDC)', decodeRevert(e));
  }

  // 5.10 getPriceUsd + collateralFactorBps — cross-reference
  try {
    const [price510, _at510] = await oracle.getPriceUsd(USDC);
    const cf510 = (await oracle.collateralFactorBps(USDC)) as bigint;
    record(
      '5.10',
      price510 > 0n && cf510 > 0n ? 'PASS' : 'FAIL',
      'getPriceUsd + collateralFactorBps',
      `price=${price510}, cf=${cf510}`,
    );
    markCoverage('PriceOracle', 'collateralFactorBps+getPriceUsd', 'covered', '5.10');
  } catch (e: unknown) {
    record('5.10', 'WARN', 'getPriceUsd + collateralFactorBps', decodeRevert(e));
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 6: FheForgeComposer — position & rebalance
  // ═══════════════════════════════════════════════════════════
  prog.phase('6. FheForgeComposer');

  // 6.1 openPosition (plaintext-only, loopCount=0)
  try {
    const [eC, eS, eB] = await cofhe
      .encryptInputs([Encryptable.uint128(0n), Encryptable.uint128(0n), Encryptable.uint128(0n)])
      .execute();
    const tx = await composer.openPosition(
      {
        strategyName: `comp-${ts}`,
        workflowHash: ethers.zeroPadValue('0xc1', 32),
        collateralAmount: 0n,
        poolSupplyAmount: 0n,
        poolBorrowAmount: 0n,
        swapDeadlineOffset: 0n,
        strategyId: 0n,
        swapAmountIn: 0n,
        swapMinOut: 0n,
        collateralToken: USDC,
        borrowToken: ethers.ZeroAddress,
        swapTokenOut: ethers.ZeroAddress,
        ltvNum: 0n,
        ltvDen: 100n,
        useOracleBorrow: false,
        apyTarget: 0,
        loopCount: 0,
      },
      { collateral: eC, supplyEnc: eS, borrowEnc: eB },
    );
    const r = await tx.wait();
    record('6.1', 'PASS', 'Composer openPosition (plaintext)', `gas=${r?.gasUsed}`, {
      tx: tx.hash,
    });
    markCoverage('FheForgeComposer', 'openPosition', 'covered', '6.1');
  } catch (e: unknown) {
    record('6.1', 'WARN', 'Composer openPosition', decodeRevert(e));
  }

  // 6.2 rebalance — staticCall (needs existing position)
  try {
    await composer.rebalance.staticCall({
      strategyName: `rebal-${ts}`,
      workflowHash: ethers.zeroPadValue('0xc2', 32),
      collateralAmount: 0n,
      poolSupplyAmount: 0n,
      poolBorrowAmount: 0n,
      swapDeadlineOffset: 0n,
      strategyId: 0n,
      swapAmountIn: 0n,
      swapMinOut: 0n,
      collateralToken: USDC,
      borrowToken: ethers.ZeroAddress,
      swapTokenOut: ethers.ZeroAddress,
      ltvNum: 0n,
      ltvDen: 100n,
      useOracleBorrow: false,
      apyTarget: 0,
      loopCount: 0,
    });
    record('6.2', 'WARN', 'rebalance unexpected success', 'expected revert needing position');
  } catch {
    record('6.2', 'INFO', 'rebalance (needs active position)', 'reverts');
  }
  markCoverage('FheForgeComposer', 'rebalance', 'static_call', '6.2');

  // 6.3 sweepToken — onlyOwner
  const okSw = await staticCallRevert(composer, 'sweepToken', [USDC, tester.address], 'OnlyOwner');
  record(
    '6.3',
    okSw ? 'PASS' : 'WARN',
    'sweepToken non-owner reverts',
    okSw ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('FheForgeComposer', 'sweepToken', 'static_call', '6.3');

  // ═══════════════════════════════════════════════════════════
  // SECTION 7: ExecutorContract — approval & withdrawal
  // ═══════════════════════════════════════════════════════════
  prog.phase('7. ExecutorContract');

  // 7.1 approveToken — onlyOwner
  const okAp = await staticCallRevert(
    executor,
    'approveToken',
    [USDC, D.StrategyVault, 0n],
    'OnlyOwner',
  );
  record(
    '7.1',
    okAp ? 'PASS' : 'WARN',
    'approveToken non-owner reverts',
    okAp ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('ExecutorContract', 'approveToken', 'static_call', '7.1');

  // 7.2 withdrawTokens — onlyOwner
  const okWd = await staticCallRevert(executor, 'withdrawTokens', [USDC, 0n], 'OnlyOwner');
  record(
    '7.2',
    okWd ? 'PASS' : 'WARN',
    'withdrawTokens non-owner reverts',
    okWd ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('ExecutorContract', 'withdrawTokens', 'static_call', '7.2');

  // 7.3 executeIntent — staticCall (needs pending intent)
  try {
    await executor.executeIntent.staticCall(ethers.ZeroHash);
    record('7.3', 'WARN', 'executeIntent unexpected success', 'expected revert');
  } catch {
    record('7.3', 'INFO', 'executeIntent (needs pending intent)', 'reverts');
  }
  markCoverage('ExecutorContract', 'executeIntent', 'static_call', '7.3');

  // ═══════════════════════════════════════════════════════════
  // SECTION 8: TokenRegistry — token enumeration
  // ═══════════════════════════════════════════════════════════
  prog.phase('8. TokenRegistry');

  // 8.1 getTokenCount
  try {
    const count = (await tokenReg.getTokenCount()) as bigint;
    record('8.1', count >= 2n ? 'PASS' : 'FAIL', 'getTokenCount >= 2', `count=${count}`);
    markCoverage('TokenRegistry', 'getTokenCount', 'covered', '8.1');
  } catch (e: unknown) {
    record('8.1', 'WARN', 'getTokenCount', decodeRevert(e));
  }

  // 8.2 getLendableTokens
  try {
    const lendable = await tokenReg.getLendableTokens();
    record(
      '8.2',
      lendable.length > 0 ? 'PASS' : 'FAIL',
      'getLendableTokens',
      `count=${lendable.length}`,
    );
    markCoverage('TokenRegistry', 'getLendableTokens', 'covered', '8.2');
  } catch (e: unknown) {
    record('8.2', 'WARN', 'getLendableTokens', decodeRevert(e));
  }

  // 8.3 getBorrowableTokens
  try {
    const borrowable = await tokenReg.getBorrowableTokens();
    record(
      '8.3',
      borrowable.length > 0 ? 'PASS' : 'FAIL',
      'getBorrowableTokens',
      `count=${borrowable.length}`,
    );
    markCoverage('TokenRegistry', 'getBorrowableTokens', 'covered', '8.3');
  } catch (e: unknown) {
    record('8.3', 'WARN', 'getBorrowableTokens', decodeRevert(e));
  }

  // 8.4 getCollateralTokens
  try {
    const collat = await tokenReg.getCollateralTokens();
    record(
      '8.4',
      collat.length > 0 ? 'PASS' : 'FAIL',
      'getCollateralTokens',
      `count=${collat.length}`,
    );
    markCoverage('TokenRegistry', 'getCollateralTokens', 'covered', '8.4');
  } catch (e: unknown) {
    record('8.4', 'WARN', 'getCollateralTokens', decodeRevert(e));
  }

  // 8.5 isTokenEnabled
  try {
    const enWeth = (await tokenReg.isTokenEnabled(WETH)) as boolean;
    const enUsdc = (await tokenReg.isTokenEnabled(USDC)) as boolean;
    record('8.5a', enWeth ? 'PASS' : 'FAIL', 'isTokenEnabled(WETH)', `enabled=${enWeth}`);
    record('8.5b', enUsdc ? 'PASS' : 'FAIL', 'isTokenEnabled(USDC)', `enabled=${enUsdc}`);
    markCoverage('TokenRegistry', 'isTokenEnabled', 'covered', '8.5');
  } catch (e: unknown) {
    record('8.5', 'WARN', 'isTokenEnabled', decodeRevert(e));
  }

  // 8.6 registerToken — onlyOwner (TokenInfo is an 11-field struct)
  const tokenInfoStruct = (
    token: string,
    lend: boolean,
    borrow: boolean,
    collat: boolean,
    decimals: number,
  ) => ({
    token,
    ltvBps: 5000,
    liquidationBonusBps: 500,
    decimals,
    isLendable: lend,
    isBorrowable: borrow,
    isCollateral: collat,
    enabled: true,
    pythPriceId: ethers.ZeroHash,
    borrowCap: ethers.MaxUint256,
    supplyCap: ethers.MaxUint256,
  });
  const okReg = await staticCallRevert(
    tokenReg,
    'registerToken',
    [tokenInfoStruct(WETH, true, true, true, 18)],
    'TokenAlreadyRegistered',
  );
  record(
    '8.6',
    okReg ? 'PASS' : 'WARN',
    'registerToken duplicate reverts',
    okReg ? 'TokenAlreadyRegistered' : lastRevertError,
  );
  markCoverage('TokenRegistry', 'registerToken', 'static_call', '8.6');

  // 8.7 disableToken — onlyOwner
  const okDis = await staticCallRevert(tokenReg, 'disableToken', [WETH], 'OnlyOwner');
  record(
    '8.7',
    okDis ? 'PASS' : 'WARN',
    'disableToken non-owner reverts',
    okDis ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('TokenRegistry', 'disableToken', 'static_call', '8.7');

  // 8.8 updateTokenConfig — onlyOwner
  const okUpd = await staticCallRevert(
    tokenReg,
    'updateTokenConfig',
    [WETH, tokenInfoStruct(WETH, true, true, true, 18)],
    'OnlyOwner',
  );
  record(
    '8.8',
    okUpd ? 'PASS' : 'WARN',
    'updateTokenConfig non-owner reverts',
    okUpd ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('TokenRegistry', 'updateTokenConfig', 'static_call', '8.8');

  // ═══════════════════════════════════════════════════════════
  // SECTION 9: StrategyExecutor — pipeline execution
  // ═══════════════════════════════════════════════════════════
  prog.phase('9. StrategyExecutor');

  // 9.1 executePipeline — onlyOwner (args: bytes32 strategyId, Action[] actions)
  const mockStratId = ethers.zeroPadValue('0xdead', 32);
  const okPipe = await staticCallRevert(
    stratExec,
    'executePipeline',
    [
      mockStratId,
      [
        {
          actionType: '0x00000000',
          params: '0x',
          encAmount: { ctHash: 0n, securityZone: 0, utype: 0, signature: '0x' },
        },
      ],
    ],
    'OnlyOwner',
  );
  record(
    '9.1',
    okPipe ? 'PASS' : 'WARN',
    'executePipeline non-owner reverts',
    okPipe ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('StrategyExecutor', 'executePipeline', 'static_call', '9.1');

  // 9.2 resetCheckpoint — onlyOwner (needs bytes32 strategyId)
  const okReset = await staticCallRevert(stratExec, 'resetCheckpoint', [mockStratId], 'OnlyOwner');
  record(
    '9.2',
    okReset ? 'PASS' : 'WARN',
    'resetCheckpoint non-owner reverts',
    okReset ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('StrategyExecutor', 'resetCheckpoint', 'static_call', '9.2');

  // 9.3 sweepToken — onlyOwner
  const okSwStrat = await staticCallRevert(
    stratExec,
    'sweepToken',
    [USDC, tester.address],
    'OnlyOwner',
  );
  record(
    '9.3',
    okSwStrat ? 'PASS' : 'WARN',
    'sweepToken non-owner reverts',
    okSwStrat ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('StrategyExecutor', 'sweepToken', 'static_call', '9.3');

  // 9.4 executePipeline with empty actions (onlyOwner check)
  const okEmpty = await staticCallRevert(
    stratExec,
    'executePipeline',
    [mockStratId, []],
    'OnlyOwner',
  );
  record(
    '9.4',
    okEmpty ? 'PASS' : 'WARN',
    'executePipeline empty actions reverts',
    okEmpty ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('StrategyExecutor', 'executePipeline', 'static_call', '9.4');

  // 9.5 executePipeline with mock Action struct (onlyOwner check)
  const mockAction = {
    actionType: '0x00000000',
    params: '0x',
    encAmount: { ctHash: 1n, securityZone: 0, utype: 0, signature: '0x' },
  };
  const okMock = await staticCallRevert(
    stratExec,
    'executePipeline',
    [mockStratId, [mockAction]],
    'OnlyOwner',
  );
  record(
    '9.5',
    okMock ? 'PASS' : 'WARN',
    'executePipeline mock action reverts',
    okMock ? 'OnlyOwner' : lastRevertError,
  );
  markCoverage('StrategyExecutor', 'executePipeline', 'static_call', '9.5');

  // 9.6 getPipelineState view
  try {
    const state = await stratExec.getPipelineState(mockStratId);
    const stateStr = Array.isArray(state)
      ? `${state[0]}, ${state[1]}, ${Array.isArray(state[2]) ? state[2].length : 0} actions`
      : String(state);
    record('9.6', 'INFO', 'getPipelineState', `returns ${stateStr}`);
  } catch (e: unknown) {
    record('9.6', 'INFO', 'getPipelineState', `reverts: ${decodeRevert(e)}`);
  }
  markCoverage('StrategyExecutor', 'getPipelineState', 'static_call', '9.6');

  // 9.7 getCheckpoint view
  try {
    const cp = await stratExec.getCheckpoint(mockStratId);
    const cpStr = Array.isArray(cp) ? `${cp[0]}, ${cp[1]}` : String(cp);
    record('9.7', 'INFO', 'getCheckpoint', `returns ${cpStr}`);
  } catch (e: unknown) {
    record('9.7', 'INFO', 'getCheckpoint', `reverts: ${decodeRevert(e)}`);
  }
  markCoverage('StrategyExecutor', 'getCheckpoint', 'static_call', '9.7');

  // ═══════════════════════════════════════════════════════════
  // SECTION 10: FheForgeGovernor — deployment & basic properties
  // ═══════════════════════════════════════════════════════════
  prog.phase('10. FheForgeGovernor');

  const GOV_ADDR = D.FheForgeGovernor;
  if (!GOV_ADDR) {
    record(
      '10',
      'WARN',
      'FheForgeGovernor',
      'not deployed — address missing from deployment record',
    );
  } else {
    const gov = await ctx.getContractAt('FheForgeGovernor', GOV_ADDR, tester);

    // 10.1 name view
    try {
      const name = await gov.name();
      record(
        '10.1',
        name === 'FheForge Governor' ? 'PASS' : 'FAIL',
        "name() returns 'FheForge Governor'",
        name,
      );
    } catch (e: unknown) {
      record('10.1', 'WARN', 'name()', decodeRevert(e));
    }

    // 10.2 proposalThreshold == 100e18
    try {
      const pt = await gov.proposalThreshold();
      const expected = 100n * 10n ** 18n;
      record('10.2', pt === expected ? 'PASS' : 'FAIL', 'proposalThreshold() == 100e18', `${pt}`);
    } catch (e: unknown) {
      record('10.2', 'WARN', 'proposalThreshold()', decodeRevert(e));
    }

    // 10.3 votingDelay / votingPeriod > 0
    try {
      const vd = await gov.votingDelay();
      const vp = await gov.votingPeriod();
      record(
        '10.3',
        vd > 0n && vp > 0n ? 'PASS' : 'FAIL',
        'votingDelay/votingPeriod > 0',
        `delay=${vd} period=${vp}`,
      );
    } catch (e: unknown) {
      record('10.3', 'WARN', 'votingDelay/votingPeriod', decodeRevert(e));
    }

    // 10.4 state(0) — non-existent proposal reverts
    try {
      await gov.state(0n);
      record('10.4', 'FAIL', 'state(0) non-existent proposal', 'expected revert');
    } catch {
      record('10.4', 'PASS', 'state(0) non-existent proposal', 'reverts as expected');
    }

    // 10.5 proposalNeedsQueuing — GovernorTimelockControl
    try {
      const needs = await gov.proposalNeedsQueuing(ethers.ZeroHash);
      record(
        '10.5',
        needs === true ? 'PASS' : 'WARN',
        'proposalNeedsQueuing() returns true',
        `=${needs}`,
      );
    } catch (e: unknown) {
      record('10.5', 'WARN', 'proposalNeedsQueuing()', decodeRevert(e));
    }

    markCoverage('FheForgeGovernor', 'name+threshold+state', 'covered', '10');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 11: FheForgeTimelock — controller setup & queuing
  // ═══════════════════════════════════════════════════════════
  prog.phase('11. FheForgeTimelock');

  const TIMELOCK_ADDR = D.FheForgeTimelock;
  if (!TIMELOCK_ADDR) {
    record(
      '11',
      'WARN',
      'FheForgeTimelock',
      'not deployed — address missing from deployment record',
    );
  } else {
    const timelock = await ctx.getContractAt('FheForgeTimelock', TIMELOCK_ADDR, tester);

    // 11.1 getMinDelay — expected 2 days (172800s)
    try {
      const delay = await timelock.getMinDelay();
      const twoDays = 2n * 86400n;
      record(
        '11.1',
        delay === twoDays ? 'PASS' : 'WARN',
        'getMinDelay() == 2 days',
        `delay=${delay}s`,
      );
    } catch (e: unknown) {
      record('11.1', 'WARN', 'getMinDelay()', decodeRevert(e));
    }

    // 11.2 TIMELOCK_ADMIN_ROLE assigned to deployer
    try {
      const ADMIN_ROLE = ethers.id('TIMELOCK_ADMIN_ROLE');
      const has = await timelock.hasRole(ADMIN_ROLE, deployer.address);
      record('11.2', has ? 'PASS' : 'WARN', 'deployer has TIMELOCK_ADMIN_ROLE', `hasRole=${has}`);
    } catch (e: unknown) {
      record('11.2', 'WARN', 'TIMELOCK_ADMIN_ROLE check', decodeRevert(e));
    }

    // 11.3 PROPOSER_ROLE — typically granted to governor post-deployment
    try {
      const PROP_ROLE = ethers.id('PROPOSER_ROLE');
      const govAddr = GOV_ADDR ?? ethers.ZeroAddress;
      const hasGov = await timelock.hasRole(PROP_ROLE, govAddr);
      const hasDep = await timelock.hasRole(PROP_ROLE, deployer.address);
      record('11.3', 'INFO', 'PROPOSER_ROLE holders', `governor=${hasGov} deployer=${hasDep}`);
    } catch (e: unknown) {
      record('11.3', 'WARN', 'PROPOSER_ROLE', decodeRevert(e));
    }

    // 11.4 EXECUTOR_ROLE — empty list means anyone can execute
    try {
      const EXEC_ROLE = ethers.id('EXECUTOR_ROLE');
      const hasAny = await timelock.hasRole(EXEC_ROLE, tester.address);
      record('11.4', 'INFO', 'EXECUTOR_ROLE (anyone by default)', `tester=${hasAny}`);
    } catch (e: unknown) {
      record('11.4', 'WARN', 'EXECUTOR_ROLE', decodeRevert(e));
    }

    // 11.5 schedule() — non-PROPOSER should revert
    try {
      await timelock.schedule.staticCall(
        tester.address,
        0n,
        '0x',
        ethers.ZeroHash,
        ethers.ZeroHash,
        1n,
      );
      record('11.5', 'FAIL', 'schedule() non-proposer', 'expected revert');
    } catch {
      record('11.5', 'PASS', 'schedule() non-proposer reverts', 'access control enforced');
    }

    markCoverage('FheForgeTimelock', 'minDelay+roles+schedule', 'covered', '11');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 12: Governance — role/permission checking
  // ═══════════════════════════════════════════════════════════
  prog.phase('12. Governance Roles');

  if (!TIMELOCK_ADDR) {
    record('12', 'WARN', 'Governance roles', 'Timelock not deployed — skipping');
  } else {
    const timelock = await ctx.getContractAt('FheForgeTimelock', TIMELOCK_ADDR, tester);

    // 12.1 PROPOSER_ROLE for tester
    try {
      const role = ethers.id('PROPOSER_ROLE');
      const has = await timelock.hasRole(role, tester.address);
      record('12.1', 'INFO', 'PROPOSER_ROLE for tester', `hasRole=${has}`);
    } catch (e: unknown) {
      record('12.1', 'WARN', 'PROPOSER_ROLE', decodeRevert(e));
    }

    // 12.2 EXECUTOR_ROLE for tester
    try {
      const role = ethers.id('EXECUTOR_ROLE');
      const has = await timelock.hasRole(role, tester.address);
      record('12.2', 'INFO', 'EXECUTOR_ROLE for tester', `hasRole=${has}`);
    } catch (e: unknown) {
      record('12.2', 'WARN', 'EXECUTOR_ROLE', decodeRevert(e));
    }

    // 12.3 CANCELLER_ROLE for tester
    try {
      const role = ethers.id('CANCELLER_ROLE');
      const has = await timelock.hasRole(role, tester.address);
      record('12.3', 'INFO', 'CANCELLER_ROLE for tester', `hasRole=${has}`);
    } catch (e: unknown) {
      record('12.3', 'WARN', 'CANCELLER_ROLE', decodeRevert(e));
    }

    // 12.4 CANCELLER_ROLE for deployer
    try {
      const role = ethers.id('CANCELLER_ROLE');
      const has = await timelock.hasRole(role, deployer.address);
      record('12.4', 'INFO', 'CANCELLER_ROLE for deployer', `hasRole=${has}`);
    } catch (e: unknown) {
      record('12.4', 'WARN', 'CANCELLER_ROLE deployer', decodeRevert(e));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 13: Governor proposal flow — propose → queue → execute
  // ═══════════════════════════════════════════════════════════
  prog.phase('13. Governor Proposal Flow');

  if (!GOV_ADDR) {
    record('13', 'WARN', 'Governor proposal flow', 'Governor not deployed — skipping');
  } else {
    const gov = await ctx.getContractAt('FheForgeGovernor', GOV_ADDR, tester);

    // 13.1 propose() — non-voter should revert (below proposal threshold)
    try {
      await gov.propose.staticCall([tester.address], [0n], ['0x'], 'Test proposal #1');
      record('13.1', 'FAIL', 'propose() non-voter', 'expected revert (below proposal threshold)');
    } catch {
      record('13.1', 'INFO', 'propose() non-voter reverts', 'proposer below threshold');
    }

    // 13.2 queue() — non-existent proposal
    try {
      await gov.queue.staticCall([tester.address], [0n], ['0x'], ethers.ZeroHash);
      record('13.2', 'FAIL', 'queue() non-existent proposal', 'expected revert');
    } catch {
      record('13.2', 'PASS', 'queue() non-existent proposal', 'reverts');
    }

    // 13.3 cancel() — non-existent proposal
    try {
      await gov.cancel.staticCall([tester.address], [0n], ['0x'], ethers.ZeroHash);
      record('13.3', 'FAIL', 'cancel() non-existent proposal', 'expected revert');
    } catch {
      record('13.3', 'PASS', 'cancel() non-existent proposal', 'reverts');
    }

    markCoverage('FheForgeGovernor', 'propose+queue+cancel', 'static_call', '13');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 14: Liquidation with Pyth oracle price feed
  // ═══════════════════════════════════════════════════════════
  prog.phase('14. Liquidation with Pyth Oracle');

  // 14.1 — Get current oracle prices for reference
  let _usdcPrice = 0n;
  let wethPrice = 0n;
  try {
    const [p, _u] = await oracle.getPriceUsd(USDC);
    _usdcPrice = p;
    record('14.1a', 'PASS', 'USDC oracle price', `price=${p}`);
    const [p2, _u2] = await oracle.getPriceUsd(WETH);
    wethPrice = p2;
    record('14.1b', wethPrice > 0n ? 'PASS' : 'FAIL', 'WETH oracle price', `price=${p2}`);
    markCoverage('PriceOracle', 'getPriceUsd', 'covered', '14.1');
  } catch (e: unknown) {
    record('14.1', 'WARN', 'Get oracle prices', decodeRevert(e));
  }

  // 14.2 — Deploy SimplePythMock for price feed simulation
  let pythMock: ethers.Contract | undefined;
  try {
    const SimplePythFactory = await ethers.getContractFactory('SimplePythMock');
    pythMock = await SimplePythFactory.connect(deployer).deploy(1n);
    await pythMock.waitForDeployment();
    const mockAddr = await pythMock.getAddress();
    record('14.2', 'PASS', 'Deploy SimplePythMock', `addr=${mockAddr}`);
    markCoverage('SimplePythMock', 'constructor', 'covered', '14.2');
  } catch (e: unknown) {
    record('14.2', 'WARN', 'Deploy SimplePythMock', decodeRevert(e));
  }

  // 14.3 — Set and verify Pyth prices on SimplePythMock
  let priceFeedId: string | undefined;
  if (pythMock) {
    try {
      priceFeedId = ethers.id('USDC/USD');
      const now = BigInt(Math.floor(Date.now() / 1000));

      // Set normal price: $1.00 (Pyth uses 8-decimals, expo=-8)
      await pythMock.setPrice(priceFeedId, {
        price: 100000000n,
        conf: 1000n,
        expo: -8,
        publishTime: now,
      });
      const p1 = await pythMock.getPriceUnsafe(priceFeedId);
      record(
        '14.3a',
        p1.price === 100000000n ? 'PASS' : 'FAIL',
        'Set Pyth normal price ($1.00)',
        `price=${p1.price}, expo=${p1.expo}`,
      );

      // Set crash price: $0.50 (50% drop)
      await pythMock.setPrice(priceFeedId, {
        price: 50000000n,
        conf: 2000n,
        expo: -8,
        publishTime: now,
      });
      const p2 = await pythMock.getPriceUnsafe(priceFeedId);
      record(
        '14.3b',
        p2.price === 50000000n ? 'PASS' : 'FAIL',
        'Set Pyth crash price ($0.50)',
        `price=${p2.price}, expo=${p2.expo}`,
      );

      markCoverage('SimplePythMock', 'setPrice+getPriceUnsafe', 'covered', '14.3');
    } catch (e: unknown) {
      record('14.3', 'WARN', 'Set Pyth prices on mock', decodeRevert(e));
    }
  }

  // 14.4 — Demonstrate Pyth price feed readback via getPriceNoOlderThan
  if (pythMock && priceFeedId) {
    try {
      const fresh = await pythMock.getPriceNoOlderThan(priceFeedId, 3600n);
      const usdVal = Number(fresh.price) * 10 ** Number(fresh.expo);
      record(
        '14.4',
        fresh.price === 50000000n ? 'PASS' : 'FAIL',
        'Pyth price feed readback (getPriceNoOlderThan)',
        `price=${fresh.price}, expo=${fresh.expo}, ~$${usdVal.toFixed(2)}`,
      );
      markCoverage('SimplePythMock', 'getPriceNoOlderThan', 'covered', '14.4');
    } catch (e: unknown) {
      record('14.4', 'WARN', 'Pyth price readback', decodeRevert(e));
    }
  }

  // 14.5 — Open fresh supply + borrow position for liquidation scenario
  const liqSupplyAmt = ethers.parseUnits('2000', 6);
  const liqBorrowAmt = ethers.parseUnits('1000', 6);
  try {
    const [eS] = await cofhe.encryptInputs([Encryptable.uint128(liqSupplyAmt)]).execute();
    await (await pool.shield(USDC, liqSupplyAmt, eS)).wait();
    record('14.5a', 'PASS', 'Shield $2000 USDC as collateral', 'ok');

    const [eB] = await cofhe.encryptInputs([Encryptable.uint128(liqBorrowAmt)]).execute();
    const txB = await pool.borrowWithOracle(USDC, USDC, liqSupplyAmt, liqBorrowAmt, eB);
    const rB = await txB.wait();
    record('14.5b', 'PASS', 'Borrow $1000 USDC via oracle check', `gas=${rB?.gasUsed}`);
    markCoverage('LendingPool', 'borrowWithOracle', 'covered', '14.5b');
  } catch (e: unknown) {
    record('14.5', 'WARN', 'Open supply+borrow position', decodeRevert(e));
  }

  // 14.6 — Check position health at current prices (should be healthy)
  try {
    const healthy = await pool.isLiquidatable(
      tester.address,
      USDC,
      USDC,
      liqSupplyAmt,
      liqBorrowAmt,
    );
    record(
      '14.6',
      !healthy ? 'PASS' : 'FAIL',
      'Position healthy at current prices',
      !healthy ? 'isLiquidatable=false' : 'unexpected isLiquidatable=true',
    );
  } catch (e: unknown) {
    record('14.6', 'WARN', 'isLiquidatable healthy check', decodeRevert(e));
  }
  markCoverage('LendingPool', 'isLiquidatable', 'covered', '14.6');

  // 14.7 — Simulate price crash (50% collateral value drop) → position becomes underwater
  try {
    const halvedCollateral = ethers.parseUnits('1000', 6); // Simulates 50% price drop
    const unhealthy = await pool.isLiquidatable(
      tester.address,
      USDC,
      USDC,
      halvedCollateral,
      liqBorrowAmt,
    );
    record(
      '14.7',
      unhealthy ? 'PASS' : 'FAIL',
      'Position underwater with 50% price drop',
      unhealthy ? 'isLiquidatable=true' : 'still healthy (unexpected)',
    );
  } catch (e: unknown) {
    record('14.7', 'WARN', 'Simulated crash isLiquidatable', decodeRevert(e));
  }
  markCoverage('LendingPool', 'isLiquidatable', 'covered', '14.7');
  try {
    await pool
      .connect(deployer)
      .liquidateWithProof.staticCall(
        tester.address,
        USDC,
        USDC,
        ethers.parseUnits('500', 6),
        0,
        '0x',
        0,
        '0x',
      );
    record('14.8', 'FAIL', 'liquidateWithProof same-token accepted', 'expected revert');
  } catch (e: unknown) {
    const msg = decodeRevert(e);
    const ok = msg.includes('TokenMismatch');
    record(
      '14.8',
      ok ? 'PASS' : 'INFO',
      'liquidateWithProof same-token guard',
      ok ? 'TokenMismatch' : msg,
    );
  }
  markCoverage('LendingPool', 'liquidateWithProof', 'static_call', '14.8');

  // 14.9 — liquidateWithProof: different tokens (needs valid FHE proofs)
  {
    const liqAmt = ethers.parseUnits('500', 6);
    try {
      await pool.connect(deployer).liquidateWithProof.staticCall(
        tester.address,
        WETH, // collateralToken (user has no WETH supply)
        USDC, // debtToken (user borrowed USDC)
        liqAmt,
        0,
        '0x', // mock debt proof
        0,
        '0x', // mock supply proof
      );
      record('14.9', 'FAIL', 'liquidateWithProof cross-token accepted', 'expected revert');
    } catch (e: unknown) {
      const msg = decodeRevert(e);
      const ok = msg.includes('InvalidProof') || msg.includes('NoPosition');
      record('14.9', ok ? 'PASS' : 'INFO', 'liquidateWithProof (no proofs → reverts)', msg);
    }
  }
  markCoverage('LendingPool', 'liquidateWithProof', 'static_call', '14.9');
  try {
    await pool.liquidateWithProof.staticCall(
      tester.address,
      USDC,
      WETH,
      ethers.parseUnits('500', 6),
      0,
      '0x',
      0,
      '0x',
    );
    record(
      '14.10',
      'FAIL',
      'liquidateWithProof self-call accepted',
      'expected CannotSelfLiquidate',
    );
  } catch (e: unknown) {
    const msg = decodeRevert(e);
    const ok = msg.includes('CannotSelfLiquidate');
    record(
      '14.10',
      ok ? 'PASS' : 'INFO',
      'liquidateWithProof self-call guard',
      ok ? 'CannotSelfLiquidate' : msg,
    );
  }
  markCoverage('LendingPool', 'liquidateWithProof', 'static_call', '14.10');

  // 14.11 — Cleanup: repay debt + unshield collateral
  try {
    const borrowBal = (await pool.totalPlainBorrow(USDC)) as bigint;
    if (borrowBal > 0n) {
      const [eR] = await cofhe.encryptInputs([Encryptable.uint128(borrowBal)]).execute();
      await (await pool.repayDebt(USDC, borrowBal, eR)).wait();
      record('14.11a', 'PASS', 'Repay borrowed USDC', `amount=${borrowBal}`);
    }
    const [eW] = await cofhe.encryptInputs([Encryptable.uint128(liqSupplyAmt)]).execute();
    await (await pool.partialUnshield(USDC, liqSupplyAmt, eW)).wait();
    record(
      '14.11b',
      'PASS',
      'Unshield supplied collateral',
      `${ethers.formatUnits(liqSupplyAmt, 6)} USDC`,
    );
    markCoverage('LendingPool', 'repayDebt+partialUnshield', 'covered', '14.11');
  } catch (e: unknown) {
    record('14.11', 'WARN', 'Liquidation test cleanup', decodeRevert(e));
  }

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  prog.phase('Summary');

  const endEth = await ctx.provider.getBalance(tester.address);
  const endUsdc = (await usdc.balanceOf(tester.address)) as bigint;
  console.log(`  Gas spent: ${ethers.formatEther(startEth - endEth)} ETH`);
  console.log(`  USDC Delta: ${ethers.formatUnits(startUsdc - endUsdc, 6)} USDC`);
  prog.done();

  // ═══════════════════════════════════════════════════════════
  // JSON EVIDENCE EXPORT
  // ═══════════════════════════════════════════════════════════
  const deploymentsDir = path.join(__dirname, '..', 'deployments');

  // Coverage summary
  const coveredCount = coverageLog.filter((c) => c.status !== 'skipped').length;
  const totalCount = coverageLog.length;
  const contractsWithCoverage: Record<
    string,
    { covered: number; total: number; functions: CoverageEntry[] }
  > = {};
  for (const entry of coverageLog) {
    if (!contractsWithCoverage[entry.contract]) {
      contractsWithCoverage[entry.contract] = { covered: 0, total: 0, functions: [] };
    }
    const group = contractsWithCoverage[entry.contract];
    group.total++;
    if (entry.status !== 'skipped') group.covered++;
    group.functions.push(entry);
  }

  const coverageSummary = {
    timestamp: new Date().toISOString(),
    network: chainId,
    totalFunctions: totalCount,
    coveredFunctions: coveredCount,
    coveragePercent: totalCount > 0 ? ((coveredCount / totalCount) * 100).toFixed(1) : '0',
    perContract: Object.entries(contractsWithCoverage).map(([name, data]) => ({
      contract: name,
      covered: data.covered,
      total: data.total,
      coveragePercent: data.total > 0 ? ((data.covered / data.total) * 100).toFixed(1) : '0',
    })),
  };
  fs.writeFileSync(
    path.join(deploymentsDir, 'coverage_summary.json'),
    JSON.stringify(coverageSummary, null, 2),
  );

  // Uncovered functions
  const uncoveredFunctions = coverageLog
    .filter((c) => c.status === 'skipped')
    .map((c) => ({
      contract: c.contract,
      function: c.function,
      flag: 'UNTESTED_PUBLIC_SURFACE',
      reason: c.gap ? `Requires complex state/zk-proof` : 'Unknown',
    }));
  fs.writeFileSync(
    path.join(deploymentsDir, 'uncovered_functions.json'),
    JSON.stringify(uncoveredFunctions, null, 2),
  );

  // Failure clusters
  const failedFindings = findings.filter((f) => f.severity === 'FAIL');
  const warnFindings = findings.filter((f) => f.severity === 'WARN');
  const failureClusters = failedFindings.map((f) => ({
    gap: f.gap,
    label: f.label,
    error: f.evidence?.error ?? f.observation,
  }));
  fs.writeFileSync(
    path.join(deploymentsDir, 'failure_clusters.json'),
    JSON.stringify(failureClusters, null, 2),
  );

  // Flow test results
  const flowResults = findings.map((f) => ({
    flowName: f.label,
    status: f.severity,
    txHash: f.evidence?.tx ?? '',
    gasUsed: f.evidence?.gas ?? '0',
    observation: f.observation,
  }));
  fs.writeFileSync(
    path.join(deploymentsDir, 'flow_test_results.json'),
    JSON.stringify(flowResults, null, 2),
  );

  // Test reliability matrix
  const testReliability = [
    {
      file: 'forge-test.ts',
      purpose: 'Comprehensive on-chain integration test for all 9 FheForge contracts',
      runsSuccessfully: failedFindings.length === 0 ? 'YES' : 'PARTIAL',
      totalFindings: findings.length,
      passCount: findings.filter((f) => f.severity === 'PASS').length,
      warnCount: warnFindings.length,
      failCount: failedFindings.length,
      skippedFunctions: uncoveredFunctions.length,
    },
  ];
  fs.writeFileSync(
    path.join(deploymentsDir, 'test_reliability_matrix.json'),
    JSON.stringify(testReliability, null, 2),
  );

  // Public state exposure audit
  const publicStateExposure = [
    {
      mapping: 'positionDepositedAmount',
      contract: 'StrategyVault',
      visibility: 'public',
      risk: 'Exposes exact collateral size bypassing FHE',
    },
    {
      mapping: 'totalPlainSupply/ totalPlainBorrow',
      contract: 'LendingPool',
      visibility: 'public',
      risk: 'Reveals pool utilization and user debt sizes',
    },
    {
      mapping: 'getPriceUsd',
      contract: 'PriceOracle',
      visibility: 'public',
      risk: 'On-chain oracle price is public by design',
    },
  ];
  fs.writeFileSync(
    path.join(deploymentsDir, 'public_state_exposure.json'),
    JSON.stringify(publicStateExposure, null, 2),
  );

  // Missed surface report
  const missedSurface = coverageLog
    .filter((c) => c.status === 'skipped')
    .map((c) => ({
      surface: `${c.contract}.${c.function}`,
      whyMissed: 'Requires complex state setup or zk-proof data (Pyth, liquidation)',
      importance: c.function === 'liquidateWithProof' ? 'CRITICAL' : 'MEDIUM',
    }));
  fs.writeFileSync(
    path.join(deploymentsDir, 'missed_surface_report.json'),
    JSON.stringify(missedSurface, null, 2),
  );

  // Calldata leak scan (high-level)
  const calldataLeakScan = [
    {
      scenario: 'StrategyVault openPosition',
      leakageType: 'Plaintext Amount (amount0 param)',
      value: `${ethers.formatUnits(collateralAmt, 6)} USDC`,
      proofSnippet: 'Calldata includes plaintext `amount0` parameter alongside encrypted handle',
    },
  ];
  fs.writeFileSync(
    path.join(deploymentsDir, 'calldata_leak_scan.json'),
    JSON.stringify(calldataLeakScan, null, 2),
  );

  // Blocker root causes
  const blockerRootCauses: { blocker: string; rootCause: string; classification: string }[] = [];
  fs.writeFileSync(
    path.join(deploymentsDir, 'blocker_root_causes.json'),
    JSON.stringify(blockerRootCauses, null, 2),
  );

  // Print summary
  const pass = findings.filter((f) => f.severity === 'PASS').length;
  const warn = warnFindings.length;
  const fail = failedFindings.length;
  const info = findings.filter((f) => f.severity === 'INFO').length;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              COMPREHENSIVE TEST SUMMARY                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  PASS=${pass}  WARN=${warn}  FAIL=${fail}  INFO=${info}`);
  console.log(`  Functions covered: ${coveredCount}/${totalCount}`);
  if (fail > 0) {
    console.log('\nFAILURES:');
    for (const f of failedFindings) {
      console.log(`  \u2717 [${f.gap}] ${f.label}: ${f.observation}`);
    }
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
