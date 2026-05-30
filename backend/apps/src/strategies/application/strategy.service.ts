import { Injectable } from '@nestjs/common';
import { FhenixStrategyService } from '../../shared/infrastructure/fhenix-strategy.service';
import { Strategy } from '../domain/strategies.entity';
import { StrategiesRepository } from '../domain/strategies.repository';
import { StrategyMapper } from './mappers/strategy.mapper';
import { RewardsService } from './rewards.service';

@Injectable()
export class StrategyService {
  constructor(
    private readonly strategiesRepo: StrategiesRepository,
    readonly _rewards: RewardsService,
    readonly _fhenixStrategy: FhenixStrategyService,
  ) {}

  async create(dto: {
    strategistName: string;
    apy: number;
    tags?: string[];
    strategistHandle?: string;
    assets?: string[];
    agents?: string[];
    chains?: string[];
  }): Promise<Strategy> {
    const id = this.generateId();
    const strategy = new Strategy(
      id,
      dto.strategistName,
      dto.apy,
      dto.tags ?? [],
      dto.strategistHandle,
      dto.assets ?? [],
      dto.agents ?? [],
      dto.chains ?? [],
    );
    await this.strategiesRepo.save(strategy);
    return strategy;
  }

  async findById(id: string): Promise<Strategy> {
    const found = await this.strategiesRepo.findById(id);
    if (!found) throw new Error('Strategy not found');
    return found;
  }

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
    const { data, total } =
      await this.strategiesRepo.findAllWithFilters(params);

    const filters: { keyword?: string; tags?: string[] } = {};
    if (params.keyword) filters.keyword = params.keyword;
    if (params.tags?.length) filters.tags = params.tags;

    return {
      filters,
      activeFiltersCount: Object.keys(filters).length,
      data: data.map((s) => StrategyMapper.toResponse(s)),
      meta: { total, limit: params.limit },
    };
  }

  async update(
    id: string,
    fields: Partial<{
      strategistName: string;
      apy: number;
      tags: string[];
      strategistHandle?: string;
      assets: string[];
      agents: string[];
      chains: string[];
    }>,
  ): Promise<Strategy> {
    const strategy = await this.findById(id);
    strategy.update(fields);
    await this.strategiesRepo.save(strategy);
    return strategy;
  }

  async deleteById(id: string): Promise<void> {
    await this.strategiesRepo.deleteById(id);
  }

  private generateId(): string {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }
}
