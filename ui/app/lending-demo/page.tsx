import { LendingActionsDemo } from "@/components/lending/lending-actions-demo";

export default function LendingDemoPage() {
	return (
		<div className="container mx-auto py-8">
			<h1 className="text-3xl font-bold mb-6">Lending Actions Demo</h1>
			<p className="text-muted-foreground mb-6">
				This page demonstrates the new lending action hooks (MC-36/37/38/44/45). Connect your wallet
				to test the functionality.
			</p>
			<LendingActionsDemo />
		</div>
	);
}
