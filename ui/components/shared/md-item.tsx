"use client";

import React from "react";

export interface MDItemProps {
	idx?: React.ReactNode;
	title: string;
	sub?: string;
	right?: React.ReactNode;
	selected?: boolean;
	onClick?: () => void;
	className?: string;
}

export function MDItem({
	idx,
	title,
	sub,
	right,
	selected = false,
	onClick,
	className = "",
}: MDItemProps): JSX.Element {
	return (
		<button
			onClick={onClick}
			className={`md-item ${selected ? "selected" : ""} ${className}`}
			aria-pressed={selected}
		>
			{idx !== undefined && <span className="idx">{idx}</span>}
			<div style={{ minWidth: 0, overflow: "hidden" }}>
				<div
					style={{
						fontSize: 14,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{title}
				</div>
				{sub && (
					<div
						style={{
							fontSize: 12,
							color: "var(--muted)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{sub}
					</div>
				)}
			</div>
			{right && <div style={{ flex: "0 0 auto" }}>{right}</div>}
		</button>
	);
}
