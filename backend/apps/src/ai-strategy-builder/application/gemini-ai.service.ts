import { type GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
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
  SWAP: 150000,
  SUPPLY: 100000,
  BORROW: 120000,
  CLAIM_REWARDS: 80000,
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
  {
    id: 'simple-supply-usdc',
    riskLevel: 'LOW' as const,
    loopCount: 0,
    apy: 5.2,
    steps: [
      {
        step: 1,
        type: 'SUPPLY' as const,
        agent: 'COFHE',
        tokenIn: {
          assetId: process.env.TOKEN_USDC || '',
          symbol: 'USDC',
          amount: 100,
        },
      },
    ],
  },
  {
    id: 'usdc-weth-leverage-2x',
    riskLevel: 'MEDIUM' as const,
    loopCount: 2,
    apy: 12.8,
    steps: [
      {
        step: 1,
        type: 'SUPPLY' as const,
        agent: 'COFHE',
        tokenIn: {
          assetId: process.env.TOKEN_USDC || '',
          symbol: 'USDC',
          amount: 100,
        },
      },
      {
        step: 2,
        type: 'BORROW' as const,
        agent: 'COFHE',
        tokenOut: {
          assetId: process.env.TOKEN_WETH || '',
          symbol: 'WETH',
          amount: 70,
        },
      },
      {
        step: 3,
        type: 'SUPPLY' as const,
        agent: 'COFHE',
        tokenIn: {
          assetId: process.env.TOKEN_WETH || '',
          symbol: 'WETH',
          amount: 70,
        },
      },
      {
        step: 4,
        type: 'BORROW' as const,
        agent: 'COFHE',
        tokenOut: {
          assetId: process.env.TOKEN_USDC || '',
          symbol: 'USDC',
          amount: 49,
        },
      },
    ],
  },
  {
    id: 'usdc-weth-leverage-3x',
    riskLevel: 'MEDIUM' as const,
    loopCount: 3,
    apy: 18.5,
    steps: [
      {
        step: 1,
        type: 'SUPPLY' as const,
        agent: 'COFHE',
        tokenIn: {
          assetId: process.env.TOKEN_USDC || '',
          symbol: 'USDC',
          amount: 100,
        },
      },
      {
        step: 2,
        type: 'BORROW' as const,
        agent: 'COFHE',
        tokenOut: {
          assetId: process.env.TOKEN_WETH || '',
          symbol: 'WETH',
          amount: 70,
        },
      },
      {
        step: 3,
        type: 'SUPPLY' as const,
        agent: 'COFHE',
        tokenIn: {
          assetId: process.env.TOKEN_WETH || '',
          symbol: 'WETH',
          amount: 70,
        },
      },
      {
        step: 4,
        type: 'BORROW' as const,
        agent: 'COFHE',
        tokenOut: {
          assetId: process.env.TOKEN_USDC || '',
          symbol: 'USDC',
          amount: 49,
        },
      },
      {
        step: 5,
        type: 'SUPPLY' as const,
        agent: 'COFHE',
        tokenIn: {
          assetId: process.env.TOKEN_USDC || '',
          symbol: 'USDC',
          amount: 49,
        },
      },
      {
        step: 6,
        type: 'BORROW' as const,
        agent: 'COFHE',
        tokenOut: {
          assetId: process.env.TOKEN_WETH || '',
          symbol: 'WETH',
          amount: 34,
        },
      },
    ],
  },
  {
    id: 'aggressive-leverage-5x',
    riskLevel: 'HIGH' as const,
    loopCount: 5,
    apy: 28.7,
    steps: [
      {
        step: 1,
        type: 'SUPPLY' as const,
        agent: 'COFHE',
        tokenIn: {
          assetId: process.env.TOKEN_USDC || '',
          symbol: 'USDC',
          amount: 100,
        },
      },
    ],
  },
];

function getBestTemplate(riskLevel?: string, maxLoops?: number) {
  let filtered = TEMPLATES;
  if (riskLevel) filtered = filtered.filter((t) => t.riskLevel === riskLevel);
  if (maxLoops !== undefined) filtered = filtered.filter((t) => t.loopCount <= maxLoops);
  return filtered.sort((a, b) => b.apy - a.apy)[0] || null;
}

function adaptTemplate(
  template: (typeof TEMPLATES)[number],
  token: string,
  amount: number,
): StrategyStepResponseDto[] {
  return (template.steps as StrategyStepResponseDto[]).map((s, i) => {
    const step: StrategyStepResponseDto = { ...s, step: i + 1 };
    if (step.tokenIn)
      step.tokenIn = {
        ...step.tokenIn,
        assetId: ASSET_MAP[token] || '',
        symbol: token,
        amount,
      };
    if (step.tokenOut) step.tokenOut = { ...step.tokenOut, amount: Math.round(amount * 0.7) };
    return step;
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as Record<string, unknown>).status)
    : undefined;
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
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });
  }

  private requireModel() {
    if (!this.model) throw new Error('AI strategy builder disabled — GEMINI_API_KEY not set');
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  async generateStrategySteps(
    userIntent: string,
    additionalContext?: string,
    tokenAmount?: number,
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
    const prompt = this.buildPrompt(
      userIntent,
      { symbol: inputToken, amount: finalAmount },
      constraints,
      additionalContext,
      loopCount,
      initialToken,
    );
    return this.callGeminiWithRetry(prompt, userIntent, additionalContext);
  }

  async analyzeStrategyRisk(steps: StrategyStepResponseDto[]): Promise<{
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    riskFactors: string[];
    recommendations: string[];
  }> {
    this.requireModel();
    const prompt = `Analyze the risk level of this DeFi strategy:\n${JSON.stringify(steps, null, 2)}\n\nReturn JSON: {"riskLevel":"LOW|MEDIUM|HIGH","riskFactors":[],"recommendations":[]}`;
    try {
      const text = await this.callGemini(prompt);
      return JSON.parse(text) as {
        riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
        riskFactors: string[];
        recommendations: string[];
      };
    } catch (error) {
      this.logger.error('Risk analysis error', error);
      const borrowSteps = steps.filter((s) => s.type === 'BORROW').length;
      return {
        riskLevel: borrowSteps > 5 ? 'HIGH' : borrowSteps > 2 ? 'MEDIUM' : 'LOW',
        riskFactors: ['Unable to perform detailed risk analysis'],
        recommendations: ['Review strategy manually', 'Start with smaller amounts'],
      };
    }
  }

  async optimizeStrategy(steps: StrategyStepResponseDto[]): Promise<{
    optimizedSteps: StrategyStepResponseDto[];
    optimizations: string[];
  }> {
    this.requireModel();
    const prompt = `Optimize this DeFi strategy for efficiency:\n${JSON.stringify(steps, null, 2)}\n\nReturn JSON: {"optimizedSteps":[],"optimizations":[]}`;
    try {
      const text = await this.callGemini(prompt);
      return JSON.parse(text) as {
        optimizedSteps: StrategyStepResponseDto[];
        optimizations: string[];
      };
    } catch (error) {
      this.logger.error('Strategy optimization error', error);
      return {
        optimizedSteps: steps,
        optimizations: ['Unable to optimize automatically'],
      };
    }
  }

  estimateGas(stepType: string): number {
    return GAS_ESTIMATES[stepType] ?? DEFAULT_GAS;
  }

  validateSteps(steps: StrategyStepResponseDto[]): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.type || !step.agent) {
        errors.push(`Step ${i + 1}: Missing required fields`);
        continue;
      }
      if (!VALID_STEP_TYPES.has(step.type)) {
        errors.push(`Step ${i + 1}: Invalid operation type '${step.type}'`);
        continue;
      }
      if (step.tokenIn?.amount !== undefined && step.tokenIn.amount <= 0)
        errors.push(`Step ${i + 1}: Invalid tokenIn amount`);
      if (step.tokenOut?.amount !== undefined && step.tokenOut.amount <= 0)
        errors.push(`Step ${i + 1}: Invalid tokenOut amount`);
      if (i > 0) {
        const prev = steps[i - 1].type;
        const valid: Record<string, string[]> = {
          SWAP: ['SUPPLY', 'SWAP'],
          SUPPLY: ['BORROW'],
          BORROW: ['SWAP', 'SUPPLY', 'BORROW'],
        };
        if (valid[prev] && !valid[prev].includes(step.type))
          warnings.push(`Step ${i + 1}: Unusual sequence ${prev} → ${step.type}`);
      }
    }
    if (!steps.some((s) => s.type === 'SUPPLY')) warnings.push('Strategy has no supply steps');
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
    prompt: string,
    _userIntent: string,
    additionalContext?: string,
  ): Promise<StrategyStepResponseDto[]> {
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: unknown;
    while (retryCount <= maxRetries) {
      try {
        const text = await this.callGemini(prompt);
        let steps = JSON.parse(text) as StrategyStepResponseDto[];
        if (!Array.isArray(steps) || !steps.length) throw new Error('Invalid strategy steps');
        steps = steps.filter((s) => VALID_STEP_TYPES.has(s.type));
        steps = this.addInitialSwapIfNeeded(steps, additionalContext);
        return steps;
      } catch (error) {
        lastError = error;
        const isRateLimit = getErrorStatus(error) === 429 || getErrorMessage(error).includes('429');
        if (isRateLimit && retryCount < maxRetries) {
          await new Promise((r) => setTimeout(r, 2 ** retryCount * 1000));
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
    if (status === 429 || msg.includes('429'))
      throw new GeminiRateLimitException('Rate limit exceeded.');
    if (status === 401 || msg.includes('API key'))
      throw new GeminiAuthException('API authentication failed.');
    if (status === 403 || msg.includes('quota'))
      throw new GeminiQuotaException('API quota exceeded.');
    if (msg.includes('timeout')) throw new GeminiApiException('Request timeout.', 408);
    if (msg.includes('parse') || msg.includes('empty') || msg.includes('JSON'))
      throw new GeminiParsingException('AI response parsing failed.');
    throw new GeminiApiException('AI service temporarily unavailable.');
  }

  private buildConstraints(inputToken: string) {
    return {
      inputToken: {
        id: inputToken,
        symbol: inputToken,
        assetId: ASSET_MAP[inputToken] || '',
      },
      supportedTokens: Object.entries(ASSET_MAP).map(([symbol, assetId]) => ({
        id: symbol,
        symbol,
        assetId,
      })),
      maxLeverage: 5,
    };
  }

  private buildPrompt(
    userIntent: string,
    inputToken: { symbol: string; amount: number },
    constraints: ReturnType<typeof this.buildConstraints>,
    additionalContext?: string,
    loopCount?: number,
    initialToken?: string,
  ): string {
    const tokensText = constraints.supportedTokens
      .map((t) => `- ${t.symbol} (${t.assetId})`)
      .join('\n');
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

  private extractInputToken(input: string): {
    inputToken: string;
    defaultAmount: number;
  } {
    const m = input.match(/(\d+(?:\.\d+)?)\s*(WETH|USDT|USDC|WBTC|DAI|ARB|LINK|UNI|AAVE|ETH)/i);
    const t = input.match(/(WETH|USDT|USDC|WBTC|DAI|ARB|LINK|UNI|AAVE|ETH)/i);
    return {
      inputToken: (m?.[2] || t?.[1] || 'WETH').toUpperCase(),
      defaultAmount: m ? parseFloat(m[1]) : 10,
    };
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
    userIntent: string,
    additionalContext?: string,
    tokenAmount?: number,
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

  private addInitialSwapIfNeeded(
    steps: StrategyStepResponseDto[],
    ctx?: string,
  ): StrategyStepResponseDto[] {
    const initial = this.extractInitialToken(ctx);
    if (!initial || !steps.length) return steps;
    const firstToken = steps[0].tokenIn?.symbol?.toUpperCase();
    if (!firstToken || initial === firstToken) return steps;
    const swapStep: StrategyStepResponseDto = {
      step: 1,
      type: 'SWAP',
      agent: 'COFHE',
      tokenIn: {
        assetId: ASSET_MAP[initial] || '',
        symbol: initial,
        amount: steps[0].tokenIn?.amount || 10,
      },
      tokenOut: {
        assetId: ASSET_MAP[firstToken] || '',
        symbol: firstToken,
        amount: (steps[0].tokenIn?.amount || 10) * 0.98,
      },
    };
    return [swapStep, ...steps].map((s, i) => ({ ...s, step: i + 1 }));
  }
}
