import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

@Injectable()
export class FhenixStrategyService {
  private readonly logger = new Logger(FhenixStrategyService.name);
  private provider: ethers.providers.JsonRpcProvider | null = null;
  private readonly exchangeRates: Map<string, number> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.initializeExchangeRates();
    const rpcUrl = this.configService.get<string>('FHENIX_RPC');
    if (rpcUrl) {
      this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    }
  }

  private initializeExchangeRates(): void {
    const wethUsdcRate = Number(
      this.configService.get<string>('EXCHANGE_RATE_WETH_USDC', '3000'),
    );
    const usdcUsdtRate = Number(
      this.configService.get<string>('EXCHANGE_RATE_USDC_USDT', '1'),
    );

    const weth = this.configService.get<string>('TOKEN_WETH', '');
    const usdc = this.configService.get<string>('TOKEN_USDC', '');
    const usdt = this.configService.get<string>('TOKEN_USDT', '');

    this.exchangeRates.set(`${weth}-${usdc}`, wethUsdcRate);
    this.exchangeRates.set(`${usdc}-${weth}`, 1 / wethUsdcRate);
    this.exchangeRates.set(`${usdc}-${usdt}`, usdcUsdtRate);
    this.exchangeRates.set(`${usdt}-${usdc}`, 1 / usdcUsdtRate);

    this.logger.log(
      `Exchange rates initialized: WETH/USDC=${wethUsdcRate}, USDC/USDT=${usdcUsdtRate}`,
    );
  }

  getAssetPrice(tokenIn: string, tokenOut: string): number {
    if (tokenIn === tokenOut) return 1;
    const rate = this.exchangeRates.get(`${tokenIn}-${tokenOut}`);
    if (rate === undefined) {
      throw new Error(`No exchange rate configured for ${tokenIn}-${tokenOut}`);
    }
    return rate;
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
    return { blockNumber, chainId: network.chainId };
  }
}
