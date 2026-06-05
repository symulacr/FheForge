import { Injectable } from '@nestjs/common';
import type { DefiPairRow } from 'src/shared/infrastructure/database.types';
import type { SupabaseService } from '../../shared/infrastructure/supabase.service';
import { DefiPair } from '../domain/defi_pairs.entity';
import type { DefiPairsRepository } from '../domain/defi_pairs.repository';

function mapPair(row: DefiPairRow): DefiPair {
  return new DefiPair(row.id, '', row.token_in_id ?? undefined, row.token_out_id ?? undefined);
}

@Injectable()
export class DefiPairsRepositoryImpl implements DefiPairsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  public async save(defiPair: DefiPair): Promise<DefiPair> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_pairs')
      .upsert({
        id: defiPair.id,
        token_in_id: defiPair.token_in_id,
        token_out_id: defiPair.token_out_id,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save DefiPair: ${error.message}`);
    }

    return data as DefiPair;
  }

  public async findAll(): Promise<DefiPair[]> {
    const { data, error } = await this.supabase.getClient().from('defi_pairs').select('*');

    if (error) {
      throw new Error(`Failed to fetch DefiPairs: ${error.message}`);
    }

    return ((data ?? []) as DefiPairRow[]).map(mapPair);
  }

  public async findByActionId(actionId: string): Promise<DefiPair[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_pairs')
      .select('*')
      .eq('action_id', actionId);

    if (error) {
      throw new Error(`Failed to fetch DefiPairs by action: ${error.message}`);
    }

    return ((data ?? []) as DefiPairRow[]).map(mapPair);
  }

  public async findByTokenInId(tokenInId: string): Promise<DefiPair[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_pairs')
      .select('*')
      .eq('token_in_id', tokenInId);

    if (error) {
      throw new Error(`Failed to fetch DefiPairs by token_in: ${error.message}`);
    }

    return ((data ?? []) as DefiPairRow[]).map(mapPair);
  }

  public async findByTokenOutId(tokenOutId: string): Promise<DefiPair[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_pairs')
      .select('*')
      .eq('token_out_id', tokenOutId);

    if (error) {
      throw new Error(`Failed to fetch DefiPairs by token_out: ${error.message}`);
    }

    return ((data ?? []) as DefiPairRow[]).map(mapPair);
  }

  public async findByTokenPair(tokenInId: string, tokenOutId: string): Promise<DefiPair[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_pairs')
      .select('*')
      .eq('token_in_id', tokenInId)
      .eq('token_out_id', tokenOutId);

    if (error) {
      throw new Error(`Failed to fetch DefiPairs by token pair: ${error.message}`);
    }

    return ((data ?? []) as DefiPairRow[]).map(mapPair);
  }
}
