"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle, XCircle, Zap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { type Address, parseUnits } from "viem";
import { displayToast } from "@/components/shared/toast-manager";
import { StrategySteps } from "@/components/strategy/StrategySteps";
import type { OpenStrategyEncrypted, OpenStrategyParams } from "@/hooks/use-composer";
import { useComposer } from "@/hooks/use-composer";
import { SLIPPAGE_TOLERANCE } from "@/lib/constants";
import type { BuildStrategyResponse } from "@/services/ai-strategy-service";
import { TOKEN_SYMBOL_MAP } from "@/utils/addresses";

interface StoredStrategy {
	name: string;
	result: BuildStrategyResponse;
	selectedToken: string;
	prompt: string;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function decodeStrategyData(encoded: string): StoredStrategy | null {
	try {
		return JSON.parse(decodeURIComponent(escape(atob(encoded)))) as StoredStrategy;
	} catch {
		return null;
	}
}

export default function StrategyReviewClient() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [executing, setExecuting] = useState(false);
	const [slippage, setSlippage] = useState(SLIPPAGE_TOLERANCE);
	const [txHash, setTxHash] = useState<string | null>(null);
	const [ciphertextHandle, setCiphertextHandle] = useState<string | null>(null);
	const { openPosition, encrypt128ForComposer, isPending: composerPending } = useComposer();

	const encodedData = searchParams.get("data");
	const strategyIdParam = searchParams.get("strategyId");

	const { data: strategy, isLoading: loading } = useQuery<StoredStrategy | null>({
		queryKey: ["generatedStrategy", encodedData],
		queryFn: () => {
			if (!encodedData) {
				displayToast("error", "No strategy found. Please generate a strategy first.");
				router.push("/prompt");
				return null;
			}
			const parsed = decodeStrategyData(encodedData);
			if (!parsed) {
				displayToast("error", "Failed to load strategy data.");
				router.push("/prompt");
				return null;
			}
			return parsed;
		},
	});

	const resolvedTokenAddress = useMemo<Address | undefined>(() => {
		if (!strategy) return undefined;
		const token = strategy.selectedToken;
		if (token?.startsWith("0x")) return token as Address;
		const entry = TOKEN_SYMBOL_MAP[token ?? ""];
		return ((entry?.address ?? "") as Address) || undefined;
	}, [strategy]);

	const isTokenValid = resolvedTokenAddress != null && resolvedTokenAddress !== ZERO_ADDRESS;

	const handleBack = () => {
		router.push("/prompt");
	};

	const handleExecute = async () => {
		if (!strategy) return;
		if (!resolvedTokenAddress || !isTokenValid) {
			displayToast("error", "Invalid token selection. Please select a valid token.");
			return;
		}
		const { steps } = strategy.result;
		const supplyStep = steps.find((s) => s.type === "SUPPLY" || s.action === "SUPPLY");
		if (!supplyStep) {
			displayToast("error", "No SUPPLY step found in strategy.");
			return;
		}
		const borrowStep = steps.find((s) => s.type === "BORROW" || s.action === "BORROW");
		const collateralEth = String(supplyStep.amount ?? "0");
		const debtEth = String(borrowStep?.amount ?? "0");
		const storedStrategyId = strategyIdParam ? parseInt(strategyIdParam, 10) : 0;
		if (storedStrategyId <= 0) {
			displayToast("error", "No valid strategy ID found. Please generate a strategy first.");
			return;
		}

		const collateralWei = parseUnits(collateralEth, 18);
		const debtWei = parseUnits(debtEth, 18);
		const supplyWei = collateralWei;
		const borrowWei = debtWei;
		const minOutWei = (borrowWei * BigInt(Math.round((1 - slippage) * 10000))) / 10000n;

		setExecuting(true);
		try {
			const [encCollateral, encSupply, encBorrow] = await Promise.all([
				encrypt128ForComposer(collateralWei),
				encrypt128ForComposer(supplyWei),
				encrypt128ForComposer(borrowWei),
			]);

			const params: OpenStrategyParams = {
				strategyName: strategy.name,
				workflowHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
				collateralToken: resolvedTokenAddress,
				collateralAmount: collateralWei,
				poolSupplyAmount: supplyWei,
				borrowToken: resolvedTokenAddress,
				poolBorrowAmount: borrowWei,
				useOracleBorrow: false,
				ltvNum: 70n,
				ltvDen: 100n,
				swapTokenOut: resolvedTokenAddress,
				swapDeadlineOffset: 3600n,
				strategyId: BigInt(storedStrategyId),
				apyTarget: 0,
				loopCount: 1,
				swapAmountIn: borrowWei,
				swapMinOut: minOutWei,
			};

			const encrypted: OpenStrategyEncrypted = {
				collateral: encCollateral,
				supplyEnc: encSupply,
				borrowEnc: encBorrow,
			};

			const hash = await openPosition(params, encrypted);
			if (hash && typeof hash === "string") {
				setTxHash(hash);
			}
			if (params.workflowHash && params.workflowHash !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
				setCiphertextHandle(params.workflowHash);
			}
			router.push("/strategy");
		} catch (e: unknown) {
			console.warn("openPosition failed:", e);
			displayToast("error", "Strategy execution failed. Please try again.");
		} finally {
			setExecuting(false);
		}
	};

	const getRiskLevelColor = (riskLevel: string) => {
		switch (riskLevel.toUpperCase()) {
			case "LOW":
				return "text-success";
			case "MEDIUM":
				return "text-warning";
			case "HIGH":
				return "text-destructive";
			default:
				return "text-muted";
		}
	};

	if (loading) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-foreground">Loading strategy...</div>
			</div>
		);
	}

	if (!strategy) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-foreground">No strategy found</div>
			</div>
		);
	}

	const { result, name, selectedToken, prompt } = strategy;
	const { steps, validation, metadata, aiAnalysis } = result;
	const safeValidation = validation ?? {
		isValid: false,
		errors: [] as string[],
		warnings: [] as string[],
	};
	const safeMetadata = metadata ?? {
		totalSteps: 0,
		estimatedGas: 0,
		riskLevel: "UNKNOWN",
		aiGenerated: false,
	};

	const isExecuting = executing || composerPending;
	const submitDisabled = !safeValidation.isValid || isExecuting || !isTokenValid;

	return (
		<div className="min-h-screen bg-background px-6 py-8">
			<div className="mx-auto max-w-6xl">
				<div className="mb-8 flex items-center justify-between">
					<div className="flex items-center gap-4">
						<button
							onClick={handleBack}
							className="flex h-10 w-10 items-center justify-center border border-border text-muted hover:border-accent hover:text-accent transition-colors"
						>
							<ArrowLeft className="h-4 w-4" />
						</button>
						<div>
							<h1 className="text-2xl font-semibold text-foreground">{name}</h1>
							<p className="text-sm text-muted">Strategy Review</p>
						</div>
					</div>

					<button
						onClick={handleExecute}
						disabled={submitDisabled}
						className="flex items-center gap-2 bg-accent px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Zap className="h-4 w-4" />
						Execute Strategy
					</button>
				</div>

				<div className="grid gap-6 lg:grid-cols-3">
					<div className="lg:col-span-2 space-y-6">
						<div className="border border-border bg-card p-6">
							<h2 className="mb-4 text-lg font-semibold text-foreground">Original Prompt</h2>
							<div className="space-y-2">
								<div className="text-sm text-muted">
									<span className="font-medium">Starting Token:</span> {selectedToken}
								</div>
								<div className="bg-secondary p-3 text-sm text-foreground">{prompt}</div>
							</div>
						</div>

						<StrategySteps steps={steps} />

						{result.fhe_note && (
							<div className="border border-accent/20 bg-accent/5 p-4 text-sm text-accent">
								🔒 {result.fhe_note}
							</div>
						)}

						{txHash && (
							<div className="mt-3 font-mono text-xs text-muted border border-border p-2">
								<span className="text-muted mr-2">tx</span>
								<span className="text-foreground">{txHash}</span>
							</div>
						)}

						{ciphertextHandle && (
							<div className="mt-3 font-mono text-xs text-muted border border-border p-2">
								<span className="text-muted mr-2">ciphertext</span>
								<span className="text-foreground">{ciphertextHandle}</span>
							</div>
						)}
					</div>

					<div className="space-y-6">
						<div className="border border-border bg-card p-6">
							<h3 className="mb-4 text-lg font-semibold text-foreground">Slippage Tolerance</h3>
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted">Slippage:</span>
									<span className="text-sm font-medium text-foreground">
										{(slippage * 100).toFixed(2)}%
									</span>
								</div>
								<input
									type="range"
									min="0.1"
									max="5"
									step="0.1"
									value={slippage}
									onChange={(e) => setSlippage(Number(e.target.value))}
									className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
								/>
								<div className="flex justify-between text-xs text-muted">
									<span>0.1%</span>
									<span>5%</span>
								</div>
							</div>
						</div>

						<div className="border border-border bg-card p-6">
							<h3 className="mb-4 text-lg font-semibold text-foreground">Validation</h3>
							<div className="space-y-3">
								<div className="flex items-center gap-2">
									{safeValidation.isValid ? (
										<CheckCircle className="h-5 w-5 text-success" />
									) : (
										<XCircle className="h-5 w-5 text-destructive" />
									)}
									<span className={safeValidation.isValid ? "text-success" : "text-destructive"}>
										{safeValidation.isValid ? "Valid Strategy" : "Invalid Strategy"}
									</span>
								</div>

								{safeValidation.errors.length > 0 && (
									<div className="space-y-1">
										<div className="text-sm font-medium text-destructive">Errors:</div>
										{safeValidation.errors.map((error, index) => (
											<div key={index} className="text-xs text-destructive/80">
												• {error}
											</div>
										))}
									</div>
								)}

								{safeValidation.warnings.length > 0 && (
									<div className="space-y-1">
										<div className="text-sm font-medium text-warning">Warnings:</div>
										{safeValidation.warnings.map((warning, index) => (
											<div key={index} className="text-xs text-warning/80">
												• {warning}
											</div>
										))}
									</div>
								)}
							</div>
						</div>

						<div className="border border-border bg-card p-6">
							<h3 className="mb-4 text-lg font-semibold text-foreground">Strategy Info</h3>
							<div className="space-y-3">
								<div className="flex justify-between">
									<span className="text-sm text-muted">Total Steps:</span>
									<span className="text-sm text-foreground">{safeMetadata.totalSteps}</span>
								</div>
								<div className="flex justify-between">
									<span className="text-sm text-muted">Estimated Gas:</span>
									<span className="text-sm text-foreground">
										{safeMetadata.estimatedGas.toLocaleString()}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-sm text-muted">Risk Level:</span>
									<span className={`text-sm ${getRiskLevelColor(safeMetadata.riskLevel)}`}>
										{safeMetadata.riskLevel}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-sm text-muted">AI Generated:</span>
									<span className="text-sm text-foreground">
										{safeMetadata.aiGenerated ? "Yes" : "No"}
									</span>
								</div>
							</div>
						</div>

						{aiAnalysis && (
							<div className="border border-border bg-card p-6">
								<h3 className="mb-4 text-lg font-semibold text-foreground">AI Analysis</h3>

								{aiAnalysis.riskFactors.length > 0 && (
									<div className="mb-4">
										<div className="mb-2 flex items-center gap-2">
											<AlertTriangle className="h-4 w-4 text-warning" />
											<span className="text-sm font-medium text-warning">Risk Factors</span>
										</div>
										<div className="space-y-1">
											{aiAnalysis.riskFactors.map((factor, index) => (
												<div key={index} className="text-xs text-muted">
													• {factor}
												</div>
											))}
										</div>
									</div>
								)}

								{aiAnalysis.recommendations.length > 0 && (
									<div>
										<div className="mb-2 flex items-center gap-2">
											<CheckCircle className="h-4 w-4 text-success" />
											<span className="text-sm font-medium text-success">Recommendations</span>
										</div>
										<div className="space-y-1">
											{aiAnalysis.recommendations.map((rec, index) => (
												<div key={index} className="text-xs text-muted">
													• {rec}
												</div>
											))}
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
