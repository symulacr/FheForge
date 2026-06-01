"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { api } from "@/services/api";
import { MasterDetail } from "@/components/shared/master-detail";
import { MDGroup } from "@/components/shared/md-group";
import { MDItem } from "@/components/shared/md-item";
import { Tag } from "@/components/shared/tag";

/* ───────────────────────────────────────────────────────────
   Types
   ─────────────────────────────────────────────────────────── */

interface Proposal {
	id: string;
	title: string;
	description: string;
	status: "pending" | "active" | "passed" | "rejected" | "executed";
	votesFor: number;
	votesAgainst: number;
	votesAbstain?: number;
	quorum?: number;
	endsAt: string;
	proposer: string;
	createdAt: string;
}

type DisplayStatus = "active" | "queued" | "executed" | "defeated";

/* ───────────────────────────────────────────────────────────
   Constants & helpers
   ─────────────────────────────────────────────────────────── */

const BACKEND_TO_DISPLAY: Record<string, DisplayStatus> = {
	active: "active",
	pending: "queued",
	passed: "queued",
	executed: "executed",
	rejected: "defeated",
};

const GROUP_ORDER: DisplayStatus[] = ["active", "queued", "executed", "defeated"];

const GROUP_LABELS: Record<DisplayStatus, string> = {
	active: "Active",
	queued: "Queued",
	executed: "Executed",
	defeated: "Defeated",
};

const STATUS_TONE: Record<DisplayStatus, "default" | "accent" | "positive" | "danger" | "ink"> = {
	active: "accent",
	queued: "default",
	executed: "positive",
	defeated: "danger",
};

const FILTER_CHIPS: { label: string; value: string }[] = [
	{ label: "all", value: "" },
	{ label: "active", value: "active" },
	{ label: "passed", value: "passed" },
	{ label: "executed", value: "executed" },
	{ label: "rejected", value: "rejected" },
];

function formatTimeLeft(endsAt: string): string {
	const now = Date.now();
	const end = new Date(endsAt).getTime();
	const diff = end - now;
	if (diff <= 0) return "ended";
	const days = Math.floor(diff / 86_400_000);
	const hours = Math.floor((diff % 86_400_000) / 3_600_000);
	if (days > 0) return `${days}d ${hours.toString().padStart(2, "0")}h`;
	return `${hours}h`;
}

function getTagTone(status: DisplayStatus): "default" | "accent" | "positive" | "danger" | "ink" {
	return STATUS_TONE[status];
}

/* ───────────────────────────────────────────────────────────
   Mini 3-colour vote bar (right side of list item)
   ─────────────────────────────────────────────────────────── */

function MiniVoteBar({
	forVotes,
	againstVotes,
	abstain,
}: {
	forVotes: number;
	againstVotes: number;
	abstain: number;
}) {
	const total = forVotes + againstVotes + abstain;
	const pct = (n: number) => (total ? (n / total) * 100 : 0);
	return (
		<div style={{ width: 60, height: 4, display: "flex", background: "var(--card)" }}>
			<span style={{ width: `${pct(forVotes)}%`, background: "var(--success)" }} />
			<span style={{ width: `${pct(againstVotes)}%`, background: "var(--destructive)" }} />
			<span style={{ width: `${pct(abstain)}%`, background: "var(--muted)" }} />
		</div>
	);
}

/* ───────────────────────────────────────────────────────────
   Proposal detail pane
   ─────────────────────────────────────────────────────────── */

function ProposalDetail({ proposal }: { proposal: Proposal }) {
	const { isConnected } = useAccount();
	const { connect, connectors } = useConnect();
	const [vote, setVote] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const status = BACKEND_TO_DISPLAY[proposal.status] || "queued";
	const forVotes = proposal.votesFor;
	const againstVotes = proposal.votesAgainst;
	const abstain = proposal.votesAbstain ?? 0;
	const total = forVotes + againstVotes + abstain;
	const quorum = proposal.quorum ?? 460_000;
	const quorumPct = Math.min(100, (total / quorum) * 100);
	const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0");

	const handleVote = async () => {
		if (!vote) return;
		setSubmitting(true);
		try {
			const support = vote === "for" ? true : vote === "against" ? false : null;
			if (support === null) {
				// abstain — backend currently counts only for/against
				return;
			}
			await api.post("/governance/vote", {
				proposalId: proposal.id,
				support,
				weight: 1,
			});
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 820 }}>
			{/* Title + description */}
			<div>
				<h3
					style={{
						fontSize: "clamp(20px, 2.5vw, 28px)",
						lineHeight: 1.15,
						letterSpacing: -0.018,
						maxWidth: 720,
						fontWeight: 500,
						margin: 0,
					}}
				>
					{proposal.title}
				</h3>
				<p style={{ color: "var(--muted)", marginTop: 14, lineHeight: 1.55, maxWidth: 660 }}>
					{proposal.description}
				</p>
			</div>

			{/* Tally card */}
			<div className="block">
				<span className="eyebrow">tally</span>
				<div style={{ marginTop: 12 }}>
					<div style={{ height: 16, display: "flex", border: "1px solid var(--border)" }}>
						<span style={{ width: `${pct(forVotes)}%`, background: "var(--success)" }} />
						<span style={{ width: `${pct(againstVotes)}%`, background: "var(--destructive)" }} />
						<span style={{ width: `${pct(abstain)}%`, background: "var(--muted)" }} />
					</div>
					<div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
						<span style={{ fontSize: 12 }}>
							<span style={{ color: "var(--success)" }}>●</span> for · {forVotes.toLocaleString()} ({pct(forVotes)}%)
						</span>
						<span style={{ fontSize: 12 }}>
							<span style={{ color: "var(--destructive)" }}>●</span> against · {againstVotes.toLocaleString()} ({pct(againstVotes)}%)
						</span>
						<span style={{ fontSize: 12 }}>
							<span style={{ color: "var(--muted)" }}>●</span> abstain · {abstain.toLocaleString()}
						</span>
					</div>
				</div>

				{/* Dashed divider */}
				<div
					style={{
						margin: "18px 0",
						borderTop: "1px dashed var(--border-light)",
						height: 0,
					}}
				/>

				{/* Quorum */}
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: 6,
					}}
				>
					<span
						style={{
							fontSize: 11,
							color: "var(--muted)",
							textTransform: "uppercase",
							letterSpacing: "0.06em",
						}}
					>
						quorum · {quorumPct.toFixed(0)}% of {quorum.toLocaleString()}
					</span>
					<span
						style={{
							fontSize: 11,
							color: quorumPct >= 100 ? "var(--success)" : "var(--accent)",
						}}
					>
						{quorumPct >= 100 ? "met" : "pending"}
					</span>
				</div>
				<div className="meter" style={{ height: 6 }}>
					<div
						className="fill"
						style={{
							width: `${quorumPct}%`,
							background: quorumPct >= 100 ? "var(--success)" : "var(--accent)",
						}}
					/>
				</div>
			</div>

			{/* Info card */}
			<div className="block">
				<div className="kv">
					<span className="k">proposer</span>
					<span className="v">{proposal.proposer}</span>
				</div>
				<div className="kv">
					<span className="k">timing</span>
					<span className="v">{formatTimeLeft(proposal.endsAt)}</span>
				</div>
				<div className="kv">
					<span className="k">execution</span>
					<span className="v">Timelock · 2d delay</span>
				</div>
			</div>

			{/* Cast vote card — only for active proposals */}
			{status === "active" && (
				<div className="block" style={{ borderColor: "var(--foreground)" }}>
					<span className="eyebrow">cast vote</span>
					<div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
						{isConnected ? "Wallet connected · ready to vote" : "connect wallet to vote"}
					</div>
					<div style={{ display: "flex", gap: 8, marginTop: 14 }}>
						{(["for", "against", "abstain"] as const).map((v) => (
							<button
								key={v}
								onClick={() => setVote(v)}
								disabled={!isConnected}
								className="terminal-btn"
								style={{
									flex: 1,
									padding: "11px 14px",
									border: `1px solid ${vote === v ? "var(--foreground)" : "var(--border)"}`,
									background: vote === v ? "var(--secondary)" : "var(--card)",
									color: "var(--foreground)",
									fontSize: 12,
									textTransform: "uppercase",
									letterSpacing: "0.06em",
									cursor: isConnected ? "pointer" : "not-allowed",
									opacity: isConnected ? 1 : 0.5,
								}}
							>
								● {v}
							</button>
						))}
					</div>
					{!isConnected ? (
						<button
							className="terminal-btn primary"
							style={{ width: "100%", marginTop: 14 }}
							onClick={() => {
								const c = connectors[0];
								if (c) connect({ connector: c });
							}}
						>
							Connect to vote →
						</button>
					) : (
						<button
							className="terminal-btn primary"
							style={{ width: "100%", marginTop: 14 }}
							disabled={!vote || submitting}
							onClick={handleVote}
						>
							{vote ? `Sign & submit · ${vote}` : "Pick a side"} →
						</button>
					)}
				</div>
			)}
		</div>
	);
}

/* ───────────────────────────────────────────────────────────
   Main governance page (MasterDetail shell)
   ─────────────────────────────────────────────────────────── */

export default function GovernanceClient(): JSX.Element {
	const [proposals, setProposals] = useState<Proposal[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [statusFilter, setStatusFilter] = useState<string>("");

	useEffect(() => {
		setLoading(true);
		api
			.get<Proposal[]>(`/governance/proposals${statusFilter ? `?status=${statusFilter}` : ""}`)
			.then((res) => {
				setProposals(res.data);
				if (res.data.length > 0 && !selectedId) {
					setSelectedId(res.data[0].id);
				}
			})
			.catch(() => setProposals([]))
			.finally(() => setLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [statusFilter]);

	const selectedProposal = useMemo(
		() => proposals.find((p) => p.id === selectedId) || null,
		[proposals, selectedId],
	);

	const grouped = useMemo(() => {
		const groups: Record<DisplayStatus, Proposal[]> = {
			active: [],
			queued: [],
			executed: [],
			defeated: [],
		};
		for (const p of proposals) {
			const ds = BACKEND_TO_DISPLAY[p.status];
			if (ds) groups[ds].push(p);
		}
		return groups;
	}, [proposals]);

	const listHeader = (
		<div>
			<div className="eyebrow">Governance</div>
			<div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
				<span style={{ fontSize: 11, color: "var(--muted)" }}>token-weighted · parameters only</span>
			</div>
			<div className="flex gap-2 mt-3 flex-wrap">
				{FILTER_CHIPS.map((chip) => (
					<button
						key={chip.value || "all"}
						onClick={() => setStatusFilter(chip.value)}
						className={`chip ${statusFilter === chip.value ? "live" : ""}`}
						style={{
							background: statusFilter === chip.value ? "var(--accent-muted)" : "var(--background)",
							borderColor: statusFilter === chip.value ? "var(--accent)" : "var(--border)",
						}}
					>
						{chip.label}
					</button>
				))}
			</div>
		</div>
	);

	const listBody = (
		<>
			{loading ? (
				<div className="p-4 text-muted text-xs">Loading proposals…</div>
			) : (
				GROUP_ORDER.map((status) => {
					const items = grouped[status];
					if (items.length === 0) return null;
					return (
						<div key={status}>
							<MDGroup>
								{GROUP_LABELS[status]} · {items.length}
							</MDGroup>
							{items.map((p) => {
								const ds = BACKEND_TO_DISPLAY[p.status];
								const abstain = p.votesAbstain ?? 0;
								return (
									<MDItem
										key={p.id}
										idx={<Tag tone={getTagTone(ds)}>{p.id}</Tag>}
										title={p.title}
										sub={formatTimeLeft(p.endsAt)}
										right={
											<MiniVoteBar
												forVotes={p.votesFor}
												againstVotes={p.votesAgainst}
												abstain={abstain}
											/>
										}
										selected={selectedId === p.id}
										onClick={() => setSelectedId(p.id)}
									/>
								);
							})}
						</div>
					);
				})
			)}
		</>
	);

	const detailHeader = selectedProposal ? (
		<>
			<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
				<Tag tone={getTagTone(BACKEND_TO_DISPLAY[selectedProposal.status])}>
					{BACKEND_TO_DISPLAY[selectedProposal.status]}
				</Tag>
				<h2 style={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.012, margin: 0 }}>
					{selectedProposal.id}
				</h2>
			</div>
			<span style={{ fontSize: 11, color: "var(--muted)" }}>{formatTimeLeft(selectedProposal.endsAt)}</span>
		</>
	) : (
		<div className="eyebrow">Select a proposal</div>
	);

	const detailBody = selectedProposal ? (
		<ProposalDetail proposal={selectedProposal} />
	) : (
		<div className="flex items-center justify-center h-full text-muted">
			Select a proposal to view details and vote
		</div>
	);

	return (
		<MasterDetail
			collapseKey="governance"
			listHeader={listHeader}
			listBody={listBody}
			detailHeader={detailHeader}
			detailBody={detailBody}
		/>
	);
}
