// screens/dashboard.jsx · Portfolio (v4, master-detail)
// Left rail: Positions + Strategies + Activity grouped list.
// Right pane: detail of the selected item, or an Overview when nothing selected.

const { useState: useStateD, useEffect: useEffectD } = React;
const EMPTY_BRIDGE_CONTEXT_D = React.createContext({ data: {}, meta: { errors: [] } });

function useOptionalBridgeD() {
  const bridgeContext = typeof window !== "undefined" ? window.BridgeContext : null;
  return React.useContext(bridgeContext || EMPTY_BRIDGE_CONTEXT_D);
}

function hasBridgeListD(value) {
  return Array.isArray(value);
}

function bridgeItemsD(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return null;
}

function classifyBridgeStatusD(message, fallback) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("registry")) return "registry unavailable";
  if (lower.includes("rpc") || lower.includes("viem") || lower.includes("contract") || lower.includes("on-chain")) return "RPC unavailable";
  if (lower.includes("backend") || lower.includes("api") || lower.includes("fetch") || lower.includes("network") || lower.includes("request")) return "backend unavailable";
  return fallback || "bridge unavailable";
}

function bridgeStatusD(bridge, key, value, emptyLabel) {
  if (Array.isArray(value)) return value.length === 0 ? emptyLabel : null;
  if (value && Array.isArray(value.items)) {
    if (value.items.length > 0) return null;
    if (value.status === "empty") return emptyLabel;
    return classifyBridgeStatusD(value.reason || value.status, emptyLabel);
  }
  const meta = (bridge && bridge.meta) || {};
  const data = (bridge && bridge.data) || {};
  const readiness = meta.readiness || bridge.readiness || data.readiness || {};
  const entry = readiness[key] || readiness[String(key).replace(/s$/, "")] || null;
  if (entry) {
    const status = String(entry.status || entry.state || "").toLowerCase();
    if (status === "ready" || status === "ok" || status === "available") return null;
    return classifyBridgeStatusD(entry.reason || entry.message || status, `loading ${key}`);
  }
  const errors = Array.isArray(meta.errors) ? meta.errors : [];
  const error = errors.slice().reverse().find((err) => {
    const source = String(err && err.source || "").toLowerCase();
    const message = String(err && (err.message || (err.error && err.error.message)) || "").toLowerCase();
    return source.includes(key) || message.includes(key) || message.includes("registry") || message.includes("rpc");
  });
  return error ? classifyBridgeStatusD(String(error.message || (error.error && error.error.message) || error), `loading ${key}`) : `loading ${key}`;
}

function textD(value, fallback = "–") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function firstD(source, keys, fallback = null) {
  for (const key of keys) {
    if (source && source[key] !== null && source[key] !== undefined && source[key] !== "") return source[key];
  }
  return fallback;
}

function cleanNumberD(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return textD(value);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function percentD(value) {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "string") return value.includes("%") ? value : `${value}%`;
  if (typeof value === "number" && Number.isFinite(value)) return `${value >= 0 ? "+" : ""}${cleanNumberD(value)}%`;
  return textD(value);
}

function negativeD(value) {
  return String(value || "").trim().startsWith("-") || String(value || "").trim().startsWith("−");
}

function normalizePositionD(position, index) {
  const asset = textD(firstD(position, ["asset", "symbol", "token", "market"], "–"));
  const side = textD(firstD(position, ["side", "type", "kind"], "position"));
  const amount = firstD(position, ["amount", "balance", "value", "decryptedAmount", "encryptedAmount", "supplied", "borrowed"], null);
  return {
    ...position,
    id: textD(firstD(position, ["id", "positionId", "address", "txHash"], `position-${index}`)),
    venue: textD(firstD(position, ["venue", "protocol", "pool", "source"], "–")),
    asset,
    side,
    amount: textD(amount),
    apy: percentD(firstD(position, ["apy", "supplyApy", "supplyAPY", "borrowApy", "borrowAPY", "yield"], null)),
    liq: firstD(position, ["liq", "liquidation", "liquidationPrice", "liquidationThreshold"], null),
    interestAccrued: firstD(position, ["interestAccrued", "accruedInterest", "interest30d"], null),
    oracle: firstD(position, ["oracle", "priceOracle"], null),
  };
}

function normalizeStrategyD(strategy, index) {
  const amount = firstD(strategy, ["staked", "stake", "deposited", "amount", "tvl"], null);
  const asset = firstD(strategy, ["asset", "symbol", "token"], null);
  return {
    ...strategy,
    id: textD(firstD(strategy, ["id", "strategyId", "address", "name"], `strategy-${index}`)),
    name: textD(firstD(strategy, ["name", "title", "label"], `Strategy ${index + 1}`)),
    apy: percentD(firstD(strategy, ["apy", "yield", "estimatedApy", "estimatedAPY"], null)),
    staked: amount === null ? "–" : asset && !String(amount).includes(String(asset)) ? `${textD(amount)} ${asset}` : textD(amount),
    loops: firstD(strategy, ["loops", "loopCount", "iterations"], null),
    last: textD(firstD(strategy, ["last", "lastExecution", "updatedAt", "executedAt"], "–")),
    runHistory: Array.isArray(strategy.runHistory) ? strategy.runHistory : null,
  };
}

function normalizeActivityD(activity, index) {
  return {
    ...activity,
    id: textD(firstD(activity, ["id", "txHash", "hash", "block"], `activity-${index}`)),
    block: firstD(activity, ["block", "blockNumber"], null),
    age: textD(firstD(activity, ["age", "timeAgo", "timestamp", "createdAt"], "–")),
    what: textD(firstD(activity, ["what", "description", "event", "action", "type"], "Bridge event")),
    kind: textD(firstD(activity, ["kind", "type", "eventType"], "event")),
    asset: textD(firstD(activity, ["asset", "symbol", "token", "market"], "–")),
    delta: textD(firstD(activity, ["delta", "amount", "value"], "–")),
  };
}

function listStatusD(label, value, bridge) {
  return bridgeStatusD(bridge, label, value, `no ${label} available`);
}

function Dashboard({ setRoute, ctx, grantPermit, openConnect }) {
  const bridge = useOptionalBridgeD();
  const bridgeData = bridge.data || {};
  const positionItems = bridgeItemsD(bridgeData.positions);
  const strategyItems = bridgeItemsD(bridgeData.strategies);
  const activityItems = bridgeItemsD(bridgeData.activities);
  const positions = positionItems ? positionItems.map(normalizePositionD) : null;
  const strategies = strategyItems ? strategyItems.map(normalizeStrategyD) : null;
  const activities = activityItems ? activityItems.map(normalizeActivityD) : null;
  const locked = !ctx.permitUnlocked;
  const [selectedId, setSelectedId] = useStateD(null);

  const all = [
    ...(positions || []).map(p => ({ kind: "position", ...p })),
    ...(strategies || []).map(s => ({ kind: "strategy", ...s })),
    ...(activities || []).map(a => ({ kind: "activity", ...a })),
  ];
  const selected = all.find(x => x.id === selectedId);
  const activeCount = (positions ? positions.length : 0) + (strategies ? strategies.length : 0);
  const loadingAny = !positions || !strategies || !activities;

  useEffectD(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  if (!ctx.connected) return <DashboardEmpty openConnect={openConnect} setRoute={setRoute} />;

  return (
    <MasterDetail
      collapseKey="portfolio"
      listHeader={
        <>
          <span className="eyebrow">Portfolio</span>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
              {loadingAny ? bridgeStatusD(bridge, "data", null, "bridge data loading") : `${activeCount} active · bridge synced`}
            </span>
          </div>
        </>
      }
      listBody={
        <>
          <MDGroup>Positions · {positions ? positions.length : "loading"}</MDGroup>
          {positions && positions.length ? positions.map((p, i) => (
            <MDItem
              key={p.id}
              idx={String(i + 1).padStart(2, "0")}
              title={`${p.asset} · ${p.side}`}
              sub={p.venue}
              right={
                <span className="mono" style={{ fontSize: 12, color: negativeD(p.apy) ? "var(--danger)" : "var(--positive)" }}>
                  {p.apy}
                </span>
              }
              selected={selectedId === p.id}
              onClick={() => setSelectedId(p.id)}
            />
          )) : (
            <EmptyListMessageD>{listStatusD("positions", bridgeData.positions, bridge)}</EmptyListMessageD>
          )}

          <MDGroup>Strategies · {strategies ? strategies.length : "loading"}</MDGroup>
          {strategies && strategies.length ? strategies.map((s, i) => (
            <MDItem
              key={s.id}
              idx={`S/${String(i + 1).padStart(2, "0")}`}
              title={s.name}
              sub={`${s.loops === null ? "loops –" : `×${s.loops} loops`} · ${s.last}`}
              right={<span className="mono" style={{ fontSize: 12, color: negativeD(s.apy) ? "var(--danger)" : "var(--positive)" }}>{s.apy}</span>}
              selected={selectedId === s.id}
              onClick={() => setSelectedId(s.id)}
            />
          )) : (
            <EmptyListMessageD>{listStatusD("strategies", bridgeData.strategies, bridge)}</EmptyListMessageD>
          )}

          <MDGroup>Recent activity · {activities ? activities.length : "loading"}</MDGroup>
          {activities && activities.length ? activities.map(a => (
            <MDItem
              key={a.id}
              idx={a.age}
              title={a.what}
              sub={`${a.kind} · ${a.asset}`}
              right={<span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{a.delta}</span>}
              selected={selectedId === a.id}
              onClick={() => setSelectedId(a.id)}
            />
          )) : (
            <EmptyListMessageD>{listStatusD("activities", bridgeData.activities, bridge)}</EmptyListMessageD>
          )}
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
        selected ? <DetailFor selected={selected} locked={locked} setRoute={setRoute} grantPermit={grantPermit} bridge={bridge} ctx={ctx} />
                 : <Overview locked={locked} grantPermit={grantPermit} setRoute={setRoute} bridgeData={bridgeData} positions={positions} strategies={strategies} activities={activities} />
      }
    />
  );
}

function EmptyListMessageD({ children }) {
  return (
    <div className="mono" style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11 }}>
      {children}
    </div>
  );
}

/* ─── Overview (default detail) ─── */
function Overview({ locked, grantPermit, setRoute, bridgeData, positions, strategies, activities }) {
  const netValue = firstD(bridgeData, ["portfolioNetValue", "netValue", "totalValue"], null);
  const portfolioLTV = firstD(bridgeData, ["portfolioLTV", "ltv"], null);
  const ltvValue = typeof portfolioLTV === "object" && portfolioLTV ? firstD(portfolioLTV, ["value", "ltv"], null) : portfolioLTV;
  const liqAt = typeof portfolioLTV === "object" && portfolioLTV ? firstD(portfolioLTV, ["liqAt", "liquidationThreshold"], null) : null;
  const ltvNumber = typeof ltvValue === "number" ? ltvValue : Number.parseFloat(ltvValue);
  const hasLtv = Number.isFinite(ltvNumber);
  const permitLabel = locked ? "locked" : `${Math.floor((bridgeData.permitSeconds || 0) / 60) || "live"}`;

  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Four stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 1, background: "var(--hairline)", border: "1px solid var(--hairline)" }}>
        {[
          { k: "Net value · usd", v: textD(netValue, positions ? "–" : "loading"), sub: positions ? `${positions.length} positions` : "waiting for bridge positions", cipher: netValue !== null, color: "var(--positive)" },
          { k: "LTV", v: hasLtv ? `${cleanNumberD(ltvNumber)}%` : positions ? "–" : "loading", sub: hasLtv && liqAt ? `liq ${liqAt}` : "bridge LTV unavailable", cipher: false },
          { k: "Permit", v: permitLabel, sub: locked ? "grant to decrypt" : "live · auto-blur on expire", cipher: false, color: locked ? "var(--danger)" : "var(--ink)" },
          { k: "Activity", v: activities ? String(activities.length) : "loading", sub: activities ? "bridge events" : "waiting for bridge activity", cipher: false },
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
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{positions ? `${positions.length} positions` : "positions loading"}</span>
        </div>
        {hasLtv ? (
          <>
            <LtvGauge ltv={ltvNumber} liqAt={liqAt || 80} labels={false} height={10} />
            <div className="row" style={{ gap: 22, marginTop: 14, color: "var(--muted)" }}>
              <span className="mono" style={{ fontSize: 12 }}>ltv {cleanNumberD(ltvNumber)}%</span>
              {liqAt && <><span>·</span><span className="mono" style={{ fontSize: 12 }}>liq @ {liqAt}</span></>}
            </div>
          </>
        ) : (
          <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
            {positions ? "bridge LTV unavailable" : "loading bridge LTV"}
          </div>
        )}
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
function DetailFor({ selected, locked, setRoute, grantPermit, bridge, ctx }) {
  if (selected.kind === "position") return <PositionDetail p={selected} locked={locked} setRoute={setRoute} bridge={bridge} ctx={ctx} />;
  if (selected.kind === "strategy") return <StrategyDetail s={selected} locked={locked} setRoute={setRoute} />;
  if (selected.kind === "activity") return <ActivityDetail a={selected} locked={locked} />;
  return null;
}

function PositionDetail({ p, locked, setRoute, bridge, ctx }) {
  const [crStep, setCrStep] = useStateD(null); // null | "committing" | "decrypting" | "done" | "failed"
  const [crError, setCrError] = useStateD(null);

  async function handleClose() {
    setCrError(null);
    const token = firstD(p, ["tokenAddress", "token", "address", "market"], null);
    const amount = firstD(p, ["amount", "balance", "value", "decryptedAmount", "encryptedAmount", "supplied"], null);
    if (!token || !amount || amount === "–") {
      setCrError("Missing token or amount");
      return;
    }
    if (!bridge?.contract?.write?.withdrawCommit || !bridge?.contract?.write?.withdrawExecute) {
      setCrError("Bridge not ready");
      return;
    }
    setCrStep("committing");
    try {
      const tx1 = await bridge.contract.write.withdrawCommit(token, amount, ctx.address);
      if (tx1.status === "reverted") { setCrStep("failed"); return; }
      setCrStep("decrypting");
      const tx2 = await bridge.contract.write.withdrawExecute(token, tx1.commitId, ctx.address);
      if (tx2.status === "reverted") { setCrStep("failed"); return; }
      setCrStep("done");
    } catch (e) {
      setCrStep("failed");
      setCrError(e.message);
    }
  }

  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 1, background: "var(--hairline)", border: "1px solid var(--hairline)" }}>
        <Tile k="amount" cipher={p.amount === "–" ? null : p.amount} plain={p.amount === "–" ? "–" : null} unit={p.asset} locked={locked} />
        <Tile k="apy" plain={p.apy} color={negativeD(p.apy) ? "var(--danger)" : "var(--positive)"} />
        <Tile k="liquidation" plain={textD(p.liq)} />
      </div>
      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <div className="kv"><span className="k">venue</span><span className="v">{p.venue}</span></div>
        <div className="kv"><span className="k">side</span><span className="v">{p.side}</span></div>
        <div className="kv"><span className="k">asset</span><span className="v">{p.asset}</span></div>
        <div className="kv"><span className="k">interest accrued</span><span className="v">{p.interestAccrued ? <Cipher value={p.interestAccrued} locked={locked} size="sm" inline /> : "–"}</span></div>
        <div className="kv"><span className="k">oracle</span><span className="v">{textD(p.oracle)}</span></div>
      </div>
      {crError && (
        <div className="mono" style={{ fontSize: 12, color: "var(--danger)", padding: "8px 0" }}>{crError}</div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => setRoute("lend")}>Add to position <span className="ar">→</span></button>
        <button className="btn ghost sm" onClick={() => setRoute("lend")}>Withdraw</button>
        <button
          className="btn ghost sm"
          style={{ color: "var(--danger)" }}
          onClick={handleClose}
          disabled={!!crStep && crStep !== "failed" && crStep !== "done"}
        >
          {crStep === "committing" ? "Committing…" :
           crStep === "decrypting" ? "Decrypting…" :
           crStep === "done" ? "Done" :
           "Close position"}
        </button>
      </div>
    </div>
  );
}

function StrategyDetail({ s, locked, setRoute }) {
  const stakeParts = s.staked === "–" ? ["–", ""] : String(s.staked).split(" ");
  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 1, background: "var(--hairline)", border: "1px solid var(--hairline)" }}>
        <Tile k="apy" plain={s.apy} color={negativeD(s.apy) ? "var(--danger)" : "var(--positive)"} />
        <Tile k="my stake" cipher={s.staked === "–" ? null : stakeParts[0]} plain={s.staked === "–" ? "–" : null} unit={stakeParts.slice(1).join(" ")} locked={locked} />
        <Tile k="loops" plain={s.loops === null ? "–" : `×${s.loops}`} />
        <Tile k="last execution" plain={s.last} />
      </div>

      {/* Run history bar */}
      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <span className="eyebrow">execution history</span>
        {s.runHistory && s.runHistory.length ? (
          <>
            <div className="row" style={{ gap: 4, marginTop: 12 }}>
              {s.runHistory.slice(-8).map((run, i) => (
                <span key={i} style={{
                  flex: 1, height: 6,
                  background: run && (run.success === false || run.status === "failed") ? "var(--danger)" : "var(--positive)",
                }} />
              ))}
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, letterSpacing: 0.04 }}>
              {s.runHistory.length} bridge executions
            </div>
          </>
        ) : (
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, letterSpacing: 0.04 }}>
            no execution history available
          </div>
        )}
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
  const blockLabel = typeof a.block === "number" ? `#${a.block.toLocaleString()}` : textD(a.block);
  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <div className="kv"><span className="k">block</span><span className="v">{blockLabel}</span></div>
        <div className="kv"><span className="k">age</span><span className="v">{a.age}</span></div>
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
