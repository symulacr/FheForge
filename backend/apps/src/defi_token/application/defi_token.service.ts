import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DefiToken } from '../domain/defi_token.entity';
import type { DefiTokenRepository } from '../domain/defi_token.repository';
import type { CreateDefiTokenDto } from '../interfaces/dto/create_defi_token.dto';

@Injectable()
export class DefiTokenService {
  constructor(private readonly defiTokenRepository: DefiTokenRepository) {}

  public async createDefiToken(data: CreateDefiTokenDto): Promise<DefiToken> {
    const defiToken = new DefiToken(uuidv4(), data.name, data.asset_id);
    return this.defiTokenRepository.save(defiToken);
  }

  public async getDefiTokenById(id: string): Promise<DefiToken> {
    const defiToken = await this.defiTokenRepository.findById(id);
    if (!defiToken) {
      throw new NotFoundException('DefiToken not found');
    }
    return defiToken;
  }

  public async getDefiTokenByAssetId(assetId: string): Promise<DefiToken> {
    const defiToken = await this.defiTokenRepository.findByAssetId(assetId);
    if (!defiToken) {
      throw new NotFoundException(`DefiToken not found for asset_id: ${assetId}`);
    }
    return defiToken;
  }

  public async getAllDefiTokens(): Promise<DefiToken[]> {
    return this.defiTokenRepository.findAll();
  }
}
