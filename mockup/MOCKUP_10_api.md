# FheForge DeFi Strategies — API Reference

Encrypted DeFi strategy lifecycle: **manage → version → simulate → execute**.

Base URL: `POST /api` (NestJS controllers under `defi-strategies` module)

---

## 1. Strategy CRUD

### `POST /api/defi-strategies` — *Create a strategy*

Body (`CreateDefiStrategyDto`):

| Field | Type | Description |
|---|---|---|
| `owner_id` | string | Owner UUID |
| `name` | string | Human-readable name |
| `description` | string | Strategy description |
| `is_public` | boolean | Public visibility flag |
| `chain_context` | string | Chain (e.g. `"ethereum"`) |
| `status` | string | E.g. `"draft"` |
| `workflow_json` | object | Workflow steps definition |
| `workflow_graph` | object | React Flow state for UI graph |

### `GET /api/defi-strategies` — *List strategies*

Query: `?owner=<string>` *(optional)* — filter by owner.

### `GET /api/defi-strategies/:id` — *Get one strategy*

### `PUT /api/defi-strategies/:id` — *Update a strategy*

Body (`UpdateDefiStrategyDto`, all optional):

| Field | Type |
|---|---|
| `name` | string? |
| `description` | string? |
| `is_public` | boolean? |
| `status` | string? |
| `chain_context` | string? |

### `DELETE /api/defi-strategies/:id` — *Delete a strategy (cascade)*

Status: `204 No Content`. Cascades to all versions.

---

## 2. Strategy Versions (nested under strategies)

### `POST /api/defi-strategies/versions` — *Create a version*

Body (`CreateDefiStrategyVersionDto`):

| Field | Type | Description |
|---|---|---|
| `strategy_id` | string | Parent strategy UUID |
| `workflow_json` | object | Workflow step definitions |
| `workflow_graph` | object | React Flow graph UI state |

### `PUT /api/defi-strategies/versions/:id` — *Update a version*

Body (`UpdateDefiStrategyVersionDto`, all optional):

| Field | Type |
|---|---|
| `workflow_json` | object? |
| `workflow_graph` | object? |

### `DELETE /api/defi-strategies/versions/:id` — *Delete a version*

Status: `204 No Content`.

---

## 3. Simulation (off-chain)

### `POST /api/defi-strategies/simulate` — *Simulate a strategy*

Body (`SimulateStrategyDto`):

| Field | Type | Default | Description |
|---|---|---|---|
| `workflow_json` | `{ steps: StrategyStepResponseDto[] }` | — | Workflow steps to simulate |
| `amount_in` | number (≥0) | — | Input amount |
| `slippage_tolerance` | number? (≥0) | `0.5` | Slippage tolerance (%) |
| `gas_price` | number? | — | Gas price in gwei |

Returns (`SimulationOutput`):

| Field | Type |
|---|---|
| `steps` | `SimulationStepResult[]` |
| `total_fee` | number |
| `output_amount` | number |
| `warnings` | `string[]` |

Each step result (`SimulationStepResult`):

| Field | Type |
|---|---|
| `step_index` | number |
| `action_type` | string |
| `agent` | string |
| `token_in` | `{ asset_id, symbol, amount }` |
| `token_out` | `{ asset_id, symbol, amount }` |
| `fee` | number |
| `slippage` | number? |
| `price_impact` | number? |
| `apy` | number? |
| `execution_time` | string |

Processing: the `DefiSimulationEngine` iterates over workflow steps, dispatching each to a pluggable `ActionSimulator` (supply, borrow, swap, join strategy, enable e-mode, etc.). Simulation always runs in `fhe_mode: true` — returned amounts are flagged as pre-encryption estimates. Actual on-chain values live inside FHE ciphertexts.

---

## 4. Simulation Snapshots (persisted)

### `POST /api/defi-strategy-simulation-snapshots` — *Save a snapshot*

Body (`CreateDefiStrategySimulationSnapshotDto`):

| Field | Type | Description |
|---|---|---|
| `strategy_version_id` | string | Version UUID |
| `snapshot_type` | string | E.g. `"ESTIMATE"` |
| `estimated_outputs` | object | Estimated output data |
| `estimated_weight` | string? | BigInt-as-string |
| `estimated_fee` | string? | BigInt-as-string |
| `chain_state_ref` | string? | Reference to chain state |

### `GET /api/defi-strategy-simulation-snapshots/:version_id` — *Get snapshots for a version*

---

## 5. Executions

### `POST /api/defi-strategy-executions` — *Create an execution record*

Body (`CreateDefiStrategyExecutionDto`):

| Field | Type |
|---|---|
| `strategy_version_id` | string |
| `extrinsic_hash` | string (e.g. `"0xdeadbeef"`) |
| `execution_status` | string (e.g. `"SUCCESS"`) |

### `GET /api/defi-strategy-executions/:version_id` — *Get executions by version*

### `PATCH /api/defi-strategy-executions/:id` — *Update an execution*

Body (`UpdateDefiStrategyExecutionDto`, both optional):

| Field | Type |
|---|---|
| `extrinsic_hash` | string? |
| `execution_status` | string? |

---

## 6. Execution Step Results

### `POST /api/defi-execution-step-results` — *Record one step result*

Body (`CreateExecutionStepResultDto`):

| Field | Type | Description |
|---|---|---|
| `execution_id` | string | Parent execution UUID |
| `parachain_id` | number | Parachain ID |
| `pallet` | string | Pallet name |
| `call` | string | Call name |
| `status` | string | Step status |
| `output_assets` | object | Output asset data |
| `error_message` | string | Error (empty string on success) |

---

## Domain Model

```
DefiStrategy
├── id, owner_id, name, description, status, is_public
├── chain_context, current_version_id, created_at
│
└── DefiStrategyVersion  (1:N)
    ├── id, strategy_id, version (int)
    ├── workflow_json, workflow_graph, created_at
    │
    ├── DefiStrategyExecution  (1:N)
    │   ├── id, strategy_version_id, extrinsic_hash
    │   ├── execution_status, executed_at
    │   │
    │   └── DefiExecutionStepResult  (1:N)
    │       ├── id, execution_id, step_index
    │       ├── parachain_id, pallet, call
    │       ├── status, output_assets, error_message
    │
    └── DefiStrategySimulationSnapshot  (1:N)
        ├── id, strategy_version_id, snapshot_type
        ├── estimated_outputs, estimated_weight (bigint)
        ├── estimated_fee (bigint), chain_state_ref
        └── created_at
```

---

## Simulation Engine Architecture

- **Entry**: `DefiSimulationEngine` (application service) receives `workflow_json + amount_in + options`.
- **Dispatch**: Each step is routed via `WorkflowJson.steps[]` → per-action `ActionSimulator` (swap, supply, borrow, join strategy, enable e-mode).
- **Simulator contract** (`simulation-engine.interface.ts`):

```ts
interface ActionSimulator {
  simulate(step, context): SimulationStepResult;
}
```

- **Context** carries `amount_in, current_amount, total_fee, slippage_tolerance, warnings, fhe_mode, amount_precision`.
- **Output** is a flat list of step results + aggregated `total_fee, output_amount, warnings`.
- **All amounts are pre-encryption estimates.** Every `SimulationResultDto` carries an `fhe_note` warning.

---

## Key Design Observations

1. **Strategy creation embeds `workflow_json` + `workflow_graph` directly** — a lightweight versioning model where the first version is included at creation time; subsequent editions create a new version via the `/versions` sub-controller.
2. **Simulation is stateless and off-chain** — it operates on a bare workflow JSON + amount; it does not require a persisted strategy. The snapshot endpoint allows persisting results for later reference.
3. **Executions link to a version, not a snapshot** — the user simulates, then when ready, creates an execution against the same version.
4. **Step results record parachain & pallet info** — each step identifies the exact Substrate pallet + call that was executed, tying on-chain actions back to the workflow.
5. **FHE-aware throughout** — simulation context enforces `fhe_mode: true` and tracks `amount_precision` (EXACT vs BOUNDED); the simulation result carries a static warning about ciphertext amounts.
