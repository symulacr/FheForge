import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/infrastructure/supabase.service';
import { DefiStrategySimulationSnapshot } from '../domain/defi_strategy_simulation_snapshot.entity';
import { DefiStrategySimulationSnapshotRepository } from '../domain/defi_strategy_simulation_snapshot.repository';
import type { DefiStrategySimulationSnapshotRow } from 'src/shared/infrastructure/database.types';

function mapRow(
  row: DefiStrategySimulationSnapshotRow,
): DefiStrategySimulationSnapshot {
  return new DefiStrategySimulationSnapshot(
    row.id,
    row.strategy_version_id,
    row.snapshot_type,
    row.data,
    new Date(row.created_at),
  );
}

@Injectable()
export class DefiStrategySimulationSnapshotRepositoryImpl implements DefiStrategySimulationSnapshotRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async save(
    snapshot: DefiStrategySimulationSnapshot,
  ): Promise<DefiStrategySimulationSnapshot> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_strategy_simulation_snapshots')
      .upsert({
        id: snapshot.id,
        strategy_version_id: snapshot.strategy_version_id,
        snapshot_type: snapshot.snapshot_type,
        data: {
          estimated_outputs: snapshot.estimated_outputs,
          estimated_weight: snapshot.estimated_weight.toString(),
          estimated_fee: snapshot.estimated_fee.toString(),
          chain_state_ref: snapshot.chain_state_ref,
        },
        created_at: snapshot.created_at,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to save snapshot: ${error.message}`);
    return mapRow(data as DefiStrategySimulationSnapshotRow);
  }

  async getByStrategyVersion(
    strategy_version_id: string,
  ): Promise<DefiStrategySimulationSnapshot[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_strategy_simulation_snapshots')
      .select('*')
      .eq('strategy_version_id', strategy_version_id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch snapshots: ${error.message}`);

    return ((data ?? []) as DefiStrategySimulationSnapshotRow[]).map(mapRow);
  }

  async getById(id: string): Promise<DefiStrategySimulationSnapshot | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_strategy_simulation_snapshots')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get snapshot: ${error.message}`);
    }
    if (!data) return null;
    return mapRow(data as DefiStrategySimulationSnapshotRow);
  }
}
