"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useRef } from "react";
import { SEED_STRATEGIES } from "@/app/constants/seed-strategies";
import { Preloader } from "@/components/preloader";
import { FheDemoWidget } from "@/components/shared/fhe-demo-widget";
import { usePreloader } from "@/providers/preloader-provider";
import { getStrategies } from "@/services/defi-module-service";
import type { Strategy } from "@/types/strategy.interface";
import { FeaturedStrategies } from "./strategy/[id]/components/strategy-featured";
import { StrategyList } from "./strategy/[id]/components/strategy-list";

export default function Home() {
	const { show, hide } = usePreloader();

	const { data: strategies = [], isFetching } = useQuery<Strategy[]>({
		queryKey: ["home-strategies"],
		queryFn: async () => {
			const data = await getStrategies();
			return data.length > 0 ? data : SEED_STRATEGIES;
		},
	});

	const prevFetching = useRef(isFetching);
	if (isFetching !== prevFetching.current) {
		prevFetching.current = isFetching;
		if (isFetching) show();
		else hide();
	}

	const displayStrategies = useMemo(
		() => (strategies.length > 0 ? strategies : SEED_STRATEGIES),
		[strategies]
	);

	return (
		<>
			<Preloader />
			<div className="flex min-h-[calc(100vh-96px)] overflow-x-hidden">
				<section className="flex-1 relative mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-8">
					<h1 className="sr-only">FheForge — confidential DeFi strategies</h1>

					{/* Hero Section */}
					<header className="relative mb-12 pt-6 pb-10 border-b border-border">
						<div className="max-w-3xl">
							<h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-foreground tracking-tight mb-4 leading-tight text-balance">
								Build confidential
								<br />
								<span className="text-accent">leveraged strategies</span>
							</h2>
							<p className="text-sm sm:text-base text-muted max-w-xl leading-relaxed mb-6">
								FheForge is an FHE-powered strategy builder. Compose supply, borrow, and swap
								intents with encrypted inputs — your position data stays private on-chain.
							</p>
							<div className="flex flex-wrap items-center gap-4">
								<Link href="/builder" className="terminal-btn primary px-5 py-2.5">
									Open Builder
								</Link>
								<span className="text-xs text-muted">
									No registration required. Connect wallet to start.
								</span>
							</div>
						</div>

						{/* Floating Cards */}
						<div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-72">
							<div className="forge-card p-4 mb-3 opacity-70">
								<div className="text-[10px] text-muted uppercase tracking-wider mb-1.5">
									encrypt(uint128)
								</div>
								<code className="text-xs text-accent break-all">0x7f3a...b2e9</code>
							</div>
							<div className="forge-card p-4 opacity-50 translate-x-4">
								<div className="text-[10px] text-muted uppercase tracking-wider mb-1.5">
									decrypt(ctHash)
								</div>
								<code className="text-xs text-success tabular-nums">1,420.00</code>
							</div>
						</div>
					</header>

					{/* FHE Demo */}
					<div className="mb-12 max-w-xl">
						<FheDemoWidget />
					</div>

					{/* Strategy Grid */}
					<div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
						<div className="w-full">
							<FeaturedStrategies strategies={displayStrategies} />
						</div>
						<div className="w-full">
							<StrategyList strategies={displayStrategies} />
						</div>
					</div>
				</section>
			</div>
		</>
	);
}
