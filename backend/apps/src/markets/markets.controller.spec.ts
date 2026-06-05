import { Test, type TestingModule } from '@nestjs/testing';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';

const marketsServiceMock = {
  getAllMarkets: jest.fn(),
  getPrices: jest.fn(),
  getStatus: jest.fn(),
};

describe('MarketsController', () => {
  let controller: MarketsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketsController],
      providers: [
        {
          provide: MarketsService,
          useValue: marketsServiceMock,
        },
      ],
    }).compile();

    controller = module.get<MarketsController>(MarketsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /markets', () => {
    it('should return contract-backed nullable markets without mock APYs', async () => {
      marketsServiceMock.getAllMarkets.mockResolvedValue([
        {
          asset: 'USDC',
          assetAddress: '0x0000000000000000000000000000000000000001',
          supplyAPY: null,
          borrowAPY: null,
          utilization: 0.5,
          tvl: 100,
          liquidationThreshold: null,
          oraclePrice: 1,
          totalSupplied: 200,
          totalBorrowed: 100,
          status: 'partial',
          missingFields: ['supplyAPY', 'borrowAPY', 'liquidationThreshold'],
        },
      ]);

      const result = await controller.getAllMarkets();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        asset: 'USDC',
        supplyAPY: null,
        borrowAPY: null,
        status: 'partial',
      });
      expect(result[0].missingFields).toContain('supplyAPY');
    });

    it('should allow an empty market list when the token registry is unavailable', async () => {
      marketsServiceMock.getAllMarkets.mockResolvedValue([]);

      await expect(controller.getAllMarkets()).resolves.toEqual([]);
    });
  });

  describe('GET /markets/status', () => {
    it('should distinguish empty markets from unavailable registry status', async () => {
      marketsServiceMock.getStatus.mockResolvedValue({
        status: 'empty',
        tokenRegistry: {
          configured: true,
          reachable: true,
          status: 'empty',
        },
        tokenCount: 0,
        missingDependencies: [],
      });

      await expect(controller.getStatus()).resolves.toMatchObject({
        status: 'empty',
        tokenRegistry: { reachable: true, status: 'empty' },
        tokenCount: 0,
      });
    });
  });

  describe('GET /markets/prices', () => {
    it('should return on-chain oracle price metadata', async () => {
      marketsServiceMock.getPrices.mockResolvedValue([
        {
          asset: 'USDC',
          price: 1,
          oracle: 'FheForge PriceOracle',
          updatedAt: '2026-06-01T12:00:00.000Z',
          status: 'live',
        },
      ]);

      const result = await controller.getPrices();
      expect(result).toEqual([
        {
          asset: 'USDC',
          price: 1,
          oracle: 'FheForge PriceOracle',
          updatedAt: '2026-06-01T12:00:00.000Z',
          status: 'live',
        },
      ]);
    });

    it('should return nullable prices when oracle data is unavailable', async () => {
      marketsServiceMock.getPrices.mockResolvedValue([
        {
          asset: 'USDC',
          price: null,
          oracle: 'FheForge PriceOracle',
          updatedAt: null,
          status: 'unavailable',
        },
      ]);

      const result = await controller.getPrices();
      expect(result[0].price).toBeNull();
      expect(result[0].updatedAt).toBeNull();
      expect(result[0].status).toBe('unavailable');
    });
  });
});
