import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from 'src/shared/infrastructure/supabase.service';
import { Activity, type ActivityStatus } from '../domain/activity.entity';
import { ActivityRepository } from '../domain/activity.repository';

/** Shape of a row stored in the on_chain_events table by EventIndexerService */
interface OnChainEventRow {
  contract_name: string;
  event_name: string;
  block_number: number;
  tx_hash: string;
  log_index: number;
  data: string | Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class ActivityRepositoryImplement implements ActivityRepository {
  private readonly logger = new Logger(ActivityRepositoryImplement.name);
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(): Promise<Activity[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('on_chain_events')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch activities: ${error.message}`);
    }

    return (data || []).map((row: OnChainEventRow) =>
      this.mapEventToEntity(row),
    );
  }

  async findByFilter(filters: {
    strategyId?: string;
    userAddress?: string;
  }): Promise<Activity[]> {
    try {
      let query = this.supabase
        .getClient()
        .from('on_chain_events')
        .select('*');

      if (filters.strategyId) {
        // contract_name maps to strategyId (e.g. 'LendingPool', 'StrategyVault')
        query = query.eq('contract_name', filters.strategyId);
      }
      if (filters.userAddress) {
        // user address is stored inside the JSONB data column
        query = query.filter(
          'data->>user',
          'eq',
          filters.userAddress.toLowerCase(),
        );
      }
      const { data, error } = await query.order('timestamp', {
        ascending: false,
      });
      if (error) {
        this.logger.warn(
          `No activities found with filters: ${JSON.stringify(filters)}, error: ${error.message}`,
        );
        return [];
      }
      if (!data || data.length === 0) {
        return [];
      }
      return (data || []).map((row: OnChainEventRow) =>
        this.mapEventToEntity(row),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Error fetching activities with filters: ${JSON.stringify(filters)}`,
        errorMessage,
      );
      return [];
    }
  }

  async findById(id: string): Promise<Activity | null> {
    try {
      // IDs are constructed as tx_hash_logIndex; parse to query on_chain_events
      const lastUnderscore = id.lastIndexOf('_');
      if (lastUnderscore === -1) return null;
      const txHash = id.substring(0, lastUnderscore);
      const logIndex = Number(id.substring(lastUnderscore + 1));

      const { data, error } = await this.supabase
        .getClient()
        .from('on_chain_events')
        .select('*')
        .eq('tx_hash', txHash)
        .eq('log_index', logIndex)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapEventToEntity(data as OnChainEventRow);
    } catch (error) {
      this.logger.warn(`Error fetching activity by id: ${id}`, error);
      return null;
    }
  }

  async findPaginated({
    strategyId,
    userAddress,
    offset,
    limit,
  }: {
    strategyId?: string;
    userAddress?: string;
    offset: number;
    limit: number;
  }): Promise<{ data: Activity[]; total: number }> {
    try {
      let query = this.supabase
        .getClient()
        .from('on_chain_events')
        .select('*', { count: 'exact' })
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      if (strategyId) {
        query = query.eq('contract_name', strategyId);
      }

      if (userAddress) {
        query = query.filter(
          'data->>user',
          'eq',
          userAddress.toLowerCase(),
        );
      }

      const { data, count, error } = await query;

      if (error) {
        this.logger.warn(`Paginated query error: ${error.message}`);
        return { data: [], total: 0 };
      }

      return {
        data: (data ?? []).map((row: OnChainEventRow) =>
          this.mapEventToEntity(row),
        ),
        total: count ?? 0,
      };
    } catch (err) {
      this.logger.warn(
        `findPaginated error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { data: [], total: 0 };
    }
  }

  /** save() still writes to the activities table for create/update operations */
  async save(activity: Activity): Promise<void> {
    const payload: Record<string, unknown> = {
      id: activity.id,
      user_address: activity.userAddress,
      strategy_id: activity.strategyId,
      tx_hash: activity.txHash ?? [],
      status: activity.status,
      metadata: activity.metadata ?? null,
      current_step: activity.currentStep ?? null,
      total_steps: activity.totalSteps ?? null,
      created_at: activity.createdAt ?? undefined,
    };

    const { error } = await this.supabase
      .getClient()
      .from('activities')
      .upsert(payload);

    if (error) {
      throw new Error(`Failed to save activity: ${error.message}`);
    }
  }

  // ── Mapping: on_chain_events → Activity entity ─────────────────────────

  private mapEventToEntity(row: OnChainEventRow): Activity {
    const data =
      typeof row.data === 'string' ? JSON.parse(row.data) : row.data ?? {};

    // Deterministic ID from tx_hash + log_index
    const id = `${row.tx_hash}_${row.log_index}`;

    const txHash: string[] = row.tx_hash ? [row.tx_hash] : [];

    // Extract user address from event args (lowercase for consistent matching)
    const userAddress = (data.user ?? data.positionOwner ?? '') as string;

    // contract_name maps to strategyId
    const strategyId: string = row.contract_name ?? 'unknown';

    // On-chain events are confirmed transactions
    const status: ActivityStatus = 'SUCCESS';

    // Attach event metadata for the DTO to consume
    const metadata: Record<string, unknown> = {
      event_name: row.event_name,
      block_number: row.block_number,
      ...data,
    };

    return new Activity(
      id,
      userAddress.toLowerCase(),
      strategyId,
      txHash,
      status,
      metadata,
      undefined, // currentStep — not applicable for on-chain events
      undefined, // totalSteps
      row.timestamp ? new Date(row.timestamp) : undefined,
    );
  }
}
