import { Controller, Body, Post, Get, Param } from '@nestjs/common';
import { DefiTokenService } from '../application/defi_token.service';
import { CreateDefiTokenDto } from './dto/create_defi_token.dto';
import { ApiOperation, ApiParam } from '@nestjs/swagger';

@Controller('defi-token')
export class DefiTokenController {
  constructor(private readonly defiTokenService: DefiTokenService) {}

  @ApiOperation({ summary: 'Create a new DeFi token' })
  @Post()
  async createDefiToken(@Body() body: CreateDefiTokenDto) {
    return this.defiTokenService.createDefiToken(body);
  }

  @Get('asset/:assetId')
  @ApiOperation({ summary: 'Get a DeFi token by asset ID' })
  @ApiParam({ name: 'assetId', description: 'The asset ID of the token' })
  async getByAssetId(@Param('assetId') assetId: string) {
    return this.defiTokenService.getDefiTokenByAssetId(assetId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a DeFi token by ID' })
  @ApiParam({ name: 'id', description: 'The ID of the token' })
  async getById(@Param('id') id: string) {
    return this.defiTokenService.getDefiTokenById(id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all DeFi tokens' })
  async getAll() {
    return this.defiTokenService.getAllDefiTokens();
  }
}
