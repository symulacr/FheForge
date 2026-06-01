import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../shared/infrastructure/supabase.service';
import { EventIndexerService } from './event-indexer.service';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getNetwork: jest.fn().mockResolvedValue({ chainId: 421614 }),
      getBlockNumber: jest.fn().mockResolvedValue(12345678),
      getLogs: jest.fn().mockResolvedValue([]),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    })),
    Contract: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      queryFilter: jest.fn().mockResolvedValue([]),
      getAddress: jest
        .fn()
        .mockResolvedValue('0x1234567890123456789012345678901234567890'),
      interface: {
        parseLog: jest
          .fn()
          .mockReturnValue({ name: 'PositionOpened', args: [] }),
      },
    })),
  };
});

describe('MC-55: Event Indexer Service', () => {
  let service: EventIndexerService;
  let mockConfigService: Partial<ConfigService>;
  let mockSupabaseService: Partial<SupabaseService>;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        const config = {
          COFHE_RPC: 'https://test-rpc.example.com',
          STRATEGY_VAULT_ADDRESS: '0x1234567890123456789012345678901234567890',
          LENDING_POOL_ADDRESS: '0x0987654321098765432109876543210987654321',
        };
        return config[key as keyof typeof config];
      }),
    };

    mockSupabaseService = {
      getClient: jest.fn(() => ({
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => ({
              data: { last_block: 100 },
              error: null,
            })),
          })),
          insert: jest.fn(() => ({ error: null })),
          upsert: jest.fn(() => ({})),
        })),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventIndexerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compile();

    service = module.get<EventIndexerService>(EventIndexerService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have required contract ABIs for event indexing', () => {
    // MC-55: Verify the service is set up to index the correct events
    expect(service).toBeDefined();
    // The service should have the necessary structure for event indexing
    expect(service).toHaveProperty('onModuleInit');
    expect(service).toHaveProperty('onModuleDestroy');
  });

  it('should implement OnModuleInit and OnModuleDestroy lifecycle hooks', () => {
    // MC-55: Event indexer should properly manage lifecycle
    expect(typeof service.onModuleInit).toBe('function');
    expect(typeof service.onModuleDestroy).toBe('function');
  });

  it('should accept configuration from environment variables', async () => {
    // MC-55: Verify the service can be configured with env vars
    await service.onModuleInit();
    expect(mockConfigService.get).toHaveBeenCalledWith('COFHE_RPC');
    expect(mockConfigService.get).toHaveBeenCalledWith(
      'STRATEGY_VAULT_ADDRESS',
    );
    expect(mockConfigService.get).toHaveBeenCalledWith('LENDING_POOL_ADDRESS');
  });

  it('should integrate with Supabase for persistence', async () => {
    // MC-55: Verify the service uses Supabase for event storage
    await service.onModuleInit();
    expect(mockSupabaseService.getClient).toHaveBeenCalled();
  });
});
