import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ActivitiesModule } from "./activities/activities.module";
import { AiStrategyBuilderModule } from "./ai-strategy-builder/ai-strategy-builder.module";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { DefiModulesModule } from "./defi_modules/defi_modules.module";
import { DefiStrategiesModule } from "./defi_strategies/defi_strategies.module";
import { DefiTokenModule } from "./defi_token/defi_token.module";
import { EventIndexerModule } from "./event-indexer/event-indexer.module";
import { MetricsController } from "./metrics.controller";
import { FhenixStrategyService } from "./shared/infrastructure/fhenix-strategy.service";
import { SupabaseModule } from "./shared/supabase.module";
import { StrategiesModule } from "./strategies/strategies.module";
import { UsersModule } from "./users/users.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			envFilePath: `.env.${process.env.NODE_ENV || "development"}`,
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
		EventIndexerModule,
	],
	controllers: [AppController, MetricsController],
	providers: [
		FhenixStrategyService,
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
export class AppModule {}
