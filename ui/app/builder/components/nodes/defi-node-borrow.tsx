import type { NormalizedDefiNodeData } from "./defi-node.types";
import { formatAmount, formatPercent } from "./defi-node-utils";
import TokenIcon from "./token-icon";

type Props = {
	data: NormalizedDefiNodeData;
};

export function BorrowRightLabel({ apy }: { apy?: number }) {
	return (
		<div className="leading-none text-right">
			<div className="text-[11px] uppercase tracking-wide text-muted">APY</div>
			<div className="mt-1 text-[18px] font-bold leading-none text-foreground">
				{formatPercent(apy, 0)}
			</div>
		</div>
	);
}

export default function DefiNodeBorrow({ data }: Props) {
	return (
		<div className="pt-2">
			<div className="flex min-h-[64px] items-center justify-center">
				<div className="flex items-center gap-3">
					<div className="text-[30px] font-semibold leading-none text-foreground">
						{formatAmount(data.amountOut)}
					</div>

					<TokenIcon
						symbol={data.tokenOutSymbol}
						textClassName="text-[16px]"
						iconClassName="w-5 h-5"
						className="gap-2"
					/>
				</div>
			</div>

			<div className="mt-3 h-px bg-border-light" />

			<div className="mt-2 flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-2">
					<span className="shrink-0 text-[13px] text-muted">Collateral</span>

					<TokenIcon
						symbol={data.tokenInSymbol}
						textClassName="text-[14px]"
						iconClassName="w-4 h-4"
						className="gap-1.5"
					/>
				</div>

				<div className="shrink-0 text-[13px] text-muted">LTV: {formatPercent(data.ltv, 0)}</div>
			</div>
		</div>
	);
}
