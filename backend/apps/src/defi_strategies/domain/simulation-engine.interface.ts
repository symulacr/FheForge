import type { StrategyStepResponseDto } from "src/ai-strategy-builder/interfaces/dtos/strategy-step-response.dto";

export interface SimulationContext {
	amount_in: number;
	slippage_tolerance: number;
	gas_price?: number;
	current_amount: number;
	total_fee: number;
	warnings: string[];
	fhe_mode: boolean;
	amount_precision: "EXACT" | "BOUNDED";
	strategyId?: bigint;
}

export interface SimulationStepDto {
	step: number;
	type: string;
	agent: string;
	tokenIn: {
		assetId: string;
		symbol: string;
		amount: number;
	};
	tokenOut: {
		assetId: string;
		symbol: string;
		amount: number;
	};
}

export interface SimulationStepResult {
	step_index: number;
	action_type: string;
	agent: string;
	token_in: {
		asset_id: string;
		symbol: string;
		amount: number;
	};
	token_out: {
		asset_id: string;
		symbol: string;
		amount: number;
	};
	fee: number;
	slippage?: number;
	price_impact?: number;
	apy?: number;
	execution_time: string;
}

export interface ActionSimulator {
	simulate(
		step: StrategyStepResponseDto,
		context: SimulationContext,
	): SimulationStepResult | Promise<SimulationStepResult>;
}

export interface WorkflowJson {
	steps: StrategyStepResponseDto[];
}

export interface SimulationOutput {
	steps: SimulationStepResult[];
	total_fee: number;
	output_amount: number;
	warnings: string[];
}

export abstract class SimulationEngine {
	abstract simulate(
		workflow_json: WorkflowJson,
		amount_in: number,
		options?: {
			slippage_tolerance?: number;
			gas_price?: number;
		},
	): Promise<SimulationOutput>;
}
