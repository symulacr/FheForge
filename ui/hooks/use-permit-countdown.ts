"use client";

import { useCallback, useEffect, useState } from "react";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";

export interface UsePermitCountdownReturn {
	unlocked: boolean;
	secondsLeft: number;
	grantPermit: () => Promise<void>;
}

export function usePermitCountdown(): UsePermitCountdownReturn {
	const { permitReady } = useCofheState();
	const cofheClient = useCofheClient();
	const [secondsLeft, setSecondsLeft] = useState(0);

	// Initialize countdown when permit becomes ready
	useEffect(() => {
		if (permitReady) {
			setSecondsLeft(15 * 60); // 15 minutes
		} else {
			setSecondsLeft(0);
		}
	}, [permitReady]);

	// Decrement every second
	useEffect(() => {
		if (secondsLeft <= 0) return;

		const interval = setInterval(() => {
			setSecondsLeft((prev) => Math.max(0, prev - 1));
		}, 1000);

		return () => clearInterval(interval);
	}, [secondsLeft]);

	const grantPermit = useCallback(async () => {
		if (!cofheClient) return;
		try {
			await cofheClient.permits.getOrCreateSelfPermit();
			setSecondsLeft(15 * 60);
		} catch (err) {
			// Permit failed — will be surfaced via CofheState error
			console.error("Permit grant failed:", err);
		}
	}, [cofheClient]);

	return { unlocked: permitReady && secondsLeft > 0, secondsLeft, grantPermit };
}
