import { Injectable, Logger } from '@nestjs/common';
import type { ActivityRow } from 'src/shared/infrastructure/database.types';
import type { SupabaseService } from 'src/shared/infrastructure/supabase.service';
import { Activity, type ActivityStatus } from '../domain/activity.entity';
import type { ActivityRepository } from '../domain/activity.repository';

@Injectable()
export class ActivityRepositoryImplement implements ActivityRepository {
  private readonly logger = new Logger(ActivityRepositoryImplement.name);
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(): Promise<Activity[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('activities')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch activities: ${error.message}`);
    }

    return (data || []).map((row: ActivityRow) => this.mapRowToEntity(row));
  }

  async findByFilter(filters: {
    strategyId?: string;
    userAddress?: string;
  }): Promise<Activity[]> {
    try {
      let query = this.supabase.getClient().from('activities').select('*');
      if (filters.strategyId) {
        query = query.eq('strategy_id', filters.strategyId);
      }
      if (filters.userAddress) {
        query = query.eq('user_address', filters.userAddress);
      }
      const { data, error } = await query.order('created_at', {
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
      return (data || []).map((row: ActivityRow) => this.mapRowToEntity(row));
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
      const { data, error } = await this.supabase
        .getClient()
        .from('activities')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToEntity(data as ActivityRow);
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
        .from('activities')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (strategyId) {
        query = query.eq('strategy_id', strategyId);
      }

      if (userAddress) {
        query = query.eq('user_address', userAddress);
      }

      const { data, count, error } = await query;

      if (error) {
        return { data: [], total: 0 };
      }

      return {
        data: (data ?? []).map((row: ActivityRow) => this.mapRowToEntity(row)),
        total: count ?? 0,
      };
    } catch {
      return { data: [], total: 0 };
    }
  }

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

  private mapRowToEntity(row: ActivityRow): Activity {
    const txHash: string[] = Array.isArray(row.tx_hash)
      ? row.tx_hash
      : row.tx_hash
        ? [row.tx_hash]
        : [];

    return new Activity(
      row.id,
      row.user_address,
      row.strategy_id,
      txHash,
      row.status as ActivityStatus,
      row.metadata ?? undefined,
      row.current_step ?? undefined,
      row.total_steps ?? undefined,
      row.created_at ? new Date(row.created_at) : undefined,
    );
  }
}
