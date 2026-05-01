import { useChainId, useWriteContract, usePublicClient } from "wagmi";
import type { Hash, Address } from "viem";
import { useMemo, useState, useCallback } from "react";

import SwapRouterABI from "@/abis/SwapRouter.json";
import { getContractAddresses } from "@/utils/addresses";
import { useCofheState } from "@/providers/fhenix-provider";

export interface IntentMeta {
  tokenIn: Address;
  tokenOut: Address;
  user: Address;
  deadline: bigint;
}

export function useSwapRouter() {
  const chainId = useChainId();
  const cofheState = useCofheState();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: isCancelling } = useWriteContract();
  const [isLoading, setIsLoading] = useState(false);

  const routerAddress = useMemo(() => {
    try {
      return getContractAddresses(chainId).swapRouter;
    } catch {
      return undefined;
    }
  }, [chainId]);

  const getIntentMeta = useCallback(
    async (intentId: Hash): Promise<IntentMeta> => {
      if (!publicClient) throw new Error("Public client not available");
      if (!routerAddress) throw new Error("SwapRouter address not configured");

      setIsLoading(true);
      try {
        const result = await publicClient.readContract({
          address: routerAddress,
          abi: SwapRouterABI,
          functionName: "getIntentMeta",
          args: [intentId],
        });

        // ABI returns (address tokenIn, address tokenOut, address user, uint256 deadline)
        const [tokenIn, tokenOut, user, deadline] = result as [
          Address,
          Address,
          Address,
          bigint,
        ];
        return { tokenIn, tokenOut, user, deadline };
      } finally {
        setIsLoading(false);
      }
    },
    [publicClient, routerAddress],
  );

  const cancelIntent = useCallback(
    async (intentId: Hash): Promise<Hash> => {
      if (!routerAddress) throw new Error("SwapRouter address not configured");
      if (!cofheState.permitReady) {
        throw new Error("CoFHE permit not ready");
      }

      return writeContractAsync({
        address: routerAddress,
        abi: SwapRouterABI,
        functionName: "cancelIntent",
        args: [intentId],
      });
    },
    [routerAddress, cofheState.permitReady, writeContractAsync],
  );

  return {
    getIntentMeta,
    cancelIntent,
    isLoading,
    isCancelling,
    routerAddress,
  } as const;
}