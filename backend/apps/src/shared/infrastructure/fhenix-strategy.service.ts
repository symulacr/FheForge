import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Contract, formatUnits, JsonRpcProvider } from 'ethers';

const PRICE_ORACLE_ABI = [
  'function getPriceUsd(address token) external view returns (uint256 priceWad, uint64 updatedAt)',
];

// WAD = 1e18 — priceWad is a WAD-denominated USD price
const WAD = BigInt(10) ** BigInt(18);

@Injectable()
export class FhenixStrategyService implements OnModuleInit {
  private readonly logger = new Logger(FhenixStrategyService.name);
  private provider: JsonRpcProvider | null = null;
  private priceOracle: Contract | null = null;

  /** On-chain price cache: token address → USD price (WAD) */
  private readonly priceCache: Map<string, { priceWad: bigint; updatedAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const rpcUrl = this.configService.get<string>('COFHE_RPC');
    if (rpcUrl) {
      this.provider = new JsonRpcProvider(rpcUrl);
    }

    const oracleAddress = this.configService.get<string>('PRICE_ORACLE_ADDRESS');
    if (oracleAddress && this.provider) {
      this.priceOracle = new Contract(oracleAddress, PRICE_ORACLE_ABI, this.provider);
      this.logger.log(`PriceOracle connected at ${oracleAddress}`);
    } else {
      this.logger.warn('PRICE_ORACLE_ADDRESS not set — on-chain price reads disabled');
    }
  }

  /**
   * Fetch the USD price of a token from the on-chain PriceOracle.
   * Returns the price as a JS number (e.g. 3000.0 for WETH).
   * Falls back to env-var static rate if oracle is unavailable.
   */
  async getAssetPriceUsd(token: string): Promise<number> {
    if (!token) throw new Error('Token address is required');

    // Check cache
    const cached = this.priceCache.get(token);
    if (cached && Date.now() - cached.updatedAt < this.CACHE_TTL_MS) {
      return Number(cached.priceWad) / Number(WAD);
    }

    // On-chain read
    if (this.priceOracle) {
      try {
        const [priceWad, updatedAt] = await this.priceOracle.getPriceUsd(token);
        this.priceCache.set(token, { priceWad, updatedAt: Date.now() });
        this.logger.debug(
          `Oracle price for ${token}: ${formatUnits(priceWad, 18)} USD (on-chain updatedAt=${updatedAt})`,
        );
        return Number(priceWad) / Number(WAD);
      } catch (err) {
        const msg = (err as Error).message;
        // B-01: Detect stale oracle and warn explicitly (not silent fallback)
        const isStale =
          msg.includes('PythNoOlderThan') ||
          msg.includes('NoPriceFeed') ||
          msg.includes('UncertainPrice');
        if (isStale) {
          this.logger.error(
            `Oracle STALE for ${token}: ${msg} — using static rate. Call updatePriceFeeds to refresh.`,
          );
        } else {
          this.logger.warn(`Oracle read failed for ${token}: ${msg}, falling back to static rate`);
        }
      }
    }

    // Fallback: static env-var rate (may be stale — see B-01 warning above)
    return this.getStaticPriceUsd(token);
  }

  /**
   * Get the exchange rate between two tokens via their USD prices.
   * rate = priceUsd(tokenIn) / priceUsd(tokenOut)
   */
  async getAssetPrice(tokenIn: string, tokenOut: string): Promise<number> {
    if (tokenIn === tokenOut) return 1;

    const [priceIn, priceOut] = await Promise.all([
      this.getAssetPriceUsd(tokenIn),
      this.getAssetPriceUsd(tokenOut),
    ]);

    if (priceOut === 0) {
      throw new Error(`Token ${tokenOut} has zero USD price — cannot compute exchange rate`);
    }

    return priceIn / priceOut;
  }

  /**
   * Synchronous version of getAssetPrice for backward compatibility.
   * Uses cached prices or falls back to static rates.
   * Prefer the async getAssetPrice() when possible.
   */
  getAssetPriceSync(tokenIn: string, tokenOut: string): number {
    if (tokenIn === tokenOut) return 1;

    // Try cache first
    const cachedIn = this.priceCache.get(tokenIn);
    const cachedOut = this.priceCache.get(tokenOut);
    if (
      cachedIn &&
      cachedOut &&
      Date.now() - cachedIn.updatedAt < this.CACHE_TTL_MS &&
      Date.now() - cachedOut.updatedAt < this.CACHE_TTL_MS
    ) {
      const priceIn = Number(cachedIn.priceWad) / Number(WAD);
      const priceOut = Number(cachedOut.priceWad) / Number(WAD);
      if (priceOut !== 0) return priceIn / priceOut;
    }

    // Fallback to static rates
    return this.getStaticExchangeRate(tokenIn, tokenOut);
  }

  getMaxLTV(): number {
    return Number(this.configService.get<string>('MAX_LTV', '0.75'));
  }

  async getNetworkStatus() {
    if (!this.provider) {
      throw new Error('Fhenix RPC not configured');
    }
    const [blockNumber, network] = await Promise.all([
      this.provider.getBlockNumber(),
      this.provider.getNetwork(),
    ]);
    return { blockNumber, chainId: Number(network.chainId) };
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private getStaticPriceUsd(token: string): number {
    const weth = this.configService.get<string>('TOKEN_WETH', '');
    const usdc = this.configService.get<string>('TOKEN_USDC', '');
    const usdt = this.configService.get<string>('TOKEN_USDT', '');

    const wethUsdcRate = Number(this.configService.get<string>('EXCHANGE_RATE_WETH_USDC', '3000'));

    if (token === weth) return wethUsdcRate;
    if (token === usdc || token === usdt) return 1;

    this.logger.warn(`No static USD price for token ${token}, returning 0`);
    return 0;
  }

  private getStaticExchangeRate(tokenIn: string, tokenOut: string): number {
    const priceIn = this.getStaticPriceUsd(tokenIn);
    const priceOut = this.getStaticPriceUsd(tokenOut);
    if (priceOut === 0) {
      throw new Error(`No exchange rate configured for ${tokenIn}-${tokenOut}`);
    }
    return priceIn / priceOut;
  }
}
