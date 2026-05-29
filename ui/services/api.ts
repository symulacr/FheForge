import type { AxiosResponse } from "axios";
import axios from "axios";
import { API_TIMEOUT } from "@/lib/constants";
import type { ActivityFilter } from "@/types/activity.interface";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const api = axios.create({
	baseURL: API_BASE_URL,
	timeout: API_TIMEOUT,
	headers: {
		"Content-Type": "application/json",
		Accept: "application/json",
	},
});

export const API_ENDPOINTS = {
	STRATEGIES: {
		LIST: () => `/strategies`,
		GET: (id: string) => `/strategies/${id}`,
		UPDATE: (id: string) => `/strategies/${id}`,
		SIMULATE: (id: string) => `/strategies/${id}/simulate`,
	},

	ACTIVITIES: {
		LIST: (filter?: ActivityFilter) => {
			const params = new URLSearchParams();
			if (filter?.userAddress) params.append("userAddress", filter.userAddress);
			if (filter?.strategyId) params.append("strategyId", filter.strategyId);

			return `/activities?${params.toString()}`;
		},
		GET: (id: string) => `/activities/${id}`,
		CREATE: () => `/activities`,
		UPDATE_PROGRESS: () => `/activities/progress`,
		RESUME: (id: string) => `/activities/progress/${id}`,
	},

	USERS: {
		ME: () => `/users/me`,
		EVM_BINDING: (substrateAddress: string) => `/users/evm-binding/${substrateAddress}`,
		BALANCE: (substrateAddress: string, tokenId: string) =>
			`/users/balance/${substrateAddress}/${tokenId}`,
	},
};

// Typed API wrappers for safer consumption
export interface ApiError {
	message: string;
	code?: string;
	details?: unknown;
}

export type ApiResponse<T> = {
	data: T;
	status: number;
	statusText: string;
};

// Simple typed fetch helper
export async function fetchApi<T>(endpoint: string): Promise<ApiResponse<T>> {
	const res: AxiosResponse<T> = await api.get<T>(endpoint);
	return {
		data: res.data,
		status: res.status,
		statusText: res.statusText,
	};
}
