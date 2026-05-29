import { useQuery } from "@tanstack/react-query";
import { DEFAULT_RETRY_COUNT, QUERY_STALE_TIME_LONG } from "@/lib/constants";
import { getCurrentUser } from "@/services/user-service";
import type { User } from "@/types/user.interface";

export const useCurrentUser = (
	walletAddress: string | undefined,
	options?: {
		enabled?: boolean;
		useHeader?: boolean;
	},
) => {
	return useQuery<User, Error>({
		queryKey: ["user", "me", walletAddress],
		queryFn: () => getCurrentUser(walletAddress!, options?.useHeader),
		enabled: !!walletAddress && options?.enabled !== false,
		staleTime: QUERY_STALE_TIME_LONG,
		retry: DEFAULT_RETRY_COUNT,
	});
};
