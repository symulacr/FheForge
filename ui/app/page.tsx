"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { SEED_STRATEGIES } from "@/app/constants/seed-strategies";
import { Preloader } from "@/components/preloader";
import { usePreloader } from "@/providers/preloader-provider";
import { getStrategies } from "@/services/defi-module-service";
import { useProtocolStats } from "@/hooks/use-protocol-stats";
import { usePermitCountdown } from "@/hooks/use-permit-countdown";
import { useFheWallet } from "@/hooks/use-fhe-wallet";
import type { Strategy } from "@/types/strategy.interface";
import { BackgroundOrbits } from "@/components/landing/background-orbits";
import { DemoCard } from "@/components/landing/demo-card";
import { Ticker } from "@/components/landing/ticker";

export default function Home() {
	const { show, hide } = usePreloader();
	const router = useRouter();
	const { isConnected } = useAccount();
	const { connectWallet } = useFheWallet();
	const { data: stats } = useProtocolStats();
	const { unlocked, grantPermit } = usePermitCountdown();
	const [demoLocked, setDemoLocked] = useState(true);
	const [revealed, setRevealed] = useState(false);
	const heroRef = useRef<HTMLDivElement>(null);

	// Auto-play cipher cycle when wallet not connected (marketing demo)
	useEffect(() => {
		if (isConnected) return;
		let phase = 0;
		const tick = () => {
			phase = (phase + 1) % 2;
			setDemoLocked(phase === 0);
		};
		const id = setInterval(tick, 6500);
		return () => clearInterval(id);
	}, [isConnected]);

	// Mask-wipe reveal on mount
	useEffect(() => {
		const raf = requestAnimationFrame(() => setRevealed(true));
		return () => cancelAnimationFrame(raf);
	}, []);

	// Cursor-tracking accent glow on hero
	useEffect(() => {
		const el = heroRef.current;
		if (!el) return;
		let rafId = 0;
		const onMove = (e: PointerEvent) => {
			if (rafId) return;
			rafId = requestAnimationFrame(() => {
				const r = el.getBoundingClientRect();
				el.style.setProperty("--mx", `${e.clientX - r.left}px`);
				el.style.setProperty("--my", `${e.clientY - r.top}px`);
				rafId = 0;
			});
		};
		el.addEventListener("pointermove", onMove);
		return () => el.removeEventListener("pointermove", onMove);
	}, []);

	const portfolioLocked = isConnected ? !unlocked : demoLocked;

	const handleTogglePermit = useCallback(() => {
		if (isConnected) {
			grantPermit();
		} else {
			setDemoLocked((l) => !l);
		}
	}, [isConnected, grantPermit]);

	const { data: strategies = [], isFetching } = useQuery<Strategy[]>({
		queryKey: ["home-strategies"],
		queryFn: async () => {
			const data = await getStrategies();
			return data.length > 0 ? data : SEED_STRATEGIES;
		},
	});

	const prevFetching = useRef(isFetching);
	if (isFetching !== prevFetching.current) {
		prevFetching.current = isFetching;
		if (isFetching) show();
		else hide();
	}

	const displayStrategies = useMemo(
		() => (strategies.length > 0 ? strategies : SEED_STRATEGIES),
		[strategies],
	);

	return (
		<>
			<Preloader />
			<main
				style={{
					height: "calc(100vh - 56px)",
					overflow: "hidden",
					display: "flex",
					flexDirection: "column",
					position: "relative",
				}}
			>
				<BackgroundOrbits />
				<section
					ref={heroRef}
					className="hero-cursor"
					style={{
						flex: 1,
						minHeight: 0,
						position: "relative",
						padding: "32px 40px",
						zIndex: 1,
					}}
				>
					<div
						style={{
							maxWidth: 1320,
							margin: "0 auto",
							height: "100%",
							display: "grid",
							gridTemplateColumns: "minmax(0, 1.4fr) minmax(380px, 1fr)",
							gap: 56,
							alignItems: "center",
						}}
						className="home-grid"
					>
						{/* LEFT · headline + actions */}
						<div
							style={{
								opacity: revealed ? 1 : 0,
								transform: revealed ? "translateY(0)" : "translateY(14px)",
								transition: "opacity 600ms var(--ease-custom), transform 600ms var(--ease-custom)",
							}}
						>
							<span
								className="mono"
								style={{
									fontSize: 11,
									color: "var(--muted)",
									letterSpacing: "0.12em",
									textTransform: "uppercase",
								}}
							>
								An encrypted DeFi protocol · Arbitrum Sepolia
							</span>
							<h1
								style={{
									fontSize: "clamp(48px, 5.8vw, 84px)",
									lineHeight: 1.04,
									letterSpacing: -0.022,
									marginTop: 20,
									marginBottom: 24,
									maxWidth: 760,
									fontWeight: 500,
								}}
							>
								Borrow, swap, compound –
								<br />
								<span style={{ fontStyle: "italic" }}>without revealing</span> a number.
							</h1>
							<p
								style={{
									fontSize: 17,
									lineHeight: 1.55,
									color: "var(--foreground-secondary)",
									maxWidth: 540,
									margin: 0,
								}}
							>
								Three things stay encrypted on-chain: your collateral, your debt, every
								step of your strategy. Only you can decrypt them · and only with a
								permit your wallet holds for fifteen minutes at a time.
							</p>

							<div
								className="flex items-center flex-wrap"
								style={{ gap: 12, marginTop: 32 }}
							>
								<button
									className="terminal-btn primary px-5 py-3 text-sm"
									onClick={() => {
										if (isConnected) router.push("/builder");
										else connectWallet();
									}}
								>
									Connect a wallet <span className="ar">→</span>
								</button>
								<button
									className="terminal-btn px-5 py-3 text-sm"
									onClick={() => router.push("/market")}
								>
									Explore strategies
								</button>
							</div>

							<div
								className="flex items-center flex-wrap"
								style={{ gap: 18, marginTop: 28, color: "var(--muted)" }}
							>
								<span
									className="mono"
									style={{ fontSize: 11, letterSpacing: "0.06em" }}
								>
									no read access to your balances
								</span>
								<span>·</span>
								<span
									className="mono"
									style={{ fontSize: 11, letterSpacing: "0.06em" }}
								>
									no transaction without a signature
								</span>
							</div>
						</div>

						{/* RIGHT · live permit demo */}
						<div
							style={{
								opacity: revealed ? 1 : 0,
								transform: revealed ? "translateY(0)" : "translateY(14px)",
								transition:
									"opacity 600ms var(--ease-custom) 150ms, transform 600ms var(--ease-custom) 150ms",
							}}
						>
							<DemoCard locked={portfolioLocked} onToggle={handleTogglePermit} />
						</div>
					</div>
				</section>

				<Ticker stats={stats ?? null} />
			</main>
		</>
	);
}
