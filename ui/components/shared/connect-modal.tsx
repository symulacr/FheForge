"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { api } from "@/services/api";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";

const CM_KEY = "fheforge:connect:step";

interface WalletOption {
	id: string;
	name: string;
	sub: string;
}

const WALLETS: WalletOption[] = [
	{ id: "injected", name: "MetaMask", sub: "Browser extension" },
	{ id: "coinbaseWallet", name: "Coinbase", sub: "Browser / Mobile" },
	{ id: "walletConnect", name: "WalletConnect", sub: "Mobile pairing" },
	{ id: "safe", name: "Safe", sub: "Multi-sig" },
];

const STEPS = [
	{ k: "wallet", t: "Pick a wallet" },
	{ k: "sign", t: "Prove the wallet is yours" },
	{ k: "permit", t: "Unlock decryption" },
	{ k: "ready", t: "Ready" },
];

export interface ConnectModalProps {
	open: boolean;
	onClose: () => void;
}

export function ConnectModal({ open, onClose }: ConnectModalProps): JSX.Element | null {
	const { address, isConnected } = useAccount();
	const { connect, connectors: wagmiConnectors } = useConnect();
	const { signMessageAsync } = useSignMessage();
	const cofheClient = useCofheClient();
	const { permitReady } = useCofheState();

	const [step, setStep] = useState(0);
	const [selectedWallet, setSelectedWallet] = useState("injected");
	const [pulse, setPulse] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nonce, setNonce] = useState<string | null>(null);
	const [, setJwt] = useState<string | null>(() => {
		if (typeof window === "undefined") return null;
		return localStorage.getItem("fheforge:jwt");
	});

	// Restore API auth header on mount
	useEffect(() => {
		const token = localStorage.getItem("fheforge:jwt");
		if (token) {
			api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
		}
	}, []);

	// When modal opens, jump to correct step based on wallet state, restore in-flight step
	useEffect(() => {
		if (!open) return;
		setError(null);

		const hasJwt = typeof window !== "undefined" ? localStorage.getItem("fheforge:jwt") : null;

		if (isConnected && permitReady) {
			setStep(3);
			return;
		}
		if (isConnected && hasJwt) {
			setStep(2);
			return;
		}
		if (isConnected) {
			setStep(1);
			return;
		}

		try {
			const saved = sessionStorage.getItem(CM_KEY);
			const s = saved != null ? parseInt(saved, 10) : 0;
			setStep(Number.isFinite(s) && s >= 0 && s < 4 ? s : 0);
		} catch {
			setStep(0);
		}
	}, [open, isConnected, permitReady]);

	// When connected while on step 0, auto-advance to sign
	useEffect(() => {
		if (!open) return;
		if (isConnected && step === 0) {
			setStep(1);
		}
	}, [isConnected, step, open]);

	// Persist current step while open
	useEffect(() => {
		if (!open) return;
		try {
			sessionStorage.setItem(CM_KEY, String(step));
		} catch {
			// ignore
		}
	}, [step, open]);

	// Auto-dismiss on step 3 (ready) after 1600ms
	useEffect(() => {
		if (open && step === 3) {
			setPulse(true);
			const id = setTimeout(() => {
				try {
					sessionStorage.removeItem(CM_KEY);
				} catch {
					// ignore
				}
				setPulse(false);
				onClose();
			}, 1600);
			return () => clearTimeout(id);
		}
	}, [step, open, onClose]);

	// Fetch nonce when entering step 1
	useEffect(() => {
		if (open && step === 1 && address) {
			setNonce(null);
			api
				.get<{ nonce: string }>(`/auth/nonce/${address}`)
				.then((res) => setNonce(res.data.nonce))
				.catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch nonce"));
		}
	}, [open, step, address]);

	const handleWalletSelect = useCallback((walletId: string) => {
		setSelectedWallet(walletId);
	}, []);

	const handleContinue = useCallback(() => {
		const connector = wagmiConnectors.find((c) => c.id === selectedWallet);
		if (connector) {
			connect({ connector });
		}
	}, [connect, selectedWallet, wagmiConnectors]);

	const handleSign = useCallback(async () => {
		if (!address || !nonce) return;
		setError(null);
		try {
			const signature = await signMessageAsync({ message: nonce });
			const loginRes = await api.post<{ token: string }>("/auth/wallet-login", {
				walletAddress: address,
				signature,
				nonce,
			});
			const token = loginRes.data.token;
			localStorage.setItem("fheforge:jwt", token);
			api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
			setJwt(token);
			setNonce(null);
			setStep(2);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Sign failed");
		}
	}, [address, nonce, signMessageAsync]);

	const handlePermit = useCallback(async () => {
		setError(null);
		try {
			if (!cofheClient) throw new Error("CoFHE client not ready");
			await cofheClient.permits.getOrCreateSelfPermit();
			setStep(3);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Permit failed");
		}
	}, [cofheClient]);

	if (!open) return null;

	const shortAddress = address ? `${address.slice(0, 10)}…${address.slice(-6)}` : "0x…";

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{ background: "rgba(10,10,10,0.6)", backdropFilter: "blur(10px)" }}
		>
			<div
				className="flex flex-col bg-[var(--card)] border border-[var(--border)]"
				style={{ width: 460, maxHeight: "86vh" }}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between"
					style={{
						padding: "10px 16px",
						borderBottom: "1px solid var(--border)",
						background: "var(--secondary)",
					}}
				>
					<div className="flex items-center" style={{ gap: 10 }}>
						{STEPS.map((_, i) => (
							<span
								key={i}
								className="block"
								style={{
									width: 8,
									height: 8,
									background:
										i < step
											? "var(--success)"
											: i === step
												? "var(--accent)"
												: "var(--border)",
									transition: "background-color 0.15s ease",
								}}
							/>
						))}
						<span
							style={{
								fontSize: 11,
								color: "var(--muted)",
								letterSpacing: "0.04em",
								marginLeft: 8,
							}}
						>
							Step {step + 1} of 4 · {STEPS[step].t}
						</span>
					</div>
					<button
						onClick={onClose}
						className="cursor-pointer"
						style={{
							border: 0,
							background: "transparent",
							color: "var(--muted)",
							fontSize: 16,
							padding: "4px 8px",
						}}
					>
						✕
					</button>
				</div>

				{/* Body */}
				<div className="overflow-auto">
					{step === 0 && (
						<StepWallet
							wallet={selectedWallet}
							setWallet={handleWalletSelect}
							onNext={handleContinue}
						/>
					)}
					{step === 1 && (
						<StepSign
							address={shortAddress}
							nonce={nonce}
							onBack={() => setStep(0)}
							onNext={handleSign}
						/>
					)}
					{step === 2 && (
						<StepPermit onBack={() => setStep(1)} onNext={handlePermit} />
					)}
					{step === 3 && <StepReady pulse={pulse} />}
				</div>

				{error && (
					<div
						style={{
							padding: "8px 16px",
							fontSize: 11,
							color: "var(--destructive)",
							borderTop: "1px solid var(--border)",
						}}
					>
						{error}
					</div>
				)}
			</div>
		</div>
	);
}

function StepWallet({
	wallet,
	setWallet,
	onNext,
}: {
	wallet: string;
	setWallet: (id: string) => void;
	onNext: () => void;
}) {
	return (
		<div style={{ padding: 20 }}>
			<h2
				style={{
					fontSize: 22,
					fontWeight: 500,
					lineHeight: 1.15,
					margin: 0,
					color: "var(--foreground)",
				}}
			>
				Pick a wallet.
			</h2>
			<p
				style={{
					color: "var(--muted)",
					marginTop: 6,
					marginBottom: 16,
					lineHeight: 1.5,
					fontSize: 13,
				}}
			>
				Arbitrum Sepolia. Wrong network auto-switches.
			</p>
			<div className="grid grid-cols-2" style={{ gap: 8 }}>
				{WALLETS.map((w) => (
					<button
						key={w.id}
						onClick={() => setWallet(w.id)}
						className="cursor-pointer text-left"
						style={{
							padding: "10px 12px",
							background: "var(--card)",
							border: `1px solid ${wallet === w.id ? "var(--accent)" : "var(--border)"}`,
							transition: "border-color 0.15s ease",
						}}
					>
						<div className="flex items-center justify-between">
							<div className="flex flex-col" style={{ gap: 2 }}>
								<span
									style={{
										fontSize: 14,
										fontWeight: 500,
										color: "var(--foreground)",
									}}
								>
									{w.name}
								</span>
								<span
									style={{
										fontSize: 10,
										color: "var(--muted)",
										letterSpacing: "0.04em",
									}}
								>
									{w.sub}
								</span>
							</div>
							{wallet === w.id && (
								<span style={{ fontSize: 10, color: "var(--accent)" }}>●</span>
							)}
						</div>
					</button>
				))}
			</div>
			<div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
				<button className="terminal-btn" onClick={onNext}>
					Continue <span>→</span>
				</button>
			</div>
		</div>
	);
}

function StepSign({
	address,
	nonce,
	onBack,
	onNext,
}: {
	address: string;
	nonce: string | null;
	onBack: () => void;
	onNext: () => void;
}) {
	const message = nonce
		? `fheforge.app wants to sign in:\n${address}\n\nNonce: ${nonce}\nChain: 421614 · Arbitrum Sepolia`
		: "Loading nonce…";

	return (
		<div style={{ padding: 20 }}>
			<h2
				style={{
					fontSize: 22,
					fontWeight: 500,
					lineHeight: 1.15,
					margin: 0,
					color: "var(--foreground)",
				}}
			>
				Prove it&apos;s yours.
			</h2>
			<p
				style={{
					color: "var(--muted)",
					marginTop: 6,
					marginBottom: 14,
					lineHeight: 1.5,
					fontSize: 13,
				}}
			>
				Sign a short message. No gas, no spend.
			</p>
			<pre
				style={{
					padding: 12,
					fontSize: 11,
					lineHeight: 1.55,
					color: "var(--foreground-secondary)",
					background: "var(--secondary)",
					border: "1px solid var(--border)",
					overflowX: "auto",
					marginBottom: 14,
					marginTop: 0,
				}}
			>
				{message}
			</pre>
			<div className="flex justify-between" style={{ gap: 8 }}>
				<button className="terminal-btn" onClick={onBack}>
					← Back
				</button>
				<button className="terminal-btn primary" onClick={onNext} disabled={!nonce}>
					Sign <span>→</span>
				</button>
			</div>
		</div>
	);
}

function StepPermit({
	onBack,
	onNext,
}: {
	onBack: () => void;
	onNext: () => void;
}) {
	return (
		<div style={{ padding: 20 }}>
			<h2
				style={{
					fontSize: 22,
					fontWeight: 500,
					lineHeight: 1.15,
					margin: 0,
					color: "var(--foreground)",
				}}
			>
				Unlock your numbers.
			</h2>
			<p
				style={{
					color: "var(--muted)",
					marginTop: 6,
					marginBottom: 14,
					lineHeight: 1.5,
					fontSize: 13,
				}}
			>
				Grant a 15-minute permit. Only you decrypt.
			</p>

			<div
				style={{
					background: "var(--secondary)",
					border: "1px solid var(--border)",
					padding: 12,
					marginBottom: 14,
				}}
			>
				<div className="flex flex-wrap" style={{ gap: 16 }}>
					<div style={{ flex: "1 1 100px" }}>
						<span
							style={{
								fontSize: 10,
								color: "var(--muted)",
								letterSpacing: "0.08em",
								textTransform: "uppercase",
							}}
						>
							scope
						</span>
						<div style={{ fontSize: 11, marginTop: 2, color: "var(--foreground)" }}>your handles</div>
					</div>
					<div style={{ flex: "1 1 100px" }}>
						<span
							style={{
								fontSize: 10,
								color: "var(--muted)",
								letterSpacing: "0.08em",
								textTransform: "uppercase",
							}}
						>
							expires
						</span>
						<div style={{ fontSize: 11, marginTop: 2, color: "var(--foreground)" }}>15 minutes</div>
					</div>
					<div style={{ flex: "1 1 100px" }}>
						<span
							style={{
								fontSize: 10,
								color: "var(--muted)",
								letterSpacing: "0.08em",
								textTransform: "uppercase",
							}}
						>
							cost
						</span>
						<div style={{ fontSize: 11, marginTop: 2, color: "var(--foreground)" }}>0 gas</div>
					</div>
				</div>
			</div>

			<div className="flex justify-between" style={{ gap: 8 }}>
				<button className="terminal-btn" onClick={onBack}>
					← Back
				</button>
				<button className="terminal-btn primary" onClick={onNext}>
					Grant permit <span>→</span>
				</button>
			</div>
		</div>
	);
}

function StepReady({ pulse }: { pulse: boolean }) {
	return (
		<div
			style={{
				padding: 24,
				display: "grid",
				placeItems: "center",
				minHeight: 160,
			}}
		>
			<div className="flex flex-col items-center text-center" style={{ gap: 8 }}>
				<span
					className="inline-block"
					style={{
						fontSize: 11,
						color: "var(--success)",
						border: "1px solid var(--success)",
						padding: "2px 8px",
					}}
				>
					permit live
				</span>
				<h2
					style={{
						fontSize: 22,
						fontWeight: 500,
						lineHeight: 1.15,
						margin: 0,
						color: "var(--foreground)",
					}}
				>
					You can read your numbers.
				</h2>
				<p style={{ color: "var(--muted)", margin: "4px 0 0 0", fontSize: 13 }}>
					Renew when it expires · nothing&apos;s lost.
				</p>
				{pulse && (
					<div
						style={{
							marginTop: 8,
							width: 24,
							height: 2,
							background: "var(--success)",
							animation: "readyPulse 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite",
						}}
					/>
				)}
				<style
					dangerouslySetInnerHTML={{
						__html: `
						@keyframes readyPulse {
							0%, 100% { opacity: 0.4; transform: scaleX(0.6); }
							50% { opacity: 1; transform: scaleX(1.2); }
						}
					`,
					}}
				/>
			</div>
		</div>
	);
}
