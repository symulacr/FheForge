import { useWriteContract } from "wagmi";
import { useChainId } from "wagmi";
import type { Hash } from "viem";
import FheForgeComposerAbi from "@/abis/FheForgeComposer.json";
import { getContractAddresses } from "@/utils/addresses";
import { useCofheState } from "@/providers/fhenix-provider";

// TODO: Replace `as any` with proper tuple types once ABI codegen is set up.

export interface RebalanceParams {
  collateralToken: `0x${string}`;
  addCollateralAmount: bigint;
  repayAmount: bigint;
  repayToken: `0x${string}`;
  newBorrowAmount: bigint;
  borrowToken: `0x${string}`;
  useOracleBorrow: boolean;
  ltvNum: bigint;
  ltvDen: bigint;
  collateralPermit: {
    amount: bigint;
    deadline: bigint;
    nonce: bigint;
    signature: `0x${string}`;
  };
  repayPermit: {
    amount: bigint;
    deadline: bigint;
    nonce: bigint;
    signature: `0x${string}`;
  };
}

export interface InEuint128 {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: `0x${string}`;
}

export interface RebalanceEncrypted {
  addCollateralEnc: InEuint128;
  repayEnc: InEuint128;
  newBorrowEnc: InEuint128;
}

export function useRebalance() {
  const chainId = useChainId();
  const { permitReady } = useCofheState();
  const { writeContractAsync, isPending } = useWriteContract();

  const rebalance = async (
    params: RebalanceParams,
    encrypted: RebalanceEncrypted,
  ): Promise<Hash> => {
    if (!permitReady) {
      throw new Error("CoFHE permit not ready");
    }

    const addresses = getContractAddresses(chainId);

    return writeContractAsync({
      address: addresses.composer,
      abi: FheForgeComposerAbi,
      functionName: "rebalance",
      args: [params, encrypted] as [RebalanceParams, RebalanceEncrypted], // TODO: generate strict tuple types from ABI
    });
  };

  return { rebalance, isPending };
}