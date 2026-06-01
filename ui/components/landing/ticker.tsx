"use client";

import React from "react";
import type { ProtocolStats } from "@/services/stats-service";

export interface TickerProps {
	stats: ProtocolStats | null;
}

/**
 * Ticker · slow horizontal scroll of "live" protocol state
 * Seamless infinite marquee with duplicated item array.
 */
export function Ticker({ stats }: TickerProps): JSX.Element {
	const items: string[] = [
		stats ? `block #${(stats.totalDeployments * 142 + 182_944_000).toLocaleString()}` : "block #182,944,108",
		stats ? `gas · ${(0.01 + (stats.totalUsers % 10) * 0.001).toFixed(3)} gwei` : "gas · 0.014 gwei",
		stats ? `USDC pool tvl · $${(stats.poolTvls.USDC / 1e6).toFixed(2)}M` : "USDC pool tvl · $8.42M",
		stats ? `ETH pool tvl · $${(stats.poolTvls.ETH / 1e6).toFixed(2)}M` : "ETH pool tvl · $4.18M",
		stats ? `WBTC pool tvl · $${(stats.poolTvls.WBTC / 1e6).toFixed(2)}M` : "WBTC pool tvl · $1.80M",
		stats ? `encrypted ops · ${(stats.encryptedOps / 1e6).toFixed(2)}M` : "encrypted ops · 1.42M",
		stats ? `permit decrypts · ${stats.permitDecryptsDay >= 1000 ? `${(stats.permitDecryptsDay / 1e3).toFixed(0)}k` : stats.permitDecryptsDay.toString()} / day` : "permit decrypts · 42k / day",
		stats ? `active strategies · ${stats.activeStrategies}` : "active strategies · 412",
		stats ? `deployed via composer · ${stats.totalDeployments.toLocaleString()}` : "deployed via composer · 1,284",
	];

	// Duplicate for seamless loop
	const loop = [...items, ...items];

	return (
		<div
			className="overflow-hidden flex items-center relative"
			style={{
				borderTop: "1px solid var(--border)",
				background: "var(--card)",
				height: 36,
			}}
		>
			<div
				className="flex whitespace-nowrap"
				style={{
					gap: 36,
					animation: "tickerLoop 60s linear infinite",
					paddingLeft: 28,
					willChange: "transform",
				}}
			>
				{loop.map((text, i) => (
					<span
						key={i}
						className="mono uppercase text-[11px] tracking-wide"
						style={{ color: "var(--muted)" }}
					>
						{text}
					</span>
				))}
			</div>
		</div>
	);
}
