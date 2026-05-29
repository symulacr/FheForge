import { useMemo } from "react";
import type { Abi, Hash } from "viem";
import { useChainId, useWriteContract } from "wagmi";
import ComposerArtifact from "@/abis/FheForgeComposer.json";

const ComposerABI = ComposerArtifact as unknown as Abi;

import { Encryptable } from "@cofhe/sdk";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";
import { getContractAddresses } from "@/utils/addresses";

interface InEuint128 {
	ctHash: bigint;
	securityZone: number;
	utype: number;
	signature: string;
}

export interface OpenStrategyParams {
	strategyName: string;
	workflowHash: string;
	collateralToken: string;
	collateralAmount: bigint;
	poolSupplyAmount: bigint;
	borrowToken: string;
	poolBorrowAmount: bigint;
	useOracleBorrow: boolean;
	ltvNum: bigint;
	ltvDen: bigint;
	swapTokenOut: string;
	swapDeadlineOffset: bigint;
	strategyId: bigint;
	apyTarget: number;
	loopCount: number;
	swapAmountIn: bigint;
	swapMinOut: bigint;
}

export interface OpenStrategyEncrypted {
	collateral: InEuint128;
	supplyEnc: InEuint128;
	borrowEnc: InEuint128;
}

export function useComposer() {
	const cofheClient = useCofheClient();
	const cofheState = useCofheState();
	const { writeContractAsync, isPending } = useWriteContract();
	const chainId = useChainId();

	const composerAddress = useMemo(() => {
		try {
			return getContractAddresses(chainId).composer;
		} catch {
			return undefined;
		}
	}, [chainId]);

	// MC-27: Composer collateral uses InEuint128
	const encrypt128 = async (value: bigint): Promise<InEuint128> => {
		if (!cofheClient) throw new Error("CoFHE client not ready");
		if (!cofheState.permitReady) throw new Error("CoFHE permit not ready");
		const handles = (await cofheClient
			.encryptInputs([Encryptable.uint128(value)])
			.execute()) as InEuint128[];
		if (!handles[0]) throw new Error("CoFHE returned empty handle list");
		return handles[0];
	};

	// R7: WORKAROUND — do NOT use setAccount(composerAddress) for cross-contract calls.
	// On arb-sepolia, the TaskManager has a stale ZK verifier key (slot 4 = 0x013a19c34...).
	// setAccount(contract) causes InvalidSigner because the contract-account signing key doesn't match.
	// Without setAccount, the default account = user wallet, which uses the old key matching slot 4.
	// The TaskManager does NOT enforce account == msg.sender for FHE.asEuint128.
	// See: contracts/ZK_VERIFIER_ROOT_CAUSE.md
	const encrypt128ForComposer = async (value: bigint): Promise<InEuint128> => {
		if (!cofheClient) throw new Error("CoFHE client not ready");
		if (!cofheState.permitReady) throw new Error("CoFHE permit not ready");
		// NOTE: No setAccount — workaround for stale ZK verifier key on arb-sepolia
		const handles = (await cofheClient
			.encryptInputs([Encryptable.uint128(value)])
			.execute()) as InEuint128[];
		if (!handles[0]) throw new Error("CoFHE returned empty handle list");
		return handles[0];
	};

	const openPosition = async (
		params: OpenStrategyParams,
		encrypted: OpenStrategyEncrypted,
	): Promise<Hash> => {
		if (!composerAddress) throw new Error("Composer address not configured");
		if (!cofheState.permitReady) throw new Error("CoFHE permit not ready");

		return writeContractAsync({
			address: composerAddress,
			abi: ComposerABI,
			functionName: "openPosition",
			args: [params, encrypted] as unknown as [OpenStrategyParams, OpenStrategyEncrypted],
		});
	};

	return {
		openPosition,
		composerAddress,
		isPending,
		encrypt128,
		encrypt128ForComposer,
	};
}
