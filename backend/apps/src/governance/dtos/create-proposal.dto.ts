import { IsString, MinLength, IsObject, IsDateString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateProposalDto {
	@ApiProperty({ example: "Increase WETH collateral factor to 85%" })
	@IsString()
	@MinLength(5)
	title: string;

	@ApiProperty({
		example: "Rationale: utilization has been consistently above 80%...",
	})
	@IsString()
	description: string;

	@ApiProperty({
		description: "JSON payload: parameter changes to execute on-chain",
	})
	@IsObject()
	payload: object;

	@ApiProperty({ example: "2026-06-10T00:00:00Z" })
	@IsDateString()
	endsAt: string;
}
