"use client";

export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<div className="flex min-h-[calc(100vh-200px)] items-center justify-center">
			<div className="text-center space-y-4">
				<h2 className="text-lg font-semibold text-destructive">Something went wrong</h2>
				<p className="text-muted-foreground text-sm max-w-md">
					{error.message || "An unexpected error occurred in the lending demo."}
				</p>
				<button
					onClick={reset}
					className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 transition-colors"
				>
					Try again
				</button>
			</div>
		</div>
	);
}
