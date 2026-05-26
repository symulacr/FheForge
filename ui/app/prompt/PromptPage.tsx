"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ChevronDown, Lightbulb, Sparkles } from "lucide-react";
import { displayToast } from "@/components/shared/toast-manager";
import { useStrategyPrompt } from "@/hooks/use-strategy-prompt";
import { BuildStrategyResponse } from "@/services/ai-strategy-service";
import { StrategySimulate } from "@/types/strategy.type";
import { StrategyFlowPreview } from "@/components/strategy/StrategyFlowPreview";
import { StrategyFlowSkeleton } from "@/components/strategy/StrategyFlowSkeleton";
import { assetIcons } from "@/lib/iconMap";
import { PROMPT_MAX_LENGTH } from "@/lib/constants";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";

const ExecutionModal = dynamic(
  () =>
    import("@/components/shared/execution-modal").then((m) => m.ExecutionModal),
  {
    ssr: false,
  },
);

export default function PromptPage() {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [isExecutionOpen, setIsExecutionOpen] = useState(false);
  const [strategyToExecute, setStrategyToExecute] =
    useState<BuildStrategyResponse | null>(null);

  const {
    tokens,
    loading: _loading,
    submitting,
    strategyResult,
    selectedToken,
    tokenAmount,
    prompt,
    setSelectedToken,
    setTokenAmount,
    setPrompt,
    onCancel,
    onNext,
  } = useStrategyPrompt();

  const handleExampleClick = (examplePrompt: string) => {
    setPrompt(examplePrompt);
  };

  const charCount = useMemo(() => prompt.length, [prompt]);

  const validatePromptForm = () => {
    if (!selectedToken) {
      displayToast("error", "Please select a starting token.");
      return false;
    }

    if (!tokenAmount || tokenAmount <= 0) {
      displayToast("error", "Please enter a valid token amount.");
      return false;
    }

    if (!prompt.trim()) {
      displayToast("error", "Please enter your strategy prompt.");
      return false;
    }

    return true;
  };

  const handleNext = async () => {
    if (!validatePromptForm()) return;
    await onNext();
  };

  const handleRunStrategyClick = () => {
    if (!strategyResult) return;
    setStrategyToExecute(strategyResult);
    setIsExecutionOpen(true);
  };

  return (
    <div className="flex flex-1 min-h-[calc(100vh-120px)] items-center justify-center px-6 py-5 text-white">
      <div className="flex w-full max-w-7xl items-start justify-center gap-6">
        <div className="flex w-full max-w-[820px] flex-col relative overflow-hidden bg-card text-card-foreground border border-border p-6 shadow-lg transition-colors duration-300 hover:border-accent/50">
          <div className="space-y-5">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Create Prompt Strategy
              </h1>
            </div>

            <section className="space-y-2">
              <h2 className="text-sm font-medium text-white">
                Starting Token & Amount
              </h2>

              <div className="flex gap-3">
                <div className="relative w-32">
                  <input
                    type="number"
                    value={tokenAmount}
                    onChange={(e) => setTokenAmount(Number(e.target.value))}
                    min="0"
                    step="0.000001"
                    placeholder="Amount"
                    className="
                      h-12 w-full 
                      border border-border
                      bg-secondary
                      pl-4 pr-4
                      text-sm text-white text-center
                      placeholder:text-muted
                      outline-none transition-all duration-200
                      
                      hover:border-accent/50
                      hover:bg-secondary
                      focus:border-accent
                      focus:bg-secondary
                      
                      [appearance:textfield]
                      [&::-webkit-outer-spin-button]:appearance-none
                      [&::-webkit-inner-spin-button]:appearance-none
                    "
                  />
                </div>

                <div className="relative flex-1 token-dropdown">
                  <div
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="
                      h-12 w-full cursor-pointer 
                      border border-border
                      bg-secondary
                      pl-5 pr-12
                      text-sm text-white
                      outline-none transition-all duration-200
                      
                      hover:border-accent/50
                      hover:bg-secondary
                      focus:border-accent
                      focus:bg-secondary
                      
                      flex items-center gap-3
                    "
                  >
                    {selectedToken ? (
                      <>
                        <Image
                          src={
                            assetIcons[selectedToken] ||
                            assetIcons[selectedToken?.toUpperCase()] ||
                            assetIcons[selectedToken?.toLowerCase()] ||
                            "/icons/default.png"
                          }
                          alt={selectedToken}
                          width={20}
                          height={20}
                          className="w-5 h-5  object-contain bg-card border border-border"
                        />
                        <span>
                          {tokens.find((t) => t.value === selectedToken)
                            ?.label || selectedToken}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">Select token</span>
                    )}
                  </div>

                  <div className="pointer-events-none absolute inset-y-0 right-5 flex items-center">
                    <ChevronDown
                      className={`h-4 w-4 text-muted transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
                    />
                  </div>

                  {isDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsDropdownOpen(false)}
                      />
                      <div className="absolute top-full left-0 right-0 mt-2 z-50  border border-border bg-card   overflow-hidden">
                        {tokens.map((token) => (
                          <div
                            key={token.value}
                            onClick={() => {
                              setSelectedToken(token.value);
                              setIsDropdownOpen(false);
                            }}
                            className="flex items-center gap-3 px-5 py-3 text-sm text-white hover:bg-secondary cursor-pointer transition-colors"
                          >
                            <Image
                              src={
                                assetIcons[token.value] ||
                                assetIcons[token.value?.toUpperCase()] ||
                                assetIcons[token.value?.toLowerCase()] ||
                                "/icons/default.png"
                              }
                              alt={token.value}
                              width={20}
                              height={20}
                              className="w-5 h-5  object-contain bg-card border border-border"
                            />
                            <span>{token.label}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-medium text-white">
                  Strategy Prompt
                </h2>

                <span className="text-xs text-muted">
                  {charCount}/{PROMPT_MAX_LENGTH}
                </span>
              </div>

              <div className=" border border-border bg-secondary p-4 ">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={PROMPT_MAX_LENGTH}
                  placeholder="Example: Create a gdot looping 3 loops, Supply DOT and borrow USDC, Maximize yield with moderate risk..."
                  className="h-[110px] w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-muted"
                />

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Sparkles className="h-3 w-3" />
                    <span>AI-powered strategy generation</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              onClick={onCancel}
              className="h-11  border border-border bg-secondary px-5 text-sm font-medium text-muted transition hover:border-accent/50 hover:bg-secondary hover:text-white"
            >
              Cancel
            </button>

            <button
              onClick={handleNext}
              disabled={submitting}
              className="h-11  border border-border bg-secondary px-7 text-sm font-semibold text-foreground transition hover:border-accent/50 hover:bg-secondary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white/80 "
                  />
                  <span>Generating...</span>
                </div>
              ) : (
                "Generate Strategy"
              )}
            </button>
          </div>
        </div>

        <div className="w-[320px] shrink-0">
          {submitting ? (
            <StrategyFlowSkeleton />
          ) : strategyResult ? (
            <StrategyFlowPreview
              strategy={strategyResult}
              selectedToken={selectedToken}
              onRunStrategy={handleRunStrategyClick}
            />
          ) : (
            <div className="relative overflow-hidden  bg-card text-card-foreground  border border-border p-5 shadow-lg  transition-all duration-300 hover:border-accent/50  ">
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-yellow-400">
                  <Lightbulb className="h-4 w-4" />
                  <span className="text-sm font-semibold">Strategy Guide</span>
                </div>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted">
                      Example Prompts:
                    </h3>
                    <div className="space-y-1">
                      <div
                        onClick={() =>
                          handleExampleClick("Create a gdot looping 3 loops")
                        }
                        className="group text-xs text-muted p-3  bg-secondary border border-border cursor-pointer hover:bg-secondary hover:text-foreground hover:border-accent/30 transition-all duration-200"
                      >
                        <div className="flex items-center justify-between">
                          <span>&quot;Create a gdot looping 3 loops&quot;</span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-accent/70">
                            →
                          </span>
                        </div>
                      </div>
                      <div
                        onClick={() =>
                          handleExampleClick("Supply DOT and borrow USDC")
                        }
                        className="group text-xs text-muted p-3  bg-secondary border border-border cursor-pointer hover:bg-secondary hover:text-foreground hover:border-accent/30 transition-all duration-200"
                      >
                        <div className="flex items-center justify-between">
                          <span>&quot;Supply DOT and borrow USDC&quot;</span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-accent/70">
                            →
                          </span>
                        </div>
                      </div>
                      <div
                        onClick={() =>
                          handleExampleClick(
                            "Maximize yield with moderate risk",
                          )
                        }
                        className="group text-xs text-muted p-3  bg-secondary border border-border cursor-pointer hover:bg-secondary hover:text-foreground hover:border-accent/30 transition-all duration-200"
                      >
                        <div className="flex items-center justify-between">
                          <span>
                            &quot;Maximize yield with moderate risk&quot;
                          </span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-accent/70">
                            →
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-t border-white/8 pt-4">
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted">
                      Supported Operations:
                    </h3>
                    <div className="grid grid-cols-2 gap-1 text-xs text-white/50">
                      <div className="p-1.5 rounded bg-secondary border border-white/5 select-none">
                        Supply
                      </div>
                      <div className="p-1.5 rounded bg-secondary border border-white/5 select-none">
                        Borrow
                      </div>
                      <div className="p-1.5 rounded bg-secondary border border-white/5 select-none">
                        Swap
                      </div>
                      <div className="p-1.5 rounded bg-secondary border border-white/5 select-none">
                        Join Strategy
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-t border-white/8 pt-4">
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted">
                      Available Tokens:
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {tokens.map((token) => (
                        <span
                          key={token.value}
                          className="px-2 py-1 text-xs  bg-secondary text-muted border border-border select-none"
                        >
                          {token.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {strategyToExecute && (
        <ExecutionModal
          key={strategyToExecute ? "open" : "closed"}
          open={isExecutionOpen}
          onOpenChange={setIsExecutionOpen}
          strategy={strategyToExecute as unknown as StrategySimulate}
          strategyId={String(
            (strategyToExecute as unknown as { id?: string }).id ?? "",
          )}
          startFromStep={0}
          activityId={null}
        />
      )}
    </div>
  );
}
