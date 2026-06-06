import { Module } from '@nestjs/common';
import { SupabaseModule } from '../shared/supabase.module';
import { DefiTokenService } from './application/defi_token.service';
import { DefiTokenRepository } from './domain/defi_token.repository';
import { DefiTokenRepositoryImpl } from './infrastructure/defi_token.repository.impl';

@Module({
  imports: [SupabaseModule],
  providers: [
    DefiTokenService,
    {
      provide: DefiTokenRepository,
      useClass: DefiTokenRepositoryImpl,
    },
  ],
  exports: [DefiTokenService],
})
export class DefiTokenModule {}
