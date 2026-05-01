import { useMemo, useState } from "react";
import { useSignTypedData, useChainId } from "wagmi";
import type { Address, Hash } from "viem";

import Permit2ABI from "@/abis/Permit2.json";

const PERMIT2_ADDRESS = "0x000000000022D473029F534aF5eCd6b4E4A6884E" as const;

const PERMIT_DETAILS_TYPE = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
} as const;

export interface Permit2Authorization {
  signature: Hash;
  amount: bigint;
  deadline: bigint;
  nonce: bigint;
}

export function usePermit2(
  token?: Address,
  spender?: Address,
  amount?: bigint,
) {
  const { signTypedDataAsync, isPending } = useSignTypedData();
  const [signature, setSignature] = useState<Hash | undefined>();
  const chainId = useChainId();

  const domain = useMemo(
    () => ({
      name: "Permit2",
      chainId,
      verifyingContract: PERMIT2_ADDRESS,
    }),
    [chainId],
  );

  const approvedAmount = useMemo(() => amount ?? (2n ** 160n - 1n), [amount]);
  const expiration = useMemo(
    () => Math.floor(Date.now() / 1000) + 3600,
    [],
  );

  const sign = async (): Promise<Permit2Authorization> => {
    if (!token) throw new Error("usePermit2: token address required");
    if (!spender) throw new Error("usePermit2: spender address required");

    const sig = await signTypedDataAsync({
      domain,
      types: PERMIT_DETAILS_TYPE,
      primaryType: "PermitDetails",
      message: {
        token,
        amount: approvedAmount,
        expiration,
nonce: 0,
      },
    });

    setSignature(sig as Hash);

    return {
      signature: sig as Hash,
      amount: approvedAmount,
      deadline: BigInt(expiration),
      nonce: 0n,
    };
  };

  return { sign, signature, isPending, Permit2ABI };
}