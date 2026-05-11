import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseSimulator } from './base-simulator';
import {
  SimulationContext,
  SimulationStepResult,
} from '../../domain/simulation-engine.interface';
import { FhenixStrategyService } from '../../../shared/infrastructure/fhenix-strategy.service';
import { StrategyStepResponseDto } from '../../../ai-strategy-builder/interfaces/dtos/strategy-step-response.dto';
import { JsonRpcProvider, Contract } from 'ethers';

const STRATEGY_REGISTRY_ABI = [
  'function getStrategyParams(uint256 strategyId) external view returns (uint16 apyTarget, uint8 loopCount)',
];

interface StrategyParams {
  apyTarget: bigint;
  loopCount: bigint;
}

interface StrategyStepWithCollateral extends StrategyStepResponseDto {
  collateralRatio?: number;
}

@Injectable()
export class BorrowSimulator extends BaseSimulator {
  private readonly logger = new Logger(BorrowSimulator.name);
  private provider: JsonRpcProvider | null = null;
  private strategyRegistry: Contract | null = null;

  constructor(
    private readonly fhenixStrategyService: FhenixStrategyService,
    private readonly configService: ConfigService,
  ) {
    super();
    const rpcUrl = this.configService.get<string>('COFHE_RPC');
    const registryAddress = this.configService.get<string>(
      'STRATEGY_REGISTRY_ADDRESS',
    );
    if (rpcUrl && registryAddress) {
      this.provider = new JsonRpcProvider(rpcUrl);
      this.strategyRegistry = new Contract(
        registryAddress,
        STRATEGY_REGISTRY_ABI,
        this.provider,
      );
    }
  }

  async simulate(
    step: StrategyStepWithCollateral,
    context: SimulationContext,
  ): Promise<SimulationStepResult> {
    const inputAmount = context.current_amount;

    const fee = 0;

    const interestRate = await this.getInterestRate(context.strategyId || 0n);

    const collateralRatio = step.collateralRatio || 0.7;
    const borrowAmount = inputAmount * collateralRatio;

    const exchangeRate = await this.getExchangeRate(
      step.tokenIn!.assetId,
      step.tokenOut!.assetId,
    );

    if (collateralRatio > 0.8) {
      this.addWarning(
        context,
        `High collateral ratio (${(collateralRatio * 100).toFixed(0)}%) - risk of liquidation`,
      );
    }

    if (interestRate > 10) {
      this.addWarning(
        context,
        `High interest rate (${interestRate.toFixed(2)}%) detected`,
      );
    }

    const outputAmount = (borrowAmount - fee) * exchangeRate;

    context.current_amount = outputAmount;
    context.total_fee += fee;

    return {
      step_index: step.step,
      action_type: step.type,
      agent: step.agent,
      token_in: {
        asset_id: step.tokenIn?.assetId || 'unknown',
        symbol: step.tokenIn?.symbol || 'COLLATERAL',
        amount: inputAmount,
      },
      token_out: {
        asset_id: step.tokenOut?.assetId || 'unknown',
        symbol: step.tokenOut?.symbol || 'BORROWED',
        amount: outputAmount,
      },
      fee,
      slippage: 0,
      price_impact: 0,
      apy: interestRate,
      execution_time: '~15 seconds',
    };
  }

  private async getInterestRate(strategyId: bigint): Promise<number> {
    if (!this.strategyRegistry) {
      this.logger.warn('StrategyRegistry not configured, using fallback APY');
      return 6.0;
    }

    try {
      const params = (await this.strategyRegistry.getStrategyParams(
        strategyId,
      )) as StrategyParams;
      // apyTarget is in basis points (uint16), convert to percentage
      return Number(params.apyTarget) / 100;
    } catch (error) {
      this.logger.error(
        `Failed to fetch strategy params for ID ${strategyId}:`,
        error,
      );
      return 6.0; // Fallback to default
    }
  }

  private async getExchangeRate(
    assetIdIn: string,
    assetIdOut: string,
  ): Promise<number> {
    const exchangeRate = await this.fhenixStrategyService.getAssetPrice(
      assetIdIn,
      assetIdOut,
    );
    return exchangeRate;
  }
}
