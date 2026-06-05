import { Injectable, NotFoundException } from '@nestjs/common';
import { DefiToken } from 'src/defi_token/domain/defi_token.entity';
import { SupabaseService } from '../../shared/infrastructure/supabase.service';
import { DefiModuleAction } from '../domain/defi_module_actions.entity';
import { DefiModule } from '../domain/defi_modules.entity';
import type { DefiModulesRepository } from '../domain/defi_modules.repository';
import type { DefiPair } from '../domain/defi_pairs.entity';

type ModuleJoinRow = {
  id: string;
  name: string;
  protocol: string;
  category: string;
  parachain_id: number;
  icon_url: string;
  description: string;
  website_url: string;
  is_active: boolean;
  created_at: string;
  defi_module_actions: Array<{
    id: string;
    module_id: string;
    name: string;
    pallet: string;
    call: string;
    description: string;
    param_schema: Record<string, unknown>;
    risk_level: string;
    is_active: boolean;
    created_at: string;
    defi_pairs: Array<{
      id: string;
      token_in: { id: string; name: string; asset_id: string };
      token_out: { id: string; name: string; asset_id: string };
    }>;
  }>;
};

type ModuleWithJoins = DefiModule & {
  defi_module_actions: (DefiModuleAction & {
    defi_pairs: (Pick<DefiPair, 'id'> & {
      token_in: DefiToken;
      token_out: DefiToken;
    })[];
  })[];
};

const SELECT_WITH_JOINS = `
  *,
  defi_module_actions (
    *,
    defi_pairs (
      id,
      token_in:defi_token!defi_pairs_token_in_id_fkey (*),
      token_out:defi_token!defi_pairs_token_out_id_fkey (*)
    )
  )
`;

function mapModule(row: ModuleJoinRow): ModuleWithJoins {
  const module = new DefiModule(
    row.id,
    row.name,
    row.protocol,
    row.category,
    row.parachain_id,
    row.icon_url,
    row.description,
    row.website_url,
    row.is_active,
    new Date(row.created_at),
  ) as ModuleWithJoins;

  module.defi_module_actions = row.defi_module_actions.map((action) => {
    const entity = new DefiModuleAction(
      action.id,
      action.module_id,
      action.name,
      action.pallet,
      action.call,
      action.description,
      action.param_schema,
      action.risk_level,
      action.is_active,
      new Date(action.created_at),
    ) as DefiModuleAction & {
      defi_pairs: (Pick<DefiPair, 'id'> & {
        token_in: DefiToken;
        token_out: DefiToken;
      })[];
    };
    entity.defi_pairs = action.defi_pairs.map((pair) => ({
      id: pair.id,
      token_in: new DefiToken(pair.token_in.id, pair.token_in.name, pair.token_in.asset_id),
      token_out: new DefiToken(pair.token_out.id, pair.token_out.name, pair.token_out.asset_id),
    }));
    return entity;
  });

  return module;
}

@Injectable()
export class DefiModulesRepositoryImplement implements DefiModulesRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(): Promise<ModuleWithJoins[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_modules')
      .select(SELECT_WITH_JOINS);

    if (error) throw new Error(`Failed to fetch DefiModules: ${error.message}`);

    return ((data ?? []) as unknown as ModuleJoinRow[]).map(mapModule);
  }

  async save(defiModule: DefiModule): Promise<DefiModule> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_modules')
      .upsert({
        id: defiModule.id,
        name: defiModule.name,
        protocol: defiModule.protocol,
        category: defiModule.category,
        parachain_id: defiModule.parachain_id,
        icon_url: defiModule.icon_url,
        description: defiModule.description,
        website_url: defiModule.website_url,
        is_active: defiModule.is_active,
        created_at: defiModule.created_at?.toISOString?.() ?? new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save DefiModule: ${error.message}`);
    }

    const row = data as ModuleJoinRow;
    return new DefiModule(
      row.id,
      row.name,
      row.protocol,
      row.category,
      row.parachain_id,
      row.icon_url,
      row.description,
      row.website_url,
      row.is_active,
      new Date(row.created_at),
    );
  }

  async findById(id: string): Promise<ModuleWithJoins | null> {
    const { error, data } = await this.supabase
      .getClient()
      .from('defi_modules')
      .select(SELECT_WITH_JOINS)
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch DefiModule: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException('Defi Module not found');
    }

    return mapModule(data);
  }
}
