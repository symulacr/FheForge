#!/usr/bin/env bash
# sync-abis.sh — Regenerate bridge ABIs from Foundry compiled artifacts
# Usage: bash scripts/sync-abis.sh
# Prerequisites: forge build (contracts/out/ must exist)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/contracts/out"
ABI_FILE="$ROOT/packages/forge-bridge/src/abis.js"

if [ ! -d "$OUT_DIR" ]; then
  echo "ERROR: contracts/out/ not found. Run 'forge build' first."
  exit 1
fi

# Contract name → abis.js key mapping
# Most match 1:1. Composer is the exception (FheForgeComposer → Composer).
declare -A MAP=(
  [LendingPool]=LendingPool
  [StrategyVault]=StrategyVault
  [FheForgeComposer]=Composer
  [SwapRouter]=SwapRouter
  [PriceOracle]=PriceOracle
  [StrategyRegistry]=StrategyRegistry
  [StrategyExecutor]=StrategyExecutor
  [TokenRegistry]=TokenRegistry
  [ExecutorContract]=ExecutorContract
)

# Preserve existing CONTRACT_ADDRESSES block
ADDRESSES=$(sed -n '/^export const CONTRACT_ADDRESSES/,/^};/p' "$ABI_FILE")

if [ -z "$ADDRESSES" ]; then
  echo "ERROR: Could not extract CONTRACT_ADDRESSES from existing abis.js"
  exit 1
fi

# Generate CONTRACT_ABIS block
echo "Generating ABIs from Foundry artifacts..."

{
  cat <<'HEADER'
// @generated - Generated from contracts/out/*.json compiled output
// biome-ignore format: generated file, large ABI arrays
// @ts-nocheck - Large static ABI arrays; viem compatibility handled via type assertion

/** @type {import('./types.js').ContractAbiMap} */
export const CONTRACT_ABIS = {
HEADER

  TMPFILE=$(mktemp)
  for ARTIFACT_NAME in LendingPool StrategyVault FheForgeComposer SwapRouter PriceOracle StrategyRegistry StrategyExecutor TokenRegistry ExecutorContract; do
    KEY="${MAP[$ARTIFACT_NAME]}"
    ARTIFACT_PATH="$OUT_DIR/${ARTIFACT_NAME}.sol/${ARTIFACT_NAME}.json"

    if [ ! -f "$ARTIFACT_PATH" ]; then
      echo "WARNING: $ARTIFACT_PATH not found, skipping" >&2
      continue
    fi

    ABI=$(jq '.abi' "$ARTIFACT_PATH")
    ENTRY_COUNT=$(echo "$ABI" | jq 'length')
    echo "  $KEY: $ABI," >> "$TMPFILE"
    echo "  ✓ $KEY ($ENTRY_COUNT entries) ← $ARTIFACT_NAME" >&2
  done

  cat "$TMPFILE"
  rm -f "$TMPFILE"

  echo "};"
  echo ""
  echo "$ADDRESSES"
} > "$ABI_FILE"

LINES=$(wc -l < "$ABI_FILE")
echo ""
echo "Written: $ABI_FILE ($LINES lines)"
echo "Done."
