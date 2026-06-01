"use client";

import React from "react";

/**
 * BackgroundOrbits · slow, atmospheric SVG drift
 * Dark terminal aesthetic with blue-accent radial glow and dotted orbital rings.
 */
export function BackgroundOrbits(): JSX.Element {
	return (
		<svg
			aria-hidden="true"
			className="absolute inset-0 w-full h-full pointer-events-none"
			style={{ zIndex: 0, opacity: 0.45 }}
			preserveAspectRatio="xMidYMid slice"
			viewBox="0 0 1440 800"
		>
			<defs>
				<radialGradient id="bg-glow" cx="80%" cy="20%" r="60%">
					<stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
					<stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
				</radialGradient>
			</defs>
			<rect width={1440} height={800} fill="url(#bg-glow)" />

			{/* Slow drifting dotted orbits */}
			<g
				style={{
					transformOrigin: "1100px 220px",
					animation: "orbitDrift 60s linear infinite",
				}}
			>
				<circle
					cx={1100}
					cy={220}
					r={180}
					fill="none"
					stroke="var(--border)"
					strokeWidth={1}
					strokeDasharray="2 6"
				/>
				<circle
					cx={1100}
					cy={220}
					r={280}
					fill="none"
					stroke="var(--border)"
					strokeWidth={1}
					strokeDasharray="2 10"
				/>
				<circle
					cx={1100}
					cy={220}
					r={380}
					fill="none"
					stroke="var(--border)"
					strokeWidth={1}
					strokeDasharray="2 14"
				/>
			</g>

			<g
				style={{
					transformOrigin: "1100px 220px",
					animation: "orbitCounter 90s linear infinite",
				}}
			>
				<circle
					cx={1100}
					cy={220}
					r={220}
					fill="none"
					stroke="var(--accent)"
					strokeOpacity={0.25}
					strokeWidth={1}
					strokeDasharray="1 12"
				/>
			</g>
		</svg>
	);
}
