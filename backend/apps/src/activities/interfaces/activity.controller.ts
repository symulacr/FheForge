import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ActivityService } from "../application/activity.service";
import { ActivityMapper } from "../application/mappers/activity.mapper";
import { ActivityResponseDto } from "./dtos/activity-response.dto";
import type { CreateActivityDto } from "./dtos/create-activity.dto";
import type { UpdateActivityProgressDto } from "./dtos/update-activity-progress.dto";

@ApiTags("Activities")
@Controller("activities")
export class ActivityController {
	constructor(private readonly activityService: ActivityService) {}

	@Get("all")
	@ApiOperation({ summary: "Get all transaction history (activities)" })
	@ApiResponse({
		status: 200,
		description: "List of all activities",
		type: [ActivityResponseDto],
	})
	async findAll(): Promise<ActivityResponseDto[]> {
		const activities = await this.activityService.findAll();
		return ActivityMapper.toResponseList(activities);
	}

	@Get()
	@ApiOperation({ summary: "Get activities with filters and pagination" })
	@ApiQuery({ name: "strategyId", required: false, description: "Strategy ID" })
	@ApiQuery({
		name: "userAddress",
		required: false,
		description: "Wallet address of user",
	})
	@ApiQuery({
		name: "page",
		required: false,
		description: "Page number (default = 1)",
	})
	@ApiQuery({
		name: "limit",
		required: false,
		description: "Items per page (default = 10)",
	})
	async find(
		@Query("strategyId") strategyId?: string,
		@Query("userAddress") userAddress?: string,
		@Query("page") page = 1,
		@Query("limit") limit = 10,
	): Promise<{
		data: ActivityResponseDto[];
		meta: { page: number; limit: number; total: number; totalPages: number };
	}> {
		const { data, meta } = await this.activityService.findWithPagination(
			strategyId,
			userAddress,
			Number(page),
			Number(limit),
		);
		return { data: ActivityMapper.toResponseList(data), meta };
	}

	@Post()
	@ApiOperation({ summary: "Create new activity" })
	@ApiResponse({
		status: 201,
		description: "Activity created",
		type: ActivityResponseDto,
	})
	async createActivity(@Body() dto: CreateActivityDto): Promise<ActivityResponseDto> {
		const activity = await this.activityService.create(dto);
		return ActivityMapper.toResponse(activity);
	}

	@Put("progress/:id")
	@ApiOperation({
		summary: "Resume or continue activity progress from a failed step",
	})
	@ApiParam({ name: "id", description: "Activity ID (UUID)" })
	@ApiResponse({
		status: 200,
		description: "Progress updated",
		type: ActivityResponseDto,
	})
	async resumeProgress(
		@Param("id") id: string,
		@Body() dto: UpdateActivityProgressDto,
	): Promise<ActivityResponseDto> {
		const updated = await this.activityService.updateProgress(id, dto);
		return ActivityMapper.toResponse(updated);
	}
}
