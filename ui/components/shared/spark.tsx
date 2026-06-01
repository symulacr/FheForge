"use client";

import React from "react";

export interface SparkProps {
	data: number[];
	width?: number;
	height?: number;
	color?: string;
	className?: string;
}

export function Spark({
	data,
	width = 96,
	height = 28,
	color = "var(--foreground)",
	className = "",
}: SparkProps): JSX.Element {
	if (!data || data.length < 2) return <svg width={width} height={height} className={className} />;

	const max = Math.max(...data);
	const min = Math.min(...data);
	const range = max - min || 1;
	const stepX = width / (data.length - 1);

	const pathData = data
		.map((value, i) => {
			const x = i * stepX;
			const y = height - ((value - min) / range) * (height - 4) - 2;
			return `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");

	return (
		<svg
			width={width}
			height={height}
			className={`spark ${className}`}
			style={{ display: "block" }}
		>
			<path
				d={pathData}
				stroke={color}
				strokeWidth="1.3"
				fill="none"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
