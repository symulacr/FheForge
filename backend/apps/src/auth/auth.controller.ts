import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import {
  WalletLoginDto,
  WalletLoginResponseDto,
  NonceResponseDto,
} from './dto/wallet-login.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('nonce/:walletAddress')
  @ApiOperation({ summary: 'Get a nonce for wallet authentication' })
  @ApiParam({ name: 'walletAddress', description: 'Ethereum wallet address' })
  @ApiResponse({
    status: 200,
    description: 'Nonce generated',
    type: NonceResponseDto,
  })
  getNonce(@Param('walletAddress') walletAddress: string): NonceResponseDto {
    return this.authService.generateNonce(walletAddress);
  }

  @Public()
  @Post('wallet-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with wallet signature' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: WalletLoginResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid signature or nonce' })
  async walletLogin(
    @Body() dto: WalletLoginDto,
  ): Promise<WalletLoginResponseDto> {
    return this.authService.login(
      dto.walletAddress,
      dto.signature,
      dto.nonce,
      dto.chainId,
    );
  }
}
