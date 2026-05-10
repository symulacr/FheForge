import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DefiPairsService } from '../../defi_modules/application/defi_pairs.service';
import { DefiTokenService } from '../../defi_token/application/defi_token.service';
import { OperationType } from '../../defi_modules/domain/operation-type.enum';

export interface AvailableOperation {
  type: OperationType;
  tokenIn?: {
    id: string;
    symbol: string;
    assetId: string;
  };
  tokenOut?: {
    id: string;
    symbol: string;
    assetId: string;
  };
  supported: boolean;
}

export interface StrategyConstraints {
  inputToken: {
    id: string;
    symbol: string;
    assetId: string;
  };
  availableOperations: AvailableOperation[];
  supportedTokens: Array<{
    id: string;
    symbol: string;
    assetId: string;
  }>;
  operationConstraints: {
    maxLeverage: number;
    supportedPairs: string[];
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  };
}

@Injectable()
export class StrategyConstraintsService {
  private readonly wethTokenId: string;
  private readonly usdcTokenId: string;
  private readonly usdtTokenId: string;

  constructor(
    private readonly defiPairsService: DefiPairsService,
    private readonly defiTokenService: DefiTokenService,
    private readonly configService: ConfigService,
  ) {
    this.wethTokenId = this.configService.get<string>(
      'TOKEN_WETH_ID',
      'weth-token-id',
    );
    this.usdcTokenId = this.configService.get<string>(
      'TOKEN_USDC_ID',
      'usdc-token-id',
    );
    this.usdtTokenId = this.configService.get<string>(
      'TOKEN_USDT_ID',
      'usdt-token-id',
    );
  }

  async getStrategyConstraints(
    inputTokenSymbol: string,
    userIntent: string,
    additionalContext?: string,
  ): Promise<StrategyConstraints> {
    const inputToken = this.getTokenBySymbol(inputTokenSymbol);

    const availableOperations = await this.getAvailableOperations(
      inputToken.id,
    );

    const supportedTokens = this.getAllSupportedTokens();

    const operationConstraints = this.analyzeOperationConstraints(
      userIntent,
      additionalContext,
    );

    return {
      inputToken,
      availableOperations,
      supportedTokens,
      operationConstraints,
    };
  }

  private getTokenBySymbol(symbol: string): {
    id: string;
    symbol: string;
    assetId: string;
  } {
    const tokenMap: Record<
      string,
      { id: string; symbol: string; assetId: string }
    > = {
      WETH: {
        id: this.wethTokenId,
        symbol: 'WETH',
        assetId: process.env.TOKEN_WETH ?? '',
      },
      USDC: {
        id: this.usdcTokenId,
        symbol: 'USDC',
        assetId: process.env.TOKEN_USDC ?? '',
      },
      USDT: {
        id: this.usdtTokenId,
        symbol: 'USDT',
        assetId: process.env.TOKEN_USDT ?? '',
      },
    };

    const token = tokenMap[symbol.toUpperCase()];
    if (!token) {
      throw new Error(`Unsupported token: ${symbol}`);
    }
    return token;
  }

  private async getAvailableOperations(
    tokenId: string,
  ): Promise<AvailableOperation[]> {
    try {
      const { asInput, asOutput } =
        await this.defiPairsService.getAvailablePairsForToken(tokenId);
      const operations: AvailableOperation[] = [];

      for (const pair of asInput) {
        const tokenOut = this.getTokenById(pair.token_out_id!);

        operations.push({
          type: OperationType.SWAP,
          tokenIn: this.getTokenById(tokenId),
          tokenOut,
          supported: true,
        });

        operations.push({
          type: OperationType.JOIN_STRATEGY,
          tokenIn: this.getTokenById(tokenId),
          tokenOut,
          supported: true,
        });
      }

      for (const pair of asOutput) {
        const tokenIn = this.getTokenById(pair.token_in_id!);

        operations.push({
          type: OperationType.BORROW,
          tokenIn,
          tokenOut: this.getTokenById(tokenId),
          supported: true,
        });
      }

      operations.push({
        type: OperationType.SUPPLY,
        tokenIn: this.getTokenById(tokenId),
        supported: true,
      });

      operations.push({
        type: OperationType.ENABLE_E_MODE,
        supported: true,
      });

      return operations;
    } catch (error) {
      console.error('Failed to get available operations:', error);
      return [];
    }
  }

  private getTokenById(tokenId: string): {
    id: string;
    symbol: string;
    assetId: string;
  } {
    const tokenMap: Record<
      string,
      { id: string; symbol: string; assetId: string }
    > = {
      [this.wethTokenId]: {
        id: this.wethTokenId,
        symbol: 'WETH',
        assetId: process.env.TOKEN_WETH ?? '',
      },
      [this.usdcTokenId]: {
        id: this.usdcTokenId,
        symbol: 'USDC',
        assetId: process.env.TOKEN_USDC ?? '',
      },
      [this.usdtTokenId]: {
        id: this.usdtTokenId,
        symbol: 'USDT',
        assetId: process.env.TOKEN_USDT ?? '',
      },
    };

    return tokenMap[tokenId] ?? { id: tokenId, symbol: 'UNKNOWN', assetId: '' };
  }

  private getAllSupportedTokens(): Array<{
    id: string;
    symbol: string;
    assetId: string;
  }> {
    return [
      {
        id: this.wethTokenId,
        symbol: 'WETH',
        assetId: process.env.TOKEN_WETH ?? '',
      },
      {
        id: this.usdcTokenId,
        symbol: 'USDC',
        assetId: process.env.TOKEN_USDC ?? '',
      },
      {
        id: this.usdtTokenId,
        symbol: 'USDT',
        assetId: process.env.TOKEN_USDT ?? '',
      },
    ];
  }

  private analyzeOperationConstraints(
    userIntent: string,
    additionalContext?: string,
  ): {
    maxLeverage: number;
    supportedPairs: string[];
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  } {
    const intent = userIntent.toLowerCase();
    const context = additionalContext?.toLowerCase() || '';

    let maxLeverage = 3;
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

    if (
      intent.includes('conservative') ||
      intent.includes('safe') ||
      context.includes('low risk')
    ) {
      maxLeverage = 2;
      riskLevel = 'LOW';
    } else if (
      intent.includes('aggressive') ||
      intent.includes('maximum') ||
      context.includes('high risk')
    ) {
      maxLeverage = 10;
      riskLevel = 'HIGH';
    } else if (intent.includes('moderate')) {
      maxLeverage = 5;
      riskLevel = 'MEDIUM';
    }

    if (context.includes('max') && context.includes('leverage')) {
      const leverageMatch = context.match(/max(?:imum)?\s*(\d+)x?\s*leverage/);
      if (leverageMatch) {
        maxLeverage = parseInt(leverageMatch[1]);
      }
    }

    return {
      maxLeverage,
      supportedPairs: [],
      riskLevel,
    };
  }

  async validateOperationSupport(
    operationType: OperationType,
    tokenInId?: string,
    tokenOutId?: string,
  ): Promise<boolean> {
    try {
      switch (operationType) {
        case OperationType.SWAP:
        case OperationType.JOIN_STRATEGY: {
          if (!tokenInId || !tokenOutId) return false;
          const swapPairs =
            await this.defiPairsService.getAvailableOperationsForTokenPair(
              tokenInId,
              tokenOutId,
            );
          return swapPairs.length > 0;
        }

        case OperationType.SUPPLY: {
          if (!tokenInId) return false;
          const { asInput } =
            await this.defiPairsService.getAvailablePairsForToken(tokenInId);
          return asInput.length > 0;
        }

        case OperationType.BORROW: {
          if (!tokenOutId) return false;
          const { asOutput } =
            await this.defiPairsService.getAvailablePairsForToken(tokenOutId);
          return asOutput.length > 0;
        }

        case OperationType.ENABLE_E_MODE:
          return true;

        default:
          return false;
      }
    } catch (error) {
      console.error('Failed to validate operation support:', error);
      return false;
    }
  }
}
