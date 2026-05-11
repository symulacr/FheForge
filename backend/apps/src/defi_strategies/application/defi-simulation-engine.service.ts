import { Injectable } from '@nestjs/common';
import {
  SimulationContext,
  SimulationEngine,
  SimulationOutput,
  SimulationStepResult,
  WorkflowJson,
} from '../domain/simulation-engine.interface';
import { SwapSimulator } from './simulators/swap-simulator';
import { SupplySimulator } from './simulators/supply-simulator';
import { BorrowSimulator } from './simulators/borrow-simulator';
import { JoinStrategySimulator } from './simulators/join-strategy-simulator';

@Injectable()
export class DefiSimulationEngine extends SimulationEngine {
  constructor(
    private readonly swapSimulator: SwapSimulator,
    private readonly supplySimulator: SupplySimulator,
    private readonly borrowSimulator: BorrowSimulator,
    private readonly joinStrategySimulator: JoinStrategySimulator,
  ) {
    super();
  }

  async simulate(
    workflow_json: WorkflowJson,
    amount_in: number,
    options?: { slippage_tolerance?: number; gas_price?: number },
  ): Promise<SimulationOutput> {
    const context: SimulationContext = {
      amount_in,
      slippage_tolerance: options?.slippage_tolerance ?? 0.5,
      gas_price: options?.gas_price,
      current_amount: amount_in,
      total_fee: 0,
      warnings: [],
      fhe_mode: true,
      amount_precision: 'EXACT' as const,
    };

    const steps = workflow_json?.steps ?? [];
    const results: SimulationStepResult[] = [];

    for (const step of steps) {
      const simulator = this.getSimulator(step.type);
      if (simulator) {
        const result = await Promise.resolve(simulator.simulate(step, context));
        results.push(result);
      }
    }

    return {
      steps: results,
      total_fee: context.total_fee,
      output_amount: context.current_amount,
      warnings: context.warnings,
    };
  }

  private getSimulator(type: string) {
    switch (type?.toUpperCase()) {
      case 'SWAP':
        return this.swapSimulator;
      case 'SUPPLY':
        return this.supplySimulator;
      case 'BORROW':
        return this.borrowSimulator;
      default:
        return null;
    }
  }
}