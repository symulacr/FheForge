import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CastVoteDto } from './dtos/cast-vote.dto';
import type { ProposalResponseDto, VoteDto } from './dtos/proposal-response.dto';
import { GovernanceRepository } from './governance.repository';

@Injectable()
export class GovernanceService {
  constructor(private readonly repository: GovernanceRepository) {}

  async getProposals(status?: string): Promise<ProposalResponseDto[]> {
    return this.repository.findAll(status);
  }

  async castVote(dto: CastVoteDto, voter: string): Promise<VoteDto> {
    const proposal = await this.repository.findById(dto.proposalId);
    if (!proposal) {
      throw new NotFoundException(`Proposal ${dto.proposalId} not found`);
    }
    if (proposal.status !== 'active') {
      throw new BadRequestException(
        `Proposal ${dto.proposalId} is not active (status: ${proposal.status})`,
      );
    }
    if (new Date(proposal.endsAt) < new Date()) {
      throw new BadRequestException(`Voting period for proposal ${dto.proposalId} has ended`);
    }
    const hasVoted = proposal.recentVotes.some((v) => v.voter === voter);
    if (hasVoted) {
      throw new BadRequestException(
        `Voter ${voter} has already voted on proposal ${dto.proposalId}`,
      );
    }

    const vote: VoteDto = {
      voter,
      support: dto.support ?? false,
      weight: dto.weight,
      votedAt: new Date().toISOString(),
    };
    await this.repository.addVote(dto.proposalId, vote);
    return vote;
  }
}
