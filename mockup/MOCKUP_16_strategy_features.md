# Strategy Features — FheForge Frontend Analysis

Source files: `ui/hooks/use-strategy-builder.ts`, `ui/hooks/use-composer.ts`, `ui/hooks/use-fhe-vault.ts`, `ui/types/defi.ts`, `ui/lib/defi-*`, `ui/services/defi-strategy-builder.ts`, `ui/app/builder/components/nodes/defi-node.types.ts`

---

## 1. Overview

The frontend exposes a **visual strategy builder** (React Flow node-graph) where users compose DeFi workflows as a sequence of steps. Each step is a typed `Node<DefiNodeData>` carrying a `Module`, `Action`, and `DefiNodeConfig`. The graph is serialized into a `workflowJson` payload and submitted to a backend API.

On finalization, the UI calls the FheForge vault/pool contracts via wagmi `useWriteContract`, routing amounts through **CoFHE encrypted handles** (`InEuint128`).

---

## 2. Node / Step Types

### 2.1 Supported Operations (`DefiOperationType`)

| Type | Typical meaning | First-step allowed | Can be preceded by |
|---|---|---|---|
| `SWAP` | Token swap via router | YES | SWAP, BORROW |
| `SUPPLY` | Deposit to lending pool | YES | SWAP, BORROW |
| `BORROW` | Borrow from lending pool | NO | SUPPLY |
| `JOIN_STRATEGY` | Enter a vault strategy | YES | SWAP, BORROW |

First-step rule: a graph cannot start with `BORROW` (requires prior SUPPLY to borrow against).  
Chain rules: `SWAP → {SUPPLY, SWAP, JOIN_STRATEGY}`; `SUPPLY → {BORROW}`; `BORROW → {SWAP, JOIN_STRATEGY, SUPPLY}`; `JOIN_STRATEGY → {}` (terminal).  
Validation lives in `ui/lib/defi-connection-rules.ts`.

### 2.2 Node Data Shape (`DefiNodeData`)

```
{
  id: string (crypto.randomUUID),
  type: "defiNode",
  position: { x: 250, y: index * 180 + 80 },
  data: {
    id,
    module?: Module | null,
    action?: Action | null,
    config?: DefiNodeConfig,
    onDelete?: (id) => void,
    isLastNode: true,
  }
}
```

Each `Action` belongs to a `Module` (protocol adapter, e.g. Uniswap, Aave, Fhenix LendingPool). `Module` carries: `id`, `name`, `protocol`, `category`, `icon_url`, `description`, `is_active`, `actions[]`.

### 2.3 Node Config (`DefiNodeConfig`)

```
{
  type?: "SWAP" | "SUPPLY" | "BORROW",
  tokenInId, tokenOutId, tokenInPairId, tokenOutPairId: string,
  tokenInSymbol, tokenOutSymbol: string,
  amount: number | string,
  amountOut: number | string,
  apy, slippage, ltv: number,
  estimate?: DefiEstimate,
  strategyId?: number,
}
```

### 2.4 Estimate (`DefiEstimate`)

Response from the backend estimate endpoint for a single step, containing operation type, token IDs, amounts (in/out/received/deposited/borrowed shares), slippage, APY, LTV.

---

## 3. Graph Lifecycle

### 3.1 Add Node (`addNode`)

1. `<Module>` and `<Action>` are selected by the user from a palette.
2. `validateAddNode` checks:
   - First node: operation type must be in `ALLOWED_FIRST_ACTIONS` (not BORROW).
   - Subsequent: last node must be configured (unless targeting it via selectedNode). Then `validateConnection` enforces the chain rule.
3. `createDefiNode` produces a `Node<DefiNodeData>` with `{ module, action, isLastNode }`. Edges auto-connected from previous last node via `createDefiEdge` (smoothstep, animated, indigo `#6366f1`).

### 3.2 Delete Node (`deleteNode`)

- Only the last node can be deleted (LIFO). Attempting to delete an intermediate node shows error toast.
- `markLastNode` re-tags the new tail as `isLastNode`.
- Edges referencing the deleted node are filtered out.

### 3.3 Connect Manually (`onConnect`)

Optional manual edge wiring via React Flow's connection handlers. Deduplicates: if source already has an outgoing edge, new connection is rejected.

### 3.4 Save Config (`saveConfig`)

Called per-node with a `SaveConfigPayload`. Flow:
1. Resolves `tokenInId`/`tokenOutId` to `asset_id` via the action's `defi_pairs` mapping.
2. Extracts `amountOut` and `tokenOutSymbol` from the estimate (supports multiple key aliases — `amount_out`, `output_amount`, `result_amount`, `received_amount`, `deposit_amount`, `borrow_amount`).
3. Stores `finalConfig` on the node's `data.config` and `estimate`.
4. Updates `selectedNode` in sync.

### 3.5 Create Strategy (`createStrategy`)

Triggered by the Submit / Create button with a name string.

```
1. user check             → toast if no wallet
2. buildWorkflowJson(nodes) → serialized step array
3. submitStrategy(...)    → POST to backend (status: "draft")
4. Persist strategyId     → url query param "?strategyId=N"
5. On-chain wiring:
   a. Find SUPPLY or ADD_COLLATERAL node.
   b. If ADD_COLLATERAL node → vault.addCollateral(token, amount)
      Falls back to first owned positionId from userPositionIds.
   c. If SUPPLY node       → vault.openPosition(token, amount, strategyId)
      Uses `TOKEN_SYMBOL_MAP` to resolve address.
6. Wait for tx receipt.
7. Navigate to /strategy.
```

---

## 4. Workflow Serialization (`lib/defi-workflow-builder.ts`)

Each node becomes a step:

```json
{
  "loops": "N",         // count of SWAP operations (min 1)
  "fee": 0,
  "steps": [
    {
      "step": 1,
      "type": "SUPPLY",               // action.name uppercase
      "agent": "LENDING_POOL",         // module.name uppercase
      "tokenIn": {
        "assetId": "0x...",
        "symbol": "WETH",
        "amount": 1.5
      },
      "tokenOut": { ... }              // only if config.tokenOutId exists
    },
    ...
  ]
}
```

- `tokenIn` for step 0 comes from its own config. For subsequent steps, it's the previous step's `tokenOut`.
- SUPPLY nodes produce no `tokenOut` (validated in `isNodeConfigured`).
- All nodes must be configured before serialization; otherwise throws with node name.

---

## 5. Encryption & Composer Contract (hooks/use-composer.ts / use-fhe-vault.ts)

### 5.1 CoFHE Encryption

Both vault and composer routes encrypt amounts into `InEuint128` handles (`{ ctHash, securityZone, utype, signature }`) before sending on-chain.

```ts
const encrypt128 = async (value: bigint): Promise<InEuint128> => {
  const handles = await cofheClient
    .encryptInputs([Encryptable.uint128(value)])
    .execute();
  return handles[0];
};
```

State guard: `cofheState.permitReady` must be true (CoFHE SDK permit obtained). Errors surface as "CoFHE client not ready" / "CoFHE permit not ready".

### 5.2 Vault Functions

Exposed by `useFheVault`:

| Function | Target Contract | Key Args | Notes |
|---|---|---|---|
| `openPosition` | StrategyVault | collateralToken, amount, strategyId | Encrypts amount; tx → vault.openPosition(token, amount, encHandle, strategyId, user) |
| `addCollateral` | StrategyVault | collateralToken, amount, positionId | Falls back to first owned position |
| `closePosition` | StrategyVault | positionId, amount, encHandle | — |
| `repay` | LendingPool | token, amount | Calls pool.repayDebt(token, amount, enc) |
| `withdrawSupply` | LendingPool | token, amount | Calls pool.partialUnshield(token, amount, enc) |
| `supplyEth` | LendingPool | amount (bigint) | Calls pool.shieldEth(enc), sends `value: amount` |
| `withdrawEth` | LendingPool | amount, encHandle | Calls pool.partialUnshieldEth(amount, enc) |
| `submitSwapIntent` | SwapRouter | tokenIn/Out, amounts, deadline | No encryption on amounts (plaintext) |
| `getUserPositions` | StrategyVault | user address | Calls vault.getUserPositions(user) via contractView |

### 5.3 Composer Approach (`useComposer`)

Alternative "atomic" path: the Composer contract (`FheForgeComposer`) accepts `OpenStrategyParams` + encrypted collateral/supply/borrow handles and opens a position in one batched on-chain call.

```ts
interface OpenStrategyParams {
  strategyName, workflowHash,
  collateralToken, collateralAmount,
  poolSupplyAmount, borrowToken, poolBorrowAmount,
  useOracleBorrow, ltvNum, ltvDen,
  swapTokenOut, swapDeadlineOffset,
  strategyId, apyTarget, loopCount,
  swapAmountIn, swapMinOut,
}
interface OpenStrategyEncrypted {
  collateral: InEuint128,    // encrypted collateral
  supplyEnc: InEuint128,     // encrypted supply
  borrowEnc: InEuint128,     // encrypted borrow
}
```

Workaround note: `encrypt128ForComposer` deliberately skips `setAccount(composerAddress)` because arb-sepolia has a stale ZK verifier key causing `InvalidSigner` errors. The TaskManager doesn't enforce `account == msg.sender` for `FHE.asEuint128`, so using the user wallet as the default account works. Full RCA in `contracts/ZK_VERIFIER_ROOT_CAUSE.md`.

### 5.4 Decryption for View

Post-position, users can decrypt their encrypted amounts back to plaintext for display:

- `revealCollateral()` — decrypts last encrypted supply handle.
- `revealBorrow()` — decrypts last encrypted borrow handle.
- `revealSwapIntent(encryptedAmount)` — decrypts a swap amount.

All use `cofheClient.decryptForView(hash, fheType).execute()` → `formatUnits(result, 18)`.

### 5.5 Multi-Position Tracking (P7)

`userPositionIds` (local React state) is synced from on-chain `vault.getUserPositions(userAddress)` after every `openPosition` call. This array is the fallback for `addCollateral`'s `positionId`.

---

## 6. Backend Integration

### 6.1 `submitStrategy` (service layer)

```ts
const payload = {
  owner_id: userId,
  name,
  description: "Strategy description",
  is_public: true,
  chain_context: "Fhenix",
  status: "draft",
  workflow_json: workflowJson,
  workflow_graph: workflowJson.steps ?? null,
};
return createStrategyWorkflow(payload);
```

Calls `services/defi-module-service.ts` → POST to backend (TODO note: `workflow_graph` expects nodes/edges but currently receives the steps array).

### 6.2 Estimate API

The types define separate response shapes for each operation type (`SwapEstimateResponse`, `SupplyEstimateResponse`, `BorrowEstimateResponse`), all extending `BaseEstimateResponse`. The user flow suggests estimates are fetched per-node before saving config (consumer is in the DefiNode component layer, not the hook).

---

## 7. Key Constraints & Validations

| Rule | Enforcement |
|---|---|
| No BORROW first step | `ALLOWED_FIRST_ACTIONS` excludes BORROW |
| Chain ordering graph | `ALLOWED_NEXT_ACTIONS[source]` lookup |
| Delete only last node | `setNodes` mutator rejects non-tail deletions |
| Must configure before adding next | `isNodeConfigured` check on last node unless targeting it |
| All nodes configured before submit | `buildWorkflowJson` throws on missing config |
| Wallet + permit required for on-chain | Guards in `openPosition`, `addCollateral`, and composer |
| StrategyId 0 skips vault call | Warning log; prevents garbage on-chain tx |
| Only ADD_COLLATERAL or SUPPLY trigger vault | No vault call for pure SWAP+BORROW strategies |
| CoFHE encrypt 128-bit only | `Encryptable.uint128()`; `validateEuint128(amount)`  |
| apyTarget/loopCount not forwarded to vault | Commented out: live as plaintext on registry `Strategy` struct |

---

## 8. Outstanding Observables

- **`workflow_graph` field** sends step array instead of nodes+edges structure (noted in comment).
- **Strategy description** is hardcoded `"Strategy description"` — no user-facing input.
- **`addCollateral` fallback** uses `userPositionIds[0]`; multi-position top-up requires explicit `positionId`.
- **OpenStrategyParams** includes `apyTarget` and `loopCount` but these are NOT forwarded from vault on-chain call (stored on registry instead).
- **`MarkLastNode`** parameter is a dead flag on `createDefiNode` — `markLastNode` is called separately in `addNode`.
- **`useComposer`** is not wired into the strategy builder flow (`createStrategy` uses vault directly). The composer is a separate path in the contracts layer.
- **Manual connection dedup** only checks source already-connected, not cycle detection.
- **Decryption for view** uses `formatUnits(result, 18)` — assumes 18 decimals always.
- **`encrypt128ForComposer`** is a copy-paste of `encrypt128` with only the comment and missing `setAccount` differing — the function is marked as a workaround.
