import {
  useAccount,
  useChainId,
  useReadContract,
  useReadContracts,
} from "wagmi";
import type { Abi } from "viem";
import { useMemo } from "react";
import type { Address } from "viem";
import VaultArtifact from "@/abis/StrategyVault.json";
const VaultABI = VaultArtifact as unknown as Abi;
import PoolArtifact from "@/abis/LendingPool.json";
const PoolABI = PoolArtifact as unknown as Abi;
import { getContractAddresses } from "@/utils/addresses";

export type PositionId = `0x${string}`;

function isPositionIdArray(data: unknown): data is PositionId[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item): item is PositionId =>
        typeof item === "string" && item.startsWith("0x"),
    )
  );
}

function isPositionMetaTuple(data: unknown): data is readonly [bigint, bigint] {
  return (
    Array.isArray(data) &&
    data.length === 2 &&
    typeof data[0] === "bigint" &&
    typeof data[1] === "bigint"
  );
}

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
    functionName: "getSupplyBalance",
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
    functionName: "getBorrowBalance",
    args: wethAddress ? [wethAddress] : undefined,
    query: {
      enabled: !!poolAddress && !!wethAddress,
    },
  });

  // P7: derived from getUserPositions
  const userPositions: PositionId[] = isPositionIdArray(userPositionsData)
    ? userPositionsData
    : [];
  const hasPosition = userPositions.length > 0;
  // First position as default (caller can pass a specific one)
  const primaryPositionId = userPositions[0];

  const {
    data: allPositionsMetaData,
    isLoading: allPositionsMetaLoading,
    refetch: refetchAllPositionsMeta,
  } = useReadContracts({
    contracts: userPositions.map((posId) => ({
      address: vaultAddress!,
      abi: VaultABI,
      functionName: "getPositionMeta",
      args: [posId],
    })),
    query: { enabled: !!vaultAddress && userPositions.length > 0 },
  });

  const getPositionMeta = (_positionId: PositionId) => {
    const index = userPositions.findIndex((id) => id === _positionId);
    const result = index >= 0 ? allPositionsMetaData?.[index] : undefined;
    const raw = result?.result;
    return {
      data: isPositionMetaTuple(raw) ? raw : undefined,
      isLoading: allPositionsMetaLoading,
      refetch: refetchAllPositionsMeta,
    };
  };

  const refetch = async () => {
    await Promise.all([
      refetchUserPositions(),
      refetchPlainSupply(),
      refetchPlainBorrow(),
      refetchAllPositionsMeta(),
    ]);
  };

  return {
    // P7: replaced hasPosition with getUserPositions-derived hasPosition + position IDs
    hasPosition,
    userPositions,
    primaryPositionId,
    getPositionMeta,
    plainSupplyBalance: plainSupplyData as bigint | undefined,
    plainBorrowBalance: plainBorrowData as bigint | undefined,
    isLoading: userPositionsLoading || plainSupplyLoading || plainBorrowLoading,
    vaultAddress,
    poolAddress,
    refetch,
  };
}
