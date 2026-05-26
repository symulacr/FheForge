import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { StrategyStepResponseDto } from '../interfaces/dtos/strategy-step-response.dto';
import {
  StrategyConstraintsService,
  StrategyConstraints,
} from './strategy-constraints.service';
import { StrategyTemplatesService } from './strategy-templates.service';
import {
  GeminiApiException,
  GeminiRateLimitException,
  GeminiAuthException,
  GeminiQuotaException,
  GeminiParsingException,
} from '../../common/exceptions/gemini-api.exception';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number(error.status)
    : undefined;
}

function getErrorProperty(error: unknown, prop: string): unknown {
  if (typeof error === 'object' && error !== null) {
    return (error as Record<string, unknown>)[prop];
  }
  return undefined;
}

@Injectable()
export class GeminiAiService {
  private readonly logger = new Logger(GeminiAiService.name);
  private genAI: GoogleGenerativeAI;
  private model!: GenerativeModel;

  constructor(
    private readonly constraintsService: StrategyConstraintsService,
    private readonly templatesService: StrategyTemplatesService,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not set — AI strategy builder disabled');
      return;
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });
  }

  private requireModel() {
    if (!this.model)
      throw new Error('AI strategy builder disabled — GEMINI_API_KEY not set');
  }

  async generateStrategySteps(
    userIntent: string,
    additionalContext?: string,
    tokenAmount?: number,
  ): Promise<StrategyStepResponseDto[]> {
    this.requireModel();
    if (this.isMaximizeYieldRequest(userIntent)) {
      return this.generateMaximizeYieldStrategy(
        userIntent,
        additionalContext,
        tokenAmount,
      );
    }

    const { inputToken, defaultAmount } =
      this.extractInputTokenFromIntent(userIntent);
    const finalAmount = tokenAmount || defaultAmount;

    const loopCount = this.extractLoopCount(userIntent);
    const initialToken = this.extractInitialTokenFromContext(additionalContext);
    const swapInfo = this.needsInitialSwap(userIntent, additionalContext);

    const constraints = await this.constraintsService.getStrategyConstraints(
      inputToken,
      userIntent,
      additionalContext,
    );

    const prompt = this.buildConstrainedPrompt(
      userIntent,
      { symbol: inputToken, amount: finalAmount },
      constraints,
      additionalContext,
      loopCount,
      initialToken,
      swapInfo,
    );

    const maxRetries = 3;
    let retryCount = 0;
    let lastError: unknown;

    while (retryCount <= maxRetries) {
      try {
        const result = await this.model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        if (!text || text.trim().length === 0) {
          throw new Error('Gemini returned empty response');
        }

        let steps: StrategyStepResponseDto[];
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          try {
            steps = JSON.parse(jsonMatch[1]) as StrategyStepResponseDto[];
          } catch (parseError) {
            throw new Error(
              `Failed to parse JSON from Gemini response: ${getErrorMessage(parseError)}`,
            );
          }
        } else {
          try {
            steps = JSON.parse(text) as StrategyStepResponseDto[];
          } catch {
            throw new Error(
              `Gemini response is not valid JSON. Response: ${text.substring(0, 200)}...`,
            );
          }
        }

        if (!Array.isArray(steps) || steps.length === 0) {
          throw new Error(
            'Gemini returned invalid strategy steps (not an array or empty)',
          );
        }

        steps = this.filterDeadTypes(steps);

        steps = this.addInitialSwapIfNeeded(
          steps,
          userIntent,
          additionalContext,
        );

        return steps;
      } catch (error) {
        this.logger.error(
          `Gemini API error (attempt ${retryCount + 1}/${maxRetries + 1}):`,
          error,
        );
        lastError = error;

        const isRateLimit =
          getErrorStatus(error) === 429 ||
          getErrorMessage(error).includes('429') ||
          getErrorMessage(error).includes('Too Many Requests');

        if (isRateLimit && retryCount < maxRetries) {
          const delaySeconds = Math.pow(2, retryCount);

          await new Promise((resolve) =>
            setTimeout(resolve, delaySeconds * 1000),
          );
          retryCount++;
          continue;
        }

        break;
      }
    }

    const error = lastError;

    const errorStatus = getErrorProperty(error, 'status');
    const errorStatusText = getErrorProperty(error, 'statusText');
    const errorMessage = getErrorMessage(error);
    const errorDetails = getErrorProperty(error, 'errorDetails');
    this.logger.error('Full Gemini error details:', {
      status: errorStatus,
      statusText: errorStatusText,
      message: errorMessage,
      errorDetails: errorDetails,
    });

    if (
      errorStatus === 429 ||
      errorMessage?.includes('429') ||
      errorMessage?.includes('Too Many Requests')
    ) {
      throw new GeminiRateLimitException(
        'Rate limit exceeded. Please try again in a moment.',
      );
    } else if (errorStatus === 401 || errorMessage?.includes('API key')) {
      throw new GeminiAuthException('API authentication failed.');
    } else if (errorStatus === 403 || errorMessage?.includes('quota')) {
      throw new GeminiQuotaException(
        'API quota exceeded. Please try again later.',
      );
    } else if (errorMessage?.includes('timeout')) {
      throw new GeminiApiException('Request timeout. Please try again.', 408);
    } else if (
      errorMessage?.includes('Failed to parse') ||
      errorMessage?.includes('empty response') ||
      errorMessage?.includes('not valid JSON') ||
      errorMessage?.includes('invalid strategy steps')
    ) {
      throw new GeminiParsingException(
        'AI response parsing failed. Please try again.',
      );
    } else {
      throw new GeminiApiException('AI service temporarily unavailable.');
    }
  }

  private extractInputTokenFromIntent(input: string): {
    inputToken: string;
    defaultAmount: number;
  } {
    const amountMatch = input.match(/(\d+(?:\.\d+)?)\s*(WETH|USDT|USDC)/i);
    const tokenMatch = input.match(/(WETH|USDT|USDC)/i);

    const initialTokenMatch = input.match(
      /initial\s+token\s+is\s+(WETH|USDT|USDC)/i,
    );
    const withTokenMatch = input.match(
      /with\s+(\d+(?:\.\d+)?)\s*(WETH|USDT|USDC)/i,
    );

    let inputToken = 'WETH';
    let defaultAmount = 10;

    if (initialTokenMatch) {
      inputToken = initialTokenMatch[1].toUpperCase();
    } else if (withTokenMatch) {
      defaultAmount = parseFloat(withTokenMatch[1]);
      inputToken = withTokenMatch[2].toUpperCase();
    } else if (amountMatch) {
      defaultAmount = parseFloat(amountMatch[1]);
      inputToken = amountMatch[2].toUpperCase();
    } else if (tokenMatch) {
      inputToken = tokenMatch[1].toUpperCase();
    }

    return { inputToken, defaultAmount };
  }

  private extractLoopCount(input: string): number {
    const iterMatch = input.match(/(\d+)\s*(times?|loops?|iterations?)/i);
    if (iterMatch) return parseInt(iterMatch[1]);

    const xMatch = input.match(/(\d+)x/i);
    if (xMatch) return parseInt(xMatch[1]);

    const withLoopMatch = input.match(/with\s+(\d+)\s+loops?/i);
    if (withLoopMatch) return parseInt(withLoopMatch[1]);

    return 3;
  }

  private extractInitialTokenFromContext(
    additionalContext?: string,
  ): string | undefined {
    if (!additionalContext) return undefined;

    const initialTokenMatch = additionalContext.match(
      /initial\s+token\s+is\s+(WETH|USDT|USDC)/i,
    );
    return initialTokenMatch ? initialTokenMatch[1].toUpperCase() : undefined;
  }

  private needsInitialSwap(
    userIntent: string,
    additionalContext?: string,
  ): { needsSwap: boolean; fromToken: string; toToken: string } {
    const initialToken = this.extractInitialTokenFromContext(additionalContext);
    if (!initialToken) return { needsSwap: false, fromToken: '', toToken: '' };

    const firstStepMatch = userIntent.match(
      /(?:1\.\s*)?(?:supply|lend|swap|borrow)\s+(\w+)/i,
    );
    if (!firstStepMatch)
      return { needsSwap: false, fromToken: '', toToken: '' };

    const firstStepToken = firstStepMatch[1].toUpperCase();

    const needsSwap = initialToken.toUpperCase() !== firstStepToken;

    return {
      needsSwap,
      fromToken: initialToken.toUpperCase(),
      toToken: firstStepToken,
    };
  }

  private filterDeadTypes(
    steps: StrategyStepResponseDto[],
  ): StrategyStepResponseDto[] {
    const validTypes = ['SWAP', 'SUPPLY', 'BORROW', 'CLAIM_REWARDS'];
    return steps.filter((step) => validTypes.includes(step.type));
  }

  private addInitialSwapIfNeeded(
    steps: StrategyStepResponseDto[],
    userIntent: string,
    additionalContext?: string,
  ): StrategyStepResponseDto[] {
    const initialToken = this.extractInitialTokenFromContext(additionalContext);
    if (!initialToken) {
      return steps;
    }

    const firstStepWithToken = steps.find((step) => step.tokenIn?.symbol);

    if (!firstStepWithToken || !firstStepWithToken.tokenIn) {
      return steps;
    }

    const firstStepToken = firstStepWithToken.tokenIn.symbol.toUpperCase();
    const needsSwap = initialToken.toUpperCase() !== firstStepToken;

    if (!needsSwap) {
      return steps;
    }

    const fromAssetId = this.getAssetIdBySymbol(initialToken);
    const toAssetId = this.getAssetIdBySymbol(firstStepToken);

    const firstStepAmount = firstStepWithToken.tokenIn.amount || 10;

    const swapStep: StrategyStepResponseDto = {
      step: 1,
      type: 'SWAP',
      agent: 'COFHE',
      tokenIn: {
        assetId: fromAssetId,
        symbol: initialToken.toUpperCase(),
        amount: firstStepAmount,
      },
      tokenOut: {
        assetId: toAssetId,
        symbol: firstStepToken,
        amount: firstStepAmount * 0.98,
      },
    };

    const updatedSteps = [swapStep, ...steps];

    return updatedSteps.map((step, index) => ({
      ...step,
      step: index + 1,
    }));
  }

  private getAssetIdBySymbol(symbol: string): string {
    const assetMap: { [key: string]: string } = {
      WETH: process.env.TOKEN_WETH || '',
      USDC: process.env.TOKEN_USDC || '',
      USDT: process.env.TOKEN_USDT || '',
    };

    return assetMap[symbol.toUpperCase()] || '';
  }

  private isMaximizeYieldRequest(userIntent: string): boolean {
    const intent = userIntent.toLowerCase();
    return (
      intent.includes('maximize yield') ||
      intent.includes('maximum yield') ||
      intent.includes('highest yield') ||
      intent.includes('best yield')
    );
  }

  private async generateMaximizeYieldStrategy(
    userIntent: string,
    additionalContext?: string,
    tokenAmount?: number,
  ): Promise<StrategyStepResponseDto[]> {
    this.requireModel();

    const { inputToken, defaultAmount } =
      this.extractInputTokenFromIntent(userIntent);
    const finalAmount = tokenAmount || defaultAmount;
    const initialToken = this.extractInitialTokenFromContext(additionalContext);

    const riskLevel = this.extractRiskLevel(userIntent);
    const maxLoops = this.templatesService.getMaxLoopsForRisk(riskLevel);

    const bestTemplate = this.templatesService.getHighestYieldTemplate(
      riskLevel,
      maxLoops,
    );

    if (!bestTemplate) {
      return this.generateRegularStrategy(userIntent, additionalContext);
    }

    const tokenToUse = initialToken || inputToken;
    let adaptedSteps = this.templatesService.adaptTemplateToToken(
      bestTemplate,
      tokenToUse,
      finalAmount,
    );

    adaptedSteps = this.addInitialSwapIfNeeded(
      adaptedSteps,
      userIntent,
      additionalContext,
    );

    return adaptedSteps;
  }

  private extractRiskLevel(userIntent: string): 'LOW' | 'MEDIUM' | 'HIGH' {
    const intent = userIntent.toLowerCase();

    if (
      intent.includes('low risk') ||
      intent.includes('conservative') ||
      intent.includes('safe')
    ) {
      return 'LOW';
    } else if (
      intent.includes('high risk') ||
      intent.includes('aggressive') ||
      intent.includes('risky')
    ) {
      return 'HIGH';
    } else if (
      intent.includes('moderate risk') ||
      intent.includes('medium risk') ||
      intent.includes('balanced')
    ) {
      return 'MEDIUM';
    }

    return 'MEDIUM';
  }

  private async generateRegularStrategy(
    userIntent: string,
    additionalContext?: string,
    tokenAmount?: number,
  ): Promise<StrategyStepResponseDto[]> {
    const { inputToken, defaultAmount } =
      this.extractInputTokenFromIntent(userIntent);
    const finalAmount = tokenAmount || defaultAmount;
    const loopCount = this.extractLoopCount(userIntent);
    const initialToken = this.extractInitialTokenFromContext(additionalContext);
    const swapInfo = this.needsInitialSwap(userIntent, additionalContext);

    const constraints = await this.constraintsService.getStrategyConstraints(
      inputToken,
      userIntent,
      additionalContext,
    );

    const prompt = this.buildConstrainedPrompt(
      userIntent,
      { symbol: inputToken, amount: finalAmount },
      constraints,
      additionalContext,
      loopCount,
      initialToken,
      swapInfo,
    );

    const result = await this.model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    let steps: StrategyStepResponseDto[];
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      steps = JSON.parse(jsonMatch[1]) as StrategyStepResponseDto[];
    } else {
      steps = JSON.parse(text) as StrategyStepResponseDto[];
    }

    steps = this.filterDeadTypes(steps);
    steps = this.addInitialSwapIfNeeded(steps, userIntent, additionalContext);

    return steps;
  }

  private buildConstrainedPrompt(
    userIntent: string,
    inputToken: { symbol: string; amount: number; assetId?: string },
    constraints: StrategyConstraints,
    additionalContext?: string,
    loopCount?: number,
    initialToken?: string,
    swapInfo?: { needsSwap: boolean; fromToken: string; toToken: string },
  ): string {
    const availableOpsText = constraints.availableOperations
      .filter((op) => op.supported)
      .map((op) => {
        if (op.tokenIn && op.tokenOut) {
          return `- ${op.type}: ${op.tokenIn.symbol} (${op.tokenIn.assetId}) → ${op.tokenOut.symbol} (${op.tokenOut.assetId})`;
        } else if (op.tokenIn) {
          return `- ${op.type}: ${op.tokenIn.symbol} (${op.tokenIn.assetId})`;
        } else if (op.tokenOut) {
          return `- ${op.type}: → ${op.tokenOut.symbol} (${op.tokenOut.assetId})`;
        } else {
          return `- ${op.type}: Available`;
        }
      })
      .join('\n');

    const supportedTokensText = constraints.supportedTokens
      .map((token) => `- ${token.symbol} (assetId: "${token.assetId}")`)
      .join('\n');

    const isStructuredSteps = /^\s*\d+\.\s*\w+/m.test(userIntent);

    if (isStructuredSteps) {
      const swapInfo = this.needsInitialSwap(userIntent, additionalContext);

      return `
You are a DeFi strategy expert for the Arbitrum ecosystem. Convert structured step-by-step instructions into executable DeFi strategy steps.

USER STRUCTURED STEPS:
${userIntent}

INPUT TOKEN: ${inputToken.amount} ${inputToken.symbol} (assetId: ${constraints.inputToken.assetId})
${initialToken ? `INITIAL TOKEN: ${initialToken}` : ''}
${swapInfo?.needsSwap ? `NEEDS INITIAL SWAP: ${swapInfo.fromToken} → ${swapInfo.toToken}` : ''}
${additionalContext ? `ADDITIONAL CONTEXT: "${additionalContext}"` : ''}

CONSTRAINTS FROM DATABASE:
- Max Leverage: ${constraints.operationConstraints.maxLeverage}x
- Risk Level: ${constraints.operationConstraints.riskLevel}

AVAILABLE OPERATIONS FOR ${inputToken.symbol}:
${availableOpsText}

ALL SUPPORTED TOKENS:
${supportedTokensText}

TRANSLATION RULES:
1. "Lend" or "Supply" → SUPPLY operation
2. "Borrow" → BORROW operation
3. "Swap" or "Exchange" → SWAP operation
4. Replace any non-arbitrum protocols with COFHE
5. Convert percentages to actual amounts based on input token
6. ONLY use operations and tokens listed above

INITIAL TOKEN HANDLING:
${
  swapInfo?.needsSwap
    ? `
- DETECTED: User starts with ${swapInfo.fromToken} but first step needs ${swapInfo.toToken}
- SYSTEM WILL AUTO-ADD: SWAP ${swapInfo.fromToken} to ${swapInfo.toToken} as step 1
- You can focus on the main strategy steps, the initial swap will be handled automatically
- Example: If user has USDT but strategy starts with "Supply USDC", system adds SWAP USDT→USDC automatically
`
    : 'No initial swap needed - starting token matches first step token or no initial token specified'
}

CRITICAL RULES:
1. ONLY use operations listed in "AVAILABLE OPERATIONS" above
2. ONLY use tokens listed in "SUPPORTED TOKENS" above
3. Agent is always "COFHE" for all operations
4. Step numbers must be sequential starting from 1
5. BUSINESS RULES FOR STEP SEQUENCES - MANDATORY:
   - SWAP can be followed by: SUPPLY, SWAP
   - SUPPLY can be followed by: BORROW
   - BORROW can be followed by: SWAP, SUPPLY
6. NEVER create invalid sequences
${swapInfo?.needsSwap ? `7. AUTOMATIC SWAP: System will auto-add SWAP ${swapInfo.fromToken} → ${swapInfo.toToken} as first step` : ''}

VALID SEQUENCE EXAMPLES:
✅ SWAP → SUPPLY → BORROW → SWAP (valid chain)
✅ SUPPLY → BORROW → SUPPLY (valid leverage loop)

INVALID SEQUENCE EXAMPLES:
❌ SWAP → BORROW (SWAP cannot directly lead to BORROW)
❌ SUPPLY → SWAP (SUPPLY can only lead to BORROW)

Generate a JSON array of strategy steps using ONLY the available operations above.

FINAL VALIDATION CHECKLIST:
✅ Each step follows business rules for sequences
✅ No invalid transitions
✅ All tokens and operations are from available lists above
✅ Step numbers are sequential starting from 1

Each step format:
{
  "step": number,
  "type": "OPERATION_TYPE",
  "agent": "COFHE",
  "tokenIn": {
    "assetId": "string",
    "symbol": "string",
    "amount": number
  },
  "tokenOut": {
    "assetId": "string",
    "symbol": "string",
    "amount": number
  }
}

Return ONLY the JSON array:
`;
    }

    return `
You are a DeFi strategy expert for the Arbitrum ecosystem. Create a strategy based on ACTUAL available operations from the database.

USER INPUT:
- Intent: "${userIntent}"
- Input Token: ${inputToken.amount} ${inputToken.symbol} (assetId: ${constraints.inputToken.assetId})
${initialToken ? `- Initial Token: ${initialToken}` : ''}
${swapInfo?.needsSwap ? `- Needs Initial Swap: ${swapInfo.fromToken} → ${swapInfo.toToken}` : ''}
${loopCount ? `- Loop Count: ${loopCount} iterations` : ''}
${additionalContext ? `- Additional Context: "${additionalContext}"` : ''}

CONSTRAINTS FROM DATABASE:
- Max Leverage: ${constraints.operationConstraints.maxLeverage}x
- Risk Level: ${constraints.operationConstraints.riskLevel}

AVAILABLE OPERATIONS FOR ${inputToken.symbol}:
${availableOpsText}

ALL SUPPORTED TOKENS:
${supportedTokensText}

CRITICAL RULES:
1. ONLY use operations listed in "AVAILABLE OPERATIONS" above
2. ONLY use tokens listed in "SUPPORTED TOKENS" above
3. Respect the max leverage constraint (${constraints.operationConstraints.maxLeverage}x)
4. Match risk level to user intent (${constraints.operationConstraints.riskLevel})
5. Agent is always "COFHE" for all operations
6. Step numbers must be sequential starting from 1
7. BUSINESS RULES FOR STEP SEQUENCES - MANDATORY:
   - SWAP can be followed by: SUPPLY, SWAP
   - SUPPLY can be followed by: BORROW
   - BORROW can be followed by: SWAP, SUPPLY
   - NEVER create invalid sequences

LOOPING STRATEGY LOGIC:
If user mentions "loop", "loops", "leverage", or "multiply":
1. Extract number of loops from phrases like "3 loop", "5 loops", "2 times" (detected: ${loopCount || 3} loops)
2. Create a looping strategy with the specified iterations
3. Each loop should follow business rules: Supply → Borrow → (next valid step)
4. Use decreasing amounts for each iteration (e.g., 90% of previous amount)
5. For "Supply WETH and borrow USDC with 3 loop": Create 3 complete Supply+Borrow cycles
6. ENSURE ALL SEQUENCES FOLLOW BUSINESS RULES

STRATEGY GENERATION LOGIC:
${swapInfo?.needsSwap ? `1. AUTOMATIC SWAP: System will auto-add SWAP ${swapInfo.fromToken} → ${swapInfo.toToken} as first step` : '1. Check if initial token differs from first step token - system will auto-add SWAP if needed'}
2. For looping strategies: Repeat Supply + Borrow for specified iterations
3. For simple strategies: Use available SWAP operations for the input token
4. Use available SUPPLY operations for collateral
5. Use available BORROW operations for leverage
6. Respect leverage limits and create realistic amounts

INITIAL TOKEN HANDLING:
${
  swapInfo?.needsSwap
    ? `
- DETECTED: User starts with ${swapInfo.fromToken} but first step needs ${swapInfo.toToken}
- SYSTEM WILL AUTO-ADD: SWAP ${swapInfo.fromToken} to ${swapInfo.toToken} as step 1
- You can focus on the main strategy steps, the initial swap will be handled automatically
- Example: If user has USDT but strategy starts with "Supply USDC", system adds SWAP USDT→USDC automatically
`
    : 'No initial swap needed - starting token matches first step token or no initial token specified'
}

OPERATION TYPES EXPLANATION:
- SWAP: Direct token exchange
- SUPPLY: Provide tokens as collateral
- BORROW: Borrow tokens against collateral

EXAMPLE LOOPING STRATEGY for "Supply WETH and borrow USDC with 3 loop":
1. SUPPLY WETH (10 WETH)
2. BORROW USDC (9 USDC at 90% LTV)
3. SWAP USDC to WETH (get ~1.35 WETH) - Valid: BORROW → SWAP
4. SUPPLY WETH (1.35 WETH) - Valid: SWAP → SUPPLY
5. BORROW USDC (1.2 USDC) - Valid: SUPPLY → BORROW
6. SWAP USDC to WETH (get ~0.18 WETH) - Valid: BORROW → SWAP
7. SUPPLY WETH (0.18 WETH) - Valid: SWAP → SUPPLY
8. BORROW USDC (0.16 USDC) - Valid: SUPPLY → BORROW

Note: Each step follows business rules - no invalid sequences like SWAP→BORROW or SUPPLY→SWAP

Generate a JSON array of strategy steps using ONLY the available operations above.

FINAL VALIDATION CHECKLIST:
✅ Each step follows business rules for sequences
✅ No invalid transitions
✅ All tokens and operations are from available lists above
✅ Step numbers are sequential starting from 1

Each step format:
{
  "step": number,
  "type": "OPERATION_TYPE",
  "agent": "COFHE",
  "tokenIn": {
    "assetId": "string",
    "symbol": "string",
    "amount": number
  },
  "tokenOut": {
    "assetId": "string",
    "symbol": "string",
    "amount": number
  }
}

Return ONLY the JSON array:
`;
  }

  async analyzeStrategyRisk(steps: StrategyStepResponseDto[]): Promise<{
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    riskFactors: string[];
    recommendations: string[];
  }> {
    this.requireModel();
    const prompt = `
Analyze the risk level of this DeFi strategy and provide recommendations:

STRATEGY STEPS:
${JSON.stringify(steps, null, 2)}

Analyze based on:
1. Number of borrowing operations (high leverage = high risk)
2. Token volatility (WETH, USDC, USDT volatility)
3. Liquidation risk from looping
4. Smart contract risks
5. Slippage risks

Return JSON format:
{
  "riskLevel": "LOW|MEDIUM|HIGH",
  "riskFactors": ["factor1", "factor2"],
  "recommendations": ["recommendation1", "recommendation2"]
}
`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      const raw = jsonMatch ? jsonMatch[1] : text;
      return JSON.parse(raw) as {
        riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
        riskFactors: string[];
        recommendations: string[];
      };
    } catch (error) {
      this.logger.error('Risk analysis error', error);
      const borrowSteps = steps.filter((s) => s.type === 'BORROW').length;
      return {
        riskLevel:
          borrowSteps > 5 ? 'HIGH' : borrowSteps > 2 ? 'MEDIUM' : 'LOW',
        riskFactors: ['Unable to perform detailed risk analysis'],
        recommendations: [
          'Review strategy manually',
          'Start with smaller amounts',
        ],
      };
    }
  }

  async optimizeStrategy(steps: StrategyStepResponseDto[]): Promise<{
    optimizedSteps: StrategyStepResponseDto[];
    optimizations: string[];
  }> {
    this.requireModel();
    const prompt = `
Optimize this DeFi strategy for better efficiency and lower risk:

CURRENT STRATEGY:
${JSON.stringify(steps, null, 2)}

Optimization goals:
1. Reduce gas costs by combining operations
2. Improve capital efficiency
3. Reduce liquidation risk
4. Optimize LTV ratios

Return JSON format:
{
  "optimizedSteps": [...], // Same format as input steps
  "optimizations": ["optimization1", "optimization2"]
}
`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      const raw = jsonMatch ? jsonMatch[1] : text;
      return JSON.parse(raw) as {
        optimizedSteps: StrategyStepResponseDto[];
        optimizations: string[];
      };
    } catch (error) {
      this.logger.error('Strategy optimization error', error);
      return {
        optimizedSteps: steps,
        optimizations: ['Unable to optimize strategy automatically'],
      };
    }
  }
}
