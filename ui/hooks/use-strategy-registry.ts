import { useReadContract, useWriteContract, useChainId, usePublicClient } from "wagmi";
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
  const { writeContractAsync } = useWriteContract();

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

  // MC-35: registerStrategy (2-arg overload)
  const registerStrategy = async (
    name: string,
    workflowHash: Hash,
  ): Promise<Hash> => {
    if (!registryAddress)
      throw new Error("StrategyRegistry address not configured");

    return writeContractAsync({
      address: registryAddress,
      abi: StrategyRegistryABI,
      functionName: "registerStrategy",
      args: [name, workflowHash],
    });
  };

  // MC-47/48/49: registerStrategy (4-arg overload with params)
  const registerStrategyWithParams = async (
    name: string,
    workflowHash: Hash,
    apyTarget: number,
    loopCount: number,
  ): Promise<Hash> => {
    if (!registryAddress)
      throw new Error("StrategyRegistry address not configured");

    return writeContractAsync({
      address: registryAddress,
      abi: StrategyRegistryABI,
      functionName: "registerStrategy",
      args: [name, workflowHash, apyTarget, loopCount],
    });
  };

  // MC-47: setActive
  const setActive = async (
    strategyId: bigint,
    active: boolean,
  ): Promise<Hash> => {
    if (!registryAddress)
      throw new Error("StrategyRegistry address not configured");

    return writeContractAsync({
      address: registryAddress,
      abi: StrategyRegistryABI,
      functionName: "setActive",
      args: [strategyId, active],
    });
  };

  // MC-48: getStrategyParams (imperative, via publicClient)
  const getStrategyParams = async (
    strategyId: bigint,
  ): Promise<{ apyTarget: number; loopCount: number }> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!registryAddress)
      throw new Error("StrategyRegistry address not configured");

    const result = await publicClient.readContract({
      address: registryAddress,
      abi: StrategyRegistryABI,
      functionName: "getStrategyParams",
      args: [strategyId],
    });

    const [apyTarget, loopCount] = result as [number, number];
    return { apyTarget, loopCount };
  };

  // MC-49: strategyCount (reactive, via useReadContract)
  const {
    data: strategyCount,
    isLoading: isStrategyCountLoading,
    refetch: refetchStrategyCount,
  } = useReadContract({
    address: registryAddress,
    abi: StrategyRegistryABI,
    functionName: "strategyCount",
    query: {
      enabled: !!registryAddress,
    },
  });

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
    registerStrategy,
    registerStrategyWithParams,
    setActive,
    getStrategyParams,
    strategyCount: strategyCount as bigint | undefined,
    isStrategyCountLoading,
    refetchStrategyCount,
    isLoading,
    refetch,
  };
}
