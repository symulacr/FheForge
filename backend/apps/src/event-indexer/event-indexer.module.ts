import { Module } from '@nestjs/common';
import { EventIndexerService } from './event-indexer.service';
import { SupabaseModule } from '../shared/supabase.module';

@Module({
  imports: [SupabaseModule],
  providers: [EventIndexerService],
  exports: [EventIndexerService],
})
export class EventIndexerModule {}
