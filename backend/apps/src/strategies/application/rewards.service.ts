import { Injectable, NotImplementedException } from "@nestjs/common";

@Injectable()
export class RewardsService {
	// TODO: MC-56 — Replace with on-chain reads from StrategyRegistry.getStrategyParams(strategyId)
	// which returns (apyTarget, loopCount). Once the StrategyRegistry contract is deployed,
	// read apyTarget directly instead of throwing.
	calculateAPY(_strategistName: string): never {
		throw new NotImplementedException(
			"Rewards service requires Fhenix oracle integration — not available on testnet",
		);
	}
}
