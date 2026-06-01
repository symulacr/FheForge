"use client";

import React from "react";

export interface MobileNavProps {
	currentRoute: string;
	onNavigate: (route: string) => void;
	className?: string;
}

const ROUTES = [
	{ key: "portfolio", label: "Folio" },
	{ key: "lend", label: "Lend" },
	{ key: "strategies", label: "Build" },
	{ key: "governance", label: "Gov" },
] as const;

export function MobileNav({
	currentRoute,
	onNavigate,
	className = "",
}: MobileNavProps): JSX.Element {
	return (
		<nav
			className={`mobile-nav ${className}`}
			style={{
				position: "fixed",
				bottom: 0,
				left: 0,
				right: 0,
				zIndex: 40,
				background: "var(--background)",
				borderTop: "1px solid var(--border)",
				display: "flex",
				justifyContent: "space-around",
				alignItems: "center",
				height: 56,
			}}
		>
			{ROUTES.map((route) => {
				const active = currentRoute === route.key;
				return (
					<button
						key={route.key}
						onClick={() => onNavigate(route.key)}
						className={`mobile-nav-item ${active ? "active" : ""}`}
						style={{
							flex: 1,
							height: "100%",
							background: "transparent",
							border: 0,
							color: active ? "var(--foreground)" : "var(--muted)",
							borderTop: active ? "1.5px solid var(--foreground)" : "1.5px solid transparent",
							fontSize: 11,
							textTransform: "uppercase",
							letterSpacing: "0.08em",
							cursor: "pointer",
							transition: "color var(--t-feedback) var(--ease-custom)",
						}}
					>
						{route.label}
					</button>
				);
			})}
		</nav>
	);
}
