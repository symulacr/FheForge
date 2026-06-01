"use client";

import { CheckCircle2, CircleOff } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { assetIcons, agentIcons, chainIcons } from "@/lib/iconMap";
import { Card } from "@/components/ui/card";

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
	const isActive = "Active";
	const router = useRouter();
	const handleClick = () => {
		router.push(`/strategy/${strategy.id}`);
	};
	return (
		<Card className="group p-4 cursor-default">
			<div className="hidden" />

			<div className="relative z-10 flex flex-col md:flex-row gap-3">
				<div className="grid grid-cols-4 gap-3">
					<div className="flex-1 min-w-0 col-span-3">
						<div className="flex items-start justify-between mb-3">
							<div className="flex gap-1.5 flex-wrap">
								{strategy.tags?.map((tag) => (
									<Badge
										key={tag}
										variant="secondary"
										className="text-accent text-xs border border-accent px-2 py-0.5"
									>
										{tag}
									</Badge>
								))}
							</div>

							<div
								className={`flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 ml-1.5 flex-shrink-0
                ${
									isActive
										? "text-success border border-success/30"
										: "bg-destructive/10 text-destructive border border-destructive/30"
								}
              `}
							>
								{isActive ? (
									<CheckCircle2 className="w-2.5 h-2.5" />
								) : (
									<CircleOff className="w-2.5 h-2.5" />
								)}
								{isActive ? "Active" : "Inactive"}
							</div>
						</div>

						<div className="mb-3">
							<h3 className="text-lg font-black text-foreground group-hover:text-accent transition-colors leading-tight mb-2 tracking-tight">
								{strategy.title}
							</h3>
							<div className="flex items-center gap-2">
								<p className="text-sm font-bold text-foreground">{strategy.strategistName}</p>
							</div>
							<p className="text-xs text-muted-foreground/80 font-medium">
								{strategy.strategistHandle}
							</p>
						</div>

						<div className="flex items-center gap-5 pt-3 border-t border-accent/15">
							<div className="flex items-center gap-2 group/item">
								<p className="text-xs font-bold text-foreground/70 uppercase tracking-wide">
									Asset
								</p>
								<div className="flex gap-1.5">
									{strategy.assets?.slice(0, 2).map((asset, idx) => (
										<div
											key={`${asset}-${idx}`}
											className="relative w-7 h-7 border border-accent/30 overflow-hidden hover:border-accent/60 transition-all duration-200 bg-card cursor-help"
											title={asset}
										>
											<Image src={assetIcons[asset] ?? assetIcons[asset?.toUpperCase()] ?? assetIcons[asset?.toLowerCase()] ?? "/icons/default-token.svg"} alt={asset} fill className="object-cover p-0.5" />
										</div>
									))}
									{strategy.assets && strategy.assets.length > 2 && (
										<div className="w-7 h-7 bg-accent/15 text-accent border border-accent/30 flex items-center justify-center text-[10px] font-bold transition-transform duration-200 cursor-help">
											+{strategy.assets.length - 2}
										</div>
									)}
								</div>
							</div>

							<div className="flex items-center gap-2 group/item">
								<p className="text-xs font-bold text-foreground/70 uppercase tracking-wide">
									Agent
								</p>
								<div className="flex gap-1.5">
									{strategy.agents?.slice(0, 2).map((agent, idx) => (
										<div
											key={`${agent}-${idx}`}
											className="relative w-7 h-7 border border-border overflow-hidden hover:border-border transition-all duration-200 bg-card cursor-help"
											title={agent}
										>
											<Image src={agentIcons[agent] ?? agentIcons[agent?.toUpperCase()] ?? agentIcons[agent?.toLowerCase()] ?? "/icons/default-agent.svg"} alt={agent} fill className="object-cover p-0.5" />
										</div>
									))}
								</div>
							</div>

							<div className="flex items-center gap-2 group/item">
								<p className="text-xs font-bold text-foreground/70 uppercase tracking-wide">
									Chain
								</p>
								<div className="flex gap-1.5">
									{strategy.chains?.slice(0, 2).map((chain, idx) => (
										<div
											key={`${chain}-${idx}`}
											className="relative w-7 h-7 border border-border overflow-hidden hover:border-border transition-all duration-200 bg-card cursor-help"
											title={chain}
										>
											<Image src={chainIcons[chain] ?? chainIcons[chain?.toUpperCase()] ?? chainIcons[chain?.toLowerCase()] ?? "/icons/default-chain.svg"} alt={chain} fill className="object-cover p-0.5" />
										</div>
									))}
								</div>
							</div>
						</div>
					</div>

					<div className="flex md:flex-col items-center md:items-end justify-between md:justify-start text-right flex-shrink-0 md:min-w-[120px] md:border-l border-accent/10 md:pl-4 gap-3">
						<div className="flex-1">
							<p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide font-semibold">
								APY
							</p>
							<p
								className="text-3xl font-black text-accent whitespace-nowrap leading-none"
								style={{ fontFamily: "var(--font-display, inherit)" }}
							>
								{strategy.apy?.toFixed(2) ?? "-"}%
							</p>
						</div>
						<button
							onClick={handleClick}
							className="px-4 py-2 bg-primary hover:bg-accent text-primary-foreground text-sm font-semibold transition-all duration-300 group/btn flex items-center gap-2 whitespace-nowrap cursor-pointer"
						>
							Try Now
							<span className="inline-block group-hover/btn:translate-x-1 transition-transform">
								→
							</span>
						</button>
					</div>
				</div>
			</div>
		</Card>
	);
}
