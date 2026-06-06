import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { StrategyService } from '../application/strategy.service';

@ApiTags('Strategies')
@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategyService: StrategyService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'List strategies with filters, search, tags, sort, limit',
  })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'tags', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'limit', required: false })
  async find(
    @Query('keyword') keyword?: string,
    @Query('tags') tags?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: 'asc' | 'desc' = 'desc',
    @Query('limit') limit?: number,
  ) {
    const tagList = tags
      ? tags
          .split(',')
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
}
