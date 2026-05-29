"use client";

import { AlertTriangle, CheckCircle, Eye, XCircle } from "lucide-react";
import type { BuildStrategyResponse } from "@/services/ai-strategy-service";
import { StrategySteps } from "./StrategySteps";

interface StrategyPreviewProps {
	strategy: BuildStrategyResponse;
	onViewDetails?: () => void;
	className?: string;
}

export function StrategyPreview({ strategy, onViewDetails, className = "" }: StrategyPreviewProps) {
	const { steps, validation, metadata } = strategy;

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

	return (
		<div className={`space-y-4 ${className}`}>
			<div className="border border-border bg-card p-4">
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-lg font-semibold text-foreground">Strategy Generated</h3>
					{onViewDetails && (
						<button
							onClick={onViewDetails}
							className="flex items-center gap-2 border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/20"
						>
							<Eye className="h-3 w-3" />
							View Details
						</button>
					)}
				</div>

				<div className="grid grid-cols-3 gap-4 mb-4">
					<div className="text-center">
						<div className="text-lg font-semibold text-foreground">{metadata.totalSteps}</div>
						<div className="text-xs text-muted">Steps</div>
					</div>
					<div className="text-center">
						<div className={`text-lg font-semibold ${getRiskLevelColor(metadata.riskLevel)}`}>
							{metadata.riskLevel}
						</div>
						<div className="text-xs text-muted">Risk</div>
					</div>
					<div className="text-center">
						<div className="text-lg font-semibold text-foreground">
							{Math.round(metadata.estimatedGas / 1000)}K
						</div>
						<div className="text-xs text-muted">Gas</div>
					</div>
				</div>

				<div className="flex items-center gap-2 mb-4">
					{validation.isValid ? (
						<>
							<CheckCircle className="h-4 w-4 text-success" />
							<span className="text-sm text-success">Strategy is valid</span>
						</>
					) : (
						<>
							<XCircle className="h-4 w-4 text-destructive" />
							<span className="text-sm text-destructive">Strategy has errors</span>
						</>
					)}

					{validation.warnings.length > 0 && (
						<>
							<AlertTriangle className="h-4 w-4 text-warning ml-2" />
							<span className="text-sm text-warning">
								{validation.warnings.length} warning
								{validation.warnings.length > 1 ? "s" : ""}
							</span>
						</>
					)}
				</div>

				{validation.errors.length > 0 && (
					<div className="mb-4 space-y-1">
						{validation.errors.slice(0, 2).map((error, index) => (
							<div key={index} className="text-xs text-destructive bg-destructive/10 px-2 py-1">
								{error}
							</div>
						))}
						{validation.errors.length > 2 && (
							<div className="text-xs text-muted">+{validation.errors.length - 2} more errors</div>
						)}
					</div>
				)}
			</div>

			<StrategySteps
				steps={steps}
				showHeader={false}
				compact={true}
				className="max-h-96 overflow-y-auto"
			/>
		</div>
	);
}

export default StrategyPreview;
