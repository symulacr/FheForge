import { Injectable } from '@nestjs/common';
import { MarketResponseDto } from './dtos/market-response.dto';
import { PriceResponseDto } from './dtos/price-response.dto';

const MOCK_MARKETS: MarketResponseDto[] = [
  {
    asset: 'USDC',
    assetAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    supplyAPY: 4.82,
    borrowAPY: 6.21,
    utilization: 0.64,
    tvl: 8_420_000,
    liquidationThreshold: 0.8,
    oraclePrice: 1.0,
    totalSupplied: 8_500_000,
    totalBorrowed: 5_440_000,
  },
  {
    asset: 'ETH',
    assetAddress: '0x82aF49447D8a07e3BD95BD0d56f35241523fBab1',
    supplyAPY: 2.14,
    borrowAPY: 3.78,
    utilization: 0.41,
    tvl: 4_180_000,
    liquidationThreshold: 0.75,
    oraclePrice: 2_544.1,
    totalSupplied: 4_200_000,
    totalBorrowed: 1_720_000,
  },
  {
    asset: 'WBTC',
    assetAddress: '0x2f2a2543B76A4166549F7aab2e75Bef0aefC5B0f',
    supplyAPY: 1.85,
    borrowAPY: 3.12,
    utilization: 0.35,
    tvl: 1_800_000,
    liquidationThreshold: 0.7,
    oraclePrice: 65_432.0,
    totalSupplied: 1_850_000,
    totalBorrowed: 647_500,
  },
  {
    asset: 'ARB',
    assetAddress: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    supplyAPY: 3.45,
    borrowAPY: 5.1,
    utilization: 0.58,
    tvl: 2_100_000,
    liquidationThreshold: 0.65,
    oraclePrice: 0.85,
    totalSupplied: 2_150_000,
    totalBorrowed: 1_247_000,
  },
  {
    asset: 'DAI',
    assetAddress: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    supplyAPY: 4.1,
    borrowAPY: 5.95,
    utilization: 0.62,
    tvl: 1_200_000,
    liquidationThreshold: 0.8,
    oraclePrice: 1.0,
    totalSupplied: 1_220_000,
    totalBorrowed: 756_400,
  },
];

const MOCK_PRICES: PriceResponseDto[] = MOCK_MARKETS.map((m) => ({
  asset: m.asset,
  price: m.oraclePrice,
  oracle: 'Pyth',
  updatedAt: new Date().toISOString(),
}));

@Injectable()
export class MarketsService {
  async getAllMarkets(): Promise<MarketResponseDto[]> {
    return await Promise.resolve(MOCK_MARKETS);
  }

  async getPrices(): Promise<PriceResponseDto[]> {
    return await Promise.resolve(MOCK_PRICES);
  }
}
