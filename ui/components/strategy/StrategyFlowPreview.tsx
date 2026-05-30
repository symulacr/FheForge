"use client";

import { motion } from "framer-motion";
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
			className={`relative overflow-hidden bg-card text-card-foreground border border-border transition-colors duration-300 hover:border-accent/50 ${className}`}
		>
			<div className="border-b border-border p-5 pb-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-warning">
						<Workflow className="h-4 w-4" />
						<span className="text-sm font-semibold">Strategy Flow</span>
					</div>
					<div className="text-xs text-muted">{steps.length} steps</div>
				</div>
			</div>

			<div className="p-4">
				<div className="max-h-[300px] overflow-y-auto pr-2 space-y-2 custom-scroll">
					{steps.map((step: StrategyStep, idx: number) => {
						const hasIn = !!step.tokenIn;
						const hasOut = !!step.tokenOut;
						const hasBoth = hasIn && hasOut;

						return (
							<motion.div
								key={idx}
								initial={{ opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.3, delay: idx * 0.05 }}
								className="relative bg-secondary border border-border hover:border-accent/40 transition-colors duration-300 p-2"
							>
								<div className="flex justify-between items-center mb-1">
									<div className="flex items-center gap-2">
										<div className="w-5 h-5 bg-card border border-border text-foreground flex items-center justify-center text-xs font-bold">
											{step.step}
										</div>
										<h4 className="text-xs font-semibold text-foreground">
											{step.type.replace("_", " ")}
										</h4>
									</div>
									<span className="text-xs text-muted">{step.agent}</span>
								</div>

								{(hasIn || hasOut) && (
									<div className="flex items-center justify-between text-xs bg-card p-1.5">
										{hasIn ? (
											<div className="flex items-center gap-1 text-foreground">
												<Image
													src={
														(step.tokenIn?.symbol && assetIcons[step.tokenIn.symbol]) ||
														"/icons/default.png"
													}
													alt={step.tokenIn?.symbol ?? ""}
													width={16}
													height={16}
													className="w-4 h-4 object-contain bg-card border border-border"
												/>
												<span className="font-medium">{step.tokenIn?.symbol}</span>
												<span className="text-muted">{formatAmount(step.tokenIn?.amount)}</span>
											</div>
										) : (
											<div className="opacity-0">-</div>
										)}

										{hasBoth && (
											<ArrowDown className="w-2 h-2 text-accent -rotate-90" aria-hidden />
										)}

										{hasOut ? (
											<div className="flex items-center gap-1 text-foreground">
												<Image
													src={
														(step.tokenOut?.symbol && assetIcons[step.tokenOut.symbol]) ||
														"/icons/default.png"
													}
													alt={step.tokenOut?.symbol ?? ""}
													width={16}
													height={16}
													className="w-4 h-4 object-contain bg-card border border-border"
												/>
												<span className="font-medium">{step.tokenOut?.symbol}</span>
												<span className="text-muted">{formatAmount(step.tokenOut?.amount)}</span>
											</div>
										) : (
											<div className="opacity-0">-</div>
										)}
									</div>
								)}

								{idx < steps.length - 1 && (
									<div className="absolute left-1/2 -bottom-2 transform -translate-x-1/2 z-10">
										<div className="w-4 h-4 bg-card border border-border flex items-center justify-center">
											<ArrowDown className="w-2 h-2 text-muted" />
										</div>
									</div>
								)}
							</motion.div>
						);
					})}
				</div>

				<div className="mt-4 pt-3 border-t border-border">
					<div className="grid grid-cols-3 gap-2 mb-3">
						<div className="text-center">
							<div className="flex items-center justify-center gap-1 mb-1">
								<Image
									src={assetIcons[initialToken] || "/icons/default.png"}
									alt={initialToken}
									width={16}
									height={16}
									className="w-4 h-4 object-contain bg-card border border-border"
								/>
							</div>
							<div className="text-xs font-semibold text-foreground">{initialToken}</div>
							<div className="text-xs text-muted">Initial</div>
						</div>

						<div className="text-center">
							<div className={`text-xs font-semibold ${getRiskColor(metadata.riskLevel)}`}>
								{metadata.riskLevel}
							</div>
							<div className="text-xs text-muted">Risk</div>
						</div>

						<div className="text-center">
							<div className="text-xs font-semibold text-foreground">${calculateGasCostUSD()}</div>
							<div className="text-xs text-muted">Est. Gas</div>
						</div>
					</div>

					{onRunStrategy && (
						<button
							onClick={onRunStrategy}
							className="w-full flex items-center justify-center gap-2 border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
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
