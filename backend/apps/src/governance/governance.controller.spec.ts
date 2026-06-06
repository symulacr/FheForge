import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { GovernanceController } from './governance.controller';
import { GovernanceRepository } from './governance.repository';
import { GovernanceService } from './governance.service';

describe('GovernanceController', () => {
  let controller: GovernanceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GovernanceController],
      providers: [GovernanceService, GovernanceRepository],
    }).compile();

    controller = module.get<GovernanceController>(GovernanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /governance/proposals', () => {
    it('should return all proposals without filter', async () => {
      const result = await controller.getProposals();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should filter by status', async () => {
      const result = await controller.getProposals('active');
      expect(result.every((p) => p.status === 'active')).toBe(true);
    });
  });

  describe('GET /governance/proposals/:id', () => {
    it('should return a proposal by id', async () => {
      const all = await controller.getProposals();
      const id = all[0].id;
      const proposal = await controller.getProposal(id);
      expect(proposal.id).toBe(id);
    });

    it('should throw NotFoundException for unknown id', async () => {
      await expect(controller.getProposal('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('GET /governance/vote-power/:address', () => {
    it('should return vote power for an address', async () => {
      const result = await controller.getVotePower('0x1234567890abcdef');
      expect(result.address).toBe('0x1234567890abcdef');
      expect(result.power).toBeGreaterThan(0);
    });
  });

  describe('POST /governance/proposals', () => {
    it('should create a proposal', async () => {
      const dto = {
        title: 'Test proposal',
        description: 'Description of test proposal',
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        payload: { token: 'WETH', newCollateralFactor: 0.85 },
      };
      const result = await controller.createProposal(dto);
      expect(result.title).toBe(dto.title);
      expect(result.status).toBe('pending');
    });
  });

  describe('POST /governance/vote', () => {
    it('should record a vote on an active proposal', async () => {
      const all = await controller.getProposals('active');
      const active = all[0];
      const req = {
        user: { address: '0xVoterTestAddress' },
      } as unknown as Request & { user?: { address?: string } };
      const result = await controller.castVote(
        { proposalId: active.id, support: true, weight: 100 },
        req,
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('recorded');
    });

    it('should reject vote on non-existent proposal', async () => {
      const req = {
        user: { address: '0xVoterTestAddress' },
      } as unknown as Request & { user?: { address?: string } };
      const result = await controller.castVote(
        { proposalId: 'nonexistent', support: true, weight: 100 },
        req,
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should reject duplicate vote from same address', async () => {
      const all = await controller.getProposals('active');
      const active = all[0];
      const req = {
        user: { address: '0xDuplicateVoter' },
      } as unknown as Request & { user?: { address?: string } };
      // First vote succeeds
      await controller.castVote({ proposalId: active.id, support: true, weight: 50 }, req);
      // Second vote fails
      const result = await controller.castVote(
        { proposalId: active.id, support: false, weight: 50 },
        req,
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain('already voted');
    });
  });

  describe('PATCH /governance/proposals/:id/execute', () => {
    it('should reject execution of non-passed proposal', async () => {
      const all = await controller.getProposals();
      const active = all.find((p) => p.status === 'active');
      if (!active) return;

      await expect(controller.executeProposal(active.id)).rejects.toThrow();
    });

    it('should throw NotFoundException for unknown id', async () => {
      await expect(controller.executeProposal('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });
});
