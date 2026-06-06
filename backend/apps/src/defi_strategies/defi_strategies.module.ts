import { Module } from '@nestjs/common';
import { SupabaseModule } from '../shared/supabase.module';
import { UsersModule } from '../users/users.module';
import { DefiStrategiesService } from './application/defi_strategies.service';
import { DefiStrategyVersionService } from './application/defi_strategy_version.service';
import { DefiSimulationEngine } from './application/defi-simulation-engine.service';
import { BorrowSimulator } from './application/simulators/borrow-simulator';
import { EnableEModeSimulator } from './application/simulators/enable-e-mode-simulator';
import { JoinStrategySimulator } from './application/simulators/join-strategy-simulator';
import { SupplySimulator } from './application/simulators/supply-simulator';
import { SwapSimulator } from './application/simulators/swap-simulator';
import { DefiStrategiesRepository } from './domain/defi_strategies.repository';
import { DefiStrategyVersionRepository } from './domain/defi_strategy_version.repository';
import { DefiStrategiesRepositoryImplement } from './infrastructure/defi_strategies.repository.impl';
import { DefiStrategyVersionRepositoryImpl } from './infrastructure/defi_strategy_version.repository.impl';
import { DefiStrategiesController } from './interfaces/defi_strategies.controller';

@Module({
  imports: [SupabaseModule, UsersModule],
  controllers: [DefiStrategiesController],
  providers: [
    DefiStrategiesService,
    DefiStrategyVersionService,
    SwapSimulator,
    JoinStrategySimulator,
    BorrowSimulator,
    SupplySimulator,
    EnableEModeSimulator,
    DefiSimulationEngine,
    {
      provide: DefiStrategiesRepository,
      useClass: DefiStrategiesRepositoryImplement,
    },
    {
      provide: DefiStrategyVersionRepository,
      useClass: DefiStrategyVersionRepositoryImpl,
    },
  ],
})
export class DefiStrategiesModule {}
