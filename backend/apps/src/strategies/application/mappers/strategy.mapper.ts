import type { Strategy } from '../../domain/strategies.entity';
import type { StrategyResponseDto } from '../../interfaces/dtos/strategy-response.dto';

export function toStrategyResponse(entity: Strategy): StrategyResponseDto {
  return {
    id: entity.id,
    strategistName: entity.strategistName,
    strategistHandle: entity.strategistHandle,
    apy: entity.apy,
    tags: entity.tags,
    assets: entity.assets,
    agents: entity.agents,
    chains: entity.chains,
  };
}

export function toStrategyResponseList(entities: Strategy[]): StrategyResponseDto[] {
  return entities.map((e) => toStrategyResponse(e));
}
