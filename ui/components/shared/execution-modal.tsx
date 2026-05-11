"use client";

import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  StrategySimulate,
  Step as StrategyStep,
} from "@/types/strategy.type";
import type { ExecutionStatus, ExecutionStep } from "./types";
import { STEP_TYPE } from "@/utils/constant";
import { TOKEN_SYMBOL_MAP } from "@/utils/addresses";
import { useFheWallet } from "@/hooks/use-fhe-wallet";
import { useComposer, type OpenStrategyParams, type OpenStrategyEncrypted } from "@/hooks/use-composer";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useSwapRouter, type IntentMeta } from "@/hooks/use-swap-router";
import { EncryptProgress } from "@/components/shared/encrypt-progress";
import { useChainId } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { motion } from "framer-motion";
import { displayToast } from "./toast-manager";
import StepStack from "./execution-step-stack";
import { assetIcons } from "@/lib/iconMap";
import type { UpdateActivityPayload } from "@/types/activity.interface";
import {
  useCreateActivity,
  useUpdateActivity,
} from "@/hooks/use-activity-service";
import { TX_POLLING_INTERVAL, SWAP_DEADLINE_OFFSET, SLIPPAGE_TOLERANCE } from "@/lib/constants";
import { parseUnits } from "viem";

interface ExecutionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: StrategySimulate;
  strategyId: string;
  startFromStep?: number;
  activityId?: string | null;
  onStatusChange?: (status: "cancelled" | "completed") => void;
}

const formatAmt = (v?: number) =>
  typeof v === "number" ? Number(v.toFixed(6)) : "-";

const mapStatusToBackend = (
  status: "completed" | "failed" | "pending",
): "SUCCESS" | "FAILED" | "PENDING" => {
  return status === "completed"
    ? "SUCCESS"
    : status === "failed"
      ? "FAILED"
      : "PENDING";
};

const getStepTitle = (s: StrategyStep) => {
  switch (s.type) {
    case STEP_TYPE.SWAP:
      return `Swap ${s.tokenIn?.symbol ?? ""} → ${s.tokenOut?.symbol ?? ""}`;
    case STEP_TYPE.BORROW:
      return `Borrow ${s.tokenOut?.symbol ?? ""}`;
    default:
      return `Step ${s.step}`;
  }
};

const getStepDescription = (s: StrategyStep) => {
  switch (s.type) {
    case STEP_TYPE.SWAP:
      return `Swap ${formatAmt(s.tokenIn?.amount)} ${s.tokenIn?.symbol ?? ""} for ~${formatAmt(
        s.tokenOut?.amount,
      )} ${s.tokenOut?.symbol ?? ""}`;
    case STEP_TYPE.BORROW:
      return `Borrow ${formatAmt(s.tokenOut?.amount)} ${s.tokenOut?.symbol ?? ""}`;
    default:
      return "Execute step";
  }
};

const buildExecutionSteps = (strategy?: StrategySimulate): ExecutionStep[] => {
  if (!strategy?.steps || !Array.isArray(strategy.steps)) {
    return [];
  }

  return strategy.steps.map((s, i) => {
    const fromToken = s.tokenIn
      ? {
          icon: assetIcons[s.tokenIn.symbol],
          symbol: s.tokenIn.symbol,
        }
      : undefined;

    const toToken = s.tokenOut
      ? {
          icon: assetIcons[s.tokenOut.symbol],
          symbol: s.tokenOut.symbol,
        }
      : undefined;

    return {
      id: `${s.step ?? i + 1}`,
      title: getStepTitle(s),
      description: getStepDescription(s),
      status: "pending" as const,
      txHash: undefined,
      fromToken,
      fromAmount: s.tokenIn?.amount
        ? String(formatAmt(s.tokenIn.amount))
        : undefined,
      toToken,
      toAmount: s.tokenOut?.amount
        ? String(formatAmt(s.tokenOut.amount))
        : undefined,
    };
  });
};

export function ExecutionModal({
  open,
  onOpenChange,
  strategy,
  strategyId,
  startFromStep = 0,
  activityId: initialActivityId = null,
  onStatusChange,
}: ExecutionModalProps) {
  
  const initialSteps = useMemo(() => {
    const steps = buildExecutionSteps(strategy);
    return steps.map((step, idx) => ({
      ...step,
      status: idx < startFromStep ? ("completed" as ExecutionStatus) : ("pending" as ExecutionStatus),
    }));
  }, [strategy, startFromStep]);

  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>(initialSteps);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(startFromStep);
  const [activityId, setActivityId] = useState<string | null>(
    initialActivityId,
  );
  const [allStepsCompleted, setAllStepsCompleted] = useState(false);
  const [swapIntentId, setSwapIntentId] = useState<string | null>(null);
  const [intentMeta, setIntentMeta] = useState<IntentMeta | null>(null);
  const abortRef = useRef(false);

  const { address: walletAddress, isConnected: isWalletConnected } =
    useFheWallet();
  const { openPosition, encrypt128ForComposer, isPending: isComposerPending } =
    useComposer();
  const {
    hasPosition,
    primaryPositionId,
    userPositions,
    getPositionMeta,
    getDepositedAmount,
    getCollateral,
    isLoading: isPortfolioLoading,
    refetch: refetchPortfolio,
  } = usePortfolio();

  const { getIntentMeta, cancelIntent, isCancelling } = useSwapRouter();
  // P7: position meta — getPositionMeta returns { data } shape, handle undefined gracefully
  const { data: positionMetaData } = getPositionMeta(primaryPositionId ?? "");
  const positionMeta = (positionMetaData ?? undefined) as { strategyId: bigint; createdAt: bigint } | undefined;
  const activeChainId = useChainId();
  const createActivityMutation = useCreateActivity();
  const updateActivityMutation = useUpdateActivity();

  const subtitle = useMemo(() => {
    const resumeText =
      startFromStep > 0 ? ` • Resuming from step ${startFromStep + 1}` : "";
    const modeText = initialActivityId ? " (Re-execute)" : " (New)";
    return strategy?.initialCapital
      ? `Initial: ${formatAmt(strategy.initialCapital.amount)} ${strategy.initialCapital.symbol} • Loops: ${strategy.loops}${resumeText}${modeText}`
      : `Loops: ${strategy?.loops ?? "-"}${resumeText}${modeText}`;
  }, [strategy, startFromStep, initialActivityId]);

  const updateStepStatus = (
    stepIndex: number,
    status: ExecutionStatus,
    txHash?: string,
  ) => {
    setExecutionSteps((prev) =>
      prev.map((s, idx) =>
        idx === stepIndex ? { ...s, status, ...(txHash && { txHash }) } : s,
      ),
    );
  };

  const syncActivityProgress = async (
    activityId: string,
    stepIndex: number,
    status: "completed" | "failed" | "pending",
    txHash?: string | string[],
  ) => {
    try {
      const txHashArray = txHash
        ? Array.isArray(txHash)
          ? txHash
          : [txHash]
        : undefined;

      const payload: UpdateActivityPayload = {
        activityId,
        step: stepIndex,
        status: mapStatusToBackend(status),
        message: txHash
          ? `Step ${stepIndex} ${status} with txHash: ${txHash}`
          : `Step ${stepIndex} ${status}`,
        ...(txHashArray && { txHash: txHashArray }),
      };

      await updateActivityMutation.mutateAsync({ activityId, payload });
    } catch (err) {
      displayToast(
        "error",
        `Failed to sync activity progress: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const startExecution = async () => {
    if (!executionSteps.length || isExecuting) return;
    if (!isWalletConnected || !walletAddress) {
      displayToast("warning", "Please connect your wallet first.");
      return;
    }

    setIsExecuting(true);
    abortRef.current = false;

    try {
      let currentActivityId = activityId;

      if (!currentActivityId) {
        const activity = await createActivityMutation.mutateAsync({
          userAddress: walletAddress,
          strategyId,
          initialCapital: String(strategy.initialCapital?.amount || 0),
          totalSteps: executionSteps.length,
          currentStep: 1,
        });
        currentActivityId = activity.id;
        setActivityId(currentActivityId);
      }

      setExecutionSteps((prev) =>
        prev.map((s) => ({ ...s, status: "processing" as const })),
      );

      const supplyStep = strategy.steps.find(
        (s) => s.type === STEP_TYPE.SUPPLY,
      );
      const borrowStep = strategy.steps.find(
        (s) => s.type === STEP_TYPE.BORROW,
      );
      const swapStep = strategy.steps.find(
        (s) =>
          s.type === STEP_TYPE.SWAP,
      );

      const collateralSymbol =
        supplyStep?.tokenIn?.symbol ??
        strategy.initialCapital?.symbol ??
        "";
      const borrowSymbol = borrowStep?.tokenOut?.symbol ?? "";
      const swapOutSymbol = swapStep?.tokenOut?.symbol ?? borrowSymbol;

      const collateralTokenInfo = TOKEN_SYMBOL_MAP[collateralSymbol];
      const borrowTokenInfo = TOKEN_SYMBOL_MAP[borrowSymbol];
      const swapOutTokenInfo = TOKEN_SYMBOL_MAP[swapOutSymbol];

      if (!collateralTokenInfo)
        throw new Error(`Unknown collateral token: ${collateralSymbol}`);
      if (!borrowTokenInfo)
        throw new Error(`Unknown borrow token: ${borrowSymbol}`);
      if (!swapOutTokenInfo)
        throw new Error(`Unknown swap output token: ${swapOutSymbol}`);

      const collateralAmount = parseUnits(
        String(strategy.initialCapital?.amount ?? 0),
        collateralTokenInfo.decimals,
      );
      const supplyAmount = parseUnits(
        String(strategy.totalSupply ?? 0),
        18,
      );
      const borrowAmount = parseUnits(
        String(strategy.totalBorrow ?? 0),
        borrowTokenInfo.decimals,
      );
      const swapAmountIn = parseUnits(
        String(swapStep?.tokenIn?.amount ?? 0),
        18,
      );
      const swapMinOutRaw = parseUnits(
        String(swapStep?.tokenOut?.amount ?? 0),
        swapOutTokenInfo.decimals,
      );
      const swapMinOut =
        (swapMinOutRaw *
          BigInt(Math.round((1 - SLIPPAGE_TOLERANCE) * 10000))) /
        10000n;

      setIsEncrypting(true);
      let encCollateral: Awaited<ReturnType<typeof encrypt128ForComposer>>;
      let encSupply: Awaited<ReturnType<typeof encrypt128ForComposer>>;
      let encBorrow: Awaited<ReturnType<typeof encrypt128ForComposer>>;

      try {
        [encCollateral, encSupply, encBorrow] =
          await Promise.all([
            encrypt128ForComposer(collateralAmount),
            encrypt128ForComposer(supplyAmount),
            encrypt128ForComposer(borrowAmount),
          ]);
      } finally {
        setIsEncrypting(false);
      }

      const params: OpenStrategyParams = {
        strategyName: strategyId,
        workflowHash: "", 
        collateralToken: collateralTokenInfo.address,
        collateralAmount,
        poolSupplyAmount: supplyAmount,
        borrowToken: borrowTokenInfo.address,
        poolBorrowAmount: borrowAmount,
        useOracleBorrow: false,
        ltvNum: 70n,
        ltvDen: 100n,
        swapTokenOut: swapOutTokenInfo.address,
        swapDeadlineOffset: BigInt(SWAP_DEADLINE_OFFSET),
        strategyId: BigInt(strategyId),
        apyTarget: 0, 
        loopCount: strategy.loops ?? 1,
        swapAmountIn,
        swapMinOut,
      };

      const encrypted: OpenStrategyEncrypted = {
        collateral: encCollateral,
        supplyEnc: encSupply,
        borrowEnc: encBorrow,
      };

      const txHash = await openPosition(params, encrypted);

      let receiptOk = false;
      if (txHash) {
        try {
          await waitForTransactionReceipt(
            {
              chainId:
                (strategy as unknown as { chainId?: number }).chainId ??
                activeChainId,
            } as unknown as Parameters<typeof waitForTransactionReceipt>[0],
            {
              hash: txHash as `0x${string}`,
              pollingInterval: 2000,
            } as unknown as Parameters<typeof waitForTransactionReceipt>[1],
          );
          receiptOk = true;
        } catch {
          const provider =
            typeof window !== "undefined" && "ethereum" in window
              ? (
                  window as Window & {
                    ethereum?: {
                      request: (args: {
                        method: string;
                        params: unknown[];
                      }) => Promise<unknown>;
                    };
                  }
                ).ethereum
              : null;
          if (provider && typeof provider.request === "function") {
            for (;;) {
              try {
                const rec = await provider.request({
                  method: "eth_getTransactionReceipt",
                  params: [txHash],
                });
                if (rec && (rec as { status: number }).status) {
                  receiptOk = true;
                  break;
                }
              } catch {
                
              }
              await new Promise((r) => setTimeout(r, TX_POLLING_INTERVAL));
            }
          } else {
            throw new Error(
              "Transaction receipt polling not supported in this environment",
            );
          }
        }
      } else {
        receiptOk = true;
      }

      if (receiptOk) {
        setExecutionSteps((prev) =>
          prev.map((s) => ({
            ...s,
            status: "completed" as const,
            txHash,
          })),
        );
        setCurrentStepIndex(executionSteps.length);
        setAllStepsCompleted(true);
        onStatusChange?.("completed");
        displayToast("success", "🎉 All steps completed successfully!");

        if (currentActivityId) {
          await updateActivityMutation.mutateAsync({
            activityId: currentActivityId,
            payload: {
              activityId: currentActivityId,
              step: strategy.steps.length,
              status: "SUCCESS",
              message: `All ${strategy.steps.length} steps completed successfully.`,
            },
          });
        }

        refetchPortfolio();

        if (txHash) {
          setSwapIntentId(txHash);
        }
      } else {
        setExecutionSteps((prev) =>
          prev.map((s) => ({ ...s, status: "failed" as const })),
        );
        if (currentActivityId)
          await syncActivityProgress(currentActivityId, 1, "failed");
        displayToast(
          "error",
          "Transaction receipt not confirmed",
        );
      }
    } catch (err) {
      setExecutionSteps((prev) =>
        prev.map((s) => ({ ...s, status: "failed" as const })),
      );
      displayToast(
        "error",
        `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCancel = () => {
    abortRef.current = true;
    setIsExecuting(false);
    onStatusChange?.("cancelled");
    onOpenChange(false);
  };

  const handleClose = async () => {
    if (
      isExecuting ||
      (currentStepIndex < executionSteps.length && !allStepsCompleted)
    ) {
      abortRef.current = true;
      setIsExecuting(false);
      updateStepStatus(currentStepIndex, "failed");
      if (activityId) {
        await syncActivityProgress(activityId, currentStepIndex + 1, "failed");
      }
      onStatusChange?.("cancelled");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto bg-card border border-border">
        <DialogHeader className="pb-4 border-b border-border">
          <DialogTitle className="text-2xl font-bold text-primary">
            {allStepsCompleted ? "Execution Completed! 🎉" : "Execute Strategy"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1.5">
            {allStepsCompleted
              ? `All ${executionSteps.length} steps completed successfully!`
              : `${subtitle} • Step ${currentStepIndex + 1} of ${executionSteps.length}`}
          </p>
        </DialogHeader>

        <div className="flex-1">
          <EncryptProgress
            stepsState={isEncrypting ? { pack: "active" } : null}
          />
          {executionSteps.length > 0 ? (
            <StepStack
              steps={executionSteps}
              currentStep={currentStepIndex}
              allStepsCompleted={allStepsCompleted}
            />
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="text-center"
            >
              <p className="text-sm text-muted-foreground">
                No steps to execute.
              </p>
            </motion.div>
          )}
        </div>

        {allStepsCompleted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="mx-6 p-4 bg-accent/10 border border-accent/30"
          >
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-accent/20 flex items-center justify-center">
                <span className="text-2xl">✓</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-accent">Success!</p>
                <p className="text-xs text-foreground/70">
                  Your strategy has been executed successfully.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {allStepsCompleted && hasPosition && positionMeta && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mx-6 p-3 bg-muted/50 border border-border"
          >
            <p className="text-xs font-medium text-foreground/80 mb-1">Position Opened</p>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Strategy ID: {positionMeta.strategyId.toString()}</span>
              <span>
                Created:{" "}
                {new Date(Number(positionMeta.createdAt) * 1000).toLocaleString()}
              </span>
            </div>
          </motion.div>
        )}

        {allStepsCompleted && isPortfolioLoading && (
          <div className="mx-6 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Checking position status…
          </div>
        )}

        {swapIntentId && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mx-6 p-3 bg-muted/30 border border-border"
          >
            <p className="text-xs font-medium text-foreground/80 mb-2">Swap Intent</p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={async () => {
                  try {
                    const meta = await getIntentMeta(swapIntentId as `0x${string}`);
                    setIntentMeta(meta);
                  } catch (err) {
                    displayToast("error", `Failed to fetch intent: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
              >
                Check Swap Status
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="text-xs text-red-500 hover:text-red-600"
                disabled={isCancelling}
                onClick={async () => {
                  try {
                    await cancelIntent(swapIntentId as `0x${string}`);
                    displayToast("success", "Swap intent cancelled");
                    setSwapIntentId(null);
                  } catch (err) {
                    displayToast("error", `Failed to cancel: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
              >
                {isCancelling ? "Cancelling…" : "Cancel Swap"}
              </Button>
            </div>
            {intentMeta && (
              <div className="mt-2 text-xs text-muted-foreground">
                <span>Token In: {intentMeta.tokenIn}</span>
                <span className="ml-3">Token Out: {intentMeta.tokenOut}</span>
                <span className="ml-3">Deadline: {intentMeta.deadline.toString()}</span>
              </div>
            )}
          </motion.div>
        )}

        <div className="flex gap-3 mt-6 pt-4 border-t border-border">
          {isExecuting ? (
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold shadow-lg shadow-red-400/50 
                        ring-1 ring-red-500/40 transform transition-all duration-200"
              onClick={handleCancel}
            >
              Cancel Execution
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleClose}
              >
                Close
              </Button>
              {!allStepsCompleted && (
                <Button
                  className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold"
                  onClick={startExecution}
                  disabled={!executionSteps.length || !isWalletConnected || isComposerPending}
                >
                  {!isWalletConnected ? "Connect Wallet" : "Start Execution"}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
