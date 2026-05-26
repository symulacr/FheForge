"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useBalance } from "wagmi";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { useFheWallet } from "@/hooks/use-fhe-wallet";
import { WalletButton } from "@/components/shared/wallet-button";
import { displayToast } from "@/components/shared/toast-manager";
import { simulateStrategy } from "@/services/defi-module-service";
import type { StrategySimulate } from "@/types/strategy.type";
import type { DefiStrategy } from "@/types/defi.strategy";

const ExecutionModal = dynamic(
  () =>
    import("@/components/shared/execution-modal").then((m) => m.ExecutionModal),
  { ssr: false },
);

const MIN_AMOUNT = 0.01;

interface StrategyInputProps {
  strategy: DefiStrategy;
  onSimulateSuccess?: (data: StrategySimulate) => void;
}

export function StrategyInput({
  strategy,
  onSimulateSuccess,
}: StrategyInputProps) {
  const [amount, setAmount] = useState("");
  const [executionModalOpen, setExecutionModalOpen] = useState(false);
  const [loadingSimulate, setLoadingSimulate] = useState(false);
  const [simulateResult, setSimulateResult] = useState<StrategySimulate | null>(
    null,
  );

  const { isConnected, address } = useFheWallet();

  const { data: balanceData, isLoading: loadingBalance } = useBalance({
    address,
  });
  const balance = balanceData
    ? `${parseFloat(balanceData.formatted).toFixed(4)} ${balanceData.symbol}`
    : null;
  const balanceValue = balanceData ? parseFloat(balanceData.formatted) : null;

  const params = useParams<{ id: string | string[] }>();
  const strategyId = useMemo(() => {
    const raw = Array.isArray(params?.id)
      ? (params.id[0] ?? "")
      : params?.id || "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params]);

  const assetSymbol = strategy.assets?.[0] ?? "WETH";
  const asset = {
    symbol: assetSymbol,
    icon: `/icons/assets/${assetSymbol.toLowerCase()}.svg`,
  };

  const simulate = async () => {
    if (!amount || Number(amount) < MIN_AMOUNT) return;
    if (!isConnected) return;

    setLoadingSimulate(true);
    setSimulateResult(null);

    try {
      const data = await simulateStrategy(strategy.id, Number(amount));
      setSimulateResult(data);
      onSimulateSuccess?.(data);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Simulation failed";
      displayToast("error", msg);
    } finally {
      setLoadingSimulate(false);
    }
  };

  const onAmountBlur = () => {
    if (isConnected && amount && Number(amount) >= MIN_AMOUNT) simulate();
  };

  const execute = () => {
    if (!isConnected) return displayToast("error", "Please connect wallet.");
    if (!simulateResult)
      return displayToast("warning", "Simulate strategy first.");

    const inputAmount = Number(amount);

    if (balanceValue !== null && balanceValue < inputAmount) {
      return displayToast(
        "error",
        `Insufficient balance. Required ${inputAmount}, but you only have ${balanceValue}.`,
      );
    }

    setExecutionModalOpen(true);
  };

  return (
    <>
      <div className="p-8 border border-border bg-card shadow-lg">
        <h3 className="text-2xl font-extrabold text-primary mb-2">
          Strategy Input
        </h3>
        <p className="text-sm text-muted-foreground mb-6">
          Enter the amount you want to simulate
        </p>

        <div className="space-y-4 mb-5">
          <div className="flex items-center justify-end">
            <p className="text-sm text-muted-foreground">
              Est. Slippage:{" "}
              <span className="font-semibold text-foreground">1%</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <InputGroup className="flex-1 h-10 bg-input hover:bg-input/80 border-border focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-300">
              <InputGroupInput
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={onAmountBlur}
                aria-label="Strategy amount"
                className="text-base font-bold text-primary placeholder:text-muted-foreground border-0 focus-visible:ring-0 text-right px-3 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
              />
            </InputGroup>

            <div className="flex items-center gap-2 px-3 py-1.5 h-10 border-2 border-accent/30 bg-accent/10 hover:border-accent/50 hover:bg-accent/15 transition-all duration-300">
              <div className="relative w-4 h-4">
                <Image
                  src={asset.icon || "/placeholder.svg"}
                  alt={asset.symbol}
                  width={16}
                  height={16}
                  className="object-cover"
                />
              </div>
              <span className="font-bold text-accent text-sm tracking-wide">
                {asset.symbol}
              </span>
            </div>
          </div>

          {isConnected && (
            <div className="w-full flex justify-end">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                <span>Balance:</span>
                {loadingBalance ? (
                  <div className="relative h-4 w-20 rounded-md overflow-hidden bg-accent/20">
                    <div className="absolute inset-0 bg-accent/10" />
                  </div>
                ) : (
                  <span className="font-semibold text-primary">
                    {balance ?? "--"}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-start gap-3 p-3 bg-accent/10 border border-accent/30 mb-5">
          <Info className="w-3 h-3 text-accent" aria-hidden />
          <p className="text-xs text-card-foreground leading-relaxed">
            Market conditions and price impact may affect the final execution.
          </p>
        </div>

        {simulateResult && (
          <div className="mb-5 border border-border p-3 space-y-1">
            <p className="text-[10px] text-muted uppercase tracking-widest mb-2">
              execution path
            </p>
            {[
              "encrypt amounts",
              "sign permit",
              "submit tx",
              "confirm on-chain",
            ].map((step, i) => (
              <div
                key={step}
                className="flex items-center gap-2 text-xs text-muted"
              >
                <span className="text-accent">{i + 1}.</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {isConnected ? (
            <>
              {loadingSimulate && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 text-xs text-muted py-1"
                >
                  <span className="w-3 h-3 border border-accent/40 border-t-accent animate-spin" />
                  simulating...
                </div>
              )}
              <Button
                className="w-full h-10 border border-accent text-accent hover:bg-accent hover:text-black transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                disabled={
                  !amount ||
                  Number(amount) <= 0 ||
                  loadingSimulate ||
                  !simulateResult
                }
                onClick={execute}
              >
                Execute Strategy
              </Button>
            </>
          ) : (
            <WalletButton className="w-full h-10 border border-accent text-accent hover:bg-accent hover:text-black transition-colors" />
          )}
        </div>
      </div>

      {simulateResult && (
        <ExecutionModal
          key={simulateResult ? "open" : "closed"}
          open={executionModalOpen}
          onOpenChange={setExecutionModalOpen}
          strategy={simulateResult}
          strategyId={strategyId}
          startFromStep={0}
          onStatusChange={(status) => {
            if (status === "completed")
              displayToast("success", "Strategy executed successfully.");
            if (status === "cancelled")
              displayToast("info", "Strategy execution cancelled.");
          }}
        />
      )}
    </>
  );
}
