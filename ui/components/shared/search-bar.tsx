"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SEARCH_DEBOUNCE } from "@/lib/constants";

interface SearchBarProps {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	selectedTags: string[];
	onTagsChange: (tags: string[]) => void;
	statusFilter: "All" | "Active" | "Inactive";
	onStatusChange: (status: "All" | "Active" | "Inactive") => void;
}

const availableTags = [
	{ label: "Yield", value: "yield" },
	{ label: "Airdrop", value: "airdrop" },
	{ label: "Stablecoin", value: "stablecoin" },
	{ label: "Looping", value: "looping" },
	{ label: "Points", value: "points" },
	{ label: "Nativecoin", value: "nativecoin" },
];

export function SearchBar({
	searchQuery,
	onSearchChange,
	selectedTags,
	onTagsChange,
	statusFilter,
	onStatusChange,
}: SearchBarProps) {
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleSearchInput = useCallback(
		(value: string) => {
			if (debounceTimerRef.current !== null) {
				clearTimeout(debounceTimerRef.current);
			}

			debounceTimerRef.current = setTimeout(() => {
				onSearchChange(value);
			}, SEARCH_DEBOUNCE);
		},
		[onSearchChange],
	);

	const clearAll = () => {
		onSearchChange("");
		onTagsChange([]);
		onStatusChange("All");
	};

	const toggleTag = (value: string) => {
		if (selectedTags.includes(value)) {
			onTagsChange(selectedTags.filter((t) => t !== value));
		} else {
			onTagsChange([...selectedTags, value]);
		}
	};

	const hasActiveFilters = searchQuery || selectedTags.length > 0 || statusFilter !== "All";

	return (
		<div className="space-y-4">
			<div className="flex gap-3">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
					<Input
						placeholder="Search title, asset, agent or chain"
						className="pl-10 bg-card border-border"
						value={searchQuery}
						onChange={(e) => handleSearchInput(e.target.value)}
					/>
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" className="gap-2 bg-card/50 border-border hover:bg-accent/10">
							<SlidersHorizontal className="w-4 h-4" />
							Filters
							{selectedTags.length > 0 && (
								<Badge
									variant="secondary"
									className="ml-1 h-5 w-5 p-0 flex items-center justify-center bg-accent text-foreground"
								>
									{selectedTags.length}
								</Badge>
							)}
						</Button>
					</DropdownMenuTrigger>

					<DropdownMenuContent align="end" className="w-56">
						<DropdownMenuLabel>Filter by Tags</DropdownMenuLabel>
						<DropdownMenuSeparator />

						{availableTags.map((tag) => (
							<DropdownMenuCheckboxItem
								key={tag.value}
								checked={selectedTags.includes(tag.value)}
								onCheckedChange={() => toggleTag(tag.value)}
							>
								{tag.label}
							</DropdownMenuCheckboxItem>
						))}

						{selectedTags.length > 0 && (
							<>
								<DropdownMenuSeparator />
								<Button
									variant="outline"
									size="sm"
									className="w-full"
									onClick={() => onTagsChange([])}
								>
									Clear
								</Button>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>

				{hasActiveFilters && (
					<Button
						variant="default"
						size="sm"
						onClick={clearAll}
						className="gap-2 mt-0.5  hover:bg-destructive/10 hover:text-destructive border-border"
					>
						Clear
					</Button>
				)}
			</div>

			<div className="flex gap-2 flex-wrap">
				{availableTags.map((tag) => (
					<Badge
						key={tag.value}
						variant="secondary"
						onClick={() => toggleTag(tag.value)}
						className={
							selectedTags.includes(tag.value)
								? "bg-primary text-primary-foreground cursor-pointer"
								: "bg-card/80 border border-border cursor-pointer"
						}
					>
						{tag.label}
					</Badge>
				))}
			</div>
		</div>
	);
}
