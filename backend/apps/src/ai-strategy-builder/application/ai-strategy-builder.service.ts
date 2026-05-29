import { Injectable } from "@nestjs/common";
import type { BuildStrategyDto } from "../interfaces/dtos/build-strategy.dto";
import type { StrategyStepResponseDto } from "../interfaces/dtos/strategy-step-response.dto";
import type { GasEstimationService } from "./gas-estimation.service";
import type { GeminiAiService } from "./gemini-ai.service";
import type { StrategyParserService } from "./strategy-parser.service";
import type { StrategyValidatorService } from "./strategy-validator.service";

@Injectable()
export class AiStrategyBuilderService {
	constructor(
		private readonly parser: StrategyParserService,
		private readonly validator: StrategyValidatorService,
		private readonly geminiAi: GeminiAiService,
		private readonly gasEstimationService: GasEstimationService,
	) {}

	async buildStrategy(dto: BuildStrategyDto): Promise<{
		steps: StrategyStepResponseDto[];
		validation: {
			isValid: boolean;
			errors: string[];
			warnings: string[];
		};
		metadata: {
			totalSteps: number;
			estimatedGas: number;
			riskLevel: string;
			aiGenerated: boolean;
		};
		aiAnalysis?: {
			riskFactors: string[];
			recommendations: string[];
		};
	}> {
		const steps = await this.parser.parseNaturalLanguage(
			dto.userIntent,
			dto.additionalContext,
			dto.tokenAmount,
		);

		const validation = await this.validator.validateSteps(steps);

		const aiAnalysis = await this.generateRiskAnalysis(steps);

		const metadata = await this.calculateStrategyMetadata(steps, aiAnalysis);

		return {
			steps: steps,
			validation: validation || {
				isValid: false,
				errors: ["Validation failed"],
				warnings: [],
			},
			metadata: metadata || {
				totalSteps: 0,
				estimatedGas: 0,
				riskLevel: "UNKNOWN",
				aiGenerated: false,
			},
			aiAnalysis: aiAnalysis || { riskFactors: [], recommendations: [] },
		};
	}

	private async generateRiskAnalysis(
		steps: StrategyStepResponseDto[],
	): Promise<{ riskFactors: string[]; recommendations: string[] } | undefined> {
		try {
			const riskAnalysis = await this.geminiAi.analyzeStrategyRisk(steps);
			return {
				riskFactors: riskAnalysis.riskFactors,
				recommendations: riskAnalysis.recommendations,
			};
		} catch {
			return undefined;
		}
	}

	private async calculateStrategyMetadata(
		steps: StrategyStepResponseDto[],
		aiAnalysis?: { riskFactors: string[]; recommendations: string[] },
	): Promise<{
		totalSteps: number;
		estimatedGas: number;
		riskLevel: string;
		aiGenerated: boolean;
	}> {
		let riskLevel: string;

		if (aiAnalysis) {
			riskLevel = this.extractRiskLevelFromAnalysis(aiAnalysis);
		} else {
			try {
				const riskAnalysis = await this.geminiAi.analyzeStrategyRisk(steps);
				riskLevel = riskAnalysis.riskLevel;
			} catch {
				riskLevel = this.calculateRiskLevel(steps);
			}
		}

		const gasEstimates = await Promise.all(
			steps.map((step) => this.gasEstimationService.estimateGasForStep(step.type)),
		);
		const estimatedGas = gasEstimates.reduce((sum, gas) => sum + gas, 0);

		return {
			totalSteps: steps.length,
			estimatedGas,
			riskLevel,
			aiGenerated: true,
		};
	}

	private extractRiskLevelFromAnalysis(aiAnalysis: { riskFactors: string[] }): string {
		const riskFactorCount = aiAnalysis.riskFactors.length;

		if (riskFactorCount === 0) return "LOW";
		if (riskFactorCount >= 3) return "HIGH";
		return "MEDIUM";
	}

	private calculateRiskLevel(steps: StrategyStepResponseDto[]): string {
		const borrowSteps = steps.filter((step) => step.type === "BORROW").length;
		const totalSteps = steps.length;
		const borrowRatio = borrowSteps / totalSteps;

		if (borrowSteps === 0) {
			return "LOW";
		}

		if (borrowRatio > 0.4) {
			return "HIGH";
		}

		return "MEDIUM";
	}
}
