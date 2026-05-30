"use client";

import { ArrowLeftRight, Droplets, Target, TrendingUp } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { assetIcons, agentIcons, chainIcons } from "@/lib/iconMap";
import type { Strategy } from "@/types/strategy.interface";

interface Props {
	strategies: Strategy[];
}

const PATH_CARDS = [
	{
		icon: TrendingUp,
		title: "Yield Boost",
		description: "Maximize APY with AI-optimized compounding",
		tooltip: "AI automatically compounds your rewards to maximize returns over time",
		available: true,
	},
	{
		icon: Droplets,
		title: "Liquidity Farming",
		description: "Provide liquidity across multiple chains",
		tooltip: "Earn fees by providing liquidity to decentralized exchanges",
		available: false,
	},
	{
		icon: Target,
		title: "Point Campaigns",
		description: "Farm ecosystem points automatically",
		tooltip: "Participate in protocol incentive programs to earn points and rewards",
		available: false,
	},
	{
		icon: ArrowLeftRight,
		title: "Cross-Chain Arbitrage",
		description: "Capture opportunities across ecosystems",
		tooltip: "Automatically find and execute profitable trades across different blockchains",
		available: false,
	},
] as const;

export function FeaturedStrategies({ strategies }: Props) {
	const trendingStrategy = useMemo(
		() => [...strategies].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))[0] ?? null,
		[strategies]
	);

	return (
		<div className="space-y-8">
			{/* Section Header */}
			<div className="space-y-2">
				<h2 className="text-2xl font-semibold text-foreground tracking-tight">
					FheForge
				</h2>
				<p className="text-sm text-muted">
					Maximize your DeFi growth with smart, automated strategies.
				</p>
			</div>

			{/* Strategy Paths */}
			<TooltipProvider delayDuration={200}>
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
					{PATH_CARDS.map((card) => (
						<Tooltip key={card.title}>
							<TooltipTrigger asChild>
								<div
									className={`forge-card p-4 ${
										card.available
											? "cursor-pointer"
											: "opacity-60 cursor-not-allowed"
									}`}
								>
									<div className="flex items-start justify-between mb-3">
										<div className="w-9 h-9 bg-accent/10 flex items-center justify-center">
											<card.icon className="w-4 h-4 text-accent" />
										</div>
										{!card.available && (
											<span className="text-[9px] uppercase tracking-wider text-muted">
												Soon
											</span>
										)}
									</div>
									<h3 className="text-sm font-medium text-foreground mb-1">
										{card.title}
									</h3>
									<p className="text-xs text-muted leading-relaxed">
										{card.description}
									</p>
								</div>
							</TooltipTrigger>
							<TooltipContent side="bottom" className="max-w-xs">
								<p className="text-xs">{card.tooltip}</p>
							</TooltipContent>
						</Tooltip>
					))}
				</div>
			</TooltipProvider>

			{/* Trending Strategy */}
			<div className="space-y-3">
				<div className="flex items-center gap-2">
					<h3 className="text-lg font-medium text-foreground">Trending Now</h3>
					<span className="badge-accent text-[9px] uppercase tracking-wider px-1.5 py-0.5">
						Hot
					</span>
				</div>

				{!trendingStrategy ? (
					<div className="forge-card p-8 text-center">
						<p className="text-muted text-sm mb-2">No strategies yet</p>
						<Link href="/builder" className="text-xs text-accent hover:underline">
							Build one
						</Link>
					</div>
				) : (
					<Link href={`/strategy/${trendingStrategy.id}`} className="block">
						<Card className="forge-card p-4 hover:border-accent/50 transition-colors">
							<div className="flex flex-col md:flex-row md:items-center gap-4">
								{/* Strategy Info */}
								<div className="flex-1 min-w-0 space-y-3">
									{/* Tags */}
									{trendingStrategy.tags && trendingStrategy.tags.length > 0 && (
										<div className="flex gap-1.5 flex-wrap">
											{trendingStrategy.tags.slice(0, 3).map((tag, idx) => (
												<span
													key={idx}
													className="badge-accent text-[10px] px-1.5 py-0.5"
												>
													{tag}
												</span>
											))}
										</div>
									)}

									{/* Title & Author */}
									<div>
										<h4 className="text-base font-semibold text-foreground mb-0.5">
											{trendingStrategy.title}
										</h4>
										<p className="text-xs text-muted">
											{trendingStrategy.strategistHandle || trendingStrategy.strategistName}
										</p>
									</div>

									{/* Assets Row */}
									<div className="flex flex-wrap gap-4 pt-3 border-t border-border">
										{/* Assets */}
										{trendingStrategy.assets && trendingStrategy.assets.length > 0 && (
											<div className="flex items-center gap-2">
												<span className="text-[10px] uppercase tracking-wider text-muted">
													Assets
												</span>
												<div className="flex gap-1">
													{trendingStrategy.assets.slice(0, 3).map((asset, idx) => (
														<div
															key={idx}
															className="relative w-5 h-5 border border-border bg-background overflow-hidden"
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
													{trendingStrategy.assets.length > 3 && (
														<span className="w-5 h-5 flex items-center justify-center text-[9px] text-accent bg-accent/10 border border-accent/20">
															+{trendingStrategy.assets.length - 3}
														</span>
													)}
												</div>
											</div>
										)}

										{/* Chains */}
										{trendingStrategy.chains && trendingStrategy.chains.length > 0 && (
											<div className="flex items-center gap-2">
												<span className="text-[10px] uppercase tracking-wider text-muted">
													Chains
												</span>
												<div className="flex gap-1">
													{trendingStrategy.chains.slice(0, 2).map((chain, idx) => (
														<div
															key={idx}
															className="relative w-5 h-5 border border-border bg-background overflow-hidden"
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

								{/* APY Display */}
								<div className="flex items-center gap-3 md:border-l border-border md:pl-4">
									<div className="text-center px-4 py-3 bg-accent/5 border border-accent/20">
										<div className="text-[10px] uppercase tracking-wider text-muted mb-1">
											APY
										</div>
										<div className="text-2xl font-bold text-accent tabular-nums">
											{trendingStrategy.apy?.toFixed(1)}%
										</div>
									</div>
								</div>
							</div>
						</Card>
					</Link>
				)}
			</div>
		</div>
	);
}
