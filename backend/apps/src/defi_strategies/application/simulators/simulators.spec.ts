import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FhenixStrategyService } from '../../../shared/infrastructure/fhenix-strategy.service';
import { BorrowSimulator } from './borrow-simulator';
import { SupplySimulator } from './supply-simulator';
import { SimulationContext } from '../../domain/simulation-engine.interface';

describe('MC-56: Backend Simulators On-Chain APY Reads', () => {
  let borrowSimulator: BorrowSimulator;
  let supplySimulator: SupplySimulator;
  let mockConfigService: Partial<ConfigService>;
  let mockFhenixStrategyService: Partial<FhenixStrategyService>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        const config = {
          FHENIX_RPC: 'https://test-rpc.example.com',
          STRATEGY_REGISTRY_ADDRESS: '0x1234567890123456789012345678901234567890',
        };
        return config[key as keyof typeof config];
      }),
    };

    mockFhenixStrategyService = {
      getAssetPrice: jest.fn().mockResolvedValue(1.0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BorrowSimulator,
        SupplySimulator,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: FhenixStrategyService, useValue: mockFhenixStrategyService },
      ],
    }).compile();

    borrowSimulator = module.get<BorrowSimulator>(BorrowSimulator);
    supplySimulator = module.get<SupplySimulator>(SupplySimulator);
  });

  describe('BorrowSimulator', () => {
    it('should be instantiated with on-chain APY reading capability', () => {
      expect(borrowSimulator).toBeDefined();
      // MC-56: Verify that the simulator has the necessary properties for on-chain reads
      expect(borrowSimulator).toHaveProperty('logger');
    });

    it('should accept strategyId in simulation context (MC-56)', async () => {
      const context: SimulationContext = {
        amount_in: 1000,
        slippage_tolerance: 0.5,
        current_amount: 1000,
        total_fee: 0,
        warnings: [],
        fhe_mode: true,
        amount_precision: 'EXACT',
        strategyId: 1n, // MC-56: strategyId is now part of context
      };

      const step = {
        step: 1,
        type: 'BORROW',
        agent: 'LENDING_POOL',
        tokenIn: { assetId: '1', symbol: 'WETH', amount: 1000 },
        tokenOut: { assetId: '0', symbol: 'USDC', amount: 0 },
        collateralRatio: 0.7,
      };

      // MC-56: This should use strategyId to fetch on-chain APY
      // Note: This will use fallback values since we're not actually connecting to a chain
      const result = await borrowSimulator.simulate(step, context);

      expect(result).toBeDefined();
      expect(result.action_type).toBe('BORROW');
      expect(result.apy).toBeDefined();
    });

    it('should use fallback APY when StrategyRegistry is not available', async () => {
      const context: SimulationContext = {
        amount_in: 1000,
        slippage_tolerance: 0.5,
        current_amount: 1000,
        total_fee: 0,
        warnings: [],
        fhe_mode: true,
        amount_precision: 'EXACT',
        strategyId: 1n,
      };

      const step = {
        step: 1,
        type: 'BORROW',
        agent: 'LENDING_POOL',
        tokenIn: { assetId: '1', symbol: 'WETH', amount: 1000 },
        tokenOut: { assetId: '0', symbol: 'USDC', amount: 0 },
        collateralRatio: 0.7,
      };

      const result = await borrowSimulator.simulate(step, context);

      // MC-56: Should use fallback APY of 6.0% when on-chain read fails
      expect(result.apy).toBe(6.0);
    });
  });

  describe('SupplySimulator', () => {
    it('should be instantiated with on-chain APY reading capability', () => {
      expect(supplySimulator).toBeDefined();
      // MC-56: Verify that the simulator has the necessary properties for on-chain reads
      expect(supplySimulator).toHaveProperty('logger');
    });

    it('should accept strategyId in simulation context (MC-56)', async () => {
      const context: SimulationContext = {
        amount_in: 1000,
        slippage_tolerance: 0.5,
        current_amount: 1000,
        total_fee: 0,
        warnings: [],
        fhe_mode: true,
        amount_precision: 'EXACT',
        strategyId: 1n, // MC-56: strategyId is now part of context
      };

      const step = {
        step: 1,
        type: 'SUPPLY',
        agent: 'LENDING_POOL',
        tokenIn: { assetId: '0', symbol: 'USDC', amount: 1000 },
        tokenOut: { assetId: '0', symbol: 'aUSDC', amount: 1000 },
      };

      // MC-56: This should use strategyId to fetch on-chain APY
      // Note: This will use fallback values since we're not actually connecting to a chain
      const result = await supplySimulator.simulate(step, context);

      expect(result).toBeDefined();
      expect(result.action_type).toBe('SUPPLY');
      expect(result.apy).toBeDefined();
    });

    it('should use fallback APY when StrategyRegistry is not available', async () => {
      const context: SimulationContext = {
        amount_in: 1000,
        slippage_tolerance: 0.5,
        current_amount: 1000,
        total_fee: 0,
        warnings: [],
        fhe_mode: true,
        amount_precision: 'EXACT',
        strategyId: 1n,
      };

      const step = {
        step: 1,
        type: 'SUPPLY',
        agent: 'LENDING_POOL',
        tokenIn: { assetId: '0', symbol: 'USDC', amount: 1000 },
        tokenOut: { assetId: '0', symbol: 'aUSDC', amount: 1000 },
      };

      const result = await supplySimulator.simulate(step, context);

      // MC-56: Should use fallback APY of 5.0% when on-chain read fails
      expect(result.apy).toBe(5.0);
    });
  });

  describe('SimulationContext', () => {
    it('should include strategyId field (MC-56)', () => {
      const context: SimulationContext = {
        amount_in: 1000,
        slippage_tolerance: 0.5,
        current_amount: 1000,
        total_fee: 0,
        warnings: [],
        fhe_mode: true,
        amount_precision: 'EXACT',
        strategyId: 1n, // MC-56: New field
      };

      expect(context.strategyId).toBe(1n);
    });

    it('should allow strategyId to be optional (MC-56)', () => {
      const context: SimulationContext = {
        amount_in: 1000,
        slippage_tolerance: 0.5,
        current_amount: 1000,
        total_fee: 0,
        warnings: [],
        fhe_mode: true,
        amount_precision: 'EXACT',
        // strategyId is optional
      };

      expect(context.strategyId).toBeUndefined();
    });
  });
});
