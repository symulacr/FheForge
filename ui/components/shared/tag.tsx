"use client";

import React from "react";

export type TagTone = "default" | "accent" | "positive" | "danger" | "ink";

export interface TagProps {
	children: React.ReactNode;
	tone?: TagTone;
	className?: string;
}

const TONE_COLORS: Record<
	TagTone,
	{ bg: string; color: string; border: string }
> = {
	default: {
		bg: "var(--card)",
		color: "var(--foreground-secondary)",
		border: "var(--border)",
	},
	accent: {
		bg: "var(--accent-muted)",
		color: "var(--accent)",
		border: "var(--accent)",
	},
	positive: {
		bg: "var(--success-muted)",
		color: "var(--success)",
		border: "var(--success)",
	},
	danger: {
		bg: "var(--destructive-muted)",
		color: "var(--destructive)",
		border: "var(--destructive)",
	},
	ink: {
		bg: "var(--foreground)",
		color: "var(--background)",
		border: "var(--foreground)",
	},
};

export function Tag({ children, tone = "default", className = "" }: TagProps): JSX.Element {
	const t = TONE_COLORS[tone];
	return (
		<span
			className={`tag tag-${tone} ${className}`}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				fontSize: 10,
				letterSpacing: "0.10em",
				textTransform: "uppercase",
				padding: "3px 7px",
				background: t.bg,
				color: t.color,
				border: `1px solid ${t.border}`,
			}}
		>
			{children}
		</span>
	);
}
