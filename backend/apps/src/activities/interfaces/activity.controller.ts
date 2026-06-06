import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActivityService } from '../application/activity.service';
import { toActivityResponseList } from '../application/mappers/activity.mapper';
import { ActivityResponseDto } from './dtos/activity-response.dto';

@ApiTags('Activities')
@Controller('activities')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  @ApiOperation({ summary: 'Get activities with filters and pagination' })
  @ApiQuery({ name: 'strategyId', required: false, description: 'Strategy ID' })
  @ApiQuery({
    name: 'userAddress',
    required: false,
    description: 'Wallet address of user',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default = 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default = 10)',
  })
  async find(
    @Query('strategyId') strategyId?: string,
    @Query('userAddress') userAddress?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
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
    return { data: toActivityResponseList(data), meta };
  }
}
