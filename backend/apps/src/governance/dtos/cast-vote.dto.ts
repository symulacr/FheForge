import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsUUID, Min } from 'class-validator';

export class CastVoteDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  proposalId: string;

  @ApiProperty({ example: true, description: 'true = for, false = against' })
  @IsBoolean()
  support: boolean;

  @ApiProperty({
    example: 1000,
    description: 'Vote weight (token balance or staked amount)',
  })
  @IsNumber()
  @Min(1)
  weight: number;
}
