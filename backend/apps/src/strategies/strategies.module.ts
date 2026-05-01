import { Module } from '@nestjs/common';
import { StrategiesController } from './interfaces/stategies.controller';
import { StrategyService } from './application/strategy.service';
import { StrategiesRepository } from './domain/strategies.repository';
import { StrategiesRepositoryImplement } from './infrastructure/strategies.repository.impl';
import { SupabaseModule } from '../shared/supabase.module';
import { RewardsService } from './application/rewards.service';
import { FhenixStrategyService } from '../shared/infrastructure/fhenix-strategy.service';

@Module({
  imports: [SupabaseModule],
  controllers: [StrategiesController],
  providers: [
    StrategyService,
    RewardsService,
    FhenixStrategyService,
    { provide: StrategiesRepository, useClass: StrategiesRepositoryImplement },
  ],
  exports: [StrategyService, RewardsService, FhenixStrategyService],
})
export class StrategiesModule {}
