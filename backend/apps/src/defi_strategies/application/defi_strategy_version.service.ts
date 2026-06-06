import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/shared/infrastructure/supabase.service';
import { v4 as uuidv4 } from 'uuid';
import { DefiStrategyVersion } from '../domain/defi_strategy_version.entity';
import { DefiStrategyVersionRepository } from '../domain/defi_strategy_version.repository';
import type { CreateDefiStrategyVersionDto } from '../interfaces/dto/create_defi_strategy_version.dto';

@Injectable()
export class DefiStrategyVersionService {
  constructor(
    private readonly defiStrategyVersionRepository: DefiStrategyVersionRepository,
    private readonly supabase: SupabaseService,
  ) {}

  public async getNextVersionNumber(strategy_id: string): Promise<number> {
    const { data, error } = await this.supabase
      .getClient()
      .from('defi_strategy_versions')
      .select('version')
      .eq('strategy_id', strategy_id)
      .order('version', { ascending: false })
      .limit(1)
      .single<{ version: number }>();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch latest version: ${error.message}`);
    }

    if (!data) {
      return 1;
    }

    return data.version + 1;
  }

  public async createStrategyVersion(
    data: CreateDefiStrategyVersionDto,
  ): Promise<DefiStrategyVersion> {
    const versionNumber = await this.getNextVersionNumber(data.strategy_id);

    return this.defiStrategyVersionRepository.save(
      new DefiStrategyVersion(
        uuidv4(),
        data.strategy_id,
        versionNumber,
        data.workflow_json,
        new Date(),
        data.workflow_graph,
      ),
    );
  }
}
