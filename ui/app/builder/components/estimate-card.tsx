"use client";

import type {
	DefiEstimate,
	DefiOperationType,
} from "@/app/builder/components/nodes/defi-node.types";

interface TokenMeta {
	id?: string;
	asset_id?: string;
	name?: string;
}

interface EstimateCardProps {
	estimate: DefiEstimate;
	operationType: DefiOperationType;
	selectedPair?: {
		token_in?: TokenMeta;
		token_out?: TokenMeta;
	} | null;
}

export function EstimateCard({ estimate, operationType, selectedPair }: EstimateCardProps) {
	const cardBaseStyle =
		"glass border p-5 relative overflow-hidden group animate-in zoom-in-95 duration-300";

	if (operationType === "SWAP") {
		const estimatedOutput =
			estimate?.amount_out ??
			estimate?.output_amount ??
			estimate?.result_amount ??
			estimate?.received_amount ??
			0;

		return (
			<div className={`${cardBaseStyle} bg-primary/5 border-primary/20`}>
				<p className="text-xs text-muted font-medium">
					Estimated Output
				</p>
				<div className="flex items-baseline gap-2 mt-2">
					<p className="text-3xl font-bold text-foreground leading-none">
						{Number(estimatedOutput).toFixed(6)}
					</p>
					<p className="text-sm font-medium text-primary/80">{selectedPair?.token_out?.name}</p>
				</div>
				<div className="flex justify-between mt-4 pt-3 border-t border-border text-[11px]">
					<span className="text-muted">Max Slippage</span>
					<span className="text-foreground font-mono">
						{((estimate?.slippage || 0) * 100).toFixed(2)}%
					</span>
				</div>
			</div>
		);
	}

	if (operationType === "SUPPLY") {
		return (
			<div className={`${cardBaseStyle} bg-primary/5 border-primary/20`}>
				<p className="text-xs text-muted font-medium">
					Supply Strategy
				</p>
				<div className="mt-2">
					<p className="text-3xl font-bold text-foreground leading-none">
						{Number(estimate?.supply_apy ?? estimate?.apy ?? 0).toFixed(2)}%
					</p>
					<p className="text-xs text-muted mt-2 font-medium">ESTIMATED NET APY</p>
				</div>
			</div>
		);
	}

	if (operationType === "BORROW") {
		return (
			<div className={`${cardBaseStyle} bg-secondary/10 border-border`}>
				<p className="text-xs text-muted font-medium">Borrow Details</p>

				<div className="space-y-3 mt-3">
					<div className="flex justify-between items-center">
						<span className="text-xs text-muted">Amount Out</span>
						<span className="text-sm font-bold text-foreground">
							{Number(estimate?.borrow_amount ?? estimate?.amount_out ?? 0).toFixed(4)}{" "}
							{selectedPair?.token_out?.name}
						</span>
					</div>
					<div className="flex justify-between items-center">
						<span className="text-xs text-muted">Borrow APY</span>
						<span className="text-sm font-bold text-red-400">
							{Number(estimate?.borrow_apy ?? estimate?.apy ?? 0).toFixed(2)}%
						</span>
					</div>
					<div className="flex justify-between items-center pt-2 border-t border-border">
						<span className="text-xs text-muted">LTV Ratio</span>
						<span className="text-sm font-bold text-primary">
							{Number(estimate?.ltv ?? estimate?.max_ltv ?? 0).toFixed(2)}%
						</span>
					</div>
				</div>
			</div>
		);
	}

	return null;
}
