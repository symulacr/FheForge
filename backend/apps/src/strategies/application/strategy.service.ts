import { Injectable } from '@nestjs/common';
import { FhenixStrategyService } from '../../shared/infrastructure/fhenix-strategy.service';
import { Strategy } from '../domain/strategies.entity';
import { StrategiesRepository } from '../domain/strategies.repository';
import { toStrategyResponse } from './mappers/strategy.mapper';

@Injectable()
export class StrategyService {
  constructor(
    private readonly strategiesRepo: StrategiesRepository,
    readonly _fhenixStrategy: FhenixStrategyService,
  ) {}

  async findAll(
    sortBy?: string,
    order: 'asc' | 'desc' = 'desc',
    limit?: number,
  ): Promise<Strategy[]> {
    return this.strategiesRepo.findAll(sortBy, order, limit);
  }

  async findAllWithFilters(params: {
    keyword?: string;
    tags?: string[];
    sortBy?: string;
    order?: 'asc' | 'desc';
    limit?: number;
  }) {
    const { data, total } = await this.strategiesRepo.findAllWithFilters(params);

    const filters: { keyword?: string; tags?: string[] } = {};
    if (params.keyword) filters.keyword = params.keyword;
    if (params.tags?.length) filters.tags = params.tags;

    return {
      filters,
      activeFiltersCount: Object.keys(filters).length,
      data: data.map((s) => toStrategyResponse(s)),
      meta: { total, limit: params.limit },
    };
  }
}
