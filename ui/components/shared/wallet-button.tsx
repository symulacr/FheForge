"use client";
import { useFheWallet } from "@/hooks/use-fhe-wallet";

export function WalletButton({ className }: { className?: string }) {
  const { isConnected, address, connectWallet, disconnectWallet } =
    useFheWallet();
  const base =
    "px-3 py-1.5 text-xs border border-accent text-accent hover:bg-accent hover:text-black transition-colors font-mono";
  if (isConnected && address)
    return (
      <button className={className ?? base} onClick={() => disconnectWallet()}>
        [{address.slice(0, 6)}…{address.slice(-4)}]
      </button>
    );
  return (
    <button className={className ?? base} onClick={connectWallet}>
      [connect wallet]
    </button>
  );
}
