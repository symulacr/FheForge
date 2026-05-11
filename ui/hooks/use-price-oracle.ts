import { useReadContract, useChainId, usePublicClient, useWriteContract } from "wagmi";
import type { Abi } from "viem";
import { useMemo } from "react";
import type { Address, Hash } from "viem";
import { getContractAddresses } from "@/utils/addresses";
import PriceOracleArtifact from "@/abis/PriceOracle.json";
const PriceOracleABI = PriceOracleArtifact.abi as unknown as Abi;

export function usePriceOracle() {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const oracleAddress = useMemo(() => {
    try {
      return getContractAddresses(chainId).oracle;
    } catch {
      return undefined;
    }
  }, [chainId]);

  const getPriceUsd = async (token: Address): Promise<bigint> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "getPriceUsd",
      args: [token],
    });

    return (result as [bigint, bigint])[0];
  };

  const getPythUpdateFee = async (updateData: `0x${string}`[]): Promise<bigint> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "getPythUpdateFee",
      args: [updateData],
    });

    return result as bigint;
  };

  const updatePriceFeeds = async (updateData: `0x${string}`[]): Promise<Hash> => {
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const fee = await getPythUpdateFee(updateData);

    return writeContractAsync({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "updatePriceFeeds",
      args: [updateData],
      value: fee,
    });
  };

  const convertToUsd = async (token: Address, amount: bigint): Promise<bigint> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "convertToUsd",
      args: [token, amount],
    });

    return result as bigint;
  };

  const convertFromUsd = async (token: Address, usdWad: bigint): Promise<bigint> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "convertFromUsd",
      args: [token, usdWad],
    });

    return result as bigint;
  };

  const isSupported = async (token: Address): Promise<boolean> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "isSupported",
      args: [token],
    });

    return result as boolean;
  };

  // ────────── P9: staleness ──────────

  const isStale = async (token: Address): Promise<boolean> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "isStale",
      args: [token],
    });

    return result as boolean;
  };

  const lastPriceUpdate = async (token: Address): Promise<bigint> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "lastPriceUpdate",
      args: [token],
    });

    return result as bigint;
  };

  const getStalenessThreshold = async (): Promise<bigint> => {
    if (!publicClient) throw new Error("Public client not available");
    if (!oracleAddress) throw new Error("PriceOracle address not configured");

    const result = await publicClient.readContract({
      address: oracleAddress,
      abi: PriceOracleABI,
      functionName: "stalenessThreshold",
      args: [],
    });

    return result as bigint;
  };

  const { isLoading, refetch } = useReadContract({
    address: oracleAddress,
    abi: PriceOracleABI,
    functionName: "getPriceUsd",
    args: [undefined as unknown as Address],
    query: {
      enabled: false,
    },
  });

  return {
    getPriceUsd,
    getPythUpdateFee,
    updatePriceFeeds,
    convertToUsd,
    convertFromUsd,
    isSupported,
    isStale,
    lastPriceUpdate,
    getStalenessThreshold,
    isLoading,
    refetch,
  };
}