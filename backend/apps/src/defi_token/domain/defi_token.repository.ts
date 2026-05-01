import { DefiToken } from './defi_token.entity';

export abstract class DefiTokenRepository {
  abstract save(defiToken: DefiToken): Promise<DefiToken>;
  abstract findById(id: string): Promise<DefiToken | null>;
  abstract findByAssetId(assetId: string): Promise<DefiToken | null>;
  abstract findAll(): Promise<DefiToken[]>;
}
