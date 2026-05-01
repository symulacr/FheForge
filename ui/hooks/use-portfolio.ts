import { useAccount, useChainId, useReadContract } from "wagmi";
import { useMemo } from "react";
import type { Address } from "viem";

import VaultABI from "@/abis/StrategyVault.json";
import { getContractAddresses } from "@/utils/addresses";

interface PositionMeta {
  strategyId: bigint;
  createdAt: bigint;
}

export function usePortfolio(account?: Address) {
  const chainId = useChainId();
  const { address: connectedAddress } = useAccount();
  const userAddress = account ?? connectedAddress;

  const vaultAddress = useMemo(() => {
    try {
      return getContractAddresses(chainId).vault;
    } catch {
      return undefined;
    }
  }, [chainId]) as Address | undefined;

  const {
    data: hasPositionData,
    isLoading: hasPositionLoading,
    refetch: refetchHasPosition,
  } = useReadContract({
    address: vaultAddress,
    abi: VaultABI,
    functionName: "hasPosition",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!vaultAddress && !!userAddress,
    },
  });

  const {
    data: positionMetaData,
    isLoading: positionMetaLoading,
    refetch: refetchPositionMeta,
  } = useReadContract({
    address: vaultAddress,
    abi: VaultABI,
    functionName: "getPositionMeta",
    args: [],
    query: {
      enabled: !!vaultAddress,
    },
  });

  const hasPosition = hasPositionData as boolean | undefined;
  const positionMeta = positionMetaData as PositionMeta | undefined;

  const refetch = async () => {
    await Promise.all([refetchHasPosition(), refetchPositionMeta()]);
  };

  return {
    hasPosition,
    positionMeta,
    isLoading: hasPositionLoading || positionMetaLoading,
    vaultAddress,
    refetch,
  };
}