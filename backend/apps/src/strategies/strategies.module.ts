import { Module } from '@nestjs/common';
import { SupabaseModule } from '../shared/supabase.module';
import { RewardsService } from './application/rewards.service';
import { StrategyService } from './application/strategy.service';
import { StrategiesRepository } from './domain/strategies.repository';
import { StrategiesRepositoryImplement } from './infrastructure/strategies.repository.impl';
import { StrategiesController } from './interfaces/stategies.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [StrategiesController],
  providers: [
    StrategyService,
    RewardsService,
    { provide: StrategiesRepository, useClass: StrategiesRepositoryImplement },
  ],
  exports: [StrategyService, RewardsService],
})
export class StrategiesModule {}
