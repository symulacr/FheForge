"use client";

import { AlertCircle, Check, ChevronRight, Loader2 } from "lucide-react";
import type { ExecutionStatus, ExecutionStep } from "./types";

interface StepItemProps {
	step: ExecutionStep;
	index: number;
	explorerBase?: string;
}

const statusStyles: Record<ExecutionStatus, string> = {
	completed: "border-success bg-success/10",
	processing: "border-accent bg-accent/10",
	failed: "border-destructive bg-destructive/10",
	pending: "border-border bg-card",
};

export function StepItem({ step, index, explorerBase }: StepItemProps) {
	const txUrl =
		step.txHash && explorerBase
			? `${explorerBase.replace(/\/$/, "")}/extrinsic/${step.txHash}`
			: undefined;

	return (
		<div className={`p-4 border transition-all duration-300 ${statusStyles[step.status]}`}>
			<div className="flex items-start gap-3">
				<div className="mt-0.5">
					{step.status === "completed" && (
						<div className="w-6 h-6 bg-success flex items-center justify-center">
							<Check className="w-4 h-4 text-foreground" />
						</div>
					)}
					{step.status === "processing" && (
						<div className="w-6 h-6 bg-accent flex items-center justify-center">
							<Loader2 className="w-4 h-4 text-foreground animate-spin" />
						</div>
					)}
					{step.status === "failed" && (
						<div className="w-6 h-6 bg-destructive flex items-center justify-center">
							<AlertCircle className="w-4 h-4 text-foreground" />
						</div>
					)}
					{step.status === "pending" && (
						<div className="w-6 h-6 border-2 border-muted flex items-center justify-center">
							<span className="text-xs text-muted">{index + 1}</span>
						</div>
					)}
				</div>

				<div className="flex-1">
					<h4 className="font-semibold mb-1">{step.title}</h4>
					<p className="text-sm text-muted">{step.description}</p>
					{step.status === "processing" && (
						<p className="text-xs text-accent mt-2 animate-pulse">Processing transaction...</p>
					)}
					{step.status === "completed" && step.txHash && (
						<div className="mt-2.5 pt-2.5 border-t border-border">
							{txUrl ? (
								<a
									href={txUrl}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-xs font-mono text-success hover:underline"
								>
									{step.txHash.slice(0, 8)}...{step.txHash.slice(-6)}
									<ChevronRight className="w-3 h-3" />
								</a>
							) : (
								<span className="text-xs font-mono text-success">
									{step.txHash.slice(0, 8)}...{step.txHash.slice(-6)}
								</span>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
