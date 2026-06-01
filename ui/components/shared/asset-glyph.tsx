"use client";

import React from "react";

export interface AssetGlyphProps {
	asset: string;
	size?: number;
	className?: string;
}

const ASSET_COLORS: Record<string, string> = {
	USDC: "#2775CA",
	ETH: "#627EEA",
	WBTC: "#F7931A",
	ARB: "#28A0F0",
	DAI: "#F5AC37",
	USDT: "#26A17B",
	WETH: "#627EEA",
};

export function AssetGlyph({
	asset,
	size = 24,
	className = "",
}: AssetGlyphProps): JSX.Element {
	const color = ASSET_COLORS[asset] || "var(--muted)";
	return (
		<span
			className={`asset-glyph ${className}`}
			style={{
				display: "inline-grid",
				placeItems: "center",
				width: size,
				height: size,
				borderRadius: size,
				background: color,
				color: "var(--background)",
				fontSize: Math.round(size * 0.42),
				fontWeight: 600,
				letterSpacing: 0,
				flex: "0 0 auto",
			}}
		>
			{asset.slice(0, 1)}
		</span>
	);
}
