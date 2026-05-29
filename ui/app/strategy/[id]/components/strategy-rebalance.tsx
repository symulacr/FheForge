"use client";

import { AlertCircle, ArrowLeftRight, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { type Address, type Hash, parseUnits } from "viem";
import { useAccount } from "wagmi";
import { useRebalance } from "@/hooks/use-rebalance";
import type { DefiStrategy } from "@/types/defi.strategy";
import { TOKEN_SYMBOL_MAP } from "@/utils/addresses";

interface StrategyRebalanceProps {
	strategy: DefiStrategy;
}

export function StrategyRebalance({ strategy }: StrategyRebalanceProps) {
	const { address: walletAddress } = useAccount();
	const { rebalanceWithEncrypt, isPending } = useRebalance();

	const [addCollateralAmount, setAddCollateralAmount] = useState("");
	const [newBorrowAmount, setNewBorrowAmount] = useState("");
	const [collateralToken, setCollateralToken] = useState("WETH");
	const [borrowToken, setBorrowToken] = useState("USDC");

	const [txHash, setTxHash] = useState<Hash | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const tokenOptions = Object.keys(TOKEN_SYMBOL_MAP);

	const handleRebalance = useCallback(async () => {
		if (!walletAddress) {
			setError("Wallet not connected");
			return;
		}

		setError(null);
		setTxHash(null);
		setIsSubmitting(true);

		try {
			const collAddress = TOKEN_SYMBOL_MAP[collateralToken]?.address as Address;
			const borrowTokenAddress = TOKEN_SYMBOL_MAP[borrowToken]?.address as Address;
			const collDecimals = TOKEN_SYMBOL_MAP[collateralToken]?.decimals ?? 18;
			const borrowDecimals = TOKEN_SYMBOL_MAP[borrowToken]?.decimals ?? 6;

			const positionId = strategy.id as `0x${string}`;

			const hash = await rebalanceWithEncrypt({
				positionId,
				collateralToken: collAddress,
				addCollateralAmount: parseUnits(addCollateralAmount || "0", collDecimals),
				repayAmount: BigInt(0),
				repayToken: borrowTokenAddress,
				newBorrowAmount: parseUnits(newBorrowAmount || "0", borrowDecimals),
				borrowToken: borrowTokenAddress,
				useOracleBorrow: true,
				ltvNum: BigInt(7500),
				ltvDen: BigInt(10000),
			});

			setTxHash(hash);
			setAddCollateralAmount("");
			setNewBorrowAmount("");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Rebalance transaction failed";
			setError(message);
		} finally {
			setIsSubmitting(false);
		}
	}, [
		walletAddress,
		collateralToken,
		borrowToken,
		addCollateralAmount,
		newBorrowAmount,
		rebalanceWithEncrypt,
		strategy.id,
	]);

	const isLoading = isPending || isSubmitting;

	const needsWallet = !walletAddress;

	if (needsWallet) {
		return (
			<div className="glass p-6 text-center">
				<div className="flex flex-col items-center gap-3">
					<AlertCircle className="w-8 h-8 text-muted" aria-hidden />
					<p className="text-muted text-sm">Connect your wallet to rebalance this position</p>
				</div>
			</div>
		);
	}

	return (
		<div className="glass p-6 space-y-6">
			<div className="flex items-center gap-3">
				<ArrowLeftRight className="w-5 h-5 text-accent" aria-hidden />
				<h3 className="text-lg font-semibold">Rebalance Position</h3>
			</div>

			{/* Collateral Token */}
			<div className="space-y-2">
				<label
					htmlFor="collateral-token-select"
					className="text-xs uppercase tracking-wider text-muted font-medium"
				>
					Collateral Token
				</label>
				<select
					id="collateral-token-select"
					value={collateralToken}
					onChange={(e) => setCollateralToken(e.target.value)}
					className="w-full px-4 py-3 bg-card border border-border text-white text-sm"
					disabled={isLoading}
				>
					{tokenOptions.map((token) => (
						<option key={token} value={token}>
							{token}
						</option>
					))}
				</select>
			</div>

			{/* Add Collateral */}
			<div className="space-y-2">
				<label
					htmlFor="add-collateral-amount"
					className="text-xs uppercase tracking-wider text-muted font-medium"
				>
					Add Collateral Amount
				</label>
				<input
					id="add-collateral-amount"
					type="text"
					value={addCollateralAmount}
					onChange={(e) => setAddCollateralAmount(e.target.value.replace(/[^0-9.]/g, ""))}
					placeholder="0.00"
					className="w-full px-4 py-3 bg-card border border-border text-white text-lg placeholder:text-white/20"
					disabled={isLoading}
				/>
			</div>

			{/* Borrow Token */}
			<div className="space-y-2">
				<label
					htmlFor="borrow-token-select"
					className="text-xs uppercase tracking-wider text-muted font-medium"
				>
					Borrow Token
				</label>
				<select
					id="borrow-token-select"
					value={borrowToken}
					onChange={(e) => setBorrowToken(e.target.value)}
					className="w-full px-4 py-3 bg-card border border-border text-white text-sm"
					disabled={isLoading}
				>
					{tokenOptions.map((token) => (
						<option key={token} value={token}>
							{token}
						</option>
					))}
				</select>
			</div>

			{/* New Borrow Amount */}
			<div className="space-y-2">
				<label
					htmlFor="new-borrow-amount"
					className="text-xs uppercase tracking-wider text-muted font-medium"
				>
					New Borrow Amount
				</label>
				<input
					id="new-borrow-amount"
					type="text"
					value={newBorrowAmount}
					onChange={(e) => setNewBorrowAmount(e.target.value.replace(/[^0-9.]/g, ""))}
					placeholder="0.00"
					className="w-full px-4 py-3 bg-card border border-border text-white text-lg placeholder:text-white/20"
					disabled={isLoading}
				/>
			</div>

			{/* Error */}
			{error && (
				<div
					className="flex items-center gap-2 p-3 border border-red-400/30 bg-red-400/5"
					role="alert"
				>
					<AlertCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden />
					<p className="text-red-400 text-sm">{error}</p>
				</div>
			)}

			{/* Success */}
			{txHash && (
				<div className="flex items-center gap-2 p-3 border border-green-400/30 bg-green-400/5">
					<CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" aria-hidden />
					<p className="text-green-400 text-sm break-all">
						Rebalance submitted: {txHash.slice(0, 10)}...{txHash.slice(-6)}
					</p>
				</div>
			)}

			{/* Submit */}
			<button
				onClick={handleRebalance}
				disabled={isLoading || (!addCollateralAmount && !newBorrowAmount)}
				className="
          defi-btn-glass w-full py-4
          transition-all duration-300 text-base
          disabled:opacity-40 disabled:cursor-not-allowed
        "
			>
				{isLoading ? (
					<span className="flex items-center justify-center gap-2">
						<Loader2 className="w-4 h-4 animate-spin" aria-hidden />
						Processing...
					</span>
				) : (
					"Execute Rebalance"
				)}
			</button>
		</div>
	);
}
