"use client";

import React, { useEffect, useRef, useState } from "react";

export interface MasterDetailProps {
	listHeader?: React.ReactNode;
	listBody: React.ReactNode;
	detailHeader?: React.ReactNode;
	detailBody: React.ReactNode;
	collapseKey?: string;
	detailFullBleed?: boolean;
	className?: string;
}

export function MasterDetail({
	listHeader,
	listBody,
	detailHeader,
	detailBody,
	collapseKey,
	detailFullBleed,
	className = "",
}: MasterDetailProps): JSX.Element {
	const [listOpen, setListOpen] = useState(true);
	const frameRef = useRef<HTMLElement>(null);

	// Restore collapsed state from localStorage
	useEffect(() => {
		if (!collapseKey) return;
		try {
			const saved = localStorage.getItem("fheforge:md:" + collapseKey);
			if (saved === "0") setListOpen(false);
		} catch {
			// localStorage unavailable
		}
	}, [collapseKey]);

	// Persist collapsed state
	useEffect(() => {
		if (!collapseKey) return;
		try {
			localStorage.setItem("fheforge:md:" + collapseKey, listOpen ? "1" : "0");
		} catch {
			// localStorage unavailable
		}
	}, [listOpen, collapseKey]);

	// Keyboard shortcuts: ⌘B, J/K, Enter
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				e.target instanceof HTMLSelectElement
			) {
				return;
			}

			// ⌘B / Ctrl+B toggle
			if ((e.metaKey || e.ctrlKey) && e.key === "b") {
				e.preventDefault();
				setListOpen((o) => !o);
				return;
			}

			// J/K / ArrowDown/ArrowUp vim-style navigation
			if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
				const items = frameRef.current?.querySelectorAll(".md-list-body .md-item");
				if (!items?.length) return;
				e.preventDefault();
				const arr = Array.from(items);
				const currentIdx = arr.findIndex((el) => el.classList.contains("selected"));
				const forward = e.key === "j" || e.key === "ArrowDown";
				const nextIdx =
					currentIdx === -1
						? forward
							? 0
							: arr.length - 1
						: forward
							? (currentIdx + 1) % arr.length
							: (currentIdx - 1 + arr.length) % arr.length;
				(arr[nextIdx] as HTMLElement)?.click();
				arr[nextIdx].scrollIntoView({ block: "nearest", behavior: "smooth" });
			}
		};

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<main
			ref={frameRef}
			className={`md-frame ${listOpen ? "" : "md-list-closed"} ${className}`}
		>
			<aside className="md-list">
				{listHeader && <div className="md-list-header">{listHeader}</div>}
				<div className="md-list-body">{listBody}</div>
			</aside>
			<section className="md-detail">
				{detailHeader && <div className="md-detail-header">{detailHeader}</div>}
				<div
					className="md-detail-body"
					style={
						detailFullBleed
							? { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }
							: undefined
					}
				>
					{detailBody}
				</div>
			</section>
			<button
				className="md-rail-toggle"
				onClick={() => setListOpen((o) => !o)}
				title={listOpen ? "Hide list · ⌘B" : "Show list · ⌘B"}
				aria-label={listOpen ? "Hide list panel" : "Show list panel"}
			>
				{listOpen ? "‹" : "›"}
			</button>
		</main>
	);
}
