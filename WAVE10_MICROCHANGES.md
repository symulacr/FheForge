# Wave 10 — Exhaustive Micro-Change Plan

63 micro-changes from P0 (will revert) to P3 (cosmetic).
Each specifies: file, line, old → new, logic.

---

## P0 — Will Revert On-Chain (must fix before deploy)

---

### MC-01 · LendingPool ABI missing setComposer/composer/NotComposer
**File:** `ui/abis/LendingPool.json`
**Logic:** ABI is stale — missing `setComposer`, `composer()` getter, `NotComposer` error. Frontend can't call `setComposer` or detect the error. Must re-export from compiled artifacts.
**Change:** Run `cd contracts && npx hardhat compile && npx hardhat run scripts/sync-abis.ts` — overwrites all 6 ABI files from fresh artifacts.

---

### MC-02 · PriceOracle ABI missing ZeroAmount error
**File:** `ui/abis/PriceOracle.json`
**Logic:** Source has `error ZeroAmount()` but ABI doesn't. Frontend can't decode the revert.
**Change:** Same as MC-01 — sync-abis.ts fixes all ABIs at once.

---

### MC-03 · ui/.env.local POOL address wrong
**File:** `ui/.env.local` line 6
**Old:** `NEXT_PUBLIC_POOL_ADDRESS=0x225799A4B2272f8e062f2960374f9248722350Be`
**New:** `NEXT_PUBLIC_POOL_ADDRESS=0xc11129958089d4c108e69FA042cEB121a004e555`
**Logic:** Matches `deployments/421614.json` contracts.LendingPool. Current address is from a pre-wave9 deploy.

---

### MC-04 · ui/.env.local ORACLE address wrong
**File:** `ui/.env.local` line 9
**Old:** `NEXT_PUBLIC_ORACLE_ADDRESS=0xd1f834681E5C32485DF421FE2672d31707cF0ebb`
**New:** `NEXT_PUBLIC_ORACLE_ADDRESS=0xB2387ee4a6dC95603633780D86D23D84dE9C7fd3`
**Logic:** Matches `deployments/421614.json` contracts.PriceOracle.

---

### MC-05 · ui/.env.local WETH token address wrong
**File:** `ui/.env.local` line 21
**Old:** `NEXT_PUBLIC_TOKEN_WETH=0x980B62Da83eFf3D4576C647993b0c1D7faf17c73`
**New:** `NEXT_PUBLIC_TOKEN_WETH=0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d`
**Logic:** Matches README + `deployments/421614.json` weth field.

---

### MC-06 · ui/.env.local USDC token address wrong
**File:** `ui/.env.local` line 22
**Old:** `NEXT_PUBLIC_TOKEN_USDC=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
**New:** `NEXT_PUBLIC_TOKEN_USDC=0x150376EdEbc5AC48771655a61a795d828BeC8Df6`
**Logic:** Matches README USDC (mock) address.

---

### MC-07 · use-fhe-vault.ts supplyToLending calls onlyComposer-gated function directly
**File:** `ui/hooks/use-fhe-vault.ts` lines 120-144
**Old:** Calls `pool.supplyToLending(token, amt, enc, userAddr)` as user
**New:** Remove `supplyToLending` from use-fhe-vault — it must go through Composer only. Replace with a deprecation notice directing to `use-composer.openLeveragedStrategy`.
**Logic:** `LendingPool.supplyToLending` is `onlyComposer` — user calls revert. The Composer's `openLeveragedStrategy` is the correct entry point (it calls `POOL.supplyToLending` internally).

```diff
-  const supplyToLending = async (
-    token: string,
-    amount: string,
-    decimals = 18,
-  ) => {
-    const { pool } = requireAddresses();
-    const amt = parseUnits(amount, decimals);
-    validateEuint128(amt);
-    const userAddr = userAddress;
-    if (!userAddr) throw new Error("Wallet not connected");
-    setIsEncrypting(true);
-    try {
-      const enc = await encrypt128(amt);
-      return writeContractAsync({
-        address: pool as `0x${string}`,
-        abi: PoolABI,
-        functionName: "supplyToLending",
-        args: [token, amt, enc, userAddr],
-      });
-    } finally {
-      setIsEncrypting(false);
-    }
-  };
+  // REMOVED: supplyToLending is onlyComposer-gated on LendingPool.
+  // Use useComposer().openLeveragedStrategy or useRebalance() instead.
```

---

### MC-08 · use-fhe-vault.ts borrowFromLending calls onlyComposer-gated function directly
**File:** `ui/hooks/use-fhe-vault.ts` lines 146-170
**Old:** Calls `pool.borrowFromLending(token, amt, enc, userAddr)` as user
**New:** Remove `borrowFromLending` — same reason as MC-07.

```diff
-  const borrowFromLending = async (
-    token: string,
-    borrowAmount: string,
-    decimals = 18,
-  ) => {
-    const { pool } = requireAddresses();
-    const amt = parseUnits(borrowAmount, decimals);
-    validateEuint128(amt);
-    const userAddr = userAddress;
-    if (!userAddr) throw new Error("Wallet not connected");
-    setIsEncrypting(true);
-    try {
-      const enc = await encrypt128(amt);
-      return writeContractAsync({
-        address: pool as `0x${string}`,
-        abi: PoolABI,
-        functionName: "borrowFromLending",
-        args: [token, amt, enc, userAddr],
-      });
-    } finally {
-      setIsEncrypting(false);
-    }
-  };
+  // REMOVED: borrowFromLending is onlyComposer-gated on LendingPool.
+  // Use useComposer().openLeveragedStrategy or useRebalance() instead.
```

---

### MC-09 · use-fhe-vault.ts openPosition missing strategyId arg
**File:** `ui/hooks/use-fhe-vault.ts` lines 87-118
**Old:** `openPosition(collateralToken, collateralAmount, collateralEth)` → calls vault with 4 args `[token, amount, encColl, userAddr]`
**New:** Add `strategyId` parameter (default 0) and pass as 5th arg.

```diff
  const openPosition = async (
    collateralToken: string,
    collateralAmount: string,
    collateralEth: string,
+   strategyId: bigint = 0n,
  ) => {
    ...
      return writeContractAsync({
        address: vault as `0x${string}`,
        abi: VaultABI,
        functionName: "openPosition",
        args: [
          collateralToken,
          amountWei,
          encColl,
+         strategyId,
          userAddr,
        ],
      });
```

**Logic:** `StrategyVault.openPosition` signature is `(address token, uint256 amount, InEuint128 encAmount, uint256 strategyId, address user)`. Missing strategyId causes revert.

---

### MC-10 · use-permit2.ts wrong Permit2 contract address
**File:** `ui/hooks/use-permit2.ts` line 7
**Old:** `const PERMIT2_ADDRESS = "0x000000000022D473029F534aF5eCd6b4E4A6884E" as const;`
**New:** `const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;`
**Logic:** Contracts (LendingPool, Composer) hardcode `0x...78BA3` — Uniswap's canonical Permit2. The UI was using a different address, so EIP-712 domain mismatch → signatures invalid → `permitTransferFrom` reverts.

---

### MC-11 · use-permit2.ts indentation bug
**File:** `ui/hooks/use-permit2.ts` line 61
**Old:** `nonce: 0,` (no leading spaces)
**New:** `        nonce: 0,` (8 spaces, aligned with `expiration:` above)
**Logic:** Cosmetic but causes inconsistent formatting. Not a runtime bug (JS ignores whitespace) but sloppy.

---

### MC-12 · use-fhe-vault.ts return object references removed functions
**File:** `ui/hooks/use-fhe-vault.ts` lines 325-340
**Old:**
```
  return {
    openPosition,
    supplyToLending,
    borrowFromLending,
    repayBorrow,
    ...
  };
```
**New:** Remove `supplyToLending` and `borrowFromLending` from return, add `addCollateral` and `rebalance` references (wired in MC-13, MC-14).

```diff
  return {
    openPosition,
-   supplyToLending,
-   borrowFromLending,
    repayBorrow,
    withdrawSupply,
    submitSwapIntent,
    closePosition,
    repay,
    withdraw,
+   addCollateral,
    revealCollateral,
    revealBorrow,
    revealSwapIntent,
    isEncrypting,
    isPending,
  };
```

---

### MC-13 · use-fhe-vault.ts addCollateral not wired
**File:** `ui/hooks/use-fhe-vault.ts` — insert after closePosition (~line 245)
**New function:**
```typescript
  const addCollateral = async (
    collateralToken: string,
    amount: string,
    decimals = 18,
  ) => {
    const { vault } = requireAddresses();
    const amt = parseUnits(amount, decimals);
    validateEuint128(amt);
    const userAddr = userAddress;
    if (!userAddr) throw new Error("Wallet not connected");
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amt);
      return writeContractAsync({
        address: vault as `0x${string}`,
        abi: VaultABI,
        functionName: "addCollateral",
        args: [collateralToken, amt, enc, userAddr],
      });
    } finally {
      setIsEncrypting(false);
    }
  };
```
**Logic:** `StrategyVault.addCollateral(address, uint256, InEuint64, address)` exists on-chain, no access gate. UI should call it for adding to existing positions.

---

### MC-14 · use-fhe-vault.ts PoolABI import no longer needed for removed functions
**File:** `ui/hooks/use-fhe-vault.ts` line 7
**Old:** `import PoolABI from "@/abis/LendingPool.json";`
**New:** Keep — still needed for `repayBorrow`, `withdrawSupply`, `repay`, `withdraw` which call user-facing Pool functions.

---

### MC-15 · deploy-wave10.ts — new deploy script (CRITICAL)
**File:** `contracts/scripts/deploy-wave10.ts` (NEW)
**Logic:** Must redeploy LendingPool (onlyComposer gate), PriceOracle (ZeroAmount guard), StrategyVault (FHE ACL fix), and FheForgeComposer (immutable poolAddr changes). Must call `pool.setComposer(composerAddr)` — no existing script does this.

```typescript
import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync("deployments/421614.json", "utf8"));
  console.log("Deployer:", deployer.address);

  // 1. Deploy new LendingPool (with onlyComposer gate + setComposer)
  const Pool = await ethers.getContractFactory("LendingPool");
  const pool = await Pool.deploy();
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("Pool:", poolAddr);

  // 2. Deploy new PriceOracle (with ZeroAmount guard)
  const PYTH = "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF";
  const Oracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await Oracle.deploy(PYTH, 86400n);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("Oracle:", oracleAddr);

  // 3. Deploy new StrategyVault (FHE ACL fix in closePosition)
  const Vault = await ethers.getContractFactory("StrategyVault");
  const vault = await Vault.deploy(dep.contracts.StrategyRegistry);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("Vault:", vaultAddr);

  // 4. Wire registry → vault
  const registry = await ethers.getContractAt("StrategyRegistry", dep.contracts.StrategyRegistry);
  // Registry.setVault is one-shot (VaultAlreadySet guard).
  // Use proposeVault + acceptVault for rotation.
  await (await registry.proposeVault(vaultAddr)).wait();
  console.log("Registry.proposeVault done");
  await (await registry.acceptVault()).wait();
  console.log("Registry.acceptVault done");

  // 5. Deploy new FheForgeComposer (immutable poolAddr changed)
  const Composer = await ethers.getContractFactory("FheForgeComposer");
  const composer = await Composer.deploy(
    dep.contracts.StrategyRegistry,
    vaultAddr,
    poolAddr,
    dep.contracts.SwapRouter,
  );
  await composer.waitForDeployment();
  const composerAddr = await composer.getAddress();
  console.log("Composer:", composerAddr);

  // 6. Wire LendingPool dependencies
  const WETH = dep.weth;
  await (await pool.setWeth(WETH)).wait();
  console.log("Pool.setWeth done");
  await (await pool.setOracle(oracleAddr)).wait();
  console.log("Pool.setOracle done");

  // 7. CRITICAL: Wire setComposer — no previous deploy script does this
  await (await pool.setComposer(composerAddr)).wait();
  console.log("Pool.setComposer(", composerAddr, ") done");

  // 8. Wire PriceOracle sources
  const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
  const WETH_PYTH_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  await (await oracle.setSource(WETH, WETH_PYTH_ID, 18, 86400n)).wait();
  await (await oracle.setSource(USDC, WETH_PYTH_ID, 6, 86400n)).wait();
  await (await oracle.setCollateralFactor(USDC, 8000, 8500)).wait();
  await (await oracle.setCollateralFactor(WETH, 8000, 8500)).wait();
  console.log("Oracle feeds set");

  // 9. Update deployment record
  dep.contracts.LendingPool = poolAddr;
  dep.contracts.PriceOracle = oracleAddr;
  dep.contracts.StrategyVault = vaultAddr;
  dep.contracts.FheForgeComposer = composerAddr;
  dep.wave = 10;
  dep.deployedAt = new Date().toISOString();
  dep.notes = "Wave 10: onlyComposer gate, ZeroAmount guard, FHE ACL fix, setComposer wired";
  fs.writeFileSync("deployments/421614.json", JSON.stringify(dep, null, 2));

  console.log("\nNEW ADDRESSES:");
  console.log("POOL:", poolAddr);
  console.log("ORACLE:", oracleAddr);
  console.log("VAULT:", vaultAddr);
  console.log("COMPOSER:", composerAddr);
  console.log("REGISTRY:", dep.contracts.StrategyRegistry, "(unchanged)");
  console.log("ROUTER:", dep.contracts.SwapRouter, "(unchanged)");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

---

### MC-16 · deploy-full.sh references old script
**File:** `contracts/scripts/deploy-full.sh` line 7
**Old:** `npx hardhat run scripts/deploy-pool-oracle.ts --network arb-sepolia`
**New:** `npx hardhat run scripts/deploy-wave10.ts --network arb-sepolia`
**Logic:** deploy-full.sh should point to the latest deploy script.

---

### MC-17 · ui/.env.local comment references wrong wave
**File:** `ui/.env.local` line 3
**Old:** `# Arb Sepolia Wave 9 contracts (2026-05-08).`
**New:** `# Arb Sepolia Wave 10 contracts (2026-05-09).`
**Logic:** After wave 10 deploy, comment should match.

---

## P1 — Functional Gaps (broken features)

---

### MC-18 · use-strategy-builder.ts calls openPosition without strategyId
**File:** `ui/hooks/use-strategy-builder.ts` line 433
**Old:** `openPosition(collateralToken, collateralEth, collateralEth)`
**New:** `openPosition(collateralToken, collateralEth, collateralEth, BigInt(strategyId))`
**Logic:** `openPosition` now takes 4 args (MC-09 added strategyId). The builder has `strategyId` computed on line 418.

---

### MC-19 · use-strategy-builder.ts only uses openPosition from useFheVault
**File:** `ui/hooks/use-strategy-builder.ts` line 148
**Old:** `const { openPosition } = useFheVault();`
**New:** `const { openPosition, addCollateral } = useFheVault();`
**Logic:** Builder should also have access to `addCollateral` for multi-step strategies.

---

### MC-20 · use-fhe-vault.ts supplyEth commented out — wrong target contract
**File:** `ui/hooks/use-fhe-vault.ts` lines 287-304
**Old:** Commented-out `supplyEth` targeting `vault` with `VaultABI`
**New:** Uncomment and fix to target `pool` with `PoolABI` — `supplyEth` is on LendingPool, not StrategyVault.

```typescript
  const supplyEth = async (encAmount: bigint): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(encAmount);
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(encAmount);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "supplyEth",
        args: [enc],
        value: encAmount,
      });
    } finally {
      setIsEncrypting(false);
    }
  };
```

---

### MC-21 · use-fhe-vault.ts withdrawEth commented out — wrong target contract
**File:** `ui/hooks/use-fhe-vault.ts` lines 306-323
**Old:** Commented-out `withdrawEth` targeting `vault`
**New:** Uncomment and fix to target `pool` with `PoolABI` — `withdrawEth` is on LendingPool.

```typescript
  const withdrawEth = async (amount: bigint, encAmount: EncryptedHandle): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(amount);
    return writeContractAsync({
      address: pool as `0x${string}`,
      abi: PoolABI,
      functionName: "withdrawEth",
      args: [amount, encAmount],
    });
  };
```

---

### MC-22 · use-fhe-vault.ts return object missing supplyEth/withdrawEth
**File:** `ui/hooks/use-fhe-vault.ts` return block
**New:** Add `supplyEth, withdrawEth` to return object.

---

### MC-23 · use-fhe-vault.ts repayBorrow function name misleading
**File:** `ui/hooks/use-fhe-vault.ts` line 172
**Old:** `const repayBorrow = async (...)` → calls `pool.repay`
**New:** Rename to `repay` and rename existing `repay` to `repayWithAmount`.
**Logic:** `repayBorrow` calls `LendingPool.repay` (user-facing). The name suggests it's the composer's `repayBorrow` (onlyComposer). Misleading. However, renaming breaks any consumers — defer to P3 unless consumers are identified.

---

### MC-24 · use-portfolio.ts getPositionMeta missing user arg
**File:** `ui/hooks/use-portfolio.ts` line 48
**Old:** `args: [],`
**New:** `args: [],` — actually `getPositionMeta()` takes no args (uses `_msgSender()`). But `useReadContract` calls it from the connected wallet context. This is correct if wagmi sends from the right account. However, `hasPosition` on line 34 correctly passes `[userAddress]`. The `getPositionMeta` call will return data for the connected wallet, which is correct. No change needed.

---

### MC-25 · use-portfolio.ts missing balance reads
**File:** `ui/hooks/use-portfolio.ts` — add after positionMeta read
**New:** Add `getDepositedAmount` and `getCollateral` reads.

```typescript
  const {
    data: depositedAmountData,
    refetch: refetchDepositedAmount,
  } = useReadContract({
    address: vaultAddress,
    abi: VaultABI,
    functionName: "getDepositedAmount",
    args: [],
    query: { enabled: !!vaultAddress },
  });
```
**Logic:** Portfolio page should show deposited amount. `getDepositedAmount()` is a view function on StrategyVault.

---

### MC-26 · use-portfolio.ts missing Pool balance reads
**File:** `ui/hooks/use-portfolio.ts` — add Pool reads
**New:** Import PoolABI, add `getPlainSupplyBalance` and `getPlainBorrowBalance` reads for the connected wallet.

```typescript
  const { pool } = getContractAddresses(chainId);
  // ... useReadContract for getPlainSupplyBalance, getPlainBorrowBalance
```
**Logic:** Portfolio should show lending positions.

---

### MC-27 · use-fhe-vault.ts encrypt128 uses uint64 for euint128 values
**File:** `ui/hooks/use-fhe-vault.ts` line 49
**Old:** `Encryptable.uint64(value)`
**New:** `Encryptable.uint128(value)` (if available in SDK) or keep uint64 with documentation.
**Logic:** Vault collateral is `euint128`, Pool balances are `euint64`. The hook encrypts everything as uint64. If the CoFHE SDK supports `uint128`, use it for vault calls. If not, document the truncation risk (values > 2^64-1 will fail).

---

### MC-28 · use-composer.ts encrypt128 uses uint64 for euint128 collateral
**File:** `ui/hooks/use-composer.ts` line 73
**Old:** `Encryptable.uint64(value)`
**New:** Same as MC-27 — check SDK for `Encryptable.uint128`.

---

### MC-29 · Railway API Supabase env vars missing
**File:** Railway dashboard (not in repo)
**Logic:** All DB endpoints return `TypeError: fetch failed`. `SupabaseService` logs "SUPABASE_URL/KEY not set" if missing. Must set `SUPABASE_URL` and `SUPABASE_KEY` in Railway env vars. If Supabase project is paused, unpause it. If deleted, create new project and run `schema.sql`.

---

### MC-30 · ui/.env.local SUPABASE vars empty
**File:** `ui/.env.local` lines 32-33
**Old:**
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```
**New:** Fill with actual Supabase project URL + anon key (same project as backend).
**Logic:** UI needs Supabase anon key for client-side auth queries. Currently empty.

---

### MC-31 · ui/.env.example missing NEXT_PUBLIC_ORACLE_ADDRESS
**File:** `ui/.env.example` — check
**Logic:** `addresses.ts` reads `NEXT_PUBLIC_ORACLE_ADDRESS` but `.env.example` might not list it. Verify and add if missing.

---

### MC-32 · use-price-oracle.ts no Pyth update mechanism
**File:** `ui/hooks/use-price-oracle.ts`
**Logic:** Pyth prices go stale after `staleThreshold` (86400s = 24h). No UI or backend automation calls `updatePriceFeeds`. Prices will revert with "No price feed" or "UncertainPrice" after 24h. Need either:
- A backend cron that calls `updatePriceFeeds` via Pyth Hermes API
- Or a UI button that triggers it
This is a P1 gap but requires new infrastructure. Mark as P1-deferred.

---

### MC-33 · use-rebalance.ts exists but not consumed
**File:** `ui/hooks/use-rebalance.ts`
**Logic:** Hook is fully implemented (71 lines) with correct types matching `FheForgeComposer.rebalance`. But no component imports it. Need to wire into strategy detail page or builder. Mark as P1-wiring-needed.

---

### MC-34 · use-rebalance.ts missing encrypt step
**File:** `ui/hooks/use-rebalance.ts` lines 52-67
**Old:** Takes `encrypted: RebalanceEncrypted` as arg — caller must encrypt
**New:** Add `useCofheClient` + `useCofheState` and provide an `encryptRebalance` helper, similar to `use-composer.ts` pattern.
**Logic:** Currently the caller must construct `RebalanceEncrypted` manually. Should provide encryption helper.

---

### MC-35 · use-strategy-registry.ts missing registerStrategy
**File:** `ui/hooks/use-strategy-registry.ts`
**Logic:** Only has `getStrategyMeta` (read). No `registerStrategy` write hook. The Composer handles registration atomically in `openLeveragedStrategy`, so direct registration isn't needed for the main flow. But for standalone strategy creation (without opening a position), a write hook would be useful. P1-deferred.

---

## P2 — Missing Features (functional but not critical)

---

### MC-36 · No liquidation UI
**File:** New hook `ui/hooks/use-liquidation.ts`
**Logic:** `LendingPool.liquidate(user, collateralToken, debtToken, debtToCover)` exists. No UI calls it. Would need: health factor display, liquidation eligibility check, liquidation form. P2.

---

### MC-37 · No checkLtvAndBorrow UI
**File:** `ui/hooks/use-fhe-vault.ts`
**Logic:** `LendingPool.checkLtvAndBorrow` is a user-facing borrow with explicit LTV params. No UI. The Composer's `openLeveragedStrategy` uses `borrowFromLending` instead (no LTV check — relies on oracle). P2.

---

### MC-38 · No borrowWithOracle UI
**File:** `ui/hooks/use-fhe-vault.ts`
**Logic:** `LendingPool.borrowWithOracle` is user-facing oracle-gated borrow. No UI. P2.

---

### MC-39 · ExecutorContract not set as SwapRouter.executor
**File:** `contracts/scripts/deploy-wave10.ts` — add step after deploy
**Logic:** `421614.json` shows `swapExecutor: 0x4855...` (deployer EOA). The `ExecutorContract` was built to replace this. After wave 10 deploy, add:
```typescript
  // Deploy ExecutorContract
  const ExecContract = await ethers.getContractFactory("ExecutorContract");
  const execContract = await ExecContract.deploy();
  await execContract.waitForDeployment();
  const execAddr = await execContract.getAddress();

  // Set as SwapRouter executor (timelocked)
  const router = await ethers.getContractAt("SwapRouter", dep.contracts.SwapRouter);
  await (await router.proposeExecutor(execAddr)).wait();
  // Must wait EXECUTOR_ROTATION_DELAY before acceptExecutor
  console.log("ExecutorContract:", execAddr, "— call router.acceptExecutor() after timelock");
```
**Note:** DEMO_MODE has 90s timelock. Must wait then call `acceptExecutor()`.

---

### MC-40 · ExecutorContract not in deployment record
**File:** `contracts/deployments/421614.json`
**Logic:** After MC-39, add `executorContract` field to deployment record.

---

### MC-41 · use-fhe-vault.ts repayWithPermit2 not wired
**File:** `ui/hooks/use-fhe-vault.ts`
**Logic:** `LendingPool.repayWithPermit2` exists. No UI hook. Would require combining `use-permit2` + `use-fhe-vault`. P2.

---

### MC-42 · use-fhe-vault.ts supplyWithPermit2 not wired
**File:** `ui/hooks/use-fhe-vault.ts`
**Logic:** `LendingPool.supplyWithPermit2` exists. No UI hook. P2.

---

### MC-43 · use-swap-router.ts executeIntent not exposed
**File:** `ui/hooks/use-swap-router.ts`
**Logic:** `SwapRouter.executeIntent` is `onlyExecutor`. Not a user function. Correct to not expose. P2-no-change.

---

### MC-44 · No emergencyWithdraw UI
**File:** `ui/hooks/use-fhe-vault.ts`
**Logic:** `StrategyVault.emergencyWithdraw()` and `LendingPool.emergencyWithdraw(token)` exist (only when paused). No UI. P2.

---

### MC-45 · No isSupported token check in UI
**File:** `ui/hooks/use-price-oracle.ts`
**Logic:** `PriceOracle.isSupported(token)` exists. Should be called before showing borrow/liquidation options for a token. Add:
```typescript
  const isSupported = async (token: Address): Promise<boolean> => {
    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "isSupported",
      args: [token],
    });
    return result as boolean;
  };
```

---

### MC-46 · use-price-oracle.ts missing convertToUsd/convertFromUsd
**File:** `ui/hooks/use-price-oracle.ts`
**Logic:** Oracle has `convertToUsd` and `convertFromUsd` view functions. Useful for displaying USD values. Add helpers.

---

### MC-47 · use-strategy-registry.ts missing getStrategyParams
**File:** `ui/hooks/use-strategy-registry.ts`
**Logic:** `StrategyRegistry.getStrategyParams(strategyId)` returns `(apyTarget, loopCount)`. Not wired. Add:
```typescript
  const getStrategyParams = async (strategyId: bigint) => {
    const result = await publicClient.readContract({
      address: registryAddress,
      abi: StrategyRegistryABI,
      functionName: "getStrategyParams",
      args: [strategyId],
    });
    const [apyTarget, loopCount] = result as [number, number];
    return { apyTarget, loopCount };
  };
```

---

### MC-48 · use-strategy-registry.ts missing strategyCount
**File:** `ui/hooks/use-strategy-registry.ts`
**Logic:** `StrategyRegistry.strategyCount()` is a public view. Useful for pagination. Add read hook.

---

### MC-49 · use-strategy-registry.ts missing setActive
**File:** `ui/hooks/use-strategy-registry.ts`
**Logic:** `StrategyRegistry.setActive(strategyId, active)` is creator-gated. No write hook. P2.

---

### MC-50 · addresses.ts validateEnvVars missing ORACLE
**File:** `ui/utils/addresses.ts` lines 58-66
**Old:** Required list doesn't include `NEXT_PUBLIC_ORACLE_ADDRESS`
**New:** Add `"NEXT_PUBLIC_ORACLE_ADDRESS"` to the required array.
**Logic:** `FHENIX_CONTRACT_ADDRESSES` reads it but validation doesn't check it.

---

### MC-51 · addresses.ts Base Sepolia shares arb-sepolia composer/oracle
**File:** `ui/utils/addresses.ts` lines 40-42
**Old:** Base chain uses `NEXT_PUBLIC_COMPOSER_ADDRESS` and `NEXT_PUBLIC_ORACLE_ADDRESS` (same as arb)
**New:** Add `NEXT_PUBLIC_BASE_COMPOSER_ADDRESS` and `NEXT_PUBLIC_BASE_ORACLE_ADDRESS` env vars.
**Logic:** Base Sepolia has different contract addresses. Currently shares arb-sepolia composer/oracle which is wrong.

---

### MC-52 · ui/.env.example missing BASE_ORACLE and BASE_COMPOSER
**File:** `ui/.env.example`
**Logic:** If MC-51 adds new env vars, example must document them. P2.

---

### MC-53 · Backend FhenixStrategyService uses static exchange rates
**File:** `backend/apps/src/shared/infrastructure/fhenix-strategy.service.ts`
**Logic:** Uses `EXCHANGE_RATE_WETH_USDC=3000` env var instead of on-chain PriceOracle. Should read from `PriceOracle.getPriceUsd()` via ethers. P2 — requires contract reads from backend.

---

### MC-54 · Backend FhenixStrategyService ethers v5 API
**File:** `backend/apps/src/shared/infrastructure/fhenix-strategy.service.ts` line 8
**Old:** `ethers.providers.JsonRpcProvider`
**Logic:** Confirmed `package.json` has `ethers: 5.8.0` — this is CORRECT, not a mismatch. No change needed.

---

### MC-55 · Backend no on-chain event indexing
**File:** Backend architecture
**Logic:** Backend never reads contract events (PositionOpened, Supplied, Borrowed, etc.). No real-time position tracking. Would require ethers event listeners or TheGraph. P2-infrastructure.

---

### MC-56 · Backend simulators use static APY
**File:** `backend/apps/src/defi_strategies/application/simulators/*.ts`
**Logic:** `SUPPLY_APY_BPS=650`, `BORROW_APY_BPS=550` from env. Not reading on-chain rates. P2.

---

## P3 — Cosmetic / Deferred

---

### MC-57 · README.md contract addresses may need update
**File:** `README.md`
**Logic:** After wave 10 deploy, if any address changes, update the table. Depends on MC-15 execution.

---

### MC-58 · README.md WETH address mismatch
**File:** `README.md` line 25
**Old:** `WETH (mock) | 0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d`
**Logic:** This matches `deployments/421614.json` weth field. Correct. No change.

---

### MC-59 · StrategyRegistry _modifyTvl merge already in source
**File:** `contracts/contracts/StrategyRegistry.sol`
**Logic:** Wave 9 already merged `_modifyTvl` internal helper. Just not deployed. Wave 10 deploy will include it. No code change needed.

---

### MC-60 · 2 solhint struct packing warnings
**File:** `contracts/contracts/StrategyRegistry.sol` line 15
**Logic:** `// solhint-disable-next-line gas-struct-packing` already added. The other warning is in `SharedStrategyMeta.sol` PositionView struct — FHE requires this layout. Cannot change. No action.

---

### MC-61 · LendingPool Paused/Unpaused events commented out
**File:** `contracts/contracts/LendingPool.sol` lines 356-357, 359-360
**Old:** `// emit Paused();` / `// emit Unpaused();`
**Logic:** OZ's `Pausable` already emits these events. Double-emitting would cause duplicate logs. The comments are correct — they should stay commented. No change.

---

### MC-62 · Same commented-out Paused/Unpaused in other contracts
**Files:** `FheForgeComposer.sol`, `StrategyVault.sol`, `SwapRouter.sol`, `StrategyRegistry.sol`
**Logic:** Same as MC-61 — OZ Pausable emits, double-emit avoided. No change.

---

### MC-63 · use-fhe-vault.ts TODO comments stale
**File:** `ui/hooks/use-fhe-vault.ts` lines 247-249, 267-269, 287-288, 306-307
**Old:** TODO comments about vault not having repay/withdraw/supplyEth/withdrawEth
**New:** Remove or update — repay/withdraw are on Pool (correct), supplyEth/withdrawEth are on Pool (MC-20/MC-21 fix the comments).

---

## Execution Order

```
Phase A — Local build (no chain touch):
  MC-01, MC-02  → hardhat compile + sync-abis
  MC-15         → write deploy-wave10.ts
  MC-16         → update deploy-full.sh

Phase B — UI code fixes (no deploy yet):
  MC-03-06      → fix ui/.env.local addresses
  MC-07, MC-08  → remove onlyComposer-gated direct calls
  MC-09         → add strategyId to openPosition
  MC-10         → fix Permit2 address
  MC-11         → fix indentation
  MC-12         → update return object
  MC-13         → add addCollateral hook
  MC-17         → update env comment
  MC-18         → fix strategy-builder openPosition call
  MC-19         → wire addCollateral in builder
  MC-20, MC-21  → uncomment+fix supplyEth/withdrawEth
  MC-22         → add to return object
  MC-27, MC-28  → check SDK for uint128 encryption
  MC-50         → add ORACLE to validateEnvVars
  MC-63         → clean TODO comments

Phase C — On-chain deploy:
  MC-15         → run deploy-wave10.ts --network arb-sepolia
  MC-39         → deploy ExecutorContract + proposeExecutor (optional)
  MC-57         → update README if addresses changed

Phase D — Backend/infra:
  MC-29         → fix Railway Supabase env vars
  MC-30         → fix ui/.env.local Supabase vars

Phase E — Verify:
  Run test-brutal / test-live-wave9
  Hit Railway endpoints
  Test UI on Vercel

Phase F — P2 features (deferred):
  MC-33-38, MC-41-49, MC-51-56
```
