// app.jsx · FheForge v4 root.
// Routes between Home / Portfolio / Lend / Strategies / Governance.
// Connect is a modal (no longer a route).
// Theme is light/dark with persistence + system default.

const { useState: useStateA, useEffect: useEffectA, useCallback: useCallbackA } = React;

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
  const [route, setRoute] = useStateA("home");

  // Wallet / permit context
  const [ctx, setCtx] = useStateA({
    connected: t.startConnected,
    address: "0x9f3a2c4b1e0d8f7a6c5b4a39",
    permitUnlocked: t.startConnected && t.startUnlocked,
    permitSeconds: t.startConnected && t.startUnlocked ? 14 * 60 : 0,
    revealing: false,
  });

  // Connect modal
  const [showConnect, setShowConnect] = useStateA(false);
  const openConnect = useCallbackA(() => setShowConnect(true), []);
  const closeConnect = useCallbackA(() => setShowConnect(false), []);

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

  // Grant permit: stagger cipher reveal across visible elements
  const grantPermit = useCallbackA(() => {
    if (!ctx.connected) {
      setCtx(c => ({ ...c, connected: true, address: "0x9f3a2c4b1e0d8f7a6c5b4a39" }));
    }
    // Apply per-element delay to make the reveal feel staggered
    requestAnimationFrame(() => {
      const ciphers = [...document.querySelectorAll(".cipher")];
      ciphers.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      ciphers.forEach((el, i) => el.style.setProperty("--cipher-delay", (i * 50) + "ms"));
    });
    setCtx(c => ({ ...c, permitUnlocked: true, permitSeconds: 15 * 60 }));
  }, [ctx.connected]);

  // Wallet chip clicked
  const onWalletClick = useCallbackA(() => {
    openConnect();
  }, [openConnect]);

  // Routes
  let Screen = null;
  if (route === "home")            Screen = <Landing setRoute={setRoute} ctx={ctx} grantPermit={grantPermit} openConnect={openConnect} />;
  else if (route === "portfolio")  Screen = <Dashboard setRoute={setRoute} ctx={ctx} grantPermit={grantPermit} openConnect={openConnect} />;
  else if (route === "lend")       Screen = <Lending setRoute={setRoute} ctx={ctx} grantPermit={grantPermit} openConnect={openConnect} />;
  else if (route === "strategies") Screen = <Market setRoute={setRoute} ctx={ctx} grantPermit={grantPermit} openConnect={openConnect} />;
  else if (route === "governance") Screen = <Governance setRoute={setRoute} ctx={ctx} grantPermit={grantPermit} openConnect={openConnect} />;
  else                             Screen = <Landing setRoute={setRoute} ctx={ctx} grantPermit={grantPermit} openConnect={openConnect} />;

  return (
    <>
      <TopBar
        route={route} setRoute={setRoute}
        ctx={ctx}
        onPermitClick={ctx.permitUnlocked ? grantPermit : openConnect}
        onWalletClick={onWalletClick}
        theme={theme} setTheme={setTheme}
      />
      <div key={route} className="fade-enter" style={{ minHeight: "calc(100vh - 56px)" }}>
        {Screen}
      </div>

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

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// FOUT fix: relayout once webfonts load.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    document.body.style.minHeight = "100.01vh";
    requestAnimationFrame(() => { document.body.style.minHeight = ""; });
  });
}
