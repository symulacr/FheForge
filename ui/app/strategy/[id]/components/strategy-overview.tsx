import Image from "next/image";
import { Bot } from "lucide-react";
import { StrategyHeader } from "./strategy-header";
import { DefiStrategy } from "@/types/defi.strategy";
import { StrategySimulate } from "@/types/strategy.type";

interface StrategyOverviewProps {
  strategy?: DefiStrategy;
  simulateData?: StrategySimulate | null;
}

export function StrategyOverview({
  strategy,
  simulateData,
}: StrategyOverviewProps) {
  const safeAgents =
    simulateData?.steps?.map((s) => s.agent).filter(Boolean) ||
    strategy?.agents ||
    [];

  const safeDescription =
    strategy?.description ||
    `Strategy simulation with ${simulateData?.loops || 0} loops, starting from ${simulateData?.initialCapital?.symbol || "WETH"}.`;

  const AGENT_ICONS: Record<string, string> = {
    FHENIX: "/icons/assets/weth.svg",
  };
  const uniqueAgents = Array.from(new Set(safeAgents)) as string[];

  return (
    <div className="space-y-6">
      {/* === STRATEGY HEADER === */}
      <StrategyHeader strategy={strategy ?? {}} simulateData={simulateData} />

      {/* === DESCRIPTION SECTION === */}
      <div className="glass p-6 space-y-5">
        <div className="flex items-center gap-3 ">
          <div className="h-1 w-1 bg-accent"></div>
          <h3 className="text-xl font-semibold text-foreground">
            Strategy Description
          </h3>
        </div>

        {simulateData ? (
          <p className="text-foreground/80 leading-relaxed text-[15px]">
            {safeDescription}
          </p>
        ) : (
          <div className="flex flex-col items-center justify-center px-4">
            <div className="w-10 h-10 mb-4 bg-accent/10 flex items-center justify-center">
              <Bot className="w-10 h-10 text-accent/50" />
            </div>
            <p className="text-muted-foreground text-center max-w-md text-sm">
              Please run a simulation first to see the strategy details and
              expected results.
            </p>
          </div>
        )}

        {/* Agents */}
        {safeAgents.length > 0 && (
          <div className="pt-4 border-t border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <Bot className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold text-foreground/90">
                Executed by Agents
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {uniqueAgents.map((agent, idx) => {
                const iconUrl = AGENT_ICONS[agent] || null;
                return (
                  <div
                    key={`${agent}-${idx}`}
                    className="
                      group px-4 py-2 
                      bg-card border border-border
                      hover:border-accent/50 hover:bg-accent/10
                      transition-colors duration-300
                      flex items-center justify-center
                    "
                  >
                    {iconUrl ? (
                      <Image
                        src={iconUrl}
                        alt={agent}
                        width={32}
                        height={32}
                        className="w-8 h-8 object-contain"
                      />
                    ) : (
                      <div className="w-8 h-8 bg-accent/10 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-accent" aria-hidden />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
