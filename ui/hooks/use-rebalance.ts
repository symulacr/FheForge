import type { Abi, Hash } from "viem";
import { useChainId, useWriteContract } from "wagmi";
import FheForgeComposerArtifact from "@/abis/FheForgeComposer.json";

const FheForgeComposerAbi = FheForgeComposerArtifact as unknown as Abi;

import { Encryptable } from "@cofhe/sdk";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";
import { getContractAddresses } from "@/utils/addresses";

export interface RebalanceParams {
	positionId: `0x${string}`; // P7: multi-position — bytes32 positionId is first field
	collateralToken: `0x${string}`;
	addCollateralAmount: bigint;
	repayAmount: bigint;
	repayToken: `0x${string}`;
	newBorrowAmount: bigint;
	borrowToken: `0x${string}`;
	useOracleBorrow: boolean;
	ltvNum: bigint;
	ltvDen: bigint;
}

export interface InEuint128 {
	ctHash: bigint;
	securityZone: number;
	utype: number;
	signature: `0x${string}`;
}

export interface RebalanceEncrypted {
	addCollateralEnc: InEuint128;
	repayEnc: InEuint128;
	newBorrowEnc: InEuint128;
}

export function useRebalance() {
	const chainId = useChainId();
	const cofheClient = useCofheClient();
	const { permitReady } = useCofheState();
	const { writeContractAsync, isPending } = useWriteContract();

	const encryptRebalanceParams = async (params: RebalanceParams): Promise<RebalanceEncrypted> => {
		if (!cofheClient) throw new Error("CoFHE client not ready");
		if (!permitReady) throw new Error("CoFHE permit not ready");

		const addCollateralEnc = (await cofheClient
			.encryptInputs([Encryptable.uint128(params.addCollateralAmount)])
			.execute()) as InEuint128[];
		if (!addCollateralEnc[0])
			throw new Error("CoFHE returned empty handle for addCollateralAmount");

		const repayEnc = (await cofheClient
			.encryptInputs([Encryptable.uint128(params.repayAmount)])
			.execute()) as InEuint128[];
		if (!repayEnc[0]) throw new Error("CoFHE returned empty handle for repayAmount");

		const newBorrowEnc = (await cofheClient
			.encryptInputs([Encryptable.uint128(params.newBorrowAmount)])
			.execute()) as InEuint128[];
		if (!newBorrowEnc[0]) throw new Error("CoFHE returned empty handle for newBorrowAmount");

		return {
			addCollateralEnc: addCollateralEnc[0],
			repayEnc: repayEnc[0],
			newBorrowEnc: newBorrowEnc[0],
		};
	};

	const rebalance = async (
		params: RebalanceParams,
		encrypted: RebalanceEncrypted,
	): Promise<Hash> => {
		if (!permitReady) {
			throw new Error("CoFHE permit not ready");
		}

		const addresses = getContractAddresses(chainId);

		return writeContractAsync({
			address: addresses.composer,
			abi: FheForgeComposerAbi,
			functionName: "rebalance",
			args: [params, encrypted] as [RebalanceParams, RebalanceEncrypted],
		});
	};

	const rebalanceWithEncrypt = async (params: RebalanceParams): Promise<Hash> => {
		const encrypted = await encryptRebalanceParams(params);
		return rebalance(params, encrypted);
	};

	return { rebalance, rebalanceWithEncrypt, encryptRebalanceParams, isPending };
}
