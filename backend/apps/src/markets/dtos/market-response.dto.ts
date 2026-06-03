import { ApiProperty } from '@nestjs/swagger';

export class MarketResponseDto {
  @ApiProperty({ example: 'WETH' })
  asset: string;

  @ApiProperty({ example: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' })
  assetAddress: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Supply APY percentage, or null when no on-chain source is available',
  })
  supplyAPY: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Borrow APY percentage, or null when no on-chain source is available',
  })
  borrowAPY: number | null;

  @ApiProperty({
    example: 0.72,
    nullable: true,
    description:
      'Utilization ratio (0-1), or null when reserves cannot be read',
  })
  utilization: number | null;

  @ApiProperty({
    example: 3_200_000,
    nullable: true,
    description:
      'Total value locked in USD, or null when price/reserve data is unavailable',
  })
  tvl: number | null;

  @ApiProperty({
    example: 0.8,
    nullable: true,
    description:
      'Liquidation threshold (0-1), or null when not configured on-chain',
  })
  liquidationThreshold: number | null;

  @ApiProperty({
    example: 3_245.12,
    nullable: true,
    description:
      'Oracle price in USD, or null when no fresh on-chain price is available',
  })
  oraclePrice: number | null;

  @ApiProperty({
    example: 5_000_000,
    nullable: true,
    description:
      'Total supplied in USD, or null when price/reserve data is unavailable',
  })
  totalSupplied: number | null;

  @ApiProperty({
    example: 3_600_000,
    nullable: true,
    description:
      'Total borrowed in USD, or null when price/borrow data is unavailable',
  })
  totalBorrowed: number | null;

  @ApiProperty({
    example: 'partial',
    description: 'Data completeness for this market',
    enum: ['live', 'partial', 'unavailable'],
  })
  status: 'live' | 'partial' | 'unavailable';

  @ApiProperty({
    example: ['apy_unavailable'],
    description:
      'Fields intentionally returned as null because no real source is available',
    type: [String],
  })
  missingFields: string[];
}
