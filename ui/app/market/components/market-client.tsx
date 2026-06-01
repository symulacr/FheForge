"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useStrategies } from "@/hooks/use-strategies";
import { MasterDetail } from "@/components/shared/master-detail";
import { MDGroup } from "@/components/shared/md-group";
import { MDItem } from "@/components/shared/md-item";
import { getStrategies, createStrategyWorkflow, deleteStrategy } from "@/services/defi-module-service";
import type { DefiStrategy, StrategyStep } from "@/types/defi.strategy";
import type { CreateStrategyRequest } from "@/types/defi";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface LocalDraft {
	id: string;
	name: string;
	steps: StrategyStep[];
	edges: { from: string; to: string }[];
	forkedFrom?: string;
}

type RiskLevel = "all" | "low" | "med" | "high";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "fheforge:market:drafts:v1";

const TEMPLATE_NODES = [
	{ id: "n1", type: "supply", config: { token: "USDC", amount: 1000 } },
	{ id: "n2", type: "borrow", config: { token: "ETH", amount: 0.5 } },
];

const TEMPLATE_EDGES = [{ from: "n1", to: "n2" }];

const RISK_DOT_COLOR: Record<string, string> = {
	low: "#22c55e",
	med: "#3b82f6",
	high: "#ef4444",
};

/* ------------------------------------------------------------------ */
/* localStorage helpers                                                 */
/* ------------------------------------------------------------------ */

function loadLocalDrafts(): LocalDraft[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) return parsed as LocalDraft[];
		}
	} catch {
		/* ignore */
	}
	return [
		{
			id: "d-default",
			name: "Lean USDC leverage v3",
			steps: [],
			edges: TEMPLATE_EDGES.map((e) => ({ ...e })),
		},
	];
}

function saveLocalDrafts(drafts: LocalDraft[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
	} catch {
		/* ignore */
	}
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function EmptyDetail({ onCreateBlank, onCreateTemplate }: { onCreateBlank: () => void; onCreateTemplate: () => void }): JSX.Element {
	return (
		<div className="flex items-center justify-center h-full min-h-[400px]">
			<div className="text-center max-w-md">
				<h2 className="text-[28px] leading-[1.15] font-medium tracking-tight">
					Pick a draft or fork a template.
				</h2>
				<p className="text-muted mt-3 mb-5 leading-relaxed">
					Strategies are visual pipelines that compile to a single on-chain call. Build from scratch,
					fork the market, or start with a template.
				</p>
				<div className="flex items-center justify-center gap-2">
					<button
						onClick={onCreateBlank}
						className="border border-accent text-accent px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-accent hover:text-background transition-colors"
					>
						Start blank →
					</button>
					<button
						onClick={onCreateTemplate}
						className="border border-border text-muted px-3 py-1.5 text-xs uppercase tracking-wider hover:border-accent hover:text-accent transition-colors"
					>
						Use a template
					</button>
				</div>
			</div>
		</div>
	);
}

function BuilderPlaceholder({ name }: { name: string }): JSX.Element {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-4">
			<div className="bg-card border border-border p-6 max-w-md w-full">
				<h3 className="text-sm font-medium mb-2">{name}</h3>
				<p className="text-muted text-xs leading-relaxed mb-4">
					Builder canvas — ReactFlow integration loads here.
				</p>
				<div className="border border-border border-dashed p-8 flex items-center justify-center">
					<span className="text-muted text-xs">ReactFlow canvas placeholder</span>
				</div>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function MarketClient(): JSX.Element {
	const { address, isConnected } = useAccount();
	const { strategies: beDrafts, loading: draftsLoading } = useStrategies(address);
	const { data: communityRaw, isLoading: communityLoading } = useQuery<DefiStrategy[]>({
		queryKey: ["strategies", "community"],
		queryFn: getStrategies,
	});

	const [localDrafts, setLocalDrafts] = useState<LocalDraft[]>(loadLocalDrafts);
	const [selectedId, setSelectedId] = useState<string | null>(localDrafts[0]?.id || null);
	const [query, setQuery] = useState("");
	const [riskFilter, setRiskFilter] = useState<RiskLevel>("all");
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

	/* Persist local drafts */
	useEffect(() => {
		saveLocalDrafts(localDrafts);
	}, [localDrafts]);

	/* Merge BE drafts with local drafts */
	const mergedDrafts = useMemo<LocalDraft[]>(() => {
		const be = (beDrafts || [])
			.filter((s) => (s.status || "draft") === "draft")
			.map((s) => ({
				id: s.id,
				name: s.name || "Unnamed",
				steps: s.steps || [],
				edges: [] as { from: string; to: string }[],
			}));
		return [...localDrafts, ...be];
	}, [localDrafts, beDrafts]);

	/* Filtered drafts */
	const filteredDrafts = useMemo(() => {
		if (!query) return mergedDrafts;
		return mergedDrafts.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()));
	}, [mergedDrafts, query]);

	/* Community strategies */
	const communityStrategies = useMemo(() => {
		const c = (communityRaw || []).filter((s) => s.is_public || (s.status || "draft") !== "draft");
		if (!query && riskFilter === "all") return c;
		return c.filter((s) => {
			const matchesQuery = !query || (s.name || "").toLowerCase().includes(query.toLowerCase());
			const matchesRisk =
				riskFilter === "all" ||
				(s.tags?.some((t) => t.toLowerCase() === riskFilter) ?? false) ||
				(s.description || "").toLowerCase().includes(riskFilter);
			return matchesQuery && matchesRisk;
		});
	}, [communityRaw, query, riskFilter]);

	/* Selected item */
	const selectedDraft = useMemo(() => filteredDrafts.find((d) => d.id === selectedId) || null, [filteredDrafts, selectedId]);
	const selectedCommunity = useMemo(
		() => communityStrategies.find((c) => c.id === selectedId) || null,
		[communityStrategies, selectedId]
	);
	const isDraftSelected = !!selectedDraft;

	/* Actions */
	const createDraft = useCallback((fromTemplate = false) => {
		const id = `d-${Date.now().toString(36)}`;
		const draft: LocalDraft = {
			id,
			name: fromTemplate ? `New strategy · ${mergedDrafts.length + 1}` : `Blank · ${mergedDrafts.length + 1}`,
			steps: [],
			edges: fromTemplate
				? TEMPLATE_EDGES.map((e, i) => ({
						from: `${TEMPLATE_NODES[0].id}-${i}`,
						to: `${TEMPLATE_NODES[1].id}-${i}`,
					}))
				: [],
		};
		setLocalDrafts((prev) => [draft, ...prev]);
		setSelectedId(id);
	}, [mergedDrafts.length]);

	const deleteDraft = useCallback((id: string) => {
		setLocalDrafts((prev) => prev.filter((d) => d.id !== id));
		setConfirmDeleteId(null);
		if (selectedId === id) {
			setSelectedId(null);
		}
		/* Also try backend delete if it looks like a BE id */
		if (!id.startsWith("d-")) {
			deleteStrategy(id).catch(() => {
				/* swallow — local state already updated */
			});
		}
	}, [selectedId]);

	const forkCommunity = useCallback(
		async (strategy: DefiStrategy) => {
			if (!address) return;
			const payload: CreateStrategyRequest = {
				owner_id: address,
				name: `${strategy.name || "Unnamed"} (fork)`,
				description: `Forked from ${strategy.strategistHandle || strategy.handle || "community"}`,
				is_public: false,
				chain_context: strategy.chain_context || "arbitrum-sepolia",
				status: "draft",
				workflow_json: strategy.defi_strategy_versions?.[0]?.workflow_json || {},
				workflow_graph: strategy.defi_strategy_versions?.[0]?.workflow_graph || {},
			};
			try {
				const created = (await createStrategyWorkflow(payload)) as DefiStrategy;
				if (created?.id) {
					setSelectedId(created.id);
				}
			} catch {
				/* Fallback: create local draft */
				const id = `d-${Date.now().toString(36)}`;
				const draft: LocalDraft = {
					id,
					name: `${strategy.name || "Unnamed"} (fork)`,
					steps: strategy.steps || [],
					edges: [],
					forkedFrom: strategy.strategistHandle || strategy.handle || "community",
				};
				setLocalDrafts((prev) => [draft, ...prev]);
				setSelectedId(id);
			}
		},
		[address]
	);

	/* Render helpers */
	const squareDot = (
		<span
			style={{
				width: 8,
				height: 8,
				background: "#e0e0e0",
				display: "inline-block",
				flexShrink: 0,
			}}
		/>
	);

	const riskDot = (risk: string) => (
		<span
			style={{
				width: 8,
				height: 8,
				background: RISK_DOT_COLOR[risk] || "#888888",
				display: "inline-block",
				flexShrink: 0,
			}}
		/>
	);

	/* Connected gate */
	if (!isConnected) {
		return (
			<div className="flex items-center justify-center h-[calc(100vh-56px)]">
				<div className="text-center">
					<div className="eyebrow mb-4">Market</div>
					<p className="text-muted mb-6">Connect your wallet to view strategies</p>
				</div>
			</div>
		);
	}

	const listHeader = (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<span className="eyebrow">Strategies</span>
				<div className="flex items-center gap-1.5">
					<button
						onClick={() => createDraft(false)}
						className="border border-border text-muted px-2 py-1 text-[10px] uppercase tracking-wider hover:border-accent hover:text-accent transition-colors"
						title="Start from a blank canvas"
					>
						+ New
					</button>
					<button
						onClick={() => createDraft(true)}
						className="border border-border text-muted px-2 py-1 text-[10px] uppercase tracking-wider hover:border-accent hover:text-accent transition-colors"
						title="Start from a template"
					>
						+ Template
					</button>
				</div>
			</div>
			<input
				type="text"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search…"
				className="w-full bg-input border border-border p-[7px] text-foreground text-xs outline-none focus:border-accent font-mono"
			/>
		</div>
	);

	const listBody = (
		<>
			{/* Your drafts */}
			<MDGroup>Your drafts · {filteredDrafts.length}</MDGroup>
			{draftsLoading && filteredDrafts.length === 0 ? (
				<div className="p-4 text-muted text-xs">Loading drafts…</div>
			) : null}
			{filteredDrafts.length === 0 && !draftsLoading ? (
				<div className="p-4 text-muted text-xs">
					No drafts yet. Start blank or fork a template below.
				</div>
			) : null}
			{filteredDrafts.map((d) => {
				const isConfirming = confirmDeleteId === d.id;
				const stepCount = d.steps?.length ?? 0;
				const edgeCount = d.edges?.length ?? 0;
				return (
					<MDItem
						key={d.id}
						idx={squareDot}
						title={d.name}
						sub={`${stepCount} step${stepCount === 1 ? "" : "s"} · ${edgeCount} link${edgeCount === 1 ? "" : "s"}`}
						selected={selectedId === d.id}
						onClick={() => setSelectedId(d.id)}
						right={
							isConfirming ? (
								<span className="flex items-center gap-1">
									<button
										onClick={(e) => {
											e.stopPropagation();
											deleteDraft(d.id);
										}}
										className="border border-destructive bg-destructive text-background px-2 py-[3px] text-[10px] uppercase tracking-wider cursor-pointer"
									>
										Delete
									</button>
									<button
										onClick={(e) => {
											e.stopPropagation();
											setConfirmDeleteId(null);
										}}
										className="border border-border bg-card text-muted px-2 py-[3px] text-[10px] uppercase tracking-wider cursor-pointer"
									>
										Keep
									</button>
								</span>
							) : (
								<button
									onClick={(e) => {
										e.stopPropagation();
										setConfirmDeleteId(d.id);
									}}
									className="border-0 bg-transparent text-muted cursor-pointer text-sm px-1.5 py-0.5 hover:text-foreground"
									title="Delete draft"
								>
									×
								</button>
							)
						}
					/>
				);
			})}

			{/* Community */}
			<MDGroup>
				<div className="flex items-center justify-between">
					<span>Community · {communityStrategies.length} of {communityRaw?.length ?? 0}</span>
					<select
						value={riskFilter}
						onChange={(e) => setRiskFilter(e.target.value as RiskLevel)}
						className="bg-card text-muted border border-border px-1.5 py-[2px] text-[10px] uppercase tracking-wider outline-none focus:border-accent font-mono cursor-pointer"
					>
						{["all", "low", "med", "high"].map((o) => (
							<option key={o} value={o}>
								{o}
							</option>
						))}
					</select>
				</div>
			</MDGroup>
			{communityLoading ? (
				<div className="p-4 text-muted text-xs">Loading community…</div>
			) : null}
			{communityStrategies.length === 0 && !communityLoading ? (
				<div className="p-4 text-muted text-xs">No matching strategies. Clear filter or search.</div>
			) : null}
			{communityStrategies.map((c) => {
				const riskTag = c.tags?.find((t) => ["low", "med", "high"].includes(t.toLowerCase()))?.toLowerCase() || "med";
				const apy = c.apy ?? 0;
				const deployers = (c as DefiStrategy & { deployers?: number }).deployers ?? 0;
				return (
					<MDItem
						key={c.id}
						idx={riskDot(riskTag)}
						title={c.name || "Unnamed"}
						sub={`apy ${apy.toFixed(1)}% · ${deployers} deployers`}
						selected={selectedId === c.id}
						onClick={() => setSelectedId(c.id)}
						right={
							<button
								onClick={(e) => {
									e.stopPropagation();
									forkCommunity(c);
								}}
								className="border border-border text-muted px-2 py-[3px] text-[10px] uppercase tracking-wider hover:border-accent hover:text-accent transition-colors cursor-pointer"
								title="Fork as a new draft"
							>
								Fork
							</button>
						}
					/>
				);
			})}
		</>
	);

	const detailHeader = isDraftSelected
		? <div className="eyebrow">{selectedDraft?.name || "Draft"}</div>
		: selectedCommunity
			? <div className="eyebrow">{selectedCommunity.name || "Community"}</div>
			: null;

	const detailBody = isDraftSelected ? (
		<BuilderPlaceholder name={selectedDraft?.name || "Draft"} />
	) : selectedCommunity ? (
		<div className="fade-enter space-y-4">
			<div className="bg-card border border-border p-4">
				<div className="kv">
					<span className="k">name</span>
					<span className="v">{selectedCommunity.name || "–"}</span>
				</div>
				<div className="kv">
					<span className="k">description</span>
					<span className="v">{selectedCommunity.description || "–"}</span>
				</div>
				<div className="kv">
					<span className="k">apy</span>
					<span className="v">{selectedCommunity.apy != null ? `${selectedCommunity.apy.toFixed(1)}%` : "–"}</span>
				</div>
				<div className="kv">
					<span className="k">status</span>
					<span className="v">{selectedCommunity.status || "–"}</span>
				</div>
				<div className="kv">
					<span className="k">public</span>
					<span className="v">{selectedCommunity.is_public ? "yes" : "no"}</span>
				</div>
			</div>
		</div>
	) : (
		<EmptyDetail onCreateBlank={() => createDraft(false)} onCreateTemplate={() => createDraft(true)} />
	);

	return (
		<MasterDetail
			collapseKey="market"
			listHeader={listHeader}
			listBody={listBody}
			detailHeader={detailHeader}
			detailBody={detailBody}
			detailFullBleed={isDraftSelected}
		/>
	);
}
