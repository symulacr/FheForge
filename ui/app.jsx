// app.jsx · FheForge v4 root.
// Routes between Home / Portfolio / Lend / Strategies / Governance.
// Connect is a modal (no longer a route).
// Theme is light/dark with persistence + system default.

const { useState: useStateA, useEffect: useEffectA, useCallback: useCallbackA } = React;

// Safe component loader — guards against undefined window globals
function safe(name, props = {}) {
  const Component = window[name];
  return Component ? React.createElement(Component, props) : null;
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "startConnected": false,
  "startUnlocked": false,
  "showGrain": true
}/*EDITMODE-END*/;

const THEME_KEY = "fheforge:theme";

function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function initialRoute() {
  const h = window.location.hash.slice(1);
  return ["home","portfolio","lend","strategies","governance"].includes(h) ? h : "home";
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Theme
  const [theme, setTheme] = useStateA(initialTheme());
  useEffectA(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  useEffectA(() => {
    document.body.classList.toggle("no-grain", !t.showGrain);
  }, [t.showGrain]);

  // Route
  const [route, setRoute] = useStateA(initialRoute());

  // Wallet / permit context
  const [ctx, setCtx] = useStateA({
    connected: t.startConnected,
    address: null,
    permitUnlocked: t.startConnected && t.startUnlocked,
    permitSeconds: t.startConnected && t.startUnlocked ? 14 * 60 : 0,
    revealing: false,
  });

  // Connect modal
  const [showConnect, setShowConnect] = useStateA(false);
  const openConnect = useCallbackA(() => setShowConnect(true), []);
  const closeConnect = useCallbackA(() => setShowConnect(false), []);

  useEffectA(() => { window.location.hash = route; }, [route]);
  useEffectA(() => {
    const onHash = () => {
      const h = window.location.hash.slice(1);
      if (["home","portfolio","lend","strategies","governance"].includes(h)) setRoute(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Re-sync when tweaks change
  useEffectA(() => {
    setCtx(c => ({
      ...c,
      connected: t.startConnected,
      address: t.startConnected ? c.address : null,
      permitUnlocked: t.startConnected && t.startUnlocked,
      permitSeconds: t.startConnected && t.startUnlocked ? 14 * 60 : 0,
    }));
  }, [t.startConnected, t.startUnlocked]);

  // Permit countdown
  useEffectA(() => {
    if (!ctx.permitUnlocked || ctx.permitSeconds <= 0) return;
    const id = setInterval(() => {
      setCtx(c => {
        if (c.permitSeconds <= 1) return { ...c, permitUnlocked: false, permitSeconds: 0 };
        return { ...c, permitSeconds: c.permitSeconds - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [ctx.permitUnlocked]);

  // Auto-renew permit at 2 minutes remaining (silent, no wallet popup)
  useEffectA(() => {
    if (ctx.permitUnlocked && ctx.permitSeconds === 120) {
      try { grantPermit(); } catch { /* silent — countdown continues to 0 */ }
    }
  }, [ctx.permitSeconds, grantPermit]);

  // Grant permit: call real bridge FHE permit
  const grantPermit = useCallbackA(async () => {
    if (!ctx.connected) return;
    try {
      await window.bridge?.fhe?.permitGrant();
      setCtx(c => ({ ...c, permitUnlocked: true, permitSeconds: 15 * 60 }));
    } catch (e) {
      console.error("Permit grant failed:", e);
    }
  }, [ctx.connected]);

  // Wallet account/chain change detection
  useEffectA(() => {
    if (!window.ethereum?.on) return;
    const onAccounts = (accts) => {
      if (!accts.length) {
        window.__bridgeBus?.set("wallet:disconnected", { connected: false, address: null });
        setCtx(prev => ({ ...prev, connected: false, address: null, permitUnlocked: false, permitSeconds: 0 }));
        if (window.__ConnectInterceptor) {
          window.__ConnectInterceptor.handleDisconnect();
        }
      } else if (ctx.connected && accts[0] !== ctx.address) {
        window.__bridgeBus?.set("wallet:connected", { connected: true, address: accts[0] });
        setCtx(prev => ({ ...prev, address: accts[0] }));
      }
    };
    const onChain = (chainId) => {
      window.__bridgeBus?.set("wallet:networkChanged", { chainId: typeof chainId === "string" ? parseInt(chainId, 16) : chainId });
    };
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    return () => { window.ethereum.removeListener("accountsChanged", onAccounts); window.ethereum.removeListener("chainChanged", onChain); };
  }, [ctx.connected, ctx.address]);

  useEffectA(() => {
    if (!window.__bridgeBus) return;
    const onDisconnect = () => {
      setCtx(prev => ({ ...prev, connected: false, address: null, permitUnlocked: false, permitSeconds: 0 }));
    };
    window.__bridgeBus.on('wallet:disconnected', onDisconnect);
    return () => window.__bridgeBus.off('wallet:disconnected', onDisconnect);
  }, []);

  // Wallet chip clicked
  const onWalletClick = useCallbackA(() => {
    openConnect();
  }, [openConnect]);

  // Routes
  let Screen = null;
  const baseProps = { setRoute, ctx, grantPermit, openConnect };
  if (route === "home")            Screen = safe('Landing', baseProps);
  else if (route === "portfolio")  Screen = safe('Dashboard', baseProps);
  else if (route === "lend")       Screen = safe('Lending', baseProps);
  else if (route === "strategies") Screen = safe('Market', baseProps);
  else if (route === "governance") Screen = safe('Governance', baseProps);
  else                             Screen = safe('Landing', baseProps);

  return (
    <>
      <a href="#main" style={{ position: "absolute", left: "-9999px" }} onFocus={(e) => { e.target.style.position = "static"; e.target.style.left = "auto"; }} onBlur={(e) => { e.target.style.position = "absolute"; e.target.style.left = "-9999px"; }}>Skip to content</a>
      <TopBar
        route={route} setRoute={setRoute}
        ctx={ctx}
        onPermitClick={ctx.permitUnlocked ? grantPermit : openConnect}
        onWalletClick={onWalletClick}
        theme={theme} setTheme={setTheme}
      />
      <main key={route} id="main" className="fade-enter" style={{ minHeight: "calc(100vh - 56px)" }}>
        {Screen}
      </main>

      <ConnectModal
        open={showConnect}
        onClose={closeConnect}
        ctx={ctx} setCtx={setCtx}
        grantPermit={grantPermit}
      />

      <MobileNav route={route} setRoute={setRoute} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme" />
        <TweakRadio label="Theme" value={theme} options={["light", "dark"]} onChange={setTheme} />
        <TweakToggle label="Paper grain" value={t.showGrain} onChange={(v) => setTweak("showGrain", v)} />

        <TweakSection label="Prototype state" />
        <TweakToggle label="Wallet connected" value={t.startConnected} onChange={(v) => setTweak("startConnected", v)} />
        <TweakToggle label="Permit granted"   value={t.startUnlocked}  onChange={(v) => setTweak("startUnlocked", v)} />

        <TweakSection label="Jump to" />
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {[["home","Home"],["portfolio","Folio"],["lend","Lend"],["strategies","Build"],["governance","Gov"]].map(([k, l]) => (
            <button key={k} onClick={() => setRoute(k)} className="btn ghost sm" style={{ padding: "5px 9px", fontSize: 11 }}>{l}</button>
          ))}
          <button onClick={openConnect} className="btn ghost sm" style={{ padding: "5px 9px", fontSize: 11 }}>Connect</button>
        </div>
      </TweaksPanel>
    </>
  );
}

// Global error capture so we can see Babel/runtime errors quickly
window.addEventListener("error", (e) => {
  const root = document.getElementById("root");
  if (root && !root.children.length) {
    root.innerHTML = `<pre style="padding:24px;font-family:monospace;color:#cc4444;white-space:pre-wrap">ERROR: ${e.message}\n${e.filename}:${e.lineno}\n\n${e.error?.stack || ""}</pre>`;
  }
});

window.addEventListener("unhandledrejection", (e) => {
  const root = document.getElementById("root");
  if (root && !root.children.length) {
    const reason = e.reason || {};
    root.innerHTML = `<pre style="padding:24px;font-family:monospace;color:#cc4444;white-space:pre-wrap">UNHANDLED REJECTION: ${reason.message || String(reason)}\n\n${reason.stack || ""}</pre>`;
  }
});

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// FOUT fix: relayout once webfonts load.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    document.body.style.minHeight = "100.01vh";
    requestAnimationFrame(() => { document.body.style.minHeight = ""; });
  });
}
