import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";

@Injectable()
export class GasEstimationService {
	private readonly logger = new Logger(GasEstimationService.name);
	private provider: ethers.JsonRpcProvider | null = null;

	private readonly GAS_ESTIMATES: Record<string, number> = {
		SWAP: 150000,
		SUPPLY: 100000,
		BORROW: 120000,
		CLAIM_REWARDS: 80000,
	};

	private readonly DEFAULT_GAS = 100000;

	constructor(private readonly configService: ConfigService) {
		const rpcUrl = this.configService.get<string>("COFHE_RPC");
		if (rpcUrl) {
			this.provider = new ethers.JsonRpcProvider(rpcUrl);
		}
	}

	async estimateGasForStep(stepType: string): Promise<number> {
		if (this.provider) {
			try {
				const gasPrice = await this.provider.getFeeData().then((f) => f.gasPrice);
				const gasLimit = this.GAS_ESTIMATES[stepType] ?? this.DEFAULT_GAS;
				return Number(ethers.formatUnits(gasPrice! * BigInt(gasLimit), "ether"));
			} catch {
				this.logger.warn(`Provider gas estimation failed for ${stepType}, using fallback`);
			}
		}
		return this.GAS_ESTIMATES[stepType] ?? this.DEFAULT_GAS;
	}

	getGasLimitForStep(stepType: string): number {
		return this.GAS_ESTIMATES[stepType] ?? this.DEFAULT_GAS;
	}
}
