import { Controller, Get } from '@nestjs/common';
import { FhenixStrategyService } from './shared/infrastructure/fhenix-strategy.service';

@Controller()
export class AppController {
  constructor(private readonly fhenixStrategy: FhenixStrategyService) {}

  @Get('health')
  async health() {
    const status = await this.fhenixStrategy.getNetworkStatus();
    return { ...status, status: 'ok', chain: 'arb-sepolia', chainId: 421614 };
  }
}
