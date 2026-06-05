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
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../auth/public.decorator";
import { toStrategyResponse } from "../application/mappers/strategy.mapper";
import type { StrategyService } from "../application/strategy.service";
import type { CreateStrategyDto } from "./dtos/create-strategy.dto";
import { StrategyResponseDto } from "./dtos/strategy-response.dto";
import type { UpdateStrategyDto } from "./dtos/update-strategy.dto";

@ApiTags("Strategies")
@Controller("strategies")
export class StrategiesController {
	constructor(private readonly strategyService: StrategyService) {}

	@Post()
	@ApiOperation({ summary: "Create a new strategy" })
	@ApiResponse({
		status: 201,
		description: "Strategy created",
		type: StrategyResponseDto,
	})
	@HttpCode(HttpStatus.CREATED)
	async create(@Body() dto: CreateStrategyDto): Promise<StrategyResponseDto> {
		const created = await this.strategyService.create(dto);
		return toStrategyResponse(created);
	}

	@Public()
	@Get(":id")
	@ApiOperation({ summary: "Get strategy by ID" })
	@ApiParam({ name: "id", description: "Strategy ID" })
	@ApiResponse({
		status: 200,
		description: "Strategy found",
		type: StrategyResponseDto,
	})
	async findById(@Param("id") id: string): Promise<StrategyResponseDto> {
		const found = await this.strategyService.findById(id);
		return toStrategyResponse(found);
	}

	@Public()
	@Get()
	@ApiOperation({
		summary: "List strategies with filters, search, tags, sort, limit",
	})
	@ApiQuery({ name: "keyword", required: false })
	@ApiQuery({ name: "tags", required: false })
	@ApiQuery({ name: "sortBy", required: false })
	@ApiQuery({ name: "order", required: false, enum: ["asc", "desc"] })
	@ApiQuery({ name: "limit", required: false })
	async find(
		@Query("keyword") keyword?: string,
		@Query("tags") tags?: string,
		@Query("sortBy") sortBy?: string,
		@Query("order") order: "asc" | "desc" = "desc",
		@Query("limit") limit?: number,
	) {
		const tagList = tags
			? tags
					.split(",")
					.map((t) => t.trim())
					.filter((t) => t.length > 0)
			: undefined;

		return this.strategyService.findAllWithFilters({
			keyword,
			tags: tagList,
			sortBy,
			order,
			limit: limit ? Number(limit) : undefined,
		});
	}

	@Put(":id")
	@ApiOperation({ summary: "Update a strategy by ID" })
	@ApiParam({ name: "id", description: "Strategy ID" })
	@ApiResponse({
		status: 200,
		description: "Strategy updated",
		type: StrategyResponseDto,
	})
	async update(
		@Param("id") id: string,
		@Body() dto: UpdateStrategyDto,
	): Promise<StrategyResponseDto> {
		const updated = await this.strategyService.update(id, dto);
		return toStrategyResponse(updated);
	}

	@Delete(":id")
	@ApiOperation({ summary: "Delete a strategy by ID" })
	@ApiParam({ name: "id", description: "Strategy ID" })
	@ApiResponse({ status: 204, description: "Strategy deleted" })
	@HttpCode(HttpStatus.NO_CONTENT)
	async delete(@Param("id") id: string): Promise<void> {
		await this.strategyService.deleteById(id);
	}
}
