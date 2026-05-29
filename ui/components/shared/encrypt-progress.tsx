const STEP_LABELS: Record<string, string> = {
	initTfhe: "Initializing FHE...",
	fetchKeys: "Fetching keys...",
	pack: "Packing data...",
	prove: "Generating ZK proof...",
	verify: "Verifying...",
	done: "Complete",
};

export function EncryptProgress({ stepsState }: { stepsState: Record<string, string> | null }) {
	if (!stepsState) return null;
	const activeStep = Object.entries(stepsState).find(([, status]) => status === "active")?.[0];
	if (!activeStep) return null;
	return (
		<div className="flex items-center gap-2 text-xs text-success animate-pulse">
			<span className="w-3 h-3 border-2 border-success/40 border-t-success animate-spin" />
			{STEP_LABELS[activeStep] || "Encrypting..."}
		</div>
	);
}
