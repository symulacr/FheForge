import { ApiProperty } from '@nestjs/swagger';

export class MarketResponseDto {
  @ApiProperty({ example: 'WETH' })
  asset: string;

  @ApiProperty({ example: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' })
  assetAddress: string;

  @ApiProperty({ example: 4.82, description: 'Supply APY percentage' })
  supplyAPY: number;

  @ApiProperty({ example: 7.15, description: 'Borrow APY percentage' })
  borrowAPY: number;

  @ApiProperty({ example: 0.72, description: 'Utilization ratio (0-1)' })
  utilization: number;

  @ApiProperty({ example: 3_200_000, description: 'Total value locked in USD' })
  tvl: number;

  @ApiProperty({ example: 0.80, description: 'Liquidation threshold (0-1)' })
  liquidationThreshold: number;

  @ApiProperty({ example: 3_245.12, description: 'Oracle price in USD' })
  oraclePrice: number;

  @ApiProperty({ example: 5_000_000, description: 'Total supplied in USD' })
  totalSupplied: number;

  @ApiProperty({ example: 3_600_000, description: 'Total borrowed in USD' })
  totalBorrowed: number;
}
