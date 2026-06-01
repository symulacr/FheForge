"use client";

import { useQuery } from "@tanstack/react-query";
import { getProtocolStats, type ProtocolStats } from "@/services/stats-service";

export const STATS_QUERY_KEY = "protocol-stats";

export function useProtocolStats() {
	return useQuery<ProtocolStats>({
		queryKey: [STATS_QUERY_KEY],
		queryFn: getProtocolStats,
		staleTime: 60_000,
		refetchInterval: 300_000,
		retry: 2,
	});
}
