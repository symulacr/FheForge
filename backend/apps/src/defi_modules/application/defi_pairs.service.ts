import { Injectable } from "@nestjs/common";
import type { DefiTokenService } from "src/defi_token/application/defi_token.service";
import type { FhenixStrategyService } from "src/shared/infrastructure/fhenix-strategy.service";
import type { DefiPair } from "../domain/defi_pairs.entity";
import type { DefiPairsRepository } from "../domain/defi_pairs.repository";
import { OperationType } from "../domain/operation-type.enum";
import type { EstimateDefiPairDto } from "../interfaces/dtos/estimate-defi-pair.dto";
import type { EstimateDefiPairResponseDto } from "../interfaces/dtos/estimate-defi-pair-response.dto";

@Injectable()
export class DefiPairsService {
	constructor(
		private readonly defiPairsRepository: DefiPairsRepository,
		private readonly defiTokenService: DefiTokenService,
		private readonly fhenixStrategy: FhenixStrategyService,
	) {}

	async createDefiPair(defiPair: DefiPair): Promise<DefiPair> {
		if (defiPair.token_in_id) {
			await this.defiTokenService.getDefiTokenById(defiPair.token_in_id);
		}
		if (defiPair.token_out_id) {
			await this.defiTokenService.getDefiTokenById(defiPair.token_out_id);
		}

		return this.defiPairsRepository.save(defiPair);
	}

	async getAllAvailablePairs(): Promise<DefiPair[]> {
		return this.defiPairsRepository.findAll();
	}

	async getAvailablePairsForToken(tokenId: string): Promise<{
		asInput: DefiPair[];
		asOutput: DefiPair[];
	}> {
		const [asInput, asOutput] = await Promise.all([
			this.defiPairsRepository.findByTokenInId(tokenId),
			this.defiPairsRepository.findByTokenOutId(tokenId),
		]);

		return { asInput, asOutput };
	}

	async getAvailableOperationsForTokenPair(
		tokenInId: string,
		tokenOutId: string,
	): Promise<DefiPair[]> {
		return this.defiPairsRepository.findByTokenPair(tokenInId, tokenOutId);
	}

	async estimateDefiPair(dto: EstimateDefiPairDto): Promise<EstimateDefiPairResponseDto> {
		switch (dto.operation_type) {
			case OperationType.SWAP:
				if (!dto.token_out_id) throw new Error("token_out_id is required for SWAP");
				return this.estimateSwap(dto.token_in_id, dto.token_out_id, dto.amount_in);
			case OperationType.SUPPLY:
				return this.estimateSupply(dto.token_in_id, dto.amount_in);
			case OperationType.BORROW:
				if (!dto.token_out_id) throw new Error("token_out_id is required for BORROW");
				return this.estimateBorrow(dto.token_in_id, dto.token_out_id, dto.amount_in);
			default:
				throw new Error(`Unsupported operation type: ${String(dto.operation_type)}`);
		}
	}

	private async estimateSwap(
		tokenInId: string,
		tokenOutId: string,
		amountIn: number,
	): Promise<EstimateDefiPairResponseDto> {
		const [tokenIn, tokenOut] = await Promise.all([
			this.defiTokenService.getDefiTokenById(tokenInId),
			this.defiTokenService.getDefiTokenById(tokenOutId),
		]);

		const spotPrice = await this.fhenixStrategy.getAssetPrice(tokenIn.name, tokenOut.name);
		const amountOut = spotPrice * amountIn * 0.99;

		return {
			operation_type: OperationType.SWAP,
			token_in_id: tokenInId,
			token_out_id: tokenOutId,
			amount_in: amountIn,
			amount_out: Number(amountOut.toFixed(6)),
			slippage: 0.01,
		};
	}

	private estimateSupply(tokenInId: string, amountIn: number): EstimateDefiPairResponseDto {
		const supplyApyBps = process.env.SUPPLY_APY_BPS;
		if (!supplyApyBps) throw new Error("SUPPLY_APY_BPS env variable is not set");
		const supplyApy = Number(supplyApyBps) / 100;

		return {
			operation_type: OperationType.SUPPLY,
			token_in_id: tokenInId,
			token_out_id: tokenInId,
			amount_in: amountIn,
			supply_apy: supplyApy,
		};
	}

	private async estimateBorrow(
		collateralTokenId: string,
		borrowTokenId: string,
		collateralAmount: number,
	): Promise<EstimateDefiPairResponseDto> {
		const [collateralToken, borrowToken] = await Promise.all([
			this.defiTokenService.getDefiTokenById(collateralTokenId),
			this.defiTokenService.getDefiTokenById(borrowTokenId),
		]);

		const borrowApyBps = process.env.BORROW_APY_BPS;
		if (!borrowApyBps) throw new Error("BORROW_APY_BPS env variable is not set");
		const borrowApy = Number(borrowApyBps) / 100;

		const spotPrice =
			collateralTokenId === borrowTokenId
				? 1
				: await this.fhenixStrategy.getAssetPrice(collateralToken.name, borrowToken.name);

		const ltv = this.fhenixStrategy.getMaxLTV();
		const maxBorrowAmount = collateralAmount * (ltv - ltv * 0.1) * spotPrice * 0.99;

		return {
			operation_type: OperationType.BORROW,
			token_in_id: collateralTokenId,
			token_out_id: borrowTokenId,
			amount_in: collateralAmount,
			amount_out: Number(maxBorrowAmount.toFixed(6)),
			borrow_apy: Number(borrowApy.toFixed(2)),
			ltv: ltv * 100,
		};
	}
}
