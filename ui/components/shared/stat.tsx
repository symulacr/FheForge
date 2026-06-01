"use client";

import React from "react";
import { Cipher } from "./cipher";

export interface StatProps {
	kicker: string;
	value: string | number;
	sub?: string;
	locked?: boolean;
	size?: "sm" | "md" | "lg" | "xl" | "xxl";
	className?: string;
}

export function Stat({
	kicker,
	value,
	sub,
	locked = false,
	size = "lg",
	className = "",
}: StatProps): JSX.Element {
	return (
		<div className={`stat ${className}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			<div className="stat-kicker" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>
				{kicker}
			</div>
			<Cipher value={value} locked={locked} size={size} />
			{sub && (
				<div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.04em" }}>
					{sub}
				</div>
			)}
		</div>
	);
}
