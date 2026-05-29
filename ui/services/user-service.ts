import type { User } from "@/types/user.interface";
import { API_ENDPOINTS, api } from "./api";

function extractError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
function throwFormatted(err: unknown, context: string): never {
	throw new Error(`${context}: ${extractError(err)}`);
}

export const getCurrentUser = async (
	walletAddress: string,
	useHeader: boolean = false,
): Promise<User> => {
	try {
		if (useHeader) {
			const res = await api.get(API_ENDPOINTS.USERS.ME(), {
				headers: {
					"x-wallet-address": walletAddress,
				},
			});
			return res.data;
		} else {
			const res = await api.get(API_ENDPOINTS.USERS.ME(), {
				params: { walletAddress: walletAddress },
			});
			return res.data;
		}
	} catch (err) {
		throwFormatted(err, "Failed to fetch current user");
	}
};

export const isEvmAccountBound = async (substrateAddress: string) => {
	try {
		const res = await api.get(API_ENDPOINTS.USERS.EVM_BINDING(substrateAddress));
		return res.data;
	} catch (err) {
		throwFormatted(err, "Failed to check EVM account binding");
	}
};

export const getTokenBalance = async (substrateAddress: string, tokenId: string) => {
	try {
		const res = await api.get(API_ENDPOINTS.USERS.BALANCE(substrateAddress, tokenId));
		return res.data;
	} catch (err) {
		throwFormatted(err, "Failed to fetch token balance");
	}
};
