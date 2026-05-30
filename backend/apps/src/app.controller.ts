import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';
import { FhenixStrategyService } from './shared/infrastructure/fhenix-strategy.service';

@Controller()
export class AppController {
  constructor(private readonly fhenixStrategy: FhenixStrategyService) {}
  private healthCache: {
    data: Record<string, unknown>;
    expiresAt: number;
  } | null = null;

  @Public()
  @Get('health')
  async health() {
    const now = Date.now();
    if (this.healthCache && now < this.healthCache.expiresAt) {
      return this.healthCache.data;
    }
    const status = await this.fhenixStrategy.getNetworkStatus();
    const data = {
      ...status,
      status: 'ok',
      chain: 'arb-sepolia',
      chainId: 421614,
    };
    this.healthCache = { data, expiresAt: now + 30_000 };
    return data;
  }
}
