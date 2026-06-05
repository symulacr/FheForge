import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { GovernanceRepository } from "./governance.repository";
import { ProposalResponseDto, VoteDto } from "./dtos/proposal-response.dto";
import { CastVoteDto } from "./dtos/cast-vote.dto";
import { CreateProposalDto } from "./dtos/create-proposal.dto";

@Injectable()
export class GovernanceService {
	constructor(private readonly repository: GovernanceRepository) {}

	async getProposals(status?: string): Promise<ProposalResponseDto[]> {
		return this.repository.findAll(status);
	}

	async getProposal(id: string): Promise<ProposalResponseDto | undefined> {
		return this.repository.findById(id);
	}

	async createProposal(dto: CreateProposalDto): Promise<ProposalResponseDto> {
		return this.repository.create({
			...dto,
			votesFor: 0,
			votesAgainst: 0,
			status: "pending",
			proposer: "0xAdminAddress",
		});
	}

	async castVote(dto: CastVoteDto, voter: string): Promise<VoteDto> {
		const proposal = await this.repository.findById(dto.proposalId);
		if (!proposal) {
			throw new NotFoundException(`Proposal ${dto.proposalId} not found`);
		}
		if (proposal.status !== "active") {
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
			support: dto.support,
			weight: dto.weight,
			votedAt: new Date().toISOString(),
		};
		await this.repository.addVote(dto.proposalId, vote);
		return vote;
	}

	async executeProposal(id: string): Promise<ProposalResponseDto | undefined> {
		const proposal = await this.repository.findById(id);
		if (!proposal) {
			return undefined;
		}
		if (proposal.status !== "passed") {
			throw new BadRequestException(
				`Proposal ${id} must be passed (currently: ${proposal.status})`,
			);
		}
		const majority = proposal.votesFor > proposal.votesAgainst;
		const quorum = proposal.votesFor + proposal.votesAgainst >= 460_000;
		if (!majority || !quorum) {
			throw new BadRequestException(`Proposal ${id} does not meet quorum/majority requirements`);
		}
		return this.repository.updateStatus(id, "executed");
	}
}
