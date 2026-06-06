import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../shared/infrastructure/supabase.service';
import { DefiModule } from '../domain/defi_modules.entity';
import { DefiModulesRepository } from '../domain/defi_modules.repository';

type ModuleRow = {
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
};

function mapModule(row: ModuleRow): DefiModule {
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

@Injectable()
export class DefiModulesRepositoryImplement implements DefiModulesRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(): Promise<DefiModule[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_modules')
      .select('*');

    if (error) throw new Error(`Failed to fetch DefiModules: ${error.message}`);

    return ((data ?? []) as unknown as ModuleRow[]).map(mapModule);
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

    return mapModule(data as ModuleRow);
  }

  async findById(id: string): Promise<DefiModule | null> {
    const { error, data } = await this.supabase
      .getClient()
      .from('defi_modules')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch DefiModule: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException('Defi Module not found');
    }

    return mapModule(data as ModuleRow);
  }
}
