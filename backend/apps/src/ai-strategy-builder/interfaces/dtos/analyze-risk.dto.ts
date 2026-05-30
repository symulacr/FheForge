import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { StrategyStepResponseDto } from './strategy-step-response.dto';

export class AnalyzeRiskDto {
  @ApiProperty({
    type: [StrategyStepResponseDto],
    description: 'Strategy steps to analyze for risk',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StrategyStepResponseDto)
  steps: StrategyStepResponseDto[];
}
