import { Injectable } from '@nestjs/common';
import { BaseSimulator } from './base-simulator';
import {
  SimulationContext,
  SimulationStepResult,
} from '../../domain/simulation-engine.interface';
import { StrategyStepResponseDto } from 'src/ai-strategy-builder/interfaces/dtos/strategy-step-response.dto';

@Injectable()
export class SupplySimulator extends BaseSimulator {
  simulate(
    step: StrategyStepResponseDto,
    context: SimulationContext,
  ): SimulationStepResult {
    const inputAmount = context.current_amount;

    const supplyApy = this.getSupplyApy(step.tokenIn?.assetId);

    const outputAmount = inputAmount;

    context.current_amount = outputAmount;
    context.total_fee += 0;

    if (supplyApy < 2) {
      this.addWarning(
        context,
        `Low supply APY (${supplyApy.toFixed(2)}%) detected`,
      );
    }

    return {
      step_index: step.step,
      action_type: step.type,
      agent: step.agent,
      token_in: {
        asset_id: step.tokenIn?.assetId || 'unknown',
        symbol: step.tokenIn?.symbol || 'UNKNOWN',
        amount: inputAmount,
      },
      token_out: {
        asset_id: step.tokenOut?.assetId || step.tokenIn?.assetId || 'unknown',
        symbol:
          step.tokenOut?.symbol || `a${step.tokenIn?.symbol}` || 'aSUPPLIED',
        amount: inputAmount,
      },
      fee: 0,
      slippage: 0,
      price_impact: 0,
      apy: supplyApy,
      execution_time: '~12 seconds',
    };
  }

  private getSupplyApy(_assetId: string | undefined): number {
    const supplyApyBps = process.env.SUPPLY_APY_BPS;
    if (!supplyApyBps) throw new Error('SUPPLY_APY_BPS env var is required');
    const bps = parseFloat(supplyApyBps);
    return bps / 100;
  }
}
