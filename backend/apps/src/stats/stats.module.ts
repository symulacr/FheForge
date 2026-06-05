import { Module } from "@nestjs/common";
import { MarketsModule } from "../markets/markets.module";
import { SupabaseModule } from "../shared/supabase.module";
import { StatsController } from "./stats.controller";
import { StatsService } from "./stats.service";

@Module({
	imports: [MarketsModule, SupabaseModule],
	controllers: [StatsController],
	providers: [StatsService],
	exports: [StatsService],
})
export class StatsModule {}
