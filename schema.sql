-- FheForge schema

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique not null,
  chain_id integer,
  created_at timestamptz default now()
);

create table if not exists strategies (
  id uuid primary key default gen_random_uuid(),
  strategist_name text,
  strategist_handle text,
  apy numeric,
  tags text[] default '{}',
  assets text[] default '{}',
  agents text[] default '{}',
  chains text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists defi_token (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_id text,
  created_at timestamptz default now()
);

create table if not exists defi_modules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  protocol text,
  category text,
  parachain_id text,
  icon_url text,
  description text,
  website_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists defi_pairs (
  id uuid primary key default gen_random_uuid(),
  token_in_id uuid references defi_token(id),
  token_out_id uuid references defi_token(id),
  created_at timestamptz default now()
);

create table if not exists defi_module_actions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references defi_modules(id) on delete cascade,
  pair_id uuid references defi_pairs(id),
  name text,
  action_type text,
  created_at timestamptz default now()
);

create table if not exists defi_strategies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id),
  name text,
  description text,
  status text default 'draft',
  is_public boolean default false,
  chain_context text,
  current_version_id uuid,
  created_at timestamptz default now()
);

create table if not exists defi_strategy_versions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid references defi_strategies(id) on delete cascade,
  version integer default 1,
  workflow_json jsonb,
  workflow_graph jsonb,
  created_at timestamptz default now()
);

create table if not exists defi_strategy_executions (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid references defi_strategy_versions(id),
  extrinsic_hash text,
  execution_status text default 'pending',
  executed_at timestamptz default now()
);

create table if not exists defi_execution_step_results (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid references defi_strategy_executions(id) on delete cascade,
  step_index integer,
  parachain_id text,
  pallet text,
  call text,
  status text,
  output_assets jsonb,
  created_at timestamptz default now()
);

create table if not exists defi_strategy_simulation_snapshots (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid references defi_strategy_versions(id),
  snapshot_type text,
  data jsonb,
  created_at timestamptz default now()
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  user_address text,
  strategy_id uuid,
  tx_hash text[] default '{}',
  status text,
  metadata jsonb,
  current_step integer,
  total_steps integer,
  created_at timestamptz default now()
);
