"use client";

import { useFheWallet } from "@/hooks/use-fhe-wallet";

export function WalletButton({ className }: { className?: string }) {
	const { isConnected, address, connectWallet, disconnectWallet } = useFheWallet();

	const baseStyles =
		"inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

	if (isConnected && address) {
		return (
			<button
				className={
					className ??
					`${baseStyles} border-accent text-accent hover:bg-accent hover:text-background`
				}
				onClick={disconnectWallet}
				aria-label={`Disconnect wallet ${address.slice(0, 6)}...${address.slice(-4)}`}
			>
				<span className="tabular-nums">
					{address.slice(0, 6)}...{address.slice(-4)}
				</span>
			</button>
		);
	}

	return (
		<button
			className={
				className ??
				`${baseStyles} border-border text-foreground hover:border-accent hover:text-accent`
			}
			onClick={connectWallet}
		>
			Connect
		</button>
	);
}
