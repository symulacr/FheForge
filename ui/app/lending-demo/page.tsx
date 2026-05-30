import dynamic from "next/dynamic";

const LendingActionsDemo = dynamic(
	() => import("@/components/lending/lending-actions-demo").then((mod) => mod.LendingActionsDemo),
	{ ssr: false },
);

export default function LendingDemoPage() {
	return (
		<div className="container mx-auto py-8 px-4">
			<h1 className="text-2xl font-medium mb-2 text-foreground">Lending</h1>
			<p className="text-sm text-muted mb-6">
				Supply and borrow using encrypted amounts. Connect your wallet to interact with the LendingPool contract on Arbitrum Sepolia.
			</p>
			<LendingActionsDemo />
		</div>
	);
}
