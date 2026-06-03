// screens/market.jsx · Strategies (v4, master-detail, merged with Builder)
// Left: your drafts + community templates.
// Right: BuilderWorkspace for the selected strategy.

const { useState: useStateM, useEffect: useEffectM } = React;
const EMPTY_BRIDGE_CONTEXT_M = React.createContext({ data: {} });

function useOptionalBridgeDataM() {
  const bridgeContext = typeof window !== "undefined" ? window.BridgeContext : null;
  return React.useContext(bridgeContext || EMPTY_BRIDGE_CONTEXT_M).data || {};
}

function normalizeCommunityM(item) {
  const apyRaw = item.apy ?? item.estimatedApy ?? item.supplyApy ?? 0;
  const apyNum = typeof apyRaw === "string" ? parseFloat(apyRaw) : apyRaw;
  return {
    id: item.id || item.strategyId || item.name,
    name: item.name || item.title || "Unnamed strategy",
    author: item.author || item.creator || item.proposer || "—",
    risk: (item.risk || item.riskLevel || "").toLowerCase(),
    apy: Number.isFinite(apyNum) ? apyNum : null,
    tvl: item.tvl || item.totalValueLocked || item.staked || "—",
    asset: item.asset || item.symbol || "—",
    deployers: item.deployers ?? item.deployerCount ?? item.users ?? 0,
    template: item.template || item.templateId || null,
  };
}

function getTemplateSetM(templates) {
  return templates && !Array.isArray(templates) && typeof templates === "object" ? templates : null;
}

const M_KEY = "fheforge:strategies:v4";

function loadDrafts() {
  try {
    const s = localStorage.getItem(M_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function Market({ setRoute, ctx, grantPermit, openConnect }) {
  const bridgeData = useOptionalBridgeDataM();
  const templates = getTemplateSetM(bridgeData.templates);
  const nodeTypes = bridgeData.nodeTypes && typeof bridgeData.nodeTypes === "object" ? bridgeData.nodeTypes : null;
  const community = Array.isArray(bridgeData.community) ? bridgeData.community.map(normalizeCommunityM) : null;
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
    const t = fromTemplate === "blank"
      ? { nodes: [], edges: [] }
      : templates?.[fromTemplate];
    if (!t) return;
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
    const t = c.template ? templates?.[c.template] : null;
    if (!t) return;
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

  const filteredCommunity = (community || []).filter(c => filter === "all" || c.risk === filter)
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
              <button className="btn ghost sm" onClick={() => createDraft("leverage")} disabled={!templates?.leverage} title="Start from a template">+ Template</button>
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
              <span>Community · {filteredCommunity.length} of {community ? community.length : 0}</span>
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
          {!community && (
            <div style={{ padding: "16px 20px", color: "var(--muted)", fontSize: 13 }}>
              Community strategies unavailable.
            </div>
          )}
          {community && filteredCommunity.length === 0 && (
            <div style={{ padding: "16px 20px", color: "var(--muted)", fontSize: 13 }}>
              {community.length === 0 ? "No strategies yet." : "No matching strategies. Clear filter or search."}
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
              sub={`apy ${c.apy == null ? "—" : c.apy.toFixed(1) + "%"} · ${c.deployers} deployers`}
              right={
                c.template && templates?.[c.template] ? (
                  <span
                    onClick={(e) => { e.stopPropagation(); forkCommunity(c); }}
                    className="btn ghost sm" style={{ padding: "3px 8px", fontSize: 10 }}
                    title="Fork as a new draft"
                  >Fork</span>
                ) : (
                  <span className="mono" style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.08 }}>unavailable</span>
                )
              }
              onClick={() => c.template && templates?.[c.template] && forkCommunity(c)}
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
            nodeTypes={nodeTypes}
          />
        ) : (
          <EmptyDetail createDraft={createDraft} templateAvailable={!!templates?.leverage} />
        )
      }
    />
  );
}

function EmptyDetail({ createDraft, templateAvailable }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", minHeight: 400 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h2 className="sectionhead-title" style={{ fontSize: 28, lineHeight: 1.15 }}>Pick a draft or fork a template.</h2>
        <p style={{ color: "var(--muted)", marginTop: 12, marginBottom: 20, lineHeight: 1.55 }}>
          Strategies are visual pipelines that compile to a single on-chain call. Build from scratch, fork the market, or start with a template.
        </p>
        <div className="row" style={{ gap: 8, justifyContent: "center" }}>
          <button className="btn" onClick={() => createDraft("blank")}>Start blank <span className="ar">→</span></button>
          <button className="btn ghost" onClick={() => createDraft("leverage")} disabled={!templateAvailable}>Use a template</button>
        </div>
      </div>
    </div>
  );
}

window.Market = Market;
