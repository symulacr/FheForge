export class ActivityResponseDto {
  id: string;
  userAddress: string;
  strategyId: string;
  txHash: string[];
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  metadata?: Record<string, unknown>;
  currentStep?: number;
  totalSteps?: number;
  createdAt?: Date;
  type?: string;
  asset?: string;
  amount?: string;
  amountUsd?: string;
  tokenAddress?: string;
  txHashSingle?: string;
  blockNumber?: number;
  fheEncrypted?: boolean;
  riskScore?: number;
  yieldEarned?: string;
  yieldEarnedUsd?: string;
}
