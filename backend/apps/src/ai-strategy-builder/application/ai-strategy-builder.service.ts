import { Injectable } from '@nestjs/common';
import type { BuildStrategyDto } from '../interfaces/dtos/build-strategy.dto';
import type { GeminiAiService } from './gemini-ai.service';

@Injectable()
export class AiStrategyBuilderService {
  constructor(private readonly geminiAi: GeminiAiService) {}

  async buildStrategy(dto: BuildStrategyDto) {
    const steps = await this.geminiAi.generateStrategySteps(
      dto.userIntent,
      dto.additionalContext,
      dto.tokenAmount,
    );
    const validation = this.geminiAi.validateSteps(steps);
    let aiAnalysis: { riskFactors: string[]; recommendations: string[] } | undefined;
    try {
      aiAnalysis = await this.geminiAi.analyzeStrategyRisk(steps);
    } catch {
      /* non-critical */
    }
    const riskLevel = aiAnalysis
      ? aiAnalysis.riskFactors.length === 0
        ? 'LOW'
        : aiAnalysis.riskFactors.length >= 3
          ? 'HIGH'
          : 'MEDIUM'
      : steps.filter((s) => s.type === 'BORROW').length / steps.length > 0.4
        ? 'HIGH'
        : 'MEDIUM';
    const estimatedGas = steps.reduce((sum, s) => sum + this.geminiAi.estimateGas(s.type), 0);
    return {
      steps,
      validation: validation || {
        isValid: false,
        errors: ['Validation failed'],
        warnings: [],
      },
      metadata: {
        totalSteps: steps.length,
        estimatedGas,
        riskLevel,
        aiGenerated: true,
      },
      aiAnalysis: aiAnalysis || { riskFactors: [], recommendations: [] },
    };
  }
}
