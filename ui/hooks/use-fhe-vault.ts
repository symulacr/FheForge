import { Encryptable, FheTypes } from "@cofhe/sdk";
import { useMemo, useRef, useState } from "react";
import type { Abi } from "viem";
import { formatUnits, type Hash, parseUnits } from "viem";
import { toast } from "sonner";
import { useAccount, useChainId, useWriteContract } from "wagmi";

import VaultArtifact from "@/abis/StrategyVault.json";

const VaultABI = VaultArtifact as unknown as Abi;

import PoolArtifact from "@/abis/LendingPool.json";

const PoolABI = PoolArtifact as unknown as Abi;

import RouterArtifact from "@/abis/SwapRouter.json";

const RouterABI = RouterArtifact as unknown as Abi;

import { SLIPPAGE_TOLERANCE } from "@/lib/constants";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";
import { getContractAddresses, validateEuint128 } from "@/utils/addresses";

interface EncryptedHandle {
	ctHash: bigint;
	securityZone: number;
	utype: number;
	signature: string;
}

export type EncryptedUint128Input = EncryptedHandle;

// P7: multi-position — position IDs are stored in local state
export type PositionId = `0x${string}`;

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
	// P7: track the user's active position IDs (set when openPosition succeeds)
	const [userPositionIds, setUserPositionIds] = useState<PositionId[]>([]);

	const lastEncryptedSupply = useRef<EncryptedHandle | null>(null);
	const lastEncryptedBorrow = useRef<EncryptedHandle | null>(null);

	const requireAddresses = () => {
		if (!addresses) throw new Error(`Unsupported chain: ${chainId}`);
		return addresses;
	};

	// MC-27: Vault functions (openPosition, closePosition) use InEuint128
	// CoFHE SDK supports Encryptable.uint128() - no truncation risk for euint128 values
	const encrypt128 = async (value: bigint): Promise<EncryptedHandle> => {
		if (!cofheClient) throw new Error("CoFHE client not ready");
		if (!cofheState.permitReady)
			throw new Error("CoFHE permit not ready — please wait or reconnect");
		const handles = (await cofheClient
			.encryptInputs([Encryptable.uint128(value)])
			.execute()) as EncryptedHandle[];
		if (!handles[0]) throw new Error("CoFHE returned empty handle list");
		return handles[0];
	};

	const decryptForView = async (
		handle: EncryptedHandle,
		fheType: typeof FheTypes.Uint128 = FheTypes.Uint128,
	): Promise<string> => {
		if (!cofheClient) throw new Error("CoFHE client not ready");
		if (!cofheState.permitReady)
			throw new Error("CoFHE permit not ready — please wait or reconnect");
		const result = await (
			cofheClient as {
				decryptForView: (
					hash: bigint,
					fheType: typeof FheTypes.Uint128,
				) => { execute: () => Promise<bigint> };
			}
		)
			.decryptForView(handle.ctHash, fheType)
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
		return decryptForView(handle, FheTypes.Uint128);
	};

	const revealSwapIntent = async (encryptedAmount: EncryptedUint128Input): Promise<string> => {
		return decryptForView(encryptedAmount);
	};

	// P7: position ID generated on-chain by contract, tracked via syncUserPositions
	const openPosition = async (
		collateralToken: string,
		collateralAmount: string,
		strategyId: bigint = 0n,
	): Promise<Hash> => {
		const { vault } = requireAddresses();
		const amountWei = parseUnits(collateralAmount, 18);
		validateEuint128(amountWei);

		const userAddr = userAddress;
		if (!userAddr) throw new Error("Wallet not connected");

		setIsEncrypting(true);
		try {
			const encColl = await encrypt128(amountWei);
			lastEncryptedSupply.current = encColl;
			const txHash = await writeContractAsync({
				address: vault as `0x${string}`,
				abi: VaultABI,
				functionName: "openPosition",
				args: [collateralToken, amountWei, encColl, strategyId, userAddr],
			});
			await syncUserPositions();
			return txHash;
		} finally {
			setIsEncrypting(false);
		}
	};

	// P7: addCollateral — positionId falls back to first owned position
	const addCollateral = async (
		collateralToken: string,
		amount: string,
		decimals = 18,
		positionId?: PositionId,
	): Promise<Hash> => {
		const pid = positionId ?? userPositionIds[0];
		if (!pid) throw new Error("No position found — open a position first");
		const { vault } = requireAddresses();
		const amt = parseUnits(amount, decimals);
		validateEuint128(amt);

		const userAddr = userAddress;
		if (!userAddr) throw new Error("Wallet not connected");

		setIsEncrypting(true);
		try {
			const enc = await encrypt128(amt);
			return writeContractAsync({
				address: vault as `0x${string}`,
				abi: VaultABI,
				functionName: "addCollateral",
				args: [pid, collateralToken, amt, enc, userAddr],
			});
		} finally {
			setIsEncrypting(false);
		}
	};

	// MC-07/08: supplyToLending and borrowFromLending REMOVED.
	// These are onlyComposer-gated on LendingPool — user calls revert.
	// Use useComposer().openPosition or useRebalance() instead.

	// MC-23/28: Pool repay uses InEuint64 (renamed from repayBorrow — same function)
	const repay = async (token: string, amount: string, decimals = 18) => {
		const { pool } = requireAddresses();
		const amt = parseUnits(amount, decimals);
		validateEuint128(amt);
		setIsEncrypting(true);
		try {
			const enc = await encrypt128(amt);
			return writeContractAsync({
				address: pool as `0x${string}`,
				abi: PoolABI,
				functionName: "repayDebt",
				args: [token, amt, enc],
			});
		} finally {
			setIsEncrypting(false);
		}
	};

	// MC-28: Pool withdraw uses InEuint64
	const withdrawSupply = async (token: string, amount: string, decimals = 18) => {
		const { pool } = requireAddresses();
		const amt = parseUnits(amount, decimals);
		validateEuint128(amt);
		setIsEncrypting(true);
		try {
			const enc = await encrypt128(amt);
			return writeContractAsync({
				address: pool as `0x${string}`,
				abi: PoolABI,
				functionName: "partialUnshield",
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
			(parseUnits(minOutEth, 18) * BigInt(Math.round((1 - SLIPPAGE_TOLERANCE) * 10000))) / 10000n;

		setIsEncrypting(true);
		try {
			return writeContractAsync({
				address: router as `0x${string}`,
				abi: RouterABI,
				functionName: "submitSwapIntent",
				args: [tokenIn, tokenOut, amountIn, minOut, BigInt(deadlineOffset)],
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to submit swap intent";
			console.error("submitSwapIntent failed:", e);
			toast.error(msg);
			throw e;
		} finally {
			setIsEncrypting(false);
		}
	};
	// P7: closePosition(positionId, collateralAmount, encCollateralAmount)
	const closePosition = async (
		positionId: PositionId,
		collateralAmount: bigint,
		encryptedCollateralAmount: EncryptedUint128Input,
	): Promise<Hash> => {
		const { vault } = requireAddresses();
		setIsEncrypting(true);
		try {
			return writeContractAsync({
				address: vault as `0x${string}`,
				abi: VaultABI,
				functionName: "closePosition",
				args: [positionId, collateralAmount, encryptedCollateralAmount] as unknown as [
					`0x${string}`,
					bigint,
					{
						ctHash: bigint;
						securityZone: number;
						utype: number;
						signature: string;
					},
				],
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to close position";
			console.error("closePosition failed:", e);
			toast.error(msg);
			throw e;
		} finally {
			setIsEncrypting(false);
		}
	};

	// MC-20/28: Pool supplyEth uses InEuint64
	const supplyEth = async (amount: bigint): Promise<Hash> => {
		const { pool } = requireAddresses();
		validateEuint64(amount);
		setIsEncrypting(true);
		try {
			const enc = await encrypt128(amount);
			return writeContractAsync({
				address: pool as `0x${string}`,
				abi: PoolABI,
				functionName: "shieldEth",
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
		setIsEncrypting(true);
		try {
			return writeContractAsync({
				address: pool as `0x${string}`,
				abi: PoolABI,
				functionName: "partialUnshieldEth",
				args: [amount, encAmount],
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to withdraw ETH";
			console.error("withdrawEth failed:", e);
			toast.error(msg);
			throw e;
		} finally {
			setIsEncrypting(false);
		}
	};

	// P7: getUserPositions(user) → bytes32[] — returns all position IDs for a user
	const getUserPositions = async (user: `0x${string}`): Promise<PositionId[]> => {
		const { vault } = requireAddresses();
		if (cofheClient) {
			const raw = (
				cofheClient as unknown as {
					contractView: (
						address: `0x${string}`,
						abi: Abi,
						functionName: string,
						args: unknown[],
					) => { execute: () => Promise<unknown> };
				}
			)
				.contractView(vault, VaultABI, "getUserPositions", [user])
				.execute();
			return (await raw) as PositionId[];
		}
		return [];
	};

	// P7: sync local positionIds from on-chain getUserPositions
	const syncUserPositions = async () => {
		if (!userAddress) return;
		const positions = await getUserPositions(userAddress);
		setUserPositionIds(positions);
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
		revealCollateral,
		revealBorrow,
		revealSwapIntent,
		getUserPositions,
		syncUserPositions,
		userPositionIds,
		isEncrypting,
		isPending,
	};
}
