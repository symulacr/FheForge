# Agent 2 — Frontend Microchange Plan

**Project:** FheForge — FHE DeFi Platform (Next.js 14)
**Scope:** `ui/` — 19 hooks, services, components, ~26.6K LOC
**Date:** 2026-05-18
**Status:** Current codebase audit with Wave 10 remediations partially applied

---

## Key

- **🟢 = Already fixed** in current codebase (verified by reading source)
- **🟡 = Needs implementation** (code change required)
- **🔴 = Runtime bug** (must fix immediately)

---

## P0 — Runtime Bugs (fix immediately)

---

### MC-F2-01 🔴 · ConfigPanel render-side-effect causes infinite re-render loop

**File:** `ui/app/builder/components/ConfigPanel.tsx` lines 219–299
**Logic:** State setters (`setTokenIn`, `setTokenOut`, `setAmount`, `setEstimate`, `setIsInitializing`) called directly in the render body (between `if (pairs.length > 0 && ...)` block). React batches state updates from render, but the init logic runs on every render when the ref check fails — causing an infinite loop because each render triggers new state, which triggers re-render. Must wrap in `useEffect`.

**Old (render-body side effect):**
```typescript
// lines 219-299 — raw conditional block during render
if (
  pairs.length > 0 &&
  initializedNodeIdRef.current !== node.id
) {
  initializedNodeIdRef.current = node.id;
  const config = node?.data?.config;
  if (config?.tokenInPairId || config?.tokenInId) {
    // ... setTokenIn(), setTokenOut(), setAmount(), setEstimate(), setIsInitializing(false)
  } else if (prevConfig) {
    // ... setTokenIn(), setTokenOut(), setEstimate(), setIsInitializing()
  } else {
    // ... setTokenIn(), setTokenOut(), setIsInitializing()
  }
}
```

**New (wrapped in useEffect):**
```typescript
// Replace the render-body block with:
useEffect(() => {
  if (pairs.length > 0 && initializedNodeIdRef.current !== node.id) {
    initializedNodeIdRef.current = node.id;
    const config = node?.data?.config;

    if (config?.tokenInPairId || config?.tokenInId) {
      // ... [same initialization logic]
    } else if (prevConfig) {
      // ... [same initialization logic]
    } else {
      // ... [same initialization logic]
    }
  }
}, [pairs, node.id, node.data?.config, prevConfig, requiresTokenOut]);
// Dependencies: all values read inside the effect
```

**Priority:** P0
**Test Required:** Open ConfigPanel on SWAP/SUPPLY/BORROW node — observe no console spam, no infinite re-render, form initializes to correct saved values.

---

### MC-F2-02 🔴 · ProtocolIcon hardcodes weth.svg, takes no props

**File:** `ui/app/builder/components/nodes/protocol-icon.tsx` (entire file)
**Logic:** Component renders `/icons/assets/weth.svg` unconditionally. Must accept a `symbol` prop and look up icon from `agentIcons` map (or fall back to a generic icon). Consumers (`defi-node-shell.tsx` line 74) pass a `protocolName` prop but `ProtocolIcon` ignores it.

**Old:**
```typescript
import Image from "next/image";

export default function ProtocolIcon() {
  return (
    <div className="w-6 h-6 relative border border-border bg-card overflow-hidden shrink-0">
      <Image
        src="/icons/assets/weth.svg"
        alt="Protocol"
        width={24}
        height={24}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
```

**New:**
```typescript
import Image from "next/image";
import { agentIcons } from "@/lib/iconMap";

type ProtocolIconProps = {
  symbol?: string;
};

export default function ProtocolIcon({ symbol = "FHENIX" }: ProtocolIconProps) {
  const iconSrc = agentIcons[symbol?.toUpperCase()] ?? agentIcons.FHENIX;

  return (
    <div className="w-6 h-6 relative border border-border bg-card overflow-hidden shrink-0">
      <Image
        src={iconSrc}
        alt={symbol}
        width={24}
        height={24}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
```

**Also update caller** `ui/app/builder/components/nodes/defi-node-shell.tsx` line 74:
```typescript
// Old:
<ProtocolIcon />
// New:
<ProtocolIcon symbol={protocolName} />
```

**Priority:** P0
**Test Required:** Visible protocol icon in each DefiNode card — shows correct icon matching protocol name.

---

### MC-F2-03 🔴 · Duplicate SWAP case in getAmountOut (dead code)

**File:** `ui/app/builder/components/ConfigPanel.tsx` lines 422–458
**Logic:** The `getAmountOut()` switch has two identical `case "SWAP":` blocks (lines 424–431 and 433–441). The second one is unreachable dead code with an extra `estimate?.shares_out` fallback. Remove the duplicate.

**Old:**
```typescript
const getAmountOut = () => {
  switch (resolvedType) {
    case "SWAP":
      return (
        estimate?.amount_out ??
        estimate?.output_amount ??
        estimate?.result_amount ??
        estimate?.received_amount ??
        null
      );

    case "SWAP":   // DUPLICATE — identical case, unreachable
      return (
        estimate?.amount_out ??
        estimate?.output_amount ??
        estimate?.result_amount ??
        estimate?.received_amount ??
        estimate?.shares_out ??
        null
      );

    case "SUPPLY":
      return null;
    // ...
  }
};
```

**New:**
```typescript
const getAmountOut = () => {
  switch (resolvedType) {
    case "SWAP":
      return (
        estimate?.amount_out ??
        estimate?.output_amount ??
        estimate?.result_amount ??
        estimate?.received_amount ??
        estimate?.shares_out ??
        null
      );

    case "SUPPLY":
      return null;

    case "BORROW":
      return (
        estimate?.borrow_amount ??
        estimate?.amount_out ??
        estimate?.output_amount ??
        estimate?.received_amount ??
        null
      );

    default:
      return null;
  }
};
```

**Priority:** P0
**Test Required:** `getAmountOut("SWAP")` returns `estimate?.shares_out` when other fields are null — merged logic from the second (formerly unreachable) case.

---

### MC-F2-04 🔴 · StrategyPromptDetails is "Coming Soon" stub

**File:** `ui/app/strategy/[id]/components/strategy-prompt-details.tsx` (entire file)
**Logic:** Component renders a static "Coming Soon" placeholder. Never implemented. Displayed in the "Strategy Prompt" tab of strategy detail page.

**Old:**
```typescript
"use client";
import React from "react";

export default function StrategyPromptDetails() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <div className="text-6xl mb-4">🚧</div>
        <h2 className="text-2xl font-semibold text-foreground">Coming Soon</h2>
        <p className="text-muted-foreground text-sm max-w-md">
          Strategy prompt details will be available soon.
        </p>
      </div>
    </div>
  );
}
```

**New (implement with prompt data from strategy):**
```typescript
"use client";
import React from "react";
import { DefiStrategy } from "@/types/defi.strategy";

interface Props {
  strategy?: DefiStrategy;
}

export default function StrategyPromptDetails({ strategy }: Props) {
  const prompt = strategy?.prompt || strategy?.description || "";
  const context = strategy?.context || "";

  return (
    <div className="space-y-6">
      {context && (
        <div className="glass p-5">
          <h3 className="text-xs uppercase tracking-widest text-primary font-bold mb-2">
            Context
          </h3>
          <p className="text-sm text-foreground/80 leading-relaxed">{context}</p>
        </div>
      )}
      {prompt ? (
        <div className="glass p-5">
          <h3 className="text-xs uppercase tracking-widest text-primary font-bold mb-2">
            Prompt
          </h3>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {prompt}
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted text-sm">No prompt data available for this strategy.</p>
        </div>
      )}
    </div>
  );
}
```

**Also pass strategy prop from** `ui/app/strategy/[id]/components/strategy-tabs.tsx` line 107:
```typescript
// Old:
<StrategyPromptDetails />
// New:
<StrategyPromptDetails strategy={strategy} />
```

**Priority:** P0
**Test Required:** Strategy detail page "Strategy Prompt" tab displays the strategy's prompt/context instead of "Coming Soon".

---

### MC-F2-05 🔴 · useRebalance exists but has zero consumers

**File:** `ui/hooks/use-rebalance.ts` (entire 97-line file)
**Logic:** `useRebalance()` is fully implemented with `rebalance`, `rebalanceWithEncrypt`, and `encryptRebalanceParams`. Zero consumers in `ui/app/` or `ui/components/`. Either delete it or wire it into the strategy detail page.

**Option A — Wire into strategy detail page (`ui/app/strategy/[id]/components/strategy-overview.tsx`):**
```typescript
import { useRebalance } from "@/hooks/use-rebalance";
import { useAccount } from "wagmi";
// ... inside component, after existing hooks:
const { rebalanceWithEncrypt, isPending } = useRebalance();
const { address } = useAccount();

const handleRebalance = async () => {
  if (!address) return;
  try {
    await rebalanceWithEncrypt({
      positionId: `0x${"0".repeat(64)}` as `0x${string}`, // TODO: read from active position
      collateralToken: TOKEN_SYMBOL_MAP.WETH.address as `0x${string}`,
      addCollateralAmount: 0n,
      repayAmount: 0n,
      repayToken: TOKEN_SYMBOL_MAP.WETH.address as `0x${string}`,
      newBorrowAmount: 0n,
      borrowToken: TOKEN_SYMBOL_MAP.USDC.address as `0x${string}`,
      useOracleBorrow: true,
      ltvNum: 7500n,
      ltvDen: 10000n,
    });
  } catch (e) {
    console.error("Rebalance failed:", e);
  }
};
```

**Option B — Delete the file** if `useComposer().openPosition` covers all rebalance needs.

**Priority:** P0
**Test Required:** No lint/type errors after deletion or after wiring. If wired, rebalance button triggers contract call.

---

## P1 — Functional Gaps (verified current state)

---

### MC-F2-06 🟢 · MC-07/08: onlyComposer-gated direct calls removed

**File:** `ui/hooks/use-fhe-vault.ts`
**Status:** ✅ Already fixed. `supplyToLending` and `borrowFromLending` have been removed. Lines 182–184 contain deprecation comments directing to `useComposer().openPosition` or `useRebalance()`.
**Verification:** `grep` for `supplyToLending` and `borrowFromLending` in `use-fhe-vault.ts` returns 0 function definitions. Only MC comment references remain.

**Priority:** P1 (already fixed)

---

### MC-F2-07 🟢 · MC-09: strategyId parameter added to openPosition

**File:** `ui/hooks/use-fhe-vault.ts` lines 111–150
**Status:** ✅ Already fixed. `openPosition(collateralToken, collateralAmount, strategyId = 0n, positionId?)` signature accepts `strategyId: bigint = 0n` and passes it as 5th arg (before `userAddr`).
**Verification:** Line 114 shows `strategyId: bigint = 0n` parameter. Lines 133–140 show it in the `args` array.

**Priority:** P1 (already fixed)

---

### MC-F2-08 🟢 · MC-10/11: Permit2 address + indentation

**Files:** `ui/hooks/use-permit2.ts`
**Status:** ✅ Scope resolved. The V2 refactor explicitly chose "no Permit2" (see `.env.local` line 5 comment). No `use-permit2.ts` file exists in the codebase. No Permit2 address references exist outside ABI files. No action needed.

**Priority:** P1 (deferred — no Permit2 in current scope)

---

### MC-F2-09 🟢 · MC-12/13/14: Return object, addCollateral, PoolABI import

**File:** `ui/hooks/use-fhe-vault.ts`
**Status:** ✅ Already fixed.
- **MC-12:** Return object correctly includes `addCollateral`, `supplyEth`, `withdrawEth`, excludes old `supplyToLending`/`borrowFromLending`.
- **MC-13:** `addCollateral` hook is fully implemented (lines 153–180) with fallback to `userPositionIds[0]`.
- **MC-14:** PoolABI import remains for `repay`, `withdrawSupply`, `supplyEth`, `withdrawEth`.

**Priority:** P1 (already fixed)

---

### MC-F2-10 🟢 · MC-18/19: strategy-builder openPosition + addCollateral

**File:** `ui/hooks/use-strategy-builder.ts`
**Status:** ✅ Already fixed.
- **MC-18:** Line 449–453 calls `openPosition(collateralToken, collateralEth, BigInt(strategyId))` with the third argument as `BigInt(strategyId)`.
- **MC-19:** Line 148 destructures `{ openPosition, addCollateral }` from `useFheVault()`.

**Priority:** P1 (already fixed)

---

### MC-F2-11 🟢 · MC-20/21/22: supplyEth/withdrawEth — correct target, return

**File:** `ui/hooks/use-fhe-vault.ts` lines 266–293
**Status:** ✅ Already fixed.
- **MC-20:** `supplyEth` (line 266) calls `pool.shieldEth` with `PoolABI` and `value: amount` — correct LendingPool target.
- **MC-21:** `withdrawEth` (line 285) calls `pool.partialUnshieldEth` with `PoolABI` — correct LendingPool target.
- **MC-22:** Both `supplyEth` and `withdrawEth` are in the return object (lines 323–324).

**Priority:** P1 (already fixed)

---

### MC-F2-12 🟢 · MC-24/25/26: Portfolio balance reads

**File:** `ui/hooks/use-portfolio.ts`
**Status:** ✅ Already fixed.
- **MC-24:** `getPositionMeta(positionId)` reads correctly (line 55–62).
- **MC-25:** `getDepositedAmount(positionId)` and `getCollateral(positionId)` hooks exist (lines 65–82).
- **MC-26:** Pool plain balance reads (`getPlainSupplyBalance`, `getPlainBorrowBalance`) exist (lines 92–118).

**Priority:** P1 (already fixed)

---

### MC-F2-13 🟢 · MC-27/28: Encryption type — uint128

**Files:** `ui/hooks/use-fhe-vault.ts` line 60, `ui/hooks/use-composer.ts` line 66
**Status:** ✅ Already fixed. Both use `Encryptable.uint128(value)` for euint128 collateral amounts.

**Verification:** `use-fhe-vault.ts`: `Encryptable.uint128(value)` at line 60. `use-composer.ts`: `Encryptable.uint128(value)` at line 66.

**Priority:** P1 (already fixed)

---

## P2 — Missing Features & Cleanup

---

### MC-F2-14 🟡 · MC-30/31: Missing env vars

**Files:**
- `ui/.env.local` — Supabase vars are filled (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) ✅
- `ui/.env.local` — Missing Base Sepolia vars for COMPOSER, SWAP_ROUTER, ORACLE 🟡

**Status:**
- **MC-30:** Supabase vars in `.env.local` ✅ already filled with values.
- **MC-31:** `.env.example` already lists `NEXT_PUBLIC_ORACLE_ADDRESS`, `NEXT_PUBLIC_BASE_COMPOSER_ADDRESS`, `NEXT_PUBLIC_BASE_SWAP_ROUTER_ADDRESS`, `NEXT_PUBLIC_BASE_ORACLE_ADDRESS` ✅
- **MC-51 follow-up:** `.env.local` missing Base Sepolia entries for COMPOSER, SWAP_ROUTER, ORACLE. The `CHAIN_CONTRACT_ADDRESSES[84532]` block reads these env vars — if empty, Base chain config will throw on `getContractAddresses`.

**Fix:**

Add to `ui/.env.local`:
```env
NEXT_PUBLIC_BASE_COMPOSER_ADDRESS=
NEXT_PUBLIC_BASE_SWAP_ROUTER_ADDRESS=
NEXT_PUBLIC_BASE_ORACLE_ADDRESS=
```

**Priority:** P2
**Test Required:** Switch chain to Base Sepolia — no "No FheForge contracts configured" error.

---

### MC-F2-15 🟡 · MC-33: Wire useRebalance into strategy detail page

**File:** `ui/hooks/use-rebalance.ts` — exists but has zero consumers
**Logic:** The `useRebalance()` hook calls `FheForgeComposer.rebalance()` — a multi-asset rebalance that adds collateral, repays debt, and borrows in one atomic call. Currently no UI component invokes it. Should be surfaced as a "Rebalance" button in the strategy detail page or position management UI.

**Suggested integration point:** `ui/app/strategy/[id]/components/strategy-overview.tsx` or create a new component `ui/components/strategy/strategy-rebalance.tsx`.

**New component (`ui/components/strategy/strategy-rebalance.tsx`):**
```typescript
"use client";

import { useState } from "react";
import { useRebalance, RebalanceParams } from "@/hooks/use-rebalance";
import { usePortfolio } from "@/hooks/use-portfolio";
import { TOKEN_SYMBOL_MAP } from "@/utils/addresses";
import { useAccount } from "wagmi";

interface Props {
  positionId: `0x${string}`;
}

export function StrategyRebalance({ positionId }: Props) {
  const { rebalanceWithEncrypt, isPending } = useRebalance();
  const { address } = useAccount();
  const [addCollateralAmt, setAddCollateralAmt] = useState("");
  const [newBorrowAmt, setNewBorrowAmt] = useState("");

  const handleRebalance = async () => {
    if (!address) return;
    const params: RebalanceParams = {
      positionId,
      collateralToken: TOKEN_SYMBOL_MAP.WETH.address as `0x${string}`,
      addCollateralAmount: BigInt(addCollateralAmt || "0"),
      repayAmount: 0n,
      repayToken: TOKEN_SYMBOL_MAP.WETH.address as `0x${string}`,
      newBorrowAmount: BigInt(newBorrowAmt || "0"),
      borrowToken: TOKEN_SYMBOL_MAP.USDC.address as `0x${string}`,
      useOracleBorrow: true,
      ltvNum: 7500n,
      ltvDen: 10000n,
    };
    try {
      await rebalanceWithEncrypt(params);
    } catch (e) {
      console.error("Rebalance failed:", e);
    }
  };

  return (
    <div className="glass p-5 space-y-4">
      <h3 className="text-sm font-bold">Rebalance Position</h3>
      {/* Add collateral input */}
      <input
        type="text"
        placeholder="Add collateral (WETH)"
        value={addCollateralAmt}
        onChange={(e) => setAddCollateralAmt(e.target.value)}
        className="w-full px-4 py-3 bg-card border border-border text-sm"
      />
      {/* New borrow input */}
      <input
        type="text"
        placeholder="New borrow (USDC)"
        value={newBorrowAmt}
        onChange={(e) => setNewBorrowAmt(e.target.value)}
        className="w-full px-4 py-3 bg-card border border-border text-sm"
      />
      <button
        onClick={handleRebalance}
        disabled={isPending}
        className="w-full py-3 bg-primary/20 border border-primary/40 text-sm font-bold hover:bg-primary/30 transition"
      >
        {isPending ? "Rebalancing..." : "Rebalance"}
      </button>
    </div>
  );
}
```

**Priority:** P2
**Test Required:** Click "Rebalance" with filled-in values → calls `writeContractAsync` with `FheForgeComposer.rebalance` ABI.

---

### MC-F2-16 🟢 · MC-34: encrypt helper in use-rebalance

**File:** `ui/hooks/use-rebalance.ts`
**Status:** ✅ Already fixed. `encryptRebalanceParams(params)` exists at lines 43–69. `rebalanceWithEncrypt(params)` at lines 89–94 combines encryption + contract call. `RebalanceEncrypted` and `InEuint128` types are correctly defined.

**Priority:** P2 (already fixed)

---

### MC-F2-17 🟢 · MC-35: registerStrategy in use-strategy-registry

**File:** `ui/hooks/use-strategy-registry.ts`
**Status:** ✅ Already fixed. `registerStrategy(name, workflowHash)` at lines 56–69 (2-arg overload). `registerStrategyWithParams(name, workflowHash, apyTarget, loopCount)` at lines 72–87 (4-arg overload).

**Priority:** P2 (already fixed)

---

### MC-F2-18 🟢 · MC-36/37/38: Liquidation/borrow UI hooks

**File:** `ui/hooks/use-lending-actions.ts`
**Status:** ✅ Already fixed.
- **MC-36:** `liquidateWithProof(params)` exists (lines 89–106). `requestLiquidityCheck` exists (lines 73–85).
- **MC-37:** `borrowWithLtvCheck(collateralToken, borrowToken, borrowAmount, encBorrowAmount, ltvNum, ltvDen)` exists (lines 110–126).
- **MC-38:** `borrowWithOracle(collateralToken, borrowToken, borrowAmount, encBorrowAmount)` exists (lines 130–144).

Demo page at `ui/app/lending-demo/page.tsx`.

**Priority:** P2 (already fixed)

---

### MC-F2-19 🟡 · MC-41/42: permit2 hooks not wired

**Files:** None — Permit2 was explicitly excluded from V2 refactor scope.
**Status:** 🟡 No action. `.env.local` comment states "no Permit2". `LendingPool.repayWithPermit2` and `LendingPool.supplyWithPermit2` exist on-chain but are intentionally not wired in the frontend. If Permit2 support is needed later:
1. Create `ui/hooks/use-permit2.ts` with Permit2 signature helpers
2. Add `repayWithPermit2` / `supplyWithPermit2` to `use-lending-actions.ts`
3. Add `PERMIT2_ADDRESS` to env vars/addresses

**Priority:** P2 (deferred — out of scope)

---

### MC-F2-20 🟢 · MC-45: isSupported chain check

**File:** `ui/hooks/use-lending-actions.ts` lines 149–161
**Status:** ✅ Already fixed. `isSupported(token: Address): Promise<boolean>` calls `PriceOracle.isSupported(token)` via `publicClient.readContract`.

Also available in `ui/hooks/use-price-oracle.ts` lines 92–104.

**Priority:** P2 (already fixed)

---

### MC-F2-21 🟢 · MC-46: convertToUsd helpers

**File:** `ui/hooks/use-price-oracle.ts`
**Status:** ✅ Already fixed.
- `convertToUsd(token, amount)` at lines 64–76
- `convertFromUsd(token, usdWad)` at lines 78–90
Both return `Promise<bigint>`.

**Priority:** P2 (already fixed)

---

### MC-F2-22 🟢 · MC-47/48/49: Registry reads

**File:** `ui/hooks/use-strategy-registry.ts`
**Status:** ✅ Already fixed.
- **MC-47:** `setActive(strategyId, active)` at lines 90–103
- **MC-48:** `getStrategyParams(strategyId)` at lines 106–122
- **MC-49:** `strategyCount` reactive read at lines 125–136

**Priority:** P2 (already fixed)

---

### MC-F2-23 🟢 · MC-50: validateEnvVars missing ORACLE

**File:** `ui/utils/addresses.ts` lines 63–77
**Status:** ✅ Already fixed. `validateEnvVars()` at line 63 includes `"NEXT_PUBLIC_ORACLE_ADDRESS"` in the required array (line 71). Called in `ui/app/layout.tsx` line 29.

**Priority:** P2 (already fixed)

---

### MC-F2-24 🟢 · MC-63: Stale TODO comments

**File:** `ui/hooks/use-fhe-vault.ts`
**Status:** ✅ Already fixed. No `TODO` or `FIXME` comments remain in the hooks directory. All prior TODO comments about vault/pool routing have been replaced with accurate MC-annotated documentation comments.

**Priority:** P2 (already fixed)

---

## Summary

| ID | Finding | Priority | Status |
|---|---|---|---|
| MC-F2-01 | ConfigPanel render-side-effect | P0 🔴 | 🟡 Needs fix |
| MC-F2-02 | ProtocolIcon hardcodes weth.svg | P0 🔴 | 🟡 Needs fix |
| MC-F2-03 | Duplicate SWAP case in getAmountOut | P0 🔴 | 🟡 Needs fix |
| MC-F2-04 | StrategyPromptDetails "Coming Soon" stub | P0 🔴 | 🟡 Needs fix |
| MC-F2-05 | useRebalance dead code | P0 🔴 | 🟡 Needs fix |
| MC-F2-06 | MC-07/08: onlyComposer-gated removal | P1 | 🟢 Fixed |
| MC-F2-07 | MC-09: strategyId param | P1 | 🟢 Fixed |
| MC-F2-08 | MC-10/11: Permit2 | P1 | 🟢 No-op |
| MC-F2-09 | MC-12/13/14: return/addCollateral/import | P1 | 🟢 Fixed |
| MC-F2-10 | MC-18/19: strategy-builder | P1 | 🟢 Fixed |
| MC-F2-11 | MC-20/21/22: supplyEth/withdrawEth | P1 | 🟢 Fixed |
| MC-F2-12 | MC-24/25/26: portfolio balance reads | P1 | 🟢 Fixed |
| MC-F2-13 | MC-27/28: encryption type | P1 | 🟢 Fixed |
| MC-F2-14 | MC-30/31: env vars | P2 | 🟡 Needs Base vars |
| MC-F2-15 | MC-33: wire useRebalance | P2 | 🟡 Needs fix |
| MC-F2-16 | MC-34: encrypt helper | P2 | 🟢 Fixed |
| MC-F2-17 | MC-35: registerStrategy | P2 | 🟢 Fixed |
| MC-F2-18 | MC-36/37/38: liquidation/borrow | P2 | 🟢 Fixed |
| MC-F2-19 | MC-41/42: permit2 hooks | P2 | 🟢 No-op |
| MC-F2-20 | MC-45: isSupported | P2 | 🟢 Fixed |
| MC-F2-21 | MC-46: convertToUsd | P2 | 🟢 Fixed |
| MC-F2-22 | MC-47/48/49: registry reads | P2 | 🟢 Fixed |
| MC-F2-23 | MC-50: validateEnvVars ORACLE | P2 | 🟢 Fixed |
| MC-F2-24 | MC-63: stale TODOs | P2 | 🟢 Fixed |

## Execution Order

```
Phase 1 — P0 Runtime Bugs (apply immediately, verify each):
  1. MC-F2-01  → wrap init logic in useEffect
  2. MC-F2-02  → accept symbol prop in ProtocolIcon
  3. MC-F2-03  → deduplicate SWAP case
  4. MC-F2-04  → implement StrategyPromptDetails
  5. MC-F2-05  → delete or wire useRebalance

Phase 2 — P2 Remaining Items:
  6. MC-F2-14  → add missing Base env vars to .env.local
  7. MC-F2-15  → wire useRebalance into strategy page

Phase 3 — Verify:
  8. Run `npm run lint && npm run typecheck` in ui/
  9. Check LSP diagnostics on all changed files
  10. Verify no regressions in builder flow
```
