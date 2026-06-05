import { Injectable, Logger } from '@nestjs/common';
import type { MarketsService } from '../markets/markets.service';
import type { SupabaseService } from '../shared/infrastructure/supabase.service';
import type { StatsResponseDto } from './dtos/stats-response.dto';

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);
  private cache: { data: StatsResponseDto; expiresAt: number } | null = null;

  constructor(
    private readonly marketsService: MarketsService,
    private readonly supabase: SupabaseService,
  ) {}

  async getProtocolStats(): Promise<StatsResponseDto> {
    if (this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.data;
    }

    const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

    const [markets, totalUsers, activeStrategies, totalDeployments] = await Promise.all([
      withTimeout(this.marketsService.getAllMarkets(), 5_000, []),
      withTimeout(this.countRows('users'), 5_000, null),
      withTimeout(
        this.countRows('defi_strategies', {
          column: 'is_public',
          value: true,
        }),
        5_000,
        null,
      ),
      withTimeout(this.countRows('defi_strategy_executions'), 5_000, null),
    ]);

    const poolTvls = Object.fromEntries(markets.map((market) => [market.asset, market.tvl]));
    const liveTvlValues = markets
      .map((market) => market.tvl)
      .filter((value): value is number => value !== null);
    const tvlUsd =
      markets.length > 0 && liveTvlValues.length === markets.length
        ? liveTvlValues.reduce((sum, tvl) => sum + tvl, 0)
        : null;

    const missingFields = [
      tvlUsd === null ? 'tvlUsd' : null,
      totalUsers === null ? 'totalUsers' : null,
      markets.length === 0 ? 'activeMarkets' : null,
      activeStrategies === null ? 'activeStrategies' : null,
      'encryptedOps',
      'permitDecryptsDay',
      totalDeployments === null ? 'totalDeployments' : null,
    ].filter((field): field is string => field !== null);

    const data: StatsResponseDto = {
      tvlUsd,
      totalUsers,
      activeMarkets: markets.length > 0 ? markets.length : null,
      activeStrategies,
      encryptedOps: null,
      permitDecryptsDay: null,
      totalDeployments,
      poolTvls,
      status: missingFields.length === 0 ? 'live' : 'partial',
      missingFields,
    };

    this.cache = { data, expiresAt: Date.now() + 300_000 };
    return data;
  }

  private async countRows(
    table: string,
    filter?: { column: string; value: string | number | boolean },
  ): Promise<number | null> {
    try {
      let query = this.supabase
        .getClient()
        .from(table)
        .select('id', { count: 'exact', head: true });

      if (filter) {
        query = query.eq(filter.column, filter.value);
      }

      const { count, error } = await query;
      if (error) {
        this.logger.warn(`Unable to count ${table}: ${error.message}`);
        return null;
      }
      return count ?? 0;
    } catch (error) {
      this.logger.warn(`Unable to count ${table}: ${(error as Error).message}`);
      return null;
    }
  }
}
