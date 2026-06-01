import { Injectable } from '@nestjs/common';
import { ProposalResponseDto, VoteDto } from './dtos/proposal-response.dto';

const MOCK_PROPOSALS: ProposalResponseDto[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    title: 'Increase WETH collateral factor to 85%',
    description:
      'Rationale: utilization has been consistently above 80% for the past 30 days.',
    status: 'active',
    votesFor: 1245,
    votesAgainst: 320,
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    proposer: '0xA1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    recentVotes: [],
    payload: { token: 'WETH', newCollateralFactor: 0.85 },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    title: 'Add ARB as a collateral asset',
    description:
      'Proposal to add Arbitrum token as a new collateral asset with 65% liquidation threshold.',
    status: 'active',
    votesFor: 890,
    votesAgainst: 45,
    endsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    proposer: '0xB2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    recentVotes: [],
    payload: { token: 'ARB', liquidationThreshold: 0.65 },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    title: 'Reduce supply APY floor from 2% to 1%',
    description:
      'Market conditions suggest lowering the minimum supply APY to improve competitiveness.',
    status: 'passed',
    votesFor: 2100,
    votesAgainst: 150,
    endsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    proposer: '0xC3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4',
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    recentVotes: [],
    payload: { minSupplyApy: 0.01 },
  },
];

@Injectable()
export class GovernanceRepository {
  private proposals = new Map<string, ProposalResponseDto>(
    MOCK_PROPOSALS.map((p) => [p.id, p]),
  );
  private votes = new Map<string, VoteDto[]>();

  async findAll(status?: string): Promise<ProposalResponseDto[]> {
    const all = Array.from(this.proposals.values());
    if (!status) return await Promise.resolve(all);
    return await Promise.resolve(all.filter((p) => p.status === status));
  }

  async findById(id: string): Promise<ProposalResponseDto | undefined> {
    const proposal = this.proposals.get(id);
    if (!proposal) return undefined;
    const recentVotes = this.votes.get(id) ?? [];
    return await Promise.resolve({
      ...proposal,
      recentVotes: recentVotes.slice(-20),
    });
  }

  async create(
    dto: Omit<ProposalResponseDto, 'id' | 'createdAt' | 'recentVotes'>,
  ): Promise<ProposalResponseDto> {
    const proposal: ProposalResponseDto = {
      ...dto,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      recentVotes: [],
    };
    this.proposals.set(proposal.id, proposal);
    return await Promise.resolve(proposal);
  }

  async addVote(proposalId: string, vote: VoteDto): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return await Promise.resolve();

    const existing = this.votes.get(proposalId) ?? [];
    existing.push(vote);
    this.votes.set(proposalId, existing);

    if (vote.support) {
      proposal.votesFor += vote.weight;
    } else {
      proposal.votesAgainst += vote.weight;
    }
  }

  async updateStatus(
    id: string,
    status: ProposalResponseDto['status'],
  ): Promise<ProposalResponseDto | undefined> {
    const proposal = this.proposals.get(id);
    if (!proposal) return undefined;
    proposal.status = status;
    this.proposals.set(id, proposal);
    return await Promise.resolve(proposal);
  }
}
