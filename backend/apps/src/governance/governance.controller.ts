import {
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	Patch,
	Post,
	Query,
	Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import type { CastVoteDto } from "./dtos/cast-vote.dto";
import type { CreateProposalDto } from "./dtos/create-proposal.dto";
import { ProposalResponseDto } from "./dtos/proposal-response.dto";
import type { GovernanceService } from "./governance.service";

@ApiTags("Governance")
@Controller("governance")
export class GovernanceController {
	constructor(private readonly governanceService: GovernanceService) {}

	@Public()
	@Get("proposals")
	@ApiOperation({ summary: "List governance proposals" })
	@ApiResponse({
		status: 200,
		description: "List of proposals",
		type: [ProposalResponseDto],
	})
	async getProposals(@Query("status") status?: string): Promise<ProposalResponseDto[]> {
		return this.governanceService.getProposals(status);
	}

	@Public()
	@Get("proposals/:id")
	@ApiOperation({ summary: "Get a single proposal" })
	@ApiResponse({
		status: 200,
		description: "Proposal detail",
		type: ProposalResponseDto,
	})
	@ApiResponse({ status: 404, description: "Proposal not found" })
	async getProposal(@Param("id") id: string): Promise<ProposalResponseDto> {
		const proposal = await this.governanceService.getProposal(id);
		if (!proposal) {
			throw new NotFoundException(`Proposal ${id} not found`);
		}
		return proposal;
	}

	@Post("proposals")
	@ApiBearerAuth()
	@ApiOperation({ summary: "Create a new proposal (admin only)" })
	@ApiResponse({
		status: 201,
		description: "Created proposal",
		type: ProposalResponseDto,
	})
	async createProposal(@Body() dto: CreateProposalDto): Promise<ProposalResponseDto> {
		return this.governanceService.createProposal(dto);
	}

	@Post("vote")
	@ApiBearerAuth()
	@ApiOperation({
		summary: "Cast a vote on an active proposal (on-chain coming soon)",
	})
	@ApiResponse({
		status: 200,
		description: "Vote not yet available on-chain",
	})
	castVote(@Body() _dto: CastVoteDto, @Req() _req: Request): { success: boolean; message: string } {
		return {
			success: false,
			message:
				"On-chain governance voting coming soon. Votes require FFG token and on-chain interaction.",
		};
	}

	@Patch("proposals/:id/execute")
	@ApiBearerAuth()
	@ApiOperation({ summary: "Execute a passed proposal (admin only)" })
	@ApiResponse({
		status: 200,
		description: "Proposal executed",
		type: ProposalResponseDto,
	})
	@ApiResponse({
		status: 404,
		description: "Proposal not found or not eligible for execution",
	})
	async executeProposal(@Param("id") id: string): Promise<ProposalResponseDto> {
		const proposal = await this.governanceService.executeProposal(id);
		if (!proposal) {
			throw new NotFoundException(`Proposal ${id} not found or not eligible for execution`);
		}
		return proposal;
	}
}
