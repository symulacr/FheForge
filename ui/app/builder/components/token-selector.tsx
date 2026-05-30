"use client";

import Image from "next/image";
import { assetIcons } from "@/lib/iconMap";

interface TokenMeta {
	id?: string;
	asset_id?: string;
	name?: string;
}

interface TokenSelectorProps {
	label: string;
	options: TokenMeta[];
	selectedId: string;
	isOpen: boolean;
	disabled?: boolean;
	onSelect: (id: string) => void;
	onToggle: () => void;
	onClose: () => void;
}

export function TokenSelector({
	label,
	options,
	selectedId,
	isOpen,
	disabled,
	onSelect,
	onToggle,
	onClose,
}: TokenSelectorProps) {
	const selectedToken = options.find((t) => t.id === selectedId);

	const renderTokenIcon = (symbol: string, size: number = 24) => {
		const iconSrc = assetIcons[symbol];
		if (iconSrc) {
			return (
				<Image
					src={iconSrc}
					alt={symbol}
					fill
					sizes={`${size}px`}
					className="object-cover scale-110"
				/>
			);
		}
		return <span className="text-[10px] font-bold text-primary">{symbol.charAt(0) || "T"}</span>;
	};

	const renderTokenOption = (token: TokenMeta) => {
		const iconSrc = token.name ? assetIcons[token.name] : undefined;
		return (
			<div
				key={token.id ?? ""}
				onClick={() => {
					if (token.id) onSelect(token.id);
					onClose();
				}}
				className="flex items-center gap-3 px-4 py-3 hover:bg-secondary cursor-pointer transition-colors"
				role="option"
				aria-selected={selectedId === token.id}
			>
				<div className="w-5 h-5 border border-border overflow-hidden bg-secondary flex items-center justify-center relative">
					{iconSrc ? (
						<Image
							src={iconSrc}
							alt={token.name ?? ""}
							fill
							sizes="20px"
							className="object-cover"
						/>
					) : (
						<span className="text-[8px] font-bold">{token.name?.charAt(0)}</span>
					)}
				</div>
				<span className="text-sm text-foreground">{token.name ?? ""}</span>
				{selectedId === token.id && <div className="ml-auto w-1 h-1 bg-primary animate-pulse" />}
			</div>
		);
	};

	return (
		<div className="space-y-3">
			<label className="text-xs text-muted font-medium ml-1">
				{label}
			</label>
			<div className="relative">
				<button
					type="button"
					disabled={disabled}
					onClick={onToggle}
					className="
            w-full flex items-center justify-between pl-4 pr-10 py-3.5 
            bg-card border border-border text-foreground
            hover:bg-secondary hover:border-accent/50 transition-all
            disabled:opacity-50 disabled:cursor-not-allowed
          "
					aria-label={`Select ${label.toLowerCase()}`}
					aria-expanded={isOpen}
				>
					<div className="flex items-center gap-3">
						<div className="w-6 h-6 border border-white/20 overflow-hidden bg-neutral-800 flex items-center justify-center relative">
							{selectedToken ? renderTokenIcon(selectedToken.name || "", 24) : null}
						</div>
						<span className="text-sm font-medium">{selectedToken?.name || `Select ${label}`}</span>
					</div>
					<div className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden
						>
							<path d="m6 9 6 6 6-6" />
						</svg>
					</div>
				</button>

				{isOpen && (
					<>
						<div className="fixed inset-0 z-[60]" onClick={onClose} />
						<div
							className="absolute top-full left-0 w-full mt-2 py-2 bg-card border border-border z-[70] max-h-[200px] overflow-y-auto custom-scroll"
							role="listbox"
						>
							{options.map(renderTokenOption)}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
