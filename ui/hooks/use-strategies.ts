import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStrategiesByOwner } from "@/services/defi-module-service";
import { displayToast } from "@/components/shared/toast-manager";
import { DefiStrategy } from "@/types/defi.strategy";

export const useStrategies = (ownerId?: string) => {
  const queryClient = useQueryClient();

  const { data, error, isLoading } = useQuery<DefiStrategy[]>({
    queryKey: ["strategies", ownerId],
    queryFn: async () => {
      const data = await getStrategiesByOwner(ownerId!);
      return data as DefiStrategy[];
    },
    enabled: !!ownerId,
  });

  if (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to fetch strategies";
    displayToast("error", msg);
  }

  return {
    strategies: data || [],
    loading: isLoading,
    error: error
      ? error instanceof Error
        ? error.message
        : "Failed to fetch strategies"
      : null,
    refetch: () =>
      queryClient.invalidateQueries({ queryKey: ["strategies", ownerId] }),
    isEmpty: !isLoading && !error && (data || []).length === 0,
  };
};
