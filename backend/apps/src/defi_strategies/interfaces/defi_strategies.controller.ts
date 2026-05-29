import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Post,
	Put,
	Query,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { DefiStrategiesService } from "../application/defi_strategies.service";
import type { DefiStrategyVersionService } from "../application/defi_strategy_version.service";
import type { DefiSimulationEngine } from "../application/defi-simulation-engine.service";
import type { CreateDefiStrategyDto } from "./dto/create_defi_strategy.dto";
import type { CreateDefiStrategyVersionDto } from "./dto/create_defi_strategy_version.dto";
import type { UpdateDefiStrategyDto } from "./dto/update_defi_strategy.dto";
import type { UpdateDefiStrategyVersionDto } from "./dto/update_defi_strategy_version.dto";
import type { SimulateStrategyDto } from "./dtos/simulate-strategy.dto";

@ApiTags("DeFi Strategies")
@Controller("defi-strategies")
export class DefiStrategiesController {
	constructor(
		private readonly defiStrategyVersionService: DefiStrategyVersionService,
		private readonly defiStrategiesService: DefiStrategiesService,
		private readonly defiSimulationEngine: DefiSimulationEngine,
	) {}

	@ApiOperation({ summary: "Create a new DeFi strategy version" })
	@Post("/versions")
	public async createStrategyVersion(@Body() body: CreateDefiStrategyVersionDto) {
		return this.defiStrategyVersionService.createStrategyVersion(body);
	}

	@ApiOperation({ summary: "Create a new DeFi strategy" })
	@Post()
	public async createStrategy(@Body() body: CreateDefiStrategyDto) {
		return this.defiStrategiesService.create(body);
	}

	@Post("simulate")
	@ApiOperation({ summary: "Simulate a DeFi strategy" })
	async simulate(@Body() dto: SimulateStrategyDto) {
		return this.defiSimulationEngine.simulate(dto.workflow_json, dto.amount_in, {
			slippage_tolerance: dto.slippage_tolerance,
			gas_price: dto.gas_price,
		});
	}

	@Get(":id")
	@ApiOperation({ summary: "Get a DeFi strategy by ID" })
	@ApiParam({ name: "id", description: "The ID of the DeFi strategy" })
	async getById(@Param("id") id: string) {
		return this.defiStrategiesService.getById(id);
	}

	@Get()
	@ApiOperation({
		summary: "Get all DeFi strategies, optionally filtered by owner",
	})
	@ApiQuery({ name: "owner", required: false, type: String })
	async getAll(@Query("owner") owner?: string) {
		return this.defiStrategiesService.getAll(owner);
	}

	@Put(":id")
	@ApiOperation({ summary: "Update a DeFi strategy" })
	@ApiParam({
		name: "id",
		description: "The ID of the DeFi strategy to update",
	})
	public async updateStrategy(@Param("id") id: string, @Body() body: UpdateDefiStrategyDto) {
		return this.defiStrategiesService.update(id, body);
	}

	@Delete(":id")
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({
		summary: "Delete a DeFi strategy and all its versions (cascade delete)",
	})
	@ApiParam({
		name: "id",
		description: "The ID of the DeFi strategy to delete",
	})
	public async deleteStrategy(@Param("id") id: string) {
		return this.defiStrategiesService.delete(id);
	}

	@Put("versions/:id")
	@ApiOperation({ summary: "Update a DeFi strategy version" })
	@ApiParam({
		name: "id",
		description: "The ID of the DeFi strategy version to update",
	})
	public async updateStrategyVersion(
		@Param("id") id: string,
		@Body() body: UpdateDefiStrategyVersionDto,
	) {
		return this.defiStrategyVersionService.update(id, body);
	}

	@Delete("versions/:id")
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: "Delete a DeFi strategy version" })
	@ApiParam({
		name: "id",
		description: "The ID of the DeFi strategy version to delete",
	})
	public async deleteStrategyVersion(@Param("id") id: string) {
		return this.defiStrategyVersionService.delete(id);
	}
}
