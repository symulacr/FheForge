import { useWriteContract, useChainId } from "wagmi";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { parseUnits, formatUnits, type Hash } from "viem";
import { useMemo, useRef, useState } from "react";

import VaultABI from "@/abis/StrategyVault.json";
import PoolABI from "@/abis/LendingPool.json";
import RouterABI from "@/abis/SwapRouter.json";
import { getContractAddresses, validateEuint128 } from "@/utils/addresses";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";
import { SLIPPAGE_TOLERANCE } from "@/lib/constants";

const DEFAULT_LTV_NUM = 70n;
const DEFAULT_LTV_DEN = 100n;

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
      .encryptInputs([Encryptable.uint128(value)])
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

  // F-03: openPosition no longer takes encrypted apy/loop. Strategy-level
  // params (apyTarget bps, loopCount) live as plaintext on the registry's
  // Strategy struct — set once at `registerStrategy` time. The wrapper
  // signature now takes only the per-position-private inputs. Callers that
  // previously passed apyBps/loopCount should drop them; if they need to
  // register a strategy with explicit params, they should call the
  // registry's 4-arg `registerStrategy(name, hash, apyTarget, loopCount)`
  // overload directly (or use the composer's atomic register+open flow).
  const openPosition = async (
    collateralToken: string,
    collateralAmount: string,
    collateralEth: string,
    debtEth: string,
    strategyId: number,
  ) => {
    const { vault } = requireAddresses();
    const collateral = parseUnits(collateralEth, 18);
    const debt = parseUnits(debtEth, 18);
    const amountWei = parseUnits(collateralAmount, 18);
    validateEuint128(collateral);
    validateEuint128(debt);

    setIsEncrypting(true);
    try {
      const [encColl, encDebt] = await Promise.all([
        encrypt128(collateral),
        encrypt128(debt),
      ]);
      lastEncryptedSupply.current = encColl;
      lastEncryptedBorrow.current = encDebt;
      return writeContractAsync({
        address: vault as `0x${string}`,
        abi: VaultABI,
        functionName: "openPosition",
        args: [
          collateralToken,
          amountWei,
          encColl,
          encDebt,
          BigInt(strategyId),
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
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amt);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "supply",
        args: [token, amt, enc],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  const borrowFromLending = async (
    collateralToken: string,
    borrowToken: string,
    borrowAmount: string,
    decimals = 18,
    ltvNum: bigint = DEFAULT_LTV_NUM,
    ltvDen: bigint = DEFAULT_LTV_DEN,
  ) => {
    const { pool } = requireAddresses();
    const amt = parseUnits(borrowAmount, decimals);
    validateEuint128(amt);
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amt);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "checkLtvAndBorrow",
        args: [collateralToken, borrowToken, amt, enc, ltvNum, ltvDen],
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
    validateEuint128(amountIn);
    validateEuint128(minOut);
    setIsEncrypting(true);
    try {
      const [encIn, encMin] = await Promise.all([
        encrypt128(amountIn),
        encrypt128(minOut),
      ]);
      return writeContractAsync({
        address: router as `0x${string}`,
        abi: RouterABI,
        functionName: "submitSwapIntent",
        args: [tokenIn, tokenOut, encIn, encMin, BigInt(deadlineOffset)],
      });
    } finally {
      setIsEncrypting(false);
    }
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
  const repay = async (amount: bigint): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(amount);
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amount);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "repay",
        args: [amount, enc] as unknown as [bigint, { ctHash: bigint; securityZone: number; utype: number; signature: string }],
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  // TODO: Wire to vault `withdraw` once the ABI exposes a withdraw function.
  // The current StrategyVault ABI does not include a standalone withdraw;
  // withdrawal goes through the LendingPool via `withdrawSupply` above.
  const withdraw = async (amount: bigint): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(amount);
    setIsEncrypting(true);
    try {
      const enc = await encrypt128(amount);
      return writeContractAsync({
        address: pool as `0x${string}`,
        abi: PoolABI,
        functionName: "withdraw",
        args: [amount, enc] as unknown as [bigint, { ctHash: bigint; securityZone: number; utype: number; signature: string }],
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