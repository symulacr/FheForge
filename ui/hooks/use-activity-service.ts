import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getActivities,
  getActivitiesWithPagination,
  createActivity,
  updateActivity,
} from "@/services/activity-service";
import type {
  ActivityFilter,
  CreateActivityPayload,
  UpdateActivityPayload,
} from "@/types/activity.interface";
import { DEFAULT_PAGE_LIMIT } from "@/lib/constants";

export const ACTIVITIES_QUERY_KEY = "activities";

export function useActivities(filter?: ActivityFilter) {
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: [ACTIVITIES_QUERY_KEY, filter],
    queryFn: () => getActivities(filter),
    enabled: !!filter?.userAddress,
  });

  return {
    data,
    isLoading,
    error,
    isValidating: isFetching,
  };
}

interface UsePaginatedActivitiesParams {
  page: number;
  limit: number;
  userAddress?: string;
}

export function usePaginatedActivities({
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
  userAddress,
}: UsePaginatedActivitiesParams) {
  const { data, isLoading, error } = useQuery({
    queryKey: [ACTIVITIES_QUERY_KEY, "paginated", userAddress, page, limit],
    queryFn: () =>
      getActivitiesWithPagination({
        userAddress,
        page,
        limit,
      }),
    enabled: !!userAddress,
    staleTime: 2000,
    refetchOnWindowFocus: false,
  });

  const activities = Array.isArray(data) ? data : data?.data || [];
  const total = Array.isArray(data) ? data.length : data?.total || 0;

  return {
    activities,
    total,
    loading: isLoading,
    error: error ? "Failed to load activities" : null,
  };
}

export function useCreateActivity() {
  const queryClient = useQueryClient();

  const { mutateAsync, isPending, error, data } = useMutation({
    mutationFn: (payload: CreateActivityPayload) => createActivity(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ACTIVITIES_QUERY_KEY] });
    },
  });

  return {
    mutateAsync,
    isPending,
    isMutating: isPending,
    error,
    data,
  };
}

export function useUpdateActivity() {
  const queryClient = useQueryClient();

  const { mutateAsync, isPending, error, data } = useMutation({
    mutationFn: ({
      activityId,
      payload,
    }: {
      activityId: string;
      payload: UpdateActivityPayload;
    }) => updateActivity(activityId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ACTIVITIES_QUERY_KEY] });
    },
  });

  return {
    mutateAsync,
    isPending,
    isMutating: isPending,
    error,
    data,
  };
}
