import { Injectable } from '@nestjs/common';
import type { DefiStrategyExecutionRow } from 'src/shared/infrastructure/database.types';
import { SupabaseService } from '../../shared/infrastructure/supabase.service';
import type { DefiExecutionStepResult } from '../domain/defi_execution_step_result.entity';
import { DefiStrategyExecution } from '../domain/defi_strategy_execution.entity';
import { DefiStrategyExecutionRepository } from '../domain/defi_strategy_execution.repository';

@Injectable()
export class DefiStrategyExecutionRepositoryImpl implements DefiStrategyExecutionRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async save(execution: DefiStrategyExecution) {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_strategy_executions')
      .upsert({
        id: execution.id,
        strategy_version_id: execution.strategy_version_id,
        extrinsic_hash: execution.extrinsic_hash,
        execution_status: execution.execution_status,
        executed_at: execution.executed_at,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to save execution: ${error.message}`);

    const row = data as DefiStrategyExecutionRow;
    return new DefiStrategyExecution(
      row.id,
      row.strategy_version_id,
      row.extrinsic_hash,
      row.execution_status,
      new Date(row.executed_at),
    );
  }

  async getByStrategyVersion(strategy_version_id: string): Promise<
    (DefiStrategyExecution & {
      defi_execution_step_results: DefiExecutionStepResult[];
    })[]
  > {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_strategy_executions')
      .select('*, defi_execution_step_results(*)')
      .eq('strategy_version_id', strategy_version_id)
      .order('executed_at', { ascending: false });

    if (error) throw new Error(`Failed to get executions: ${error.message}`);

    return (data || []) as (DefiStrategyExecution & {
      defi_execution_step_results: DefiExecutionStepResult[];
    })[];
  }

  async update(id: string, updates: Partial<DefiStrategyExecution>) {
    const updateData: Record<string, unknown> = {};
    if (updates.extrinsic_hash !== undefined) updateData.extrinsic_hash = updates.extrinsic_hash;
    if (updates.execution_status !== undefined)
      updateData.execution_status = updates.execution_status;

    const { data, error } = await this.supabase
      .getClient()
      .from('defi_strategy_executions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update execution: ${error.message}`);

    const row = data as DefiStrategyExecutionRow;
    return new DefiStrategyExecution(
      row.id,
      row.strategy_version_id,
      row.extrinsic_hash,
      row.execution_status,
      new Date(row.executed_at),
    );
  }
}
