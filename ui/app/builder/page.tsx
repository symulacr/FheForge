"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ErrorBoundary } from "@/components/shared/error-boundary";

const BuilderPage = dynamic(() => import("./components/BuilderPage"), {
	ssr: false,
	loading: () => (
		<div className="flex items-center justify-center flex-1">
			<span className="terminal-loading">initializing</span>
		</div>
	),
});

function BuilderFallback() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<div className="max-w-sm w-full text-center space-y-4 p-6">
				<h2 className="text-lg font-semibold tracking-tight">Builder encountered an error</h2>
				<p className="text-muted-foreground text-sm">
					Something went wrong in the strategy builder. You can reload the page or return home.
				</p>
				<div className="flex items-center justify-center gap-3">
					<button
						onClick={() => {
							if (typeof window !== "undefined") {
								window.location.reload();
							}
						}}
						className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
					>
						Reload page
					</button>
					<Link
						href="/"
						className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-foreground transition-colors"
					>
						Go home
					</Link>
				</div>
			</div>
		</div>
	);
}

export default function Page() {
	return (
		<div className="flex flex-col flex-1 min-h-0 mt-16">
			<ErrorBoundary fallback={<BuilderFallback />}>
				<BuilderPage />
			</ErrorBoundary>
		</div>
	);
}
