import { PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH } from "@/lib/constants";
import { api } from "@/services/api";
import type {
	AIAnalysis,
	BuildStrategyRequest,
	BuildStrategyResponse,
	StrategyMetadata,
	StrategyStep,
	ValidationResult,
} from "@/types/defi.strategy";

export type {
	AIAnalysis,
	BuildStrategyRequest,
	BuildStrategyResponse,
	StrategyMetadata,
	StrategyStep,
	ValidationResult,
};

export class AIStrategyService {
	static async buildStrategy(request: BuildStrategyRequest): Promise<BuildStrategyResponse> {
		try {
			const response = await api.post("/ai-strategy-builder/build", request);
			return response.data;
		} catch (error: unknown) {
			const axiosError = error as {
				response?: {
					status?: number;
					statusText?: string;
					data?: { message?: string };
				};
				request?: unknown;
				message?: string;
			};
			console.error("Failed to build strategy:", error);
			// Handle different types of errors
			if (axiosError.response) {
				// Server responded with error status
				const status = axiosError.response.status;
				const statusText = axiosError.response.statusText;
				const serverMessage = axiosError.response.data?.message || "Unknown server error";

				console.error("Server error details:", {
					status,
					statusText,
					data: axiosError.response.data,
				});

				// Create concise error message
				const errorMessage = `${status} ${statusText}: ${serverMessage}`;

				throw new Error(errorMessage);
			} else if (axiosError.request) {
				// Request was made but no response received
				console.error("Network error:", axiosError.request);
				throw new Error("Network error: Unable to connect to server");
			} else {
				// Something else happened
				console.error("Request setup error:", axiosError.message);
				throw new Error(axiosError.message || "Failed to build strategy");
			}
		}
	}

	static formatTokenToContext(tokenSymbol: string): string {
		return `My initial token is ${tokenSymbol}`;
	}

	static validatePrompt(prompt: string): { isValid: boolean; error?: string } {
		if (!prompt.trim()) {
			return { isValid: false, error: "Please enter your strategy prompt." };
		}

		if (prompt.length < PROMPT_MIN_LENGTH) {
			return {
				isValid: false,
				error: `Strategy prompt must be at least ${PROMPT_MIN_LENGTH} characters long.`,
			};
		}

		if (prompt.length > PROMPT_MAX_LENGTH) {
			return {
				isValid: false,
				error: `Strategy prompt must be less than ${PROMPT_MAX_LENGTH} characters.`,
			};
		}

		return { isValid: true };
	}

	static validateTokenConsistency(
		steps: StrategyStep[],
		selectedToken: string,
	): { isValid: boolean; error?: string } {
		if (!steps || steps.length === 0) {
			return { isValid: true };
		}

		const stepToCheck = steps.find((s) => s.tokenIn?.symbol);
		if (!stepToCheck) {
			return { isValid: true };
		}

		const stepTokenSymbol = stepToCheck.tokenIn?.symbol.toUpperCase();
		const startingTokenSymbol = selectedToken.toUpperCase();

		if (stepTokenSymbol !== startingTokenSymbol) {
			return {
				isValid: false,
				error: `Choose token consistency for the workflow. Starting token is ${startingTokenSymbol} but step expects ${stepTokenSymbol}.`,
			};
		}

		return { isValid: true };
	}
}
