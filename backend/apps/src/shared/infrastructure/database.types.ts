/// Database row types and Supabase Database schema for typed clients.
/// snake_case column names match the PostgreSQL schema; camelCase handles
/// happen at the domain mapping layer.

export interface UserRow {
  id: string;
  wallet_address: string;
  chain_id: number;
  username: string | null;
  created_at: string | null;
}

export interface ActivityRow {
  id: string;
  user_address: string;
  strategy_id: string;
  tx_hash: string[] | string;
  status: string;
  metadata: Record<string, unknown> | null;
  current_step: number | null;
  total_steps: number | null;
  created_at: string | null;
}

export interface StrategyRow {
  id: string;
  strategist_name: string;
  strategist_handle: string | null;
  apy: number;
  tags: string[];
  assets: string[];
  agents: string[];
  chains: string[];
  created_at: string;
}

export interface DefiModuleRow {
  id: string;
  name: string;
  protocol: string;
  category: string;
  parachain_id: number;
  icon_url: string;
  description: string;
  website_url: string;
  is_active: boolean;
  created_at: string;
}

export interface DefiModuleActionRow {
  id: string;
  module_id: string;
  pair_id: string | null;
  name: string | null;
  action_type: string | null;
  created_at: string;
}

export interface DefiActionRequiredRow {
  id: string;
  action_id: string;
  module_id: string;
  action_required_id: string;
}

export interface DefiPairRow {
  id: string;
  token_in_id: string | null;
  token_out_id: string | null;
  created_at: string;
}

export interface DefiTokenRow {
  id: string;
  name: string;
  asset_id: string;
  created_at: string;
}

export interface DefiStrategyRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  status: string;
  is_public: boolean;
  chain_context: string;
  current_version_id: string;
  created_at: string;
}

export interface DefiStrategyExecutionRow {
  id: string;
  strategy_version_id: string;
  extrinsic_hash: string;
  execution_status: string;
  executed_at: string;
}

export interface DefiStrategyVersionRow {
  id: string;
  strategy_id: string;
  version: number;
  workflow_json: Record<string, unknown>;
  created_at: string;
  workflow_graph: Record<string, unknown>;
}

export interface DefiStrategySimulationSnapshotRow {
  id: string;
  strategy_version_id: string;
  snapshot_type: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface DefiExecutionStepResultRow {
  id: string;
  execution_id: string;
  step_index: number;
  parachain_id: number;
  pallet: string;
  call: string;
  status: string;
  output_assets: Record<string, unknown>;
  error_message: string | null;
}
