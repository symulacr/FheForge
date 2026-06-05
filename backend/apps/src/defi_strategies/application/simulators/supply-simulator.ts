import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Contract, JsonRpcProvider } from 'ethers';
import type { StrategyStepResponseDto } from '../../../ai-strategy-builder/interfaces/dtos/strategy-step-response.dto';
import type {
  SimulationContext,
  SimulationStepResult,
} from '../../domain/simulation-engine.interface';
import { BaseSimulator } from './base-simulator';

const STRATEGY_REGISTRY_ABI = [
  'function getStrategyParams(uint256 strategyId) external view returns (uint16 apyTarget, uint8 loopCount)',
];

interface StrategyParams {
  apyTarget: bigint;
  loopCount: bigint;
}

@Injectable()
export class SupplySimulator extends BaseSimulator {
  private readonly logger = new Logger(SupplySimulator.name);
  private provider: JsonRpcProvider | null = null;
  private strategyRegistry: Contract | null = null;

  constructor(private readonly configService: ConfigService) {
    super();
    const rpcUrl = this.configService.get<string>('COFHE_RPC');
    const registryAddress = this.configService.get<string>('STRATEGY_REGISTRY_ADDRESS');
    if (rpcUrl && registryAddress) {
      this.provider = new JsonRpcProvider(rpcUrl);
      this.strategyRegistry = new Contract(registryAddress, STRATEGY_REGISTRY_ABI, this.provider);
    }
  }

  async simulate(
    step: StrategyStepResponseDto,
    context: SimulationContext,
  ): Promise<SimulationStepResult> {
    const inputAmount = context.current_amount;

    const supplyApy = await this.getSupplyApy(context.strategyId || 0n);

    const outputAmount = inputAmount;

    context.current_amount = outputAmount;
    context.total_fee += 0;

    if (supplyApy < 2) {
      this.addWarning(context, `Low supply APY (${supplyApy.toFixed(2)}%) detected`);
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
        symbol: step.tokenOut?.symbol || `a${step.tokenIn?.symbol}` || 'aSUPPLIED',
        amount: inputAmount,
      },
      fee: 0,
      slippage: 0,
      price_impact: 0,
      apy: supplyApy,
      execution_time: '~12 seconds',
    };
  }

  private getFallbackSupplyApy(): number {
    const bps = this.configService.get<number>('SUPPLY_APY_BPS', 650);
    return bps / 100;
  }

  private async getSupplyApy(strategyId: bigint): Promise<number> {
    if (!this.strategyRegistry) {
      this.logger.warn('StrategyRegistry not configured, using fallback APY');
      return this.getFallbackSupplyApy();
    }

    try {
      const params = (await this.strategyRegistry.getStrategyParams(strategyId)) as StrategyParams;
      // apyTarget is in basis points (uint16), convert to percentage
      return Number(params.apyTarget) / 100;
    } catch (error) {
      this.logger.error(`Failed to fetch strategy params for ID ${strategyId}:`, error);
      return this.getFallbackSupplyApy();
    }
  }
}
