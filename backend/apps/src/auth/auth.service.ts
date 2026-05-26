import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { verifyMessage } from 'ethers';
import { UserService } from '../users/application/user.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory nonce store for wallet authentication.
 * In production, this should be backed by Redis or the database.
 */
const nonceStore = new Map<string, { nonce: string; createdAt: number }>();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {}

  /**
   * Generate a nonce for the wallet to sign.
   * The nonce is stored temporarily and expires after 5 minutes.
   */
  generateNonce(walletAddress: string): { nonce: string; message: string } {
    const nonce = uuidv4();
    nonceStore.set(walletAddress.toLowerCase(), {
      nonce,
      createdAt: Date.now(),
    });

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

    // Retrieve and validate nonce
    const stored = nonceStore.get(normalizedAddress);
    if (!stored) {
      throw new UnauthorizedException(
        'No nonce found. Request a new nonce first.',
      );
    }

    if (stored.nonce !== nonce) {
      throw new UnauthorizedException('Invalid nonce.');
    }

    if (Date.now() - stored.createdAt > NONCE_TTL_MS) {
      nonceStore.delete(normalizedAddress);
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
      nonceStore.delete(normalizedAddress);
      throw new UnauthorizedException(
        'Signature does not match wallet address.',
      );
    }

    // Consume the nonce (prevent replay)
    nonceStore.delete(normalizedAddress);

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
