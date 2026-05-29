import { API_ENDPOINTS, api } from "./api";

export const fetchStrategies = async () => {
	try {
		const res = await api.get(API_ENDPOINTS.STRATEGIES.LIST());
		return res.data;
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : "Failed to fetch strategies";
		throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
	}
};

// Fetch single strategy by ID
export const getStrategy = async (id: string) => {
	try {
		const res = await api.get(API_ENDPOINTS.STRATEGIES.GET(id));
		return res.data;
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : "Failed to fetch strategy";
		throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
	}
};
