import { ApiProperty } from "@nestjs/swagger";

export class StatsResponseDto {
	@ApiProperty({
		example: 12_500_000,
		nullable: true,
		description: "Total value locked in USD, or null when reserve/price data is unavailable",
	})
	tvlUsd: number | null;

	@ApiProperty({
		example: 342,
		nullable: true,
		description: "Total registered users, or null when database count is unavailable",
	})
	totalUsers: number | null;

	@ApiProperty({
		example: 4,
		nullable: true,
		description: "Active lending markets, or null when token registry is unavailable",
	})
	activeMarkets: number | null;

	@ApiProperty({
		example: 27,
		nullable: true,
		description: "Published strategies, or null when database count is unavailable",
	})
	activeStrategies: number | null;

	@ApiProperty({
		example: null,
		nullable: true,
		description: "Cumulative encrypted operations; null until indexed from chain events",
	})
	encryptedOps: number | null;

	@ApiProperty({
		example: null,
		nullable: true,
		description: "Permit decrypts in last 24h; null until permit decrypt events are indexed",
	})
	permitDecryptsDay: number | null;

	@ApiProperty({
		example: 89,
		nullable: true,
		description: "Total strategy deployments, or null when execution count is unavailable",
	})
	totalDeployments: number | null;

	@ApiProperty({
		description: "TVL per pool in USD for registry markets with live reserve and price data",
		additionalProperties: { type: "number", nullable: true },
	})
	poolTvls: Record<string, number | null>;

	@ApiProperty({
		example: "partial",
		description: "Data completeness for protocol stats",
		enum: ["live", "partial", "unavailable"],
	})
	status: "live" | "partial" | "unavailable";

	@ApiProperty({
		example: ["encryptedOps", "permitDecryptsDay"],
		description: "Fields intentionally returned as null because no real source is available",
		type: [String],
	})
	missingFields: string[];
}
