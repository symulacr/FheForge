"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { displayToast } from "@/components/shared/toast-manager";
import { AIStrategyService } from "@/services/ai-strategy-service";
import type { BuildStrategyResponse } from "@/services/ai-strategy-service";

type TokenOption = {
  label: string;
  value: string;
};

export function useStrategyPrompt() {
  const router = useRouter();

  const [loading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [strategyResult, setStrategyResult] =
    useState<BuildStrategyResponse | null>(null);

  const [selectedToken, setSelectedToken] = useState("");
  const [tokenAmount, setTokenAmount] = useState<number>(2); // Default amount
  const [prompt, setPrompt] = useState("");

  // Updated tokens for Arbitrum/Fhenix ecosystem
  const tokens: TokenOption[] = [
    { label: "WETH", value: "WETH" },
    { label: "USDC", value: "USDC" },
    { label: "USDT", value: "USDT" },
  ];

  const onCancel = () => {
    router.push("/builder");
  };

  const onNext = async () => {
    try {
      setSubmitting(true);

      // Validate prompt
      const validation = AIStrategyService.validatePrompt(prompt);
      if (!validation.isValid) {
        displayToast("error", validation.error!);
        return;
      }

      // Build additional context from selected token and amount
      const additionalContext = selectedToken
        ? `${AIStrategyService.formatTokenToContext(selectedToken)} with ${tokenAmount} ${selectedToken}`
        : undefined;

      // Call AI Strategy Builder API
      const result = await AIStrategyService.buildStrategy({
        userIntent: prompt,
        additionalContext,
        tokenAmount,
      });

      // Validate token consistency after strategy is generated
      const tokenConsistencyValidation =
        AIStrategyService.validateTokenConsistency(result.steps, selectedToken);

      if (!tokenConsistencyValidation.isValid) {
        displayToast("error", tokenConsistencyValidation.error!);
        return;
      }

      setStrategyResult(result);

      // Show success message with strategy info
      const { steps, validation: strategyValidation, metadata } = result;

      if (!strategyValidation?.isValid) {
        displayToast(
          "warning",
          `Strategy created with warnings: ${strategyValidation?.errors.join(", ")}`,
        );
      } else {
        displayToast(
          "success",
          `Strategy created successfully! ${steps.length} steps, ${metadata.riskLevel} risk level.`,
        );
      }

      const strategyData = {
        name: `Strategy ${new Date().toLocaleString()}`,
        result,
        selectedToken,
        tokenAmount,
        prompt,
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(strategyData))));
      router.push(`/strategy-review?data=${encodeURIComponent(encoded)}`);
    } catch (error: unknown) {
      console.error("Strategy generation failed:", error);

      // Display the original error message from backend
      const errorMessage =
        error instanceof Error ? error.message : "Failed to generate strategy.";

      displayToast("error", errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return {
    tokens,
    loading,
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
  };
}
