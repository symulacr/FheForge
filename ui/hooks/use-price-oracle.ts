import { useReadContract, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { useMemo } from "react";
import type { Address, Hash } from "viem";
import { getContractAddresses } from "@/utils/addresses";
import PriceOracleABI from "@/abis/PriceOracle.json";

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
    isLoading,
    refetch,
  };
}
