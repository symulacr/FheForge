import { Badge } from "@/components/ui/badge";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { StrategySimulate } from "@/types/strategy.type";

interface StrategyHeaderProps {
  strategy: {
    title?: string;
    status?: "Active" | "Inactive" | string;
    apy?: number | null;
    strategist?: string;
    strategistName?: string;
    strategistHandle?: string;
    handle?: string;
    date?: string;
  };
  simulateData?: StrategySimulate | null;
}

export function StrategyHeader({ strategy }: StrategyHeaderProps) {
  return (
    <div className="glass p-6 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-foreground">
              {strategy.title ?? "Unnamed Strategy"}
            </h1>
            <Badge
              variant={strategy.status === "Active" ? "default" : "secondary"}
              className="bg-success/20 text-success"
            >
              {strategy.status ?? "Unknown"}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Strategy by</span>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 bg-primary/20 flex items-center justify-center">
                  <Image
                    src="/logo-fheforge.svg"
                    alt="fheforge logo"
                    width={20}
                    height={20}
                  />
                </div>
                <span>{strategy.strategistHandle ?? "FheForge"}</span>
              </div>
            </div>
            <span>{strategy.date ?? ""}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon">
          <Share2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground">APY</span>
          <span className="text-3xl font-bold text-success">
            {(strategy.apy ?? 0).toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            FheForge is not holding custody over users&apos; assets. Users&apos;
            funds are under their control.
          </span>
        </div>
      </div>
    </div>
  );
}
