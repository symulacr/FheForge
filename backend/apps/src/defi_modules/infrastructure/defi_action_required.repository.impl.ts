import { Injectable } from '@nestjs/common';
import type { DefiActionRequiredRow } from 'src/shared/infrastructure/database.types';
import { SupabaseService } from '../../shared/infrastructure/supabase.service';
import { DefiActionRequired } from '../domain/defi_action_required.entity';
import type { DefiActionRequiredRepository } from '../domain/defi_action_required.repository';
import type { DefiModuleAction } from '../domain/defi_module_actions.entity';

@Injectable()
export class DefiActionRequiredRepositoryImplement implements DefiActionRequiredRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async save(defiActionRequired: DefiActionRequired): Promise<DefiActionRequired> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_action_required')
      .upsert({
        id: defiActionRequired.id,
        action_id: defiActionRequired.action_id,
        module_id: defiActionRequired.module_id,
        action_required_id: defiActionRequired.action_required_id,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save DefiActionRequired: ${error.message}`);
    }

    const row = data as DefiActionRequiredRow;
    return new DefiActionRequired(row.id, row.action_id, row.module_id, row.action_required_id);
  }

  async findByActionId(actionId: string): Promise<DefiActionRequired[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_action_required')
      .select('*')
      .eq('action_id', actionId);

    if (error) {
      throw new Error(`Failed to find DefiActionRequired by action_id: ${error.message}`);
    }

    return (data || []).map(
      (item: DefiActionRequiredRow) =>
        new DefiActionRequired(item.id, item.action_id, item.module_id, item.action_required_id),
    );
  }

  async findRequiredActionsByActionId(actionId: string): Promise<DefiModuleAction[]> {
    const { data: actionRequired, error } = await this.supabase
      .getClient()
      .from('defi_action_required')
      .select('defi_module_actions:action_required_id(id)')
      .eq('action_id', actionId);

    if (error) {
      throw new Error(`Failed to find required actions: ${error.message}`);
    }

    type ActionRequiredJoinRow = {
      defi_module_actions: { id: string } | { id: string }[] | null;
    };
    const requiredActionIds = new Set<string>();
    for (const row of (actionRequired ?? []) as ActionRequiredJoinRow[]) {
      const joined = row.defi_module_actions;
      if (!joined) continue;
      if (Array.isArray(joined)) {
        for (const action of joined) requiredActionIds.add(action.id);
      } else {
        requiredActionIds.add(joined.id);
      }
    }

    const { data: defiModules } = await this.supabase
      .getClient()
      .from('defi_modules')
      .select(`*,
      defi_module_actions(
        *,
        defi_pairs (
          id,
          token_in:defi_token!defi_pairs_token_in_id_fkey (*),
          token_out:defi_token!defi_pairs_token_out_id_fkey (*)
        )
      )`);

    type ModuleWithActions = {
      defi_module_actions: { id: string }[];
    } & Record<string, unknown>;

    const filteredData = (defiModules as ModuleWithActions[] | null)?.map((item) => ({
      ...item,
      defi_module_actions:
        requiredActionIds.size > 0
          ? item.defi_module_actions.filter((defiAction) => requiredActionIds.has(defiAction.id))
          : item.defi_module_actions,
    }));

    return (filteredData ?? []) as unknown as DefiModuleAction[];
  }
}
