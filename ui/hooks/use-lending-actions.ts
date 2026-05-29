import { Encryptable } from "@cofhe/sdk";
import { useMemo, useState } from "react";
import type { Abi } from "viem";
import { type Address, type Hash, parseUnits } from "viem";
import { useChainId, usePublicClient, useWriteContract } from "wagmi";
import PoolArtifact from "@/abis/LendingPool.json";

const PoolABI = PoolArtifact as unknown as Abi;

import PriceOracleArtifact from "@/abis/PriceOracle.json";

const PriceOracleABI = PriceOracleArtifact as unknown as Abi;

import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";
import { getContractAddresses, validateEuint128 } from "@/utils/addresses";

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

// V3-2: Unshield lifecycle (requestUnshield → unshieldWithProof)
// V3-3: Borrow reveal (requestBorrowReveal)

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

	// ────────── P2: requestLiquidityCheck ──────────

	const requestLiquidityCheck = async (
		user: Address,
		collateralToken: Address,
		debtToken: Address,
	): Promise<Hash> => {
		if (!cofheClient) throw new Error("CoFHE client not ready");
		if (!cofheState.permitReady)
			throw new Error("CoFHE permit not ready — please wait or reconnect");
		const { pool } = requireAddresses();
		return writeContractAsync({
			address: pool as `0x${string}`,
			abi: PoolABI,
			functionName: "requestLiquidityCheck",
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

	// ────────── P2: prepareLiquidationProof (decryptForTx helper) ──────────

	const prepareLiquidationProof = async (
		user: Address,
		debtToken: Address,
		collateralToken: Address,
	): Promise<LiquidateWithProofParams> => {
		if (!cofheClient) throw new Error("CoFHE client not ready");
		if (!cofheState.permitReady)
			throw new Error("CoFHE permit not ready — please wait or reconnect");

		const { pool } = requireAddresses();
		const permit = await cofheClient.permits.getOrCreateSelfPermit();

		// Read encrypted balances from the pool contract
		const debtHandle = await cofheClient.decryptForTx(user, debtToken, pool, {
			permit,
		});
		const supplyHandle = await cofheClient.decryptForTx(user, collateralToken, pool, {
			permit,
		});

		return {
			user,
			collateralToken,
			debtToken,
			debtToCover: BigInt(debtHandle.plaintext ?? 0),
			debtBalanceProof: BigInt(debtHandle.proof ?? 0),
			debtSig: debtHandle.signature as `0x${string}`,
			supplyBalanceProof: BigInt(supplyHandle.proof ?? 0),
			supplySig: supplyHandle.signature as `0x${string}`,
		};
	};

	// ────────── MC-37: borrowWithLtvCheck ──────────

	const borrowWithLtvCheck = async (
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
			functionName: "borrowWithLtvCheck",
			args: [collateralToken, borrowToken, borrowAmount, encBorrowAmount, ltvNum, ltvDen],
		});
	};

	// ────────── MC-38: borrowWithOracle ──────────

	const borrowWithOracle = async (
		collateralToken: Address,
		borrowToken: Address,
		collateralAmount: bigint,
		borrowAmount: bigint,
		encBorrowAmount: EncryptedHandle,
	): Promise<Hash> => {
		const { pool } = requireAddresses();
		validateEuint128(collateralAmount);
		validateEuint128(borrowAmount);
		return writeContractAsync({
			address: pool as `0x${string}`,
			abi: PoolABI,
			functionName: "borrowWithOracle",
			args: [collateralToken, borrowToken, collateralAmount, borrowAmount, encBorrowAmount],
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

	const borrowWithLtvCheckWithEncrypt = async (
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
			return borrowWithLtvCheck(collateralToken, borrowToken, amt, enc, ltvNum, ltvDen);
		} finally {
			setIsEncrypting(false);
		}
	};

	const borrowWithOracleWithEncrypt = async (
		collateralToken: Address,
		borrowToken: Address,
		collateralAmount: string,
		borrowAmount: string,
		decimals: number,
	): Promise<Hash> => {
		const colAmt = parseUnits(collateralAmount, decimals);
		const amt = parseUnits(borrowAmount, decimals);
		validateEuint128(colAmt);
		validateEuint128(amt);
		setIsEncrypting(true);
		try {
			const enc = await encrypt(amt);
			return borrowWithOracle(collateralToken, borrowToken, colAmt, amt, enc);
		} finally {
			setIsEncrypting(false);
		}
	};
	// ────────── V3-2: requestUnshield ──────────

	const requestUnshield = async (token: Address): Promise<Hash> => {
		const { pool } = requireAddresses();
		return writeContractAsync({
			address: pool as `0x${string}`,
			abi: PoolABI,
			functionName: "requestUnshield",
			args: [token],
		});
	};

	// ────────── V3-2: unshieldWithProof ──────────

	const unshieldWithProof = async (
		token: Address,
		balanceProof: bigint,
		balanceSig: `0x${string}`,
	): Promise<Hash> => {
		const { pool } = requireAddresses();
		return writeContractAsync({
			address: pool as `0x${string}`,
			abi: PoolABI,
			functionName: "unshieldWithProof",
			args: [token, balanceProof, balanceSig],
		});
	};

	// ────────── V3-3: requestBorrowReveal ──────────

	const requestBorrowReveal = async (token: Address): Promise<Hash> => {
		const { pool } = requireAddresses();
		return writeContractAsync({
			address: pool as `0x${string}`,
			abi: PoolABI,
			functionName: "requestBorrowReveal",
			args: [token],
		});
	};

	return {
		requestLiquidityCheck,
		liquidateWithProof,
		prepareLiquidationProof,
		borrowWithLtvCheck,
		borrowWithOracle,
		isSupported,
		borrowWithLtvCheckWithEncrypt,
		borrowWithOracleWithEncrypt,
		encrypt,
		requestUnshield,
		unshieldWithProof,
		requestBorrowReveal,
		isEncrypting,
		isPending,
	};
}
