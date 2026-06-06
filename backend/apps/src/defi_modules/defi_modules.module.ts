import { Module } from '@nestjs/common';
import { SupabaseModule } from 'src/shared/supabase.module';
import { DefiModulesService } from './application/defi_modules.service';
import { DefiModulesRepository } from './domain/defi_modules.repository';
import { DefiModulesRepositoryImplement } from './infrastructure/defi_modules.repository.impl';
import { DefiModulesController } from './interfaces/defi_modules.controller';

@Module({
  imports: [SupabaseModule],
  providers: [
    {
      provide: DefiModulesRepository,
      useClass: DefiModulesRepositoryImplement,
    },
    DefiModulesService,
  ],
  controllers: [DefiModulesController],
  exports: [DefiModulesService],
})
export class DefiModulesModule {}
