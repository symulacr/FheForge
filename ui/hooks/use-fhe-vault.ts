import { useWriteContract, useChainId, useAccount } from "wagmi";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { parseUnits, formatUnits, type Hash } from "viem";
import { useMemo, useRef, useState } from "react";

import VaultABI from "@/abis/StrategyVault.json";
import PoolABI from "@/abis/LendingPool.json";
import RouterABI from "@/abis/SwapRouter.json";
import { getContractAddresses, validateEuint128 } from "@/utils/addresses";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";
import { SLIPPAGE_TOLERANCE } from "@/lib/constants";

interface EncryptedHandle {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: string;
}

export type EncryptedUint128Input = EncryptedHandle;

// MC-41/42: Permit2 types for supplyWithPermit2 / repayWithPermit2
export interface PermitTransferFrom {
  permitted: {
    token: `0x${string}`;
    amount: bigint;
  };
  nonce: bigint;
  deadline: bigint;
}

export function useFheVault() {
  const cofheClient = useCofheClient();
  const cofheState = useCofheState();
  const { writeContractAsync, isPending } = useWriteContract();
  const chainId = useChainId();
  const { address: userAddress } = useAccount();
  const addresses = useMemo(() => {
    try {
      return getContractAddresses(chainId);
    } catch {
      return null;
    }
  }, [chainId]);
  const [isEncrypting, setIsEncrypting] = useState(false);

  const lastEncryptedSupply = useRef<EncryptedHandle | null>(null);
  const lastEncryptedBorrow = useRef<EncryptedHandle | null>(null);

  const requireAddresses = () => {
    if (!addresses) throw new Error(`Unsupported chain: ${chainId}`);
    return addresses;
  };

  // MC-27: Vault functions (openPosition, closePosition) use InEuint128
  const encrypt128 = async (value: bigint): Promise<EncryptedHandle> => {
    if (!cofheClient) throw new Error("CoFHE client not ready");
    if (!cofheState.permitReady) throw new Error("CoFHE permit not ready — please wait or reconnect");
    const handles = (await cofheClient
      .encryptInputs([Encryptable.uint128(value)])
      .execute()) as EncryptedHandle[];
    if (!handles[0]) throw new Error("CoFHE returned empty handle list");
    return handles[0];
  };

  // MC-28: Pool functions (repay, withdraw, supplyEth, withdrawEth) + Vault.addCollateral use InEuint64
  const encrypt64 = async (value: bigint): Promise<EncryptedHandle> => {
    if (!cofheClient) throw new Error("CoFHE client not ready");
    if (!cofheState.permitReady) throw new Error("CoFHE permit not ready — please wait or reconnect");
    const handles = (await cofheClient
      .encryptInputs([Encryptable.uint64(value)])
      .execute()) as EncryptedHandle[];
    if (!handles[0]) throw new Error("CoFHE returned empty handle list");
    return handles[0];
  };

  const decryptForView = async (handle: EncryptedHandle): Promise<string> => {
    if (!cofheClient) throw new Error("CoFHE client not ready");
    if (!cofheState.permitReady) throw new Error("CoFHE permit not ready — please wait or reconnect");
    const result = await (
      cofheClient as {
        decryptForView: (
          hash: bigint,
          fheType: typeof FheTypes.Uint128,
        ) => { execute: () => Promise<bigint> };
      }
    )
      .decryptForView(handle.ctHash, FheTypes.Uint128)
      .execute();
    return formatUnits(result, 18);
  };

  const revealCollateral = async (): Promise<string> => {
    const handle = lastEncryptedSupply.current;
    if (!handle) throw new Error("No encrypted supply stored — open a position first");
    return decryptForView(handle);
  };

  const revealBorrow = async (): Promise<string> => {
    const handle = lastEncryptedBorrow.current;
    if (!handle) throw new Error("No encrypted borrow stored — open a position first");
    return decryptForView(handle);
  };

  const revealSwapIntent = async (encryptedAmount: EncryptedUint128Input): Promise<string> => {
    return decryptForView(encryptedAmount);
  };

  // MC-09: added strategyId parameter (5th arg required by StrategyVault.openPosition)
  // MC-27: uses encrypt128 (InEuint128)
  const openPosition = async (
    collateralToken: string,
    collateralAmount: string,
    collateralEth: string,
    strategyId: bigint = 0n,
  ) => {
    const { vault } = requireAddresses();
    const collateral = parseUnits(collateralEth, 18);
    const amountWei = parseUnits(collateralAmount, 18);
    validateEuint128(collateral);

    const userAddr = userAddress;
    if (!userAddr) throw new Error("Wallet not connected");

    setIsEncrypting(true);
    try {
      const encColl = await encrypt128(collateral);
      lastEncryptedSupply.current = encColl;
      return writeContractAsync({
        address: vault as `0x${string}`,
        abi: VaultABI,
        functionName: "openPosition",
        args: [
          collateralToken,
          amountWei,
          encColl,
          strategyId,
          userAddr,
        ],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  // MC-13: addCollateral — StrategyVault.addCollateral(address, uint256, InEuint64, address)
  // MC-28: uses encrypt64 (InEuint64)
  const addCollateral = async (
    collateralToken: string,
    amount: string,
    decimals = 18,
  ) => {
    const { vault } = requireAddresses();
    const amt = parseUnits(amount, decimals);
    validateEuint128(amt);

    const userAddr = userAddress;
    if (!userAddr) throw new Error("Wallet not connected");

    setIsEncrypting(true);
    try {
      const enc = await encrypt64(amt);
      return writeContractAsync({
        address: vault as `0x${string}`,
        abi: VaultABI,
        functionName: "addCollateral",
        args: [collateralToken, amt, enc, userAddr],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  // MC-07/08: supplyToLending and borrowFromLending REMOVED.
  // These are onlyComposer-gated on LendingPool — user calls revert.
  // Use useComposer().openLeveragedStrategy or useRebalance() instead.

  // MC-23/28: Pool repay uses InEuint64 (renamed from repayBorrow — same function)
  const repay = async (token: string, amount: string, decimals = 18) => {
    const { pool } = requireAddresses();
    const amt = parseUnits(amount, decimals);
    validateEuint128(amt);
    setIsEncrypting(true);
    try {
      const enc = await encrypt64(amt);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "repay",
        args: [token, amt, enc],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  // MC-28: Pool withdraw uses InEuint64
  const withdrawSupply = async (
    token: string,
    amount: string,
    decimals = 18,
  ) => {
    const { pool } = requireAddresses();
    const amt = parseUnits(amount, decimals);
    validateEuint128(amt);
    setIsEncrypting(true);
    try {
      const enc = await encrypt64(amt);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "withdraw",
        args: [token, amt, enc],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  const submitSwapIntent = async (
    tokenIn: string,
    tokenOut: string,
    amountInEth: string,
    minOutEth: string,
    deadlineOffset: number,
  ) => {
    const { router } = requireAddresses();
    const amountIn = parseUnits(amountInEth, 18);
    const minOut =
      (parseUnits(minOutEth, 18) *
        BigInt(Math.round((1 - SLIPPAGE_TOLERANCE) * 10000))) /
      10000n;

    return writeContractAsync({
      address: router as `0x${string}`,
      abi: RouterABI,
      functionName: "submitSwapIntent",
      args: [tokenIn, tokenOut, amountIn, minOut, BigInt(deadlineOffset)],
    });
  };

  // MC-27: Vault closePosition uses InEuint128
  const closePosition = async (
    collateralAmount: bigint,
    encryptedCollateralAmount: EncryptedUint128Input,
  ): Promise<Hash> => {
    const { vault } = requireAddresses();
    return writeContractAsync({
      address: vault as `0x${string}`,
      abi: VaultABI,
      functionName: "closePosition",
      args: [collateralAmount, encryptedCollateralAmount] as unknown as [bigint, { ctHash: bigint; securityZone: number; utype: number; signature: string }],
    });
  };

  // MC-20/28: Pool supplyEth uses InEuint64
  const supplyEth = async (amount: bigint): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(amount);
    setIsEncrypting(true);
    try {
      const enc = await encrypt64(amount);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "supplyEth",
        args: [enc],
        value: amount,
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  // MC-21/28: Pool withdrawEth uses InEuint64
  const withdrawEth = async (amount: bigint, encAmount: EncryptedHandle): Promise<Hash> => {
    const { pool } = requireAddresses();
    return writeContractAsync({
      address: pool as `0x${string}`,
      abi: PoolABI,
      functionName: "withdrawEth",
      args: [amount, encAmount],
    });
  };

  // MC-41: supplyWithPermit2 — LendingPool.supplyWithPermit2(address, uint256, InEuint64, PermitTransferFrom, bytes)
  const supplyWithPermit2 = async (
    token: string,
    amount: string,
    permit: PermitTransferFrom,
    signature: `0x${string}`,
    decimals = 18,
  ): Promise<Hash> => {
    const { pool } = requireAddresses();
    const amt = parseUnits(amount, decimals);
    validateEuint128(amt);
    setIsEncrypting(true);
    try {
      const enc = await encrypt64(amt);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "supplyWithPermit2",
        args: [token, amt, enc, permit, signature],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  // MC-42: repayWithPermit2 — LendingPool.repayWithPermit2(address, uint256, InEuint64, PermitTransferFrom, bytes)
  const repayWithPermit2 = async (
    token: string,
    amount: string,
    permit: PermitTransferFrom,
    signature: `0x${string}`,
    decimals = 18,
  ): Promise<Hash> => {
    const { pool } = requireAddresses();
    const amt = parseUnits(amount, decimals);
    validateEuint128(amt);
    setIsEncrypting(true);
    try {
      const enc = await encrypt64(amt);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "repayWithPermit2",
        args: [token, amt, enc, permit, signature],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  return {
    openPosition,
    addCollateral,
    repay,
    withdrawSupply,
    submitSwapIntent,
    closePosition,
    supplyEth,
    withdrawEth,
    supplyWithPermit2,
    repayWithPermit2,
    revealCollateral,
    revealBorrow,
    revealSwapIntent,
    isEncrypting,
    isPending,
  };
}
