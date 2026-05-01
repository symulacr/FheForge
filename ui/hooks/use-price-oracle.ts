import { useReadContract, useChainId, usePublicClient } from "wagmi";
import { useMemo } from "react";
import type { Address } from "viem";
import { getContractAddresses } from "@/utils/addresses";
import PriceOracleABI from "@/abis/PriceOracle.json";

export function usePriceOracle() {
  const chainId = useChainId();
  const publicClient = usePublicClient();

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
    isLoading,
    refetch,
  };
}
