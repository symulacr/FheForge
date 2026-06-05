import { Test, type TestingModule } from "@nestjs/testing";
import { MarketsService } from "../markets/markets.service";
import { SupabaseService } from "../shared/infrastructure/supabase.service";
import { StatsController } from "./stats.controller";
import { StatsService } from "./stats.service";

const marketsServiceMock = {
	getAllMarkets: jest.fn(),
};

function createSupabaseCountMock(counts: Record<string, number | null>) {
	const makeResult = (table: string) => ({ count: counts[table] ?? null, error: null });
	return {
		getClient: jest.fn(() => ({
			from: jest.fn((table: string) => ({
				select: jest.fn(() => {
					const result = makeResult(table);
					const chainable = {
						eq: jest.fn(() => Promise.resolve(makeResult(table))),
					};
					return Object.assign(Promise.resolve(result), chainable);
				}),
			})),
		})),
	};
}

describe("StatsController", () => {
	let controller: StatsController;

	async function compile(supabaseMock = createSupabaseCountMock({})) {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [StatsController],
			providers: [
				StatsService,
				{ provide: MarketsService, useValue: marketsServiceMock },
				{ provide: SupabaseService, useValue: supabaseMock },
			],
		}).compile();

		controller = module.get<StatsController>(StatsController);
	}

	beforeEach(async () => {
		jest.clearAllMocks();
		marketsServiceMock.getAllMarkets.mockResolvedValue([]);
		await compile();
	});

	it("should be defined", () => {
		expect(controller).toBeDefined();
	});

	describe("GET /stats", () => {
		it("should return nullable protocol stats when real sources are unavailable", async () => {
			const result = await controller.getStats();
			expect(result).toMatchObject({
				tvlUsd: null,
				activeMarkets: null,
				encryptedOps: null,
				permitDecryptsDay: null,
				poolTvls: {},
				status: "partial",
			});
			expect(result.missingFields).toContain("activeMarkets");
			expect(result.missingFields).toContain("encryptedOps");
		});

		it("should aggregate TVL from market service and counts from Supabase", async () => {
			marketsServiceMock.getAllMarkets.mockResolvedValue([
				{ asset: "USDC", tvl: 100 },
				{ asset: "WETH", tvl: 250 },
			]);
			await compile(
				createSupabaseCountMock({
					users: 3,
					defi_strategies: 2,
					defi_strategy_executions: 1,
				}),
			);

			const result = await controller.getStats();
			expect(result.tvlUsd).toBe(350);
			expect(result.totalUsers).toBe(3);
			expect(result.activeMarkets).toBe(2);
			expect(result.activeStrategies).toBe(2);
			expect(result.totalDeployments).toBe(1);
			expect(result.poolTvls).toEqual({ USDC: 100, WETH: 250 });
		});

		it("should cache results within TTL", async () => {
			marketsServiceMock.getAllMarkets.mockResolvedValue([{ asset: "USDC", tvl: 100 }]);
			const first = await controller.getStats();
			marketsServiceMock.getAllMarkets.mockResolvedValue([{ asset: "USDC", tvl: 999 }]);
			const second = await controller.getStats();
			expect(second).toEqual(first);
		});
	});
});
