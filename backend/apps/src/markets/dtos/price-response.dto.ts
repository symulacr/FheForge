import { ApiProperty } from '@nestjs/swagger';

export class PriceResponseDto {
  @ApiProperty({ example: 'WETH' })
  asset: string;

  @ApiProperty({ example: 3_245.12, description: 'Price in USD' })
  price: number;

  @ApiProperty({ example: 'Chainlink', description: 'Oracle source' })
  oracle: string;

  @ApiProperty({
    example: '2026-06-01T12:00:00Z',
    description: 'Last update timestamp',
  })
  updatedAt: string;
}
