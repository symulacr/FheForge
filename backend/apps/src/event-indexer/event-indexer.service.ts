import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Contract, JsonRpcProvider, type Result } from 'ethers';
import { SupabaseService } from '../shared/infrastructure/supabase.service';

// ── Contract ABIs (only the events we index) ───────────────────────────

const STRATEGY_VAULT_ABI = [
  'event PositionOpened(bytes32 indexed positionId, address indexed user, address indexed collateralToken, uint256 strategyId)',
  'event PositionClosed(bytes32 indexed positionId, address indexed user, address indexed collateralToken, bool fullClose)',
  'event CollateralAdded(bytes32 indexed positionId, address indexed user, address indexed collateralToken)',
];

const LENDING_POOL_ABI = [
  'event Supplied(address indexed user, address indexed token)',
  'event Borrowed(address indexed user, address indexed collateralToken, address indexed borrowToken)',
  'event Repaid(address indexed user, address indexed token)',
  'event Withdrawn(address indexed user, address indexed token)',
];

interface IndexedEvent {
  contract_name: string;
  event_name: string;
  block_number: number;
  tx_hash: string;
  log_index: number;
  data: Record<string, unknown>;
  timestamp: string;
}

interface EventIndexerState {
  id: string;
  last_block: number;
}

@Injectable()
export class EventIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventIndexerService.name);
  private provider: JsonRpcProvider | null = null;
  private strategyVault: Contract | null = null;
  private lendingPool: Contract | null = null;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Last block we processed — persisted in Supabase for restarts */
  private lastProcessedBlock = 0;
  private readonly POLL_INTERVAL_MS = 15_000; // 15 seconds

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    const rpcUrl = this.configService.get<string>('COFHE_RPC');
    const vaultAddress = this.configService.get<string>(
      'STRATEGY_VAULT_ADDRESS',
    );
    const poolAddress = this.configService.get<string>('LENDING_POOL_ADDRESS');

    if (!rpcUrl) {
      this.logger.warn('COFHE_RPC not set — event indexing disabled');
      return;
    }

    this.provider = new JsonRpcProvider(rpcUrl);

    if (vaultAddress) {
      this.strategyVault = new Contract(
        vaultAddress,
        STRATEGY_VAULT_ABI,
        this.provider,
      );
      this.logger.log(`StrategyVault event listener at ${vaultAddress}`);
    } else {
      this.logger.warn(
        'STRATEGY_VAULT_ADDRESS not set — vault events will not be indexed',
      );
    }

    if (poolAddress) {
      this.lendingPool = new Contract(
        poolAddress,
        LENDING_POOL_ABI,
        this.provider,
      );
      this.logger.log(`LendingPool event listener at ${poolAddress}`);
    } else {
      this.logger.warn(
        'LENDING_POOL_ADDRESS not set — pool events will not be indexed',
      );
    }

    if (!this.strategyVault && !this.lendingPool) {
      this.logger.warn(
        'No contract addresses configured — event indexing disabled',
      );
      return;
    }

    // Restore last processed block from Supabase
    try {
      const { data } = await this.supabaseService
        .getClient()
        .from('event_indexer_state')
        .select('last_block')
        .eq('id', 'global')
        .single();
      if (data?.last_block) {
        this.lastProcessedBlock = (data as EventIndexerState).last_block;
        this.logger.log(`Resuming from block ${this.lastProcessedBlock}`);
      }
    } catch (e) {
      console.warn('[EventIndexerService]', e instanceof Error ? e.message : e);
      this.logger.log(
        'No previous indexer state found — starting from current block',
      );
    }

    // If no saved state, start from current block
    if (this.lastProcessedBlock === 0) {
      this.lastProcessedBlock = await this.provider.getBlockNumber();
    }

    // Warn if the gap since the last indexed block exceeds the Arb Sepolia retention
    // window (~128 blocks, ~30 min). Events from periods where the indexer was down
    // are permanently lost if they exceed this window.
    const currentBlock = await this.provider.getBlockNumber();
    const blockGap = currentBlock - this.lastProcessedBlock;
    if (blockGap > 64) {
      this.logger.warn(
        `Block gap of ${blockGap} blocks detected since last index (current=${currentBlock}, last_indexed=${this.lastProcessedBlock}). ` +
          `Arbitrum Sepolia retains ~128 blocks (~30 min). Events during this gap may be permanently lost.`,
      );
    }

    // Auto-clamp: if gap exceeds Arb Sepolia retention window (~128 blocks),
    // move the checkpoint forward to avoid querying pruned history.
    if (blockGap > 128) {
      const clamped = currentBlock - 128;
      this.logger.warn(
        `Block gap ${blockGap} > 128, clamping checkpoint to block ${clamped}`,
      );
      this.lastProcessedBlock = clamped;
      await this.saveCheckpoint(this.lastProcessedBlock);
    }

    this.running = true;
    this.pollTimer = setInterval(() => {
      this.pollEvents().catch((err) => {
        this.logger.error('Unhandled polling error:', err);
      });
    }, this.POLL_INTERVAL_MS);
    this.logger.log('Event indexer started');
  }

  onModuleDestroy(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.log('Event indexer stopped');
  }

  // ── Polling loop ─────────────────────────────────────────────────────

  private async pollEvents(): Promise<void> {
    if (!this.provider || !this.running) return;

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = this.lastProcessedBlock + 1;
      const toBlock = Math.min(currentBlock, fromBlock + 999); // max 1000 blocks per poll

      if (fromBlock > currentBlock) return; // nothing new

      const events: IndexedEvent[] = [];

      // Query StrategyVault events
      if (this.strategyVault) {
        const vaultFilter = {
          fromBlock,
          toBlock,
          address: await this.strategyVault.getAddress(),
        };
        const logs = await this.provider.getLogs(vaultFilter);
        for (const log of logs) {
          const parsed = this.strategyVault.interface.parseLog(log);
          if (parsed) {
            events.push({
              contract_name: 'StrategyVault',
              event_name: parsed.name,
              block_number: log.blockNumber,
              tx_hash: log.transactionHash,
              log_index: log.index,
              data: this.serializeEventArgs(parsed.args),
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // Query LendingPool events
      if (this.lendingPool) {
        const poolFilter = {
          fromBlock,
          toBlock,
          address: await this.lendingPool.getAddress(),
        };
        const logs = await this.provider.getLogs(poolFilter);
        for (const log of logs) {
          const parsed = this.lendingPool.interface.parseLog(log);
          if (parsed) {
            events.push({
              contract_name: 'LendingPool',
              event_name: parsed.name,
              block_number: log.blockNumber,
              tx_hash: log.transactionHash,
              log_index: log.index,
              data: this.serializeEventArgs(parsed.args),
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // Persist to Supabase
      if (events.length > 0) {
        await this.persistEvents(events);
      }

      // Update checkpoint
      this.lastProcessedBlock = toBlock;
      await this.saveCheckpoint(toBlock);

      if (events.length > 0) {
        this.logger.debug(
          `Indexed ${events.length} events from blocks ${fromBlock}-${toBlock}`,
        );
      }
    } catch (err) {
      this.logger.error(`Event polling error: ${(err as Error).message}`);
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────

  private async persistEvents(events: IndexedEvent[]): Promise<void> {
    try {
      const rows = events.map((e) => ({
        contract_name: e.contract_name,
        event_name: e.event_name,
        block_number: e.block_number,
        tx_hash: e.tx_hash,
        log_index: e.log_index,
        data: JSON.stringify(e.data),
        timestamp: e.timestamp,
      }));

      const { error } = await this.supabaseService
        .getClient()
        .from('on_chain_events')
        .insert(rows);

      if (error) {
        this.logger.error(`Failed to persist events: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(`Persist error: ${(err as Error).message}`);
    }
  }

  private async saveCheckpoint(block: number): Promise<void> {
    try {
      await this.supabaseService
        .getClient()
        .from('event_indexer_state')
        .upsert({ id: 'global', last_block: block }, { onConflict: 'id' });
    } catch (err) {
      this.logger.warn(`Failed to save checkpoint: ${(err as Error).message}`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Convert ethers Result args to a plain object for JSON serialization */
  private serializeEventArgs(args: Result): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (Number.isNaN(Number(key))) {
        // Skip numeric keys (ethers Result also has positional keys)
        obj[key] = typeof value === 'bigint' ? value.toString() : value;
      }
    }
    return obj;
  }
}
