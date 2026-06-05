import { Module } from '@nestjs/common';
import { SupabaseModule } from '../shared/supabase.module';
import { EventIndexerService } from './event-indexer.service';

@Module({
  imports: [SupabaseModule],
  providers: [EventIndexerService],
  exports: [EventIndexerService],
})
export class EventIndexerModule {}
