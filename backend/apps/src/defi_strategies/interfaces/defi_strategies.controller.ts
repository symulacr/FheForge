import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { DefiStrategiesService } from '../application/defi_strategies.service';
import { DefiSimulationEngine } from '../application/defi-simulation-engine.service';
import type { CreateDefiStrategyDto } from './dto/create_defi_strategy.dto';
import type { SimulateStrategyDto } from './dtos/simulate-strategy.dto';

@ApiTags('DeFi Strategies')
@Controller('defi-strategies')
export class DefiStrategiesController {
  constructor(
    private readonly defiStrategiesService: DefiStrategiesService,
    private readonly defiSimulationEngine: DefiSimulationEngine,
  ) {}

  @ApiOperation({ summary: 'Create a new DeFi strategy' })
  @Post()
  public async createStrategy(@Body() body: CreateDefiStrategyDto) {
    return this.defiStrategiesService.create(body);
  }

  @Post('simulate')
  @ApiOperation({ summary: 'Simulate a DeFi strategy' })
  async simulate(@Body() dto: SimulateStrategyDto) {
    return this.defiSimulationEngine.simulate(dto.workflow_json, dto.amount_in, {
      slippage_tolerance: dto.slippage_tolerance,
      gas_price: dto.gas_price,
    });
  }

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get all DeFi strategies, optionally filtered by owner',
  })
  @ApiQuery({ name: 'owner', required: false, type: String })
  async getAll(@Query('owner') owner?: string) {
    return this.defiStrategiesService.getAll(owner);
  }
}
