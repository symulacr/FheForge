"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

const swrConfig = {
	dedupingInterval: 2000,
	revalidateOnFocus: false,
	revalidateOnReconnect: true,
	refreshInterval: 0,
	errorRetryCount: 3,
	errorRetryInterval: 5000,
	loadingTimeout: 3000,
	shouldRetryOnError: true,
};

export function SwrProvider({ children }: { children: ReactNode }) {
	return <SWRConfig value={swrConfig}>{children}</SWRConfig>;
}
