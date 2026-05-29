import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SupabaseService } from "./infrastructure/supabase.service";

@Module({
	imports: [ConfigModule],
	providers: [SupabaseService],
	exports: [SupabaseService],
})
export class SupabaseModule {}
