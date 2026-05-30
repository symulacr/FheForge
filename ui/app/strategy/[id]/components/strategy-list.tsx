"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SearchBar } from "@/components/shared/search-bar";
import type { Strategy } from "@/types/strategy.interface";
import { StrategyCard } from "./strategy-card";

interface Props {
	strategies: Strategy[];
}

export function StrategyList({ strategies }: Props) {
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Inactive">("All");

	const filtered = useMemo(() => {
		let data = strategies;
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			data = data.filter((s) => s.title?.toLowerCase().includes(query));
		}
		if (selectedTags.length > 0) {
			data = data.filter((s) => selectedTags.every((t) => s.tags?.includes(t)));
		}
		if (statusFilter !== "All") {
			data = data.filter((s) => s.status === statusFilter);
		}
		return data;
	}, [strategies, searchQuery, selectedTags, statusFilter]);

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h3 className="text-lg font-medium text-foreground">All Strategies</h3>
				<span className="text-xs text-muted tabular-nums">
					{filtered.length} {filtered.length === 1 ? "strategy" : "strategies"}
				</span>
			</div>

			{/* Search & Filters */}
			<SearchBar
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
				selectedTags={selectedTags}
				onTagsChange={setSelectedTags}
				statusFilter={statusFilter}
				onStatusChange={setStatusFilter}
			/>

			{/* Results */}
			{filtered.length === 0 ? (
				<div className="forge-card py-12 text-center">
					<p className="text-muted text-sm mb-2">No strategies match your filters</p>
					<Link href="/builder" className="text-xs text-accent hover:underline">
						Build one
					</Link>
				</div>
			) : (
				<div className="grid gap-3">
					{filtered.map((s) => (
						<StrategyCard key={s.id} strategy={s} />
					))}
				</div>
			)}
		</div>
	);
}
