import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/services/user-service";
import { User } from "@/types/user.interface";
import { QUERY_STALE_TIME_LONG, DEFAULT_RETRY_COUNT } from "@/lib/constants";

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
