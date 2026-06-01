"use client";

import React from "react";
import { Cipher } from "@/components/shared/cipher";

export interface DemoCardProps {
	locked: boolean;
	onToggle: () => void;
}

const KV_ROWS: Array<{ label: string; value: string; unit: string }> = [
	{ label: "Supplied", value: "42,084.13", unit: "USDC" },
	{ label: "Borrowed", value: "18,910.00", unit: "ETH" },
	{ label: "In strategies", value: "7,418.94", unit: "USDC" },
];

/**
 * DemoCard · auto-playing permit cinematic
 * Portfolio demo card showing encrypted (Cipher) values with staggered reveal.
 */
export function DemoCard({ locked, onToggle }: DemoCardProps): JSX.Element {
	return (
		<div
			className="overflow-hidden"
			style={{
				background: "var(--card)",
				border: "1px solid var(--foreground)",
				boxShadow: "6px 6px 0 0 var(--foreground)",
			}}
		>
			{/* Card header */}
			<div
				className="flex items-center justify-between"
				style={{
					padding: "14px 22px",
					borderBottom: "1px solid var(--border)",
					background: "var(--secondary)",
				}}
			>
				<span className="eyebrow">live · your portfolio</span>
				<span
					className="mono text-[11px] tracking-wide"
					style={{
						color: locked ? "var(--accent)" : "var(--success)",
					}}
				>
					{locked ? "permit · locked" : "permit · live · 14:32"}
				</span>
			</div>

			{/* Card body */}
			<div style={{ padding: 28 }}>
				<span className="eyebrow">net value · usd</span>
				<div style={{ marginTop: 6 }}>
					<Cipher value="68,412.07" unit="USD" locked={locked} size="xxl" />
				</div>
				<div
					className="flex items-center gap-[18px] mt-[14px]"
					style={{ color: "var(--muted)" }}
				>
					<span className="mono text-xs">+ 2.41% / 24h</span>
					<span>·</span>
					<span className="mono text-xs">3 strategies</span>
				</div>

				<hr
					className="dashed"
					style={{ margin: "22px 0", borderTop: "1px dashed var(--border-light)" }}
				/>

				<div className="flex flex-col gap-3">
					{KV_ROWS.map(({ label, value, unit }, i) => (
						<div
							key={label}
							className="flex items-center justify-between"
							style={{ "--cipher-delay": `${i * 80}ms` } as React.CSSProperties}
						>
							<span
								className="mono uppercase"
								style={{
									fontSize: 12,
									color: "var(--muted)",
									letterSpacing: "0.04em",
								}}
							>
								{label}
							</span>
							<Cipher value={value} unit={unit} locked={locked} size="md" inline />
						</div>
					))}
				</div>
			</div>

			{/* Card footer */}
			<div
				style={{
					padding: "14px 22px",
					borderTop: "1px solid var(--border)",
					background: "var(--secondary)",
				}}
			>
				<button
					className="terminal-btn primary w-full justify-center"
					onClick={onToggle}
				>
					{locked ? (
						<>
							Grant a permit <span className="ar">→</span>
						</>
					) : (
						<>
							Permit live · auto-renew off <span className="ar">↻</span>
						</>
					)}
				</button>
			</div>
		</div>
	);
}
