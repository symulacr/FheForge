"use client";

import {
	Activity,
	ArrowLeftRight,
	Bot,
	ExternalLink,
	FileText,
	Shield,
	Users,
	Workflow,
} from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ARBITRUM_SEPOLIA_EXPLORER } from "@/lib/constants";
import type { DefiStrategy } from "@/types/defi.strategy";
import type { StrategySimulate } from "@/types/strategy.type";
import { AllActivityTable } from "./activity/strategy-all-activity-table";
import { MyActivityTable } from "./activity/strategy-my-activity-table";
import type { FlowStep } from "./strategy-flow";
import { StrategyFlow } from "./strategy-flow";
import { StrategyOverview } from "./strategy-overview";
import StrategyPromptDetails from "./strategy-prompt-details";
import { StrategyRebalance } from "./strategy-rebalance";

interface StrategyTabsProps {
	strategy: DefiStrategy;
	simulateData?: StrategySimulate | null;
}

export function StrategyTabs({ strategy, simulateData }: StrategyTabsProps) {
	const [manualTab, setManualTab] = useState<string | null>(null);
	const activeTab = manualTab ?? (simulateData ? "flow" : "overview");
	const tabs = [
		{ value: "overview", label: "Overview", icon: Shield },
		{ value: "flow", label: "Strategy Flow", icon: Workflow },
		{ value: "prompt", label: "Strategy Prompt", icon: FileText },
		{ value: "activities", label: "My Activities", icon: Activity },
		{ value: "all", label: "All Activities", icon: Users },
		{ value: "rebalance", label: "Rebalance", icon: ArrowLeftRight },
	];

	return (
		<Tabs value={activeTab} onValueChange={setManualTab} className="w-full">
			<TabsList
				className="
          flex flex-wrap gap-3 bg-transparent border-none justify-start 
          mt-10 mb-6
        "
			>
				{tabs.map((tab) => {
					const Icon = tab.icon;
					return (
						<TabsTrigger
							key={tab.value}
							value={tab.value}
							className="
                flex items-center gap-2 px-5 py-2.5
                border border-border bg-card
                text-sm font-medium text-muted
                hover:bg-secondary hover:border-accent/40 hover:text-foreground
                data-[state=active]:bg-accent/20
                data-[state=active]:text-accent
                data-[state=active]:border-accent
                transition-colors duration-300
              "
						>
							<Icon size={16} className="opacity-80" />
							{tab.label}
						</TabsTrigger>
					);
				})}
			</TabsList>

			<TabsContent value="overview">
				<StrategyOverview strategy={strategy} simulateData={simulateData} />
			</TabsContent>

			<TabsContent value="flow">
				<div className="glass p-6">
					{simulateData ? (
						<StrategyFlow
							key={JSON.stringify(simulateData)}
							steps={
								Array.isArray(simulateData.steps)
									? (simulateData.steps as unknown as FlowStep[])
									: []
							}
							initialCapital={simulateData.initialCapital}
							loops={simulateData.loops}
							fee={simulateData.fee}
						/>
					) : (
						<div className="flex flex-col items-center justify-center px-4">
							<div className="w-10 h-10 mb-4 bg-accent/10 flex items-center justify-center">
								<Bot className="w-10 h-10 text-accent/50" />
							</div>
							<p className="text-muted-foreground text-center max-w-md text-sm">
								Please run a simulation first to see the strategy details and expected results.
							</p>
						</div>
					)}
				</div>
			</TabsContent>

			<TabsContent value="prompt">
				<div className="glass p-6">
					<StrategyPromptDetails />
				</div>
			</TabsContent>

			<TabsContent value="activities">
				<div className="glass p-6">
					<div className="flex justify-between items-center mb-4">
						<div className="text-lg font-semibold">My Activities</div>
						<a
							href={ARBITRUM_SEPOLIA_EXPLORER}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-1 text-sm hover:underline"
						>
							<span>See My Position on Arbiscan</span>
							<ExternalLink size={16} className="opacity-80" />
						</a>
					</div>

					<MyActivityTable />
				</div>
			</TabsContent>

			<TabsContent value="all">
				<div className="glass p-6">
					<AllActivityTable />
				</div>
			</TabsContent>

			<TabsContent value="rebalance">
				<StrategyRebalance strategy={strategy} />
			</TabsContent>
		</Tabs>
	);
}
