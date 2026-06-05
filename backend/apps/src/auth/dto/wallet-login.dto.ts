import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEthereumAddress,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class WalletLoginDto {
  @ApiProperty({
    description: 'Ethereum wallet address',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  @IsString()
  @IsEthereumAddress()
  walletAddress!: string;

  @ApiProperty({
    description: 'EIP-191 signature of the auth message',
    example: '0x...',
  })
  @IsString()
  signature!: string;

  @ApiPropertyOptional({
    description: 'Nonce obtained from GET /auth/nonce/:walletAddress',
  })
  @IsString()
  nonce!: string;

  @ApiPropertyOptional({
    description: 'Chain ID (default: 421614 for Arbitrum Sepolia)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  chainId?: number;
}

export class WalletLoginResponseDto {
  @ApiPropertyOptional({
    description: 'JWT access token (now sent via httpOnly cookie)',
  })
  accessToken?: string;

  @ApiProperty({ description: 'User ID' })
  userId!: string;

  @ApiProperty({ description: 'Wallet address' })
  walletAddress!: string;
}

export class NonceResponseDto {
  @ApiProperty({ description: 'Nonce to sign' })
  nonce!: string;

  @ApiProperty({ description: 'Message to sign' })
  message!: string;
}
