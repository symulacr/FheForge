import { Module } from '@nestjs/common';
import { AiStrategyBuilderService } from './application/ai-strategy-builder.service';
import { GeminiAiService } from './application/gemini-ai.service';
import { AiStrategyBuilderAdvancedController } from './interfaces/ai-strategy-builder-advanced.controller';
import { AiStrategyBuilderController } from './interfaces/ai-strategy-builder.controller';

@Module({
  controllers: [
    AiStrategyBuilderController,
    AiStrategyBuilderAdvancedController,
  ],
  providers: [
    AiStrategyBuilderService,
    GeminiAiService,
  ],
})
export class AiStrategyBuilderModule {}
