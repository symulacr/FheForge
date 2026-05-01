import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client: SupabaseClient | null = null;
  private readonly logger = new Logger(SupabaseService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_KEY');
    if (!url || !key) {
      this.logger.warn('SUPABASE_URL/KEY not set — Supabase features disabled');
      return;
    }
    this.client = createClient(url, key);
  }

  getClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase not configured');
    return this.client;
  }
}
