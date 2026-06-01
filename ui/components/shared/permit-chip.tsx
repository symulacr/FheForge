"use client";

import React from "react";

export interface PermitChipProps {
	unlocked: boolean;
	secondsLeft: number;
	onClick: () => void;
	className?: string;
}

export function PermitChip({
	unlocked,
	secondsLeft,
	onClick,
	className = "",
}: PermitChipProps): JSX.Element {
	const mm = Math.max(0, Math.floor(secondsLeft / 60));
	const ss = Math.max(0, secondsLeft % 60).toString().padStart(2, "0");

	return (
		<button
			onClick={onClick}
			className={`chip ${unlocked ? "live" : "warn"} ${className}`}
			style={{
				cursor: "pointer",
				background: unlocked ? "var(--background)" : "var(--accent-muted)",
				borderColor: unlocked ? "var(--border)" : "var(--accent)",
			}}
			title={
				unlocked
					? "Permit live. Your wallet can decrypt your own balances. Click to renew."
					: "No permit. Encrypted balances stay blurred. Click to grant."
				}
		>
			<span className="dot" />
			<span>{unlocked ? `permit · ${mm}:${ss}` : "permit · locked"}</span>
		</button>
	);
}
