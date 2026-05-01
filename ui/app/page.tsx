"use client";

import { useMemo, useRef } from "react";
import Link from "next/link";
import { StrategyList } from "./strategy/[id]/components/strategy-list";
import { FeaturedStrategies } from "./strategy/[id]/components/strategy-featured";
import { Preloader } from "@/components/preloader";
import { usePreloader } from "@/providers/preloader-provider";
import { useQuery } from "@tanstack/react-query";
import { getStrategies } from "@/services/defi-module-service";
import { SEED_STRATEGIES } from "@/app/constants/seed-strategies";
import { FheDemoWidget } from "@/components/shared/fhe-demo-widget";
import type { Strategy } from "@/types/strategy.interface";

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
    if (isFetching) show(); else hide();
  }

  const displayStrategies = useMemo(
    () => (strategies.length > 0 ? strategies : SEED_STRATEGIES),
    [strategies],
  );

  return (
    <>
      <Preloader />
      <div className="flex h-auto min-h-[calc(100vh-110px)] mt-15 overflow-x-hidden">
        <section className="flex-1 relative mx-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="sr-only">FheForge — confidential DeFi strategies</h1>

          <div className="relative mb-16 pt-8 pb-12 border-b border-border">
            <div className="max-w-4xl">
              <div className="text-[10px] uppercase tracking-[0.2em] text-accent mb-4">
                Fully Homomorphic Encryption for DeFi
              </div>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-medium text-foreground tracking-tight mb-6 leading-tight">
                Build confidential
                <br />
                <span className="text-accent">leveraged strategies</span>
              </h2>
              <p className="text-base sm:text-lg text-muted max-w-xl leading-relaxed mb-8">
                FheForge is an FHE-powered strategy builder. Compose supply, borrow,
                and swap intents with encrypted inputs — your position data stays
                private on-chain.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  href="/builder"
                  className="terminal-btn primary text-sm px-6 py-3"
                >
                  Open Builder
                </Link>
                <span className="text-xs text-muted">
                  No registration required. Connect wallet to start.
                </span>
              </div>
            </div>

            <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-80">
              <div className="forge-card p-4 mb-3 opacity-60">
                <div className="text-[10px] text-muted mb-2">encrypt(uint128)</div>
                <div className="text-xs text-accent font-mono break-all">
                  0x7f3a...b2e9
                </div>
              </div>
              <div className="forge-card p-4 opacity-40 translate-x-4">
                <div className="text-[10px] text-muted mb-2">decrypt(ctHash)</div>
                <div className="text-xs text-success font-mono">
                  1420.00
                </div>
              </div>
            </div>
          </div>

          <div className="mb-16 max-w-2xl">
            <FheDemoWidget />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-6 min-h-[600px]">
            <div className="w-full pr-2">
<FeaturedStrategies strategies={displayStrategies} />
            </div>
            <div className="w-full mt-15 pr-2">
              <StrategyList strategies={displayStrategies} />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
