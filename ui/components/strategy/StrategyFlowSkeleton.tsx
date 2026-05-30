"use client";

import { Sparkles, Workflow } from "lucide-react";

export function StrategyFlowSkeleton() {
	return (
		<div className="forge-card p-5">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2 text-warning">
					<Workflow className="h-4 w-4" />
					<span className="text-sm font-medium">Generating Strategy</span>
				</div>
				<Sparkles className="h-4 w-4 text-accent animate-pulse" />
			</div>

			{/* Skeleton Steps */}
			<div className="space-y-3 mb-4">
				{[1, 2, 3].map((index) => (
					<div
						key={index}
						className="flex items-center gap-3 p-3 bg-secondary border border-border"
						style={{ animationDelay: `${index * 100}ms` }}
					>
						{/* Step Number */}
						<div className="shrink-0 w-5 h-5 bg-accent/10 border border-accent/20" />

						{/* Content */}
						<div className="flex-1 space-y-2">
							<div
								className="h-3 bg-border/60 w-3/4 animate-pulse"
								style={{ animationDelay: `${index * 150}ms` }}
							/>
							<div
								className="h-2 bg-border/40 w-1/2 animate-pulse"
								style={{ animationDelay: `${index * 200}ms` }}
							/>
						</div>

						{/* Token placeholder */}
						<div className="shrink-0 w-5 h-5 bg-border/50" />
					</div>
				))}
			</div>

			{/* Summary skeleton */}
			<div className="flex items-center justify-between p-3 bg-secondary border border-border mb-4">
				<div className="flex items-center gap-2">
					<div className="w-3 h-3 bg-border/50 animate-pulse" />
					<div className="h-3 w-16 bg-border/50 animate-pulse" />
				</div>
				<div className="h-3 w-12 bg-border/50 animate-pulse" />
			</div>

			{/* Button placeholder */}
			<div className="h-9 border border-accent/20 bg-accent/5" />

			{/* Status text */}
			<div className="mt-3 text-center">
				<span className="text-xs text-muted animate-pulse">
					Analyzing optimal strategy...
				</span>
			</div>
		</div>
	);
}
