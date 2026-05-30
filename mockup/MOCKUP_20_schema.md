# FheForge — Full Database Schema & Business Logic

All tables, relationships, constraints, indexes, and user-facing concepts extracted from:
- `backend/apps/migrations/000_base.sql`
- `backend/apps/migrations/001_event_indexing_tables.sql`
- `backend/apps/migrations/002_defi_action_required.sql`
- `backend/apps/migrations/003_auth_nonces.sql`
- `backend/apps/migrations/004_full_schema.sql`
- Entity classes and DTOs in `backend/apps/src/`

---

## Entity-Relationship Summary

```
users
  |
  +-- strategies  (NOT "user strategies" — these are strategist profiles, independent of users)
  |
  +-- defi_strategies.owner_id
        |
        +-- defi_strategy_versions.strategy_id (CASCADE)
        |     |
        |     +-- defi_strategy_executions.strategy_version_id
        |     |     |
        |     |     +-- defi_execution_step_results.execution_id (CASCADE)
        |     |
        |     +-- defi_strategy_simulation_snapshots.strategy_version_id
        |
        +-- activities.strategy_id

defi_token
  |
  +-- defi_pairs.token_in_id
  +-- defi_pairs.token_out_id

defi_modules
  |
  +-- defi_module_actions.module_id (CASCADE)
  |     |
  |     +-- defi_action_required.action_id (CASCADE)
  |     +-- defi_action_required.module_id (CASCADE)
  |
  +-- defi_pairs (via defi_module_actions.pair_id)

on_chain_events         (standalone, indexed by contract/block/tx)
event_indexer_state     (singleton, tracks last indexed block)
auth_nonces             (standalone, temp auth tokens)
_migrations             (standalone, migration tracking)
```

---

## Table: `_migrations` (000_base.sql)

Internal migration tracking — not user-facing.

| Column | Type | Constraints |
|---|---|---|
| id | SERIAL | PK |
| filename | TEXT | NOT NULL, UNIQUE |
| applied_at | TIMESTAMPTZ | DEFAULT NOW() |

---

## Table: `on_chain_events` (001_event_indexing_tables.sql)

Indexed on-chain event log. Populated by an event indexer service watching the blockchain.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| contract_name | TEXT | NOT NULL |
| event_name | TEXT | NOT NULL |
| block_number | BIGINT | NOT NULL |
| tx_hash | TEXT | NOT NULL |
| log_index | INTEGER | NOT NULL |
| data | JSONB | NOT NULL |
| timestamp | TIMESTAMPTZ | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_on_chain_events_contract (contract_name), idx_on_chain_events_block (block_number), idx_on_chain_events_tx (tx_hash)

---

## Table: `event_indexer_state` (001_event_indexing_tables.sql)

Singleton checkpoint tracking the last block the indexer scanned.

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK — always `'global'` |
| last_block | BIGINT | NOT NULL — last processed block |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

---

## Table: `auth_nonces` (003_auth_nonces.sql)

Wallet authentication nonces. Replaces in-memory map. Expire after 5 minutes.

| Column | Type | Constraints |
|---|---|---|
| wallet_address | TEXT | PK |
| nonce | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| expires_at | TIMESTAMPTZ | DEFAULT NOW() + 5 min |

**User-facing concept:** Users sign a nonce with their wallet to prove ownership. Combined with JWT authentication (see `backend/apps/src/auth/`). Login DTO: `{ wallet_address, signature }`.

---

## Table: `users` (004_full_schema)

Registered wallet-based user.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| wallet_address | TEXT | NOT NULL, UNIQUE |
| chain_id | INTEGER | nullable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_users_wallet_address (wallet_address)

**User-facing concept:** A user is identified by their blockchain wallet address. They can optionally have a username (see `update-username.dto.ts`). No email, no password — pure crypto auth.

---

## Table: `strategies` (004_full_schema)

These are **strategist profiles** — not the user's executed strategies. They represent featured "strategist" personas that publish APY data on particular DeFi compositions. A public directory / marketplace for strategy inspiration.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| strategist_name | TEXT | nullable |
| strategist_handle | TEXT | nullable |
| apy | NUMERIC | nullable |
| tags | TEXT[] | DEFAULT '{}' |
| assets | TEXT[] | DEFAULT '{}' |
| agents | TEXT[] | DEFAULT '{}' |
| chains | TEXT[] | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**User-facing concept:** A "strategist profile" displayed as a card in a strategy marketplace. Fields like `tags`, `assets`, `agents`, `chains` are arrays for filter/tag UI. The APY shown is NOT encrypted — it's the published/public performance metric. This table is `Strategy` (NestJS entity), distinct from `DefiStrategy`.

---

## Table: `defi_token` (004_full_schema)

Supported blockchain assets/tokens.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL — token name |
| asset_id | TEXT | nullable — likely on-chain asset identifier |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**User-facing concept:** Tokens users can select as inputs/outputs in strategies. Displayed as token pickers showing the name.

---

## Table: `defi_modules` (004_full_schema)

DeFi protocol integrations (e.g., Aave, a DEX, a lending protocol).

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL — e.g. "Aave V3" |
| protocol | TEXT | nullable |
| category | TEXT | nullable — e.g. "LENDING", "DEX" |
| parachain_id | TEXT | nullable — parachain identifier relevant to FheForge's chain architecture |
| icon_url | TEXT | nullable |
| description | TEXT | nullable |
| website_url | TEXT | nullable |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**User-facing concept:** Listed as available protocol integrations. Each module has an icon, name, category badge, and can be toggled on/off. Users build strategies by chaining actions from these modules.

---

## Table: `defi_pairs` (004_full_schema)

Token pairs that a DeFi module supports for swapping.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| token_in_id | UUID | FK -> defi_token(id), nullable |
| token_out_id | UUID | FK -> defi_token(id), nullable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_defi_pairs_token_in (token_in_id), idx_defi_pairs_token_out (token_out_id)

**User-facing concept:** Represents a tradable pair (e.g., DOT/KSM or USDC/ETH). The entity has a helper method `getEstimation` that takes an amount in and returns estimated amount out with a fee percentage and price impact.

---

## Table: `defi_module_actions` (004_full_schema)

Atomic actions a module can perform (e.g., swap, supply, borrow).

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| module_id | UUID | FK -> defi_modules(id), NOT NULL, ON DELETE CASCADE |
| pair_id | UUID | FK -> defi_pairs(id), nullable |
| name | TEXT | nullable |
| action_type | TEXT | nullable — see OperationType enum |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_defi_module_actions_module_id (module_id), idx_defi_module_actions_pair_id (pair_id)

**Entity fields (not in DB but in TypeScript):** `pallet`, `call`, `description`, `param_schema` (JSON), `risk_level`, `is_active` — these appear to be additional application-level metadata stored elsewhere or migrated later.

**OperationType enum:** `SWAP`, `SUPPLY`, `BORROW` (from `backend/apps/src/defi_modules/domain/operation-type.enum.ts`)

**User-facing concept:** These are the building blocks users drag into a visual strategy builder workflow. Each action belongs to a module, optionally targets a specific pair, and has a type that determines what UI form/params to show.

---

## Table: `defi_action_required` (002_defi_action_required.sql)

Prerequisite actions — an action X may require action Y to be performed first.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| action_id | UUID | FK -> defi_module_actions(id), NOT NULL, ON DELETE CASCADE |
| module_id | UUID | FK -> defi_modules(id), NOT NULL, ON DELETE CASCADE |
| action_required_id | TEXT | NOT NULL — identifier of the prerequisite action |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_defi_action_required_action_id (action_id), idx_defi_action_required_module_id (module_id)

**User-facing concept:** Strategy builder must respect action ordering constraints. E.g., SUPPLY may be required before BORROW in the same module.

---

## Table: `defi_strategies` (004_full_schema)

A user's saved/created strategy. Each strategy can have multiple versions (iterations).

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| owner_id | UUID | FK -> users(id), nullable |
| name | TEXT | nullable |
| description | TEXT | nullable |
| status | TEXT | DEFAULT 'draft' — e.g. 'draft', 'active', 'archived' |
| is_public | BOOLEAN | DEFAULT FALSE |
| chain_context | TEXT | nullable — chain/environment ID |
| current_version_id | UUID | nullable — points to latest defi_strategy_versions.id |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_defi_strategies_owner_id (owner_id)

**User-facing concept:** The core entity in the app. Users create strategies (name + description), set them as public/private, iterate through versions, and execute/simulate them. Status drives what state badge to show. `current_version_id` is a denormalized pointer to the latest version — the versioning cascade lives in the next table.

---

## Table: `defi_strategy_versions` (004_full_schema)

Snapshot of a strategy's workflow at a point in time.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| strategy_id | UUID | FK -> defi_strategies(id), NOT NULL, ON DELETE CASCADE |
| version | INTEGER | DEFAULT 1 — auto-incrementing version number |
| workflow_json | JSONB | nullable — the strategy step definitions |
| workflow_graph | JSONB | nullable — visual graph representation |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_defi_strategy_versions_strategy_id (strategy_id)

**Workflow JSON structure** (from `simulate-strategy.dto.ts` and `strategy-step-response.dto.ts`):
```ts
{
  steps: [{
    step: number,
    type: 'SWAP' | 'SUPPLY' | 'BORROW' | 'CLAIM_REWARDS',
    agent: string,          // protocol name e.g. 'COFHE'
    tokenIn?: { assetId, symbol, amount },
    tokenOut?: { assetId, symbol, amount }
  }]
}
```

**User-facing concept:** The strategy builder produces a `workflow_json` which is a sequence of steps — each an atomic operation on a protocol. The `workflow_graph` may be a visual node-edge representation. Version history lets users revert/compare iterations.

---

## Table: `defi_strategy_executions` (004_full_schema)

On-chain execution record for a particular strategy version.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| strategy_version_id | UUID | FK -> defi_strategy_versions(id), nullable |
| extrinsic_hash | TEXT | nullable — blockchain extrinsic/tx hash |
| execution_status | TEXT | DEFAULT 'pending' |
| executed_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_defi_strategy_executions_strategy_version_id (strategy_version_id)

**User-facing concept:** After simulation, a user can execute the strategy on-chain. This table tracks each submission. The `extrinsic_hash` links to the blockchain explorer. Status drives progress indicators (pending → confirmed/failed).

---

## Table: `defi_execution_step_results` (004_full_schema)

Per-step results of a strategy execution.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| execution_id | UUID | FK -> defi_strategy_executions(id), NOT NULL, ON DELETE CASCADE |
| step_index | INTEGER | nullable — order in the execution |
| parachain_id | TEXT | nullable |
| pallet | TEXT | nullable |
| call | TEXT | nullable |
| status | TEXT | nullable — success/failure |
| output_assets | JSONB | nullable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_defi_execution_step_results_execution_id (execution_id)

**Entity field (not in DB but in TypeScript):** `error_message: string | null`

**User-facing concept:** Each step's outcome. Users can drill into execution details and see which steps succeeded/failed and what assets were output at each stage. The step results power the execution detail view.

---

## Table: `defi_strategy_simulation_snapshots` (004_full_schema)

Cached simulation results for a strategy version, used to show estimates without re-running.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| strategy_version_id | UUID | FK -> defi_strategy_versions(id), nullable |
| snapshot_type | TEXT | nullable — e.g. 'SIMULATION' |
| data | JSONB | nullable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_defi_sim_snapshots_strategy_version_id (strategy_version_id)

**Entity-extracted data fields (from TypeScript):**
```ts
{
  estimated_outputs: object,
  estimated_weight: bigint,
  estimated_fee: bigint,
  chain_state_ref: string
}
```

**Simulation result DTO** (user-facing output):
```ts
{
  strategy_id,
  simulation_id,
  input_amount,           // the amount user puts in
  final_amount,           // amount after all steps
  total_fee,
  estimated_slippage,
  estimated_duration,     // e.g. "~2.5s"
  steps: [{               // per-step breakdown
    step_index,
    action_type,
    agent,
    token_in: { asset_id, symbol, amount },
    token_out: { asset_id, symbol, amount },
    fee,
    slippage,
    price_impact,
    apy,
    execution_time
  }],
  warnings: string[],
  simulated_at,
  fhe_note: "Amounts shown are pre-encryption estimates. Actual on-chain values are ciphertext..."
}
```

**User-facing concept:** Simulation is the primary UX flow — user builds a strategy, hits "simulate", sees step-by-step estimates (what goes in, what comes out, fees, slippage, APY), with a prominent FHE disclaimer that final amounts are encrypted on-chain. Each simulation is cached as a snapshot to avoid re-computation.

---

## Table: `activities` (004_full_schema)

User activity log tied to strategies.

| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| user_address | TEXT | nullable |
| strategy_id | UUID | nullable |
| tx_hash | TEXT[] | DEFAULT '{}' |
| status | TEXT | nullable — ActivityStatus union |
| metadata | JSONB | nullable |
| current_step | INTEGER | nullable |
| total_steps | INTEGER | nullable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** idx_activities_user_address (user_address), idx_activities_strategy_id (strategy_id)

**ActivityStatus:** `'PENDING' | 'SUCCESS' | 'FAILED'`

**User-facing concept:** An activity feed showing the user's strategy execution history. Displays strategy name (from strategy_id), transaction hashes (explorer links), multi-step progress (`current_step / total_steps`), and status badge. Acts as a running notification / history panel.

---

## Business Domain Summary (for Designer)

### Core Mental Model

FheForge is an **encrypted DeFi strategy builder**. Users authenticate with their crypto wallet, then:

1. **Browse protocols** (`defi_modules`) — see available DeFi integrations.
2. **Build a strategy** as a sequence of steps (`defi_strategy_versions.workflow_json`). Each step is a typed action (SWAP/SUPPLY/BORROW/CLAIM_REWARDS) on a protocol, specifying input and output tokens.
3. **Simulate** — get a cached step-by-step breakdown of expected outcomes (amounts, fees, slippage, APY, price impact). All estimates are pre-encryption.
4. **Execute** — submit the strategy on-chain. Execution produces a transaction hash (`extrinsic_hash`) and per-step results.
5. **Track** — view activity feed with execution progress, success/failure, and explorer links.
6. **Publish** — make strategies public. Browse other strategists' profiles (`strategies` table) for inspiration.

### Key UX Considerations

- **FHE encryption** is the differentiator — prominently message that estimates are pre-encryption, actual values are ciphertext.
- **Simulation → Execution** is the primary user flow. Must feel like a "dry run" then "deploy".
- **Version history** matters — users iterate strategies without losing prior versions.
- **Visual strategy builder** — steps are a sequence; workflow_graph may need a node-editor UI.
- **Marketplace dimension** — public strategies (is_public=true) and strategist profiles act as a discovery layer.
- **Multi-chain** — chain_context on strategies, parachain_id on modules and step results.
- **Tokens** have an `asset_id` referencing the on-chain asset identifier — relevant for token selector UI.
- **Action dependencies** (`defi_action_required`) may constrain step ordering in the builder.
