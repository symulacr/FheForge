"use client";

import React from "react";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  className,
}) => {
  if (totalPages <= 1) return null;

  const getVisiblePages = () => {
    const delta = 2;
    const start = Math.max(1, page - delta);
    const end = Math.min(totalPages, page + delta);
    const pages = [];

    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push("ellipsis-start");
    }

    for (let i = start; i <= end; i++) pages.push(i);

    if (end < totalPages) {
      if (end < totalPages - 1) pages.push("ellipsis-end");
      pages.push(totalPages);
    }

    return pages;
  };

  const baseBtn =
    "px-3 py-2 border border-border bg-transparent text-muted-foreground hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-2 mt-6 ${className || ""}`}
    >
      <button
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className={baseBtn}
      >
        ←
      </button>
      <button
        disabled={page === 1}
        onClick={() => onPageChange(1)}
        className={baseBtn}
      >
        «
      </button>

      <div className="flex items-center gap-1">
        {getVisiblePages().map((p, i) =>
          typeof p === "number" ? (
            <button
              key={i}
              onClick={() => onPageChange(p)}
              className={`px-3 py-1 border transition-colors ${
                p === page
                  ? "border-accent text-accent bg-accent/10"
                  : "border-border text-muted-foreground hover:border-accent hover:text-accent bg-transparent"
              }`}
            >
              {p}
            </button>
          ) : (
            <span key={i} className="px-2 text-muted">
              …
            </span>
          ),
        )}
      </div>

      <button
        disabled={page === totalPages}
        onClick={() => onPageChange(totalPages)}
        className={baseBtn}
      >
        »
      </button>
      <button
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        className={baseBtn}
      >
        →
      </button>
    </div>
  );
};

export default Pagination;
