/**
 * deploy-utils.ts
 * Shared deploy utilities for FheForge scripts.
 *
 * Types, helpers, retry, progress bar, nonce manager, gas config, fast verifier.
 * Uses Hardhat runtime augmentations (tsconfig files entry must include hardhat.config.ts).
 */

import * as hre from 'hardhat';

const { ethers, artifacts } = hre;

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BaseContract, ContractFactory, Provider, Signer } from 'ethers';
import type { Artifact } from 'hardhat/types';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface DeployRecord {
  network: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
  mode: string;
  wave?: number;
  contracts: Record<string, string>;
  deploymentTxs: Record<string, string | null>;
  swapExecutor: string;
  weth: string;
  forwarder?: string;
  tokens?: Record<string, string>;
  notes?: string;
  waveDescription?: string;
  timing?: Record<string, string>;
  verificationStatus?: Record<string, boolean>;
}

export interface ContractInfo {
  contractName: string;
  fqn: string;
  address: string;
  args: unknown[];
  envKey?: string;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const stamp = () => new Date().toISOString().slice(11, 19);
const h0 = process.hrtime.bigint();
export const elapsed = (from: bigint) => {
  const ms = Number(process.hrtime.bigint() - from) / 1e6;
  return ms > 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${ms.toFixed(0)}s`;
};

/** Deployment record path for the given chain. */
export function deploymentRecordPath(chainId: number): string {
  return path.join(__dirname, '..', '..', 'deployments', `${chainId}.json`);
}

/** Load an existing deployment record, or null. */
export function loadDeploymentRecord(chainId: number): DeployRecord | null {
  const fp = deploymentRecordPath(chainId);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as DeployRecord;
  } catch {
    console.warn(`Could not parse ${fp} — proceeding with fresh deploy.`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Retry
// ═══════════════════════════════════════════════════════════

export async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      if (i === retries - 1) throw e;
      const delay = 1000 * 2 ** i + Math.random() * 500;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(
        `  ! ${label} failed (${msg.slice(0, 80)}), retry ${i + 1}/${retries} in ${delay | 0}ms`,
      );
      await sleep(delay);
    }
  }
  throw new Error('unreachable');
}

// ═══════════════════════════════════════════════════════════
// Progress monitor
// ═══════════════════════════════════════════════════════════

export class Progress {
  t0 = h0;
  tp = this.t0;
  ok = 0;
  fail = 0;

  phase(name: string) {
    if (this.tp !== this.t0) console.log(`  ✔ ${elapsed(this.tp)}`);
    console.log(`\n▸ [${stamp()}] ${name}`);
    this.tp = process.hrtime.bigint();
  }

  item(ok: boolean, msg: string) {
    ok ? this.ok++ : this.fail++;
    console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  }

  done() {
    console.log(`\n━━━ Done  ${this.ok} ok  ${this.fail} fail  ${elapsed(this.t0)} total ━━━\n`);
  }
}

// ═══════════════════════════════════════════════════════════
// Nonce manager
// ═══════════════════════════════════════════════════════════

export class NonceManager {
  n!: number;

  async init(signer: Signer) {
    this.n = await signer.getNonce('pending');
  }

  next() {
    return this.n++;
  }

  /** Deploy a single contract (one nonce), returning the typed contract. */
  async one<T extends BaseContract>(
    factory: ContractFactory,
    args: unknown[] = [],
    overrides: Record<string, unknown> = {},
  ): Promise<T> {
    const nonce = this.n++;
    const c = (await factory.deploy(...args, { type: 0, ...overrides, nonce })) as unknown as T;
    await c.waitForDeployment();
    return c;
  }
}

// ═══════════════════════════════════════════════════════════
// Gas config
// ═══════════════════════════════════════════════════════════

export async function gasOverrides(
  _provider: Provider,
): Promise<{ gasPrice: bigint; gasLimit: bigint }> {
  /* Use legacy gasPrice for Arb Sepolia compatibility. */
  return { gasPrice: 50_000_000_000n, gasLimit: 5_000_000n };
}

// ═══════════════════════════════════════════════════════════
// Fast Etherscan verifier (v2 unified API, no recompilation)
// ═══════════════════════════════════════════════════════════

export class FastVerifier {
  private apiKey: string;
  private apiUrl: string;

  constructor(chainId: number) {
    this.apiKey = process.env.ETHERSCAN_API_KEY ?? '';
    this.apiUrl = `https://api.etherscan.io/v2/api?chainid=${chainId}`;
  }

  get enabled() {
    return !!this.apiKey;
  }

  /**
   * Submit one contract for verification and poll until done.
   * Uses the v2 unified Etherscan API.
   */
  async verifyOne(
    fqn: string,
    address: string,
    encodedArgs: string,
    solcVersion: string,
    compilerInput: object,
  ): Promise<{ success: boolean; message: string }> {
    const body = new URLSearchParams({
      module: 'contract',
      action: 'verifysourcecode',
      contractaddress: address,
      sourceCode: JSON.stringify(compilerInput),
      codeformat: 'solidity-standard-json-input',
      contractname: fqn,
      compilerversion: `v${solcVersion}`,
      constructorArguements: encodedArgs,
    });
    const submitUrl = `${this.apiUrl}&apikey=${this.apiKey}`;
    const subResp: unknown = await (
      await fetch(submitUrl, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    ).json();
    const sub = subResp as Record<string, unknown>;
    const guid = typeof sub.result === 'string' ? sub.result : undefined;
    if (!guid || sub.status !== '1') {
      if ((guid ?? '').includes('Already Verified')) {
        return { success: true, message: 'Already Verified' };
      }
      return {
        success: false,
        message: guid ?? (typeof sub.message === 'string' ? sub.message : 'unknown'),
      };
    }

    const start = Date.now();
    const timeoutMs = 120_000;
    let interval = 1_000;
    while (Date.now() - start < timeoutMs) {
      await sleep(interval);
      const pollUrl = `${this.apiUrl}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${this.apiKey}`;
      const p: unknown = await (await fetch(pollUrl)).json();
      const pResult =
        typeof (p as Record<string, unknown>).result === 'string'
          ? ((p as Record<string, unknown>).result as string)
          : undefined;
      if (pResult === 'Pass - Verified') return { success: true, message: 'Pass - Verified' };
      if ((pResult ?? '').startsWith('Fail')) return { success: false, message: pResult };
      if (pResult === 'Already Verified') return { success: true, message: 'Already Verified' };
      const e = Date.now() - start;
      interval = e > 30_000 ? 3_000 : e > 10_000 ? 2_000 : 1_000;
    }
    return { success: false, message: `Timeout after ${timeoutMs}ms` };
  }

  /**
   * Verify a batch of contracts using parallel Etherscan submissions.
   * Uses local compiler build artifacts (no Hardhat recompilation).
   */
  async verifyBatch(
    items: ContractInfo[],
    cache: Set<string>,
  ): Promise<{ name: string; ok: boolean; msg: string }[]> {
    if (!this.enabled) {
      return items.map((i) => ({
        name: i.contractName,
        ok: false,
        msg: 'No API key',
      }));
    }

    const results: { name: string; ok: boolean; msg: string }[] = [];
    const batch: ContractInfo[] = [];
    for (const item of items) {
      if (cache.has(item.address)) {
        results.push({ name: item.contractName, ok: true, msg: 'cached' });
      } else {
        batch.push(item);
      }
    }
    if (batch.length === 0) return results;

    // Fetch built artifacts and encode deploy args
    const buildInfos: {
      fqn: string;
      input: unknown;
      solcLongVersion: string;
      encodedArgs: string;
    }[] = [];
    for (const item of batch) {
      const bi = await withRetry(
        () => artifacts.getBuildInfo(item.fqn),
        `buildInfo ${item.contractName}`,
      );
      if (!bi) throw new Error(`No build-info for ${item.fqn} — compile first`);
      const iface = new ethers.Interface(
        ((await artifacts.readArtifact(item.contractName)) as Artifact).abi,
      );
      buildInfos.push({
        fqn: item.fqn,
        input: bi.input,
        solcLongVersion: bi.solcLongVersion,
        encodedArgs: iface.encodeDeploy(item.args).slice(2),
      });
    }

    // Submit in parallel, with small stagger to avoid rate limits
    const concurrency = 5;
    for (let i = 0; i < batch.length; i += concurrency) {
      const chunk = batch.slice(i, i + concurrency);
      const infos = buildInfos.slice(i, i + concurrency);
      const submissions = await Promise.allSettled(
        infos.map((info, j) =>
          sleep(j * 200).then(() =>
            this.verifyOne(
              info.fqn,
              chunk[j].address,
              info.encodedArgs,
              info.solcLongVersion,
              info.input,
            ),
          ),
        ),
      );
      for (let k = 0; k < chunk.length; k++) {
        const r = submissions[k];
        const ok = r.status === 'fulfilled' ? r.value.success : false;
        const msg = r.status === 'fulfilled' ? r.value.message : (r.reason?.toString() ?? 'error');
        results.push({ name: chunk[k].contractName, ok, msg });
        if (ok) cache.add(chunk[k].address);
      }
    }
    return results;
  }
}
