import dynamic from "next/dynamic";

const PromptPage = dynamic(() => import("./PromptPage"), {
	ssr: false,
	loading: () => (
		<div className="flex items-center justify-center flex-1">
			<div className="text-muted text-sm animate-pulse">Loading prompt...</div>
		</div>
	),
});

export default function Page() {
	return (
		<div className="flex flex-col flex-1 min-h-0">
			<PromptPage />
		</div>
	);
}
