"use client";

import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import type { Action, Module } from "@/types/defi";

interface SidebarProps {
	modules: Module[];
	onSelect: (module: Module, action: Action) => void;
}

export default function Sidebar({ modules, onSelect }: SidebarProps) {
	const [openModules, setOpenModules] = useState<string[]>(modules?.map((m) => m.id) ?? []);
	const [search, setSearch] = useState("");

	const toggleModule = (id: string) => {
		setOpenModules((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
	};

	return (
		<div
			className="
        h-full flex flex-col
        glass
        text-white
        overflow-hidden
      "
		>
			<div className="p-4 border-b border-border">
				<h2 className="text-lg font-semibold tracking-wide">Module Library</h2>

				<div className="mt-3 relative">
					<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
					<input
						type="text"
						placeholder="Search module..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="
              w-full pl-9 pr-3 py-2
              bg-input 
              border border-border
              text-sm text-foreground
              focus:outline-none
              focus:border-accent
              placeholder:text-muted
              transition-colors
            "
					/>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scroll">
				{(() => {
					const filtered = modules.filter((m) =>
						m.name.toLowerCase().includes(search.toLowerCase()),
					);

					if (filtered.length === 0) {
						return (
							<p className="text-sm text-neutral-500 text-center pt-4">
								{search ? "No modules match your search." : "No modules available."}
							</p>
						);
					}

					return filtered.map((module) => {
						const isOpen = openModules.includes(module.id);

						return (
							<div key={module.id}>
								<button
									onClick={() => toggleModule(module.id)}
									className={`
                      w-full flex items-center justify-between
                      text-[11px] font-bold uppercase tracking-[0.15em]
                      transition-colors duration-300
                      ${isOpen ? "text-accent" : "text-muted hover:text-foreground"}
                  `}
								>
									{module.name}

									<ChevronDown
										size={14}
										className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
									/>
								</button>

								{isOpen && (
									<div className="mt-3 space-y-2">
										{module.actions && module.actions.length > 0 ? (
											module.actions.map((action) => (
												<button
													key={action.id}
													onClick={() => onSelect(module, action)}
													className="
                            w-full text-left
                            px-4 py-3
                           
                            bg-card
                            text-sm font-medium
                            text-muted-foreground
                            hover:text-foreground
                            hover:border-accent
                            group
                            flex items-center justify-between
                          "
												>
													{action.name}
													<span className="opacity-0 group-hover:opacity-100 transition-opacity text-accent text-xs">
														Add
													</span>
												</button>
											))
										) : (
											<p className="text-sm text-muted">No actions</p>
										)}
									</div>
								)}
							</div>
						);
					});
				})()}
			</div>
		</div>
	);
}
