"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { simulateStrategy } from "@/services/defi-module-service";
import { displayToast } from "./toast-manager";
import { Rocket, Info } from "lucide-react";
import { StrategySimulate } from "@/types/strategy.type";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  strategyId: string;
  onSimulated: (data: StrategySimulate) => void;
}

export default function RunStrategyModal({
  open,
  onOpenChange,
  strategyId,
  onSimulated,
}: Props) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRun = async () => {
    const value = Number(amount);
    if (!amount || value <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const res = await simulateStrategy(strategyId, value);
      onSimulated(res);
      displayToast("success", "Strategy simulated successfully!");
      onOpenChange(false);
      setAmount("");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to simulate strategy";
      displayToast("error", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value !== "" && !/^\d*\.?\d*$/.test(value)) return;

    setAmount(value);
    if (!value) {
      setError("Amount is required");
      return;
    }
    if (Number(value) <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    setError("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-card border-border p-0 overflow-hidden">
        <div className="p-8">
          <DialogHeader className="flex flex-col items-center text-center space-y-3 mb-6">
            <div className="w-14 h-14 bg-card border border-border flex items-center justify-center">
              <Rocket className="w-7 h-7 text-accent" />
            </div>
            <DialogTitle className="text-2xl font-bold text-foreground">
              Initialize Strategy
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Enter the amount to simulate execution
            </p>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <div className="relative flex items-center group">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={handleChange}
                  className="w-full bg-input border border-border focus:border-accent
                             p-4 pl-14 pr-24 text-foreground font-bold text-xl placeholder:text-muted outline-none transition-colors"
                />
                <div className="absolute right-4 z-20 pointer-events-none">
                  <span className="text-[10px] font-bold text-muted uppercase tracking-widest bg-card px-2 py-1 border border-border">
                    Amount
                  </span>
                </div>
              </div>

              {error ? (
                <p className="text-destructive text-[11px] font-bold flex items-center gap-1.5 ml-2">
                  <span className="w-1 h-1 bg-destructive" />
                  {error}
                </p>
              ) : (
                <p className="text-muted text-[11px] flex items-center gap-1.5 ml-2">
                  <Info size={12} />
                  Simulated results based on current market data.
                </p>
              )}
            </div>

            <Button
              disabled={!amount || Number(amount) <= 0 || loading}
              onClick={handleRun}
              className="w-full h-14 bg-accent hover:bg-accent/90 text-white font-bold transition-colors"
            >
              {loading ? (
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white animate-spin" />
                  <span className="uppercase tracking-widest text-xs">
                    Processing...
                  </span>
                </div>
              ) : (
                <span className="tracking-widest uppercase">
                  Run Simulation
                </span>
              )}
            </Button>
          </div>
        </div>
        <div className="h-px w-full bg-accent/30" />
      </DialogContent>
    </Dialog>
  );
}
