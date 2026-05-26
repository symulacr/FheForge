#!/usr/bin/env bun
/**
 * MC-023: E2E Contract Consistency Probe
 *
 * Reads all contract addresses from deployment artifacts, .env files, and
 * the README, then verifies each has live bytecode on-chain via `cast code`.
 *
 * Usage:
 *   bun run scripts/verify-addresses.ts
 *   RPC_URL=https://sepolia-rollup.arbitrum.io/rpc bun run scripts/verify-addresses.ts
 *
 * Exit codes:
 *   0 — all addresses verified
 *   1 — one or more addresses have no bytecode (or unreadable source)
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── RPC ────────────────────────────────────────────────────────────────────
const RPC_URL =
  process.env.RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";

// ── Sources ────────────────────────────────────────────────────────────────

interface AddressEntry {
  source: string; // file that defines the address
  name: string; // logical name (contract name or env var name)
  address: string; // ethereum address
}

function fromDeploymentJson(): AddressEntry[] {
  const entries: AddressEntry[] = [];
  const depDir = resolve(ROOT, "deployments");
  const files = ["421614.json"];

  for (const file of files) {
    const path = resolve(depDir, file);
    if (!existsSync(path)) continue;
    const content = JSON.parse(readFileSync(path, "utf-8"));
    if (content.mode === "not-deployed") continue;

    for (const [name, addr] of Object.entries(content.contracts ?? {})) {
      entries.push({
        source: `deployments/${file} (${content.mode ?? "unknown"})`,
        name,
        address: addr as string,
      });
    }

    for (const key of ["weth", "usdc", "usdt"] as const) {
      if (content[key]) {
        entries.push({
          source: `deployments/${file}`,
          name: key.toUpperCase(),
          address: content[key],
        });
      }
    }
  }
  return entries;
}

function fromEnvFile(relPath: string, varPrefix: string): AddressEntry[] {
  const entries: AddressEntry[] = [];
  const path = resolve(ROOT, "..", relPath);
  if (!existsSync(path)) return entries;

  const text = readFileSync(path, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    // Match env vars containing ADDRESS, ADDR, or known prefixes
    if (
      (key.includes("ADDRESS") || key.startsWith(varPrefix)) &&
      /^0x[a-fA-F0-9]{40}$/.test(val)
    ) {
      entries.push({ source: relPath, name: key, address: val });
    }
  }
  return entries;
}

function fromReadme(): AddressEntry[] {
  const entries: AddressEntry[] = [];
  const path = resolve(ROOT, "..", "README.md");
  if (!existsSync(path)) return entries;

  const text = readFileSync(path, "utf-8");
  // Parse markdown table rows: | ContractName | 0x... |
  const rowRe = /^\|\s*(\w+)\s*\|\s*(0x[a-fA-F0-9]{40})\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(text)) !== null) {
    const [, name, address] = match;
    if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
      entries.push({ source: "README.md", name, address });
    }
  }
  return entries;
}

// ── On-chain verification ──────────────────────────────────────────────────

function hasBytecode(address: string): boolean {
  try {
    const out = execSync(
      `cast code ${address} --rpc-url ${RPC_URL} 2>/dev/null`,
      { encoding: "utf-8", timeout: 30_000 },
    ).trim();
    // `cast code` returns "0x" for EOA / empty, actual code for contracts
    return out !== "" && out !== "0x";
  } catch {
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): number {
  const allEntries: AddressEntry[] = [
    ...fromDeploymentJson(),
    ...fromEnvFile("ui/.env.local", "NEXT_PUBLIC_"),
    ...fromEnvFile("ui/.env.example", "NEXT_PUBLIC_"),
    ...fromEnvFile("backend/apps/.env.development", ""),
    ...fromReadme(),
  ];

  // Deduplicate by (name, address) — keep first occurrence
  const seen = new Set<string>();
  const unique = allEntries.filter((e) => {
    const key = `${e.name}|${e.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\n🔍 Verifying ${unique.length} unique addresses on-chain (RPC: ${RPC_URL})\n`);

  let passed = 0;
  let failed = 0;

  for (const entry of unique) {
    const ok = hasBytecode(entry.address);
    const mark = ok ? "✅" : "❌";
    const pad = entry.name.padEnd(32);
    console.log(`  ${mark} ${pad} ${entry.address}  (${entry.source})`);
    if (ok) passed++;
    else failed++;
  }

  const total = passed + failed;
  console.log(`\n📊 ${passed}/${total} addresses verified (${failed} failed)\n`);

  if (failed > 0) {
    console.error("❌ Some addresses have no on-chain bytecode. Possible causes:");
    console.error("   - Contract not deployed on this chain");
    console.error("   - Wrong RPC endpoint");
    console.error("   - Address was from a different deployment wave");
    console.error("   - Contract self-destructed");
    return 1;
  }

  console.log("✅ All addresses verified — every contract has live bytecode.\n");
  return 0;
}

process.exit(main());
