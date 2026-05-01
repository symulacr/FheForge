import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SupabaseModule } from './shared/supabase.module';
import { UsersModule } from './users/users.module';
import { ConfigModule } from '@nestjs/config';
import { StrategiesModule } from './strategies/strategies.module';
import { ActivitiesModule } from './activities/activities.module';
import { DefiModulesModule } from './defi_modules/defi_modules.module';
import { DefiStrategiesModule } from './defi_strategies/defi_strategies.module';
import { DefiTokenModule } from './defi_token/defi_token.module';
import { AiStrategyBuilderModule } from './ai-strategy-builder/ai-strategy-builder.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppController } from './app.controller';
import { FhenixStrategyService } from './shared/infrastructure/fhenix-strategy.service';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
    AuthModule,
    SupabaseModule,
    UsersModule,
    StrategiesModule,
    ActivitiesModule,
    DefiModulesModule,
    DefiStrategiesModule,
    DefiTokenModule,
    AiStrategyBuilderModule,
  ],
  controllers: [AppController],
  providers: [
    FhenixStrategyService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
