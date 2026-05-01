"use client";
import { useState, useMemo } from "react";
import { SearchBar } from "@/components/shared/search-bar";
import { StrategyCard } from "./strategy-card";
import type { Strategy } from "@/types/strategy.interface";
import Link from "next/link";

interface Props {
  strategies: Strategy[];
}

export function StrategyList({ strategies }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    "All" | "Active" | "Inactive"
  >("All");

  const filtered = useMemo(() => {
    let data = strategies;
    if (searchQuery)
      data = data.filter((s) =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    if (selectedTags.length > 0)
      data = data.filter((s) => selectedTags.every((t) => s.tags?.includes(t)));
    if (statusFilter !== "All")
      data = data.filter((s) => s.status === statusFilter);
    return data;
  }, [strategies, searchQuery, selectedTags, statusFilter]);

  return (
    <div className="space-y-4">
      <SearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
      />
      {filtered.length === 0 && (
        <div className="py-12 text-center border border-border">
          <p className="text-muted text-sm mb-3">
            no strategies match your filters
          </p>
          <Link href="/builder" className="text-xs text-accent hover:underline">
            build one →
          </Link>
        </div>
      )}
      {filtered.length > 0 && (
        <div className="grid gap-4">
          {filtered.map((s) => (
            <StrategyCard key={s.id} strategy={s} />
          ))}
        </div>
      )}
    </div>
  );
}
