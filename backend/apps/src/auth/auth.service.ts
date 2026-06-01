import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { verifyMessage } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../shared/infrastructure/supabase.service';
import type { AuthNonceRow } from '../shared/infrastructure/database.types';
import { UserService } from '../users/application/user.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    readonly _configService: ConfigService,
    private readonly userService: UserService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Generate a nonce for the wallet to sign.
   * The nonce is stored in the auth_nonces table and expires after 5 minutes.
   */
  async generateNonce(
    walletAddress: string,
  ): Promise<{ nonce: string; message: string }> {
    const nonce = uuidv4();
    const normalizedAddress = walletAddress.toLowerCase();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

    const { error } = await this.supabase
      .getClient()
      .from('auth_nonces')
      .upsert(
        {
          wallet_address: normalizedAddress,
          nonce,
          created_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: 'wallet_address' },
      );

    if (error) {
      this.logger.error(
        `Failed to store nonce for ${normalizedAddress}: ${error.message}`,
      );
      throw new Error('Failed to generate nonce');
    }

    const message = this.buildAuthMessage(walletAddress, nonce);
    return { nonce, message };
  }

  /**
   * Verify a wallet signature and issue a JWT.
   */
  async login(
    walletAddress: string,
    signature: string,
    nonce: string,
    chainId?: number,
  ): Promise<{ accessToken: string; userId: string; walletAddress: string }> {
    const normalizedAddress = walletAddress.toLowerCase();

    // Retrieve and validate nonce from database
    const { data: stored, error: selectError } = await (this.supabase
      .getClient()
      .from('auth_nonces')
      .select('*')
      .eq('wallet_address', normalizedAddress)
      .single() as unknown as Promise<{
      data: AuthNonceRow | null;
      error: unknown;
    }>);

    if (selectError || !stored) {
      throw new UnauthorizedException(
        'No nonce found. Request a new nonce first.',
      );
    }

    if (stored.nonce !== nonce) {
      throw new UnauthorizedException('Invalid nonce.');
    }

    if (new Date(stored.expires_at) < new Date()) {
      // Clean up expired nonce
      await this.supabase
        .getClient()
        .from('auth_nonces')
        .delete()
        .eq('wallet_address', normalizedAddress);
      throw new UnauthorizedException('Nonce expired. Request a new one.');
    }

    // Build the expected auth message
    const message = this.buildAuthMessage(walletAddress, nonce);

    // Verify the signature using ethers v6 verifyMessage (EIP-191)
    let recoveredAddress: string;
    try {
      recoveredAddress = verifyMessage(message, signature);
    } catch {
      throw new UnauthorizedException('Invalid signature format.');
    }

    if (recoveredAddress.toLowerCase() !== normalizedAddress) {
      // Consume the nonce (prevent replay)
      await this.supabase
        .getClient()
        .from('auth_nonces')
        .delete()
        .eq('wallet_address', normalizedAddress);
      throw new UnauthorizedException(
        'Signature does not match wallet address.',
      );
    }

    // Consume the nonce (prevent replay)
    await this.supabase
      .getClient()
      .from('auth_nonces')
      .delete()
      .eq('wallet_address', normalizedAddress);

    // Find or create user
    const resolvedChainId = chainId ?? 421614;
    let user = await this.userService
      .getUserByWalletAddress(walletAddress)
      .catch(() => null);

    if (!user) {
      user = await this.userService.createUser({
        walletAddress,
        chainId: resolvedChainId,
      });
    }

    // Issue JWT
    const accessToken = this.jwtService.sign({
      sub: user.id,
      walletAddress: user.walletAddress,
      role: 'user',
    });

    this.logger.log(`Wallet login successful for ${walletAddress}`);

    return {
      accessToken,
      userId: user.id,
      walletAddress: user.walletAddress,
    };
  }

  /**
   * Build the EIP-191 compliant auth message.
   */
  private buildAuthMessage(walletAddress: string, nonce: string): string {
    return [
      'FheForge Authentication',
      `Wallet: ${walletAddress}`,
      `Nonce: ${nonce}`,
    ].join('\n');
  }
}
