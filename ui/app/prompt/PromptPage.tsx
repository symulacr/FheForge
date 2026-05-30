"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Lightbulb, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useMemo, useState } from "react";
import { displayToast } from "@/components/shared/toast-manager";
import { StrategyFlowPreview } from "@/components/strategy/StrategyFlowPreview";
import { StrategyFlowSkeleton } from "@/components/strategy/StrategyFlowSkeleton";
import { useStrategyPrompt } from "@/hooks/use-strategy-prompt";
import { PROMPT_MAX_LENGTH } from "@/lib/constants";
import { assetIcons } from "@/lib/iconMap";
import type { BuildStrategyResponse } from "@/services/ai-strategy-service";
import type { StrategySimulate } from "@/types/strategy.type";

const ExecutionModal = dynamic(
	() => import("@/components/shared/execution-modal").then((m) => m.ExecutionModal),
	{ ssr: false }
);

const EXAMPLE_PROMPTS = [
	"Create a gdot looping 3 loops",
	"Supply DOT and borrow USDC",
	"Maximize yield with moderate risk",
] as const;

export default function PromptPage() {
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);
	const [isExecutionOpen, setIsExecutionOpen] = useState(false);
	const [strategyToExecute, setStrategyToExecute] = useState<BuildStrategyResponse | null>(null);

	const {
		tokens,
		submitting,
		strategyResult,
		selectedToken,
		tokenAmount,
		prompt,
		setSelectedToken,
		setTokenAmount,
		setPrompt,
		onCancel,
		onNext,
	} = useStrategyPrompt();

	const charCount = useMemo(() => prompt.length, [prompt]);

	const validatePromptForm = () => {
		if (!selectedToken) {
			displayToast("error", "Select a starting token.");
			return false;
		}
		if (!tokenAmount || tokenAmount <= 0) {
			displayToast("error", "Enter a valid token amount.");
			return false;
		}
		if (!prompt.trim()) {
			displayToast("error", "Enter your strategy prompt.");
			return false;
		}
		return true;
	};

	const handleNext = async () => {
		if (!validatePromptForm()) return;
		await onNext();
	};

	const handleRunStrategyClick = () => {
		if (!strategyResult) return;
		setStrategyToExecute(strategyResult);
		setIsExecutionOpen(true);
	};

	return (
		<div className="flex flex-1 min-h-[calc(100vh-96px)] items-center justify-center px-4 py-6">
			<div className="flex w-full max-w-6xl items-start justify-center gap-6">
				{/* Main Form */}
				<div className="w-full max-w-2xl forge-card p-6 space-y-6">
					{/* Header */}
					<div>
						<h1 className="text-xl font-semibold text-foreground mb-1">
							Create Prompt Strategy
						</h1>
						<p className="text-xs text-muted">
							Describe your strategy in natural language.
						</p>
					</div>

					{/* Token Selection */}
					<section className="space-y-2">
						<label className="text-sm font-medium text-foreground">
							Starting Token & Amount
						</label>
						<div className="flex gap-3">
							{/* Amount Input */}
							<input
								type="number"
								value={tokenAmount}
								onChange={(e) => setTokenAmount(Number(e.target.value))}
								min="0"
								step="0.000001"
								placeholder="0.00"
								className="h-10 w-28 bg-input border border-border px-3 text-sm text-foreground text-center placeholder:text-muted transition-colors focus:outline-none focus:border-accent"
							/>

							{/* Token Dropdown */}
							<div className="relative flex-1">
								<button
									type="button"
									onClick={() => setIsDropdownOpen(!isDropdownOpen)}
									className="h-10 w-full bg-input border border-border px-4 text-sm text-left text-foreground transition-colors hover:border-accent/50 focus:outline-none focus:border-accent flex items-center justify-between gap-2"
								>
									{selectedToken ? (
										<span className="flex items-center gap-2">
											<Image
												src={
													assetIcons[selectedToken] ??
													assetIcons[selectedToken?.toUpperCase()] ??
													"/icons/default.png"
												}
												alt={selectedToken}
												width={16}
												height={16}
												className="w-4 h-4 object-contain"
											/>
											{tokens.find((t) => t.value === selectedToken)?.label || selectedToken}
										</span>
									) : (
										<span className="text-muted">Select token</span>
									)}
									<ChevronDown
										className={`w-4 h-4 text-muted transition-transform ${
											isDropdownOpen ? "rotate-180" : ""
										}`}
									/>
								</button>

								{isDropdownOpen && (
									<>
										<div
											className="fixed inset-0 z-40"
											onClick={() => setIsDropdownOpen(false)}
										/>
										<ul className="absolute top-full left-0 right-0 mt-1 z-50 border border-border bg-card max-h-48 overflow-y-auto">
											{tokens.map((token) => (
												<li key={token.value}>
													<button
														type="button"
														onClick={() => {
															setSelectedToken(token.value);
															setIsDropdownOpen(false);
														}}
														className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors text-left"
													>
														<Image
															src={
																assetIcons[token.value] ??
																assetIcons[token.value?.toUpperCase()] ??
																"/icons/default.png"
															}
															alt={token.value}
															width={16}
															height={16}
															className="w-4 h-4 object-contain"
														/>
														{token.label}
													</button>
												</li>
											))}
										</ul>
									</>
								)}
							</div>
						</div>
					</section>

					{/* Prompt Input */}
					<section className="space-y-2">
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-foreground">
								Strategy Prompt
							</label>
							<span className="text-xs text-muted tabular-nums">
								{charCount}/{PROMPT_MAX_LENGTH}
							</span>
						</div>
						<div className="bg-input border border-border p-4 transition-colors focus-within:border-accent">
							<textarea
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								maxLength={PROMPT_MAX_LENGTH}
								placeholder="Example: Create a gdot looping 3 loops, Supply DOT and borrow USDC..."
								className="h-24 w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
							/>
							<div className="mt-2 flex items-center gap-2 text-xs text-muted">
								<Sparkles className="w-3 h-3" />
								<span>AI-powered strategy generation</span>
							</div>
						</div>
					</section>

					{/* Actions */}
					<div className="flex items-center justify-end gap-3 pt-2">
						<button onClick={onCancel} className="terminal-btn px-4 py-2">
							Cancel
						</button>
						<button
							onClick={handleNext}
							disabled={submitting}
							className="terminal-btn primary px-5 py-2"
						>
							{submitting ? (
								<span className="flex items-center gap-2">
									<span className="spinner" />
									Generating
								</span>
							) : (
								"Generate Strategy"
							)}
						</button>
					</div>
				</div>

				{/* Sidebar */}
				<aside className="w-72 shrink-0">
					{submitting ? (
						<StrategyFlowSkeleton />
					) : (
						<AnimatePresence mode="wait">
							{strategyResult ? (
								<motion.div
									key="strategy-result"
									initial={{ opacity: 0, x: 12 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: 12 }}
									transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
								>
									<StrategyFlowPreview
										strategy={strategyResult}
										selectedToken={selectedToken}
										onRunStrategy={handleRunStrategyClick}
									/>
								</motion.div>
							) : (
								<motion.div
									key="guide"
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									className="forge-card p-5 space-y-5"
								>
									{/* Guide Header */}
									<div className="flex items-center gap-2 text-warning">
										<Lightbulb className="w-4 h-4" />
										<span className="text-sm font-medium">Strategy Guide</span>
									</div>

									{/* Example Prompts */}
									<div className="space-y-2">
										<h3 className="text-xs font-medium text-muted">Example Prompts</h3>
										<div className="space-y-1">
											{EXAMPLE_PROMPTS.map((example) => (
												<button
													key={example}
													onClick={() => setPrompt(example)}
													className="w-full text-left text-xs text-muted p-2.5 bg-secondary border border-border transition-colors hover:border-accent/30 hover:text-foreground group"
												>
													<span className="flex items-center justify-between">
														<span>&quot;{example}&quot;</span>
														<span className="opacity-0 group-hover:opacity-100 text-accent transition-opacity">
															&rarr;
														</span>
													</span>
												</button>
											))}
										</div>
									</div>

									{/* Operations */}
									<div className="space-y-2 pt-4 border-t border-border">
										<h3 className="text-xs font-medium text-muted">Supported Operations</h3>
										<div className="grid grid-cols-2 gap-1 text-xs text-muted">
											{["Supply", "Borrow", "Swap", "Join Strategy"].map((op) => (
												<div
													key={op}
													className="p-1.5 bg-secondary border border-border text-center"
												>
													{op}
												</div>
											))}
										</div>
									</div>

									{/* Tokens */}
									<div className="space-y-2 pt-4 border-t border-border">
										<h3 className="text-xs font-medium text-muted">Available Tokens</h3>
										<div className="flex flex-wrap gap-1">
											{tokens.map((token) => (
												<span
													key={token.value}
													className="px-1.5 py-0.5 text-[10px] bg-secondary text-muted border border-border"
												>
													{token.label}
												</span>
											))}
										</div>
									</div>
								</motion.div>
							)}
						</AnimatePresence>
					)}
				</aside>
			</div>

			{/* Execution Modal */}
			{strategyToExecute && (
				<ExecutionModal
					key={strategyToExecute ? "open" : "closed"}
					open={isExecutionOpen}
					onOpenChange={setIsExecutionOpen}
					strategy={strategyToExecute as unknown as StrategySimulate}
					strategyId={String((strategyToExecute as unknown as { id?: string }).id ?? "")}
					startFromStep={0}
					activityId={null}
				/>
			)}
		</div>
	);
}
