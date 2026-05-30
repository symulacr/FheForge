import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GeminiAiService } from '../application/gemini-ai.service';
import type { AnalyzeRiskDto } from './dtos/analyze-risk.dto';
import type { OptimizeStrategyDto } from './dtos/optimize-strategy.dto';

@ApiTags('AI Strategy Builder - Advanced')
@Controller('ai-strategy-builder/advanced')
@Throttle({ default: { ttl: 60000, limit: 5 } })
export class AiStrategyBuilderAdvancedController {
  constructor(private readonly geminiAi: GeminiAiService) {}

  @Post('analyze-risk')
  @ApiOperation({
    summary: 'Analyze strategy risk using Gemini AI',
    description:
      'Get detailed risk analysis and recommendations for a strategy',
  })
  @ApiResponse({
    status: 201,
    description: 'Risk analysis completed',
  })
  async analyzeRisk(@Body() dto: AnalyzeRiskDto) {
    return this.geminiAi.analyzeStrategyRisk(dto.steps);
  }

  @Post('optimize')
  @ApiOperation({
    summary: 'Optimize strategy using Gemini AI',
    description: 'Get optimized version of strategy with improvements',
  })
  @ApiResponse({
    status: 201,
    description: 'Strategy optimization completed',
  })
  async optimizeStrategy(@Body() dto: OptimizeStrategyDto) {
    return this.geminiAi.optimizeStrategy(dto.steps);
  }
}
