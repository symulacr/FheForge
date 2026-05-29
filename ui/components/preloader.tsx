"use client";

import { useCallback, useRef } from "react";
import { PRELOADER_DURATION, PRELOADER_HIDE_DELAY } from "@/lib/constants";
import { usePreloader } from "@/providers/preloader-provider";

export function Preloader() {
	const { visible, hide } = usePreloader();
	const barRef = useRef<HTMLDivElement>(null);
	const pctRef = useRef<HTMLSpanElement>(null);
	const rafRef = useRef<number>(0);
	const hideRef = useRef(hide);
	hideRef.current = hide;

	const containerCallbackRef = useCallback((node: HTMLDivElement | null) => {
		if (node) {
			let start: number | null = null;
			const duration = PRELOADER_DURATION;

			const tick = (ts: number) => {
				if (!start) start = ts;
				const p = Math.min((ts - start) / duration, 1);
				if (barRef.current) barRef.current.style.width = `${p * 100}%`;
				if (pctRef.current) pctRef.current.textContent = `${Math.round(p * 100)}%`;
				if (p < 1) {
					rafRef.current = requestAnimationFrame(tick);
				} else {
					setTimeout(hideRef.current, PRELOADER_HIDE_DELAY);
				}
			};

			rafRef.current = requestAnimationFrame(tick);
		} else {
			cancelAnimationFrame(rafRef.current);
		}
	}, []);

	if (!visible) return null;

	return (
		<div
			ref={containerCallbackRef}
			className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background"
		>
			<div className="w-64 space-y-3 font-mono">
				<div className="text-xs text-muted mb-4">
					<span className="text-accent">$</span> init fheforge...
				</div>

				<div className="h-px bg-border w-full overflow-hidden">
					<div ref={barRef} className="h-full bg-accent transition-none" style={{ width: "0%" }} />
				</div>

				<div className="flex justify-between text-xs text-muted">
					<span>loading</span>
					<span ref={pctRef}>0%</span>
				</div>
			</div>
		</div>
	);
}
