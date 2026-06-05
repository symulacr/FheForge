import { Injectable } from '@nestjs/common';
import type { DefiModuleActionRow } from 'src/shared/infrastructure/database.types';
import { SupabaseService } from '../../shared/infrastructure/supabase.service';
import { DefiModuleAction } from '../domain/defi_module_actions.entity';
import { DefiModuleActionsRepository } from '../domain/defi_module_actions.repository';

@Injectable()
export class DefiModuleActionsRepositoryImplement implements DefiModuleActionsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  public async save(defiModuleAction: DefiModuleAction): Promise<DefiModuleAction> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_module_actions')
      .upsert({
        id: defiModuleAction.id,
        module_id: defiModuleAction.module_id,
        name: defiModuleAction.name,
        created_at: defiModuleAction.created_at,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save DefiModuleAction: ${error.message}`);
    }

    const row = data as DefiModuleActionRow;
    return new DefiModuleAction(
      row.id,
      row.module_id,
      row.name ?? '',
      '',
      '',
      '',
      {},
      '',
      true,
      new Date(row.created_at),
    );
  }
}
