import { useWriteContract, useChainId } from "wagmi";
import type { Abi } from "viem";
import { useMemo } from "react";
import type { Hash } from "viem";
import ComposerArtifact from "@/abis/FheForgeComposer.json";
const ComposerABI = ComposerArtifact.abi as unknown as Abi;

import { getContractAddresses } from "@/utils/addresses";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";
import { Encryptable } from "@cofhe/sdk";

interface InEuint128 {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: string;
}


export interface OpenStrategyParams {
  strategyName: string;
  workflowHash: string;
  collateralToken: string;
  collateralAmount: bigint;
  poolSupplyAmount: bigint;
  borrowToken: string;
  poolBorrowAmount: bigint;
  useOracleBorrow: boolean;
  ltvNum: bigint;
  ltvDen: bigint;
  swapTokenOut: string;
  swapDeadlineOffset: bigint;
  strategyId: bigint;
  apyTarget: number;
  loopCount: number;
  swapAmountIn: bigint;
  swapMinOut: bigint;
}

export interface OpenStrategyEncrypted {
  collateral: InEuint128;
  supplyEnc: InEuint128;
  borrowEnc: InEuint128;
}

export function useComposer() {
  const cofheClient = useCofheClient();
  const cofheState = useCofheState();
  const { writeContractAsync, isPending } = useWriteContract();
  const chainId = useChainId();

  const composerAddress = useMemo(() => {
    try {
      return getContractAddresses(chainId).composer;
    } catch {
      return undefined;
    }
  }, [chainId]);

  // MC-27: Composer collateral uses InEuint128
  const encrypt128 = async (value: bigint): Promise<InEuint128> => {
    if (!cofheClient) throw new Error("CoFHE client not ready");
    if (!cofheState.permitReady)
      throw new Error("CoFHE permit not ready");
    const handles = (await cofheClient
      .encryptInputs([Encryptable.uint128(value)])
      .execute()) as InEuint128[];
    if (!handles[0]) throw new Error("CoFHE returned empty handle list");
    return handles[0];
  };


  // R7: Encrypt with setAccount(composerAddress) for cross-contract FHE input validation
  // When Composer forwards encrypted inputs to Pool/Vault, msg.sender = Composer.
  // The proof signature must embed Composer's address, not the user's.
  const encrypt128ForComposer = async (value: bigint): Promise<InEuint128> => {
    if (!cofheClient) throw new Error("CoFHE client not ready");
    if (!cofheState.permitReady)
      throw new Error("CoFHE permit not ready");
    if (!composerAddress) throw new Error("Composer address not configured");
    const handles = (await cofheClient
      .encryptInputs([Encryptable.uint128(value)])
      .setAccount(composerAddress)
      .execute()) as InEuint128[];
    if (!handles[0]) throw new Error("CoFHE returned empty handle list");
    return handles[0];
  };


  const openLeveragedStrategy = async (
    params: OpenStrategyParams,
    encrypted: OpenStrategyEncrypted,
  ): Promise<Hash> => {
    if (!composerAddress) throw new Error("Composer address not configured");
    if (!cofheState.permitReady)
      throw new Error("CoFHE permit not ready");

    return writeContractAsync({
      address: composerAddress,
      abi: ComposerABI,
      functionName: "openLeveragedStrategy",
      args: [params, encrypted] as unknown as [OpenStrategyParams, OpenStrategyEncrypted],
    });
  };

  return {
    openLeveragedStrategy,
    composerAddress,
    isPending,
    encrypt128,
    encrypt128ForComposer,
  };
}