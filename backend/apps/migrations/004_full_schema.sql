-- MC-XXX: Full schema for core business tables
-- Creates all tables defined in schema.sql that are not yet present in the database.
-- Tables: users, strategies, defi_token, defi_modules, defi_pairs, defi_module_actions,
--         defi_strategies, defi_strategy_versions, defi_strategy_executions,
--         defi_execution_step_results, defi_strategy_simulation_snapshots, activities
--
-- This migration is idempotent: each CREATE TABLE uses IF NOT EXISTS so it can be
-- applied safely alongside schema.sql or against an existing database.

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL UNIQUE,
  chain_id      INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);

-- ── strategies ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategist_name   TEXT,
  strategist_handle TEXT,
  apy               NUMERIC,
  tags              TEXT[] DEFAULT '{}',
  assets            TEXT[] DEFAULT '{}',
  agents            TEXT[] DEFAULT '{}',
  chains            TEXT[] DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── defi_token ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_token (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  asset_id  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── defi_modules ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_modules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  protocol      TEXT,
  category      TEXT,
  parachain_id  TEXT,
  icon_url      TEXT,
  description   TEXT,
  website_url   TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── defi_pairs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_pairs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_in_id  UUID REFERENCES defi_token(id),
  token_out_id UUID REFERENCES defi_token(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_pairs_token_in  ON defi_pairs(token_in_id);
CREATE INDEX IF NOT EXISTS idx_defi_pairs_token_out ON defi_pairs(token_out_id);

-- ── defi_module_actions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_module_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id   UUID NOT NULL REFERENCES defi_modules(id) ON DELETE CASCADE,
  pair_id     UUID REFERENCES defi_pairs(id),
  name        TEXT,
  action_type TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_module_actions_module_id ON defi_module_actions(module_id);
CREATE INDEX IF NOT EXISTS idx_defi_module_actions_pair_id   ON defi_module_actions(pair_id);

-- ── defi_strategies ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_strategies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID REFERENCES users(id),
  name               TEXT,
  description        TEXT,
  status             TEXT DEFAULT 'draft',
  is_public          BOOLEAN DEFAULT FALSE,
  chain_context      TEXT,
  current_version_id UUID,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_strategies_owner_id ON defi_strategies(owner_id);

-- ── defi_strategy_versions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_strategy_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id    UUID NOT NULL REFERENCES defi_strategies(id) ON DELETE CASCADE,
  version        INTEGER DEFAULT 1,
  workflow_json  JSONB,
  workflow_graph JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_strategy_versions_strategy_id ON defi_strategy_versions(strategy_id);

-- ── defi_strategy_executions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_strategy_executions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_version_id UUID REFERENCES defi_strategy_versions(id),
  extrinsic_hash      TEXT,
  execution_status    TEXT DEFAULT 'pending',
  executed_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_strategy_executions_strategy_version_id
  ON defi_strategy_executions(strategy_version_id);

-- ── defi_execution_step_results ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_execution_step_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id  UUID NOT NULL REFERENCES defi_strategy_executions(id) ON DELETE CASCADE,
  step_index    INTEGER,
  parachain_id  TEXT,
  pallet        TEXT,
  call          TEXT,
  status        TEXT,
  output_assets JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_execution_step_results_execution_id
  ON defi_execution_step_results(execution_id);

-- ── defi_strategy_simulation_snapshots ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS defi_strategy_simulation_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_version_id UUID REFERENCES defi_strategy_versions(id),
  snapshot_type       TEXT,
  data                JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_sim_snapshots_strategy_version_id
  ON defi_strategy_simulation_snapshots(strategy_version_id);

-- ── activities ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address  TEXT,
  strategy_id   UUID,
  tx_hash       TEXT[] DEFAULT '{}',
  status        TEXT,
  metadata      JSONB,
  current_step  INTEGER,
  total_steps   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_user_address ON activities(user_address);
CREATE INDEX IF NOT EXISTS idx_activities_strategy_id  ON activities(strategy_id);
