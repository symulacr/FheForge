"use client";

import { ArrowDown, Play, Workflow } from "lucide-react";
import Image from "next/image";
import { assetIcons } from "@/lib/iconMap";
import type { BuildStrategyResponse, StrategyStep } from "@/services/ai-strategy-service";

interface StrategyFlowPreviewProps {
	strategy: BuildStrategyResponse;
	selectedToken: string;
	onRunStrategy?: () => void;
	className?: string;
}

export function StrategyFlowPreview({
	strategy,
	selectedToken,
	onRunStrategy,
	className = "",
}: StrategyFlowPreviewProps) {
	const { steps, metadata } = strategy;

	const getInitialToken = () => {
		const firstStepWithToken = steps.find((step) => step.tokenIn?.symbol);
		return firstStepWithToken?.tokenIn?.symbol || selectedToken;
	};

	const initialToken = getInitialToken();

	const formatAmount = (amount: number | undefined) => {
		if (amount == null) return "0";
		if (amount < 0.001) return amount.toExponential(3);
		return amount.toFixed(6).replace(/\.?0+$/, "");
	};

	const calculateGasCostUSD = () => {
		return (0.01 * steps.length).toFixed(2);
	};

	const getRiskColor = (riskLevel: string) => {
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

	return (
		<div
			className={`forge-card overflow-hidden ${className}`}
		>
			{/* Header */}
			<div className="border-b border-border p-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-warning">
						<Workflow className="h-4 w-4" />
						<span className="text-sm font-medium">Strategy Flow</span>
					</div>
					<span className="text-xs text-muted tabular-nums">{steps.length} steps</span>
				</div>
			</div>

			{/* Steps */}
			<div className="p-4">
				<div className="max-h-64 overflow-y-auto custom-scroll space-y-2">
					{steps.map((step: StrategyStep, idx: number) => {
						const hasIn = !!step.tokenIn;
						const hasOut = !!step.tokenOut;
						const hasBoth = hasIn && hasOut;

						return (
							<div
								key={idx}
								className="relative bg-secondary border border-border p-2 transition-colors hover:border-accent/40"
							>
								{/* Step Header */}
								<div className="flex justify-between items-center mb-1.5">
									<div className="flex items-center gap-2">
										<div className="w-5 h-5 bg-card border border-border text-foreground flex items-center justify-center text-xs font-medium tabular-nums">
											{step.step}
										</div>
										<span className="text-xs font-medium text-foreground">
											{step.type.replace("_", " ")}
										</span>
									</div>
									<span className="text-[10px] text-muted uppercase tracking-wider">
										{step.agent}
									</span>
								</div>

								{/* Token Flow */}
								{(hasIn || hasOut) && (
									<div className="flex items-center justify-between text-xs bg-card p-1.5">
										{hasIn ? (
											<div className="flex items-center gap-1.5">
												<Image
													src={
														(step.tokenIn?.symbol && assetIcons[step.tokenIn.symbol]) ||
														"/icons/default.png"
													}
													alt={step.tokenIn?.symbol ?? ""}
													width={14}
													height={14}
													className="w-3.5 h-3.5 object-contain"
												/>
												<span className="font-medium text-foreground">
													{step.tokenIn?.symbol}
												</span>
												<span className="text-muted tabular-nums">
													{formatAmount(step.tokenIn?.amount)}
												</span>
											</div>
										) : (
											<span />
										)}

										{hasBoth && (
											<ArrowDown className="w-3 h-3 text-accent -rotate-90" aria-hidden />
										)}

										{hasOut ? (
											<div className="flex items-center gap-1.5">
												<Image
													src={
														(step.tokenOut?.symbol && assetIcons[step.tokenOut.symbol]) ||
														"/icons/default.png"
													}
													alt={step.tokenOut?.symbol ?? ""}
													width={14}
													height={14}
													className="w-3.5 h-3.5 object-contain"
												/>
												<span className="font-medium text-foreground">
													{step.tokenOut?.symbol}
												</span>
												<span className="text-muted tabular-nums">
													{formatAmount(step.tokenOut?.amount)}
												</span>
											</div>
										) : (
											<span />
										)}
									</div>
								)}

								{/* Connector */}
								{idx < steps.length - 1 && (
									<div className="absolute left-1/2 -bottom-2 -translate-x-1/2 z-10">
										<div className="w-4 h-4 bg-card border border-border flex items-center justify-center">
											<ArrowDown className="w-2 h-2 text-muted" />
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>

				{/* Summary */}
				<div className="mt-4 pt-3 border-t border-border">
					<div className="grid grid-cols-3 gap-2 mb-3">
						<div className="text-center">
							<div className="flex items-center justify-center mb-1">
								<Image
									src={assetIcons[initialToken] || "/icons/default.png"}
									alt={initialToken}
									width={14}
									height={14}
									className="w-3.5 h-3.5 object-contain"
								/>
							</div>
							<div className="text-xs font-medium text-foreground">{initialToken}</div>
							<div className="text-[10px] text-muted">Initial</div>
						</div>

						<div className="text-center">
							<div className={`text-xs font-medium ${getRiskColor(metadata.riskLevel)}`}>
								{metadata.riskLevel}
							</div>
							<div className="text-[10px] text-muted">Risk</div>
						</div>

						<div className="text-center">
							<div className="text-xs font-medium text-foreground tabular-nums">
								${calculateGasCostUSD()}
							</div>
							<div className="text-[10px] text-muted">Est. Gas</div>
						</div>
					</div>

					{onRunStrategy && (
						<button
							onClick={onRunStrategy}
							className="w-full terminal-btn primary flex items-center justify-center gap-2 py-2"
						>
							<Play className="h-3 w-3" />
							Run Strategy
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

export default StrategyFlowPreview;
