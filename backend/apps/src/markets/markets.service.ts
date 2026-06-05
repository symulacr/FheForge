import { Injectable, Logger, Optional, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Contract, formatUnits, JsonRpcProvider } from "ethers";
import { MarketResponseDto } from "./dtos/market-response.dto";
import { PriceResponseDto } from "./dtos/price-response.dto";

const TOKEN_REGISTRY_ABI = [
	"function getLendableTokens() view returns (address[])",
	"function tokens(address) view returns (address token,uint16 ltvBps,uint16 liquidationBonusBps,uint8 decimals,bool isLendable,bool isBorrowable,bool isCollateral,bool enabled,bytes32 pythPriceId,uint256 borrowCap,uint256 supplyCap)",
];

const PRICE_ORACLE_ABI = [
	"function getPriceUsd(address token) view returns (uint256 priceWad,uint64 updatedAt)",
	"function liquidationThresholdBps(address token) view returns (uint16)",
];

const LENDING_POOL_ABI = [
	"function liquidReserve(address token) view returns (uint256)",
	"function totalPlainBorrow(address token) view returns (uint256)",
];

const ERC20_ABI = [
	"function symbol() view returns (string)",
	"function decimals() view returns (uint8)",
];

const WAD_DECIMALS = 18;

type TokenInfo = {
	token: string;
	decimals: number;
	enabled: boolean;
	isLendable: boolean;
};

type MarketContracts = {
	tokenRegistry: Contract | null;
	priceOracle: Contract | null;
	lendingPool: Contract | null;
};

type MarketsStatus = {
	status: "live" | "empty" | "degraded" | "unavailable";
	cofheRpc: { configured: boolean; status: "configured" | "missing_config" };
	tokenRegistry: {
		configured: boolean;
		reachable: boolean | null;
		status: "live" | "empty" | "unreachable" | "missing_config";
	};
	priceOracle: { configured: boolean; status: "configured" | "missing_config" };
	pool: { configured: boolean; status: "configured" | "missing_config" };
	tokenCount: number | null;
	missingDependencies: string[];
};

type TokenRegistryRead = {
	tokens: TokenInfo[];
	reachable: boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
	]);
}

@Injectable()
export class MarketsService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(MarketsService.name);
	private provider: JsonRpcProvider | null = null;
	private contracts: MarketContracts | null = null;
	private marketsCache: {
		data: MarketResponseDto[];
		expiresAt: number;
	} | null = null;
	private pricesCache: { data: PriceResponseDto[]; expiresAt: number } | null = null;
	private statusCache: { data: MarketsStatus; expiresAt: number } | null = null;
	private readonly cacheTtlMs = 5 * 60_000;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;

	constructor(@Optional() private readonly configService?: ConfigService) {}

	async onModuleInit(): Promise<void> {
		try {
			await this.getAllMarkets();
			await this.getPrices();
			this.logger.log("Markets cache pre-warmed");
		} catch (e) {
			this.logger.warn(`Markets pre-warm failed: ${(e as Error).message}`);
		}
		this.refreshTimer = setInterval(() => {
			this.getAllMarkets().catch((e) =>
				this.logger.warn(`Markets refresh failed: ${(e as Error).message}`),
			);
			this.getPrices().catch((e) =>
				this.logger.warn(`Prices refresh failed: ${(e as Error).message}`),
			);
		}, this.cacheTtlMs);
	}

	onModuleDestroy(): void {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
	}

	async getAllMarkets(): Promise<MarketResponseDto[]> {
		if (this.marketsCache && Date.now() < this.marketsCache.expiresAt) {
			return this.marketsCache.data;
		}

		const contracts = this.getContracts();
		if (!contracts.tokenRegistry) {
			return [];
		}

		const registryRead = await this.readLendableTokens(contracts.tokenRegistry);
		if (!registryRead.reachable) return [];

		const markets = await Promise.all(
			registryRead.tokens.map((token) => this.buildMarket(token, contracts)),
		);

		this.marketsCache = {
			data: markets,
			expiresAt: Date.now() + this.cacheTtlMs,
		};
		return markets;
	}

	async getPrices(): Promise<PriceResponseDto[]> {
		if (this.pricesCache && Date.now() < this.pricesCache.expiresAt) {
			return this.pricesCache.data;
		}

		const contracts = this.getContracts();
		if (!contracts.tokenRegistry) {
			return [];
		}

		const registryRead = await this.readLendableTokens(contracts.tokenRegistry);
		if (!registryRead.reachable) return [];

		const prices = await Promise.all(
			registryRead.tokens.map((token) => this.buildPrice(token, contracts.priceOracle)),
		);

		this.pricesCache = {
			data: prices,
			expiresAt: Date.now() + this.cacheTtlMs,
		};
		return prices;
	}

	async getStatus(): Promise<MarketsStatus> {
		if (this.statusCache && Date.now() < this.statusCache.expiresAt) {
			return this.statusCache.data;
		}

		const contracts = this.getContracts();
		const cofheRpcConfigured = Boolean(this.configService?.get<string>("COFHE_RPC"));
		const tokenRegistryConfigured = Boolean(
			this.configService?.get<string>("TOKEN_REGISTRY_ADDRESS"),
		);
		const priceOracleConfigured = Boolean(this.configService?.get<string>("PRICE_ORACLE_ADDRESS"));
		const poolConfigured = Boolean(this.configService?.get<string>("POOL_ADDRESS"));

		const registryRead = contracts.tokenRegistry
			? await this.readLendableTokens(contracts.tokenRegistry)
			: null;
		const tokenCount = registryRead?.reachable ? registryRead.tokens.length : null;
		const missingDependencies: string[] = [];
		if (!cofheRpcConfigured) missingDependencies.push("COFHE_RPC");
		if (!tokenRegistryConfigured || registryRead?.reachable === false) {
			missingDependencies.push("TOKEN_REGISTRY_ADDRESS");
		}
		if (!priceOracleConfigured) missingDependencies.push("PRICE_ORACLE_ADDRESS");
		if (!poolConfigured) missingDependencies.push("POOL_ADDRESS");

		const tokenRegistryStatus = !tokenRegistryConfigured
			? "missing_config"
			: registryRead?.reachable === false
				? "unreachable"
				: tokenCount === 0
					? "empty"
					: "live";
		const status =
			!cofheRpcConfigured || tokenRegistryStatus === "unreachable"
				? "unavailable"
				: missingDependencies.length > 0
					? "degraded"
					: tokenCount === 0
						? "empty"
						: "live";

		const data: MarketsStatus = {
			status,
			cofheRpc: {
				configured: cofheRpcConfigured,
				status: cofheRpcConfigured ? "configured" : "missing_config",
			},
			tokenRegistry: {
				configured: tokenRegistryConfigured,
				reachable: registryRead?.reachable ?? null,
				status: tokenRegistryStatus,
			},
			priceOracle: {
				configured: priceOracleConfigured,
				status: priceOracleConfigured ? "configured" : "missing_config",
			},
			pool: {
				configured: poolConfigured,
				status: poolConfigured ? "configured" : "missing_config",
			},
			tokenCount,
			missingDependencies,
		};

		this.statusCache = { data, expiresAt: Date.now() + this.cacheTtlMs };
		return data;
	}

	private getContracts(): MarketContracts {
		if (this.contracts) return this.contracts;

		const rpcUrl = this.configService?.get<string>("COFHE_RPC");
		if (!rpcUrl) {
			this.contracts = {
				tokenRegistry: null,
				priceOracle: null,
				lendingPool: null,
			};
			return this.contracts;
		}

		this.provider = new JsonRpcProvider(rpcUrl);
		const tokenRegistryAddress = this.configService?.get<string>("TOKEN_REGISTRY_ADDRESS");
		const priceOracleAddress = this.configService?.get<string>("PRICE_ORACLE_ADDRESS");
		const poolAddress = this.configService?.get<string>("POOL_ADDRESS");

		this.contracts = {
			tokenRegistry: tokenRegistryAddress
				? new Contract(tokenRegistryAddress, TOKEN_REGISTRY_ABI, this.provider)
				: null,
			priceOracle: priceOracleAddress
				? new Contract(priceOracleAddress, PRICE_ORACLE_ABI, this.provider)
				: null,
			lendingPool: poolAddress ? new Contract(poolAddress, LENDING_POOL_ABI, this.provider) : null,
		};

		if (!this.contracts.tokenRegistry) {
			this.logger.warn("TOKEN_REGISTRY_ADDRESS not set — market list unavailable");
		}
		if (!this.contracts.priceOracle) {
			this.logger.warn("PRICE_ORACLE_ADDRESS not set — market prices unavailable");
		}
		if (!this.contracts.lendingPool) {
			this.logger.warn("POOL_ADDRESS not set — market reserve data unavailable");
		}

		return this.contracts;
	}

	private async readLendableTokens(tokenRegistry: Contract): Promise<TokenRegistryRead> {
		try {
			const tokenAddresses = await withTimeout(
				tokenRegistry.getLendableTokens() as Promise<string[]>,
				10_000,
				[] as string[],
			);
			const tokenInfos = await Promise.all(
				tokenAddresses.map(async (tokenAddress) => {
					const info = await withTimeout(
						tokenRegistry.tokens(tokenAddress) as Promise<{
							decimals: bigint | number;
							enabled: boolean;
							isLendable: boolean;
						}>,
						10_000,
						{ decimals: 0, enabled: false, isLendable: false },
					);
					return {
						token: tokenAddress,
						decimals: Number(info.decimals),
						enabled: Boolean(info.enabled),
						isLendable: Boolean(info.isLendable),
					};
				}),
			);
			return {
				tokens: tokenInfos.filter((token) => token.enabled && token.isLendable),
				reachable: true,
			};
		} catch (error) {
			this.logger.warn(`Unable to read token registry markets: ${(error as Error).message}`);
			return { tokens: [], reachable: false };
		}
	}

	private async buildMarket(
		tokenInfo: TokenInfo,
		contracts: MarketContracts,
	): Promise<MarketResponseDto> {
		const [asset, reserve, borrowed, price, liquidationThreshold] = await Promise.all([
			this.getTokenSymbol(tokenInfo.token),
			this.getPoolValue(contracts.lendingPool, "liquidReserve", tokenInfo),
			this.getPoolValue(contracts.lendingPool, "totalPlainBorrow", tokenInfo),
			this.getOraclePrice(tokenInfo.token, contracts.priceOracle),
			this.getLiquidationThreshold(tokenInfo.token, contracts.priceOracle),
		]);

		const totalSuppliedNative = reserve === null || borrowed === null ? null : reserve + borrowed;
		const totalSupplied =
			totalSuppliedNative === null || price.price === null
				? null
				: totalSuppliedNative * price.price;
		const totalBorrowed = borrowed === null || price.price === null ? null : borrowed * price.price;
		const tvl = reserve === null || price.price === null ? null : reserve * price.price;
		const utilization =
			totalSuppliedNative === null || borrowed === null || totalSuppliedNative === 0
				? null
				: borrowed / totalSuppliedNative;

		const supplyAPY = Number(this.configService?.get("SUPPLY_APY_BPS", "650")) / 10000;
		const borrowAPY = Number(this.configService?.get("BORROW_APY_BPS", "550")) / 10000;

		// Health factor = (supplyValue * liquidationThreshold) / borrowValue
		const liqThreshold = liquidationThreshold !== null ? liquidationThreshold : 0;
		const healthFactor =
			totalBorrowed !== null && totalBorrowed > 0 && totalSupplied !== null && liqThreshold > 0
				? (totalSupplied * liqThreshold) / totalBorrowed
				: null;

		// Liquidation price = currentPrice * (1 - borrowValue / (supplyValue * liqThreshold))
		const liqPrice =
			totalBorrowed !== null &&
			totalBorrowed > 0 &&
			totalSupplied !== null &&
			totalSupplied > 0 &&
			price.price !== null &&
			liqThreshold > 0
				? price.price * (1 - totalBorrowed / (totalSupplied * liqThreshold))
				: null;

		const missingFields = [
			totalSupplied === null ? "totalSupplied" : null,
			totalBorrowed === null ? "totalBorrowed" : null,
			tvl === null ? "tvl" : null,
			utilization === null ? "utilization" : null,
			price.price === null ? "oraclePrice" : null,
			liquidationThreshold === null ? "liquidationThreshold" : null,
		].filter((field): field is string => field !== null);

		return {
			asset,
			assetAddress: tokenInfo.token,
			supplyAPY,
			borrowAPY,
			utilization,
			tvl,
			liquidationThreshold,
			oraclePrice: price.price,
			totalSupplied,
			totalBorrowed,
			healthFactor,
			liqPrice,
			status: missingFields.length === 0 ? "live" : "partial",
			missingFields,
		};
	}

	private async buildPrice(
		tokenInfo: TokenInfo,
		priceOracle: Contract | null,
	): Promise<PriceResponseDto> {
		const [asset, price] = await Promise.all([
			this.getTokenSymbol(tokenInfo.token),
			this.getOraclePrice(tokenInfo.token, priceOracle),
		]);

		return {
			asset,
			price: price.price,
			oracle: "FheForge PriceOracle",
			updatedAt: price.updatedAt,
			status: price.price === null ? "unavailable" : "live",
		};
	}

	private async getTokenSymbol(tokenAddress: string): Promise<string> {
		if (!this.provider) return tokenAddress;
		try {
			const token = new Contract(tokenAddress, ERC20_ABI, this.provider);
			return await withTimeout(
				token.symbol().then((v: string) => String(v)),
				10_000,
				"",
			);
		} catch (e) {
			console.warn("[MarketsService]", e instanceof Error ? e.message : e);
			return tokenAddress;
		}
	}

	private async getPoolValue(
		lendingPool: Contract | null,
		method: "liquidReserve" | "totalPlainBorrow",
		tokenInfo: TokenInfo,
	): Promise<number | null> {
		if (!lendingPool) return null;
		try {
			const value = await withTimeout<bigint | null>(
				lendingPool[method](tokenInfo.token) as Promise<bigint>,
				10_000,
				null,
			);
			if (value === null) return null;
			return Number(formatUnits(value, tokenInfo.decimals));
		} catch (error) {
			this.logger.warn(
				`Unable to read ${method} for ${tokenInfo.token}: ${(error as Error).message}`,
			);
			return null;
		}
	}

	private async getOraclePrice(
		tokenAddress: string,
		priceOracle: Contract | null,
	): Promise<{ price: number | null; updatedAt: string | null }> {
		if (!priceOracle) return { price: null, updatedAt: null };
		try {
			const result = await withTimeout<[bigint, bigint] | null>(
				priceOracle.getPriceUsd(tokenAddress) as Promise<[bigint, bigint]>,
				10_000,
				null,
			);
			if (result === null) return { price: null, updatedAt: null };
			const [priceWad, updatedAt] = result;
			return {
				price: Number(formatUnits(priceWad, WAD_DECIMALS)),
				updatedAt: Number(updatedAt) > 0 ? new Date(Number(updatedAt) * 1000).toISOString() : null,
			};
		} catch (error) {
			this.logger.warn(
				`Unable to read oracle price for ${tokenAddress}: ${(error as Error).message}`,
			);
			return { price: null, updatedAt: null };
		}
	}

	private async getLiquidationThreshold(
		tokenAddress: string,
		priceOracle: Contract | null,
	): Promise<number | null> {
		if (!priceOracle) return null;
		try {
			const thresholdBps = await withTimeout<bigint | null>(
				priceOracle.liquidationThresholdBps(tokenAddress) as Promise<bigint>,
				10_000,
				null,
			);
			if (thresholdBps === null) return null;
			const threshold = Number(thresholdBps) / 10_000;
			return threshold > 0 ? threshold : null;
		} catch (error) {
			this.logger.warn(
				`Unable to read liquidation threshold for ${tokenAddress}: ${(error as Error).message}`,
			);
			return null;
		}
	}
}
