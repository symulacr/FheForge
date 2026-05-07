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

  const encrypt128 = async (value: bigint): Promise<EncryptedHandle> => {
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

  const openPosition = async (
    collateralToken: string,
    collateralAmount: string,
    collateralEth: string,
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
          userAddr,
        ],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  const supplyToLending = async (
    token: string,
    amount: string,
    decimals = 18,
  ) => {
    const { pool } = requireAddresses();
    const amt = parseUnits(amount, decimals);
    validateEuint128(amt);

    const userAddr = userAddress;
    if (!userAddr) throw new Error("Wallet not connected");

    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amt);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "supplyToLending",
        args: [token, amt, enc, userAddr],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  const borrowFromLending = async (
    token: string,
    borrowAmount: string,
    decimals = 18,
  ) => {
    const { pool } = requireAddresses();
    const amt = parseUnits(borrowAmount, decimals);
    validateEuint128(amt);

    const userAddr = userAddress;
    if (!userAddr) throw new Error("Wallet not connected");

    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amt);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "borrowFromLending",
        args: [token, amt, enc, userAddr],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  const repayBorrow = async (token: string, amount: string, decimals = 18) => {
    const { pool } = requireAddresses();
    const amt = parseUnits(amount, decimals);
    validateEuint128(amt);
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amt);
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
      const enc = await encrypt128(amt);
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

  // TODO: Wire to vault `repay` once the ABI exposes a repay function.
  // The current StrategyVault ABI does not include a standalone repay;
  // repayment goes through the LendingPool via `repayBorrow` above.
  const repay = async (token: string, amount: bigint): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(amount);
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amount);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "repay",
        args: [token, amount, enc] as unknown as [string, bigint, { ctHash: bigint; securityZone: number; utype: number; signature: string }],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  // TODO: Wire to vault `withdraw` once the ABI exposes a withdraw function.
  // The current StrategyVault ABI does not include a standalone withdraw;
  // withdrawal goes through the LendingPool via `withdrawSupply` above.
  const withdraw = async (token: string, amount: bigint): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(amount);
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amount);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "withdraw",
        args: [token, amount, enc] as unknown as [string, bigint, { ctHash: bigint; securityZone: number; utype: number; signature: string }],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  // TODO: Wire supplyEth once the Vault ABI exposes a native ETH supply function.
  // Current StrategyVault uses addCollateral for ERC-20 tokens.
  // const supplyEth = async (amount: bigint): Promise<Hash> => {
  //   const { vault } = requireAddresses();
  //   validateEuint128(amount);
  //   setIsEncrypting(true);
  //   try {
  //     const enc = await encrypt128(amount);
  //     return writeContractAsync({
  //       address: vault as `0x${string}`,
  //       abi: VaultABI,
  //       functionName: "supplyEth",
  //       args: [amount, enc],
  //     });
  //   } finally {
  //     setIsEncrypting(false);
  //   }
  // };

  // TODO: Wire withdrawEth once the Vault ABI exposes a native ETH withdraw function.
  // Current StrategyVault uses closePosition or emergencyWithdraw for withdrawals.
  // const withdrawEth = async (amount: bigint): Promise<Hash> => {
  //   const { vault } = requireAddresses();
  //   validateEuint128(amount);
  //   setIsEncrypting(true);
  //   try {
  //     const enc = await encrypt128(amount);
  //     return writeContractAsync({
  //       address: vault as `0x${string}`,
  //       abi: VaultABI,
  //       functionName: "withdrawEth",
  //       args: [amount, enc],
  //     });
  //   } finally {
  //     setIsEncrypting(false);
  //   }
  // };

  return {
    openPosition,
    supplyToLending,
    borrowFromLending,
    repayBorrow,
    withdrawSupply,
    submitSwapIntent,
    closePosition,
    repay,
    withdraw,
    revealCollateral,
    revealBorrow,
    revealSwapIntent,
    isEncrypting,
    isPending,
  };
}