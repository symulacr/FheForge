import { useReadContract, useChainId, usePublicClient } from "wagmi";
import { useMemo } from "react";
import type { Address, Hash } from "viem";
import { getContractAddresses } from "@/utils/addresses";
import StrategyRegistryABI from "@/abis/StrategyRegistry.json";

export interface StrategyMeta {
  name: string;
  workflowHash: Hash;
  creator: Address;
  createdAt: bigint;
  active: boolean;
}

export function useStrategyRegistry() {
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const registryAddress = useMemo(() => {
    try {
      return getContractAddresses(chainId).registry;
    } catch {
      return undefined;
    }
  }, [chainId]);

  const getStrategyMeta = async (
    strategyId: bigint,
  ): Promise<StrategyMeta> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!registryAddress)
      throw new Error("StrategyRegistry address not configured");

    const result = await publicClient.readContract({
      address: registryAddress,
      abi: StrategyRegistryABI,
      functionName: "getStrategyMeta",
      args: [strategyId],
    });

    const [name, workflowHash, creator, createdAt, active] = result as [
      string,
      Hash,
      Address,
      bigint,
      boolean,
    ];

    return { name, workflowHash, creator, createdAt, active };
  };

  const { isLoading, refetch } = useReadContract({
    address: registryAddress,
    abi: StrategyRegistryABI,
    functionName: "getStrategyMeta",
    args: [undefined as unknown as bigint],
    query: {
      enabled: false,
    },
  });

  return {
    getStrategyMeta,
    isLoading,
    refetch,
  };
}
