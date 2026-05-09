"use client";

import { useLendingActions } from "@/hooks/use-lending-actions";
import { useAccount } from "wagmi";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Demo component showing how to use the lending action hooks.
 * This component demonstrates MC-36/37/38/44/45 functionality:
 * - MC-36: liquidate
 * - MC-37: checkLtvAndBorrow
 * - MC-38: borrowWithOracle
 * - MC-44: emergencyWithdraw
 * - MC-45: isSupported
 */
export function LendingActionsDemo() {
  const { address } = useAccount();
  const {
    liquidate,
    checkLtvAndBorrowWithEncrypt,
    borrowWithOracleWithEncrypt,
    emergencyWithdraw,
    isSupported,
    isEncrypting,
    isPending,
  } = useLendingActions();

  const [userAddress, setUserAddress] = useState("");
  const [collateralToken, setCollateralToken] = useState("");
  const [borrowToken, setBorrowToken] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [ltvNum, setLtvNum] = useState("75");
  const [ltvDen, setLtvDen] = useState("100");
  const [tokenToCheck, setTokenToCheck] = useState("");
  const [tokenToWithdraw, setTokenToWithdraw] = useState("");
  const [result, setResult] = useState<string>("");
  const [isSupportedResult, setIsSupportedResult] = useState<boolean | null>(null);

  const handleLiquidate = async () => {
    if (!userAddress || !collateralToken || !borrowToken) {
      setResult("Please fill in all liquidate fields");
      return;
    }
    try {
      setResult("Processing liquidation...");
      const debtToCover = BigInt(1000000); // Example amount
      const tx = await liquidate(
        userAddress as `0x${string}`,
        collateralToken as `0x${string}`,
        borrowToken as `0x${string}`,
        debtToCover,
      );
      setResult(`Liquidation tx: ${tx}`);
    } catch (error) {
      setResult(`Liquidation failed: ${(error as Error).message}`);
    }
  };

  const handleCheckLtvAndBorrow = async () => {
    if (!collateralToken || !borrowToken || !borrowAmount) {
      setResult("Please fill in all borrow fields");
      return;
    }
    try {
      setResult("Processing checkLtvAndBorrow...");
      const tx = await checkLtvAndBorrowWithEncrypt(
        collateralToken as `0x${string}`,
        borrowToken as `0x${string}`,
        borrowAmount,
        18, // decimals
        BigInt(ltvNum),
        BigInt(ltvDen),
      );
      setResult(`checkLtvAndBorrow tx: ${tx}`);
    } catch (error) {
      setResult(`checkLtvAndBorrow failed: ${(error as Error).message}`);
    }
  };

  const handleBorrowWithOracle = async () => {
    if (!collateralToken || !borrowToken || !borrowAmount) {
      setResult("Please fill in all borrow fields");
      return;
    }
    try {
      setResult("Processing borrowWithOracle...");
      const tx = await borrowWithOracleWithEncrypt(
        collateralToken as `0x${string}`,
        borrowToken as `0x${string}`,
        borrowAmount,
        18, // decimals
      );
      setResult(`borrowWithOracle tx: ${tx}`);
    } catch (error) {
      setResult(`borrowWithOracle failed: ${(error as Error).message}`);
    }
  };

  const handleEmergencyWithdraw = async () => {
    if (!tokenToWithdraw) {
      setResult("Please fill in token address");
      return;
    }
    try {
      setResult("Processing emergency withdraw...");
      const tx = await emergencyWithdraw(tokenToWithdraw as `0x${string}`);
      setResult(`Emergency withdraw tx: ${tx}`);
    } catch (error) {
      setResult(`Emergency withdraw failed: ${(error as Error).message}`);
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
            Demonstrates MC-36/37/38/44/45: liquidate, checkLtvAndBorrow, borrowWithOracle, emergencyWithdraw, isSupported
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
            <Button
              onClick={handleLiquidate}
              disabled={isPending || isEncrypting}
            >
              Liquidate
            </Button>
          </div>

          {/* checkLtvAndBorrow (MC-37) */}
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
            <Button
              onClick={handleCheckLtvAndBorrow}
              disabled={isPending || isEncrypting}
            >
              Check LTV and Borrow
            </Button>
          </div>

          {/* borrowWithOracle (MC-38) */}
          <div className="space-y-2 border p-4 rounded">
            <h3 className="font-semibold">MC-38: Borrow with Oracle</h3>
            <Button
              onClick={handleBorrowWithOracle}
              disabled={isPending || isEncrypting}
            >
              Borrow with Oracle
            </Button>
          </div>

          {/* emergencyWithdraw (MC-44) */}
          <div className="space-y-2 border p-4 rounded">
            <h3 className="font-semibold">MC-44: Emergency Withdraw</h3>
            <div>
              <Label>Token Address</Label>
              <Input
                placeholder="0x..."
                value={tokenToWithdraw}
                onChange={(e) => setTokenToWithdraw(e.target.value)}
              />
            </div>
            <Button
              onClick={handleEmergencyWithdraw}
              disabled={isPending}
            >
              Emergency Withdraw
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
