import { Injectable } from '@nestjs/common';
import type { DefiTokenRow } from 'src/shared/infrastructure/database.types';
import { SupabaseService } from '../../shared/infrastructure/supabase.service';
import { DefiToken } from '../domain/defi_token.entity';
import type { DefiTokenRepository } from '../domain/defi_token.repository';

@Injectable()
export class DefiTokenRepositoryImpl implements DefiTokenRepository {
  constructor(private readonly supabase: SupabaseService) {}

  public async save(defiToken: DefiToken): Promise<DefiToken> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_token')
      .upsert({
        id: defiToken.id,
        name: defiToken.name,
        asset_id: defiToken.asset_id,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save DefiToken: ${error.message}`);
    }

    return data as DefiToken;
  }

  public async findById(id: string): Promise<DefiToken | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_token')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find DefiToken by id: ${error.message}`);
    }

    const row = data as DefiTokenRow;
    return new DefiToken(row.id, row.name, row.asset_id);
  }

  public async findByAssetId(assetId: string): Promise<DefiToken | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_token')
      .select('*')
      .eq('asset_id', assetId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find DefiToken by asset_id: ${error.message}`);
    }

    const row = data as DefiTokenRow;
    return new DefiToken(row.id, row.name, row.asset_id);
  }

  public async findAll(): Promise<DefiToken[]> {
    const { data, error } = await this.supabase.getClient().from('defi_token').select('*');

    if (error) {
      throw new Error(`Failed to fetch all DefiTokens: ${error.message}`);
    }

    return (data || []).map((row: DefiTokenRow) => new DefiToken(row.id, row.name, row.asset_id));
  }
}
