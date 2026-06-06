import { Controller, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';

@ApiTags('Lending')
@Controller('lending/positions')
export class LendingController {
  private readonly logger = new Logger(LendingController.name);

  /**
   * Return positions close to the liquidation threshold.
   *
   * Because all balances are FHE-encrypted on-chain, the backend cannot
   * directly read health factors.  This endpoint returns an empty list for
   * now; the frontend already shows "no positions near liquidation" when
   * the array is empty.
   *
   * TODO: Wire up event-indexer + CoFHE reveal flow to populate real data.
   */
  @Public()
  @Post('liquidation-targets')
  @ApiOperation({ summary: 'List positions near liquidation threshold' })
  @ApiResponse({ status: 200, description: 'Array of liquidation targets (empty when none detected)' })
  async getLiquidationTargets(): Promise<unknown[]> {
    this.logger.debug('liquidation-targets requested (stub — returning empty)');
    return [];
  }
}
