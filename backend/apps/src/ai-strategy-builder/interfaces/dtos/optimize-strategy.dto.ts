import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, ValidateNested } from "class-validator";
import { StrategyStepResponseDto } from "./strategy-step-response.dto";

export class OptimizeStrategyDto {
	@ApiProperty({
		type: [StrategyStepResponseDto],
		description: "Strategy steps to optimize",
	})
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => StrategyStepResponseDto)
	steps: StrategyStepResponseDto[];
}
