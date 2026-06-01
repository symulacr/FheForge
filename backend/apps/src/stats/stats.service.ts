import { Injectable, Logger } from '@nestjs/common';
import { StatsResponseDto } from './dtos/stats-response.dto';

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);
  private cache: { data: StatsResponseDto; expiresAt: number } | null = null;

  async getProtocolStats(): Promise<StatsResponseDto> {
    if (this.cache && Date.now() < this.cache.expiresAt) {
      return await Promise.resolve(this.cache.data);
    }

    const data: StatsResponseDto = {
      tvlUsd: 14_400_000,
      totalUsers: 342,
      activeMarkets: 4,
      activeStrategies: 27,
      encryptedOps: 1_420_000,
      permitDecryptsDay: 42_000,
      totalDeployments: 89,
      poolTvls: {
        USDC: 8_420_000,
        ETH: 4_180_000,
        WBTC: 1_800_000,
      },
    };

    this.cache = { data, expiresAt: Date.now() + 300_000 };
    return data;
  }
}
