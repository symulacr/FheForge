"use client";

import { CheckCircle2, CircleOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { assetIcons, agentIcons, chainIcons } from "@/lib/iconMap";

interface Strategy {
	id: string;
	title?: string;
	tags?: string[];
	apy?: number | null;
	strategist?: string;
	strategistName?: string;
	strategistHandle?: string;
	handle?: string;
	date?: string;
	assets?: string[];
	agents?: string[];
	chains?: string[];
	status?: "Active" | "Inactive" | string;
}

interface StrategyCardProps {
	strategy: Strategy;
}

export function StrategyCard({ strategy }: StrategyCardProps) {
	const isActive = strategy.status === "Active" || !strategy.status;

	return (
		<Link href={`/strategy/${strategy.id}`} className="block group">
			<article className="forge-card p-4 transition-colors">
				<div className="flex flex-col md:flex-row gap-4">
					{/* Main Content */}
					<div className="flex-1 min-w-0 space-y-3">
						{/* Header Row */}
						<div className="flex items-start justify-between gap-2">
							{/* Tags */}
							<div className="flex gap-1.5 flex-wrap">
								{strategy.tags?.slice(0, 3).map((tag) => (
									<span
										key={tag}
										className="badge-accent text-[10px] px-1.5 py-0.5"
									>
										{tag}
									</span>
								))}
							</div>

							{/* Status */}
							<div
								className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 shrink-0 ${
									isActive ? "badge-success" : "badge-destructive"
								}`}
							>
								{isActive ? (
									<CheckCircle2 className="w-2.5 h-2.5" />
								) : (
									<CircleOff className="w-2.5 h-2.5" />
								)}
								{isActive ? "Active" : "Inactive"}
							</div>
						</div>

						{/* Title & Author */}
						<div>
							<h3 className="text-base font-semibold text-foreground group-hover:text-accent transition-colors mb-0.5">
								{strategy.title}
							</h3>
							<p className="text-xs text-muted">
								{strategy.strategistHandle || strategy.strategistName}
							</p>
						</div>

						{/* Metadata Row */}
						<div className="flex flex-wrap items-center gap-4 pt-3 border-t border-border">
							{/* Assets */}
							{strategy.assets && strategy.assets.length > 0 && (
								<div className="flex items-center gap-2">
									<span className="text-[10px] uppercase tracking-wider text-muted">
										Assets
									</span>
									<div className="flex gap-1">
										{strategy.assets.slice(0, 2).map((asset, idx) => (
											<div
												key={`${asset}-${idx}`}
												className="relative w-5 h-5 border border-border bg-background overflow-hidden"
												title={asset}
											>
												<Image
													src={
														assetIcons[asset] ??
														assetIcons[asset?.toUpperCase()] ??
														assetIcons[asset?.toLowerCase()] ??
														"/icons/default-token.svg"
													}
													alt={asset}
													fill
													className="object-cover p-0.5"
												/>
											</div>
										))}
										{strategy.assets.length > 2 && (
											<span className="w-5 h-5 flex items-center justify-center text-[9px] text-accent bg-accent/10 border border-accent/20">
												+{strategy.assets.length - 2}
											</span>
										)}
									</div>
								</div>
							)}

							{/* Agents */}
							{strategy.agents && strategy.agents.length > 0 && (
								<div className="flex items-center gap-2">
									<span className="text-[10px] uppercase tracking-wider text-muted">
										Agents
									</span>
									<div className="flex gap-1">
										{strategy.agents.slice(0, 2).map((agent, idx) => (
											<div
												key={`${agent}-${idx}`}
												className="relative w-5 h-5 border border-border bg-background overflow-hidden"
												title={agent}
											>
												<Image
													src={
														agentIcons[agent] ??
														agentIcons[agent?.toUpperCase()] ??
														agentIcons[agent?.toLowerCase()] ??
														"/icons/default-agent.svg"
													}
													alt={agent}
													fill
													className="object-cover p-0.5"
												/>
											</div>
										))}
									</div>
								</div>
							)}

							{/* Chains */}
							{strategy.chains && strategy.chains.length > 0 && (
								<div className="flex items-center gap-2">
									<span className="text-[10px] uppercase tracking-wider text-muted">
										Chains
									</span>
									<div className="flex gap-1">
										{strategy.chains.slice(0, 2).map((chain, idx) => (
											<div
												key={`${chain}-${idx}`}
												className="relative w-5 h-5 border border-border bg-background overflow-hidden"
												title={chain}
											>
												<Image
													src={
														chainIcons[chain] ??
														chainIcons[chain?.toUpperCase()] ??
														chainIcons[chain?.toLowerCase()] ??
														"/icons/default-chain.svg"
													}
													alt={chain}
													fill
													className="object-cover p-0.5"
												/>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</div>

					{/* APY & Action */}
					<div className="flex items-center gap-3 md:flex-col md:items-end md:justify-between md:min-w-[100px] md:border-l border-border md:pl-4">
						<div className="text-right">
							<div className="text-[10px] uppercase tracking-wider text-muted mb-0.5">
								APY
							</div>
							<div className="text-2xl font-bold text-accent tabular-nums">
								{strategy.apy?.toFixed(1) ?? "--"}%
							</div>
						</div>
						<span className="terminal-btn primary text-xs px-3 py-1.5 group-hover:bg-accent group-hover:text-background transition-colors">
							View
						</span>
					</div>
				</div>
			</article>
		</Link>
	);
}
