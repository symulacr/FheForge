import { api } from "./api";

export interface ProtocolStats {
	tvlUsd: number;
	totalUsers: number;
	activeMarkets: number;
	activeStrategies: number;
	encryptedOps: number;
	permitDecryptsDay: number;
	totalDeployments: number;
	poolTvls: {
		USDC: number;
		ETH: number;
		WBTC: number;
	};
}

export const getProtocolStats = async (): Promise<ProtocolStats> => {
	const res = await api.get<ProtocolStats>("/stats");
	return res.data;
};
