// screens/lending.jsx · Lend (v4, master-detail)
// Left: 5 markets + my position summary.
// Right: action panel for the selected market.

const { useState: useStateL } = React;

const L_MARKETS = [
  { asset: "USDC", supplyApy: 4.82, borrowApy: 6.21, util: 64, tvl: "8.42M", liq: 80, oracle: "Pyth", price: "$1.000" },
  { asset: "ETH",  supplyApy: 2.14, borrowApy: 3.78, util: 41, tvl: "4.18M", liq: 75, oracle: "Pyth", price: "$2,544.10" },
  { asset: "WBTC", supplyApy: 1.66, borrowApy: 3.10, util: 22, tvl: "1.80M", liq: 70, oracle: "Pyth", price: "$94,210" },
  { asset: "ARB",  supplyApy: 5.42, borrowApy: 8.20, util: 68, tvl: "924k",  liq: 65, oracle: "Pyth · fb", price: "$0.74" },
  { asset: "DAI",  supplyApy: 3.91, borrowApy: 5.04, util: 51, tvl: "612k",  liq: 78, oracle: "Pyth", price: "$1.000" },
];

function Lending({ setRoute, ctx, grantPermit, openConnect }) {
  const locked = !ctx.permitUnlocked;
  const [assetId, setAssetId] = useStateL("USDC");
  const [side, setSide] = useStateL("supply");
  const [amount, setAmount] = useStateL("10000");
  const [ltv, setLtv] = useStateL(45);
  const market = L_MARKETS.find(m => m.asset === assetId);

  return (
    <MasterDetail
      collapseKey="lend"
      listHeader={
        <>
          <span className="eyebrow">Lend</span>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>5 markets · public totals only</span>
          </div>
        </>
      }
      listBody={
        <>
          <MDGroup>Your position</MDGroup>
          <div style={{ padding: "12px 20px", borderBottom: "1px dashed var(--hairline-2)" }}>
            <div className="kv"><span className="k">net supplied</span><span className="v"><Cipher value="42,084" locked={locked} size="sm" inline /></span></div>
            <div className="kv"><span className="k">net borrowed</span><span className="v"><Cipher value="5.42 ETH" locked={locked} size="sm" inline /></span></div>
            <div className="kv"><span className="k">ltv · weighted</span><span className="v">44.8%</span></div>
            <div style={{ marginTop: 10 }}>
              <LtvGauge ltv={44.8} liqAt={80} labels={false} height={6} />
            </div>
          </div>

          <MDGroup>Markets · 5</MDGroup>
          {L_MARKETS.map((m, i) => (
            <MDItem
              key={m.asset}
              idx={
                <span style={{ display: "inline-flex" }}>
                  <AssetGlyph sym={m.asset} size={20} />
                </span>
              }
              title={m.asset}
              sub={`util ${m.util}% · TVL ${m.tvl}`}
              right={
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--positive)" }}>+{m.supplyApy}%</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--danger)" }}>−{m.borrowApy}%</span>
                </div>
              }
              selected={assetId === m.asset}
              onClick={() => setAssetId(m.asset)}
            />
          ))}
        </>
      }
      detailHeader={
        <>
          <div className="row" style={{ gap: 14 }}>
            <AssetGlyph sym={market.asset} size={26} />
            <div>
              <h2 className="serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.012, margin: 0 }}>
                {market.asset}
              </h2>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                price {market.price} · oracle {market.oracle}
              </div>
            </div>
          </div>
          <div className="tabstrip" style={{ border: 0 }}>
            {["supply", "borrow"].map(s => (
              <button key={s} className={"tab" + (side === s ? " active" : "")}
                onClick={() => setSide(s)}>{s}</button>
            ))}
          </div>
        </>
      }
      detailBody={
        <LendAction
          market={market} side={side} amount={amount} setAmount={setAmount}
          ltv={ltv} setLtv={setLtv}
          locked={locked} grantPermit={grantPermit} ctx={ctx} openConnect={openConnect}
        />
      }
    />
  );
}

function LendAction({ market, side, amount, setAmount, ltv, setLtv, locked, grantPermit, ctx, openConnect }) {
  const apy = side === "supply" ? market.supplyApy : market.borrowApy;
  return (
    <div className="fade-enter" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 28, alignItems: "start" }}>
      {/* Action form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <div className="spread" style={{ marginBottom: 10 }}>
            <span className="eyebrow">Amount</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
              wallet · <Cipher value="22,508.30" locked={locked} size="sm" inline /> {market.asset}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, border: "1px solid var(--ink)", padding: "14px 16px", background: "var(--paper)" }}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              style={{ border: 0, outline: "none", background: "transparent", fontFamily: "var(--mono)", fontSize: 30, flex: 1, color: "var(--ink)", fontVariantNumeric: "tabular-nums", minWidth: 0 }}
            />
            <span className="mono" style={{ fontSize: 14, color: "var(--muted)", alignSelf: "center" }}>{market.asset}</span>
          </div>
          <div className="row mono" style={{ gap: 8, fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
            {["25%", "50%", "75%", "Max"].map(p => (
              <button key={p} onClick={() => {
                const map = { "25%": "5627", "50%": "11254", "75%": "16881", "Max": "22508" };
                setAmount(map[p]);
              }} className="btn ghost sm" style={{ padding: "3px 8px", fontSize: 10 }}>{p}</button>
            ))}
            <hr className="dashed" style={{ flex: 1 }} />
            <span>encrypted before it leaves your browser</span>
          </div>
        </div>

        {locked && (
          <div style={{
            padding: "12px 14px",
            background: "var(--accent-soft)", border: "1px solid var(--accent)",
            color: "var(--accent-ink)", fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.55,
          }}>
            <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>Permit required</strong> · grant a permit so your wallet can encrypt and submit this amount. One signature, no gas, expires in 15 minutes.
          </div>
        )}

        {side === "borrow" && (
          <div>
            <div className="spread" style={{ marginBottom: 8 }}>
              <span className="eyebrow" title="How much you borrow relative to your collateral. Higher = riskier.">Loan-to-value</span>
              <span className="mono" style={{ fontSize: 12 }}>{ltv}%</span>
            </div>
            <input type="range" min="0" max="80" value={ltv}
                   onChange={(e) => setLtv(+e.target.value)}
                   style={{ width: "100%", accentColor: "var(--ink)" }} />
            <LtvGauge ltv={ltv} liqAt={market.liq} />
            {ltv >= 70 && (
              <div style={{
                marginTop: 10, padding: "10px 12px",
                background: "var(--danger-soft)", border: "1px solid var(--danger)",
                color: "var(--danger)", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.55,
              }}>
                <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>Liq risk</strong> · a {Math.round((1 - ltv / market.liq) * 100)}% price drop will liquidate this position.
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {!ctx.connected ? (
            <button className="btn lg" style={{ flex: 1 }} onClick={openConnect}>Connect to {side} <span className="ar">→</span></button>
          ) : locked ? (
            <button className="btn accent lg" style={{ flex: 1 }} onClick={grantPermit}>Grant permit first <span className="ar">→</span></button>
          ) : (
            <button className="btn lg" style={{ flex: 1 }}>
              Encrypt &amp; {side} {amount} {market.asset} <span className="ar">→</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary card */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 20 }}>
          <span className="eyebrow">summary</span>
          <div className="stack-2" style={{ marginTop: 12 }}>
            <div className="kv"><span className="k">{side} apy</span><span className="v" style={{ color: side === "supply" ? "var(--positive)" : "var(--danger)" }}>{side === "supply" ? "+" : "−"}{apy}%</span></div>
            <div className="kv"><span className="k">health after</span><span className="v"><Cipher value={side === "supply" ? "2.84" : "1.62"} locked={locked} size="sm" inline /></span></div>
            <div className="kv"><span className="k">liq price</span><span className="v">{market.asset === "ETH" ? "$1,820" : "–"}</span></div>
            <div className="kv"><span className="k">est. gas</span><span className="v">≈ 312k</span></div>
          </div>
        </div>

        <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 20 }}>
          <span className="eyebrow">market · {market.asset}</span>
          <div className="stack-2" style={{ marginTop: 12 }}>
            <div className="kv"><span className="k">utilization</span><span className="v">{market.util}%</span></div>
            <div style={{ marginTop: 6 }}>
              <div className="meter" style={{ height: 6 }}>
                <div className="fill" style={{ width: market.util + "%" }} />
              </div>
            </div>
            <div className="kv"><span className="k">public tvl</span><span className="v">{market.tvl}</span></div>
            <div className="kv"><span className="k">liq threshold</span><span className="v">{market.liq}%</span></div>
            <div className="kv"><span className="k">last oracle</span><span className="v">14s ago</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Lending = Lending;
