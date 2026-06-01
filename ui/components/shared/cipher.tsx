"use client";

import React from "react";

export interface CipherProps {
	value: string | number;
	locked?: boolean;
	size?: "sm" | "md" | "lg" | "xl" | "xxl";
	inline?: boolean;
	dim?: boolean;
	unit?: string;
	className?: string;
}

const SIZE_MAP = {
	sm: { fontSize: "13px", gap: "6px" },
	md: { fontSize: "15px", gap: "8px" },
	lg: { fontSize: "22px", gap: "10px" },
	xl: { fontSize: "36px", gap: "12px" },
	xxl: { fontSize: "56px", gap: "14px" },
} as const;

export function Cipher({
	value,
	locked = true,
	size = "md",
	inline = false,
	dim = false,
	unit,
	className = "",
}: CipherProps): JSX.Element {
	const s = SIZE_MAP[size];
	const isLarge = size === "xl" || size === "xxl";

	const style: React.CSSProperties = {
		fontSize: isLarge ? `min(${s.fontSize}, ${size === "xxl" ? "14cqi" : "11cqi"})` : s.fontSize,
		gap: s.gap,
		opacity: dim ? 0.55 : 1,
	};

	const Tag = inline ? "span" : "span";

	return (
		<Tag
			className={`cipher ${locked ? "locked" : "unlocked"}${isLarge ? " cipher-fit" : ""} ${className}`}
			style={style}
			title={
				locked
					? "Encrypted on-chain. Grant a permit so your wallet can decrypt this value."
					: "Decrypted locally with your permit. Re-encrypts when the permit expires."
				}
		>
			<span className="plain">
				{value}
				{unit ? (
					<span style={{ marginLeft: 4, color: "var(--muted)" }}>{unit}</span>
				) : null}
			</span>
			{!inline && <span className="lock-mark">{locked ? "encrypted" : ""}</span>}
		</Tag>
	);
}
