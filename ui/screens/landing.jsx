// screens/landing.jsx · Home (v4, distilled)
// Single-viewport hero + auto-playing permit demo. No editorial scroll sections.
// Connect button opens the Connect modal; CTAs route into the app.

const { useState: useStateH, useEffect: useEffectH, useRef: useRefH } = React;

function Landing({ setRoute, ctx, grantPermit, openConnect }) {
  const bridge = useOptionalBridge();
  const bridgeData = bridge.data || {};
  // Auto-play cipher cycle · only when wallet not connected (used as marketing demo)
  const [demoLocked, setDemoLocked] = useStateH(true);
  useEffectH(() => {
    if (ctx.connected) return;
    let phase = 0;
    const tick = () => {
      phase = (phase + 1) % 2;
      setDemoLocked(phase === 0);
    };
    const id = setInterval(tick, 6500);
    return () => clearInterval(id);
  }, [ctx.connected]);

  // Mask-wipe reveal on mount
  const [revealed, setRevealed] = useStateH(false);
  useEffectH(() => {
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Cursor-tracking accent glow on hero
  const heroRef = useRefH(null);
  useEffectH(() => {
    const el = heroRef.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", (e.clientX - r.left) + "px");
        el.style.setProperty("--my", (e.clientY - r.top) + "px");
        raf = 0;
      });
    };
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, []);

  const isReal = ctx.connected;
  const portfolioLocked = isReal ? !ctx.permitUnlocked : demoLocked;

  return (
    <main style={{ height: "calc(100vh - 56px)", overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
      {/* Background motion · atmospheric, performance-bounded */}
      <BackgroundOrbits />
      <section ref={heroRef} className="hero-cursor" style={{ flex: 1, minHeight: 0, position: "relative", padding: "32px 40px", zIndex: 1 }}>
        <div style={{
          maxWidth: 1320, margin: "0 auto",
          height: "100%",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(380px, 1fr)",
          gap: 56, alignItems: "center",
        }} className="home-grid">

          {/* LEFT · headline + actions */}
          <div style={{
            opacity: revealed ? 1 : 0,
            transform: revealed ? "translateY(0)" : "translateY(14px)",
            transition: "opacity 600ms var(--ease), transform 600ms var(--ease)",
          }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.12, textTransform: "uppercase" }}>
              An encrypted DeFi protocol · Arbitrum Sepolia
            </span>
            <h1 className="display" style={{
              fontSize: "clamp(48px, 5.8vw, 84px)",
              lineHeight: 1.04,
              letterSpacing: -0.022,
              marginTop: 20, marginBottom: 24,
              maxWidth: 760,
            }}>
              Borrow, swap, compound –
              <br />
              <em>without revealing</em> a number.
            </h1>
            <p style={{
              fontSize: 17, lineHeight: 1.55, color: "var(--ink-2)",
              maxWidth: 540, margin: 0,
            }}>
              Three things stay encrypted on-chain: your collateral, your debt, every step of your strategy. Only you can decrypt them · and only with a permit your wallet holds for fifteen minutes at a time.
            </p>

            <div className="row" style={{ gap: 12, marginTop: 32, flexWrap: "wrap" }}>
              <button className="btn lg" onClick={openConnect} data-testid="connect-wallet">
                Connect a wallet <span className="ar">→</span>
              </button>
              <button className="btn ghost lg" onClick={() => setRoute("strategies")}>
                Explore strategies
              </button>
            </div>

            <div className="row" style={{ gap: 18, marginTop: 28, color: "var(--muted)", flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: 0.06 }}>no read access to your balances</span>
              <span>·</span>
              <span className="mono" style={{ fontSize: 11, letterSpacing: 0.06 }}>no transaction without a signature</span>
            </div>
          </div>

          {/* RIGHT · live permit demo */}
          <div style={{
            opacity: revealed ? 1 : 0,
            transform: revealed ? "translateY(0)" : "translateY(14px)",
            transition: "opacity 600ms var(--ease) 150ms, transform 600ms var(--ease) 150ms",
          }}>
            <DemoCard locked={portfolioLocked} isReal={isReal} ctx={ctx} bridge={bridge} bridgeData={bridgeData} onToggle={() => isReal ? grantPermit() : setDemoLocked(l => !l)} />
          </div>
        </div>
      </section>

      {/* Bottom ticker · operational state of the protocol */}
      <Ticker items={bridgeData.ticker} />
    </main>
  );
}

/* ─── DemoCard · auto-playing permit cinematic ─── */
function getBridgePositionItemsH(positions) {
  if (Array.isArray(positions)) return positions;
  if (positions && Array.isArray(positions.items)) return positions.items;
  return [];
}

function sumPositionAmountsH(items, predicate) {
  return items.reduce((sum, item) => {
    if (!predicate(item)) return sum;
    const raw = String(item.amount || item.amountUsd || item.value || "").replace(/[^\d.-]/g, "");
    const n = Number(raw);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
}

function formatValueH(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(value);
}

function DemoCard({ locked, isReal, bridge, bridgeData, onToggle }) {
  const items = getBridgePositionItemsH(bridgeData && bridgeData.positions);
  const walletBalance = (bridgeData && bridgeData.walletBalance) || {};
  const supplied = sumPositionAmountsH(items, (item) => item.side === "supply");
  const borrowed = sumPositionAmountsH(items, (item) => item.side === "borrow");
  const inStrategies = sumPositionAmountsH(items, (item) => item.side === "vault" || item.kind === "strategy");
  const positionStatus = bridgeData && bridgeData.positions && bridgeData.positions.status;
  const fallback = !isReal ? "wallet required" : positionStatus === "empty" ? "no position" : getBridgeStatus(bridge, "positions", positionStatus || "loading");
  const rows = [
    ["Supplied", supplied > 0 ? formatValueH(supplied, fallback) : fallback, ""],
    ["Borrowed", borrowed > 0 ? formatValueH(borrowed, fallback) : fallback, ""],
    ["In strategies", inStrategies > 0 ? formatValueH(inStrategies, fallback) : fallback, ""],
  ];
  const netValue = walletBalance.netValue || walletBalance.balance || fallback;
  const changeLabel = walletBalance.change24h || (isReal ? getBridgeStatus(bridge, "walletBalance", "wallet status unavailable") : "wallet required");
  const strategyLabel = Array.isArray(bridgeData && bridgeData.strategies)
    ? `${bridgeData.strategies.length} strategies`
    : (isReal ? getBridgeStatus(bridge, "strategies", "strategies unavailable") : "wallet required");
  return (
    <div className="permit-stage" data-permit={locked ? "locked" : "unlocked"}
         style={{
           background: "var(--paper)",
           border: "1px solid var(--ink)",
           boxShadow: "6px 6px 0 0 var(--ink)",
           overflow: "hidden",
         }}>
      {/* Card header */}
      <div className="spread" style={{
        padding: "14px 22px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--paper-2)",
      }}>
        <span className="eyebrow">live · your portfolio</span>
        <span className="mono" style={{
          fontSize: 11,
          color: locked ? "var(--accent-ink)" : "var(--positive)",
          letterSpacing: 0.04,
        }}>
          {locked ? "permit · locked" : "permit · live · 14:32"}
        </span>
      </div>

      {/* Card body */}
      <div style={{ padding: 28 }}>
        <span className="eyebrow">net value · usd</span>
        <div style={{ marginTop: 6 }}>
          <Cipher value={netValue} unit="USD" locked={locked} size="xxl" />
        </div>
        <div className="row" style={{ gap: 18, marginTop: 14, color: "var(--muted)" }}>
          <span className="mono" style={{ fontSize: 12 }}>{changeLabel}</span>
          <span>·</span>
          <span className="mono" style={{ fontSize: 12 }}>{strategyLabel}</span>
        </div>

        <hr className="dashed" style={{ margin: "22px 0" }} />

        <div className="stack-3">
          {rows.map(([k, v, u], i) => (
            <div key={k} className="spread"
                 style={{ "--cipher-delay": (i * 80) + "ms" }}>
              <span className="mono" style={{
                fontSize: 12, color: "var(--muted)",
                letterSpacing: 0.04, textTransform: "uppercase",
              }}>{k}</span>
              <Cipher value={v} unit={u} locked={locked} size="md" inline />
            </div>
          ))}
        </div>
      </div>

      {/* Card footer */}
      <div style={{
        padding: "14px 22px",
        borderTop: "1px solid var(--hairline)",
        background: "var(--paper-2)",
      }}>
        <button className="btn accent" style={{ width: "100%" }} onClick={onToggle}>
          {locked
            ? <>Grant a permit <span className="ar">→</span></>
            : <>Permit live · auto-renew off <span className="ar">↻</span></>}
        </button>
      </div>
    </div>
  );
}

/* ─── Ticker · slow horizontal scroll of "live" state ─── */
function Ticker({ items }) {
  const hasItems = Array.isArray(items) && items.length > 0;
  const displayItems = hasItems ? items : ["loading bridge data"];
  // duplicate so the loop is seamless
  const loop = [...displayItems, ...displayItems];
  return (
    <div style={{
      borderTop: "1px solid var(--hairline)",
      background: "var(--paper-2)",
      overflow: "hidden",
      height: 36,
      display: "flex", alignItems: "center",
      position: "relative",
    }}>
      <style>{`
        @keyframes tickerLoop {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
      <div style={{
        display: "flex", gap: 36,
        whiteSpace: "nowrap",
        animation: "tickerLoop 60s linear infinite",
        paddingLeft: 28,
        willChange: "transform",
      }}>
        {loop.map((t, i) => (
          <span key={i} className="mono" style={{
            fontSize: 11, color: "var(--muted)", letterSpacing: 0.06,
            textTransform: "uppercase",
          }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

window.Landing = Landing;

/* ─── BackgroundOrbits · slow, atmospheric SVG drift ─── */
function BackgroundOrbits() {
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute", inset: 0,
        width: "100%", height: "100%",
        zIndex: 0,
        pointerEvents: "none",
        opacity: 0.45,
      }}
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1440 800"
    >
      <defs>
        <radialGradient id="bg-glow" cx="80%" cy="20%" r="60%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="800" fill="url(#bg-glow)" />
      {/* Slow drifting dotted orbits */}
      <g style={{ transformOrigin: "1100px 220px", animation: "orbitDrift 60s linear infinite" }}>
        <circle cx="1100" cy="220" r="180" fill="none" stroke="var(--hairline)" strokeWidth="1" strokeDasharray="2 6" />
        <circle cx="1100" cy="220" r="280" fill="none" stroke="var(--hairline)" strokeWidth="1" strokeDasharray="2 10" />
        <circle cx="1100" cy="220" r="380" fill="none" stroke="var(--hairline)" strokeWidth="1" strokeDasharray="2 14" />
      </g>
      <g style={{ transformOrigin: "1100px 220px", animation: "orbitCounter 90s linear infinite" }}>
        <circle cx="1100" cy="220" r="220" fill="none" stroke="var(--accent)" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="1 12" />
      </g>
      <style>{`
        @keyframes orbitDrift   { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes orbitCounter { from { transform: rotate(0); } to { transform: rotate(-360deg); } }
      `}</style>
    </svg>
  );
}
