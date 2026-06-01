import { Test, TestingModule } from '@nestjs/testing';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

describe('StatsController', () => {
  let controller: StatsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [StatsService],
    }).compile();

    controller = module.get<StatsController>(StatsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /stats', () => {
    it('should return protocol stats', async () => {
      const result = await controller.getStats();
      expect(result).toHaveProperty('tvlUsd');
      expect(result).toHaveProperty('totalUsers');
      expect(result).toHaveProperty('activeMarkets');
      expect(result).toHaveProperty('activeStrategies');
      expect(result).toHaveProperty('encryptedOps');
      expect(result).toHaveProperty('poolTvls');
    });

    it('should return positive numeric values', async () => {
      const result = await controller.getStats();
      expect(result.tvlUsd).toBeGreaterThan(0);
      expect(result.totalUsers).toBeGreaterThan(0);
      expect(result.activeMarkets).toBeGreaterThan(0);
    });

    it('should cache results within TTL', async () => {
      const first = await controller.getStats();
      const second = await controller.getStats();
      expect(second).toEqual(first);
    });
  });
});
