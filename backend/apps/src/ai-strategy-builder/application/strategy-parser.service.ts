import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StrategyStepResponseDto } from '../interfaces/dtos/strategy-step-response.dto';
import { GeminiAiService } from './gemini-ai.service';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

interface TokenInfo {
  assetId: string;
  symbol: string;
  amount: number;
}

interface StrategyStepRaw {
  step?: number;
  type?: string;
  agent?: string;
  tokenIn?: TokenInfo;
  tokenOut?: TokenInfo;
}

@Injectable()
export class StrategyParserService {
  private readonly logger = new Logger(StrategyParserService.name);

  private readonly swapRateWethUsdc: number;
  private readonly swapRateUsdcWeth: number;

  constructor(
    private readonly geminiAi: GeminiAiService,
    private readonly configService: ConfigService,
  ) {
    this.swapRateWethUsdc = this.configService.get<number>(
      'SWAP_RATE_WETH_USDC',
      2500,
    );
    this.swapRateUsdcWeth = this.configService.get<number>(
      'SWAP_RATE_USDC_WETH',
      0.0004,
    );
  }

  async parseNaturalLanguage(
    userIntent: string,
    additionalContext?: string,
    tokenAmount?: number,
  ): Promise<StrategyStepResponseDto[]> {
    this.logger.log('Parsing natural language input', {
      userIntent: userIntent.substring(0, 100) + '...', // Log first 100 chars for privacy
      hasAdditionalContext: !!additionalContext,
      tokenAmount,
    });

    try {
      // Check if input follows structured steps format (e.g., "1. Supply WETH, 2. Borrow USDC")
      if (this.isStructuredStepsFormat(userIntent)) {
        this.logger.debug('Using structured steps parsing');
        return this.parseStructuredSteps(
          userIntent,
          additionalContext,
          tokenAmount,
        );
      }

      // Use AI-powered parsing for natural language input
      this.logger.debug('Using AI-powered parsing');
      const aiResponse = await this.geminiAi.generateStrategySteps(
        userIntent,
        additionalContext,
        tokenAmount,
      );

      // Validate and sanitize the AI-generated steps
      return this.validateAndSanitizeSteps(aiResponse);
    } catch (error) {
      this.logger.error(
        'Natural language parsing failed',
        getErrorStack(error),
      );
      return this.fallbackParsing(userIntent, tokenAmount);
    }
  }

  /**
   * Parses AI response which can be either JSON object/array or JSON string.
   *
   * AI services sometimes return JSON as string instead of parsed objects.
   * This method handles both cases and ensures we get a proper array.
   *
   * @param aiResponse - Response from AI service (can be string or object/array)
   * @returns Parsed array of strategy steps
   * @throws Error if response cannot be parsed
   */
  private parseAiResponse(aiResponse: unknown): StrategyStepResponseDto[] {
    // If already an array, return as-is
    if (Array.isArray(aiResponse)) {
      this.logger.debug('AI response is already an array', {
        stepCount: aiResponse.length,
      });
      return aiResponse as StrategyStepResponseDto[];
    }

    // If it's an object with steps property, extract steps
    if (
      typeof aiResponse === 'object' &&
      aiResponse !== null &&
      'steps' in aiResponse &&
      Array.isArray((aiResponse as Record<string, unknown>).steps)
    ) {
      const steps = (aiResponse as { steps: unknown[] }).steps;
      this.logger.debug('AI response is object with steps array', {
        stepCount: steps.length,
      });
      return steps as StrategyStepResponseDto[];
    }

    // If it's a string, try to parse as JSON
    if (typeof aiResponse === 'string') {
      this.logger.debug('AI response is string, attempting JSON parse', {
        length: aiResponse.length,
        preview: aiResponse.substring(0, 100) + '...',
      });

      try {
        const cleanedResponse = aiResponse.trim();
        const parsed: unknown = JSON.parse(cleanedResponse);

        if (Array.isArray(parsed)) {
          this.logger.debug('Parsed JSON string to array', {
            stepCount: parsed.length,
          });
          return parsed as StrategyStepResponseDto[];
        }

        if (
          parsed &&
          typeof parsed === 'object' &&
          'steps' in parsed &&
          Array.isArray((parsed as { steps: unknown }).steps)
        ) {
          const steps = (parsed as { steps: StrategyStepResponseDto[] }).steps;
          this.logger.debug('Parsed JSON string to object with steps', {
            stepCount: steps.length,
          });
          return steps;
        }

        throw new Error('Parsed JSON does not contain valid steps array');
      } catch (parseError) {
        this.logger.error('Failed to parse AI response as JSON', {
          error: getErrorMessage(parseError),
          responseType: typeof aiResponse,
          responseLength: aiResponse.length,
          responsePreview: aiResponse.substring(0, 200) + '...',
        });
        throw new Error(
          `Invalid AI response format: Unable to parse JSON - ${getErrorMessage(parseError)}`,
        );
      }
    }

    // If we get here, the response format is not supported
    this.logger.error('Unsupported AI response format', {
      responseType: typeof aiResponse,
      isNull: aiResponse === null,
      isUndefined: aiResponse === undefined,
    });
    throw new Error(`Unsupported AI response format: ${typeof aiResponse}`);
  }

  private validateAndSanitizeSteps(
    steps: unknown[],
  ): StrategyStepResponseDto[] {
    if (!Array.isArray(steps)) {
      throw new Error('Generated steps must be an array');
    }

    return steps.map((step, index) => {
      const rawStep = step as StrategyStepRaw;
      // Ensure required fields
      if (!rawStep.type || !rawStep.agent) {
        throw new Error(
          `Step ${index + 1}: Missing required fields (type, agent)`,
        );
      }

      // Validate step number
      const stepNumber = rawStep.step || index + 1;

      // Validate operation type
      const validTypes = [
        'SWAP',
        'SUPPLY',
        'BORROW',
        'JOIN_STRATEGY',
        'ENABLE_E_MODE',
        'BRIDGE',
        'STAKE',
        'UNSTAKE',
        'CLAIM_REWARDS',
      ];

      if (!validTypes.includes(rawStep.type)) {
        throw new Error(
          `Step ${stepNumber}: Invalid operation type '${rawStep.type}'`,
        );
      }

      // Sanitize amounts
      if (rawStep.tokenIn?.amount) {
        rawStep.tokenIn.amount = Number(
          Number(rawStep.tokenIn.amount).toFixed(6),
        );
      }
      if (rawStep.tokenOut?.amount) {
        rawStep.tokenOut.amount = Number(
          Number(rawStep.tokenOut.amount).toFixed(6),
        );
      }

      const result: StrategyStepResponseDto = {
        step: stepNumber,
        type: rawStep.type,
        agent: rawStep.agent,
        tokenIn: rawStep.tokenIn,
        tokenOut: rawStep.tokenOut,
      };
      return result;
    });
  }

  private fallbackParsing(
    userIntent: string,
    tokenAmount?: number,
  ): StrategyStepResponseDto[] {
    const normalizedIntent = userIntent.toLowerCase().trim();

    // Extract input token and amount from intent
    const { inputToken, defaultAmount } =
      this.extractInputTokenFromIntent(userIntent);
    const finalAmount = tokenAmount || defaultAmount;
    const tokenSymbol = inputToken;
    const amount = finalAmount;

    // Auto-detect asset ID
    const assetId = this.getAssetIdBySymbol(tokenSymbol);
    const inputTokenObj = { symbol: tokenSymbol, amount, assetId };

    // Detect strategy type based on intent and token
    if (this.isCustomStrategy(normalizedIntent)) {
      return this.parseCustomStrategy(normalizedIntent, inputTokenObj);
    }

    // If no specific strategy detected, create a simple supply strategy
    return this.createSimpleSupplyStrategy(inputTokenObj);
  }

  private isStructuredStepsFormat(input: string): boolean {
    // Check for numbered steps pattern like "1. Supply", "2. Borrow", etc.
    // Also handle cases like "1. Supply WETH, 2. Borrow USDC, 3. Supply USDC"
    const numberedStepsPattern =
      /\d+\.\s*(supply|lend|borrow|swap|join|stake)/i;
    const hasMultipleSteps = (input.match(/\d+\./g) || []).length >= 2;

    return numberedStepsPattern.test(input) && hasMultipleSteps;
  }

  private parseStructuredSteps(
    input: string,
    additionalContext?: string,
    tokenAmount?: number,
  ): StrategyStepResponseDto[] {
    const steps: StrategyStepResponseDto[] = [];

    // Extract input token and amount from the user intent
    const { inputToken, defaultAmount } =
      this.extractInputTokenFromIntent(input);
    const finalAmount = tokenAmount || defaultAmount;

    const stepMatches = input.match(/\d+\.\s*[^,\d]+/g) || [];

    let stepNumber = 1;
    const currentTokenAmounts: { [symbol: string]: number } = {
      [inputToken]: finalAmount,
    };

    for (const stepMatch of stepMatches) {
      const normalizedStep = stepMatch.toLowerCase().trim();

      // Parse each step based on action keywords
      if (
        normalizedStep.includes('lend') ||
        normalizedStep.includes('supply')
      ) {
        const step = this.parseSupplyStepWithContext(
          stepMatch,
          stepNumber,
          inputToken,
          finalAmount,
          currentTokenAmounts,
        );
        if (step) {
          steps.push(step);
          // Update available amounts after supply
          if (step.tokenIn) {
            currentTokenAmounts[step.tokenIn.symbol] = Math.max(
              0,
              (currentTokenAmounts[step.tokenIn.symbol] || 0) -
                step.tokenIn.amount,
            );
          }
        }
      } else if (normalizedStep.includes('borrow')) {
        const step = this.parseBorrowStepWithContext(
          stepMatch,
          stepNumber,
          inputToken,
          finalAmount,
          currentTokenAmounts,
        );
        if (step) {
          steps.push(step);
          // Update available amounts after borrow
          if (step.tokenOut) {
            currentTokenAmounts[step.tokenOut.symbol] =
              (currentTokenAmounts[step.tokenOut.symbol] || 0) +
              step.tokenOut.amount;
          }
        }
      } else if (
        normalizedStep.includes('swap') ||
        normalizedStep.includes('exchange')
      ) {
        const step = this.parseSwapStepFromIntent(
          stepMatch,
          stepNumber,
          inputToken,
          finalAmount,
        );
        if (step) {
          steps.push(step);
          // Update amounts after swap
          if (step.tokenIn && step.tokenOut) {
            currentTokenAmounts[step.tokenIn.symbol] = Math.max(
              0,
              (currentTokenAmounts[step.tokenIn.symbol] || 0) -
                step.tokenIn.amount,
            );
            currentTokenAmounts[step.tokenOut.symbol] =
              (currentTokenAmounts[step.tokenOut.symbol] || 0) +
              step.tokenOut.amount;
          }
        }
      } else if (
        normalizedStep.includes('join') ||
        normalizedStep.includes('stake')
      ) {
        const step = this.parseJoinStrategyStepFromIntent(
          stepMatch,
          stepNumber,
          inputToken,
          finalAmount,
        );
        if (step) steps.push(step);
      }

      stepNumber++;
    }

    // Add E-Mode only for join strategies or when explicitly requested
    const hasJoinStrategy = steps.some((s) => s.type === 'JOIN_STRATEGY');
    const explicitEMode = /enable\s+e\s*mode/i.test(input);

    if (hasJoinStrategy || explicitEMode) {
      steps.unshift({
        step: 0,
        type: 'ENABLE_E_MODE',
        agent: 'FHENIX',
      });

      // Renumber steps
      steps.forEach((step, index) => {
        step.step = index + 1;
      });
    }

    return steps;
  }

  private parseSupplyStep(
    stepLine: string,
    stepNumber: number,
    inputToken: { symbol: string; amount: number; assetId?: string },
  ): StrategyStepResponseDto | null {
    // Extract token from step like "Supply WETH" or "Supply USDC"
    const tokenMatch = stepLine.match(/supply\s+(WETH|USDC|USDT)/i);
    const percentageMatch = stepLine.match(/(\d+)%/);

    // If no specific token mentioned, use input token for first supply, otherwise default to WETH
    let token: string;
    if (tokenMatch) {
      token = tokenMatch[1].toUpperCase();
    } else if (stepNumber === 1) {
      token = inputToken.symbol.toUpperCase();
    } else {
      // For subsequent supply steps without specific token, try to infer from context
      token = 'WETH'; // Default fallback
    }

    const percentage = percentageMatch ? parseInt(percentageMatch[1]) : 100;
    const amount = (inputToken.amount * percentage) / 100;

    return {
      step: stepNumber,
      type: 'SUPPLY',
      agent: 'FHENIX',
      tokenIn: {
        assetId: this.getAssetIdBySymbol(token),
        symbol: token,
        amount: Number(amount.toFixed(6)),
      },
    };
  }

  private extractInputTokenFromIntent(input: string): {
    inputToken: string;
    defaultAmount: number;
  } {
    // Extract token and amount from patterns
    const amountMatch = input.match(/(\d+(?:\.\d+)?)\s*(WETH|USDC|USDT)/i);
    const tokenMatch = input.match(/(WETH|USDC|USDT)/i);

    // Check for explicit initial token specification
    const initialTokenMatch = input.match(
      /initial\s+token\s+is\s+(WETH|USDC|USDT)/i,
    );
    const withTokenMatch = input.match(
      /with\s+(\d+(?:\.\d+)?)\s*(WETH|USDC|USDT)/i,
    );

    let inputToken = 'WETH'; // Default token
    let defaultAmount = 10; // Default amount

    // Priority 1: Explicit initial token specification
    if (initialTokenMatch) {
      inputToken = initialTokenMatch[1].toUpperCase();
    }
    // Priority 2: Amount with token specification
    else if (withTokenMatch) {
      defaultAmount = parseFloat(withTokenMatch[1]);
      inputToken = withTokenMatch[2].toUpperCase();
    } else if (amountMatch) {
      defaultAmount = parseFloat(amountMatch[1]);
      inputToken = amountMatch[2].toUpperCase();
    } else if (tokenMatch) {
      // If only token is mentioned, use it
      inputToken = tokenMatch[1].toUpperCase();
    }

    return { inputToken, defaultAmount };
  }

  private parseSupplyStepWithContext(
    stepLine: string,
    stepNumber: number,
    defaultInputToken: string,
    finalAmount: number,
    currentTokenAmounts: { [symbol: string]: number },
  ): StrategyStepResponseDto | null {
    // Extract token from step like "Supply WETH" or "Supply USDC"
    const tokenMatch = stepLine.match(/supply\s+(WETH|USDC|USDT)/i);
    const percentageMatch = stepLine.match(/(\d+)%/);

    let token: string;
    let amount: number;

    if (tokenMatch) {
      token = tokenMatch[1].toUpperCase();
      // Use available amount for this token
      const availableAmount = currentTokenAmounts[token] || finalAmount;
      const percentage = percentageMatch ? parseInt(percentageMatch[1]) : 100;
      amount = (availableAmount * percentage) / 100;
    } else if (stepNumber === 1) {
      token = defaultInputToken;
      const percentage = percentageMatch ? parseInt(percentageMatch[1]) : 100;
      amount = (finalAmount * percentage) / 100;
    } else {
      // Default fallback
      token = 'WETH';
      amount = finalAmount;
    }

    return {
      step: stepNumber,
      type: 'SUPPLY',
      agent: 'FHENIX',
      tokenIn: {
        assetId: this.getAssetIdBySymbol(token),
        symbol: token,
        amount: Number(amount.toFixed(6)),
      },
    };
  }

  private parseBorrowStepWithContext(
    stepLine: string,
    stepNumber: number,
    defaultInputToken: string,
    finalAmount: number,
    currentTokenAmounts: { [symbol: string]: number },
  ): StrategyStepResponseDto | null {
    // Extract token from step like "Borrow USDC" or "Borrow USDT using USDC at 50% LTV"
    const borrowTokenMatch = stepLine.match(/borrow\s+(WETH|USDC|USDT)/i);
    const collateralTokenMatch = stepLine.match(/using.*?(WETH|USDC|USDT)/i);
    const ltvMatch = stepLine.match(/(\d+)%\s*ltv/i);

    const borrowToken = borrowTokenMatch
      ? borrowTokenMatch[1].toUpperCase()
      : 'WETH';
    const ltv = ltvMatch ? parseInt(ltvMatch[1]) : 50; // Default 50% LTV

    // Calculate borrow amount based on available collateral
    let borrowAmount: number;
    if (collateralTokenMatch) {
      const collateralToken = collateralTokenMatch[1].toUpperCase();
      const collateralAmount =
        currentTokenAmounts[collateralToken] || finalAmount;
      borrowAmount = (collateralAmount * ltv) / 100;
    } else {
      // Use a reasonable default based on input token
      borrowAmount = (finalAmount * ltv) / 100;
    }

    return {
      step: stepNumber,
      type: 'BORROW',
      agent: 'FHENIX',
      tokenOut: {
        assetId: this.getAssetIdBySymbol(borrowToken),
        symbol: borrowToken,
        amount: Number(borrowAmount.toFixed(6)),
      },
    };
  }

  private parseSwapStepFromIntent(
    stepLine: string,
    stepNumber: number,
    defaultInputToken: string,
    finalAmount: number,
  ): StrategyStepResponseDto | null {
    // Extract tokens from step like "Swap WETH to USDC"
    const swapMatch = stepLine.match(/swap\s+(\w+)\s+to\s+(\w+)/i);

    if (!swapMatch) return null;

    const tokenIn = swapMatch[1].toUpperCase();
    const tokenOut = swapMatch[2].toUpperCase();
    const amount = finalAmount;

    // Estimate output amount based on conversion rates
    let outputAmount = amount;
    if (tokenIn === 'WETH' && tokenOut === 'USDC')
      outputAmount = amount * this.swapRateWethUsdc;
    if (tokenIn === 'WETH' && tokenOut === 'USDT')
      outputAmount = amount * this.swapRateWethUsdc;
    if (tokenIn === 'USDC' && tokenOut === 'WETH')
      outputAmount = amount * this.swapRateUsdcWeth;
    if (tokenIn === 'USDT' && tokenOut === 'WETH')
      outputAmount = amount * this.swapRateUsdcWeth;

    return {
      step: stepNumber,
      type: 'SWAP',
      agent: 'FHENIX',
      tokenIn: {
        assetId: this.getAssetIdBySymbol(tokenIn),
        symbol: tokenIn,
        amount: Number(amount.toFixed(6)),
      },
      tokenOut: {
        assetId: this.getAssetIdBySymbol(tokenOut),
        symbol: tokenOut,
        amount: Number(outputAmount.toFixed(6)),
      },
    };
  }

  private parseJoinStrategyStepFromIntent(
    stepLine: string,
    stepNumber: number,
    defaultInputToken: string,
    finalAmount: number,
  ): StrategyStepResponseDto | null {
    // Extract tokens from step like "Join WETH strategy"
    const joinMatch = stepLine.match(/(weth|usdc|usdt)/i);

    if (!joinMatch) return null;

    const strategyToken = joinMatch[1].toUpperCase();
    const amount = finalAmount;
    const outputAmount = amount * 0.99;

    return {
      step: stepNumber,
      type: 'JOIN_STRATEGY',
      agent: 'FHENIX',
      tokenIn: {
        assetId: this.getAssetIdBySymbol('WETH'),
        symbol: 'WETH',
        amount: Number(amount.toFixed(6)),
      },
      tokenOut: {
        assetId: this.getAssetIdBySymbol(strategyToken),
        symbol: strategyToken,
        amount: Number(outputAmount.toFixed(6)),
      },
    };
  }

  private parseBorrowStep(
    stepLine: string,
    stepNumber: number,
    inputToken: { symbol: string; amount: number; assetId?: string },
  ): StrategyStepResponseDto | null {
    const borrowTokenMatch = stepLine.match(/borrow\s+(WETH|USDC|USDT)/i);
    const ltvMatch = stepLine.match(/(\d+)%\s*ltv/i);

    const borrowToken = borrowTokenMatch
      ? borrowTokenMatch[1].toUpperCase()
      : 'WETH';
    const ltv = ltvMatch ? parseInt(ltvMatch[1]) : 50;
    const borrowAmount = (inputToken.amount * ltv) / 100;

    return {
      step: stepNumber,
      type: 'BORROW',
      agent: 'FHENIX',
      tokenOut: {
        assetId: this.getAssetIdBySymbol(borrowToken),
        symbol: borrowToken,
        amount: Number(borrowAmount.toFixed(6)),
      },
    };
  }

  private parseSwapStep(
    stepLine: string,
    stepNumber: number,
    inputToken: { symbol: string; amount: number; assetId?: string },
  ): StrategyStepResponseDto | null {
    // Extract tokens from step like "Swap WETH to USDC"
    const swapMatch = stepLine.match(/swap\s+(\w+)\s+to\s+(\w+)/i);

    if (!swapMatch) return null;

    const tokenIn = swapMatch[1].toUpperCase();
    const tokenOut = swapMatch[2].toUpperCase();
    const amount = inputToken.amount;

    // Estimate output amount based on conversion rates
    let outputAmount = amount;
    if (tokenIn === 'WETH' && tokenOut === 'USDC')
      outputAmount = amount * this.swapRateWethUsdc;
    if (tokenIn === 'WETH' && tokenOut === 'USDT')
      outputAmount = amount * this.swapRateWethUsdc;
    if (tokenIn === 'USDC' && tokenOut === 'WETH')
      outputAmount = amount * this.swapRateUsdcWeth;
    if (tokenIn === 'USDT' && tokenOut === 'WETH')
      outputAmount = amount * this.swapRateUsdcWeth;

    return {
      step: stepNumber,
      type: 'SWAP',
      agent: 'FHENIX',
      tokenIn: {
        assetId: this.getAssetIdBySymbol(tokenIn),
        symbol: tokenIn,
        amount: Number(amount.toFixed(6)),
      },
      tokenOut: {
        assetId: this.getAssetIdBySymbol(tokenOut),
        symbol: tokenOut,
        amount: Number(outputAmount.toFixed(6)),
      },
    };
  }

  private parseJoinStrategyStep(
    stepLine: string,
    stepNumber: number,
    inputToken: { symbol: string; amount: number; assetId?: string },
  ): StrategyStepResponseDto | null {
    // Extract tokens from step like "Join WETH strategy"
    const joinMatch = stepLine.match(/(weth|usdc|usdt)/i);

    if (!joinMatch) return null;

    const strategyToken = joinMatch[1].toUpperCase();
    const amount = inputToken.amount;
    const outputAmount = amount * 0.99;

    return {
      step: stepNumber,
      type: 'JOIN_STRATEGY',
      agent: 'FHENIX',
      tokenIn: {
        assetId: this.getAssetIdBySymbol('WETH'),
        symbol: 'WETH',
        amount: Number(amount.toFixed(6)),
      },
      tokenOut: {
        assetId: this.getAssetIdBySymbol(strategyToken),
        symbol: strategyToken,
        amount: Number(outputAmount.toFixed(6)),
      },
    };
  }

  private getAssetIdBySymbol(symbol: string): string {
    const map: Record<string, string | undefined> = {
      WETH: process.env.TOKEN_WETH,
      USDC: process.env.TOKEN_USDC,
      USDT: process.env.TOKEN_USDT,
    };
    return map[symbol.toUpperCase()] ?? symbol;
  }

  private isCustomStrategy(intent: string): boolean {
    return (
      intent.includes('swap') ||
      intent.includes('supply') ||
      intent.includes('borrow') ||
      intent.includes('stake') ||
      intent.includes('diversif') ||
      intent.includes('arbitrage') ||
      intent.includes('trade')
    );
  }

  private parseCustomStrategy(
    intent: string,
    inputToken: { symbol: string; amount: number; assetId?: string },
  ): StrategyStepResponseDto[] {
    const steps: StrategyStepResponseDto[] = [];
    let stepNumber = 1;
    const assetId =
      inputToken.assetId || this.getAssetIdBySymbol(inputToken.symbol);

    // Parse individual operations from intent
    const operations = this.extractOperationsFromIntent(intent, inputToken);

    for (const op of operations) {
      if (op.type === 'swap') {
        steps.push({
          step: stepNumber++,
          type: 'SWAP',
          agent: 'FHENIX',
          tokenIn: {
            assetId: assetId,
            symbol: inputToken.symbol,
            amount: op.amount || inputToken.amount,
          },
          tokenOut: {
            assetId: op.tokenOutId || this.getAssetIdBySymbol('USDC'),
            symbol: op.tokenOutSymbol || 'USDC',
            amount: op.amountOut || inputToken.amount * this.swapRateWethUsdc,
          },
        });
      } else if (op.type === 'supply') {
        steps.push({
          step: stepNumber++,
          type: 'SUPPLY',
          agent: 'FHENIX',
          tokenIn: {
            assetId: assetId,
            symbol: inputToken.symbol,
            amount: op.amount || inputToken.amount,
          },
        });
      } else if (op.type === 'borrow') {
        steps.push({
          step: stepNumber++,
          type: 'BORROW',
          agent: 'FHENIX',
          tokenOut: {
            assetId: op.tokenOutId || this.getAssetIdBySymbol('WETH'),
            symbol: op.tokenOutSymbol || 'WETH',
            amount: op.amount || inputToken.amount * 0.9,
          },
        });
      }
    }

    return steps;
  }

  private extractIterationsFromIntent(intent: string): number {
    // Extract iterations from patterns like "3 times", "5 loops", "1 loop", "iterate 4"
    const iterMatch = intent.match(/(\d+)\s*(times?|loops?|iterations?)/i);
    if (iterMatch) return parseInt(iterMatch[1]);

    // Check for "3x", "5x" pattern
    const xMatch = intent.match(/(\d+)x/i);
    if (xMatch) return parseInt(xMatch[1]);

    // Risk-based defaults
    if (
      intent.includes('aggressive') ||
      intent.includes('maximum') ||
      intent.includes('high')
    )
      return 5;
    if (
      intent.includes('conservative') ||
      intent.includes('safe') ||
      intent.includes('low')
    )
      return 2;
    if (intent.includes('moderate')) return 3;

    return 3; // Default 3 iterations
  }

  private extractOperationsFromIntent(
    intent: string,
    inputToken: { symbol: string; amount: number; assetId?: string },
  ): Array<{
    type: string;
    amount: number;
    tokenInId?: string;
    tokenOutId?: string;
    tokenInSymbol?: string;
    tokenOutSymbol?: string;
    amountOut?: number;
  }> {
    const operations: Array<{
      type: string;
      amount: number;
      tokenInId?: string;
      tokenOutId?: string;
      tokenInSymbol?: string;
      tokenOutSymbol?: string;
      amountOut?: number;
    }> = [];

    // Simple pattern matching for operations
    if (intent.includes('swap')) {
      operations.push({
        type: 'swap',
        amount: inputToken.amount,
      });
    }

    if (intent.includes('supply') || intent.includes('deposit')) {
      operations.push({
        type: 'supply',
        amount: inputToken.amount,
      });
    }

    if (intent.includes('borrow')) {
      operations.push({
        type: 'borrow',
        amount: inputToken.amount * 0.9, // Conservative 90% of input
      });
    }

    return operations;
  }

  private estimateSwapAmount(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
  ): number {
    if (tokenIn === 'USDC' && tokenOut === 'WETH') {
      return amountIn * this.swapRateUsdcWeth;
    }
    if (tokenIn === 'USDT' && tokenOut === 'WETH') {
      return amountIn * this.swapRateUsdcWeth;
    }
    if (tokenIn === 'WETH' && tokenOut === 'USDC') {
      return amountIn * this.swapRateWethUsdc;
    }
    if (tokenIn === 'WETH' && tokenOut === 'USDT') {
      return amountIn * this.swapRateWethUsdc;
    }

    return amountIn * 0.99;
  }

  private createSimpleSupplyStrategy(inputToken: {
    symbol: string;
    amount: number;
    assetId?: string;
  }): StrategyStepResponseDto[] {
    const assetId =
      inputToken.assetId || this.getAssetIdBySymbol(inputToken.symbol);

    return [
      {
        step: 1,
        type: 'SUPPLY',
        agent: 'FHENIX',
        tokenIn: {
          assetId: assetId,
          symbol: inputToken.symbol.toUpperCase(),
          amount: inputToken.amount,
        },
      },
    ];
  }
}
