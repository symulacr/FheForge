import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ActivitiesModule } from './activities/activities.module';
import { AiStrategyBuilderModule } from './ai-strategy-builder/ai-strategy-builder.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DefiModulesModule } from './defi_modules/defi_modules.module';
import { DefiStrategiesModule } from './defi_strategies/defi_strategies.module';
import { DefiTokenModule } from './defi_token/defi_token.module';
import { EventIndexerModule } from './event-indexer/event-indexer.module';
import { GovernanceModule } from './governance/governance.module';
import { MarketsModule } from './markets/markets.module';
import { MetricsController } from './metrics.controller';
import { SharedModule } from './shared/shared.module';
import { StatsModule } from './stats/stats.module';
import { SupabaseModule } from './shared/supabase.module';
import { StrategiesModule } from './strategies/strategies.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    SharedModule,
    AuthModule,
    SupabaseModule,
    UsersModule,
    StrategiesModule,
    ActivitiesModule,
    DefiModulesModule,
    DefiStrategiesModule,
    DefiTokenModule,
    AiStrategyBuilderModule,
    EventIndexerModule,
    StatsModule,
    MarketsModule,
    GovernanceModule,
  ],
  controllers: [AppController, MetricsController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger('MigrationRunner');

  async onModuleInit() {
    if (process.env.SKIP_MIGRATIONS === '1') return;
    try {
      const { execSync } = await import('node:child_process');
      const path = await import('node:path');
      const script = path.join(__dirname, '..', 'migrations', 'run-migration.js');
      this.logger.log('Running pending migrations...');
      execSync(`node ${script}`, { stdio: 'inherit', env: process.env });
      this.logger.log('Migrations complete');
    } catch (err) {
      this.logger.warn('Migration runner skipped or failed (non-fatal): ' + (err as Error).message);
    }
  }
}
