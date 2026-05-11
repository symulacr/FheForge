import { useWriteContract, useChainId, usePublicClient } from "wagmi";
import type { Abi } from "viem";
import { Encryptable } from "@cofhe/sdk";
import { parseUnits, type Address, type Hash } from "viem";
import { useMemo, useState, useCallback } from "react";
import PoolArtifact from "@/abis/LendingPool.json";
const PoolABI = PoolArtifact.abi as unknown as Abi;
import PriceOracleArtifact from "@/abis/PriceOracle.json";
const PriceOracleABI = PriceOracleArtifact.abi as unknown as Abi;

import { getContractAddresses, validateEuint128 } from "@/utils/addresses";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";

export interface EncryptedHandle {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: string;
}

// P2: proof-based liquidation
export interface LiquidateWithProofParams {
  user: Address;
  collateralToken: Address;
  debtToken: Address;
  debtToCover: bigint;
  debtBalanceProof: bigint; // decrypted borrow balance
  debtSig: `0x${string}`;
  supplyBalanceProof: bigint; // decrypted collateral supply balance
  supplySig: `0x${string}`;
}

// P5: pending contract update — stub until contract ABI is synced
// export const requestUnshield = ...
// export const unshieldWithProof = ...
// export const requestBorrowReveal = ...


export function useLendingActions() {
  const cofheClient = useCofheClient();
  const cofheState = useCofheState();
  const { writeContractAsync, isPending } = useWriteContract();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const addresses = useMemo(() => {
    try {
      return getContractAddresses(chainId);
    } catch {
      return null;
    }
  }, [chainId]);

  const [isEncrypting, setIsEncrypting] = useState(false);

  const requireAddresses = () => {
    if (!addresses) throw new Error(`Unsupported chain: ${chainId}`);
    return addresses;
  };

  // encrypt input for uint128 borrow amounts
  const encrypt = async (value: bigint): Promise<EncryptedHandle> => {
    if (!cofheClient) throw new Error("CoFHE client not ready");
    if (!cofheState.permitReady)
      throw new Error("CoFHE permit not ready — please wait or reconnect");
    const handles = (await cofheClient
      .encryptInputs([Encryptable.uint128(value)])
      .execute()) as EncryptedHandle[];
    if (!handles[0]) throw new Error("CoFHE returned empty handle list");
    return handles[0];
  };

  // ────────── MC-36: liquidate ──────────

  const liquidate = async (
    user: Address,
    collateralToken: Address,
    debtToken: Address,
    debtToCover: bigint,
  ): Promise<Hash> => {
    const { pool } = requireAddresses();
    return writeContractAsync({
      address: pool as `0x${string}`,
      abi: PoolABI,
      functionName: "liquidate",
      args: [user, collateralToken, debtToken, debtToCover],
    });
  };

  // ────────── P2: requestLiquidationCheck ──────────

  const requestLiquidationCheck = async (
    user: Address,
    collateralToken: Address,
    debtToken: Address,
  ): Promise<Hash> => {
    const { pool } = requireAddresses();
    return writeContractAsync({
      address: pool as `0x${string}`,
      abi: PoolABI,
      functionName: "requestLiquidationCheck",
      args: [user, collateralToken, debtToken],
    });
  };

  // ────────── P2: liquidateWithProof ──────────

  const liquidateWithProof = async (params: LiquidateWithProofParams): Promise<Hash> => {
    const { pool } = requireAddresses();
    return writeContractAsync({
      address: pool as `0x${string}`,
      abi: PoolABI,
      functionName: "liquidateWithProof",
      args: [
        params.user,
        params.collateralToken,
        params.debtToken,
        params.debtToCover,
        params.debtBalanceProof,
        params.debtSig,
        params.supplyBalanceProof,
        params.supplySig,
      ],
    });
  };

  // ────────── MC-37: checkLtvAndBorrow ──────────

  const checkLtvAndBorrow = async (
    collateralToken: Address,
    borrowToken: Address,
    borrowAmount: bigint,
    encBorrowAmount: EncryptedHandle,
    ltvNum: bigint,
    ltvDen: bigint,
  ): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(borrowAmount);
    return writeContractAsync({
      address: pool as `0x${string}`,
      abi: PoolABI,
      functionName: "checkLtvAndBorrow",
      args: [collateralToken, borrowToken, borrowAmount, encBorrowAmount, ltvNum, ltvDen],
    });
  };

  // ────────── MC-38: borrowWithOracle ──────────

  const borrowWithOracle = async (
    collateralToken: Address,
    borrowToken: Address,
    borrowAmount: bigint,
    encBorrowAmount: EncryptedHandle,
  ): Promise<Hash> => {
    const { pool } = requireAddresses();
    validateEuint128(borrowAmount);
    return writeContractAsync({
      address: pool as `0x${string}`,
      abi: PoolABI,
      functionName: "borrowWithOracle",
      args: [collateralToken, borrowToken, borrowAmount, encBorrowAmount],
    });
  };

  // ────────── MC-44: emergencyWithdraw (only when paused) ──────────

  const emergencyWithdraw = async (token: Address): Promise<Hash> => {
    const { pool } = requireAddresses();
    return writeContractAsync({
      address: pool as `0x${string}`,
      abi: PoolABI,
      functionName: "emergencyWithdraw",
      args: [token],
    });
  };

  // ────────── MC-45: isSupported (PriceOracle read) ──────────

  const isSupported = async (token: Address): Promise<boolean> => {
    if (!publicClient) throw new Error("Public client not available");
    const { oracle } = requireAddresses();

    const result = await publicClient.readContract({
      address: oracle,
      abi: PriceOracleABI,
      functionName: "isSupported",
      args: [token],
    });

    return result as boolean;
  };

  // ────────── Convenience: encrypt + borrow helpers ──────────

  const checkLtvAndBorrowWithEncrypt = async (
    collateralToken: Address,
    borrowToken: Address,
    borrowAmount: string,
    decimals: number,
    ltvNum: bigint,
    ltvDen: bigint,
  ): Promise<Hash> => {
    const amt = parseUnits(borrowAmount, decimals);
    validateEuint128(amt);
    setIsEncrypting(true);
    try {
      const enc = await encrypt(amt);
      return checkLtvAndBorrow(collateralToken, borrowToken, amt, enc, ltvNum, ltvDen);
    } finally {
      setIsEncrypting(false);
    }
  };

  const borrowWithOracleWithEncrypt = async (
    collateralToken: Address,
    borrowToken: Address,
    borrowAmount: string,
    decimals: number,
  ): Promise<Hash> => {
    const amt = parseUnits(borrowAmount, decimals);
    validateEuint128(amt);
    setIsEncrypting(true);
    try {
      const enc = await encrypt(amt);
      return borrowWithOracle(collateralToken, borrowToken, amt, enc);
    } finally {
      setIsEncrypting(false);
    }
  };

  return {
    liquidate,
    requestLiquidationCheck,
    liquidateWithProof,
    checkLtvAndBorrow,
    borrowWithOracle,
    emergencyWithdraw,
    isSupported,
    checkLtvAndBorrowWithEncrypt,
    borrowWithOracleWithEncrypt,
    encrypt,
    isEncrypting,
    isPending,
  };
}