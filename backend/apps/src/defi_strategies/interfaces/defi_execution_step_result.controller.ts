import { Body, Controller, Post } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import type { DefiExecutionStepResultService } from "../application/defi_execution_step_result.service";
import type { CreateExecutionStepResultDto } from "./dto/create_execution_step_result.dto";

@Controller("defi-execution-step-results")
export class DefiExecutionStepResultController {
	constructor(private readonly defiExecutionStepResultService: DefiExecutionStepResultService) {}

	@Post()
	@ApiOperation({ summary: "Create a new DeFi execution step result" })
	async create(@Body() body: CreateExecutionStepResultDto) {
		return this.defiExecutionStepResultService.createExecStepResult(body);
	}
}
