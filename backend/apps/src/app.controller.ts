import { Controller, Get } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { JsonRpcProvider } from "ethers";
import { Public } from "./auth/public.decorator";

type DependencyName =
	| "COFHE_RPC"
	| "SUPABASE"
	| "TOKEN_REGISTRY_ADDRESS"
	| "PRICE_ORACLE_ADDRESS"
	| "POOL_ADDRESS";

@Controller()
export class AppController {
	constructor(private readonly configService: ConfigService) {}

	private readinessCache: {
		data: Record<string, unknown>;
		expiresAt: number;
	} | null = null;

	@Public()
	@Get("health")
	health() {
		return this.liveness();
	}

	@Public()
	@Get("live")
	liveness() {
		return {
			status: "ok",
			live: true,
			service: "fheforge-backend",
		};
	}

	@Public()
	@Get("ready")
	async readiness() {
		const now = Date.now();
		if (this.readinessCache && now < this.readinessCache.expiresAt) {
			return this.readinessCache.data;
		}

		const cofheRpcConfigured = Boolean(this.configService.get<string>("COFHE_RPC"));
		const cofheRpcReachable = cofheRpcConfigured ? await this.isCofheRpcReachable() : false;
		const supabaseConfigured = Boolean(
			this.configService.get<string>("SUPABASE_URL") &&
				this.configService.get<string>("SUPABASE_KEY"),
		);
		const tokenRegistryConfigured = Boolean(
			this.configService.get<string>("TOKEN_REGISTRY_ADDRESS"),
		);
		const priceOracleConfigured = Boolean(this.configService.get<string>("PRICE_ORACLE_ADDRESS"));
		const poolConfigured = Boolean(this.configService.get<string>("POOL_ADDRESS"));

		const missingDependencies: DependencyName[] = [];
		if (!cofheRpcConfigured || !cofheRpcReachable) {
			missingDependencies.push("COFHE_RPC");
		}
		if (!supabaseConfigured) missingDependencies.push("SUPABASE");
		if (!tokenRegistryConfigured) {
			missingDependencies.push("TOKEN_REGISTRY_ADDRESS");
		}
		if (!priceOracleConfigured) missingDependencies.push("PRICE_ORACLE_ADDRESS");
		if (!poolConfigured) missingDependencies.push("POOL_ADDRESS");

		const data = {
			status: missingDependencies.length === 0 ? "ready" : "degraded",
			ready: missingDependencies.length === 0,
			dependencies: {
				cofheRpc: {
					configured: cofheRpcConfigured,
					reachable: cofheRpcReachable,
					status: cofheRpcReachable ? "ready" : "unavailable",
				},
				supabase: {
					configured: supabaseConfigured,
					status: supabaseConfigured ? "ready" : "missing_config",
				},
				tokenRegistry: {
					configured: tokenRegistryConfigured,
					status: tokenRegistryConfigured ? "ready" : "missing_config",
				},
				priceOracle: {
					configured: priceOracleConfigured,
					status: priceOracleConfigured ? "ready" : "missing_config",
				},
				pool: {
					configured: poolConfigured,
					status: poolConfigured ? "ready" : "missing_config",
				},
			},
			missingDependencies,
		};

		this.readinessCache = { data, expiresAt: now + 30_000 };
		return data;
	}

	private async isCofheRpcReachable(): Promise<boolean> {
		const rpcUrl = this.configService.get<string>("COFHE_RPC");
		if (!rpcUrl) return false;

		const provider = new JsonRpcProvider(rpcUrl);
		try {
			await Promise.race([
				provider.getBlockNumber(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("COFHE_RPC readiness timeout")), 2_500),
				),
			]);
			return true;
		} catch {
			return false;
		} finally {
			provider.destroy();
		}
	}
}
