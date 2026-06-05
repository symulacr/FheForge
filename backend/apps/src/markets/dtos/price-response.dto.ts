import { ApiProperty } from '@nestjs/swagger';

export class PriceResponseDto {
  @ApiProperty({ example: 'WETH' })
  asset: string;

  @ApiProperty({
    example: 3_245.12,
    nullable: true,
    description:
      'Price in USD, or null when no fresh on-chain price is available',
  })
  price: number | null;

  @ApiProperty({
    example: 'FheForge PriceOracle',
    description: 'Oracle source',
  })
  oracle: string;

  @ApiProperty({
    example: '2026-06-01T12:00:00Z',
    nullable: true,
    description:
      'Last on-chain oracle update timestamp, or null when unavailable',
  })
  updatedAt: string | null;

  @ApiProperty({
    example: 'live',
    description: 'Price data completeness',
    enum: ['live', 'unavailable'],
  })
  status: 'live' | 'unavailable';
}
