"use client";

import type { StrategyStep } from "@/services/ai-strategy-service";
import {
  ArrowRight,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertCircle,
} from "lucide-react";

interface StrategyStepsProps {
  steps: StrategyStep[];
  className?: string;
  showHeader?: boolean;
  compact?: boolean;
}

export function StrategySteps({
  steps,
  className = "",
  showHeader = true,
  compact = false,
}: StrategyStepsProps) {
  const getStepIcon = (type: string) => {
    switch (type) {
      case "SWAP":
        return <RefreshCw className="h-4 w-4 text-accent" />;
      case "SUPPLY":
        return <TrendingUp className="h-4 w-4 text-success" />;
      case "BORROW":
        return <TrendingDown className="h-4 w-4 text-destructive" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted" />;
    }
  };

  const getStepColor = (type: string) => {
    switch (type) {
      case "SWAP":
        return "border-accent/20 bg-accent/5";
      case "SUPPLY":
        return "border-success/20 bg-success/5";
      case "BORROW":
        return "border-destructive/20 bg-destructive/5";
      default:
        return "border-border bg-card";
    }
  };

  const formatStepType = (type: string) =>
    type
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());

  const formatAmount = (amount: number) => {
    if (amount < 0.001) return amount.toExponential(3);
    return amount.toFixed(6).replace(/\.?0+$/, "");
  };

  if (steps.length === 0) {
    return (
      <div className={`border border-border bg-card p-6 ${className}`}>
        <div className="text-center text-muted">
          No strategy steps available
        </div>
      </div>
    );
  }

  return (
    <div className={`border border-border bg-card ${className}`}>
      {showHeader && (
        <div className="border-b border-border p-6 pb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Strategy Steps
          </h2>
          <p className="text-sm text-muted">{steps.length} steps total</p>
        </div>
      )}

      <div className={compact ? "p-4 space-y-2" : "p-6 space-y-4"}>
        {steps.map((step, index) => (
          <div key={index} className="relative">
            <div
              className={`border transition-colors hover:border-accent/40 ${getStepColor(step.type)} ${compact ? "p-3" : "p-4"}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex items-center justify-center border border-border bg-secondary text-foreground ${compact ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm"}`}
                  >
                    {step.step}
                  </div>
                  {getStepIcon(step.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3
                      className={`font-medium text-foreground ${compact ? "text-sm" : "text-base"}`}
                    >
                      {formatStepType(step.type)}
                    </h3>
                    <span className="bg-secondary px-2 py-0.5 font-mono text-muted text-xs">
                      {step.agent}
                    </span>
                  </div>

                  {(step.tokenIn || step.tokenOut) && (
                    <div
                      className={`flex items-center gap-2 text-muted ${compact ? "text-xs" : "text-sm"}`}
                    >
                      {step.tokenIn && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-foreground">
                            {step.tokenIn.symbol}
                          </span>
                          <span className="text-muted">
                            {formatAmount(step.tokenIn.amount)}
                          </span>
                        </div>
                      )}
                      {step.tokenIn && step.tokenOut && (
                        <ArrowRight className="h-3 w-3 text-muted" />
                      )}
                      {step.tokenOut && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-foreground">
                            {step.tokenOut.symbol}
                          </span>
                          <span className="text-muted">
                            {formatAmount(step.tokenOut.amount)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {!compact &&
                    (step.tokenIn?.assetId || step.tokenOut?.assetId) && (
                      <div className="mt-1 text-xs text-muted">
                        {step.tokenIn?.assetId && (
                          <span>In: {step.tokenIn.assetId}</span>
                        )}
                        {step.tokenIn?.assetId && step.tokenOut?.assetId && (
                          <span className="mx-2">•</span>
                        )}
                        {step.tokenOut?.assetId && (
                          <span>Out: {step.tokenOut.assetId}</span>
                        )}
                      </div>
                    )}
                </div>
              </div>
            </div>

            {index < steps.length - 1 && (
              <div className="flex justify-center py-2">
                <div className="h-6 w-px bg-border" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default StrategySteps;
