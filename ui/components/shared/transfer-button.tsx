"use client";

import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits } from "viem";
import { Token } from "@/types/defi";
import { useCofheClient } from "@/providers/fhenix-provider";
import { useToast } from "@/hooks/use-toast";
import { validateEuint128 } from "@/utils/addresses";

const ERC20_ABI = [
  {
    constant: false,
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
] as const;

export interface TransferButtonProps {
  token: Token;
  amount: string;
  toAddress: string;
  onSuccess?: (txHash: string) => void;
  onError?: (err: string) => void;
}

export async function performTransfer(params: {
  token: Token;
  amount: string;
  toAddress: string;
  cofheClient: ReturnType<typeof useCofheClient>;
  writeContractAsync: ReturnType<typeof useWriteContract>["writeContractAsync"];
  decimals?: number;
}): Promise<string> {
  const {
    token,
    amount,
    toAddress,
    cofheClient,
    writeContractAsync,
    decimals = 18,
  } = params;
  if (!token?.token_address) throw new Error("Invalid token address");

  const amt = parseUnits(amount, decimals);
  validateEuint128(amt);

  if (!cofheClient) throw new Error("CoFHE not ready");

  const tx = await writeContractAsync({
    address: token.token_address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [toAddress, amt],
  });
  const txHash =
    (tx && typeof tx === "object" && "hash" in tx
      ? (tx as { hash: string }).hash
      : "") || (typeof tx === "string" ? tx : "");
  return txHash;
}

export const TransferButton = ({
  token,
  amount,
  toAddress,
  onSuccess,
  onError,
}: TransferButtonProps) => {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const cofheClient = useCofheClient();
  const [isTransferring, setIsTransferring] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleTransfer = async () => {
    if (!address) {
      setError("⚠️ Please connect your wallet first.");
      toast({
        title: "Error",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }
    if (!token?.token_address) {
      setError("Invalid token address");
      toast({
        title: "Error",
        description: "Invalid token address",
        variant: "destructive",
      });
      return;
    }
    if (!cofheClient) {
      setError("CoFHE client not ready");
      toast({
        title: "Error",
        description: "CoFHE client not ready",
        variant: "destructive",
      });
      return;
    }

    setIsTransferring(true);
    setError(null);
    setTxHash(null);

    try {
      const txHashOut = await performTransfer({
        token,
        amount,
        toAddress,
        cofheClient,
        writeContractAsync,
        decimals: token.decimals,
      });
      setTxHash(txHashOut);
      onSuccess?.(txHashOut);
      toast({
        title: "Success",
        description: `Transaction sent: ${txHashOut}`,
        variant: "default",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Transaction failed. Please try again.";
      setError(`❌ ${message}`);
      toast({ title: "Error", description: message, variant: "destructive" });
      onError?.(message);
    } finally {
      setIsTransferring(false);
    }
  };

  const isDisabled = !address || isTransferring || !cofheClient;

  return (
    <div className="mt-6 flex flex-col items-center space-y-2">
      <button
        onClick={handleTransfer}
        disabled={isDisabled}
        className={`px-4 py-2 text-white transition-colors ${
          isDisabled
            ? "bg-muted cursor-not-allowed opacity-60"
            : "bg-accent hover:bg-accent/90"
        }`}
      >
        {isTransferring ? "Sending..." : "Transfer"}
      </button>

      {txHash && (
        <p className="text-sm text-success break-all">
          ✅ Transaction sent: <span className="font-mono">{txHash}</span>
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
};
