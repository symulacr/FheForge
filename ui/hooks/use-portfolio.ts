import { useAccount, useChainId, useReadContract } from "wagmi";
import { useMemo } from "react";
import type { Address } from "viem";

import VaultABI from "@/abis/StrategyVault.json";
import PoolABI from "@/abis/LendingPool.json";
import { getContractAddresses } from "@/utils/addresses";

interface PositionMeta {
  strategyId: bigint;
  createdAt: bigint;
}

export function usePortfolio(account?: Address) {
  const chainId = useChainId();
  const { address: connectedAddress } = useAccount();
  const userAddress = account ?? connectedAddress;

  const addresses = useMemo(() => {
    try {
      return getContractAddresses(chainId);
    } catch {
      return null;
    }
  }, [chainId]);

  const vaultAddress = addresses?.vault as Address | undefined;
  const poolAddress = addresses?.pool as Address | undefined;

  const enabled = !!vaultAddress && !!poolAddress && !!userAddress;

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
      enabled,
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

  // MC-25: Vault balance reads
  const {
    data: depositedAmountData,
    isLoading: depositedLoading,
    refetch: refetchDeposited,
  } = useReadContract({
    address: vaultAddress,
    abi: VaultABI,
    functionName: "getDepositedAmount",
    args: [],
    query: {
      enabled: !!vaultAddress,
    },
  });

  // MC-26: Pool plain balance reads (non-FHE, no ACL needed)
  const wethAddress = addresses
    ? (Object.entries({
        WETH: process.env.NEXT_PUBLIC_TOKEN_WETH,
        USDC: process.env.NEXT_PUBLIC_TOKEN_USDC,
      }).find(([, v]) => v)?.[1] as Address | undefined)
    : undefined;

  const {
    data: plainSupplyData,
    isLoading: plainSupplyLoading,
    refetch: refetchPlainSupply,
  } = useReadContract({
    address: poolAddress,
    abi: PoolABI,
    functionName: "getPlainSupplyBalance",
    args: wethAddress ? [wethAddress] : undefined,
    query: {
      enabled: !!poolAddress && !!wethAddress,
    },
  });

  const {
    data: plainBorrowData,
    isLoading: plainBorrowLoading,
    refetch: refetchPlainBorrow,
  } = useReadContract({
    address: poolAddress,
    abi: PoolABI,
    functionName: "getPlainBorrowBalance",
    args: wethAddress ? [wethAddress] : undefined,
    query: {
      enabled: !!poolAddress && !!wethAddress,
    },
  });

  const hasPosition = hasPositionData as boolean | undefined;
  const positionMeta = positionMetaData as PositionMeta | undefined;
  const depositedAmount = depositedAmountData as bigint | undefined;
  const plainSupplyBalance = plainSupplyData as bigint | undefined;
  const plainBorrowBalance = plainBorrowData as bigint | undefined;

  const refetch = async () => {
    await Promise.all([
      refetchHasPosition(),
      refetchPositionMeta(),
      refetchDeposited(),
      refetchPlainSupply(),
      refetchPlainBorrow(),
    ]);
  };

  return {
    hasPosition,
    positionMeta,
    depositedAmount,
    plainSupplyBalance,
    plainBorrowBalance,
    isLoading:
      hasPositionLoading ||
      positionMetaLoading ||
      depositedLoading ||
      plainSupplyLoading ||
      plainBorrowLoading,
    vaultAddress,
    poolAddress,
    refetch,
  };
}