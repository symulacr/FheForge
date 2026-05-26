import type { StrategyStep } from "@/types/defi.strategy";

export interface Strategy {
  id: string;
  title?: string;
  strategist?: string;
  strategistName?: string;
  strategistHandle?: string;
  handle?: string;
  date?: string;
  apy?: number | null;
  tags?: string[];
  assets?: string[];
  agents?: string[];
  chains?: string[];
  context?: string;
  description?: string;
  status?: string;
  inputAsset?: string | null;
  inputAssetId?: string | number;
  networkCost?: string | null;
  slippage?: string | null;
  steps?: StrategyStep[];
  iterations?: number;
  assetIdIn?: string | number;
}
