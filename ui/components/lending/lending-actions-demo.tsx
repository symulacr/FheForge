"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLendingActions } from "@/hooks/use-lending-actions";

/**
 * Demo component showing how to use the lending action hooks.
 * This component demonstrates MC-36/37/38/44/45 functionality:
 * - MC-36: liquidate
 * - MC-37: borrowWithLtvCheck
 * - MC-38: borrowWithOracle
 * - MC-44: emergencyWithdraw (moved to Vault hook)
 * - MC-45: isSupported
 */
export function LendingActionsDemo() {
	const { address } = useAccount();
	const {
		borrowWithLtvCheckWithEncrypt,
		borrowWithOracleWithEncrypt,
		isSupported,
		isEncrypting,
		isPending,
	} = useLendingActions();

	const [userAddress, setUserAddress] = useState("");
	const [collateralToken, setCollateralToken] = useState("");
	const [borrowToken, setBorrowToken] = useState("");
	const [collateralAmount, setCollateralAmount] = useState("");
	const [borrowAmount, setBorrowAmount] = useState("");
	const [ltvNum, setLtvNum] = useState("75");
	const [ltvDen, setLtvDen] = useState("100");
	const [tokenToCheck, setTokenToCheck] = useState("");

	const [result, setResult] = useState<string>("");
	const [isSupportedResult, setIsSupportedResult] = useState<boolean | null>(null);

	const handleLiquidate = async () => {
		setResult(
			"Use requestLiquidityCheck first, then liquidateWithProof with the decrypted balance proof",
		);
	};

	const handleCheckLtvAndBorrow = async () => {
		if (!collateralToken || !borrowToken || !borrowAmount) {
			setResult("Please fill in all borrow fields");
			return;
		}
		try {
			setResult("Processing borrowWithLtvCheck...");
			const tx = await borrowWithLtvCheckWithEncrypt(
				collateralToken as `0x${string}`,
				borrowToken as `0x${string}`,
				borrowAmount,
				18, // decimals
				BigInt(ltvNum),
				BigInt(ltvDen),
			);
			setResult(`borrowWithLtvCheck tx: ${tx}`);
		} catch (error) {
			setResult(`borrowWithLtvCheck failed: ${(error as Error).message}`);
		}
	};

	const handleBorrowWithOracle = async () => {
		if (!collateralToken || !borrowToken || !collateralAmount || !borrowAmount) {
			setResult("Please fill in all borrow fields");
			return;
		}
		try {
			setResult("Processing borrowWithOracle...");
			const tx = await borrowWithOracleWithEncrypt(
				collateralToken as `0x${string}`,
				borrowToken as `0x${string}`,
				collateralAmount,
				borrowAmount,
				18, // decimals
			);
			setResult(`borrowWithOracle tx: ${tx}`);
		} catch (error) {
			setResult(`borrowWithOracle failed: ${(error as Error).message}`);
		}
	};

	const handleIsSupported = async () => {
		if (!tokenToCheck) {
			setIsSupportedResult(null);
			return;
		}
		try {
			const supported = await isSupported(tokenToCheck as `0x${string}`);
			setIsSupportedResult(supported);
		} catch (error) {
			setIsSupportedResult(null);
			console.error("isSupported failed:", error);
		}
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Lending Actions Demo</CardTitle>
					<CardDescription>
						Demonstrates: liquidateWithProof, borrowWithLtvCheck, borrowWithOracle, isSupported
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="text-sm text-muted-foreground">
						Connected: {address || "Not connected"}
					</div>

					{/* Liquidate (MC-36) */}
					<div className="space-y-2 border p-4 rounded">
						<h3 className="font-semibold">MC-36: Liquidate</h3>
						<div className="grid grid-cols-2 gap-2">
							<div>
								<Label>User Address</Label>
								<Input
									placeholder="0x..."
									value={userAddress}
									onChange={(e) => setUserAddress(e.target.value)}
								/>
							</div>
							<div>
								<Label>Collateral Token</Label>
								<Input
									placeholder="0x..."
									value={collateralToken}
									onChange={(e) => setCollateralToken(e.target.value)}
								/>
							</div>
							<div>
								<Label>Debt Token</Label>
								<Input
									placeholder="0x..."
									value={borrowToken}
									onChange={(e) => setBorrowToken(e.target.value)}
								/>
							</div>
						</div>
						<Button onClick={handleLiquidate} disabled={isPending || isEncrypting}>
							Liquidate
						</Button>
					</div>

					{/* borrowWithLtvCheck (MC-37) */}
					<div className="space-y-2 border p-4 rounded">
						<h3 className="font-semibold">MC-37: Check LTV and Borrow</h3>
						<div className="grid grid-cols-2 gap-2">
							<div>
								<Label>Borrow Amount</Label>
								<Input
									placeholder="1.0"
									value={borrowAmount}
									onChange={(e) => setBorrowAmount(e.target.value)}
								/>
							</div>
							<div>
								<Label>LTV Numerator</Label>
								<Input
									placeholder="75"
									value={ltvNum}
									onChange={(e) => setLtvNum(e.target.value)}
								/>
							</div>
							<div>
								<Label>LTV Denominator</Label>
								<Input
									placeholder="100"
									value={ltvDen}
									onChange={(e) => setLtvDen(e.target.value)}
								/>
							</div>
						</div>
						<Button onClick={handleCheckLtvAndBorrow} disabled={isPending || isEncrypting}>
							Check LTV and Borrow
						</Button>
					</div>

					{/* borrowWithOracle (MC-38) */}
					<div className="space-y-2 border p-4 rounded">
						<h3 className="font-semibold">MC-38: Borrow with Oracle</h3>
						<div className="grid grid-cols-2 gap-2">
							<div>
								<Label>Collateral Amount</Label>
								<Input
									placeholder="1.0"
									value={collateralAmount}
									onChange={(e) => setCollateralAmount(e.target.value)}
								/>
							</div>
							<div>
								<Label>Borrow Amount</Label>
								<Input
									placeholder="1.0"
									value={borrowAmount}
									onChange={(e) => setBorrowAmount(e.target.value)}
								/>
							</div>
						</div>
						<Button onClick={handleBorrowWithOracle} disabled={isPending || isEncrypting}>
							Borrow with Oracle
						</Button>
					</div>

					{/* isSupported (MC-45) */}
					<div className="space-y-2 border p-4 rounded">
						<h3 className="font-semibold">MC-45: Is Supported Token</h3>
						<div className="flex gap-2">
							<Input
								placeholder="Token address to check"
								value={tokenToCheck}
								onChange={(e) => setTokenToCheck(e.target.value)}
							/>
							<Button onClick={handleIsSupported}>Check</Button>
						</div>
						{isSupportedResult !== null && (
							<div className="text-sm">
								Token is {isSupportedResult ? "supported" : "not supported"}
							</div>
						)}
					</div>

					{/* Result Display */}
					{result && (
						<div className="p-4 bg-muted rounded">
							<pre className="text-sm whitespace-pre-wrap">{result}</pre>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
