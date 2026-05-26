import { useChainId, useWriteContract, usePublicClient } from "wagmi";
import type { Abi } from "viem";
import type { Hash, Address } from "viem";
import { useMemo, useState, useCallback } from "react";

import SwapRouterArtifact from "@/abis/SwapRouter.json";
const SwapRouterABI = SwapRouterArtifact as unknown as Abi;
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

  const executeIntent = useCallback(
    async (intentId: Hash, outputAmount: bigint): Promise<Hash> => {
      if (!routerAddress) throw new Error("SwapRouter address not configured");
      if (!cofheState.permitReady) throw new Error("CoFHE permit not ready");
      return writeContractAsync({
        address: routerAddress,
        abi: SwapRouterABI,
        functionName: "executeIntent",
        args: [intentId, outputAmount],
      });
    },
    [routerAddress, cofheState.permitReady, writeContractAsync],
  );

  return {
    getIntentMeta,
    cancelIntent,
    executeIntent,
    isLoading,
    isCancelling,
    routerAddress,
  } as const;
}
