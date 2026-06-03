// screens/governance.jsx · Governance (v4, master-detail)
// Left: proposals grouped by state.
// Right: selected proposal detail with vote panel.

const { useState: useStateG, useEffect: useEffectG } = React;
const EMPTY_BRIDGE_CONTEXT_G = React.createContext({ data: {}, meta: { errors: [] } });

function useOptionalBridgeG() {
  const bridgeContext = typeof window !== "undefined" ? window.BridgeContext : null;
  return React.useContext(bridgeContext || EMPTY_BRIDGE_CONTEXT_G);
}

function asVoteNumberG(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProposalG(proposal) {
  return {
    id: proposal.id || proposal.proposalId || "proposal",
    title: proposal.title || "Untitled proposal",
    status: (proposal.status || "pending").toLowerCase(),
    body: proposal.body || proposal.description || "No proposal body provided.",
    forVotes: asVoteNumberG(proposal.forVotes),
    againstVotes: asVoteNumberG(proposal.againstVotes),
    abstain: asVoteNumberG(proposal.abstain ?? proposal.abstainVotes),
    quorum: asVoteNumberG(proposal.quorum),
    timeLeft: proposal.timeLeft || proposal.deadline || "—",
    proposer: proposal.proposer || proposal.creator || "—",
  };
}

const GROUPS = [
  ["Active",   "active"],
  ["Queued",   "queued"],
  ["Executed", "executed"],
  ["Defeated", "defeated"],
];

function Governance({ setRoute, ctx, grantPermit, openConnect }) {
  const bridge = useOptionalBridgeG();
  const bridgeData = bridge.data || {};
  const bridgeErrors = (bridge.meta && Array.isArray(bridge.meta.errors)) ? bridge.meta.errors : [];
  const proposalError = bridgeErrors.find(err => err && err.source === "proposals");
  const proposals = Array.isArray(bridgeData.proposals) ? bridgeData.proposals.map(normalizeProposalG) : null;
  const [selectedId, setSelectedId] = useStateG(null);
  const selected = proposals && proposals.length
    ? (proposals.find(p => p.id === selectedId) || proposals[0])
    : null;

  useEffectG(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected && selected.id, selectedId]);

  return (
    <MasterDetail
      collapseKey="governance"
      listHeader={
        <>
          <span className="eyebrow">Governance</span>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{proposals ? `${proposals.length} proposals · bridge data` : "proposals · loading bridge data"}</span>
          </div>
        </>
      }
      listBody={
        <>
          {proposalError ? (
            <div className="mono" style={{ padding: "14px 20px", color: "var(--danger)", fontSize: 11, lineHeight: 1.5 }}>
              proposals unavailable · {proposalError.message || "fetch failed"}
            </div>
          ) : !proposals ? (
            <div className="mono" style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11 }}>
              loading bridge proposals
            </div>
          ) : proposals.length === 0 ? (
            <div className="mono" style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11 }}>
              no governance proposals available
            </div>
          ) : (() => {
            const labelStatuses = GROUPS.map(group => group[1]);
            const ungrouped = proposals.filter(p => !labelStatuses.includes(p.status));
            const groups = ungrouped.length ? GROUPS.concat([["Other", "__other"]]) : GROUPS;
            return groups.map(([label, status]) => {
              const items = status === "__other"
                ? ungrouped
                : proposals.filter(p => p.status === status);
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
            });
          })()}
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
                 : proposalError
                   ? <div className="mono" style={{ color: "var(--danger)", fontSize: 12 }}>Governance proposals unavailable.</div>
                   : !proposals
                     ? <div className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>Loading bridge proposals.</div>
                     : <div className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>No proposal selected.</div>
      }
    />
  );
}

function ProposalDetail({ p, ctx, openConnect }) {
  const [vote, setVote] = useStateG(null);
  const total = p.forVotes + p.againstVotes + p.abstain;
  const pct = (n) => total ? ((n / total) * 100).toFixed(1) : "0";
  const quorumPct = p.quorum ? Math.min(100, (total / p.quorum) * 100) : 0;

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
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.06 }}>quorum · {quorumPct.toFixed(0)}% of {p.quorum ? p.quorum.toLocaleString() : "0"}</span>
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
            {ctx.connected ? "vote controls are display-only" : "connect wallet to inspect voting state"}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            {["for", "against", "abstain"].map(v => (
              <button
                key={v} onClick={() => setVote(v)} disabled={true}
                style={{
                  flex: 1, padding: "11px 14px",
                  border: "1px solid " + (vote === v ? "var(--ink)" : "var(--hairline)"),
                  background: vote === v ? "var(--paper-2)" : "var(--paper)",
                  color: "var(--ink)",
                  fontFamily: "var(--mono)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.06,
                  cursor: "not-allowed",
                  opacity: 0.5,
                }}
              >● {v}</button>
            ))}
          </div>
          {!ctx.connected ? (
            <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={openConnect}>
              Connect wallet <span className="ar">→</span>
            </button>
          ) : (
            <button className="btn" style={{ width: "100%", marginTop: 14 }} disabled={true}>
              Voting transactions not wired <span className="ar">→</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

window.Governance = Governance;
