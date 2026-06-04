// screens/connect-modal.jsx · Single-screen auto-chain connect flow
// States: idle → connecting → signing → permitting → done. No wizard steps.

const { useState: useStateCM, useEffect: useEffectCM } = React;

function ConnectModal({ open, onClose, ctx, setCtx, grantPermit }) {
  const [phase, setPhase]       = useStateCM("idle");
  const [error, setError]       = useStateCM(null);
  const [selected, setSelected] = useStateCM(null);

  // Already connected + permitted → close immediately
  useEffectCM(() => {
    if (open && ctx?.connected && ctx?.permitUnlocked) onClose();
  }, [open, ctx?.connected, ctx?.permitUnlocked]);

  // Auto-detect single wallet provider
  useEffectCM(() => {
    if (!open || phase !== "idle" || ctx?.connected) return;
    const provs = typeof window !== "undefined" && window.ethereum
      ? (Array.isArray(window.ethereum.providers) ? window.ethereum.providers : [window.ethereum])
      : [];
    const mm = provs.some(p => p.isMetaMask && !p.isRabby);
    const rb = provs.some(p => p.isRabby);
    if (mm && !rb) startFlow("injected");
    else if (rb && !mm) startFlow("injected");
  }, [open]); // eslint-disable-line

  // Reset on close
  useEffectCM(() => {
    if (!open) { setPhase("idle"); setError(null); setSelected(null); }
  }, [open]);

  async function startFlow(connectorId) {
    setSelected(connectorId);
    setError(null);
    try {
      const bridge = await window.__getBridge();
      const bus = typeof window !== "undefined" && window.__bridgeBus;

      setPhase("connecting");
      await bridge.wallet.connect(connectorId);
      bridge.wallet.switchNetwork(421614).catch(() => {});
      const addr = bridge.wallet.getAccount();
      const chain = bridge.wallet.getChainId();
      if (bus) bus.set("wallet:connected", { connected: true, address: addr, chainId: chain });

      setPhase("signing");
      await bridge.wallet.login();
      if (bus) bus.set("wallet:authenticated", { address: addr });

      setPhase("permitting");
      const permitResult = await bridge.fhe.permitGrant();
      if (bus) bus.set("permit:granted", { unlocked: true, secondsLeft: permitResult?.secondsLeft || 900 });

      if (setCtx) {
        setCtx(prev => ({
          ...prev,
          connected: true,
          address: addr,
          permitUnlocked: true,
          permitSeconds: permitResult?.secondsLeft || 900,
        }));
      }

      setPhase("done");
      setTimeout(onClose, 300);
    } catch (err) {
      setError(
        err?.code === "PROVIDER_NOT_FOUND"
          ? "Wallet provider not found. Install or enable MetaMask/Rabby, then retry."
          : err?.message || "Connection failed"
      );
    }
  }

  function retry() { setError(null); setPhase("idle"); startFlow(selected); }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} width={420}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--hairline)", background: "var(--paper-2)" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--ink)" }}>
          {phase === "idle" ? "Pick a wallet" : "Connecting"}
        </h3>
        <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
          Arbitrum Sepolia · wrong network auto-switches
        </p>
      </div>

      <div style={{ padding: 20 }}>
        {phase === "idle" && !error && <WalletPicker onSelect={startFlow} />}
        {phase !== "idle" && !error && <ProgressList phase={phase} />}
        {error && (
          <div>
            <p style={{ color: "var(--danger)", fontSize: "0.875rem", padding: "10px 12px", border: "1px solid var(--danger)", background: "var(--danger-soft)" }}>{error}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={retry} className="btn ghost sm">Retry</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Wallet picker ──────────────────────────────────────────────────────── */

function WalletPicker({ onSelect }) {
  const wallets = [
    { id: "injected",       name: "MetaMask",       sub: "Browser extension",   key: "mm" },
    { id: "injected",       name: "Rabby",          sub: "Recommended for DeFi", key: "rb" },
    { id: "walletConnect",  name: "WalletConnect",  sub: "Mobile pairing",       key: "wc" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {wallets.map(w => (
        <button key={w.key} onClick={() => onSelect(w.id)} className="btn ghost sm"
          data-testid={`wallet-${w.key}`}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", textAlign: "left", width: "100%" }}>
          <div>
            <div style={{ fontSize: "0.875rem", color: "var(--ink)" }}>{w.name}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 2 }}>{w.sub}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Progress indicator ─────────────────────────────────────────────────── */

function ProgressList({ phase }) {
  const steps = [
    { key: "connecting",  label: "Wallet connected" },
    { key: "signing",     label: "Message signed" },
    { key: "permitting",  label: "Decryption permit granted" },
  ];
  const idx = ["connecting", "signing", "permitting"].indexOf(phase);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {steps.map((s, i) => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: i < idx ? "var(--positive)" : i === idx ? "var(--accent)" : "var(--muted)", fontSize: "0.875rem", width: 16, textAlign: "center" }}>
            {i < idx ? "✓" : i === idx ? "▸" : "○"}
          </span>
          <span style={{ color: i <= idx ? "var(--ink)" : "var(--muted)", fontSize: "0.875rem" }}>{s.label}</span>
        </div>
      ))}
      {phase === "permitting" && <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginLeft: 26 }}>Approve in your wallet…</p>}
      {phase === "done" && <p style={{ fontSize: "0.75rem", color: "var(--positive)", marginLeft: 26 }}>Connected — closing…</p>}
    </div>
  );
}

window.ConnectModal = ConnectModal;
