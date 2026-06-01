import { ApiProperty } from '@nestjs/swagger';

export class StatsResponseDto {
  @ApiProperty({
    example: 12_500_000,
    description: 'Total value locked in USD',
  })
  tvlUsd: number;

  @ApiProperty({ example: 342, description: 'Total registered users' })
  totalUsers: number;

  @ApiProperty({ example: 4, description: 'Active lending markets' })
  activeMarkets: number;

  @ApiProperty({ example: 27, description: 'Published strategies' })
  activeStrategies: number;

  @ApiProperty({
    example: 18_420,
    description: 'Cumulative encrypted operations',
  })
  encryptedOps: number;

  @ApiProperty({ example: 1_203, description: 'Permit decrypts in last 24h' })
  permitDecryptsDay: number;

  @ApiProperty({ example: 89, description: 'Total strategy deployments' })
  totalDeployments: number;

  @ApiProperty({ description: 'TVL per pool in USD' })
  poolTvls: {
    USDC: number;
    ETH: number;
    WBTC: number;
  };
}
