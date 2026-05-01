export interface StrategyToken {
  amount: number;
  symbol: string;
  assetId: string;
}

export interface StrategyStep {
  step: number;
  type: string;
  action?: string;
  agent: string;
  tokenIn?: StrategyToken;
  tokenOut?: StrategyToken;
  amount?: number;
  apy?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StrategyMetadata {
  totalSteps: number;
  estimatedGas: number;
  riskLevel: string;
  aiGenerated: boolean;
}

export interface AIAnalysis {
  riskFactors: string[];
  recommendations: string[];
}

export interface BuildStrategyRequest {
  userIntent: string;
  additionalContext?: string;
  tokenAmount?: number;
}

export interface BuildStrategyResponse {
  steps: StrategyStep[];
  validation: ValidationResult;
  metadata: StrategyMetadata;
  aiAnalysis?: AIAnalysis;
  fhe_note?: string;
}

export interface StrategyWorkflow {
  fee: number;
  loops: string;
  steps: StrategyStep[];
}

export interface DefiStrategyVersion {
  id: string;
  version: number;
  created_at: string;
  strategy_id: string;
  workflow_json: StrategyWorkflow;
  workflow_graph: StrategyWorkflow;
}

export interface DefiStrategy {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  status: string;
  is_public: boolean;
  chain_context: string;
  /** Alias for chain_context used in some UI components */
  context?: string;
  current_version_id: string;
  created_at: string;
  /** Display fields populated by the strategy service */
  title?: string;
  apy?: number | null;
  strategist?: string;
  strategistName?: string;
  strategistHandle?: string;
  handle?: string;
  date?: string;
  tags?: string[];
  assets?: string[];
  agents?: string[];
  chains?: string[];
  steps?: StrategyStep[];
  defi_strategy_versions: DefiStrategyVersion[];
}
