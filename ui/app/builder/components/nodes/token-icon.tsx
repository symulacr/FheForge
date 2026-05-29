import Image from "next/image";
import { assetIcons } from "@/lib/iconMap";

type TokenIconProps = {
	symbol?: string;
	className?: string;
	textClassName?: string;
	iconClassName?: string;
	size?: number;
};

export default function TokenIcon({
	symbol,
	className = "",
	textClassName = "",
	iconClassName = "",
	size = 24,
}: TokenIconProps) {
	if (!symbol) return null;

	const s = symbol.toUpperCase();
	const iconSrc = assetIcons[s];

	return (
		<div className={`flex items-center gap-2.5 ${className}`}>
			<div
				className={`relative overflow-hidden border border-border bg-card shrink-0 ${iconClassName}`}
				style={{ width: size, height: size }}
			>
				{iconSrc ? (
					<Image
						src={iconSrc}
						alt={s}
						fill
						sizes={`${size}px`}
						className="object-cover scale-110"
					/>
				) : (
					<div className="w-full h-full flex items-center justify-center bg-accent/20">
						<span className="text-[10px] font-bold text-accent">{s.charAt(0)}</span>
					</div>
				)}
			</div>

			<span className={`text-[18px] text-foreground font-semibold leading-none ${textClassName}`}>
				{s}
			</span>
		</div>
	);
}
