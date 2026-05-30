export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";
import { HeroSection } from "@/components/hero-section";
import { getStrategy } from "@/services/strategy-service";

const StrategyClientWrapper = nextDynamic(
	() => import("./components/strategy-client-wrapper").then((m) => m.StrategyClientWrapper),
	{
		loading: () => (
			<div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
				<div className="text-muted text-sm animate-pulse">Loading strategy...</div>
			</div>
		),
	},
);

export default async function StrategyPage({ params }: { params: { id: string } }) {
	const strategy = await getStrategy(params.id).catch(() => null);

	if (!strategy) {
		return (
			<div className="flex items-center justify-center min-h-screen bg-[--background] text-[--foreground]">
				<div className="text-center">
					<h1 className="text-2xl font-semibold mb-2">Strategy not found</h1>
					<p className="text-gray-400">The requested strategy could not be loaded.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen">
			<main className="flex-1">
				<HeroSection />
				<div className="container mx-auto px-6 py-8">
					<StrategyClientWrapper strategy={strategy} />
				</div>
			</main>
		</div>
	);
}
