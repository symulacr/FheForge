"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useStrategies } from "@/hooks/use-strategies";
import { useActivities } from "@/hooks/use-activity-service";
import { usePermitCountdown } from "@/hooks/use-permit-countdown";
import { useFheWallet } from "@/hooks/use-fhe-wallet";
import { MasterDetail } from "@/components/shared/master-detail";
import { MDGroup } from "@/components/shared/md-group";
import { MDItem } from "@/components/shared/md-item";
import { Cipher } from "@/components/shared/cipher";
import { Tag } from "@/components/shared/tag";
import { PermitChip } from "@/components/shared/permit-chip";
import { LtvGauge } from "@/components/shared/ltv-gauge";
import { formatUnits } from "viem";
import type { DefiStrategy } from "@/types/defi.strategy";
import type { ActivityResponse } from "@/types/activity.interface";

interface SelectedItem {
	kind: "position" | "strategy" | "activity";
	id: string;
}

function formatApy(apy?: number): string {
	if (apy == null) return "–";
	return `${apy >= 0 ? "+" : ""}${apy.toFixed(2)}%`;
}

function timeAgo(date: Date | string): string {
	const d = typeof date === "string" ? new Date(date) : date;
	const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

function apyColor(apy: string): string {
	if (apy.startsWith("−") || apy.startsWith("-")) return "var(--destructive)";
	return "var(--success)";
}

/* ─── Inline Tile component ─── */
function Tile({
	k,
	cipher,
	plain,
	unit,
	locked,
	color,
}: {
	k: string;
	cipher?: string;
	plain?: string;
	unit?: string;
	locked?: boolean;
	color?: string;
}): JSX.Element {
	return (
		<div style={{ background: "var(--card)", padding: 18 }}>
			<span className="eyebrow">{k}</span>
			<div
				style={{
					marginTop: 6,
					fontSize: 28,
					lineHeight: 1.1,
					color: color || "var(--foreground)",
				}}
			>
				{cipher ? (
					<Cipher value={cipher} unit={unit} locked={locked} size="lg" inline />
				) : (
					plain
				)}
			</div>
		</div>
	);
}

/* ─── Empty state (no wallet) ─── */
function DashboardEmpty({
	onConnect,
	onBrowse,
}: {
	onConnect: () => void;
	onBrowse: () => void;
}): JSX.Element {
	return (
		<div
			style={{
				minHeight: "calc(100vh - 56px)",
				display: "grid",
				placeItems: "center",
				padding: 28,
			}}
		>
			<div
				style={{
					maxWidth: 1080,
					width: "100%",
					display: "grid",
					gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
					gap: 56,
					alignItems: "center",
				}}
			>
				<div>
					<span
						className="mono"
						style={{
							fontSize: 11,
							color: "var(--muted)",
							letterSpacing: "0.1em",
							textTransform: "uppercase",
						}}
					>
						Portfolio · empty
					</span>
					<h2
						style={{
							fontSize: "clamp(34px, 4.6vw, 52px)",
							marginTop: 14,
							marginBottom: 18,
							maxWidth: 520,
							fontWeight: 500,
							letterSpacing: -0.012,
							lineHeight: 1.15,
						}}
					>
						Connect to see your positions.
					</h2>
					<p
						style={{
							color: "var(--muted)",
							marginTop: 16,
							marginBottom: 24,
							maxWidth: 460,
							lineHeight: 1.55,
						}}
					>
						We can&apos;t fetch your balances without a wallet connection. One signature to prove
						ownership, then a one-click permit so your wallet can decrypt its own numbers.
					</p>
					<div style={{ display: "flex", gap: 10 }}>
						<button className="terminal-btn primary text-sm px-6 py-3" onClick={onConnect}>
							Connect wallet <span style={{ fontFamily: "inherit" }}>→</span>
						</button>
						<button className="terminal-btn text-sm px-6 py-3" onClick={onBrowse}>
							Browse strategies first
						</button>
					</div>
				</div>

				<div
					style={{
						background: "var(--card)",
						border: "1px solid var(--border)",
						padding: 26,
					}}
				>
					<span className="eyebrow">preview · sample portfolio</span>
					<div
						style={{
							marginTop: 14,
							filter: "blur(2px) opacity(0.55)",
							pointerEvents: "none",
						}}
					>
						<div style={{ fontSize: 48, lineHeight: 1.1 }}>$0.00</div>
						<hr className="dashed" style={{ margin: "16px 0" }} />
						{[
							["Supplied", "–"],
							["Borrowed", "–"],
							["In strategies", "–"],
						].map(([k, v]) => (
							<div
								key={k}
								style={{
									display: "flex",
									justifyContent: "space-between",
									padding: "8px 0",
								}}
							>
								<span
									className="mono"
									style={{
										fontSize: 12,
										color: "var(--muted)",
										letterSpacing: "0.04em",
										textTransform: "uppercase",
									}}
								>
									{k}
								</span>
								<span className="mono" style={{ fontSize: 14 }}>
									{v}
								</span>
							</div>
						))}
					</div>
					<div
						className="mono"
						style={{
							fontSize: 11,
							color: "var(--muted)",
							marginTop: 16,
							textAlign: "center",
							letterSpacing: "0.04em",
						}}
					>
						↑ what you&apos;ll see after connecting
					</div>
				</div>
			</div>
		</div>
	);
}

/* ─── Overview (default detail) ─── */
function Overview({
	locked,
	netValue,
	positionCount,
	grantPermit,
	onAddCollateral,
}: {
	locked: boolean;
	netValue: string;
	positionCount: number;
	grantPermit: () => void;
	onAddCollateral: () => void;
}): JSX.Element {
	return (
		<div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
			{/* Four stat tiles */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
					gap: 1,
					background: "var(--border)",
					border: "1px solid var(--border)",
				}}
			>
				{[
					{
						k: "Net value · usd",
						v: netValue,
						sub: "+1,612.04 / 24h",
						cipher: true,
						color: "var(--success)",
					},
					{
						k: "LTV",
						v: "44.8%",
						sub: "buffer 35.2% · liq $1,820",
						cipher: false,
					},
					{
						k: "Permit",
						v: locked ? "locked" : "13:42",
						sub: locked ? "grant to decrypt" : "live · auto-blur on expire",
						cipher: false,
						color: locked ? "var(--destructive)" : "var(--foreground)",
					},
					{
						k: "Gas · ETH",
						v: "0.412",
						sub: "≈ $1,049 · ~42 ops",
						cipher: false,
					},
				].map((t, i) => (
					<div key={i} style={{ background: "var(--background)", padding: 22 }}>
						<span className="eyebrow">{t.k}</span>
						<div
							style={{
								marginTop: 6,
								fontSize: 38,
								lineHeight: 1.1,
								color: t.color || "var(--foreground)",
							}}
						>
							{t.cipher ? (
								<Cipher value={t.v} locked={locked} size="xl" inline />
							) : (
								t.v
							)}
						</div>
						<div
							className="mono"
							style={{
								fontSize: 11,
								color: "var(--muted)",
								marginTop: 6,
								letterSpacing: "0.04em",
							}}
						>
							{t.sub}
						</div>
					</div>
				))}
			</div>

			{/* LTV detail card */}
			<div style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 22 }}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: 14,
					}}
				>
					<span className="eyebrow">Loan-to-value · weighted</span>
					<span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
						{positionCount} collateralized positions
					</span>
				</div>
				<LtvGauge ltv={44.8} liqThreshold={80} showLabels={false} height={10} />
				<div
					style={{ display: "flex", gap: 22, marginTop: 14, color: "var(--muted)" }}
				>
					<span className="mono" style={{ fontSize: 12 }}>
						liq @ ETH $1,820
					</span>
					<span>·</span>
					<span className="mono" style={{ fontSize: 12 }}>
						oracle: Pyth · fresh 14s
					</span>
					<span>·</span>
					<span className="mono" style={{ fontSize: 12 }}>
						buffer: +35.2%
					</span>
				</div>
				<hr className="dashed" style={{ margin: "18px 0" }} />
				<div style={{ display: "flex", gap: 8 }}>
					<button className="terminal-btn text-xs px-3 py-1.5" onClick={onAddCollateral}>
						Add collateral
					</button>
					<button className="terminal-btn text-xs px-3 py-1.5">Repay debt</button>
				</div>
			</div>

			{/* Hint */}
			<div
				className="mono"
				style={{
					fontSize: 11,
					color: "var(--muted)",
					padding: "12px 4px",
					letterSpacing: "0.04em",
				}}
			>
				Pick a position, strategy, or activity entry on the left to see its detail.
			</div>
		</div>
	);
}

/* ─── PositionDetail ─── */
function PositionDetail({
	p,
	locked,
	onAddToPosition,
}: {
	p: {
		id: string;
		venue: string;
		asset: string;
		side: string;
		amount: string;
		apy: string;
		liq: string | null;
	};
	locked: boolean;
	onAddToPosition: () => void;
}): JSX.Element {
	return (
		<div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
					gap: 1,
					background: "var(--border)",
					border: "1px solid var(--border)",
				}}
			>
				<Tile k="amount" cipher={p.amount} unit={p.asset} locked={locked} />
				<Tile k="apy" plain={p.apy} color={apyColor(p.apy)} />
				<Tile k="liquidation" plain={p.liq || "–"} />
			</div>
			<div style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 22 }}>
				<div className="kv">
					<span className="k">venue</span>
					<span className="v">{p.venue}</span>
				</div>
				<div className="kv">
					<span className="k">side</span>
					<span className="v">{p.side}</span>
				</div>
				<div className="kv">
					<span className="k">asset</span>
					<span className="v">{p.asset}</span>
				</div>
				<div className="kv">
					<span className="k">interest accrued · 30d</span>
					<span className="v">
						<Cipher value="142.08" locked={locked} size="sm" inline />
					</span>
				</div>
				<div className="kv">
					<span className="k">oracle</span>
					<span className="v">Pyth · fresh 14s</span>
				</div>
			</div>
			<div style={{ display: "flex", gap: 8 }}>
				<button className="terminal-btn primary text-xs px-3 py-1.5" onClick={onAddToPosition}>
					Add to position <span style={{ fontFamily: "inherit" }}>→</span>
				</button>
				<button className="terminal-btn text-xs px-3 py-1.5">Withdraw</button>
				<button
					className="terminal-btn text-xs px-3 py-1.5"
					style={{ color: "var(--destructive)" }}
				>
					Close position
				</button>
			</div>
		</div>
	);
}

/* ─── StrategyDetail ─── */
function StrategyDetail({
	s,
	locked,
	onOpenBuilder,
}: {
	s: {
		id: string;
		name: string;
		apy: string;
		staked: string;
		loops: number;
		last: string;
	};
	locked: boolean;
	onOpenBuilder: () => void;
}): JSX.Element {
	const [stakedVal, stakedUnit] = s.staked.split(" ");
	return (
		<div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
					gap: 1,
					background: "var(--border)",
					border: "1px solid var(--border)",
				}}
			>
				<Tile k="apy" plain={s.apy} color="var(--success)" />
				<Tile k="my stake" cipher={stakedVal} unit={stakedUnit} locked={locked} />
				<Tile k="loops" plain={`×${s.loops}`} />
				<Tile k="last execution" plain={s.last} />
			</div>

			{/* Run history bar */}
			<div style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 22 }}>
				<span className="eyebrow">last 8 executions</span>
				<div style={{ display: "flex", gap: 4, marginTop: 12 }}>
					{Array.from({ length: 8 }).map((_, i) => (
						<span
							key={i}
							style={{
								flex: 1,
								height: 6,
								background: i < 6 ? "var(--success)" : "var(--border)",
							}}
						/>
					))}
				</div>
				<div
					className="mono"
					style={{
						fontSize: 11,
						color: "var(--muted)",
						marginTop: 8,
						letterSpacing: "0.04em",
					}}
				>
					6 of 8 succeeded · 2 skipped (LTV guardrail)
				</div>
			</div>

			<div style={{ display: "flex", gap: 8 }}>
				<button className="terminal-btn primary text-xs px-3 py-1.5" onClick={onOpenBuilder}>
					Open in builder <span style={{ fontFamily: "inherit" }}>→</span>
				</button>
				<button className="terminal-btn text-xs px-3 py-1.5">Pause</button>
				<button
					className="terminal-btn text-xs px-3 py-1.5"
					style={{ color: "var(--destructive)" }}
				>
					Close
				</button>
			</div>
		</div>
	);
}

/* ─── ActivityDetail ─── */
function ActivityDetail({
	a,
	locked,
}: {
	a: {
		id: string;
		block: number;
		age: string;
		what: string;
		kind: string;
		asset: string;
		delta: string;
	};
	locked: boolean;
}): JSX.Element {
	return (
		<div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
			<div style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 22 }}>
				<div className="kv">
					<span className="k">block</span>
					<span className="v">#{a.block.toLocaleString()}</span>
				</div>
				<div className="kv">
					<span className="k">age</span>
					<span className="v">{a.age} ago</span>
				</div>
				<div className="kv">
					<span className="k">type</span>
					<span className="v">{a.kind}</span>
				</div>
				<div className="kv">
					<span className="k">asset</span>
					<span className="v">{a.asset}</span>
				</div>
				<div className="kv">
					<span className="k">amount</span>
					<span className="v">
						{a.delta === "–" ? "–" : (
							<Cipher value={a.delta} locked={locked} size="sm" inline />
						)}
					</span>
				</div>
			</div>
			<div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
				Amount is ciphertext on-chain. Decryption is permit-gated and never leaves your browser.
			</div>
		</div>
	);
}

export default function DashboardClient(): JSX.Element {
	const router = useRouter();
	const { address, isConnected } = useAccount();
	const { connectWallet } = useFheWallet();
	const portfolio = usePortfolio(address);
	const { strategies, loading: stratLoading } = useStrategies(address);
	const { data: activityData } = useActivities({ userAddress: address });
	const { unlocked, secondsLeft, grantPermit } = usePermitCountdown();
	const [selected, setSelected] = useState<SelectedItem | null>(null);

	const locked = !unlocked;

	const positionRows = useMemo(() => {
		const rows: {
			id: string;
			venue: string;
			asset: string;
			side: "supply" | "borrow" | "vault";
			amount: string;
			apy: string;
			liq: string | null;
		}[] = [];

		if (portfolio.plainSupplyBalance && portfolio.plainSupplyBalance > 0n) {
			rows.push({
				id: "pool-supply",
				venue: "Lending Pool",
				asset: "WETH",
				side: "supply",
				amount: formatUnits(portfolio.plainSupplyBalance, 18),
				apy: "+4.82%",
				liq: null,
			});
		}
		if (portfolio.plainBorrowBalance && portfolio.plainBorrowBalance > 0n) {
			rows.push({
				id: "pool-borrow",
				venue: "Lending Pool",
				asset: "WETH",
				side: "borrow",
				amount: formatUnits(portfolio.plainBorrowBalance, 18),
				apy: "−3.14%",
				liq: "$1,820",
			});
		}
		for (const posId of portfolio.userPositions) {
			const meta = portfolio.getPositionMeta(posId);
			const strategyId = meta.data ? String(Number(meta.data[0])) : "?";
			rows.push({
				id: posId,
				venue: `Vault · S/${strategyId.padStart(2, "0")}`,
				asset: "USDC",
				side: "vault",
				amount: "–",
				apy: "–",
				liq: null,
			});
		}
		return rows;
	}, [portfolio]);

	const strategyRows = useMemo(() => {
		return (strategies || []).map((s: DefiStrategy) => ({
			id: s.id,
			name: s.name || "Unnamed strategy",
			apy: formatApy(s.apy ?? undefined),
			staked: "–",
			loops: s.defi_strategy_versions?.[0]?.workflow_json
				? Number(s.defi_strategy_versions[0].workflow_json.loops || 0)
				: 0,
			last: "–",
		}));
	}, [strategies]);

	const activityRows = useMemo(() => {
		const items: ActivityResponse[] = Array.isArray(activityData)
			? activityData
			: activityData?.data || [];
		return items.map((a: ActivityResponse, i: number) => ({
			id: a.id || `a-${i}`,
			block: 182944108 - i * 12345,
			age: a.createdAt ? timeAgo(a.createdAt) : "–",
			what: `Step ${a.currentStep || 0}/${a.totalSteps || 0}`,
			kind: (a.status || "pending").toLowerCase(),
			asset: a.strategyId ? `S/${a.strategyId}` : "–",
			delta: "–",
		}));
	}, [activityData]);

	const netValue = useMemo(() => {
		let total = 0;
		for (const row of positionRows) {
			if (row.side === "supply") total += parseFloat(row.amount || "0");
			if (row.side === "borrow") total -= parseFloat(row.amount || "0");
		}
		return total > 0
			? total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
			: "0.00";
	}, [positionRows]);

	const activeCount = positionRows.length + strategyRows.length;

	if (!isConnected) {
		return (
			<DashboardEmpty
				onConnect={connectWallet}
				onBrowse={() => router.push("/")}
			/>
		);
	}

	const selectedPosition = selected?.kind === "position"
		? positionRows.find((r) => r.id === selected.id)
		: undefined;
	const selectedStrategy = selected?.kind === "strategy"
		? strategyRows.find((r) => r.id === selected.id)
		: undefined;
	const selectedActivity = selected?.kind === "activity"
		? activityRows.find((r) => r.id === selected.id)
		: undefined;

	const listHeader = (
		<div>
			<span className="eyebrow">Portfolio</span>
			<div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
				<span
					className="mono"
					style={{ fontSize: 11, color: "var(--muted)" }}
				>
					{activeCount} active · synced 14s ago
				</span>
			</div>
			<div style={{ marginTop: 8 }}>
				<PermitChip unlocked={unlocked} secondsLeft={secondsLeft} onClick={grantPermit} />
			</div>
		</div>
	);

	const listBody = (
		<>
			<MDGroup>Positions · {positionRows.length}</MDGroup>
			{positionRows.map((row, i) => (
				<MDItem
					key={row.id}
					idx={String(i + 1).padStart(2, "0")}
					title={`${row.asset} · ${row.side}`}
					sub={row.venue}
					right={
						<span
							className="mono"
							style={{
								fontSize: 12,
								color: row.apy.startsWith("−") ? "var(--destructive)" : "var(--success)",
							}}
						>
							{row.apy}
						</span>
					}
					selected={selected?.kind === "position" && selected.id === row.id}
					onClick={() => setSelected({ kind: "position", id: row.id })}
				/>
			))}

			<MDGroup>Strategies · {strategyRows.length}</MDGroup>
			{stratLoading ? (
				<div className="p-4 text-muted text-xs">Loading strategies…</div>
			) : (
				strategyRows.map((row, i) => (
					<MDItem
						key={row.id}
						idx={`S/${String(i + 1).padStart(2, "0")}`}
						title={row.name}
						sub={`×${row.loops} loops · ${row.last}`}
						right={
							<span
								className="mono"
								style={{ fontSize: 12, color: "var(--success)" }}
							>
								{row.apy}
							</span>
						}
						selected={selected?.kind === "strategy" && selected.id === row.id}
						onClick={() => setSelected({ kind: "strategy", id: row.id })}
					/>
				))
			)}

			<MDGroup>Recent activity</MDGroup>
			{activityRows.map((row) => (
				<MDItem
					key={row.id}
					idx={row.age}
					title={row.what}
					sub={`${row.kind} · ${row.asset}`}
					right={
						<span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
							{row.delta}
						</span>
					}
					selected={selected?.kind === "activity" && selected.id === row.id}
					onClick={() => setSelected({ kind: "activity", id: row.id })}
				/>
			))}
		</>
	);

	const detailHeader = selected ? (
		<>
			<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
				<Tag
					tone={
						selected.kind === "position"
							? "default"
							: selected.kind === "strategy"
								? "accent"
								: "positive"
					}
				>
					{selected.kind}
				</Tag>
				<h2
					style={{
						fontSize: 20,
						fontWeight: 500,
						letterSpacing: -0.012,
						margin: 0,
						lineHeight: 1.2,
					}}
				>
					{selected.kind === "position" && selectedPosition
						? `${selectedPosition.asset} · ${selectedPosition.side}`
						: selected.kind === "strategy" && selectedStrategy
							? selectedStrategy.name
							: selected.kind === "activity" && selectedActivity
								? selectedActivity.what
								: selected.kind}
				</h2>
			</div>
			<button
				className="terminal-btn text-xs px-3 py-1.5"
				onClick={() => setSelected(null)}
			>
				Back to overview
			</button>
		</>
	) : (
		<>
			<h2
				style={{
					fontSize: 20,
					fontWeight: 500,
					letterSpacing: -0.012,
					margin: 0,
					lineHeight: 1.2,
				}}
			>
				Overview
			</h2>
			<PermitChip unlocked={unlocked} secondsLeft={secondsLeft} onClick={grantPermit} />
		</>
	);

	const detailBody = selected ? (
		<div className="fade-enter">
			{selected.kind === "position" && selectedPosition && (
				<PositionDetail
					p={selectedPosition}
					locked={locked}
					onAddToPosition={() => router.push("/lending")}
				/>
			)}
			{selected.kind === "strategy" && selectedStrategy && (
				<StrategyDetail
					s={selectedStrategy}
					locked={locked}
					onOpenBuilder={() => router.push("/builder")}
				/>
			)}
			{selected.kind === "activity" && selectedActivity && (
				<ActivityDetail a={selectedActivity} locked={locked} />
			)}
		</div>
	) : (
		<Overview
			locked={locked}
			netValue={netValue}
			positionCount={positionRows.length}
			grantPermit={grantPermit}
			onAddCollateral={() => router.push("/lending")}
		/>
	);

	return (
		<MasterDetail
			collapseKey="portfolio"
			listHeader={listHeader}
			listBody={listBody}
			detailHeader={detailHeader}
			detailBody={detailBody}
		/>
	);
}
