import { Test, TestingModule } from '@nestjs/testing';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';

describe('MarketsController', () => {
  let controller: MarketsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketsController],
      providers: [MarketsService],
    }).compile();

    controller = module.get<MarketsController>(MarketsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /markets', () => {
    it('should return all markets', async () => {
      const result = await controller.getAllMarkets();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('asset');
      expect(result[0]).toHaveProperty('supplyAPY');
      expect(result[0]).toHaveProperty('borrowAPY');
    });

    it('should include known assets', async () => {
      const result = await controller.getAllMarkets();
      const assets = result.map(m => m.asset);
      expect(assets).toContain('USDC');
      expect(assets).toContain('ETH');
    });
  });

  describe('GET /markets/prices', () => {
    it('should return prices for all assets', async () => {
      const result = await controller.getPrices();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('asset');
      expect(result[0]).toHaveProperty('price');
      expect(result[0]).toHaveProperty('oracle');
    });

    it('should use Pyth as oracle', async () => {
      const result = await controller.getPrices();
      expect(result.every(p => p.oracle === 'Pyth')).toBe(true);
    });
  });
});
