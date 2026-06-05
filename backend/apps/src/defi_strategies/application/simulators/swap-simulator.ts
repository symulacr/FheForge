import { Injectable } from "@nestjs/common";
import type { StrategyStepResponseDto } from "../../../ai-strategy-builder/interfaces/dtos/strategy-step-response.dto";
import type { FhenixStrategyService } from "../../../shared/infrastructure/fhenix-strategy.service";
import type {
	SimulationContext,
	SimulationStepResult,
} from "../../domain/simulation-engine.interface";
import { BaseSimulator } from "./base-simulator";

@Injectable()
export class SwapSimulator extends BaseSimulator {
	constructor(private readonly fhenixStrategyService: FhenixStrategyService) {
		super();
	}
	async simulate(
		step: StrategyStepResponseDto,
		context: SimulationContext,
	): Promise<SimulationStepResult> {
		const inputAmount = context.current_amount;

		const feePercentage = 0.3;
		const fee = this.calculateFee(inputAmount, feePercentage);

		const slippage = this.calculateSlippage(inputAmount, context.slippage_tolerance);

		const priceImpact = this.calculatePriceImpact(inputAmount);

		if (priceImpact > 1.0) {
			this.addWarning(context, `High price impact (${priceImpact.toFixed(2)}%) detected in swap`);
		}

		const exchangeRate = await this.getExchangeRate(step.tokenIn?.assetId, step.tokenOut?.assetId);

		const outputAmount = (inputAmount - fee - slippage) * exchangeRate;

		context.current_amount = outputAmount;
		context.total_fee += fee;

		return {
			step_index: step.step,
			action_type: step.type,
			agent: step.agent,
			token_in: {
				asset_id: step.tokenIn?.assetId,
				symbol: step.tokenIn?.symbol,
				amount: inputAmount,
			},
			token_out: {
				asset_id: step.tokenOut?.assetId,
				symbol: step.tokenOut?.symbol,
				amount: outputAmount,
			},
			fee,
			slippage: context.slippage_tolerance,
			price_impact: priceImpact,
			execution_time: "~30 seconds",
		};
	}

	private async getExchangeRate(assetIdIn: string, assetIdOut: string): Promise<number> {
		const exchangeRate = await this.fhenixStrategyService.getAssetPrice(assetIdIn, assetIdOut);
		return exchangeRate;
	}

	private calculatePriceImpact(amount: number): number {
		if (amount > 10000) return 2.5;
		if (amount > 5000) return 1.2;
		if (amount > 1000) return 0.5;
		return 0.1;
	}
}
