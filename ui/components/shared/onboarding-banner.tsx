"use client";
import { useState } from "react";
import { useFheWallet } from "@/hooks/use-fhe-wallet";
import { useCofheState } from "@/providers/fhenix-provider";

export function OnboardingBanner() {
	const { isConnected } = useFheWallet();
	const cofheState = useCofheState();
	const [dismissed, setDismissed] = useState(false);

	if (dismissed) return null;

	if (cofheState.error) {
		return (
			<div className="fixed top-12 left-0 w-full z-40 bg-red-500/10 border-b border-red-500/40 px-4 py-1.5 flex items-center justify-between text-xs">
				<span className="text-destructive font-mono">
					<span className="text-red-500 mr-2">⚠</span>
					{cofheState.error}
				</span>
				<button onClick={() => setDismissed(true)} className="text-destructive hover:text-red-300 ml-4">
					✕
				</button>
			</div>
		);
	}

	if (isConnected && cofheState.isConnecting) {
		return (
			<div className="fixed top-12 left-0 w-full z-40 bg-accent/10 border-b border-accent/30 px-4 py-1.5 flex items-center justify-between text-xs">
				<span className="text-accent font-mono">
					<span className="text-muted mr-2">⟳</span>
					Initializing CoFHE…
				</span>
				<button
					onClick={() => setDismissed(true)}
					className="text-muted hover:text-foreground ml-4"
				>
					✕
				</button>
			</div>
		);
	}

	if (isConnected && !cofheState.isReady) {
		return (
			<div className="fixed top-12 left-0 w-full z-40 bg-yellow-500/10 border-b border-yellow-500/40 px-4 py-1.5 flex items-center justify-between text-xs">
				<span className="text-yellow-400 font-mono">
					<span className="text-yellow-500 mr-2">⚠</span>
					CoFHE not ready — check permit status
				</span>
				<button
					onClick={() => setDismissed(true)}
					className="text-yellow-400 hover:text-yellow-300 ml-4"
				>
					✕
				</button>
			</div>
		);
	}

	if (isConnected) return null;

	return (
		<div className="fixed top-12 left-0 w-full z-40 bg-accent/10 border-b border-accent/30 px-4 py-1.5 flex items-center justify-between text-xs">
			<span className="text-accent font-mono">
				<span className="text-muted mr-2">$</span>
				connect wallet on Arbitrum Sepolia to execute FHE-encrypted strategies
			</span>
			<button onClick={() => setDismissed(true)} className="text-muted hover:text-foreground ml-4">
				✕
			</button>
		</div>
	);
}
