// screens/dashboard.jsx · Portfolio (v4, master-detail)
// Left rail: Positions + Strategies + Activity grouped list.
// Right pane: detail of the selected item, or an Overview when nothing selected.

const { useState: useStateD } = React;

const D_POSITIONS = [
  { id: "p1", venue: "Lending Pool", asset: "USDC", side: "supply", amount: "42,084.13", apy: "+4.82%", liq: null },
  { id: "p2", venue: "Lending Pool", asset: "ETH",  side: "borrow", amount: "5.420",     apy: "−3.14%", liq: "$1,820" },
  { id: "p3", venue: "Vault · S/01", asset: "USDC", side: "vault",  amount: "12,840.00", apy: "+11.4%", liq: null },
  { id: "p4", venue: "Vault · S/02", asset: "WETH", side: "vault",  amount: "3.205",     apy: "+8.7%",  liq: null },
  { id: "p5", venue: "Vault · S/03", asset: "WBTC", side: "vault",  amount: "0.1402",    apy: "+14.2%", liq: null },
];

const D_STRATS = [
  { id: "s1", name: "Lean USDC leverage", apy: "+11.4%", staked: "12,840 USDC", loops: 4, last: "2m ago" },
  { id: "s2", name: "ETH delta-neutral",  apy: "+8.7%",  staked: "8,200 USDC",  loops: 3, last: "11m ago" },
  { id: "s3", name: "WBTC carry & swap",  apy: "+14.2%", staked: "4,108 USDC",  loops: 5, last: "1h ago" },
];

const D_ACTIVITY = [
  { id: "a1", block: 182944108, age: "14s",  what: "S/01 · loop iter 3",  kind: "shield",  asset: "USDC",     delta: "+5,200.00" },
  { id: "a2", block: 182944094, age: "47s",  what: "Composer open",       kind: "borrow",  asset: "ETH",      delta: "−1.480" },
  { id: "a3", block: 182944081, age: "1m",   what: "Pool · interest",     kind: "accrue",  asset: "USDC",     delta: "+12.04" },
  { id: "a4", block: 182943988, age: "4m",   what: "Swap intent filled",  kind: "swap",    asset: "ETH→USDC", delta: "≈4,820" },
  { id: "a5", block: 182943890, age: "11m",  what: "S/02 · re-supply",    kind: "shield",  asset: "WETH",     delta: "+0.840" },
  { id: "a6", block: 182943742, age: "26m",  what: "Permit · renewed",    kind: "permit",  asset: "–",        delta: "–" },
];

function Dashboard({ setRoute, ctx, grantPermit, openConnect }) {
  const locked = !ctx.permitUnlocked;
  const [selectedId, setSelectedId] = useStateD(null);

  if (!ctx.connected) return <DashboardEmpty openConnect={openConnect} setRoute={setRoute} />;

  // Build the list, plus a lookup
  const all = [
    ...D_POSITIONS.map(p => ({ kind: "position", ...p })),
    ...D_STRATS.map(s => ({ kind: "strategy", ...s })),
    ...D_ACTIVITY.map(a => ({ kind: "activity", ...a })),
  ];
  const selected = all.find(x => x.id === selectedId);

  return (
    <MasterDetail
      collapseKey="portfolio"
      listHeader={
        <>
          <span className="eyebrow">Portfolio</span>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
              {D_POSITIONS.length + D_STRATS.length} active · synced 14s ago
            </span>
          </div>
        </>
      }
      listBody={
        <>
          <MDGroup>Positions · {D_POSITIONS.length}</MDGroup>
          {D_POSITIONS.map((p, i) => (
            <MDItem
              key={p.id}
              idx={String(i + 1).padStart(2, "0")}
              title={`${p.asset} · ${p.side}`}
              sub={p.venue}
              right={
                <span className="mono" style={{ fontSize: 12, color: p.apy.startsWith("−") ? "var(--danger)" : "var(--positive)" }}>
                  {p.apy}
                </span>
              }
              selected={selectedId === p.id}
              onClick={() => setSelectedId(p.id)}
            />
          ))}

          <MDGroup>Strategies · {D_STRATS.length}</MDGroup>
          {D_STRATS.map((s, i) => (
            <MDItem
              key={s.id}
              idx={`S/${String(i + 1).padStart(2, "0")}`}
              title={s.name}
              sub={`×${s.loops} loops · ${s.last}`}
              right={<span className="mono" style={{ fontSize: 12, color: "var(--positive)" }}>{s.apy}</span>}
              selected={selectedId === s.id}
              onClick={() => setSelectedId(s.id)}
            />
          ))}

          <MDGroup>Recent activity</MDGroup>
          {D_ACTIVITY.map(a => (
            <MDItem
              key={a.id}
              idx={a.age}
              title={a.what}
              sub={`${a.kind} · ${a.asset}`}
              right={<span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{a.delta}</span>}
              selected={selectedId === a.id}
              onClick={() => setSelectedId(a.id)}
            />
          ))}
        </>
      }
      detailHeader={
        selected ? (
          <>
            <div className="row" style={{ gap: 12 }}>
              <Tag tone={selected.kind === "position" ? "default" : selected.kind === "strategy" ? "accent" : "positive"}>
                {selected.kind}
              </Tag>
              <h2 className="serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.012, margin: 0 }}>
                {selected.kind === "position" ? `${selected.asset} · ${selected.side}` :
                 selected.kind === "strategy" ? selected.name :
                 selected.what}
              </h2>
            </div>
            <button className="btn ghost sm" onClick={() => setSelectedId(null)}>Back to overview</button>
          </>
        ) : (
          <>
            <h2 className="serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.012, margin: 0 }}>
              Overview
            </h2>
            <PermitChip unlocked={ctx.permitUnlocked} secondsLeft={ctx.permitSeconds} onClick={grantPermit} />
          </>
        )
      }
      detailBody={
        selected ? <DetailFor selected={selected} locked={locked} setRoute={setRoute} grantPermit={grantPermit} />
                 : <Overview locked={locked} grantPermit={grantPermit} setRoute={setRoute} />
      }
    />
  );
}

/* ─── Overview (default detail) ─── */
function Overview({ locked, grantPermit, setRoute }) {
  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Four stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 1, background: "var(--hairline)", border: "1px solid var(--hairline)" }}>
        {[
          { k: "Net value · usd", v: "68,412.07", sub: "+1,612.04 / 24h", cipher: true, color: "var(--positive)" },
          { k: "LTV", v: "44.8%", sub: "buffer 35.2% · liq $1,820", cipher: false },
          { k: "Permit", v: locked ? "locked" : "13:42", sub: locked ? "grant to decrypt" : "live · auto-blur on expire", cipher: false, color: locked ? "var(--danger)" : "var(--ink)" },
          { k: "Gas · ETH", v: "0.412", sub: "≈ $1,049 · ~42 ops", cipher: false },
        ].map((t, i) => (
          <div key={i} style={{ background: "var(--paper)", padding: 22 }}>
            <span className="eyebrow">{t.k}</span>
            <div style={{ marginTop: 6, fontFamily: "var(--display)", fontSize: 38, lineHeight: 1.1, color: t.color || "var(--ink)" }}>
              {t.cipher ? <Cipher value={t.v} locked={locked} size="xl" inline /> : t.v}
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, letterSpacing: 0.04 }}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* LTV detail card */}
      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <span className="eyebrow">Loan-to-value · weighted</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>4 collateralized positions</span>
        </div>
        <LtvGauge ltv={44.8} liqAt={80} labels={false} height={10} />
        <div className="row" style={{ gap: 22, marginTop: 14, color: "var(--muted)" }}>
          <span className="mono" style={{ fontSize: 12 }}>liq @ ETH $1,820</span>
          <span>·</span>
          <span className="mono" style={{ fontSize: 12 }}>oracle: Pyth · fresh 14s</span>
          <span>·</span>
          <span className="mono" style={{ fontSize: 12 }}>buffer: +35.2%</span>
        </div>
        <hr className="dashed" style={{ margin: "18px 0" }} />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={() => setRoute("lend")}>Add collateral</button>
          <button className="btn ghost sm" onClick={() => setRoute("lend")}>Repay debt</button>
        </div>
      </div>

      {/* Hint */}
      <div className="mono" style={{ fontSize: 11, color: "var(--muted)", padding: "12px 4px", letterSpacing: 0.04 }}>
        Pick a position, strategy, or activity entry on the left to see its detail.
      </div>
    </div>
  );
}

/* ─── DetailFor (renders based on selected.kind) ─── */
function DetailFor({ selected, locked, setRoute, grantPermit }) {
  if (selected.kind === "position") return <PositionDetail p={selected} locked={locked} setRoute={setRoute} />;
  if (selected.kind === "strategy") return <StrategyDetail s={selected} locked={locked} setRoute={setRoute} />;
  if (selected.kind === "activity") return <ActivityDetail a={selected} locked={locked} />;
  return null;
}

function PositionDetail({ p, locked, setRoute }) {
  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 1, background: "var(--hairline)", border: "1px solid var(--hairline)" }}>
        <Tile k="amount" cipher={p.amount} unit={p.asset} locked={locked} />
        <Tile k="apy" plain={p.apy} color={p.apy.startsWith("−") ? "var(--danger)" : "var(--positive)"} />
        <Tile k="liquidation" plain={p.liq || "–"} />
      </div>
      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <div className="kv"><span className="k">venue</span><span className="v">{p.venue}</span></div>
        <div className="kv"><span className="k">side</span><span className="v">{p.side}</span></div>
        <div className="kv"><span className="k">asset</span><span className="v">{p.asset}</span></div>
        <div className="kv"><span className="k">interest accrued · 30d</span><span className="v"><Cipher value="142.08" locked={locked} size="sm" inline /></span></div>
        <div className="kv"><span className="k">oracle</span><span className="v">Pyth · fresh 14s</span></div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => setRoute("lend")}>Add to position <span className="ar">→</span></button>
        <button className="btn ghost sm" onClick={() => setRoute("lend")}>Withdraw</button>
        <button className="btn ghost sm" style={{ color: "var(--danger)" }}>Close position</button>
      </div>
    </div>
  );
}

function StrategyDetail({ s, locked, setRoute }) {
  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 1, background: "var(--hairline)", border: "1px solid var(--hairline)" }}>
        <Tile k="apy" plain={s.apy} color="var(--positive)" />
        <Tile k="my stake" cipher={s.staked.split(" ")[0]} unit={s.staked.split(" ")[1]} locked={locked} />
        <Tile k="loops" plain={`×${s.loops}`} />
        <Tile k="last execution" plain={s.last} />
      </div>

      {/* Run history bar */}
      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <span className="eyebrow">last 8 executions</span>
        <div className="row" style={{ gap: 4, marginTop: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} style={{
              flex: 1, height: 6,
              background: i < 6 ? "var(--positive)" : "var(--hairline)",
            }} />
          ))}
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, letterSpacing: 0.04 }}>
          6 of 8 succeeded · 2 skipped (LTV guardrail)
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => setRoute("strategies")}>Open in builder <span className="ar">→</span></button>
        <button className="btn ghost sm">Pause</button>
        <button className="btn ghost sm" style={{ color: "var(--danger)" }}>Close</button>
      </div>
    </div>
  );
}

function ActivityDetail({ a, locked }) {
  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <div className="kv"><span className="k">block</span><span className="v">#{a.block.toLocaleString()}</span></div>
        <div className="kv"><span className="k">age</span><span className="v">{a.age} ago</span></div>
        <div className="kv"><span className="k">type</span><span className="v">{a.kind}</span></div>
        <div className="kv"><span className="k">asset</span><span className="v">{a.asset}</span></div>
        <div className="kv"><span className="k">amount</span><span className="v">
          {a.delta === "–" ? "–" : <Cipher value={a.delta} locked={locked} size="sm" inline />}
        </span></div>
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
        Amount is ciphertext on-chain. Decryption is permit-gated and never leaves your browser.
      </div>
    </div>
  );
}

function Tile({ k, cipher, plain, unit, locked, color }) {
  return (
    <div style={{ background: "var(--paper)", padding: 18 }}>
      <span className="eyebrow">{k}</span>
      <div style={{ marginTop: 6, fontFamily: "var(--display)", fontSize: 28, lineHeight: 1.1, color: color || "var(--ink)" }}>
        {cipher ? <Cipher value={cipher} unit={unit} locked={locked} size="lg" inline /> : plain}
      </div>
    </div>
  );
}

/* ─── Empty state (no wallet) ─── */
function DashboardEmpty({ openConnect, setRoute }) {
  return (
    <main style={{ minHeight: "calc(100vh - 56px)", display: "grid", placeItems: "center", padding: 28 }}>
      <div style={{
        maxWidth: 1080, width: "100%",
        display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 56, alignItems: "center",
      }} className="cta-grid">
        <div>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.1, textTransform: "uppercase" }}>Portfolio · empty</span>
          <h2 className="sectionhead-title" style={{ fontSize: "clamp(34px, 4.6vw, 52px)", marginTop: 14, marginBottom: 18, maxWidth: 520 }}>
            Connect to see your positions.
          </h2>
          <p style={{ color: "var(--muted)", marginTop: 16, marginBottom: 24, maxWidth: 460, lineHeight: 1.55 }}>
            We can't fetch your balances without a wallet connection. One signature to prove ownership, then a one-click permit so your wallet can decrypt its own numbers.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn lg" onClick={openConnect}>Connect wallet <span className="ar">→</span></button>
            <button className="btn ghost lg" onClick={() => setRoute("strategies")}>Browse strategies first</button>
          </div>
        </div>

        <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 26 }}>
          <span className="eyebrow">preview · sample portfolio</span>
          <div style={{ marginTop: 14, filter: "blur(2px) opacity(0.55)", pointerEvents: "none" }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 48, lineHeight: 1.1 }}>$0.00</div>
            <hr className="dashed" style={{ margin: "16px 0" }} />
            {[["Supplied", "–"], ["Borrowed", "–"], ["In strategies", "–"]].map(([k, v]) => (
              <div key={k} className="spread" style={{ padding: "8px 0" }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)", letterSpacing: 0.04, textTransform: "uppercase" }}>{k}</span>
                <span className="mono" style={{ fontSize: 14 }}>{v}</span>
              </div>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 16, textAlign: "center", letterSpacing: 0.04 }}>
            ↑ what you'll see after connecting
          </div>
        </div>
      </div>
    </main>
  );
}

window.Dashboard = Dashboard;
