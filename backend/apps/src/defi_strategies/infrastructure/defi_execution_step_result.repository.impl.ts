import { Injectable } from '@nestjs/common';
import type { DefiExecutionStepResultRow } from 'src/shared/infrastructure/database.types';
import type { SupabaseService } from '../../shared/infrastructure/supabase.service';
import { DefiExecutionStepResult } from '../domain/defi_execution_step_result.entity';
import type { DefiExecutionStepResultRepository } from '../domain/defi_execution_step_result.repository';

@Injectable()
export class DefiExecutionStepResultRepositoryImpl implements DefiExecutionStepResultRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async save(stepResult: DefiExecutionStepResult): Promise<DefiExecutionStepResult> {
    const { error, data } = await this.supabaseService
      .getClient()
      .from('defi_execution_step_results')
      .upsert({
        id: stepResult.id,
        execution_id: stepResult.execution_id,
        step_index: stepResult.step_index,
        parachain_id: stepResult.parachain_id,
        pallet: stepResult.pallet,
        call: stepResult.call,
        status: stepResult.status,
        output_assets: stepResult.output_assets,
        error_message: stepResult.error_message,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create DefiExecutionStepResult: ${error.message}`);
    }

    const row = data as DefiExecutionStepResultRow;
    return new DefiExecutionStepResult(
      row.id,
      row.execution_id,
      row.step_index,
      row.parachain_id,
      row.pallet,
      row.call,
      row.status,
      row.output_assets,
      row.error_message,
    );
  }
}
