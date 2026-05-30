"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useRef } from "react";
import { SEARCH_DEBOUNCE } from "@/lib/constants";

interface SearchBarProps {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	selectedTags: string[];
	onTagsChange: (tags: string[]) => void;
	statusFilter: "All" | "Active" | "Inactive";
	onStatusChange: (status: "All" | "Active" | "Inactive") => void;
}

const AVAILABLE_TAGS = [
	{ label: "Yield", value: "yield" },
	{ label: "Airdrop", value: "airdrop" },
	{ label: "Stablecoin", value: "stablecoin" },
	{ label: "Looping", value: "looping" },
	{ label: "Points", value: "points" },
	{ label: "Nativecoin", value: "nativecoin" },
] as const;

export function SearchBar({
	searchQuery,
	onSearchChange,
	selectedTags,
	onTagsChange,
	statusFilter,
	onStatusChange,
}: SearchBarProps) {
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleSearchInput = useCallback(
		(value: string) => {
			if (debounceTimerRef.current !== null) {
				clearTimeout(debounceTimerRef.current);
			}
			debounceTimerRef.current = setTimeout(() => {
				onSearchChange(value);
			}, SEARCH_DEBOUNCE);
		},
		[onSearchChange]
	);

	const clearAll = useCallback(() => {
		onSearchChange("");
		onTagsChange([]);
		onStatusChange("All");
		if (inputRef.current) {
			inputRef.current.value = "";
		}
	}, [onSearchChange, onTagsChange, onStatusChange]);

	const toggleTag = useCallback(
		(value: string) => {
			if (selectedTags.includes(value)) {
				onTagsChange(selectedTags.filter((t) => t !== value));
			} else {
				onTagsChange([...selectedTags, value]);
			}
		},
		[selectedTags, onTagsChange]
	);

	const hasActiveFilters = searchQuery || selectedTags.length > 0 || statusFilter !== "All";

	return (
		<div className="space-y-3">
			{/* Search Row */}
			<div className="flex gap-2">
				<div className="relative flex-1">
					<Search
						className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
						aria-hidden="true"
					/>
					<input
						ref={inputRef}
						type="search"
						placeholder="Search strategies..."
						defaultValue={searchQuery}
						onChange={(e) => handleSearchInput(e.target.value)}
						className="w-full h-9 pl-9 pr-3 bg-card border border-border text-sm text-foreground placeholder:text-muted transition-colors focus:outline-none focus:border-accent"
						aria-label="Search strategies"
					/>
				</div>

				{/* Filter Count */}
				{selectedTags.length > 0 && (
					<div className="flex items-center gap-1 px-2 text-xs text-accent border border-accent/30 bg-accent/5">
						<SlidersHorizontal className="w-3 h-3" />
						<span className="tabular-nums">{selectedTags.length}</span>
					</div>
				)}

				{/* Clear Button */}
				{hasActiveFilters && (
					<button
						onClick={clearAll}
						className="terminal-btn danger text-xs px-2"
						aria-label="Clear all filters"
					>
						<X className="w-3 h-3" />
						Clear
					</button>
				)}
			</div>

			{/* Tag Chips */}
			<div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filter by tags">
				{AVAILABLE_TAGS.map((tag) => {
					const isSelected = selectedTags.includes(tag.value);
					return (
						<button
							key={tag.value}
							onClick={() => toggleTag(tag.value)}
							className={`px-2 py-1 text-xs transition-colors ${
								isSelected
									? "bg-accent text-background border border-accent"
									: "bg-card border border-border text-muted hover:border-accent/50 hover:text-foreground"
							}`}
							aria-pressed={isSelected}
						>
							{tag.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}
