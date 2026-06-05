import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { StrategyStepResponseDto } from '../../../ai-strategy-builder/interfaces/dtos/strategy-step-response.dto';
import type { WorkflowJson } from '../../domain/simulation-engine.interface';

class WorkflowStepsDto {
  @ValidateNested({ each: true })
  @Type(() => StrategyStepResponseDto)
  steps: StrategyStepResponseDto[];
}

export class SimulateStrategyDto {
  @ApiProperty({
    description: 'Workflow JSON defining the strategy steps',
  })
  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkflowStepsDto)
  workflow_json: WorkflowJson;

  @ApiProperty({
    description: 'Input amount to simulate',
    example: 1000,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount_in: number;

  @ApiPropertyOptional({
    description: 'Slippage tolerance in percentage',
    example: 0.5,
    default: 0.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  slippage_tolerance?: number;

  @ApiPropertyOptional({
    description: 'Gas price in gwei',
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  gas_price?: number;
}
