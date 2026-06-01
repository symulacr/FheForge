// screens/governance.jsx · Governance (v4, master-detail)
// Left: proposals grouped by state.
// Right: selected proposal detail with vote panel.

const { useState: useStateG } = React;

const PROPOSALS = [
  {
    id: "P-08", title: "WBTC liquidation 75% → 70%",
    status: "active",
    body: "Tightens WBTC liquidation threshold by 500 bps after two near-liquidation events. Affects 18 open positions, recipients pre-notified.",
    forVotes: 412840, againstVotes: 88200, abstain: 12400, quorum: 460000,
    timeLeft: "1d 14h", proposer: "0x9f3a…b4a39",
  },
  {
    id: "P-07", title: "Add ARB as collateral (65% LTV)",
    status: "active",
    body: "Whitelist ARB with 65% initial LTV, 70% liquidation, Pyth oracle.",
    forVotes: 188400, againstVotes: 142900, abstain: 9120, quorum: 460000,
    timeLeft: "3d 02h", proposer: "0xd1c2…7e84",
  },
  {
    id: "P-06", title: "Raise Composer loop cap to 8",
    status: "queued",
    body: "Allow strategies up to 8 loop iterations (current cap: 6). Gas analysis attached.",
    forVotes: 512300, againstVotes: 38000, abstain: 4200, quorum: 460000,
    timeLeft: "executes in 1d 03h", proposer: "0x4a92…0f10",
  },
  {
    id: "P-05", title: "Treasury: 24,000 FFT executor grant",
    status: "executed",
    body: "Pay swap-intent solver #03 24,000 FFT over 6 months.",
    forVotes: 622400, againstVotes: 19200, abstain: 2200, quorum: 460000,
    timeLeft: "executed · 6d ago", proposer: "0x9f3a…b4a39",
  },
  {
    id: "P-04", title: "Pause GHO market",
    status: "defeated",
    body: "Defeated 142k for / 304k against. Community rejected pause.",
    forVotes: 142000, againstVotes: 304800, abstain: 18900, quorum: 460000,
    timeLeft: "ended 11d ago", proposer: "0x8c11…2d44",
  },
];

const GROUPS = [
  ["Active",   "active"],
  ["Queued",   "queued"],
  ["Executed", "executed"],
  ["Defeated", "defeated"],
];

function Governance({ setRoute, ctx, grantPermit, openConnect }) {
  const [selectedId, setSelectedId] = useStateG("P-08");
  const selected = PROPOSALS.find(p => p.id === selectedId);

  return (
    <MasterDetail
      collapseKey="governance"
      listHeader={
        <>
          <span className="eyebrow">Governance</span>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>token-weighted · parameters only</span>
          </div>
        </>
      }
      listBody={
        <>
          {GROUPS.map(([label, status]) => {
            const items = PROPOSALS.filter(p => p.status === status);
            return (
              <React.Fragment key={status}>
                <MDGroup>{label} · {items.length}</MDGroup>
                {items.map(p => {
                  const total = p.forVotes + p.againstVotes + p.abstain;
                  const pct = (n) => total ? (n / total) * 100 : 0;
                  return (
                    <MDItem
                      key={p.id}
                      idx={<Tag tone={p.status === "active" ? "accent" : p.status === "queued" ? "default" : p.status === "executed" ? "positive" : "danger"}>{p.id}</Tag>}
                      title={p.title}
                      sub={p.timeLeft}
                      right={
                        <div style={{ width: 60, height: 4, display: "flex", background: "var(--hairline)" }}>
                          <span style={{ width: pct(p.forVotes) + "%", background: "var(--positive)" }} />
                          <span style={{ width: pct(p.againstVotes) + "%", background: "var(--danger)" }} />
                          <span style={{ width: pct(p.abstain) + "%", background: "var(--muted-2)" }} />
                        </div>
                      }
                      selected={selectedId === p.id}
                      onClick={() => setSelectedId(p.id)}
                    />
                  );
                })}
              </React.Fragment>
            );
          })}
        </>
      }
      detailHeader={
        selected ? (
          <>
            <div className="row" style={{ gap: 12 }}>
              <Tag tone={selected.status === "active" ? "accent" : selected.status === "queued" ? "default" : selected.status === "executed" ? "positive" : "danger"}>{selected.status}</Tag>
              <h2 className="serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.012, margin: 0 }}>
                {selected.id}
              </h2>
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{selected.timeLeft}</span>
          </>
        ) : null
      }
      detailBody={
        selected ? <ProposalDetail p={selected} ctx={ctx} openConnect={openConnect} />
                 : <div className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>Pick a proposal on the left.</div>
      }
    />
  );
}

function ProposalDetail({ p, ctx, openConnect }) {
  const [vote, setVote] = useStateG(null);
  const total = p.forVotes + p.againstVotes + p.abstain;
  const pct = (n) => total ? ((n / total) * 100).toFixed(1) : "0";
  const quorumPct = Math.min(100, (total / p.quorum) * 100);

  return (
    <div className="fade-enter" style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 820 }}>
      <div>
        <h3 className="display" style={{ fontSize: 28, lineHeight: 1.15, letterSpacing: -0.018, maxWidth: 720 }}>
          {p.title}
        </h3>
        <p style={{ color: "var(--ink-2)", marginTop: 14, lineHeight: 1.55, maxWidth: 660 }}>{p.body}</p>
      </div>

      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <span className="eyebrow">tally</span>
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 16, display: "flex", border: "1px solid var(--hairline)" }}>
            <span style={{ width: pct(p.forVotes) + "%", background: "var(--positive)" }} />
            <span style={{ width: pct(p.againstVotes) + "%", background: "var(--danger)" }} />
            <span style={{ width: pct(p.abstain) + "%", background: "var(--muted-2)" }} />
          </div>
          <div className="row" style={{ gap: 18, marginTop: 10, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 12 }}><span style={{ color: "var(--positive)" }}>●</span> for · {p.forVotes.toLocaleString()} ({pct(p.forVotes)}%)</span>
            <span className="mono" style={{ fontSize: 12 }}><span style={{ color: "var(--danger)" }}>●</span> against · {p.againstVotes.toLocaleString()} ({pct(p.againstVotes)}%)</span>
            <span className="mono" style={{ fontSize: 12 }}><span style={{ color: "var(--muted-2)" }}>●</span> abstain · {p.abstain.toLocaleString()}</span>
          </div>
        </div>

        <hr className="dashed" style={{ margin: "18px 0" }} />

        <div className="spread" style={{ marginBottom: 6 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.06 }}>quorum · {quorumPct.toFixed(0)}% of 460k</span>
          <span className="mono" style={{ fontSize: 11, color: quorumPct >= 100 ? "var(--positive)" : "var(--accent-ink)" }}>{quorumPct >= 100 ? "met" : "pending"}</span>
        </div>
        <div className="meter" style={{ height: 6 }}>
          <div className="fill" style={{ width: quorumPct + "%", background: quorumPct >= 100 ? "var(--positive)" : "var(--accent)" }} />
        </div>
      </div>

      <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 22 }}>
        <div className="kv"><span className="k">proposer</span><span className="v">{p.proposer}</span></div>
        <div className="kv"><span className="k">timing</span><span className="v">{p.timeLeft}</span></div>
        <div className="kv"><span className="k">execution</span><span className="v">Timelock · 2d delay</span></div>
      </div>

      {p.status === "active" && (
        <div style={{ background: "var(--paper)", border: "1px solid var(--ink)", padding: 22 }}>
          <span className="eyebrow">cast vote</span>
          <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {ctx.connected ? "12,420 FFT voting weight" : "connect wallet to vote"}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            {["for", "against", "abstain"].map(v => (
              <button
                key={v} onClick={() => setVote(v)} disabled={!ctx.connected}
                style={{
                  flex: 1, padding: "11px 14px",
                  border: "1px solid " + (vote === v ? "var(--ink)" : "var(--hairline)"),
                  background: vote === v ? "var(--paper-2)" : "var(--paper)",
                  color: "var(--ink)",
                  fontFamily: "var(--mono)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.06,
                  cursor: ctx.connected ? "pointer" : "not-allowed",
                  opacity: ctx.connected ? 1 : 0.5,
                }}
              >● {v}</button>
            ))}
          </div>
          {!ctx.connected ? (
            <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={openConnect}>
              Connect to vote <span className="ar">→</span>
            </button>
          ) : (
            <button className="btn" style={{ width: "100%", marginTop: 14 }} disabled={!vote}>
              {vote ? `Sign & submit · ${vote}` : "Pick a side"} <span className="ar">→</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

window.Governance = Governance;
