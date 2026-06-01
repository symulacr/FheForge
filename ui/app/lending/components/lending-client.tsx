"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useMarkets } from "@/hooks/use-markets";
import { usePermitCountdown } from "@/hooks/use-permit-countdown";
import { useFheWallet } from "@/hooks/use-fhe-wallet";
import { MasterDetail } from "@/components/shared/master-detail";
import { MDGroup } from "@/components/shared/md-group";
import { MDItem } from "@/components/shared/md-item";
import { Cipher } from "@/components/shared/cipher";
import { AssetGlyph } from "@/components/shared/asset-glyph";
import { LtvGauge } from "@/components/shared/ltv-gauge";

export default function LendingClient(): JSX.Element {
	const { address, isConnected } = useAccount();
	const { connectWallet } = useFheWallet();
	const { data: markets, isLoading: marketsLoading } = useMarkets();
	const portfolio = usePortfolio(address);
	const { unlocked, grantPermit } = usePermitCountdown();
	const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
	const [side, setSide] = useState<"supply" | "borrow">("supply");
	const [amount, setAmount] = useState("");
	const [ltv, setLtv] = useState(45);

	const locked = !unlocked;

	useEffect(() => {
		if (!selectedAsset && markets && markets.length > 0) {
			setSelectedAsset(markets[0].asset);
		}
	}, [markets, selectedAsset]);

	const selectedMarket = useMemo(() => {
		return markets?.find((m) => m.asset === selectedAsset) || null;
	}, [markets, selectedAsset]);

	const { data: balance } = useBalance({
		address,
		token: selectedMarket?.tokenAddress as `0x${string}` | undefined,
	});

	const ltvWeighted = useMemo(() => {
		if (!portfolio.plainSupplyBalance || portfolio.plainSupplyBalance === 0n) return 0;
		const supply = Number(formatUnits(portfolio.plainSupplyBalance, 18));
		const borrow = Number(formatUnits(portfolio.plainBorrowBalance ?? 0n, 18));
		return (borrow / supply) * 100;
	}, [portfolio]);

	const quickAmounts = useMemo(() => {
		if (!balance) return {} as Record<string, string>;
		const max = parseFloat(formatUnits(balance.value, balance.decimals));
		return {
			"25%": (max * 0.25).toFixed(2),
			"50%": (max * 0.5).toFixed(2),
			"75%": (max * 0.75).toFixed(2),
			Max: max.toFixed(2),
		};
	}, [balance]);

	const listHeader = (
		<div>
			<div className="eyebrow">Lend</div>
			<div className="flex items-center gap-3 mt-2">
				<span className="text-[11px] text-muted">
					{markets?.length ?? 0} markets · public totals only
				</span>
			</div>
		</div>
	);

	const listBody = (
		<>
			<MDGroup>Your position</MDGroup>
			<div style={{ padding: "12px 20px", borderBottom: "1px dashed var(--border-light)" }}>
				<div className="kv">
					<span className="k">net supplied</span>
					<span className="v">
						<Cipher
							value={portfolio.plainSupplyBalance ? formatUnits(portfolio.plainSupplyBalance, 18) : "0"}
							locked={locked}
							size="sm"
							inline
						/>
					</span>
				</div>
				<div className="kv">
					<span className="k">net borrowed</span>
					<span className="v">
						<Cipher
							value={portfolio.plainBorrowBalance ? formatUnits(portfolio.plainBorrowBalance, 18) : "0"}
							locked={locked}
							size="sm"
							inline
						/>
					</span>
				</div>
				<div className="kv">
					<span className="k">ltv · weighted</span>
					<span className="v">{ltvWeighted.toFixed(1)}%</span>
				</div>
				<div style={{ marginTop: 10 }}>
					<LtvGauge ltv={ltvWeighted} liqThreshold={80} showLabels={false} height={6} />
				</div>
			</div>

			<MDGroup>Markets · {markets?.length ?? 0}</MDGroup>
			{marketsLoading ? (
				<div className="p-4 text-muted text-xs">Loading markets…</div>
			) : (
				markets?.map((m) => (
					<MDItem
						key={m.asset}
						idx={
							<span style={{ display: "inline-flex" }}>
								<AssetGlyph asset={m.asset} size={20} />
							</span>
						}
						title={m.asset}
						sub={`util ${(m.utilization * 100).toFixed(0)}% · TVL $${(m.tvl / 1e6).toFixed(2)}M`}
						right={
							<div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 2 }}>
								<span style={{ fontSize: 11, color: "var(--success)" }}>+{m.supplyAPY.toFixed(2)}%</span>
								<span style={{ fontSize: 11, color: "var(--destructive)" }}>−{m.borrowAPY.toFixed(2)}%</span>
							</div>
						}
						selected={selectedAsset === m.asset}
						onClick={() => {
							setSelectedAsset(m.asset);
							setAmount("");
						}}
					/>
				))
			)}
		</>
	);

	const detailHeader = selectedMarket ? (
		<>
			<div className="flex items-center gap-3">
				<AssetGlyph asset={selectedMarket.asset} size={26} />
				<div>
					<div style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.012em", lineHeight: 1.2 }}>
						{selectedMarket.asset}
					</div>
					<div className="text-[11px] text-muted">
						price ${selectedMarket.oraclePrice.toLocaleString()} · oracle Pyth
					</div>
				</div>
			</div>
			<div className="tabstrip" style={{ border: 0 }}>
				{(["supply", "borrow"] as const).map((s) => (
					<button
						key={s}
						className={`tab ${side === s ? "active" : ""}`}
						onClick={() => setSide(s)}
					>
						{s}
					</button>
				))}
			</div>
		</>
	) : (
		<div className="eyebrow">Select a market</div>
	);

	const detailBody = selectedMarket ? (
		<LendAction
			market={selectedMarket}
			side={side}
			amount={amount}
			setAmount={setAmount}
			ltv={ltv}
			setLtv={setLtv}
			locked={locked}
			grantPermit={grantPermit}
			balance={balance}
			quickAmounts={quickAmounts}
			isConnected={isConnected}
			connectWallet={connectWallet}
		/>
	) : (
		<div className="flex items-center justify-center h-full text-muted">
			Select a market from the list to supply or borrow
		</div>
	);

	return (
		<MasterDetail
			collapseKey="lend"
			listHeader={listHeader}
			listBody={listBody}
			detailHeader={detailHeader}
			detailBody={detailBody}
		/>
	);
}

interface LendActionProps {
	market: {
		asset: string;
		supplyAPY: number;
		borrowAPY: number;
		utilization: number;
		tvl: number;
		liquidationThreshold: number;
		oraclePrice: number;
	};
	side: "supply" | "borrow";
	amount: string;
	setAmount: (v: string) => void;
	ltv: number;
	setLtv: (v: number) => void;
	locked: boolean;
	grantPermit: () => Promise<void>;
	balance: { value: bigint; decimals: number; formatted: string; symbol: string } | undefined;
	quickAmounts: Record<string, string>;
	isConnected: boolean;
	connectWallet: () => void;
}

function LendAction({
	market,
	side,
	amount,
	setAmount,
	ltv,
	setLtv,
	locked,
	grantPermit,
	balance,
	quickAmounts,
	isConnected,
	connectWallet,
}: LendActionProps) {
	const apy = side === "supply" ? market.supplyAPY : market.borrowAPY;

	return (
		<div className="fade-enter" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 28, alignItems: "start" }}>
			{/* Action form */}
			<div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
				<div>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
						<span className="eyebrow">Amount</span>
						<span style={{ fontSize: 11, color: "var(--muted)" }}>
							wallet · <Cipher value={balance?.formatted ?? "–"} locked={locked} size="sm" inline /> {market.asset}
						</span>
					</div>
					<div style={{ display: "flex", gap: 8, border: "1px solid var(--border)", padding: "14px 16px", background: "var(--card)" }}>
						<input
							value={amount}
							onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
							placeholder="0.00"
							style={{ border: 0, outline: "none", background: "transparent", fontSize: 30, flex: 1, color: "var(--foreground)", fontVariantNumeric: "tabular-nums", minWidth: 0 }}
						/>
						<span style={{ fontSize: 14, color: "var(--muted)", alignSelf: "center" }}>{market.asset}</span>
					</div>
					<div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted)", marginTop: 8, alignItems: "center" }}>
						{["25%", "50%", "75%", "Max"].map((p) => (
							<button
								key={p}
								onClick={() => setAmount(quickAmounts[p] ?? "0")}
								className="terminal-btn"
								style={{ padding: "3px 8px", fontSize: 10 }}
							>
								{p}
							</button>
						))}
						<div style={{ flex: 1, borderTop: "1px dashed var(--border-light)" }} />
						<span>encrypted before it leaves your browser</span>
					</div>
				</div>

				{locked && (
					<div style={{
						padding: "12px 14px",
						background: "var(--accent-muted)", border: "1px solid var(--accent)",
						color: "var(--foreground)", fontSize: 12, lineHeight: 1.55,
					}}>
						<strong style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 }}>Permit required</strong> · grant a permit so your wallet can encrypt and submit this amount. One signature, no gas, expires in 15 minutes.
					</div>
				)}

				{side === "borrow" && (
					<div>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
							<span className="eyebrow" title="How much you borrow relative to your collateral. Higher = riskier.">Loan-to-value</span>
							<span style={{ fontSize: 12 }}>{ltv}%</span>
						</div>
						<input
							type="range"
							min="0"
							max="80"
							value={ltv}
							onChange={(e) => setLtv(+e.target.value)}
							style={{ width: "100%", accentColor: "var(--accent)" }}
						/>
						<LtvGauge ltv={ltv} liqThreshold={market.liquidationThreshold} />
						{ltv >= 70 && (
							<div style={{
								marginTop: 10, padding: "10px 12px",
								background: "var(--destructive-muted)", border: "1px solid var(--destructive)",
								color: "var(--destructive)", fontSize: 11.5, lineHeight: 1.55,
							}}>
								<strong style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 }}>Liq risk</strong> · a {Math.round((1 - ltv / market.liquidationThreshold) * 100)}% price drop will liquidate this position.
							</div>
						)}
					</div>
				)}

				<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
					{!isConnected ? (
						<button className="terminal-btn w-full py-3" style={{ flex: 1 }} onClick={connectWallet}>
							Connect to {side} →
						</button>
					) : locked ? (
						<button className="terminal-btn primary w-full py-3" style={{ flex: 1 }} onClick={grantPermit}>
							Grant permit first →
						</button>
					) : (
						<button className="terminal-btn w-full py-3" style={{ flex: 1 }}>
							Encrypt & {side} {amount} {market.asset} →
						</button>
					)}
				</div>
			</div>

			{/* Summary cards */}
			<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
				<div style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 20 }}>
					<span className="eyebrow">summary</span>
					<div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
						<div className="kv">
							<span className="k">{side} apy</span>
							<span className="v" style={{ color: side === "supply" ? "var(--success)" : "var(--destructive)" }}>
								{side === "supply" ? "+" : "−"}{apy.toFixed(2)}%
							</span>
						</div>
						<div className="kv">
							<span className="k">health after</span>
							<span className="v">
								<Cipher value={side === "supply" ? "2.84" : "1.62"} locked={locked} size="sm" inline />
							</span>
						</div>
						<div className="kv">
							<span className="k">liq price</span>
							<span className="v">–</span>
						</div>
						<div className="kv">
							<span className="k">est. gas</span>
							<span className="v">≈ 312k</span>
						</div>
					</div>
				</div>

				<div style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 20 }}>
					<span className="eyebrow">market · {market.asset}</span>
					<div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
						<div className="kv">
							<span className="k">utilization</span>
							<span className="v">{(market.utilization * 100).toFixed(0)}%</span>
						</div>
						<div style={{ marginTop: 6 }}>
							<div className="meter" style={{ height: 6 }}>
								<div className="fill" style={{ width: `${(market.utilization * 100).toFixed(0)}%` }} />
							</div>
						</div>
						<div className="kv">
							<span className="k">public tvl</span>
							<span className="v">${(market.tvl / 1e6).toFixed(2)}M</span>
						</div>
						<div className="kv">
							<span className="k">liq threshold</span>
							<span className="v">{(market.liquidationThreshold * 100).toFixed(0)}%</span>
						</div>
						<div className="kv">
							<span className="k">last oracle</span>
							<span className="v">14s ago</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
