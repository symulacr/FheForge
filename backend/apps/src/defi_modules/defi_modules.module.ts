import { Module } from '@nestjs/common';
import { SupabaseModule } from 'src/shared/supabase.module';
import { DefiTokenModule } from '../defi_token/defi_token.module';
import { FhenixStrategyService } from '../shared/infrastructure/fhenix-strategy.service';
import { DefiActionRequiredService } from './application/defi_action_required.service';
import { DefiModuleActionsService } from './application/defi_module_actions.service';
import { DefiModulesService } from './application/defi_modules.service';
import { DefiPairsService } from './application/defi_pairs.service';
import { DefiActionRequiredRepository } from './domain/defi_action_required.repository';
import { DefiModuleActionsRepository } from './domain/defi_module_actions.repository';
import { DefiModulesRepository } from './domain/defi_modules.repository';
import { DefiPairsRepository } from './domain/defi_pairs.repository';
import { DefiActionRequiredRepositoryImplement } from './infrastructure/defi_action_required.repository.impl';
import { DefiModuleActionsRepositoryImplement } from './infrastructure/defi_module_actions.repository.impl';
import { DefiModulesRepositoryImplement } from './infrastructure/defi_modules.repository.impl';
import { DefiPairsRepositoryImpl } from './infrastructure/defi_pairs.repository.impl';
import { DefiModulesController } from './interfaces/defi_modules.controller';

@Module({
  imports: [SupabaseModule, DefiTokenModule],
  providers: [
    {
      provide: DefiModulesRepository,
      useClass: DefiModulesRepositoryImplement,
    },
    {
      provide: DefiModuleActionsRepository,
      useClass: DefiModuleActionsRepositoryImplement,
    },
    {
      provide: DefiPairsRepository,
      useClass: DefiPairsRepositoryImpl,
    },
    {
      provide: DefiActionRequiredRepository,
      useClass: DefiActionRequiredRepositoryImplement,
    },
    FhenixStrategyService,
    DefiModulesService,
    DefiModuleActionsService,
    DefiPairsService,
    DefiActionRequiredService,
  ],
  controllers: [DefiModulesController],
  exports: [DefiPairsService, DefiModulesService, DefiModuleActionsService],
})
export class DefiModulesModule {}
