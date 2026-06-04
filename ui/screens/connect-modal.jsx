// screens/connect-modal.jsx · Connect flow as a modal (replaces the route)
// 4 steps: wallet → sign → permit → ready. Uses sessionStorage so refresh
// mid-flow doesn't kick to step 1.

const { useState: useStateCM, useEffect: useEffectCM } = React;
const EMPTY_BRIDGE_CONTEXT_CM = React.createContext({ meta: { errors: [] } });

function getBridgeErrorCodeCM(error) {
  return error && (error.code || error.errorCode || (error.error && error.error.code));
}

function getBridgeErrorMessageCM(error) {
  if (!error) return "";
  return String(error.message || (error.error && error.error.message) || error);
}

const CM_KEY = "fheforge:connect:step";

function ConnectModal({ open, onClose, ctx, setCtx, grantPermit, onNext }) {
  // Step state lives independently of ctx so the user can walk the flow
  // visually before ctx flips. Initialized once, syncs forward on open.
  const [step, setStep] = useStateCM(0);
  const [wallet, setWallet] = useStateCM("metamask");
  const [pulse, setPulse] = useStateCM(false);
  const bridgeContext = typeof window !== "undefined" ? window.BridgeContext : null;
  const bridge = React.useContext(bridgeContext || EMPTY_BRIDGE_CONTEXT_CM);
  const latestError = ((bridge.meta && bridge.meta.errors) || []).slice().reverse().find((err) => err && (err.source === "connect" || err.step != null || getBridgeErrorCodeCM(err) === "PROVIDER_NOT_FOUND"));
  const latestErrorCode = getBridgeErrorCodeCM(latestError);
  const latestErrorMessage = getBridgeErrorMessageCM(latestError);
  const errorMessage = latestError ? (latestErrorCode === "PROVIDER_NOT_FOUND"
    ? "Wallet provider not found. Install or enable MetaMask/Rabby, then retry."
    : latestErrorMessage) : null;

  // When modal opens, jump to the correct step based on ctx, AND restore
  // any in-flight step from sessionStorage.
  useEffectCM(() => {
    if (!open) return;
    if (ctx.connected && ctx.permitUnlocked) { setStep(3); return; }
    if (ctx.connected) { setStep(2); return; }
    try {
      const saved = sessionStorage.getItem(CM_KEY);
      const s = saved != null ? parseInt(saved, 10) : 0;
      setStep(Number.isFinite(s) && s >= 0 && s < 4 ? s : 0);
    } catch { setStep(0); }
  }, [open]); // eslint-disable-line

  // Persist current step when it changes while open
  useEffectCM(() => {
    if (!open) return;
    try { sessionStorage.setItem(CM_KEY, String(step)); } catch {}
  }, [step, open]);

  // Auto-dismiss on step 4 (ready) after a beat
  useEffectCM(() => {
    if (open && step === 3) {
      setPulse(true);
      const id = setTimeout(() => {
        try { sessionStorage.removeItem(CM_KEY); } catch {}
        setPulse(false);
        onClose();
      }, 1600);
      return () => clearTimeout(id);
    }
  }, [step, open, onClose]);

  // Listen for step:advanced from interceptor
  useEffectCM(() => {
    const bus = window.__bridgeBus;
    if (!bus) return;
    const unsub = bus.on('step:advanced', (data) => {
      if (data.to !== undefined && typeof setStep === 'function') {
        setStep(data.to);
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  const STEPS = [
    { k: "wallet", t: "Pick a wallet" },
    { k: "sign",   t: "Prove the wallet is yours" },
    { k: "permit", t: "Unlock decryption" },
    { k: "ready",  t: "Ready" },
  ];

  return (
    <Modal open={open} onClose={onClose} width={460}>
      {/* Modal header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 16px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--paper-2)",
      }}>
        <div className="row" style={{ gap: 10 }}>
          {STEPS.map((_, i) => (
            <span key={i}
              style={{
                width: 8, height: 8, borderRadius: 50,
                background: i < step ? "var(--positive)" : i === step ? "var(--ink)" : "var(--hairline-2)",
                transition: "background-color var(--t-feedback) var(--ease)",
              }} />
          ))}
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.04, marginLeft: 8 }}>
            Step {step + 1} of 4 · {STEPS[step].t}
          </span>
        </div>
        <button onClick={onClose} style={{
          border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer",
          fontSize: 16, padding: "4px 8px",
        }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ overflow: "auto" }}>
        {errorMessage && (
          <div style={{ margin: "14px 16px 0", padding: "10px 12px", border: "1px solid var(--danger)", color: "var(--danger)", background: "var(--danger-soft)", fontFamily: "var(--mono)", fontSize: 11, lineHeight: 1.5 }}>
            {errorMessage}
          </div>
        )}
        {step === 0 && <StepWallet wallet={wallet} setWallet={setWallet} onNext={(selectedWallet) => {
          if (onNext) onNext(selectedWallet, step);
          else setStep(1);
        }} />}
        {step === 1 && <StepSign
          onBack={() => setStep(0)}
          onNext={() => {
            if (onNext) onNext(undefined, step);
            else queueMicrotask(() => setStep(2));
          }}
        />}
        {step === 2 && <StepPermit
          onBack={() => setStep(1)}
          onNext={async () => {
            try {
              if (onNext) onNext(undefined, step);
              else {
                await grantPermit();
                queueMicrotask(() => setStep(3));
              }
            } catch (err) {
              console.error('[ConnectModal] Permit grant failed:', err);
            }
          }}
        />}
        {step === 3 && <StepReady pulse={pulse} />}
      </div>
    </Modal>
  );
}

function StepWallet({ wallet, setWallet, onNext }) {
  const wallets = [
    { k: "metaMask",       name: "MetaMask", sub: "Browser extension" },
    { k: "rabby",          name: "Rabby",    sub: "Recommended for DeFi" },
    { k: "walletConnect",  name: "WalletConnect", sub: "Mobile pairing" },
  ];
  return (
    <div style={{ padding: 20 }}>
      <h2 className="serif" style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>Pick a wallet.</h2>
      <p style={{ color: "var(--muted)", marginTop: 6, marginBottom: 16, lineHeight: 1.5, fontSize: 13 }}>
        Arbitrum Sepolia. Wrong network auto-switches.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {wallets.map(w => (
          <button
            key={w.k}
            onClick={() => setWallet(w.k)}
            style={{
              padding: "10px 12px",
              textAlign: "left",
              background: "var(--paper)",
              border: "1px solid " + (wallet === w.k ? "var(--ink)" : "var(--hairline)"),
              cursor: "pointer",
              transition: "border-color var(--t-feedback) var(--ease)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="serif" style={{ fontSize: 14, fontWeight: 500 }}>{w.name}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 0.04 }}>{w.sub}</span>
              </div>
              {wallet === w.k && <span className="mono" style={{ fontSize: 10 }}>●</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button className="btn sm" onClick={() => onNext(wallet)}>Continue <span className="ar">→</span></button>
      </div>
    </div>
  );
}

function StepSign({ onBack, onNext }) {
  return (
    <div style={{ padding: 20 }}>
      <h2 className="serif" style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>Prove it's yours.</h2>
      <p style={{ color: "var(--muted)", marginTop: 6, marginBottom: 14, lineHeight: 1.5, fontSize: 13 }}>
        Sign a short message. No gas, no spend.
      </p>
      <pre className="mono" style={{
        padding: 12, fontSize: 11, lineHeight: 1.55,
        color: "var(--ink-2)",
        background: "var(--paper-2)",
        border: "1px solid var(--hairline)",
        overflowX: "auto", marginBottom: 14, marginTop: 0,
      }}>
{`fheforge.app requests a wallet signature.

The nonce and exact message come from the FheForge API.
Chain: 421614 · Arbitrum Sepolia`}
      </pre>
      <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
        <button className="btn ghost sm" onClick={onBack}>← Back</button>
        <button className="btn sm" onClick={onNext}>Sign <span className="ar">→</span></button>
      </div>
    </div>
  );
}

function StepPermit({ onBack, onNext }) {
  return (
    <div style={{ padding: 20 }}>
      <h2 className="serif" style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>Unlock your numbers.</h2>
      <p style={{ color: "var(--muted)", marginTop: 6, marginBottom: 14, lineHeight: 1.5, fontSize: 13 }}>
        Grant a 15-minute permit. Only you decrypt.
      </p>

      <div style={{ background: "var(--paper-2)", border: "1px solid var(--hairline)", padding: 12, marginBottom: 14 }}>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 100px" }}>
            <span className="eyebrow">scope</span>
            <div className="mono" style={{ fontSize: 11, marginTop: 2 }}>your handles</div>
          </div>
          <div style={{ flex: "1 1 100px" }}>
            <span className="eyebrow">expires</span>
            <div className="mono" style={{ fontSize: 11, marginTop: 2 }}>15 minutes</div>
          </div>
          <div style={{ flex: "1 1 100px" }}>
            <span className="eyebrow">cost</span>
            <div className="mono" style={{ fontSize: 11, marginTop: 2 }}>0 gas</div>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
        <button className="btn ghost sm" onClick={onBack}>← Back</button>
        <button className="btn accent sm" onClick={onNext}>Grant permit <span className="ar">→</span></button>
      </div>
    </div>
  );
}

function StepReady({ pulse }) {
  return (
    <div style={{ padding: 24, display: "grid", placeItems: "center", minHeight: 160 }}>
      <div className="stack-2" style={{ alignItems: "center", textAlign: "center" }}>
        <Tag tone="positive">permit live</Tag>
        <h2 className="serif" style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.15, margin: 0 }}>You can read your numbers.</h2>
        <p style={{ color: "var(--muted)", margin: "4px 0 0 0", fontSize: 13 }}>
          Renew when it expires · nothing's lost.
        </p>
        {pulse && (
          <div style={{
            marginTop: 8, width: 24, height: 2,
            background: "var(--positive)",
            animation: "readyPulse 1.6s var(--ease-out) infinite",
          }} />
        )}
        <style>{`
          @keyframes readyPulse {
            0%, 100% { opacity: 0.4; transform: scaleX(0.6); }
            50%      { opacity: 1; transform: scaleX(1.2); }
          }
        `}</style>
      </div>
    </div>
  );
}

window.ConnectModal = ConnectModal;
