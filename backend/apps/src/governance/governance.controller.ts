import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import type { CastVoteDto } from './dtos/cast-vote.dto';
import { ProposalResponseDto } from './dtos/proposal-response.dto';
import { GovernanceService } from './governance.service';

@ApiTags('Governance')
@Controller('governance')
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Public()
  @Get('proposals')
  @ApiOperation({ summary: 'List governance proposals' })
  @ApiResponse({
    status: 200,
    description: 'List of proposals',
    type: [ProposalResponseDto],
  })
  async getProposals(@Query('status') status?: string): Promise<ProposalResponseDto[]> {
    return this.governanceService.getProposals(status);
  }

  @Post('vote')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cast a vote on an active proposal',
  })
  @ApiResponse({
    status: 200,
    description: 'Vote recorded',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid vote (proposal not active, already voted, etc.)',
  })
  async castVote(
    @Body() dto: CastVoteDto,
    @Req() req: Request & { user?: { address?: string } },
  ): Promise<{ success: boolean; message: string }> {
    try {
      const voter = req.user?.address || '0xAnonymous';
      await this.governanceService.castVote(dto, voter);
      return { success: true, message: 'Vote recorded successfully' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Vote failed';
      return { success: false, message };
    }
  }
}
