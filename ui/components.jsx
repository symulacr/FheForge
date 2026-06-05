// components.jsx · shared FheForge components (v4)
// Cipher, PermitChip, MasterDetail shell, Modal, TopBar, ThemeToggle.
// Exported to window for cross-file use.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ─────────────────────────────────────────────────────────────────────
   Cipher · the encrypted-value primitive.
   ───────────────────────────────────────────────────────────────────── */
function Cipher({ value, unit, locked = true, size = "md", inline = false, dim = false }) {
  const sizeMap = {
    sm: { fs: 13, gap: 6 },
    md: { fs: 15, gap: 8 },
    lg: { fs: 22, gap: 10 },
    xl: { fs: 36, gap: 12 },
    xxl:{ fs: 56, gap: 14 },
  };
  const s = sizeMap[size] || sizeMap.md;
  // Large values use clamp + container queries so they auto-shrink to fit.
  const isLarge = size === "xl" || size === "xxl";
  const style = isLarge
    ? { fontSize: `min(${s.fs}px, ${size === "xxl" ? "14cqi" : "11cqi"})`, gap: s.gap, opacity: dim ? 0.55 : 1 }
    : { fontSize: s.fs, gap: s.gap, opacity: dim ? 0.55 : 1 };
  return (
    <span
      className={"cipher " + (locked ? "locked" : "unlocked") + (isLarge ? " cipher-fit" : "")}
      style={style}
      title={locked
        ? "Encrypted on-chain. Grant a permit so your wallet can decrypt this value."
        : "Decrypted locally with your permit. Re-encrypts when the permit expires."}
    >
      <span className="plain">
        {value}
        {unit ? <span style={{ marginLeft: 4, color: "var(--muted)" }}>{unit}</span> : null}
      </span>
      {!inline && <span className="lock-mark">{locked ? "encrypted" : ""}</span>}
    </span>
  );
}

/* PermitChip · top-bar indicator of FHE permit health (countdown). */
function PermitChip({ unlocked, secondsLeft, onClick }) {
  const mm = Math.max(0, Math.floor(secondsLeft / 60));
  const ss = Math.max(0, secondsLeft % 60).toString().padStart(2, "0");
  return (
    <button
      onClick={onClick}
      className={"chip " + (unlocked ? "live" : "warn")}
      style={{
        cursor: "pointer",
        background: unlocked ? "var(--paper)" : "var(--accent-soft)",
        borderColor: unlocked ? "var(--hairline)" : "var(--accent)",
      }}
      title={unlocked
        ? "Permit live. Your wallet can decrypt your own balances. Click to renew."
        : "No permit. Encrypted balances stay blurred. Click to grant."}
    >
      <span className="dot" />
      <span>{unlocked ? `permit · ${mm}:${ss}` : "permit · locked"}</span>
    </button>
  );
}

/* Wallet chip · clickable to open the Connect modal */
function WalletChip({ address, chain, onClick }) {
  const short = address ? `${address.slice(0,6)}…${address.slice(-4)}` : "–";
  return (
    <button
      onClick={onClick}
      className="chip"
      style={{ borderColor: "var(--ink)", color: "var(--ink)", cursor: "pointer", background: "var(--paper)" }}
    >
      <span className="dot" style={{ background: "var(--ink)" }} />
      <span style={{ textTransform: "none", letterSpacing: 0.02 }}>{short}</span>
      <span style={{ color: "var(--muted)" }}>·</span>
      <span>{chain}</span>
    </button>
  );
}

/* ─── Theme toggle · swaps data-theme attribute on <html> ─── */
function ThemeToggle({ theme, setTheme }) {
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="chip"
      style={{ cursor: "pointer" }}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <span style={{ display: "inline-block", width: 12, height: 12, position: "relative" }}>
        {theme === "dark" ? (
          /* moon */
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ display: "block" }}>
            <path d="M9.5 7.2A4 4 0 0 1 4.8 2.5a4 4 0 1 0 4.7 4.7Z" fill="currentColor" />
          </svg>
        ) : (
          /* sun */
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ display: "block" }}>
            <circle cx="6" cy="6" r="2.4" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="1" strokeLinecap="round">
              <line x1="6" y1="1" x2="6" y2="2.4" />
              <line x1="6" y1="9.6" x2="6" y2="11" />
              <line x1="1" y1="6" x2="2.4" y2="6" />
              <line x1="9.6" y1="6" x2="11" y2="6" />
              <line x1="2.4" y1="2.4" x2="3.4" y2="3.4" />
              <line x1="8.6" y1="8.6" x2="9.6" y2="9.6" />
              <line x1="2.4" y1="9.6" x2="3.4" y2="8.6" />
              <line x1="8.6" y1="3.4" x2="9.6" y2="2.4" />
            </g>
          </svg>
        )}
      </span>
      <span>{theme === "dark" ? "dark" : "light"}</span>
    </button>
  );
}

/* ─── Asset glyph ─── */
const ASSET_SWATCH = {
  USDC: "oklch(70% 0.10 240)",
  ETH:  "oklch(40% 0.06 260)",
  WBTC: "oklch(70% 0.13 50)",
  ARB:  "oklch(60% 0.10 230)",
  GHO:  "oklch(60% 0.10 300)",
  DAI:  "oklch(70% 0.13 80)",
  WETH: "oklch(40% 0.06 260)",
};
function AssetGlyph({ sym, size = 22 }) {
  const bg = ASSET_SWATCH[sym] || "var(--ink-2)";
  return (
    <span
      style={{
        display: "inline-grid", placeItems: "center",
        width: size, height: size, borderRadius: size,
        background: bg, color: "var(--paper)",
        fontFamily: "var(--mono)",
        fontSize: Math.round(size * 0.42), fontWeight: 600,
        letterSpacing: 0,
        flex: "0 0 auto",
      }}
    >
      {sym.slice(0,1)}
    </span>
  );
}

/* ─── LTV gauge ─── */
function LtvGauge({ ltv, max = 100, liqAt = 80, height = 8, labels = true }) {
  const pct = Math.min(100, (ltv / max) * 100);
  const liqPct = (liqAt / max) * 100;
  const danger = ltv >= liqAt - 5;
  return (
    <div className="stack-2">
      <div className="meter" style={{ height }}>
        <div
          className="fill"
          style={{
            width: pct + "%",
            background: danger ? "var(--danger)" : (ltv > liqAt * 0.7 ? "var(--accent)" : "var(--ink)"),
          }}
        />
        <div className="tick danger" style={{ left: liqPct + "%" }} />
      </div>
      {labels && (
        <div className="spread mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          <span>LTV {ltv.toFixed(1)}%</span>
          <span>liq · {liqAt}%</span>
        </div>
      )}
    </div>
  );
}

/* ─── Sparkline ─── */
function Spark({ points, w = 96, h = 28, color = "var(--ink)" }) {
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <path d={path} stroke={color} strokeWidth="1.3" fill="none" />
    </svg>
  );
}

/* ─── Tag ─── */
function Tag({ children, tone = "default" }) {
  const tones = {
    default:   { bg: "var(--paper-2)", c: "var(--ink-2)", b: "var(--hairline)" },
    accent:    { bg: "var(--accent-soft)", c: "var(--accent-ink)", b: "var(--accent)" },
    positive:  { bg: "var(--positive-soft)", c: "var(--positive)", b: "var(--positive)" },
    danger:    { bg: "var(--danger-soft)", c: "var(--danger)", b: "var(--danger)" },
    ink:       { bg: "var(--ink)", c: "var(--paper)", b: "var(--ink)" },
  }[tone] || {};
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 10, letterSpacing: 0.10, textTransform: "uppercase",
        padding: "3px 7px",
        background: tones.bg, color: tones.c, border: `1px solid ${tones.b}`,
      }}
    >{children}</span>
  );
}

/* ─── Stat ─── */
function Stat({ kicker, value, sub, locked, size = "lg" }) {
  return (
    <div className="stack-2">
      <div className="eyebrow">{kicker}</div>
      <div style={{ fontSize: size === "xxl" ? 56 : undefined }}>
        <Cipher value={value} locked={locked} size={size} />
      </div>
      {sub && <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.04 }}>{sub}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   MasterDetail · the single layout primitive for every product screen.
   Children pattern: pass `list` and `detail` as render props.
   ───────────────────────────────────────────────────────────────────── */
/* MasterDetail full-bleed variant: no padding, no scroll on detail body */
function MasterDetail({ listHeader, listBody, detailHeader, detailBody, detailFullBleed, collapseKey }) {
  const [listOpen, setListOpen] = useState(true);
  const [detailFs, setDetailFs] = useState(false);
  const frameRef = useRef(null);

  // Restore collapsed state from localStorage
  useEffect(() => {
    if (!collapseKey) return;
    try {
      const saved = localStorage.getItem("fheforge:md:" + collapseKey);
      if (saved === "0") setListOpen(false);
    } catch {}
  }, [collapseKey]);

  useEffect(() => {
    if (!collapseKey) return;
    try { localStorage.setItem("fheforge:md:" + collapseKey, listOpen ? "1" : "0"); } catch {}
  }, [listOpen, collapseKey]);

  // ⌘B toggles the list rail · J/K cycles list items · Enter clicks selected
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setListOpen(o => !o);
        return;
      }
      // J/K vim-style list navigation (also ↓ / ↑ as fallback)
      if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = frameRef.current?.querySelectorAll(".md-list-body .md-item");
        if (!items?.length) return;
        e.preventDefault();
        const arr = Array.from(items);
        const currentIdx = arr.findIndex(el => el.classList.contains("selected"));
        const forward = e.key === "j" || e.key === "ArrowDown";
        const nextIdx = currentIdx === -1
          ? (forward ? 0 : arr.length - 1)
          : forward
            ? (currentIdx + 1) % arr.length
            : (currentIdx - 1 + arr.length) % arr.length;
        arr[nextIdx].click();
        arr[nextIdx].scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main ref={frameRef} className={"md-frame" + (listOpen ? "" : " md-list-closed") + (detailFs ? " md-detail-fs" : "")}>
      <aside className="md-list">
        {listHeader && <div className="md-list-header">{listHeader}</div>}
        <div className="md-list-body">{listBody}</div>
      </aside>
      <section className="md-detail">
        {detailHeader && <div className="md-detail-header">{detailHeader}</div>}
        <div className="md-detail-body" style={detailFullBleed ? { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" } : undefined}>{detailBody}</div>
      </section>
      <button
        className="md-rail-toggle"
        onClick={() => setListOpen(o => !o)}
        title={listOpen ? "Hide list · ⌘B" : "Show list · ⌘B"}
        aria-label={listOpen ? "Hide list panel" : "Show list panel"}
      >
        {listOpen ? "‹" : "›"}
      </button>
    </main>
  );
}

/* List item used inside md-list-body */
function MDItem({ idx, title, sub, right, selected, onClick }) {
  return (
    <button
      className={"md-item" + (selected ? " selected" : "")}
      onClick={onClick}
    >
      {idx !== undefined && (
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.04 }}>{idx}</span>
      )}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{
          fontFamily: "var(--serif)",
          fontSize: 14, fontWeight: 500, letterSpacing: -0.005,
          color: "var(--ink)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{title}</span>
        {sub && (
          <span className="mono" style={{
            fontSize: 11, color: "var(--muted)", letterSpacing: 0.02,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{sub}</span>
        )}
      </div>
      {right && <div style={{ flex: "0 0 auto" }}>{right}</div>}
    </button>
  );
}

/* List group header */
function MDGroup({ children }) {
  return <div className="md-group">{children}</div>;
}

/* ─── Modal shell ─── */
function Modal({ open, onClose, children, width = 720 }) {
  const shellRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab" && shellRef.current) {
        const focusable = shellRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      const first = shellRef.current?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (first) first.focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={shellRef} className="modal-shell" onClick={(e) => e.stopPropagation()} style={{ width: `min(${width}px, 100%)` }}>
        {children}
      </div>
    </div>
  );
}

/* ─── TopBar ─── */
function TopBar({ route, setRoute, ctx, onPermitClick, onWalletClick, theme, setTheme }) {
  const NAV = [
    ["home",       "Home"],
    ["portfolio",  "Portfolio"],
    ["lend",       "Lend"],
    ["strategies", "Strategies"],
    ["governance", "Governance"],
  ];
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="wordmark" onClick={() => setRoute("home")}>
          <span className="dot" /> FheForge
        </a>
        <nav style={{ display: "flex", gap: 4, marginLeft: 14, flex: 1, overflowX: "auto" }}>
          {NAV.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRoute(k)}
              style={{
                border: 0,
                padding: "8px 10px",
                color: route === k ? "var(--ink)" : "var(--muted)",
                background: "transparent",
                borderBottom: route === k ? "1px solid var(--ink)" : "1px solid transparent",
                borderRadius: 0,
                fontFamily: "var(--sans)", fontWeight: 500, fontSize: 14,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "color var(--t-feedback) var(--ease), border-color var(--t-feedback) var(--ease)",
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="row" style={{ gap: 8 }}>
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <span className="chip">
            <span className="dot" style={{ background: "var(--accent)" }} />
            Arb · Sepolia
          </span>
          {ctx.connected ? (
            <>
              <PermitChip
                unlocked={ctx.permitUnlocked}
                secondsLeft={ctx.permitSeconds}
                onClick={onPermitClick}
              />
              <WalletChip address={ctx.address} chain="421614" onClick={onWalletClick} />
            </>
          ) : (
            <button className="btn sm" onClick={onWalletClick}>
              Connect <span className="ar">→</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/* Mobile bottom nav (kept for ≤720px) */
function MobileNav({ route, setRoute }) {
  const NAV = [
    ["portfolio",  "Folio"],
    ["lend",       "Lend"],
    ["strategies", "Build"],
    ["governance", "Gov"],
  ];
  return (
    <nav
      className="mobile-nav"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40,
        background: "var(--paper)",
        borderTop: "1px solid var(--ink)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-around", padding: "6px 6px" }}>
        {NAV.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setRoute(k)}
            style={{
              border: 0, background: "transparent",
              padding: "12px 16px",
              fontFamily: "var(--mono)", fontSize: 13, textTransform: "uppercase",
              letterSpacing: 0.08,
              color: route === k ? "var(--ink)" : "var(--muted)",
              borderTop: route === k ? "1.5px solid var(--ink)" : "1.5px solid transparent",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

Object.assign(window, {
  Cipher, PermitChip, WalletChip, AssetGlyph, LtvGauge, Spark,
  Tag, Stat, MasterDetail, MDItem, MDGroup, Modal, TopBar, MobileNav, ThemeToggle,
});
