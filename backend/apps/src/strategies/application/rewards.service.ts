import { Injectable } from '@nestjs/common';

@Injectable()
export class RewardsService {
  calculateAPY(_strategistName: string): never {
    throw new Error(
      'Rewards service requires Fhenix oracle integration — not available on testnet',
    );
  }

  private sumPow(start: number, n: number, ltv: number): number {
    let total = 0;
    for (let i = start; i <= n; i++) total += Math.pow(ltv, i);
    return total;
  }
}
