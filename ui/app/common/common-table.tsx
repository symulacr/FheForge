"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { List } from "react-window";

export interface TableColumn<T> {
	key: keyof T | string;
	label: string;
	render?: (row: T) => React.ReactNode;
	className?: string;
}

interface CommonTableProps<T> {
	data: T[];
	columns: TableColumn<T>[];
	expandable?: (row: T) => React.ReactNode;
	loading?: boolean;
	error?: string | null;
	gridCols?: string;
	virtualized?: boolean;
	listHeight?: number;
}

const COLLAPSED_ROW_HEIGHT = 48;
const ROW_GAP = 12;
const COLLAPSED_ITEM_SIZE = COLLAPSED_ROW_HEIGHT + ROW_GAP;
const EXPANDED_EXTRA_HEIGHT = 260;

interface TableRowProps<T> {
	data: T[];
	columns: TableColumn<T>[];
	expandable?: (row: T) => React.ReactNode;
	expanded: string | null;
	gridCols: string;
	toggleExpand: (id: string) => void;
}

function VirtualRow<T extends { id: string }>(
	props: {
		index: number;
		style: React.CSSProperties;
		ariaAttributes: {
			"aria-posinset": number;
			"aria-setsize": number;
			role: "listitem";
		};
	} & TableRowProps<T>,
) {
	const { index, style, data, columns, expandable, expanded, gridCols, toggleExpand } = props;
	const row = data[index];
	if (!row) return null;

	return (
		<div
			style={style}
			className="border border-border bg-card shadow-lg overflow-hidden hover:border-accent/50 transition-colors duration-300"
		>
			<div
				className={`relative grid ${gridCols} items-center text-sm text-card-foreground px-6 py-3 pr-12`}
			>
				{columns.map((col) => (
					<div key={String(col.key)} className={col.className}>
						{col.render ? col.render(row) : (row[col.key as keyof T] as React.ReactNode)}
					</div>
				))}
				{expandable && (
					<button
						onClick={() => toggleExpand(row.id)}
						className={`absolute top-1/2 right-5 -translate-y-1/2 text-muted-foreground hover:text-primary transition-all duration-300 ${
							expanded === row.id ? "rotate-180" : "rotate-0"
						}`}
					>
						<ChevronDown size={18} />
					</button>
				)}
			</div>
			<AnimatePresence initial={false}>
				{expandable && expanded === row.id && (
					<motion.div
						initial={{ opacity: 0, scaleY: 0.8 }}
						animate={{ opacity: 1, scaleY: 1 }}
						exit={{ opacity: 0, scaleY: 0.8 }}
						transition={{ duration: 0.25, ease: "easeOut" }}
						style={{ originY: 0 }}
						className="bg-secondary border-t border-border px-14 py-5 text-sm"
					>
						{expandable(row)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export function CommonTable<T extends { id: string }>({
	data,
	columns,
	expandable,
	loading,
	error,
	gridCols = "grid-cols-5",
	virtualized = false,
	listHeight = 600,
}: CommonTableProps<T>) {
	const [expanded, setExpanded] = useState<string | null>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	const observerRef = useRef<ResizeObserver | null>(null);

	const containerRefCallback = useCallback((el: HTMLDivElement | null) => {
		if (observerRef.current) {
			observerRef.current.disconnect();
			observerRef.current = null;
		}
		if (!el) return;
		setContainerWidth(el.clientWidth);
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setContainerWidth(entry.contentRect.width);
			}
		});
		observer.observe(el);
		observerRef.current = observer;
	}, []);

	const toggleExpand = useCallback((id: string) => {
		setExpanded((prev) => (prev === id ? null : id));
	}, []);

	const rowHeight = useCallback((index: number, rowProps: TableRowProps<T>) => {
		const row = rowProps.data[index];
		if (!row) return COLLAPSED_ITEM_SIZE;
		if (rowProps.expandable && rowProps.expanded === row.id) {
			return COLLAPSED_ITEM_SIZE + EXPANDED_EXTRA_HEIGHT;
		}
		return COLLAPSED_ITEM_SIZE;
	}, []);

	const actualHeight = useMemo(() => {
		if (!virtualized) return 0;
		const estimatedTotal =
			data.length * COLLAPSED_ITEM_SIZE + (expanded ? EXPANDED_EXTRA_HEIGHT : 0);
		return Math.min(Math.max(estimatedTotal, 200), listHeight);
	}, [data.length, expanded, listHeight, virtualized]);

	if (loading) return <div className="text-center py-4 text-muted-foreground">Loading...</div>;
	if (error) return <div className="text-center py-4 text-destructive">{error}</div>;

	const header = (
		<div
			className={`grid ${gridCols} items-center bg-card text-foreground text-sm font-semibold px-6 py-3 border border-border`}
		>
			{columns.map((col) => (
				<div key={String(col.key)} className={col.className}>
					{col.label}
				</div>
			))}
		</div>
	);

	if (!virtualized) {
		return (
			<div className="space-y-3">
				{header}
				{data.map((row) => (
					<div
						key={row.id}
						className="border border-border bg-card shadow-lg overflow-hidden hover:border-accent/50 transition-colors duration-300"
					>
						<div
							className={`relative grid ${gridCols} items-center text-sm text-card-foreground px-6 py-3 pr-12`}
						>
							{columns.map((col) => (
								<div key={String(col.key)} className={col.className}>
									{col.render ? col.render(row) : (row[col.key as keyof T] as React.ReactNode)}
								</div>
							))}
							{expandable && (
								<button
									onClick={() => toggleExpand(row.id)}
									className={`absolute top-1/2 right-5 -translate-y-1/2 text-muted-foreground hover:text-primary transition-all duration-300 ${
										expanded === row.id ? "rotate-180" : "rotate-0"
									}`}
								>
									<ChevronDown size={18} />
								</button>
							)}
						</div>
						<AnimatePresence initial={false}>
							{expandable && expanded === row.id && (
								<motion.div
									initial={{ opacity: 0, scaleY: 0.8 }}
									animate={{ opacity: 1, scaleY: 1 }}
									exit={{ opacity: 0, scaleY: 0.8 }}
									transition={{ duration: 0.25, ease: "easeOut" }}
									style={{ originY: 0 }}
									className="bg-secondary border-t border-border px-14 py-5 text-sm"
								>
									{expandable(row)}
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				))}
			</div>
		);
	}

	const rowProps = {
		data,
		columns,
		expandable,
		expanded,
		gridCols,
		toggleExpand,
	};

	return (
		<div className="space-y-3">
			{header}
			<div ref={containerRefCallback} style={{ height: actualHeight }}>
				{containerWidth > 0 && (
					<List<TableRowProps<T>>
						rowCount={data.length}
						rowHeight={rowHeight}
						rowComponent={VirtualRow}
						rowProps={rowProps}
						style={{ height: actualHeight, width: containerWidth }}
					/>
				)}
			</div>
		</div>
	);
}
