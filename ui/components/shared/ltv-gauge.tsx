"use client";

import React from "react";

export interface LtvGaugeProps {
	ltv: number;
	liqThreshold: number;
	max?: number;
	height?: number;
	showLabels?: boolean;
	className?: string;
}

export function LtvGauge({
	ltv,
	liqThreshold,
	max = 100,
	height = 8,
	showLabels = true,
	className = "",
}: LtvGaugeProps): JSX.Element {
	const pct = Math.min(100, (ltv / max) * 100);
	const liqPct = (liqThreshold / max) * 100;
	const danger = ltv >= liqThreshold - 5;

	const fillColor = danger
		? "var(--destructive)"
		: ltv > liqThreshold * 0.7
			? "var(--warning)"
			: "var(--success)";

	return (
		<div className={`ltv-gauge ${className}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			<div className="meter" style={{ height }}>
				<div
					className="fill"
					style={{ width: `${pct}%`, background: fillColor }}
				/>
				<div className="tick danger" style={{ left: `${liqPct}%` }} />
			</div>
			{showLabels && (
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						fontSize: 11,
						color: "var(--muted)",
					}}
				>
					<span>LTV {ltv.toFixed(1)}%</span>
					<span>liq · {liqThreshold}%</span>
				</div>
			)}
		</div>
	);
}
