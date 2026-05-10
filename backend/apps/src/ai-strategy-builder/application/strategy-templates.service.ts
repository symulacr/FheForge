import { Injectable } from '@nestjs/common';
import { StrategyStepResponseDto } from '../interfaces/dtos/strategy-step-response.dto';

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  apy: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  loopCount: number;
  steps: StrategyStepResponseDto[];
  tags: string[];
}

@Injectable()
export class StrategyTemplatesService {
  private templates: StrategyTemplate[] = [
    {
      id: 'simple-supply-usdc',
      name: 'Simple USDC Supply',
      description: 'Basic USDC supply strategy',
      apy: 5.2,
      riskLevel: 'LOW',
      loopCount: 0,
      steps: [
        {
          step: 1,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_USDC || '',
            symbol: 'USDC',
            amount: 100,
          },
        },
      ],
      tags: ['supply', 'stable', 'low-risk'],
    },
    {
      id: 'usdc-weth-leverage-2x',
      name: 'USDC-WETH Leverage 2x',
      description: 'Supply USDC, borrow WETH with 2 loops',
      apy: 12.8,
      riskLevel: 'MEDIUM',
      loopCount: 2,
      steps: [
        {
          step: 1,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_USDC || '',
            symbol: 'USDC',
            amount: 100,
          },
        },
        {
          step: 2,
          type: 'BORROW',
          agent: 'FHENIX',
          tokenOut: {
            assetId: process.env.TOKEN_WETH || '',
            symbol: 'WETH',
            amount: 70,
          },
        },
        {
          step: 3,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_WETH || '',
            symbol: 'WETH',
            amount: 70,
          },
        },
        {
          step: 4,
          type: 'BORROW',
          agent: 'FHENIX',
          tokenOut: {
            assetId: process.env.TOKEN_USDC || '',
            symbol: 'USDC',
            amount: 49,
          },
        },
      ],
      tags: ['leverage', 'moderate-risk', 'yield-farming'],
    },
    {
      id: 'usdc-weth-leverage-3x',
      name: 'USDC-WETH Leverage 3x',
      description: 'Supply USDC, borrow WETH with 3 loops',
      apy: 18.5,
      riskLevel: 'MEDIUM',
      loopCount: 3,
      steps: [
        {
          step: 1,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_USDC || '',
            symbol: 'USDC',
            amount: 100,
          },
        },
        {
          step: 2,
          type: 'BORROW',
          agent: 'FHENIX',
          tokenOut: {
            assetId: process.env.TOKEN_WETH || '',
            symbol: 'WETH',
            amount: 70,
          },
        },
        {
          step: 3,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_WETH || '',
            symbol: 'WETH',
            amount: 70,
          },
        },
        {
          step: 4,
          type: 'BORROW',
          agent: 'FHENIX',
          tokenOut: {
            assetId: process.env.TOKEN_USDC || '',
            symbol: 'USDC',
            amount: 49,
          },
        },
        {
          step: 5,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_USDC || '',
            symbol: 'USDC',
            amount: 49,
          },
        },
        {
          step: 6,
          type: 'BORROW',
          agent: 'FHENIX',
          tokenOut: {
            assetId: process.env.TOKEN_WETH || '',
            symbol: 'WETH',
            amount: 34,
          },
        },
      ],
      tags: ['leverage', 'moderate-risk', 'yield-farming'],
    },
    {
      id: 'usdt-weth-leverage-2x',
      name: 'USDT-WETH Leverage 2x',
      description: 'Supply USDT, borrow WETH with 2 loops',
      apy: 15.3,
      riskLevel: 'MEDIUM',
      loopCount: 2,
      steps: [
        {
          step: 1,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_USDT || '',
            symbol: 'USDT',
            amount: 100,
          },
        },
        {
          step: 2,
          type: 'BORROW',
          agent: 'FHENIX',
          tokenOut: {
            assetId: process.env.TOKEN_WETH || '',
            symbol: 'WETH',
            amount: 98,
          },
        },
        {
          step: 3,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_WETH || '',
            symbol: 'WETH',
            amount: 98,
          },
        },
      ],
      tags: ['leverage', 'usdt', 'moderate-risk'],
    },
    {
      id: 'aggressive-leverage-5x',
      name: 'Aggressive Leverage 5x',
      description: 'High leverage strategy with 5 loops',
      apy: 28.7,
      riskLevel: 'HIGH',
      loopCount: 5,
      steps: [
        {
          step: 1,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: process.env.TOKEN_USDC || '',
            symbol: 'USDC',
            amount: 100,
          },
        },
      ],
      tags: ['high-leverage', 'high-risk', 'aggressive'],
    },
  ];

  getAllTemplates(): StrategyTemplate[] {
    return this.templates;
  }

  getTemplatesByRiskLevel(
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH',
  ): StrategyTemplate[] {
    return this.templates.filter(
      (template) => template.riskLevel === riskLevel,
    );
  }

  getHighestYieldTemplate(
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH',
    maxLoops?: number,
  ): StrategyTemplate | null {
    let filteredTemplates = this.templates;

    if (riskLevel) {
      filteredTemplates = filteredTemplates.filter(
        (t) => t.riskLevel === riskLevel,
      );
    }

    if (maxLoops !== undefined) {
      filteredTemplates = filteredTemplates.filter(
        (t) => t.loopCount <= maxLoops,
      );
    }

    if (filteredTemplates.length === 0) {
      return null;
    }

    return filteredTemplates.sort((a, b) => b.apy - a.apy)[0];
  }

  getTemplatesByInputToken(tokenSymbol: string): StrategyTemplate[] {
    return this.templates.filter((template) =>
      template.steps.some(
        (step) =>
          step.tokenIn?.symbol?.toUpperCase() === tokenSymbol.toUpperCase(),
      ),
    );
  }

  adaptTemplateToToken(
    template: StrategyTemplate,
    inputToken: string,
    amount: number,
  ): StrategyStepResponseDto[] {
    const adaptedSteps = JSON.parse(
      JSON.stringify(template.steps),
    ) as StrategyStepResponseDto[];

    const firstStepWithToken = adaptedSteps.find((step) => step.tokenIn);
    if (firstStepWithToken && firstStepWithToken.tokenIn) {
      firstStepWithToken.tokenIn.symbol = inputToken.toUpperCase();
      firstStepWithToken.tokenIn.amount = amount;

      const assetMap: Record<string, string> = {
        WETH: process.env.TOKEN_WETH ?? '',
        USDC: process.env.TOKEN_USDC ?? '',
        USDT: process.env.TOKEN_USDT ?? '',
      };
      firstStepWithToken.tokenIn.assetId =
        assetMap[inputToken.toUpperCase()] ?? '5';
    }

    return adaptedSteps;
  }

  getRiskLevelFromLoops(loopCount: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (loopCount === 0) return 'LOW';
    if (loopCount <= 3) return 'MEDIUM';
    return 'HIGH';
  }

  getMaxLoopsForRisk(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'): number {
    switch (riskLevel) {
      case 'LOW':
        return 0;
      case 'MEDIUM':
        return 3;
      case 'HIGH':
        return 10;
      default:
        return 3;
    }
  }
}
