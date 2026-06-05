import {
  type GenerativeModel,
  GoogleGenerativeAI,
} from '@google/generative-ai';
import { Injectable, Logger } from '@nestjs/common';
import {
  GeminiApiException,
  GeminiAuthException,
  GeminiParsingException,
  GeminiQuotaException,
  GeminiRateLimitException,
} from '../../common/exceptions/gemini-api.exception';
import type { StrategyStepResponseDto } from '../interfaces/dtos/strategy-step-response.dto';

// ─── Inlined from GasEstimationService ──────────────────────────────────────
const GAS_ESTIMATES: Record<string, number> = {
  SWAP: 150000, SUPPLY: 100000, BORROW: 120000, CLAIM_REWARDS: 80000,
};
const DEFAULT_GAS = 100000;

// ─── Inlined from StrategyConstraintsService ────────────────────────────────
const ASSET_MAP: Record<string, string> = {
  WETH: process.env.TOKEN_WETH || '',
  USDC: process.env.TOKEN_USDC || '',
  USDT: process.env.TOKEN_USDT || '',
};
const VALID_STEP_TYPES = new Set(['SWAP', 'SUPPLY', 'BORROW', 'CLAIM_REWARDS']);

// ─── Inlined from StrategyTemplatesService ──────────────────────────────────
const TEMPLATES = [
  { id: 'simple-supply-usdc', riskLevel: 'LOW' as const, loopCount: 0, apy: 5.2,
    steps: [{ step: 1, type: 'SUPPLY' as const, agent: 'COFHE', tokenIn: { assetId: process.env.TOKEN_USDC || '', symbol: 'USDC', amount: 100 } }] },
  { id: 'usdc-weth-leverage-2x', riskLevel: 'MEDIUM' as const, loopCount: 2, apy: 12.8,
    steps: [
      { step: 1, type: 'SUPPLY' as const, agent: 'COFHE', tokenIn: { assetId: process.env.TOKEN_USDC || '', symbol: 'USDC', amount: 100 } },
      { step: 2, type: 'BORROW' as const, agent: 'COFHE', tokenOut: { assetId: process.env.TOKEN_WETH || '', symbol: 'WETH', amount: 70 } },
      { step: 3, type: 'SUPPLY' as const, agent: 'COFHE', tokenIn: { assetId: process.env.TOKEN_WETH || '', symbol: 'WETH', amount: 70 } },
      { step: 4, type: 'BORROW' as const, agent: 'COFHE', tokenOut: { assetId: process.env.TOKEN_USDC || '', symbol: 'USDC', amount: 49 } },
    ] },
  { id: 'usdc-weth-leverage-3x', riskLevel: 'MEDIUM' as const, loopCount: 3, apy: 18.5,
    steps: [
      { step: 1, type: 'SUPPLY' as const, agent: 'COFHE', tokenIn: { assetId: process.env.TOKEN_USDC || '', symbol: 'USDC', amount: 100 } },
      { step: 2, type: 'BORROW' as const, agent: 'COFHE', tokenOut: { assetId: process.env.TOKEN_WETH || '', symbol: 'WETH', amount: 70 } },
      { step: 3, type: 'SUPPLY' as const, agent: 'COFHE', tokenIn: { assetId: process.env.TOKEN_WETH || '', symbol: 'WETH', amount: 70 } },
      { step: 4, type: 'BORROW' as const, agent: 'COFHE', tokenOut: { assetId: process.env.TOKEN_USDC || '', symbol: 'USDC', amount: 49 } },
      { step: 5, type: 'SUPPLY' as const, agent: 'COFHE', tokenIn: { assetId: process.env.TOKEN_USDC || '', symbol: 'USDC', amount: 49 } },
      { step: 6, type: 'BORROW' as const, agent: 'COFHE', tokenOut: { assetId: process.env.TOKEN_WETH || '', symbol: 'WETH', amount: 34 } },
    ] },
  { id: 'aggressive-leverage-5x', riskLevel: 'HIGH' as const, loopCount: 5, apy: 28.7,
    steps: [{ step: 1, type: 'SUPPLY' as const, agent: 'COFHE', tokenIn: { assetId: process.env.TOKEN_USDC || '', symbol: 'USDC', amount: 100 } }] },
];

function getBestTemplate(riskLevel?: string, maxLoops?: number) {
  let filtered = TEMPLATES;
  if (riskLevel) filtered = filtered.filter(t => t.riskLevel === riskLevel);
  if (maxLoops !== undefined) filtered = filtered.filter(t => t.loopCount <= maxLoops);
  return filtered.sort((a, b) => b.apy - a.apy)[0] || null;
}

function adaptTemplate(template: typeof TEMPLATES[number], token: string, amount: number): StrategyStepResponseDto[] {
  return template.steps.map((s, i) => {
    const step = { ...s, step: i + 1 };
    if (step.tokenIn) step.tokenIn = { ...step.tokenIn, assetId: ASSET_MAP[token] || '', symbol: token, amount };
    if (step.tokenOut) step.tokenOut = { ...step.tokenOut, amount: Math.round(amount * 0.7) };
    return step;
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as Record<string, unknown>).status) : undefined;
}

@Injectable()
export class GeminiAiService {
  private readonly logger = new Logger(GeminiAiService.name);
  private genAI: GoogleGenerativeAI;
  private model!: GenerativeModel;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not set — AI strategy builder disabled');
      return;
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  }

  private requireModel() {
    if (!this.model) throw new Error('AI strategy builder disabled — GEMINI_API_KEY not set');
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  async generateStrategySteps(
    userIntent: string, additionalContext?: string, tokenAmount?: number,
  ): Promise<StrategyStepResponseDto[]> {
    this.requireModel();
    if (this.isMaximizeYieldRequest(userIntent)) {
      return this.generateMaximizeYieldStrategy(userIntent, additionalContext, tokenAmount);
    }
    const { inputToken, defaultAmount } = this.extractInputToken(userIntent);
    const finalAmount = tokenAmount || defaultAmount;
    const loopCount = this.extractLoopCount(userIntent);
    const initialToken = this.extractInitialToken(additionalContext);
    const constraints = this.buildConstraints(inputToken);
    const prompt = this.buildPrompt(userIntent, { symbol: inputToken, amount: finalAmount }, constraints, additionalContext, loopCount, initialToken);
    return this.callGeminiWithRetry(prompt, userIntent, additionalContext);
  }

  async analyzeStrategyRisk(steps: StrategyStepResponseDto[]): Promise<{
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; riskFactors: string[]; recommendations: string[];
  }> {
    this.requireModel();
    const prompt = `Analyze the risk level of this DeFi strategy:\n${JSON.stringify(steps, null, 2)}\n\nReturn JSON: {"riskLevel":"LOW|MEDIUM|HIGH","riskFactors":[],"recommendations":[]}`;
    try {
      const text = await this.callGemini(prompt);
      return JSON.parse(text);
    } catch (error) {
      this.logger.error('Risk analysis error', error);
      const borrowSteps = steps.filter(s => s.type === 'BORROW').length;
      return {
        riskLevel: borrowSteps > 5 ? 'HIGH' : borrowSteps > 2 ? 'MEDIUM' : 'LOW',
        riskFactors: ['Unable to perform detailed risk analysis'],
        recommendations: ['Review strategy manually', 'Start with smaller amounts'],
      };
    }
  }

  async optimizeStrategy(steps: StrategyStepResponseDto[]): Promise<{
    optimizedSteps: StrategyStepResponseDto[]; optimizations: string[];
  }> {
    this.requireModel();
    const prompt = `Optimize this DeFi strategy for efficiency:\n${JSON.stringify(steps, null, 2)}\n\nReturn JSON: {"optimizedSteps":[],"optimizations":[]}`;
    try {
      const text = await this.callGemini(prompt);
      return JSON.parse(text);
    } catch (error) {
      this.logger.error('Strategy optimization error', error);
      return { optimizedSteps: steps, optimizations: ['Unable to optimize automatically'] };
    }
  }

  estimateGas(stepType: string): number {
    return GAS_ESTIMATES[stepType] ?? DEFAULT_GAS;
  }

  validateSteps(steps: StrategyStepResponseDto[]): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.type || !step.agent) { errors.push(`Step ${i + 1}: Missing required fields`); continue; }
      if (!VALID_STEP_TYPES.has(step.type)) { errors.push(`Step ${i + 1}: Invalid operation type '${step.type}'`); continue; }
      if (step.tokenIn?.amount !== undefined && step.tokenIn.amount <= 0) errors.push(`Step ${i + 1}: Invalid tokenIn amount`);
      if (step.tokenOut?.amount !== undefined && step.tokenOut.amount <= 0) errors.push(`Step ${i + 1}: Invalid tokenOut amount`);
      if (i > 0) {
        const prev = steps[i - 1].type;
        const valid: Record<string, string[]> = { SWAP: ['SUPPLY', 'SWAP'], SUPPLY: ['BORROW'], BORROW: ['SWAP', 'SUPPLY', 'BORROW'] };
        if (valid[prev] && !valid[prev].includes(step.type)) warnings.push(`Step ${i + 1}: Unusual sequence ${prev} → ${step.type}`);
      }
    }
    if (!steps.some(s => s.type === 'SUPPLY')) warnings.push('Strategy has no supply steps');
    return { isValid: errors.length === 0, errors, warnings };
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private async callGemini(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    const text = result.response.text();
    if (!text?.trim()) throw new Error('Gemini returned empty response');
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    return jsonMatch ? jsonMatch[1] : text;
  }

  private async callGeminiWithRetry(
    prompt: string, userIntent: string, additionalContext?: string,
  ): Promise<StrategyStepResponseDto[]> {
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: unknown;
    while (retryCount <= maxRetries) {
      try {
        const text = await this.callGemini(prompt);
        let steps = JSON.parse(text) as StrategyStepResponseDto[];
        if (!Array.isArray(steps) || !steps.length) throw new Error('Invalid strategy steps');
        steps = steps.filter(s => VALID_STEP_TYPES.has(s.type));
        steps = this.addInitialSwapIfNeeded(steps, additionalContext);
        return steps;
      } catch (error) {
        lastError = error;
        const isRateLimit = getErrorStatus(error) === 429 || getErrorMessage(error).includes('429');
        if (isRateLimit && retryCount < maxRetries) {
          await new Promise(r => setTimeout(r, 2 ** retryCount * 1000));
          retryCount++;
          continue;
        }
        break;
      }
    }
    this.mapGeminiError(lastError);
    throw new GeminiApiException('AI service temporarily unavailable.'); // unreachable but TS needs it
  }

  private mapGeminiError(error: unknown): never {
    const status = getErrorStatus(error);
    const msg = getErrorMessage(error);
    if (status === 429 || msg.includes('429')) throw new GeminiRateLimitException('Rate limit exceeded.');
    if (status === 401 || msg.includes('API key')) throw new GeminiAuthException('API authentication failed.');
    if (status === 403 || msg.includes('quota')) throw new GeminiQuotaException('API quota exceeded.');
    if (msg.includes('timeout')) throw new GeminiApiException('Request timeout.', 408);
    if (msg.includes('parse') || msg.includes('empty') || msg.includes('JSON')) throw new GeminiParsingException('AI response parsing failed.');
    throw new GeminiApiException('AI service temporarily unavailable.');
  }

  private buildConstraints(inputToken: string) {
    return {
      inputToken: { id: inputToken, symbol: inputToken, assetId: ASSET_MAP[inputToken] || '' },
      supportedTokens: Object.entries(ASSET_MAP).map(([symbol, assetId]) => ({ id: symbol, symbol, assetId })),
      maxLeverage: 5,
    };
  }

  private buildPrompt(
    userIntent: string, inputToken: { symbol: string; amount: number },
    constraints: ReturnType<typeof this.buildConstraints>, additionalContext?: string,
    loopCount?: number, initialToken?: string,
  ): string {
    const tokensText = constraints.supportedTokens.map(t => `- ${t.symbol} (${t.assetId})`).join('\n');
    return `You are a DeFi strategy expert. Create a strategy based on user intent.

USER INPUT: "${userIntent}"
Input: ${inputToken.amount} ${inputToken.symbol}
${initialToken ? `Initial token: ${initialToken}` : ''}
${loopCount ? `Loops: ${loopCount}` : ''}
${additionalContext ? `Context: "${additionalContext}"` : ''}

SUPPORTED TOKENS:
${tokensText}

RULES:
1. Only use SUPPLY, BORROW, SWAP, CLAIM_REWARDS operations
2. Agent is always "COFHE"
3. Step sequences: SWAP→SUPPLY, SUPPLY→BORROW, BORROW→SWAP/SUPPLY
4. Step numbers sequential from 1

Return ONLY a JSON array of steps. Format: [{"step":1,"type":"SUPPLY","agent":"COFHE","tokenIn":{"assetId":"...","symbol":"...","amount":100}}]`;
  }

  private extractInputToken(input: string): { inputToken: string; defaultAmount: number } {
    const m = input.match(/(\d+(?:\.\d+)?)\s*(WETH|USDT|USDC|WBTC|DAI|ARB|LINK|UNI|AAVE|ETH)/i);
    const t = input.match(/(WETH|USDT|USDC|WBTC|DAI|ARB|LINK|UNI|AAVE|ETH)/i);
    return { inputToken: (m?.[2] || t?.[1] || 'WETH').toUpperCase(), defaultAmount: m ? parseFloat(m[1]) : 10 };
  }

  private extractLoopCount(input: string): number {
    const m = input.match(/(\d+)\s*(?:x|loops?|times?|iterations?)/i);
    return m ? parseInt(m[1], 10) : 3;
  }

  private extractInitialToken(ctx?: string): string | undefined {
    const m = ctx?.match(/initial\s+token\s+is\s+(WETH|USDT|USDC|ETH)/i);
    return m?.[1]?.toUpperCase();
  }

  private isMaximizeYieldRequest(input: string): boolean {
    const l = input.toLowerCase();
    return l.includes('maximize yield') || l.includes('maximum yield') || l.includes('best yield');
  }

  private async generateMaximizeYieldStrategy(
    userIntent: string, additionalContext?: string, tokenAmount?: number,
  ): Promise<StrategyStepResponseDto[]> {
    const { inputToken, defaultAmount } = this.extractInputToken(userIntent);
    const finalAmount = tokenAmount || defaultAmount;
    const riskLevel = this.extractRiskLevel(userIntent);
    const maxLoops = riskLevel === 'LOW' ? 1 : riskLevel === 'HIGH' ? 5 : 3;
    const best = getBestTemplate(riskLevel, maxLoops);
    if (!best) return this.generateStrategySteps(userIntent, additionalContext, tokenAmount);
    const initialToken = this.extractInitialToken(additionalContext) || inputToken;
    return adaptTemplate(best, initialToken, finalAmount);
  }

  private extractRiskLevel(input: string): 'LOW' | 'MEDIUM' | 'HIGH' {
    const l = input.toLowerCase();
    if (l.includes('low risk') || l.includes('conservative')) return 'LOW';
    if (l.includes('high risk') || l.includes('aggressive')) return 'HIGH';
    return 'MEDIUM';
  }

  private addInitialSwapIfNeeded(steps: StrategyStepResponseDto[], ctx?: string): StrategyStepResponseDto[] {
    const initial = this.extractInitialToken(ctx);
    if (!initial || !steps.length) return steps;
    const firstToken = steps[0].tokenIn?.symbol?.toUpperCase();
    if (!firstToken || initial === firstToken) return steps;
    const swapStep: StrategyStepResponseDto = {
      step: 1, type: 'SWAP', agent: 'COFHE',
      tokenIn: { assetId: ASSET_MAP[initial] || '', symbol: initial, amount: steps[0].tokenIn?.amount || 10 },
      tokenOut: { assetId: ASSET_MAP[firstToken] || '', symbol: firstToken, amount: (steps[0].tokenIn?.amount || 10) * 0.98 },
    };
    return [swapStep, ...steps].map((s, i) => ({ ...s, step: i + 1 }));
  }
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
          const delaySeconds = 2 ** retryCount;

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
    if (iterMatch) return parseInt(iterMatch[1], 10);

    const xMatch = input.match(/(\d+)x/i);
    if (xMatch) return parseInt(xMatch[1], 10);

    const withLoopMatch = input.match(/with\s+(\d+)\s+loops?/i);
    if (withLoopMatch) return parseInt(withLoopMatch[1], 10);

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
    _userIntent: string,
    additionalContext?: string,
  ): StrategyStepResponseDto[] {
    const initialToken = this.extractInitialTokenFromContext(additionalContext);
    if (!initialToken) {
      return steps;
    }

    const firstStepWithToken = steps.find((step) => step.tokenIn?.symbol);

    if (!firstStepWithToken?.tokenIn) {
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
