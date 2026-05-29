"use client";

import Link from "next/link";
import React from "react";

interface Props {
	children: React.ReactNode;
	fallback?: React.ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("ErrorBoundary caught an error:", error, errorInfo);
	}

	handleReload = () => {
		if (typeof window !== "undefined") {
			window.location.reload();
		}
	};

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			return (
				<div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
					<div className="max-w-md w-full text-center space-y-6">
						<div className="space-y-2">
							<h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
							<p className="text-muted-foreground text-sm">
								An unexpected error occurred. You can try reloading the page or return to the home
								page.
							</p>
						</div>

						{this.state.error && (
							<div className="rounded-lg border border-border bg-muted/50 p-4 text-left">
								<p className="text-xs font-mono text-destructive truncate">
									{this.state.error.message}
								</p>
							</div>
						)}

						<div className="flex items-center justify-center gap-3">
							<button
								onClick={this.handleReload}
								className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
							>
								Reload page
							</button>
							<Link
								href="/"
								className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
							>
								Go home
							</Link>
						</div>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
