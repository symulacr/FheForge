"use client";

import { useQuery } from "@tanstack/react-query";
import { api, API_ENDPOINTS } from "@/services/api";

export interface Market {
	asset: string;
	tokenAddress: string;
	supplyAPY: number;
	borrowAPY: number;
	utilization: number;
	tvl: number;
	liquidationThreshold: number;
	oraclePrice: number;
	totalSupplied: number;
	totalBorrowed: number;
}

export const MARKETS_QUERY_KEY = "markets";

export function useMarkets() {
	return useQuery<Market[]>({
		queryKey: [MARKETS_QUERY_KEY],
		queryFn: async () => {
			const res = await api.get<Market[]>(API_ENDPOINTS.MARKETS.LIST());
			return res.data;
		},
		staleTime: 30_000,
		refetchInterval: 60_000,
		retry: 2,
	});
}
