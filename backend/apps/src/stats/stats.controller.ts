import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { StatsResponseDto } from './dtos/stats-response.dto';
import type { StatsService } from './stats.service';

@ApiTags('Stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get protocol statistics' })
  @ApiResponse({
    status: 200,
    description: 'Protocol stats',
    type: StatsResponseDto,
  })
  async getStats(): Promise<StatsResponseDto> {
    return this.statsService.getProtocolStats();
  }
}
