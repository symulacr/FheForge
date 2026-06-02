// screens/market.jsx · Strategies (v4, master-detail, merged with Builder)
// Left: your drafts + community templates.
// Right: BuilderWorkspace for the selected strategy.

const { useState: useStateM, useEffect: useEffectM } = React;

const COMMUNITY = [
  { id: "c-lev",  name: "Lean USDC leverage",  author: "@symulacr", risk: "low",  apy: 11.4, tvl: "1,284,210", asset: "USDC", deployers: 412, template: "leverage" },
  { id: "c-dn",   name: "ETH delta-neutral",   author: "@haven",    risk: "med",  apy: 8.7,  tvl: "612,950",   asset: "ETH",  deployers: 188, template: "deltaNeutral" },
  { id: "c-wbtc", name: "WBTC carry & swap",   author: "@symulacr", risk: "high", apy: 14.2, tvl: "402,180",   asset: "WBTC", deployers: 71,  template: "leverage" },
  { id: "c-arb",  name: "ARB incentive sweep", author: "@plux",     risk: "med",  apy: 22.8, tvl: "298,400",   asset: "ARB",  deployers: 240, template: "rebalance" },
  { id: "c-skim", name: "Stable fee skim",     author: "@quietco",  risk: "low",  apy: 5.6,  tvl: "1,840,210", asset: "USDC", deployers: 612, template: "rebalance" },
  { id: "c-lst",  name: "ETH liquid-staking",  author: "@haven",    risk: "med",  apy: 9.4,  tvl: "894,100",   asset: "ETH",  deployers: 192, template: "leverage" },
];

const M_KEY = "fheforge:strategies:v4";

function loadDrafts() {
  try {
    const s = localStorage.getItem(M_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  // First-run default: one draft from the leverage template
  const t = TEMPLATES.leverage;
  return [{
    id: "d-default",
    name: "Lean USDC leverage v3",
    nodes: t.nodes.map(n => ({ ...n })),
    edges: t.edges.map(e => ({ ...e })),
  }];
}

function Market({ setRoute, ctx, grantPermit, openConnect }) {
  const [drafts, setDrafts] = useStateM(loadDrafts);
  const [selectedId, setSelectedId] = useStateM(drafts[0]?.id || null);
  const [filter, setFilter] = useStateM("all");
  const [confirmDelete, setConfirmDelete] = useStateM(null);
  const [query, setQuery] = useStateM("");
  const locked = !ctx.permitUnlocked;

  // Persist drafts
  useEffectM(() => {
    try { localStorage.setItem(M_KEY, JSON.stringify(drafts)); } catch {}
  }, [drafts]);

  const selected = drafts.find(d => d.id === selectedId);

  const setWorkflow = (fn) => {
    setDrafts(ds => ds.map(d => d.id === selectedId
      ? (typeof fn === "function" ? fn(d) : fn)
      : d));
  };

  const createDraft = (fromTemplate = "blank", name = null) => {
    const t = TEMPLATES[fromTemplate] || TEMPLATES.blank;
    const id = "d-" + Date.now().toString(36);
    const draft = {
      id,
      name: name || `New strategy · ${drafts.length + 1}`,
      nodes: t.nodes.map((n, i) => ({ ...n, id: `n${i+1}-${id}`, config: { ...n.config } })),
      edges: [],
    };
    // Remap edges using new ids
    const idMap = {};
    t.nodes.forEach((n, i) => { idMap[n.id] = `n${i+1}-${id}`; });
    draft.edges = t.edges.map(e => ({ from: idMap[e.from], to: idMap[e.to] }));
    setDrafts(ds => [draft, ...ds]);
    setSelectedId(id);
  };

  const forkCommunity = (c) => {
    const id = "d-" + Date.now().toString(36);
    const t = TEMPLATES[c.template] || TEMPLATES.leverage;
    const idMap = {};
    t.nodes.forEach((n, i) => { idMap[n.id] = `n${i+1}-${id}`; });
    const draft = {
      id,
      name: c.name + " (fork)",
      nodes: t.nodes.map(n => ({ ...n, id: idMap[n.id], config: { ...n.config } })),
      edges: t.edges.map(e => ({ from: idMap[e.from], to: idMap[e.to] })),
      forkedFrom: c.author,
    };
    setDrafts(ds => [draft, ...ds]);
    setSelectedId(id);
  };

  const deleteDraft = (id) => {
    setDrafts(ds => ds.filter(d => d.id !== id));
    if (selectedId === id) setSelectedId(drafts.find(d => d.id !== id)?.id || null);
    setConfirmDelete(null);
  };

  const filteredCommunity = COMMUNITY.filter(c => filter === "all" || c.risk === filter)
    .filter(c => !query || c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <MasterDetail
      collapseKey="strategies"
      listHeader={
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="eyebrow">Strategies</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn ghost sm" onClick={() => createDraft("blank")} title="Start from a blank canvas">+ New</button>
              <button className="btn ghost sm" onClick={() => createDraft("leverage")} title="Start from a template">+ Template</button>
            </div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            style={{
              width: "100%",
              padding: "7px 10px",
              border: "1px solid var(--hairline)", background: "var(--paper)",
              color: "var(--ink)",
              fontFamily: "var(--mono)", fontSize: 12,
              outline: "none",
            }}
          />
        </>
      }
      listBody={
        <>
          <MDGroup>Your drafts · {drafts.length}</MDGroup>
          {drafts.length === 0 && (
            <div style={{ padding: "16px 20px", color: "var(--muted)", fontSize: 13 }}>
              No drafts yet. Start blank or fork a template below.
            </div>
          )}
          {drafts
            .filter(d => !query || d.name.toLowerCase().includes(query.toLowerCase()))
            .map(d => (
            <MDItem
              key={d.id}
              idx={
                <span style={{ width: 8, height: 8, background: "var(--ink)", display: "inline-block" }} />
              }
              title={d.name}
              sub={`${d.nodes.length} step${d.nodes.length === 1 ? "" : "s"} · ${d.edges.length} link${d.edges.length === 1 ? "" : "s"}`}
              right={
                confirmDelete === d.id ? (
                  <span className="row" style={{ gap: 4 }}>
                    <span
                      onClick={(e) => { e.stopPropagation(); deleteDraft(d.id); }}
                      style={{
                        border: "1px solid var(--danger)", background: "var(--danger)",
                        color: "var(--paper)", fontFamily: "var(--mono)",
                        fontSize: 10, letterSpacing: 0.08, textTransform: "uppercase",
                        padding: "3px 8px", cursor: "pointer",
                      }}
                    >Delete</span>
                    <span
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                      style={{
                        border: "1px solid var(--hairline)", background: "var(--paper)",
                        color: "var(--muted)", fontFamily: "var(--mono)",
                        fontSize: 10, letterSpacing: 0.08, textTransform: "uppercase",
                        padding: "3px 8px", cursor: "pointer",
                      }}
                    >Keep</span>
                  </span>
                ) : (
                  <span
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(d.id); }}
                    style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}
                    title="Delete draft"
                  >×</span>
                )
              }
              selected={selectedId === d.id}
              onClick={() => setSelectedId(d.id)}
            />
          ))}

          <MDGroup>
            <div className="spread">
              <span>Community · {filteredCommunity.length} of {COMMUNITY.length}</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value)}
                style={{
                  fontFamily: "var(--mono)", fontSize: 10,
                  background: "var(--paper)", color: "var(--muted)",
                  border: "1px solid var(--hairline)",
                  padding: "2px 6px", textTransform: "uppercase", letterSpacing: 0.08,
                }}>
                {["all","low","med","high"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </MDGroup>
          {filteredCommunity.length === 0 && (
            <div style={{ padding: "16px 20px", color: "var(--muted)", fontSize: 13 }}>
              No matching strategies. Clear filter or search.
            </div>
          )}
          {filteredCommunity.map(c => (
            <MDItem
              key={c.id}
              idx={
                <span style={{ width: 8, height: 8, background:
                  c.risk === "low" ? "var(--positive)" : c.risk === "med" ? "var(--accent)" : "var(--danger)",
                  display: "inline-block" }} />
              }
              title={c.name}
              sub={`apy ${c.apy.toFixed(1)}% · ${c.deployers} deployers`}
              right={
                <span
                  onClick={(e) => { e.stopPropagation(); forkCommunity(c); }}
                  className="btn ghost sm" style={{ padding: "3px 8px", fontSize: 10 }}
                  title="Fork as a new draft"
                >Fork</span>
              }
              onClick={() => forkCommunity(c)}
            />
          ))}
        </>
      }
      detailHeader={null}
      detailFullBleed={!!selected}
      detailBody={
        selected ? (
          <BuilderWorkspace
            workflow={selected}
            setWorkflow={setWorkflow}
            locked={locked}
            grantPermit={grantPermit}
            ctx={ctx}
            openConnect={openConnect}
          />
        ) : (
          <EmptyDetail createDraft={createDraft} />
        )
      }
    />
  );
}

function EmptyDetail({ createDraft }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", minHeight: 400 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h2 className="sectionhead-title" style={{ fontSize: 28, lineHeight: 1.15 }}>Pick a draft or fork a template.</h2>
        <p style={{ color: "var(--muted)", marginTop: 12, marginBottom: 20, lineHeight: 1.55 }}>
          Strategies are visual pipelines that compile to a single on-chain call. Build from scratch, fork the market, or start with a template.
        </p>
        <div className="row" style={{ gap: 8, justifyContent: "center" }}>
          <button className="btn" onClick={() => createDraft("blank")}>Start blank <span className="ar">→</span></button>
          <button className="btn ghost" onClick={() => createDraft("leverage")}>Use a template</button>
        </div>
      </div>
    </div>
  );
}

window.Market = Market;
