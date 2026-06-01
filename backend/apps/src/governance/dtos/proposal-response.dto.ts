import { ApiProperty } from '@nestjs/swagger';

export class VoteDto {
  @ApiProperty({ example: '0xVoterAddress' })
  voter: string;

  @ApiProperty({ example: true, description: 'true = for, false = against' })
  support: boolean;

  @ApiProperty({ example: 1000, description: 'Vote weight (token balance)' })
  weight: number;

  @ApiProperty({ example: '2026-06-05T14:30:00Z' })
  votedAt: string;
}

export class ProposalResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Increase WETH collateral factor to 85%' })
  title: string;

  @ApiProperty({ example: 'Rationale: utilization has been consistently above 80%...' })
  description: string;

  @ApiProperty({ example: 'active', enum: ['pending', 'active', 'passed', 'rejected', 'executed'] })
  status: 'pending' | 'active' | 'passed' | 'rejected' | 'executed';

  @ApiProperty({ example: 1_245, description: 'Votes in favor' })
  votesFor: number;

  @ApiProperty({ example: 320, description: 'Votes against' })
  votesAgainst: number;

  @ApiProperty({ example: '2026-06-10T00:00:00Z', description: 'Voting end time' })
  endsAt: string;

  @ApiProperty({ example: '0xProposerAddress', description: 'Proposer wallet address' })
  proposer: string;

  @ApiProperty({ example: '2026-06-01T12:00:00Z', description: 'Proposal creation time' })
  createdAt: string;

  @ApiProperty({ type: [VoteDto], description: '20 most recent votes' })
  recentVotes: VoteDto[];

  @ApiProperty({ description: 'JSON payload: parameter changes to execute on-chain' })
  payload: object;
}
