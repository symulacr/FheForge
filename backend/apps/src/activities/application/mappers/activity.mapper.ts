import type { Activity } from '../../domain/activity.entity';
import type { ActivityResponseDto } from '../../interfaces/dtos/activity-response.dto';

export function toActivityResponse(entity: Activity): ActivityResponseDto {
  const meta = entity.metadata ?? {};

  // Extract on-chain event data from metadata (set by ActivityRepositoryImplement)
  const eventName = meta.event_name as string | undefined;
  const blockNumber = meta.block_number as number | undefined;

  // Derive asset / token address from common event arg names
  const tokenAddress =
    (meta.token as string) ??
    (meta.collateralToken as string) ??
    (meta.borrowToken as string) ??
    undefined;

  return {
    id: entity.id,
    userAddress: entity.userAddress,
    strategyId: entity.strategyId,
    txHash: entity.txHash,
    status: entity.status,
    metadata: entity.metadata,
    currentStep: entity.currentStep,
    totalSteps: entity.totalSteps,
    createdAt: entity.createdAt,
    // Enriched fields from on-chain events
    type: eventName,
    tokenAddress,
    txHashSingle: entity.txHash[0],
    blockNumber,
    fheEncrypted: true,
  };
}

export function toActivityResponseList(entities: Activity[]): ActivityResponseDto[] {
  return entities.map((e) => toActivityResponse(e));
}
