import { Module } from '@nestjs/common';
import { DefiModulesModule } from '../defi_modules/defi_modules.module';
import { DefiTokenModule } from '../defi_token/defi_token.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { AiStrategyBuilderService } from './application/ai-strategy-builder.service';
import { GasEstimationService } from './application/gas-estimation.service';
import { GeminiAiService } from './application/gemini-ai.service';
import { StrategyConstraintsService } from './application/strategy-constraints.service';
import { StrategyParserService } from './application/strategy-parser.service';
import { StrategyTemplatesService } from './application/strategy-templates.service';
import { StrategyValidatorService } from './application/strategy-validator.service';
import { AiStrategyBuilderController } from './interfaces/ai-strategy-builder.controller';

@Module({
  imports: [DefiModulesModule, DefiTokenModule, StrategiesModule],
  controllers: [AiStrategyBuilderController],
  providers: [
    AiStrategyBuilderService,
    StrategyParserService,
    StrategyValidatorService,
    GeminiAiService,
    StrategyConstraintsService,
    StrategyTemplatesService,
    GasEstimationService,
  ],
  exports: [
    AiStrategyBuilderService,
    GeminiAiService,
    StrategyConstraintsService,
    StrategyTemplatesService,
    GasEstimationService,
  ],
})
export class AiStrategyBuilderModule {}
