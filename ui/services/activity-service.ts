import { AxiosError } from "axios";
import { api, API_ENDPOINTS } from "./api";
import type {
  ActivityFilter,
  CreateActivityPayload,
  UpdateActivityPayload,
} from "@/types/activity.interface";
import { DEFAULT_PAGE_LIMIT } from "@/lib/constants";

function extractError(err: unknown, fallback: string) {
  if (err instanceof AxiosError) {
    return err.response?.data || err.message || fallback;
  }
  if (err && typeof err === "object") {
    const e = err as { response?: { data?: unknown }; message?: string };
    return e.response?.data || e.message || fallback;
  }
  return fallback;
}

function throwFormatted(err: unknown, fallback: string) {
  const raw = extractError(err, fallback);
  const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
  throw new Error(msg);
}

export async function getActivities(
  filter?: ActivityFilter,
  options?: { signal?: AbortSignal },
) {
  try {
    const res = await api.get(API_ENDPOINTS.ACTIVITIES.LIST(filter), {
      signal: options?.signal,
    });
    return res.data || [];
  } catch (err) {
    throwFormatted(err, "Failed to fetch activities");
  }
}

export async function getActivitiesWithPagination(params?: {
  strategyId?: string;
  userAddress?: string;
  page?: number;
  limit?: number;
  signal?: AbortSignal;
}) {
  try {
    const res = await api.get(API_ENDPOINTS.ACTIVITIES.LIST(), {
      params: {
        strategyId: params?.strategyId,
        userAddress: params?.userAddress,
        page: params?.page ?? 1,
        limit: params?.limit ?? DEFAULT_PAGE_LIMIT,
      },
      signal: params?.signal,
    });

    return res.data;
  } catch (err) {
    throwFormatted(err, "Failed to fetch paginated activities");
  }
}

export async function getActivityById(id: string) {
  try {
    const res = await api.get(API_ENDPOINTS.ACTIVITIES.GET(id));
    return res.data;
  } catch (err) {
    throwFormatted(err, "Failed to fetch activity");
  }
}

export async function createActivity(payload: CreateActivityPayload) {
  try {
    const res = await api.post(API_ENDPOINTS.ACTIVITIES.CREATE(), payload);
    return res.data;
  } catch (err) {
    throwFormatted(err, "Failed to create activity");
  }
}

export async function updateActivity(
  id: string,
  payload: UpdateActivityPayload,
) {
  try {
    const res = await api.put(API_ENDPOINTS.ACTIVITIES.RESUME(id), payload);
    return res.data;
  } catch (err) {
    throwFormatted(err, "Failed to update activity progress");
  }
}
