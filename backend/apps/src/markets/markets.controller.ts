import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { MarketsService } from './markets.service';
import { MarketResponseDto } from './dtos/market-response.dto';
import { PriceResponseDto } from './dtos/price-response.dto';

@ApiTags('Markets')
@Controller('markets')
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all lending markets' })
  @ApiResponse({ status: 200, description: 'List of markets', type: [MarketResponseDto] })
  async getAllMarkets(): Promise<MarketResponseDto[]> {
    return this.marketsService.getAllMarkets();
  }

  @Public()
  @Get('prices')
  @ApiOperation({ summary: 'Get oracle prices for all assets' })
  @ApiResponse({ status: 200, description: 'List of prices', type: [PriceResponseDto] })
  async getPrices(): Promise<PriceResponseDto[]> {
    return this.marketsService.getPrices();
  }
}
