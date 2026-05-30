import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client: SupabaseClient | null = null;
  private readonly logger = new Logger(SupabaseService.name);

  constructor() {}

  onModuleInit() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
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
