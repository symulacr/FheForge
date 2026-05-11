import { useAccount, useChainId, useReadContract } from "wagmi";
import type { Abi } from "viem";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import VaultArtifact from "@/abis/StrategyVault.json";
const VaultABI = VaultArtifact.abi as unknown as Abi;
import PoolArtifact from "@/abis/LendingPool.json";
const PoolABI = PoolArtifact.abi as unknown as Abi;
import { getContractAddresses } from "@/utils/addresses";

export type PositionId = `0x${string}`;

export interface PositionMeta {
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

  // P7: getUserPositions(user) → bytes32[] — replace hasPosition
  const {
    data: userPositionsData,
    isLoading: userPositionsLoading,
    refetch: refetchUserPositions,
  } = useReadContract({
    address: vaultAddress,
    abi: VaultABI,
    functionName: "getUserPositions",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled },
  });

  // P7: positionExists(positionId) → bool — replace hasPosition check
  // We derive this from getUserPositions length; no separate call needed when we have positions.
  // callers can use: const hasPosition = (userPositionsData as PositionId[])?.length > 0

  // P7: getPositionMeta(positionId) → (strategyId, createdAt)
  // caller must pass a specific positionId; we expose it but do not auto-read without one
  const getPositionMeta = (positionId: PositionId) =>
    useReadContract({
      address: vaultAddress,
      abi: VaultABI,
      functionName: "getPositionMeta",
      args: [positionId],
      query: { enabled: !!vaultAddress && !!positionId },
    });

  // P7: getDepositedAmount(positionId) → uint256
  const getDepositedAmount = (positionId: PositionId) =>
    useReadContract({
      address: vaultAddress,
      abi: VaultABI,
      functionName: "getDepositedAmount",
      args: [positionId],
      query: { enabled: !!vaultAddress && !!positionId },
    });

  // P7: getCollateral(positionId) → euint128 (encrypted, returns handle)
  const getCollateral = (positionId: PositionId) =>
    useReadContract({
      address: vaultAddress,
      abi: VaultABI,
      functionName: "getCollateral",
      args: [positionId],
      query: { enabled: !!vaultAddress && !!positionId },
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

  // P7: derived from getUserPositions
  const userPositions = (userPositionsData as PositionId[]) ?? [];
  const hasPosition = userPositions.length > 0;
  // First position as default (caller can pass a specific one)
  const primaryPositionId = userPositions[0];

  const refetch = async () => {
    await Promise.all([
      refetchUserPositions(),
      refetchPlainSupply(),
      refetchPlainBorrow(),
    ]);
  };

  return {
    // P7: replaced hasPosition with getUserPositions-derived hasPosition + position IDs
    hasPosition,
    userPositions,
    primaryPositionId,
    getPositionMeta,
    getDepositedAmount,
    getCollateral,
    plainSupplyBalance: plainSupplyData as bigint | undefined,
    plainBorrowBalance: plainBorrowData as bigint | undefined,
    isLoading:
      userPositionsLoading ||
      plainSupplyLoading ||
      plainBorrowLoading,
    vaultAddress,
    poolAddress,
    refetch,
  };
}