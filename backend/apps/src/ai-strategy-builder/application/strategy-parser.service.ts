import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StrategyStepResponseDto } from "../interfaces/dtos/strategy-step-response.dto";
import { GeminiAiService } from "./gemini-ai.service";

function _getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string | undefined {
	return error instanceof Error ? error.stack : undefined;
}

interface TokenInfo {
	assetId: string;
	symbol: string;
	amount: number;
}

interface StrategyStepRaw {
	step?: number;
	type?: string;
	agent?: string;
	tokenIn?: TokenInfo;
	tokenOut?: TokenInfo;
}

@Injectable()
export class StrategyParserService {
	private readonly logger = new Logger(StrategyParserService.name);

	private readonly swapRateWethUsdc: number;
	private readonly swapRateUsdcWeth: number;

	constructor(
		private readonly geminiAi: GeminiAiService,
		private readonly configService: ConfigService,
	) {
		this.swapRateWethUsdc = this.configService.get<number>("SWAP_RATE_WETH_USDC", 2500);
		this.swapRateUsdcWeth = this.configService.get<number>("SWAP_RATE_USDC_WETH", 0.0004);
	}

	async parseNaturalLanguage(
		userIntent: string,
		additionalContext?: string,
		tokenAmount?: number,
	): Promise<StrategyStepResponseDto[]> {
		this.logger.log("Parsing natural language input", {
			userIntent: `${userIntent.substring(0, 100)}...`,
			hasAdditionalContext: !!additionalContext,
			tokenAmount,
		});

		try {
			if (this.isStructuredStepsFormat(userIntent)) {
				this.logger.debug("Using structured steps parsing");
				return this.parseStructuredSteps(userIntent, additionalContext, tokenAmount);
			}

			this.logger.debug("Using AI-powered parsing");
			const aiResponse = await this.geminiAi.generateStrategySteps(
				userIntent,
				additionalContext,
				tokenAmount,
			);

			return this.validateAndSanitizeSteps(aiResponse);
		} catch (error) {
			this.logger.error("Natural language parsing failed", getErrorStack(error));
			return this.fallbackParsing(userIntent, tokenAmount);
		}
	}

	private validateAndSanitizeSteps(steps: unknown[]): StrategyStepResponseDto[] {
		if (!Array.isArray(steps)) {
			throw new Error("Generated steps must be an array");
		}

		return steps.map((step, index) => {
			const rawStep = step as StrategyStepRaw;

			if (!rawStep.type || !rawStep.agent) {
				throw new Error(`Step ${index + 1}: Missing required fields (type, agent)`);
			}

			const stepNumber = rawStep.step || index + 1;

			const validTypes = ["SWAP", "SUPPLY", "BORROW", "CLAIM_REWARDS"];

			if (!validTypes.includes(rawStep.type)) {
				throw new Error(`Step ${stepNumber}: Invalid operation type '${rawStep.type}'`);
			}

			if (rawStep.tokenIn?.amount) {
				rawStep.tokenIn.amount = Number(Number(rawStep.tokenIn.amount).toFixed(6));
			}
			if (rawStep.tokenOut?.amount) {
				rawStep.tokenOut.amount = Number(Number(rawStep.tokenOut.amount).toFixed(6));
			}

			const result: StrategyStepResponseDto = {
				step: stepNumber,
				type: rawStep.type,
				agent: rawStep.agent,
				tokenIn: rawStep.tokenIn,
				tokenOut: rawStep.tokenOut,
			};
			return result;
		});
	}

	private fallbackParsing(userIntent: string, tokenAmount?: number): StrategyStepResponseDto[] {
		const normalizedIntent = userIntent.toLowerCase().trim();

		const { inputToken, defaultAmount } = this.extractInputTokenFromIntent(userIntent);
		const finalAmount = tokenAmount || defaultAmount;
		const tokenSymbol = inputToken;
		const amount = finalAmount;

		const assetId = this.getAssetIdBySymbol(tokenSymbol);
		const inputTokenObj = { symbol: tokenSymbol, amount, assetId };

		if (this.isCustomStrategy(normalizedIntent)) {
			return this.parseCustomStrategy(normalizedIntent, inputTokenObj);
		}

		return this.createSimpleSupplyStrategy(inputTokenObj);
	}

	private isStructuredStepsFormat(input: string): boolean {
		const numberedStepsPattern = /\d+\.\s*(supply|lend|borrow|swap)/i;
		const hasMultipleSteps = (input.match(/\d+\./g) || []).length >= 2;

		return numberedStepsPattern.test(input) && hasMultipleSteps;
	}

	private parseStructuredSteps(
		input: string,
		_additionalContext?: string,
		tokenAmount?: number,
	): StrategyStepResponseDto[] {
		const steps: StrategyStepResponseDto[] = [];

		const { inputToken, defaultAmount } = this.extractInputTokenFromIntent(input);
		const finalAmount = tokenAmount || defaultAmount;

		const stepMatches = input.match(/\d+\.\s*[^,\d]+/g) || [];

		let stepNumber = 1;
		const currentTokenAmounts: { [symbol: string]: number } = {
			[inputToken]: finalAmount,
		};

		for (const stepMatch of stepMatches) {
			const normalizedStep = stepMatch.toLowerCase().trim();

			if (normalizedStep.includes("lend") || normalizedStep.includes("supply")) {
				const step = this.parseSupplyStepWithContext(
					stepMatch,
					stepNumber,
					inputToken,
					finalAmount,
					currentTokenAmounts,
				);
				if (step) {
					steps.push(step);

					if (step.tokenIn) {
						currentTokenAmounts[step.tokenIn.symbol] = Math.max(
							0,
							(currentTokenAmounts[step.tokenIn.symbol] || 0) - step.tokenIn.amount,
						);
					}
				}
			} else if (normalizedStep.includes("borrow")) {
				const step = this.parseBorrowStepWithContext(
					stepMatch,
					stepNumber,
					inputToken,
					finalAmount,
					currentTokenAmounts,
				);
				if (step) {
					steps.push(step);

					if (step.tokenOut) {
						currentTokenAmounts[step.tokenOut.symbol] =
							(currentTokenAmounts[step.tokenOut.symbol] || 0) + step.tokenOut.amount;
					}
				}
			} else if (normalizedStep.includes("swap") || normalizedStep.includes("exchange")) {
				const step = this.parseSwapStepFromIntent(stepMatch, stepNumber, inputToken, finalAmount);
				if (step) {
					steps.push(step);

					if (step.tokenIn && step.tokenOut) {
						currentTokenAmounts[step.tokenIn.symbol] = Math.max(
							0,
							(currentTokenAmounts[step.tokenIn.symbol] || 0) - step.tokenIn.amount,
						);
						currentTokenAmounts[step.tokenOut.symbol] =
							(currentTokenAmounts[step.tokenOut.symbol] || 0) + step.tokenOut.amount;
					}
				}
			}

			stepNumber++;
		}

		return steps;
	}

	private extractInputTokenFromIntent(input: string): {
		inputToken: string;
		defaultAmount: number;
	} {
		const amountMatch = input.match(/(\d+(?:\.\d+)?)\s*(WETH|USDC|USDT)/i);
		const tokenMatch = input.match(/(WETH|USDC|USDT)/i);

		const initialTokenMatch = input.match(/initial\s+token\s+is\s+(WETH|USDC|USDT)/i);
		const withTokenMatch = input.match(/with\s+(\d+(?:\.\d+)?)\s*(WETH|USDC|USDT)/i);

		let inputToken = "WETH";
		let defaultAmount = 10;

		if (initialTokenMatch) {
			inputToken = initialTokenMatch[1].toUpperCase();
		} else if (withTokenMatch) {
			defaultAmount = parseFloat(withTokenMatch[1]);
			inputToken = withTokenMatch[2].toUpperCase();
		} else if (amountMatch) {
			defaultAmount = parseFloat(amountMatch[1]);
			inputToken = amountMatch[2].toUpperCase();
		} else if (tokenMatch) {
			inputToken = tokenMatch[1].toUpperCase();
		}

		return { inputToken, defaultAmount };
	}

	private parseSupplyStepWithContext(
		stepLine: string,
		stepNumber: number,
		defaultInputToken: string,
		finalAmount: number,
		currentTokenAmounts: { [symbol: string]: number },
	): StrategyStepResponseDto | null {
		const tokenMatch = stepLine.match(/supply\s+(WETH|USDC|USDT)/i);
		const percentageMatch = stepLine.match(/(\d+)%/);

		let token: string;
		let amount: number;

		if (tokenMatch) {
			token = tokenMatch[1].toUpperCase();

			const availableAmount = currentTokenAmounts[token] || finalAmount;
			const percentage = percentageMatch ? parseInt(percentageMatch[1], 10) : 100;
			amount = (availableAmount * percentage) / 100;
		} else if (stepNumber === 1) {
			token = defaultInputToken;
			const percentage = percentageMatch ? parseInt(percentageMatch[1], 10) : 100;
			amount = (finalAmount * percentage) / 100;
		} else {
			token = "WETH";
			amount = finalAmount;
		}

		return {
			step: stepNumber,
			type: "SUPPLY",
			agent: "COFHE",
			tokenIn: {
				assetId: this.getAssetIdBySymbol(token),
				symbol: token,
				amount: Number(amount.toFixed(6)),
			},
		};
	}

	private parseBorrowStepWithContext(
		stepLine: string,
		stepNumber: number,
		_defaultInputToken: string,
		finalAmount: number,
		currentTokenAmounts: { [symbol: string]: number },
	): StrategyStepResponseDto | null {
		const borrowTokenMatch = stepLine.match(/borrow\s+(WETH|USDC|USDT)/i);
		const collateralTokenMatch = stepLine.match(/using.*?(WETH|USDC|USDT)/i);
		const ltvMatch = stepLine.match(/(\d+)%\s*ltv/i);

		const borrowToken = borrowTokenMatch ? borrowTokenMatch[1].toUpperCase() : "WETH";
		const ltv = ltvMatch ? parseInt(ltvMatch[1], 10) : 50;

		let borrowAmount: number;
		if (collateralTokenMatch) {
			const collateralToken = collateralTokenMatch[1].toUpperCase();
			const collateralAmount = currentTokenAmounts[collateralToken] || finalAmount;
			borrowAmount = (collateralAmount * ltv) / 100;
		} else {
			borrowAmount = (finalAmount * ltv) / 100;
		}

		return {
			step: stepNumber,
			type: "BORROW",
			agent: "COFHE",
			tokenOut: {
				assetId: this.getAssetIdBySymbol(borrowToken),
				symbol: borrowToken,
				amount: Number(borrowAmount.toFixed(6)),
			},
		};
	}

	private parseSwapStepFromIntent(
		stepLine: string,
		stepNumber: number,
		_defaultInputToken: string,
		finalAmount: number,
	): StrategyStepResponseDto | null {
		const swapMatch = stepLine.match(/swap\s+(\w+)\s+to\s+(\w+)/i);

		if (!swapMatch) return null;

		const tokenIn = swapMatch[1].toUpperCase();
		const tokenOut = swapMatch[2].toUpperCase();
		const amount = finalAmount;

		let outputAmount = amount;
		if (tokenIn === "WETH" && tokenOut === "USDC") outputAmount = amount * this.swapRateWethUsdc;
		if (tokenIn === "WETH" && tokenOut === "USDT") outputAmount = amount * this.swapRateWethUsdc;
		if (tokenIn === "USDC" && tokenOut === "WETH") outputAmount = amount * this.swapRateUsdcWeth;
		if (tokenIn === "USDT" && tokenOut === "WETH") outputAmount = amount * this.swapRateUsdcWeth;

		return {
			step: stepNumber,
			type: "SWAP",
			agent: "COFHE",
			tokenIn: {
				assetId: this.getAssetIdBySymbol(tokenIn),
				symbol: tokenIn,
				amount: Number(amount.toFixed(6)),
			},
			tokenOut: {
				assetId: this.getAssetIdBySymbol(tokenOut),
				symbol: tokenOut,
				amount: Number(outputAmount.toFixed(6)),
			},
		};
	}

	private getAssetIdBySymbol(symbol: string): string {
		const map: Record<string, string | undefined> = {
			WETH: process.env.TOKEN_WETH,
			USDC: process.env.TOKEN_USDC,
			USDT: process.env.TOKEN_USDT,
		};
		return map[symbol.toUpperCase()] ?? symbol;
	}

	private isCustomStrategy(intent: string): boolean {
		return (
			intent.includes("swap") ||
			intent.includes("supply") ||
			intent.includes("borrow") ||
			intent.includes("diversif") ||
			intent.includes("arbitrage") ||
			intent.includes("trade")
		);
	}

	private parseCustomStrategy(
		intent: string,
		inputToken: { symbol: string; amount: number; assetId?: string },
	): StrategyStepResponseDto[] {
		const steps: StrategyStepResponseDto[] = [];
		let stepNumber = 1;
		const assetId = inputToken.assetId || this.getAssetIdBySymbol(inputToken.symbol);

		const operations = this.extractOperationsFromIntent(intent, inputToken);

		for (const op of operations) {
			if (op.type === "swap") {
				steps.push({
					step: stepNumber++,
					type: "SWAP",
					agent: "COFHE",
					tokenIn: {
						assetId: assetId,
						symbol: inputToken.symbol,
						amount: op.amount || inputToken.amount,
					},
					tokenOut: {
						assetId: op.tokenOutId || this.getAssetIdBySymbol("USDC"),
						symbol: op.tokenOutSymbol || "USDC",
						amount: op.amountOut || inputToken.amount * this.swapRateWethUsdc,
					},
				});
			} else if (op.type === "supply") {
				steps.push({
					step: stepNumber++,
					type: "SUPPLY",
					agent: "COFHE",
					tokenIn: {
						assetId: assetId,
						symbol: inputToken.symbol,
						amount: op.amount || inputToken.amount,
					},
				});
			} else if (op.type === "borrow") {
				steps.push({
					step: stepNumber++,
					type: "BORROW",
					agent: "COFHE",
					tokenOut: {
						assetId: op.tokenOutId || this.getAssetIdBySymbol("WETH"),
						symbol: op.tokenOutSymbol || "WETH",
						amount: op.amount || inputToken.amount * 0.9,
					},
				});
			}
		}

		return steps;
	}

	private extractOperationsFromIntent(
		intent: string,
		inputToken: { symbol: string; amount: number; assetId?: string },
	): Array<{
		type: string;
		amount: number;
		tokenInId?: string;
		tokenOutId?: string;
		tokenInSymbol?: string;
		tokenOutSymbol?: string;
		amountOut?: number;
	}> {
		const operations: Array<{
			type: string;
			amount: number;
			tokenInId?: string;
			tokenOutId?: string;
			tokenInSymbol?: string;
			tokenOutSymbol?: string;
			amountOut?: number;
		}> = [];

		if (intent.includes("swap")) {
			operations.push({
				type: "swap",
				amount: inputToken.amount,
			});
		}

		if (intent.includes("supply") || intent.includes("deposit")) {
			operations.push({
				type: "supply",
				amount: inputToken.amount,
			});
		}

		if (intent.includes("borrow")) {
			operations.push({
				type: "borrow",
				amount: inputToken.amount * 0.9,
			});
		}

		return operations;
	}

	private createSimpleSupplyStrategy(inputToken: {
		symbol: string;
		amount: number;
		assetId?: string;
	}): StrategyStepResponseDto[] {
		const assetId = inputToken.assetId || this.getAssetIdBySymbol(inputToken.symbol);

		return [
			{
				step: 1,
				type: "SUPPLY",
				agent: "COFHE",
				tokenIn: {
					assetId: assetId,
					symbol: inputToken.symbol.toUpperCase(),
					amount: inputToken.amount,
				},
			},
		];
	}
}
