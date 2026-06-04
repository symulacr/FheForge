// screens/builder-workspace.jsx · Canvas + inspector primitives for the
// merged Strategies screen. Exports BuilderWorkspace as the detail pane.

const { useState: useStateB, useRef: useRefB, useEffect: useEffectB, useCallback: useCallbackB, useMemo: useMemoB } = React;

const EMPTY_BRIDGE_CONTEXT_BW = React.createContext({ data: {} });
function useOptionalBridgeBW() {
  const bridgeContext = typeof window !== "undefined" ? window.BridgeContext : null;
  return React.useContext(bridgeContext || EMPTY_BRIDGE_CONTEXT_BW);
}

const TOKEN_MAP_BW = {
  ETH:  "0xdAA285526FE417925e5Bb712190aB6643Fb2d17D",
  WETH: "0x6d2EE53DA0f1be1302ddD503eF1E5fAC865bE534",
  USDC: "0x42FCC841B6CCE958f1D21C4313C478aAa6EBAf11",
  USDT: "0xB615d0D6789eD4BF8aDF4e01783702707DcB83B1",
  WBTC: "0x4aD242d1F5FeB537fF990E2c2B33d2cDF43b24f9",
  DAI:  "0x752BfE86DdE9d1394dc632c6471efaCf4Be50FE1",
  ARB:  "0xB68f2Cd30f753a3035958A4a42fbA6144FE5EaB0",
  LINK: "0x880A04A575a5F5cA5481aa0E5B9c08facE9197BF",
  UNI:  "0x200D5f08225b7F38568BB6e793Cd269Bfb339C61",
  AAVE: "0xb0d12709B6F077e7f4B3aD545137dA585c7f1560",
};
function parseAmountBW(display, decimals = 18) {
  const cleaned = String(display).replace(/[,≈\s]/g, "");
  const num = parseFloat(cleaned) || 0;
  return BigInt(Math.round(num * 10 ** decimals));
}

const NODE_W = 124;
const NODE_H = 56;

const NODE_TYPES = {
  supply: { label: "Supply",  kicker: "lend",  swatch: "var(--positive)", desc: "Shield ERC-20 into pool" },
  borrow: { label: "Borrow",  kicker: "debt",  swatch: "var(--danger)",   desc: "Encrypted borrowWithLtv" },
  swap:   { label: "Swap",    kicker: "dex",   swatch: "var(--accent)",   desc: "Intent or Uni V3" },
  repeat: { label: "Repeat",  kicker: "loop",  swatch: "var(--ink-2)",    desc: "Composer loop depth" },
  settle: { label: "Settle",  kicker: "fin",   swatch: "var(--ink)",      desc: "Grant ACL, end pipeline" },
};

const DEFAULT_CONFIG = {
  supply: { asset: "USDC", amount: "10,000" },
  borrow: { asset: "ETH",  ltv: 50, amount: "4,000" },
  swap:   { from: "ETH", to: "USDC", slip: 0.5, amount: "≈10,200" },
  repeat: { loops: 3 },
  settle: {},
};

const TEMPLATES = {
  blank: {
    label: "Blank",
    nodes: [{ id: "n1", type: "settle", x: 40, y: 40, config: {} }],
    edges: [],
  },
  leverage: {
    label: "Leverage Long ETH",
    nodes: [
      { id: "n1", type: "supply", x: 16, y: 32, config: { asset: "WETH", amount: "0.5" } },
      { id: "n2", type: "borrow", x: 192, y: 32, config: { asset: "USDC", ltv: 65, amount: "800" } },
      { id: "n3", type: "swap", x: 368, y: 32, config: { from: "USDC", to: "WETH", slip: 0.5, amount: "≈0.32" } },
      { id: "n4", type: "repeat", x: 192, y: 148, config: { loops: 3 } },
      { id: "n5", type: "settle", x: 368, y: 148, config: {} },
    ],
    edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }, { from: "n3", to: "n4" }, { from: "n4", to: "n5" }],
  },
  deltaNeutral: {
    label: "Delta Neutral ETH",
    nodes: [
      { id: "n1", type: "supply", x: 16, y: 32, config: { asset: "WETH", amount: "1" } },
      { id: "n2", type: "borrow", x: 192, y: 32, config: { asset: "USDC", ltv: 50, amount: "2,500" } },
      { id: "n5", type: "settle", x: 368, y: 32, config: {} },
    ],
    edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n5" }],
  },
  yieldFarm: {
    label: "Yield Farm USDC",
    nodes: [
      { id: "n1", type: "supply", x: 16, y: 32, config: { asset: "USDC", amount: "10,000" } },
      { id: "n2", type: "borrow", x: 192, y: 32, config: { asset: "DAI", ltv: 50, amount: "5,000" } },
      { id: "n3", type: "swap", x: 368, y: 32, config: { from: "DAI", to: "USDC", slip: 0.3, amount: "≈5,000" } },
      { id: "n5", type: "settle", x: 368, y: 148, config: {} },
    ],
    edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }, { from: "n3", to: "n5" }],
  },
  leverageARB: {
    label: "Leverage Long ARB",
    nodes: [
      { id: "n1", type: "supply", x: 16, y: 32, config: { asset: "ARB", amount: "1,000" } },
      { id: "n2", type: "borrow", x: 192, y: 32, config: { asset: "USDC", ltv: 55, amount: "250" } },
      { id: "n3", type: "swap", x: 368, y: 32, config: { from: "USDC", to: "ARB", slip: 0.5, amount: "≈500" } },
      { id: "n4", type: "repeat", x: 192, y: 148, config: { loops: 2 } },
      { id: "n5", type: "settle", x: 368, y: 148, config: {} },
    ],
    edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }, { from: "n3", to: "n4" }, { from: "n4", to: "n5" }],
  },
};

/* ─── Next-step suggestion engine ─── */
const NEXT_STEP_RULES = {
  supply: "borrow",
  borrow: "swap",
  swap:   "settle",
  repeat: "settle",
};

function nextSuggestionFor(node) {
  const next = NEXT_STEP_RULES[node.type];
  return next ? { type: next, label: NODE_TYPES[next].label } : null;
}

/* ─── Topo walk for sim ─── */
function walkOrder(nodes, edges) {
  if (!nodes.length) return [];
  const incoming = {};
  nodes.forEach(n => { incoming[n.id] = 0; });
  edges.forEach(e => { if (incoming[e.to] !== undefined) incoming[e.to]++; });
  const queue = nodes.filter(n => incoming[n.id] === 0).map(n => n.id);
  const order = [];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    edges.filter(e => e.from === id).forEach(e => queue.push(e.to));
  }
  nodes.forEach(n => { if (!seen.has(n.id)) order.push(n.id); });
  return order;
}

/* ─── Issue detection ─── */
function detectIssues(nodes, edges) {
  const issues = [];
  const edgeSev = {}; // {fromId-toId: 'error' | 'warn'}
  if (!nodes.length) return { issues, edgeSev };

  // Cycle (DFS) outside repeat
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  edges.forEach(e => { if (adj[e.from]) adj[e.from].push(e.to); });
  const color = {};
  nodes.forEach(n => { color[n.id] = 0; });
  let cycleNodes = null;
  function dfs(id, path) {
    color[id] = 1;
    for (const next of adj[id]) {
      if (color[next] === 1) {
        cycleNodes = path.slice(path.indexOf(next)).concat(next);
        return true;
      }
      if (color[next] === 0 && dfs(next, path.concat(next))) return true;
    }
    color[id] = 2;
    return false;
  }
  for (const n of nodes) {
    if (color[n.id] === 0 && dfs(n.id, [n.id])) break;
  }
  if (cycleNodes) {
    const onlyRepeat = cycleNodes.every(id => nodes.find(n => n.id === id)?.type === "repeat");
    if (!onlyRepeat) {
      issues.push({ severity: "error", msg: "Cycle outside Repeat", nodeIds: cycleNodes });
      // Mark cycle edges as error
      for (let i = 0; i < cycleNodes.length - 1; i++) {
        edgeSev[cycleNodes[i] + "→" + cycleNodes[i+1]] = "error";
      }
    }
  }

  // Dead-ends
  const outDeg = {};
  nodes.forEach(n => { outDeg[n.id] = 0; });
  edges.forEach(e => { if (outDeg[e.from] !== undefined) outDeg[e.from]++; });
  const orphaned = nodes.filter(n => n.type !== "settle" && outDeg[n.id] === 0);
  if (orphaned.length) {
    issues.push({
      severity: "warn",
      msg: `${orphaned.length} step${orphaned.length === 1 ? "" : "s"} go nowhere`,
      nodeIds: orphaned.map(n => n.id),
    });
  }

  // No settle
  if (!nodes.some(n => n.type === "settle")) {
    issues.push({ severity: "warn", msg: "Missing Settle node" });
  }

  // Incoherent: swap → settle without borrow/supply between (logic flow)
  edges.forEach(e => {
    const a = nodes.find(n => n.id === e.from);
    const b = nodes.find(n => n.id === e.to);
    if (a?.type === "borrow" && b?.type === "settle") {
      edgeSev[e.from + "→" + e.to] = "warn";
    }
  });

  // Gas-merge tip
  const swapMerges = [];
  edges.forEach(e => {
    const a = nodes.find(n => n.id === e.from);
    const b = nodes.find(n => n.id === e.to);
    if (a?.type === "swap" && b?.type === "swap") swapMerges.push([a.id, b.id]);
  });
  if (swapMerges.length) {
    issues.push({
      severity: "tip",
      msg: `Merge ${swapMerges.length} swap${swapMerges.length === 1 ? "" : "s"} · save ${(swapMerges.length * 196).toLocaleString()}k gas`,
      action: { kind: "merge-swaps", pairs: swapMerges },
    });
  }

  return { issues, edgeSev };
}

/* ─── Organize: width-aware layered layout with row wrapping ─── */
function organizeLayout(nodes, edges, canvasWidth = 800, canvasHeight = 500) {
  if (!nodes.length) return nodes;
  // Compute rank = longest path from any root
  const inDeg = {};
  nodes.forEach(n => { inDeg[n.id] = 0; });
  edges.forEach(e => { if (inDeg[e.to] !== undefined) inDeg[e.to]++; });
  const rank = {};
  const queue = nodes.filter(n => inDeg[n.id] === 0).map(n => ({ id: n.id, r: 0 }));
  queue.forEach(q => { rank[q.id] = 0; });
  const seen = new Set();
  while (queue.length) {
    const { id, r } = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    edges.filter(e => e.from === id).forEach(e => {
      const newR = r + 1;
      if (rank[e.to] === undefined || newR > rank[e.to]) rank[e.to] = newR;
      queue.push({ id: e.to, r: newR });
    });
  }
  nodes.forEach(n => { if (rank[n.id] === undefined) rank[n.id] = 0; });

  const maxRank = Math.max(...nodes.map(n => rank[n.id]));
  const ranks = maxRank + 1;

  // Calculate spacing to fill the available canvas
  // Reserve some padding around the layout
  const PAD_X = 32;
  const PAD_Y = 36;
  const NODE_W = 156;
  const NODE_H = 72;

  // Available width for nodes (excluding padding)
  const availW = Math.max(400, canvasWidth - PAD_X * 2);
  const availH = Math.max(300, canvasHeight - PAD_Y * 2);

  // Spread ranks across full width
  // If only 1 rank, center it. If multiple, distribute evenly.
  const colSpacing = ranks <= 1 ? 0 : (availW - NODE_W) / (ranks - 1);

  // Bucket by rank
  const buckets = {};
  nodes.forEach(n => {
    if (!buckets[rank[n.id]]) buckets[rank[n.id]] = [];
    buckets[rank[n.id]].push(n);
  });

  // Sort each bucket by the average rank of its parents (Sugiyama median heuristic)
  // to minimize edge crossings
  Object.keys(buckets).forEach(r => {
    if (+r === 0) return;
    buckets[r].sort((a, b) => {
      const parentsA = edges.filter(e => e.to === a.id).map(e => buckets[rank[e.from]]?.indexOf(nodes.find(n => n.id === e.from)) ?? 0);
      const parentsB = edges.filter(e => e.to === b.id).map(e => buckets[rank[e.from]]?.indexOf(nodes.find(n => n.id === e.from)) ?? 0);
      const medA = parentsA.length ? parentsA.sort((x, y) => x - y)[Math.floor(parentsA.length / 2)] : 0;
      const medB = parentsB.length ? parentsB.sort((x, y) => x - y)[Math.floor(parentsB.length / 2)] : 0;
      return medA - medB;
    });
  });

  // Largest rank height determines row spacing
  const maxBucketSize = Math.max(...Object.values(buckets).map(b => b.length));
  const rowSpacing = maxBucketSize <= 1 ? 0 : Math.min(110, (availH - NODE_H) / (maxBucketSize - 1));

  return nodes.map(n => {
    const r = rank[n.id];
    const row = buckets[r].indexOf(n);
    const colCount = buckets[r].length;
    // Center each column vertically
    const totalColH = colCount > 1 ? (colCount - 1) * rowSpacing + NODE_H : NODE_H;
    const startY = PAD_Y + (availH - totalColH) / 2;
    return {
      ...n,
      x: PAD_X + r * colSpacing,
      y: startY + row * rowSpacing,
    };
  });
}

/* ─── BuilderWorkspace · canvas + inspector ─── */
function BuilderWorkspace({ workflow, setWorkflow, locked, grantPermit, ctx, openConnect, nodeTypes }) {
  const bridge = useOptionalBridgeBW();
  const tokenMap = React.useMemo(() => {
    const markets = bridge?.data?.markets;
    if (!Array.isArray(markets) || markets.length === 0) return TOKEN_MAP_BW;
    const map = {};
    for (const m of markets) {
      if (m.asset && m.assetAddress) {
        map[m.asset] = m.assetAddress;
      }
    }
    return Object.keys(map).length > 0 ? map : TOKEN_MAP_BW;
  }, [bridge?.data?.markets]);
  const { nodes, edges, name } = workflow;
  const activeNodeTypes = nodeTypes && Object.keys(nodeTypes).length ? nodeTypes : null;
  const setNodes = (fn) => setWorkflow(wf => ({ ...wf, nodes: typeof fn === "function" ? fn(wf.nodes) : fn }));
  const setEdges = (fn) => setWorkflow(wf => ({ ...wf, edges: typeof fn === "function" ? fn(wf.edges) : fn }));
  const setName  = (n) => setWorkflow(wf => ({ ...wf, name: n }));

  const [selected, setSelected] = useStateB(nodes[0]?.id || null);
  const [running, setRunning] = useStateB(false);
  const [runStep, setRunStep] = useStateB(-1);
  const [pending, setPending] = useStateB(null);
  const [deploying, setDeploying] = useStateB(false);
  const [deployResult, setDeployResult] = useStateB(null);
  const [deployStep, setDeployStep] = useStateB(null); // null | "signing" | "committing" | "decrypting"
  const [inspectorTab, setInspectorTab] = useStateB("config");

  // Multi-selection (Set of node ids)
  const [multiSelected, setMultiSelected] = useStateB(() => new Set());
  // Clipboard for copy / paste
  const clipboardRef = useRefB(null);
  const stateRef = useRefB({});

  // Polish state ─────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useStateB(null);    // node being dragged on canvas
  const [dropActive, setDropActive] = useStateB(false);   // palette item being dragged over canvas
  const [recentEdges, setRecentEdges] = useStateB(() => new Set());  // edge keys recently added (for draw-on)
  const [savedAt, setSavedAt] = useStateB(Date.now());    // for "saved Ns ago" indicator
  const [selectedEdge, setSelectedEdge] = useStateB(null);

  // Pan + zoom
  const [scale, setScale] = useStateB(1);
  const [pan, setPan] = useStateB({ x: 0, y: 0 });

  // Fullscreen
  const [fullscreen, setFullscreen] = useStateB(false);

  // Inspector visibility
  const [showInspector, setShowInspector] = useStateB(true);

  // Undo / redo history
  const historyRef = useRefB({ past: [], future: [] });
  const lastSnapshotRef = useRefB(null);
  const pushHistory = useCallbackB((snapshot) => {
    // Debounced: only push if different from last
    const key = JSON.stringify({ n: snapshot.nodes, e: snapshot.edges });
    if (lastSnapshotRef.current === key) return;
    historyRef.current.past.push({ nodes: snapshot.nodes, edges: snapshot.edges });
    if (historyRef.current.past.length > 50) historyRef.current.past.shift();
    historyRef.current.future = [];
    lastSnapshotRef.current = key;
  }, []);

  // Cheatsheet overlay
  const [showCheat, setShowCheat] = useStateB(false);

  // Always-on quiet simulation: cycles softly when graph idle
  const [idlePulse, setIdlePulse] = useStateB(-1);
  useEffectB(() => {
    if (running || pending || dragRef.current) {
      setIdlePulse(-1);
      return;
    }
    if (!runOrder.length) return;
    let i = 0;
    const tick = () => {
      setIdlePulse(i);
      i = (i + 1) % (runOrder.length + 1);
    };
    const id = setInterval(tick, 1400);
    return () => clearInterval(id);
  }, [runOrder, running, pending]);

  const runOrder = useMemoB(() => walkOrder(nodes, edges), [nodes, edges]);
  const detection = useMemoB(() => detectIssues(nodes, edges), [nodes, edges]);
  const issues   = detection.issues;
  const edgeSev  = detection.edgeSev;
  const hasError = issues.some(i => i.severity === "error");
  const cycleSet = useMemoB(() => {
    const s = new Set();
    issues.forEach(i => { if (i.severity === "error" && i.nodeIds) i.nodeIds.forEach(id => s.add(id)); });
    return s;
  }, [issues]);

  // bump savedAt ONLY after a debounce pause (not on every drag frame)
  const saveTimerRef = useRefB(null);
  useEffectB(() => {
    pushHistory({ nodes, edges });
    // Debounce savedAt: wait 1500ms after last change before marking "saved"
    // This prevents the indicator from flashing on every node-drag frame.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { setSavedAt(Date.now()); }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [nodes, edges, name]);

  // Undo / redo
  const undo = useCallbackB(() => {
    const h = historyRef.current;
    if (h.past.length < 2) return;
    const current = h.past.pop();
    h.future.push(current);
    const prev = h.past[h.past.length - 1];
    setWorkflow(wf => ({ ...wf, nodes: prev.nodes, edges: prev.edges }));
    lastSnapshotRef.current = JSON.stringify({ n: prev.nodes, e: prev.edges });
  }, [setWorkflow]);
  const redo = useCallbackB(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    const next = h.future.pop();
    h.past.push(next);
    setWorkflow(wf => ({ ...wf, nodes: next.nodes, edges: next.edges }));
    lastSnapshotRef.current = JSON.stringify({ n: next.nodes, e: next.edges });
  }, [setWorkflow]);

  // Selection follows workflow swap
  useEffectB(() => {
    if (!nodes.find(n => n.id === selected)) setSelected(nodes[0]?.id || null);
  }, [workflow.id]); // eslint-disable-line

  // Inline node editor (click-to-edit-near-node)
  const [inlineConfigFor, setInlineConfigFor] = useStateB(null);

  // Camera follow during simulation
  const [cameraLock, setCameraLock] = useStateB(true);
  const preSimViewRef = useRefB(null);

  useEffectB(() => {
    if (!cameraLock) return;
    if (running && runStep >= 0 && runOrder[runStep]) {
      const n = nodes.find(x => x.id === runOrder[runStep]);
      const r = canvasRef.current?.getBoundingClientRect();
      if (!n || !r) return;
      const targetScale = 1.2;
      setScale(targetScale);
      setPan({
        x: r.width  / 2 - (n.x + NODE_W / 2) * targetScale,
        y: r.height / 2 - (n.y + NODE_H / 2) * targetScale,
      });
    } else if (!running && preSimViewRef.current) {
      // Restore view after sim ends
      setScale(preSimViewRef.current.scale);
      setPan(preSimViewRef.current.pan);
      preSimViewRef.current = null;
    }
  }, [running, runStep, cameraLock]); // eslint-disable-line

  const runSim = useCallbackB(() => {
    if (running || !runOrder.length) return;
    preSimViewRef.current = { scale, pan };
    setRunning(true);
    setRunStep(-1);
    runOrder.forEach((id, i) => setTimeout(() => setRunStep(i), 280 + i * 520));
    setTimeout(() => { setRunning(false); setRunStep(-1); }, 280 + runOrder.length * 520 + 800);
  }, [runOrder, running, scale, pan]);

  const deleteSelected = useCallbackB(() => {
    if (selectedEdge !== null) {
      setEdges(es => es.filter((_, i) => i !== selectedEdge));
      setSelectedEdge(null);
      return;
    }
    // Delete multi-set if any
    if (multiSelected.size > 0) {
      const ids = multiSelected;
      setNodes(ns => ns.filter(n => !ids.has(n.id)));
      setEdges(es => es.filter(e => !ids.has(e.from) && !ids.has(e.to)));
      setMultiSelected(new Set());
      setSelected(null);
      return;
    }
    if (!selected) return;
    setNodes(ns => ns.filter(n => n.id !== selected));
    setEdges(es => es.filter(e => e.from !== selected && e.to !== selected));
    setSelected(null);
  }, [selected, selectedEdge, multiSelected]); // eslint-disable-line

  // Sync volatile state into ref so the keyboard handler always reads fresh values
  stateRef.current = { selected, selectedEdge, multiSelected, nodes, edges, pan, scale, fullscreen, showCheat, inlineConfigFor, deleteSelected, undo, redo };

  // Keyboard: full shortcut layer — reads from stateRef to avoid stale closures
  useEffectB(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const { selected, selectedEdge, multiSelected, nodes, edges, pan, scale, fullscreen, showCheat, inlineConfigFor, deleteSelected, undo, redo } = stateRef.current;
      const meta = e.metaKey || e.ctrlKey;

      // Help overlay
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault(); setShowCheat(c => !c); return;
      }

      // Undo / redo
      if (meta && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (meta && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); return; }

      // Fullscreen toggle
      if (e.key === "f" && !meta) { e.preventDefault(); setFullscreen(f => !f); return; }

      // Inspector toggle
      if (e.key === "i" && !meta) { e.preventDefault(); setShowInspector(s => !s); return; }

      // Quick-add node by number key (1..5)
      const types = activeNodeTypes ? Object.keys(activeNodeTypes).slice(0, 5) : [];
      if (!meta && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        const type = types[parseInt(e.key) - 1];
        if (!type) return;
        const w = canvasRef.current ? canvasRef.current.getBoundingClientRect() : { width: 800, height: 500 };
        const id = "n" + Date.now().toString(36);
        const x = (w.width / 2 - pan.x) / scale - NODE_W / 2;
        const y = (w.height / 2 - pan.y) / scale - NODE_H / 2;
        setNodes(ns => [...ns, { id, type, x, y, config: { ...(activeNodeTypes?.[type]?.defaultConfig || activeNodeTypes?.[type]?.config || {}) } }]);
        setSelected(id);
        return;
      }

      // ⌘A select all nodes
      if (meta && e.key === "a") {
        e.preventDefault();
        setMultiSelected(new Set(nodes.map(n => n.id)));
        return;
      }

      // ⌘D duplicate selected
      if (meta && e.key === "d") {
        e.preventDefault();
        const ids = multiSelected.size ? Array.from(multiSelected) : (selected ? [selected] : []);
        if (!ids.length) return;
        const idMap = {};
        const newNodes = ids.map(id => {
          const n = nodes.find(x => x.id === id);
          const nid = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          idMap[id] = nid;
          return { ...n, id: nid, x: n.x + 24, y: n.y + 24, config: { ...n.config } };
        });
        setNodes(ns => [...ns, ...newNodes]);
        setMultiSelected(new Set(Object.values(idMap)));
        return;
      }

      // ⌘C copy / ⌘V paste
      if (meta && e.key === "c") {
        const ids = multiSelected.size ? Array.from(multiSelected) : (selected ? [selected] : []);
        if (!ids.length) return;
        e.preventDefault();
        clipboardRef.current = ids.map(id => {
          const n = nodes.find(x => x.id === id);
          return { ...n, config: { ...n.config } };
        });
        return;
      }
      if (meta && e.key === "v") {
        if (!clipboardRef.current?.length) return;
        e.preventDefault();
        const newNodes = clipboardRef.current.map(n => ({
          ...n,
          id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          x: n.x + 32, y: n.y + 32,
          config: { ...n.config },
        }));
        setNodes(ns => [...ns, ...newNodes]);
        setMultiSelected(new Set(newNodes.map(n => n.id)));
        return;
      }

      // S = simulate
      if (e.key === "s" && !meta) { e.preventDefault(); runSim(); return; }

      // + / - without meta also work (Figma)
      if (!meta && (e.key === "=" || e.key === "+")) { e.preventDefault(); setScale(s => Math.min(2.2, s + 0.1)); return; }
      if (!meta && e.key === "-")                    { e.preventDefault(); setScale(s => Math.max(0.4, s - 0.1)); return; }

      // R reset selection
      if (e.key === "r" && !meta) {
        e.preventDefault();
        setSelected(null); setSelectedEdge(null); setMultiSelected(new Set()); setPending(null);
        return;
      }

      // Tab cycles selection through nodes
      if (e.key === "Tab") {
        if (!nodes.length) return;
        e.preventDefault();
        const order = walkOrder(nodes, edges);
        const idx = selected ? order.indexOf(selected) : -1;
        const next = e.shiftKey ? (idx - 1 + order.length) % order.length : (idx + 1) % order.length;
        setSelected(order[next]); setSelectedEdge(null);
        return;
      }

      // Arrow keys nudge selected node
      if (selected && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 8 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        setNodes(ns => ns.map(n => n.id === selected ? { ...n, x: Math.max(8, n.x + dx), y: Math.max(8, n.y + dy) } : n));
        return;
      }

      // H = hand tool toggle (Figma)
      if (e.key === "h" && !meta) {
        e.preventDefault(); setHandTool(t => !t); return;
      }

      // V = move/select tool (Figma) · just exits hand tool
      if (e.key === "v" && !meta) {
        e.preventDefault(); setHandTool(false); return;
      }

      // Shift+1 = zoom to fit; Shift+2 = zoom to selection
      if (e.shiftKey && e.key === "!") {
        e.preventDefault();
        if (!nodes.length) return;
        const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W;
        const minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H;
        const r = canvasRef.current.getBoundingClientRect();
        const s = Math.min(2, (r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY));
        const cs = Math.max(0.4, Math.min(2.2, s));
        setScale(cs);
        setPan({
          x: (r.width  - (maxX - minX) * cs) / 2 - minX * cs,
          y: (r.height - (maxY - minY) * cs) / 2 - minY * cs,
        });
        return;
      }
      if (e.shiftKey && e.key === "@") {
        e.preventDefault();
        const target = multiSelected.size ? Array.from(multiSelected)
          : selected ? [selected] : [];
        if (!target.length) return;
        const targetNodes = nodes.filter(n => target.includes(n.id));
        const xs = targetNodes.map(n => n.x), ys = targetNodes.map(n => n.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W;
        const minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H;
        const r = canvasRef.current.getBoundingClientRect();
        const s = Math.min(2, (r.width - 200) / (maxX - minX || 1), (r.height - 200) / (maxY - minY || 1));
        const cs = Math.max(0.4, Math.min(2.2, s));
        setScale(cs);
        setPan({
          x: (r.width  - (maxX - minX) * cs) / 2 - minX * cs,
          y: (r.height - (maxY - minY) * cs) / 2 - minY * cs,
        });
        return;
      }

      // O = organize
      if (e.key === "o" && !meta) { e.preventDefault(); organize(); return; }

      // Delete
      if ((e.key === "Delete" || e.key === "Backspace") && (selected || selectedEdge !== null)) {
        e.preventDefault(); deleteSelected(); return;
      }

      // Enter opens inline config for selected node
      if (e.key === "Enter" && selected && !inlineConfigFor) {
        e.preventDefault(); setInlineConfigFor(selected); return;
      }

      // Escape
      if (e.key === "Escape") {
        if (inlineConfigFor) { setInlineConfigFor(null); return; }
        if (fullscreen) { setFullscreen(false); return; }
        if (showCheat)  { setShowCheat(false); return; }
        setPending(null); setSelectedEdge(null); setSelected(null);
      }

      // ⌘0 reset zoom
      if (meta && e.key === "0") { e.preventDefault(); setScale(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canvasRef = useRefB(null);
  const dragRef = useRefB(null);

  // Convert client coords → canvas world coords
  const clientToWorld = (clientX, clientY) => {
    const r = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - r.left - pan.x) / scale,
      y: (clientY - r.top  - pan.y) / scale,
    };
  };

  // Wheel: ctrl/cmd = zoom around cursor, else pan. Always prevent default so
  // the page never scrolls when the cursor is in the canvas.
  const onWheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = canvasRef.current.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const next = Math.max(0.4, Math.min(2.2, scale * (e.deltaY > 0 ? 0.92 : 1.08)));
      const factor = next / scale;
      setPan(p => ({
        x: cx - (cx - p.x) * factor,
        y: cy - (cy - p.y) * factor,
      }));
      setScale(next);
    } else {
      // Trackpad / wheel pan
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  // Middle-mouse, space-drag, hand-tool-drag, or click-drag-on-empty = pan
  const panRef = useRefB(null);
  const [spaceHeld, setSpaceHeld] = useStateB(false);
  const [handTool, setHandTool]   = useStateB(false);

  useEffectB(() => {
    const onDown = (e) => { if (e.key === " " && e.target.tagName !== "INPUT") { e.preventDefault(); setSpaceHeld(true); } };
    const onUp   = (e) => { if (e.key === " ") setSpaceHeld(false); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const isPanGesture = (e) => {
    if (e.button === 1) return true;                       // middle mouse
    if (e.shiftKey) return true;                            // shift+drag
    if (spaceHeld || handTool) return true;                 // Figma-style
    // Click on empty canvas (not a node, not a port, not the zoom controls)
    if (e.button === 0 && (e.target === canvasRef.current
          || e.target.tagName === "svg"
          || e.target.classList?.contains?.("canvas-zoom-layer"))) return true;
    return false;
  };

  const onCanvasPointerDown = (e) => {
    if (!isPanGesture(e)) return;
    e.preventDefault();
    panRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan };
    document.body.style.cursor = "grabbing";
    window.addEventListener("pointermove", onCanvasPanMove);
    window.addEventListener("pointerup", onCanvasPanUp);
  };
  const onCanvasPanMove = (e) => {
    if (!panRef.current) return;
    setPan({
      x: panRef.current.startPan.x + (e.clientX - panRef.current.startX),
      y: panRef.current.startPan.y + (e.clientY - panRef.current.startY),
    });
  };
  const onCanvasPanUp = () => {
    panRef.current = null;
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", onCanvasPanMove);
    window.removeEventListener("pointerup", onCanvasPanUp);
  };

  const onPointerDown = (e, id) => {
    e.preventDefault(); e.stopPropagation();
    const w = clientToWorld(e.clientX, e.clientY);
    const n = nodes.find(n => n.id === id);

    // Multi-select with cmd/ctrl click
    if (e.metaKey || e.ctrlKey) {
      setMultiSelected(set => {
        const next = new Set(set);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setSelected(id);
      return;
    }

    // If clicking a node that's already in multi-set, drag the whole set
    const moving = multiSelected.has(id) && multiSelected.size > 1
      ? Array.from(multiSelected).map(nid => {
          const m = nodes.find(x => x.id === nid);
          return { id: nid, dx: w.x - m.x, dy: w.y - m.y };
        })
      : [{ id, dx: w.x - n.x, dy: w.y - n.y }];

    dragRef.current = { ids: moving };
    setSelected(id);
    if (!multiSelected.has(id)) setMultiSelected(new Set());
    setSelectedEdge(null);
    setDraggingId(id);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current || !canvasRef.current) return;
    const w = clientToWorld(e.clientX, e.clientY);
    const moving = dragRef.current.ids;
    setNodes(ns => ns.map(n => {
      const m = moving.find(x => x.id === n.id);
      if (!m) return n;
      return { ...n, x: Math.max(8, w.x - m.dx), y: Math.max(8, w.y - m.dy) };
    }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setDraggingId(null);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  // Drop active state: track enter/leave depth so children don't flicker the highlight
  const dragDepth = useRefB(0);
  const onCanvasDragEnter = (e) => {
    e.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  };
  const onCanvasDragLeave = (e) => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  };
  const onCanvasDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const onCanvasDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    const type = e.dataTransfer.getData("text/plain");
    if (!activeNodeTypes?.[type]) return;
    const w = clientToWorld(e.clientX, e.clientY);
    const x = Math.max(8, w.x - NODE_W / 2);
    const y = Math.max(8, w.y - NODE_H / 2);
    const id = "n" + Date.now().toString(36);
    setNodes(ns => [...ns, { id, type, x, y, config: { ...(activeNodeTypes?.[type]?.defaultConfig || activeNodeTypes?.[type]?.config || {}) } }]);
    setSelected(id);
  };

  const markRecentEdge = (key) => {
    setRecentEdges(s => new Set([...s, key]));
    setTimeout(() => {
      setRecentEdges(s => { const next = new Set(s); next.delete(key); return next; });
    }, 700);
  };

  const onPortClick = (e, nodeId, kind) => {
    e.preventDefault(); e.stopPropagation();
    if (kind === "out") setPending({ from: nodeId });
    else if (kind === "in" && pending && pending.from && pending.from !== nodeId) {
      const key = pending.from + "→" + nodeId;
      setEdges(es => es.some(x => x.from === pending.from && x.to === nodeId)
        ? es : [...es, { from: pending.from, to: nodeId }]);
      markRecentEdge(key);
      setPending(null);
    }
  };

  const organize = useCallbackB(() => {
    const r = canvasRef.current?.getBoundingClientRect();
    const cw = r ? r.width / scale : 800;
    const ch = r ? r.height / scale : 500;
    setNodes(ns => organizeLayout(ns, edges, cw, ch));
  }, [edges, scale]); // eslint-disable-line

  const fitAll = useCallbackB(() => {
    if (!nodes.length) return;
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W;
    const minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H;
    const r = canvasRef.current.getBoundingClientRect();
    const s = Math.min(2, (r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY));
    const cs = Math.max(0.4, Math.min(2.2, s));
    setScale(cs);
    setPan({
      x: (r.width  - (maxX - minX) * cs) / 2 - minX * cs,
      y: (r.height - (maxY - minY) * cs) / 2 - minY * cs,
    });
  }, [nodes]);

  const applyAction = (issue) => {
    if (issue.action?.kind === "merge-swaps") {
      // Remove the second of each pair, keep edges joined
      const removeIds = new Set(issue.action.pairs.map(p => p[1]));
      setNodes(ns => ns.filter(n => !removeIds.has(n.id)));
      setEdges(es => {
        let out = es.filter(e => !(removeIds.has(e.from) || removeIds.has(e.to)));
        // For each removed pair, link [pair[0].from] -> [pair[1].outgoing]
        issue.action.pairs.forEach(([a, b]) => {
          const downstream = es.filter(e => e.from === b).map(e => e.to);
          downstream.forEach(d => { if (!out.find(e => e.from === a && e.to === d)) out.push({ from: a, to: d }); });
        });
        return out;
      });
    }
  };

  const selNode = nodes.find(n => n.id === selected);
  const activeIdx = runStep;

  return (
    <div className={"builder-shell" + (fullscreen ? " builder-fs" : "")} style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 22px", borderBottom: "1px solid var(--hairline)",
        gap: 16, flexWrap: "wrap", background: "var(--paper-2)",
      }}>
        <div className="row" style={{ gap: 12 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="serif"
            style={{
              border: 0, background: "transparent", padding: 0,
              fontSize: 18, fontWeight: 500, letterSpacing: -0.01,
              borderBottom: "1px dashed var(--hairline-2)",
              outline: "none", color: "var(--ink)",
              fontFamily: "var(--serif)",
              minWidth: 240,
            }}
          />
          <Tag tone="default">draft</Tag>
        </div>
        <div className="row toolbar-group" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <TimeAgo savedAt={savedAt} />
          <button className="btn ghost sm" onClick={undo} disabled={historyRef.current.past.length < 2} title="Undo · ⌘Z">↶</button>
          <button className="btn ghost sm" onClick={redo} disabled={!historyRef.current.future.length} title="Redo · ⌘⇧Z">↷</button>
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--hairline)", margin: "0 2px" }} />
          <ToolbarOverflow
            fullscreen={fullscreen} setFullscreen={setFullscreen}
            showInspector={showInspector} setShowInspector={setShowInspector}
            onShowCheat={() => setShowCheat(true)}
          />
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--hairline)", margin: "0 2px" }} />
          <button className="btn ghost sm" onClick={organize} disabled={nodes.length < 2} title="Organize · O">Organize</button>
          <button className="btn ghost sm" disabled={!selected} onClick={deleteSelected} title="Delete · ⌫">
            Delete
          </button>
          <button className="btn ghost sm" disabled={!nodes.length || running} onClick={runSim} title="Simulate · S">
            {running ? "Simulating…" : "Simulate"} <span className="ar">▷</span>
          </button>
          <button
            className="btn sm"
            data-testid="deploy-button"
            disabled={!ctx.connected || locked || deploying || hasError || !nodes.length}
            onClick={async () => {
              if (!ctx.connected) { openConnect(); return; }
              if (!bridge?.contract?.write) { setDeployResult({ ok: false, error: "Bridge not ready" }); return; }
              setDeploying(true);
              setDeployResult(null);
              try {
                const order = walkOrder(nodes, edges);
                // Count actionable nodes (supply, borrow, swap — not repeat/settle)
                const actionableNodes = order.filter(id => {
                  const n = nodes.find(nd => nd.id === id);
                  return n && n.type !== "repeat" && n.type !== "settle";
                });

                if (actionableNodes.length >= 2 && bridge.contract.write.composerOpenPosition) {
                  // Multi-node: use Composer for atomic strategy execution
                  const supplyNode = nodes.find(n => n.type === "supply");
                  const borrowNode = nodes.find(n => n.type === "borrow");
                  const swapNode = nodes.find(n => n.type === "swap");
                  const repeatNode = nodes.find(n => n.type === "repeat");

                  const supplyCfg = supplyNode?.config || {};
                  const borrowCfg = borrowNode?.config || {};
                  const swapCfg = swapNode?.config || {};

                  const collateralToken = tokenMap[supplyCfg.asset] || Object.values(tokenMap)[0];
                  const collateralAmount = parseAmountBW(supplyCfg.amount || "0");
                  const borrowToken = tokenMap[borrowCfg.asset] || collateralToken;
                  const borrowAmount = parseAmountBW(borrowCfg.amount || "0");
                  const ltv = borrowCfg.ltv || 50;
                  const swapTokenOut = tokenMap[swapCfg.to] || "0x0000000000000000000000000000000000000000";
                  const swapMinOut = swapCfg.amount ? parseAmountBW(swapCfg.amount) * BigInt(10000 - Math.round((swapCfg.slip || 0.5) * 100)) / 10000n : 0n;
                  const loopCount = repeatNode?.config?.loops || 1;

                  // ERC20 approval: ensure Composer can pull collateral tokens
                  const COMPOSER_ADDRESS = "0xEab68D8Ee6DC5Ddc10293fF3B1bb21679d81dC8b";
                  if (collateralAmount > 0n) {
                    const allowance = await bridge.contract.read.erc20Allowance(collateralToken, ctx.address, COMPOSER_ADDRESS);
                    if (BigInt(allowance) < collateralAmount) {
                      setDeployStep("signing");
                      const approvalRes = await bridge.contract.write.erc20Approve(collateralToken, COMPOSER_ADDRESS, ctx.address);
                      if (approvalRes.status === "reverted") { setDeployResult({ ok: false, error: "ERC20 approval reverted" }); return; }
                    }
                  }

                  // Real workflowHash: keccak256 of the strategy graph structure
                  const { keccak256: bwKeccak, toHex: bwToHex } = await import("viem");
                  const graphPayload = JSON.stringify({
                    nodes: nodes.map(n => ({ id: n.id, type: n.type, config: n.config })),
                    edges: edges.map(e => e.from + "->" + e.to),
                  });
                  const workflowHash = bwKeccak(bwToHex(graphPayload));

                  setDeployStep("committing");
                  await bridge.contract.write.composerOpenPosition({
                    strategyName: workflow.name || "Untitled",
                    workflowHash,
                    collateralAmount,
                    poolSupplyAmount: 0n,
                    poolBorrowAmount: borrowAmount,
                    swapDeadlineOffset: 300n,
                    strategyId: 0n,
                    swapAmountIn: borrowAmount,
                    swapMinOut,
                    collateralToken,
                    borrowToken,
                    swapTokenOut,
                    ltvNum: BigInt(ltv),
                    ltvDen: 100n,
                    useOracleBorrow: false,
                    apyTarget: 0,
                    loopCount: loopCount,
                  }, ctx.address);
                } else {
                  // Single node: use commit-reveal for supply/borrow, direct for swap
                  for (const nodeId of order) {
                    const node = nodes.find(n => n.id === nodeId);
                    if (!node) continue;
                    const cfg = node.config || {};
                    const tokenAddr = tokenMap[cfg.asset] || tokenMap[cfg.from] || Object.values(tokenMap)[0];
                    const amount = parseAmountBW(cfg.amount || "0");
                    const account = ctx.address;
                    if (node.type === "supply" && amount > 0n) {
                      setDeployStep("committing");
                      const tx1 = await bridge.contract.write.shieldCommit(tokenAddr, amount, account);
                      if (tx1.status === "reverted") { setDeployResult({ ok: false, error: "Supply commit reverted" }); setDeploying(false); setDeployStep(null); return; }
                      setDeployStep("decrypting");
                      const tx2 = await bridge.contract.write.shieldExecute(tokenAddr, tx1.commitId, account);
                      if (tx2.status === "reverted") { setDeployResult({ ok: false, error: "Supply execute reverted" }); setDeploying(false); setDeployStep(null); return; }
                      setDeployStep(null);
                    } else if (node.type === "borrow" && amount > 0n) {
                      const borrowToken = tokenMap[cfg.asset] || Object.values(tokenMap)[0];
                      setDeployStep("committing");
                      const tx1 = await bridge.contract.write.borrowCommit(tokenAddr, amount, BigInt(cfg.ltv || 50), 100n, account);
                      if (tx1.status === "reverted") { setDeployResult({ ok: false, error: "Borrow commit reverted" }); setDeploying(false); setDeployStep(null); return; }
                      setDeployStep("decrypting");
                      const tx2 = await bridge.contract.write.borrowExecute(tx1.commitId, account);
                      if (tx2.status === "reverted") { setDeployResult({ ok: false, error: "Borrow execute reverted" }); setDeploying(false); setDeployStep(null); return; }
                      setDeployStep(null);
                    } else if (node.type === "swap" && amount > 0n) {
                      const tokenOut = tokenMap[cfg.to] || Object.values(tokenMap)[0];
                      const slipBps = Math.round((cfg.slip || 0.5) * 100);
                      const minOut = amount * BigInt(10000 - slipBps) / 10000n;
                      await bridge.contract.write.submitSwapIntent(tokenAddr, tokenOut, amount, minOut, 300n, account);
                    }
                  }
                }
                setDeployResult({ ok: true, tx: "confirmed", block: 0 });
              } catch (err) {
                setDeployResult({ ok: false, error: err.message || "Transaction failed" });
              } finally {
                setDeploying(false);
                setDeployStep(null);
              }
            }}
          >
            {deploying ? <>{deployStep === "signing" ? "Approving…" : deployStep === "committing" ? "Committing…" : deployStep === "decrypting" ? "Decrypting…" : "Signing…"} <span className="ar">⋯</span></> : <>Deploy <span className="ar">→</span></>}
          </button>
        </div>
      </div>

      {/* Sub-strip */}
      <div className="row" style={{ gap: 14, padding: "10px 22px", borderBottom: "1px solid var(--hairline)", flexWrap: "wrap", background: "var(--paper)" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.06, textTransform: "uppercase" }}>{nodes.length} step{nodes.length === 1 ? "" : "s"}</span>
        <span style={{ color: "var(--muted)" }}>·</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.06, textTransform: "uppercase" }}>{edges.length} link{edges.length === 1 ? "" : "s"}</span>
        <span style={{ color: "var(--muted)" }}>·</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.06, textTransform: "uppercase" }}>est. gas ≈ {(nodes.length * 248 + edges.length * 12).toFixed(0)}k</span>

        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: pending ? "var(--accent-ink)" : locked ? "var(--accent-ink)" : "var(--positive)" }}>
          {pending ? "click an input port to connect · esc to cancel"
                   : !ctx.connected ? "connect a wallet before deploying"
                   : locked ? "grant a permit before deploying" : "permit live"}
        </span>
      </div>

      {/* Body: palette | canvas (full width, no inspector) */}
      <div className="builder-body" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "180px minmax(0, 1fr)", gap: 1, background: "var(--hairline)" }}>
        <NodePalette className="palette" nodeTypes={activeNodeTypes} />

        <div
          ref={canvasRef}
          className={"canvas" + (dropActive ? " drop-active" : "") + (handTool || spaceHeld ? " hand-tool" : "")}
          data-testid="builder-canvas"
          style={{ position: "relative", border: 0, minHeight: 0, overflow: "hidden" }}
          onDragEnter={onCanvasDragEnter}
          onDragLeave={onCanvasDragLeave}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
          onWheel={onWheel}
          onPointerDown={onCanvasPointerDown}
          onClick={(e) => {
            if (e.target === e.currentTarget || e.target.tagName === "svg") {
              setSelected(null); setPending(null); setSelectedEdge(null);
            }
          }}
        >
          {/* Zoom + tool controls */}
          <div className="canvas-zoom-controls">
            <button
              onClick={() => { setHandTool(false); }}
              className={!handTool ? "active" : ""}
              title="Move / select · V"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 1 L2 10 L4.5 8 L6 11 L7.2 10.6 L5.8 7.6 L9 7 Z" fill="currentColor" />
              </svg>
            </button>
            <button
              onClick={() => { setHandTool(true); }}
              className={handTool ? "active" : ""}
              title="Hand tool · H"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M3 6 L3 9 Q3 11 5 11 L7 11 Q9 11 9 9 L9 4 Q9 3 8 3 Q7 3 7 4 L7 5 Q7 3 6 3 Q5 3 5 4 L5 5 Q5 2 4 2 Q3 2 3 3 L3 6 Z" fill="none" />
              </svg>
            </button>
            <span style={{ width: 1, background: "var(--hairline)", margin: "2px 4px" }} />
            <button onClick={() => setScale(s => Math.max(0.4, s - 0.1))} title="Zoom out · ⌘−">−</button>
            <button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }} title="Reset · ⌘0">{Math.round(scale * 100)}%</button>
            <button onClick={() => setScale(s => Math.min(2.2, s + 0.1))} title="Zoom in · ⌘+">+</button>
            <span style={{ width: 1, background: "var(--hairline)", margin: "2px 4px" }} />
            <button onClick={fitAll} title="Fit all · ⇧1" style={{ fontSize: 10 }}>fit</button>
            <button
              onClick={() => setCameraLock(c => !c)}
              className={cameraLock ? "active" : ""}
              title={cameraLock ? "Camera follows sim · click to unlock" : "Camera locked · click to follow sim"}
              style={{ fontSize: 10 }}
            >📍</button>
          </div>

          {/* Empty state */}
          {!nodes.length && <CanvasEmpty />}

          {/* Zoom + pan layer wraps both edges and nodes */}
          <div className="canvas-zoom-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
          {/* Edges layer */}
          <svg className="canvas-edges">
            <defs>
              <marker id="arr-ink" markerWidth="10" markerHeight="10" refX="7" refY="3.5" orient="auto">
                <path d="M0,0 L8,3.5 L0,7 z" fill="var(--ink)" />
              </marker>
              <marker id="arr-acc" markerWidth="10" markerHeight="10" refX="7" refY="3.5" orient="auto">
                <path d="M0,0 L8,3.5 L0,7 z" fill="var(--accent-ink)" />
              </marker>
              <marker id="arr-err" markerWidth="10" markerHeight="10" refX="7" refY="3.5" orient="auto">
                <path d="M0,0 L8,3.5 L0,7 z" fill="var(--danger)" />
              </marker>
              <marker id="arr-warn" markerWidth="10" markerHeight="10" refX="7" refY="3.5" orient="auto">
                <path d="M0,0 L8,3.5 L0,7 z" fill="var(--accent)" />
              </marker>
            </defs>
            {/* Halo layer */}
            {edges.map((e, i) => {
              const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
              if (!a || !b) return null;
              const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
              const x2 = b.x,          y2 = b.y + NODE_H / 2;
              const mid = (x1 + x2) / 2;
              const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
              return <path key={"h" + i} className="edge-halo" d={d} />;
            })}
            {/* Stroke + hit-area layer */}
            {edges.map((e, i) => {
              const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
              if (!a || !b) return null;
              const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
              // Stop 10px before the target so arrow head doesn't pierce the port circle
              const x2 = b.x - 8,      y2 = b.y + NODE_H / 2;
              const dx = x2 - x1, dy = y2 - y1;
              const isBackward = dx < 0;
              const cpx = isBackward ? 60 + Math.abs(dx) * 0.4 : Math.max(50, Math.abs(dx) * 0.5);
              const d = isBackward
                ? `M ${x1} ${y1} C ${x1 + cpx} ${y1}, ${x2 - cpx} ${y2}, ${x2} ${y2}`
                : `M ${x1} ${y1} C ${x1 + cpx} ${y1}, ${x2 - cpx} ${y2}, ${x2} ${y2}`;
              const aIdx = runOrder.indexOf(e.from);
              const isActive = running && activeIdx >= aIdx + 1;
              const key = e.from + "→" + e.to;
              const isNew = recentEdges.has(key);
              const isSelected = selectedEdge === i;
              const sev = edgeSev[key];
              const isIdle = !running && !isNew;
              return (
                <g key={i}>
                  <path className={"edge-stroke"
                          + (isActive ? " active" : "")
                          + (isNew ? " draw-on" : "")
                          + (isSelected ? " selected" : "")
                          + (sev === "error" ? " sev-error" : sev === "warn" ? " sev-warn" : "")
                          + (isIdle && !sev ? " idle" : "")}
                        d={d}
                        markerEnd={`url(#${sev === "error" ? "arr-err" : sev === "warn" ? "arr-warn" : isActive || isSelected ? "arr-acc" : "arr-ink"})`} />
                  <path className="edge-hit" d={d}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSelectedEdge(i); setSelected(null); setPending(null);
                        }} />
                  {isActive && (
                    <circle r="3.5" fill="var(--accent-ink)">
                      <animateMotion dur="1s" repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Issue annotations: floating pins near problem nodes */}
          {!running && issues.flatMap((iss, ii) => {
            if (!iss.nodeIds?.length) return [];
            return iss.nodeIds.slice(0, 1).map(nid => {
              const node = nodes.find(n => n.id === nid);
              if (!node) return null;
              return (
                <IssuePin
                  key={"iss-" + ii + "-" + nid}
                  x={node.x + NODE_W - 14}
                  y={node.y - 10}
                  severity={iss.severity}
                  msg={iss.msg}
                  onApply={iss.action ? () => applyAction(iss) : null}
                />
              );
            });
          })}

          {/* Edge inspector popover when an edge is selected */}
          {selectedEdge !== null && edges[selectedEdge] && (() => {
            const e = edges[selectedEdge];
            const a = nodes.find(n => n.id === e.from);
            const b = nodes.find(n => n.id === e.to);
            if (!a || !b) return null;
            const midX = (a.x + NODE_W + b.x) / 2;
            const midY = (a.y + b.y) / 2 + NODE_H / 2;
            return (
              <EdgePopover
                x={midX} y={midY}
                from={a} to={b}
                onDelete={() => {
                  setEdges(es => es.filter((_, i) => i !== selectedEdge));
                  setSelectedEdge(null);
                }}
                onClose={() => setSelectedEdge(null)}
              />
            );
          })()}

          {nodes.map((n) => {
            const t = activeNodeTypes?.[n.type] || NODE_TYPES[n.type] || { label: n.type, kicker: "—", swatch: "var(--muted)", desc: "Module unavailable" };
            const idx = runOrder.indexOf(n.id);
            const isActive = running && activeIdx === idx;
            const isPast   = running && activeIdx > idx;
            const isIdle   = !running && idlePulse === idx;
            // Suggestion: orphan + has a next-rule
            const outDeg = edges.filter(e => e.from === n.id).length;
            const isOrphan = outDeg === 0 && n.type !== "settle";
            const suggestion = isOrphan ? nextSuggestionFor(n) : null;
            return (
              <React.Fragment key={n.id}>
                <BuilderNode
                  n={n} t={t}
                  selected={selected === n.id || multiSelected.has(n.id)}
                  pendingFrom={pending?.from === n.id}
                  active={isActive || isIdle} past={isPast}
                  isCycle={cycleSet.has(n.id)}
                  isDragging={draggingId === n.id}
                  locked={locked}
                  onPointerDown={onPointerDown}
                  onPortClick={onPortClick}
                  onDoubleClick={(id) => setInlineConfigFor(id)}
                />
                {suggestion && !running && (
                  <SuggestionPill
                    x={n.x + NODE_W + 14} y={n.y + NODE_H / 2 - 11}
                    label={suggestion.label}
                    onAccept={() => {
                      const newId = "n" + Date.now().toString(36);
                      const newNode = { id: newId, type: suggestion.type, x: n.x + NODE_W + 60, y: n.y, config: { ...(activeNodeTypes?.[suggestion.type]?.defaultConfig || activeNodeTypes?.[suggestion.type]?.config || {}) } };
                      setNodes(ns => [...ns, newNode]);
                      setEdges(es => [...es, { from: n.id, to: newId }]);
                      markRecentEdge(n.id + "→" + newId);
                      setSelected(newId);
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
          </div>{/* /canvas-zoom-layer */}

          {/* canvas hint (outside zoom so it stays at 100%) */}
          <div style={{ position: "absolute", left: 16, bottom: 12, fontFamily: "var(--mono)", fontSize: 10, color: pending ? "var(--accent-ink)" : "var(--muted)", letterSpacing: 0.08, textTransform: "uppercase", pointerEvents: "none" }}>
            {pending ? "click an input port to connect · esc to cancel"
                     : selectedEdge !== null ? "edge selected · ⌫ to delete"
                     : "drag from palette · ⌘+wheel zoom · shift+drag pan"}
          </div>
        </div>

        {/* Inspector removed - click node to edit inline */}
      </div>

      {/* Backdrop blur over the canvas zone only — palette stays clear */}
      {inlineConfigFor && (() => {
        const node = nodes.find(n => n.id === inlineConfigFor);
        if (!node) return null;
        const rect = canvasRef.current?.getBoundingClientRect();
        const W = rect?.width || 800, H = rect?.height || 600;
        // Project world → screen coords
        let popX = node.x * scale + pan.x + NODE_W * scale + 18;
        let popY = node.y * scale + pan.y;
        const popW = 300, popH = 220;
        // Flip to left if overflowing right
        if (popX + popW > W - 12) popX = node.x * scale + pan.x - popW - 18;
        // Clamp vertically
        if (popY + popH > H - 12) popY = H - popH - 12;
        if (popY < 12) popY = 12;
        return (
          <>
            <div
              onClick={() => setInlineConfigFor(null)}
              style={{
                position: "absolute", inset: 0, zIndex: 8,
                backdropFilter: "blur(6px)",
                background: "color-mix(in oklch, var(--ink) 18%, transparent)",
                animation: "fadeIn 220ms var(--ease) forwards",
              }}
            />
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute", left: popX, top: popY, zIndex: 9,
                width: popW,
                background: "var(--paper)",
                border: "1px solid var(--ink)",
                boxShadow: "5px 5px 0 0 var(--accent-ink)",
                padding: 16,
                animation: "fadeIn 220ms var(--ease) forwards",
              }}
            >
              <div className="spread" style={{ marginBottom: 12 }}>
                <Tag tone="accent">edit · {(activeNodeTypes?.[node.type] || NODE_TYPES[node.type] || { label: node.type }).label}</Tag>
                <button onClick={() => setInlineConfigFor(null)} style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12, fontFamily: "var(--mono)" }}>esc</button>
              </div>
              <NodeConfig node={node} setNodes={setNodes} locked={locked} nodeTypes={activeNodeTypes} />
              {(() => {
                const outs = edges.map((e, i) => ({ e, i })).filter(({e}) => e.from === node.id);
                if (outs.length < 2) return null;
                return (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--hairline-2)" }}>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>per-link allocation</div>
                    {outs.map(({e, i}) => {
                      const target = nodes.find(n => n.id === e.to);
                      const pct = e.pct ?? Math.floor(100 / outs.length);
                      return (
                        <div key={i} className="spread" style={{ gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ {target ? (activeNodeTypes?.[target.type] || NODE_TYPES[target.type] || { label: target.type }).label : "?"}</span>
                          <input
                            type="number" min={0} max={100} value={pct}
                            onChange={(ev) => {
                              const v = Math.max(0, Math.min(100, parseInt(ev.target.value) || 0));
                              setEdges(es => es.map((x, idx) => idx === i ? { ...x, pct: v } : x));
                            }}
                            style={{ width: 56, padding: "2px 6px", fontFamily: "var(--mono)", fontSize: 11, border: "1px solid var(--hairline)", background: "var(--paper)", color: "var(--ink)" }}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </>
        );
      })()}

      {showCheat && <KeyboardCheatsheet onClose={() => setShowCheat(false)} />}

      {deployResult && <DeployToast
        result={deployResult}
        onClose={() => setDeployResult(null)}
        onRetry={() => {
          setDeployResult(null);
          // Re-trigger the real deploy by clicking the deploy button programmatically
          const btn = document.querySelector('[data-testid="deploy-button"]');
          if (btn && !btn.disabled) btn.click();
        }}
      />}
    </div>
  );
}

/* ─── Saved indicator (self-contained timer) ─── */
function TimeAgo({ savedAt }) {
  const [now, setNow] = useStateB(Date.now());
  useEffectB(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  if (!savedAt) return null;
  const ago = Math.max(0, Math.floor((now - savedAt) / 1000));
  const label = ago < 5 ? "Saved" : ago < 60 ? `Saved ${ago}s ago` : ago < 3600 ? `Saved ${Math.floor(ago/60)}m ago` : "Saved";
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, color: "var(--muted)",
        letterSpacing: 0.08, textTransform: "uppercase",
        padding: "4px 8px", border: "1px solid var(--hairline)",
        background: "var(--paper)",
        display: "inline-flex", alignItems: "center", gap: 6,
        marginRight: 6,
      }}
      title="Auto-saved to your browser. Refresh-safe."
    >
      <span style={{
        width: 6, height: 6, borderRadius: 50,
        background: ago < 5 ? "var(--positive)" : "var(--muted-2)",
      }} />
      {label}
    </span>
  );
}

/* ─── Empty canvas state ─── */
function CanvasEmpty() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "grid", placeItems: "center",
      pointerEvents: "none",
      animation: "fadeIn .4s var(--ease) forwards",
    }}>
      <div style={{ textAlign: "center", maxWidth: 320 }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 28, lineHeight: 1.15, color: "var(--muted)", marginBottom: 8 }}>
          Empty canvas.
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--muted-2)", letterSpacing: 0.06, textTransform: "uppercase" }}>
          Drag a node from the left to start.
        </div>
      </div>
    </div>
  );
}

/* ─── Node palette (left) ─── */
function NodePalette({ className, nodeTypes }) {
  const entries = nodeTypes ? Object.entries(nodeTypes) : [];
  return (
    <aside className={className} style={{ background: "var(--paper)", padding: "14px 12px", overflowY: "auto" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>nodes</div>
      {!entries.length && (
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0", lineHeight: 1.5 }}>
          No modules available.
        </div>
      )}
      <div className="stack-2">
        {entries.map(([k, t]) => (
          <div
            key={k}
            className="row palette-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", k);
              e.dataTransfer.effectAllowed = "copy";
            }}
            style={{
              gap: 10, padding: "8px 10px",
              border: "1px solid var(--hairline)",
              background: "var(--paper)",
              cursor: "grab",
              transition: "border-color var(--t-feedback) var(--ease), background-color var(--t-feedback) var(--ease), transform var(--t-feedback) var(--ease)",
            }}
            title={t.desc}
          >
            <span style={{ width: 6, height: 6, background: t.swatch, display: "inline-block", flex: "0 0 auto" }} />
            <span style={{ fontSize: 13 }}>{t.label}</span>
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 0.04, marginTop: 14, lineHeight: 1.55 }}>
        Drag onto canvas · ⌫ deletes · Esc cancels
      </div>
    </aside>
  );
}

/* ─── Builder node (smaller) ─── */
function BuilderNode({ n, t, selected, active, past, pendingFrom, isCycle, isDragging, locked, onPointerDown, onPortClick, onDoubleClick }) {
  const klass = "node type-" + n.type
    + (selected ? " selected" : "")
    + (active ? " active" : past ? " past" : "")
    + (isCycle ? " cycle" : "")
    + (isDragging ? " dragging" : "");
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, n.id)}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick && onDoubleClick(n.id); }}
      className={klass}
      style={{ left: n.x, top: n.y, cursor: "grab" }}
    >
      <div className="nhead">
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, background: t.swatch, display: "inline-block", flex: "0 0 auto" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
        </span>
        <span className="mono" style={{ fontSize: 9, color: "var(--muted)", flex: "0 0 auto" }}>
          {past ? "✓" : active ? "···" : t.kicker}
        </span>
      </div>
      <div className="nbody">
        {n.type === "supply" && (
          <div className="nrow" style={{ minWidth: 0 }}>
            <AssetGlyph sym={n.config.asset} size={14} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.config.asset}</span>
          </div>
        )}
        {n.type === "borrow" && (
          <div className="nrow" style={{ minWidth: 0 }}>
            <AssetGlyph sym={n.config.asset} size={14} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.config.asset}</span>
            <span className="mono" style={{ fontSize: 9, color: "var(--muted)" }}>{n.config.ltv}%</span>
          </div>
        )}
        {n.type === "swap" && (
          <div className="nrow" style={{ minWidth: 0 }}>
            <AssetGlyph sym={n.config.from} size={12} />
            <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>→</span>
            <AssetGlyph sym={n.config.to} size={12} />
          </div>
        )}
        {n.type === "repeat" && (
          <div className="nrow">×{n.config.loops}</div>
        )}
        {n.type === "settle" && (
          <div className="nrow" style={{ fontSize: 10, color: "var(--muted)" }}>decrypt</div>
        )}
      </div>
      <span className="port in"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => onPortClick && onPortClick(e, n.id, "in")} />
      <span className={"port out"
              + ((active || past) ? " active" : "")
              + (pendingFrom ? " pending" : "")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => onPortClick && onPortClick(e, n.id, "out")} />
    </div>
  );
}

/* ─── Inspector ─── */
function Inspector({ node, setNodes, tab, setTab, issues, applyAction, nodes, edges, runOrder, locked, className }) {
  return (
    <aside className={className} style={{ background: "var(--paper)", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="tabstrip" style={{ background: "var(--paper)", padding: "0 4px" }}>
        {["config", "issues", "code"].map(k => (
          <button key={k} onClick={() => setTab(k)} className={"tab" + (tab === k ? " active" : "")}>
            {k}
            {k === "issues" && issues.length > 0 && (
              <span style={{
                marginLeft: 6,
                background: issues.some(i => i.severity === "error") ? "var(--danger)" : "var(--accent)",
                color: "var(--paper)",
                padding: "1px 5px", fontSize: 9, borderRadius: 50,
              }}>{issues.length}</span>
            )}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {tab === "config" && (node
          ? <NodeConfig node={node} setNodes={setNodes} locked={locked} />
          : <EmptyState text="Select a node to configure it." />
        )}
        {tab === "issues" && <IssuesPanel issues={issues} applyAction={applyAction} />}
        {tab === "code"   && <PlainSummary nodes={nodes} runOrder={runOrder} />}
      </div>
    </aside>
  );
}

function NodeConfig({ node, setNodes, locked, nodeTypes }) {
  const t = nodeTypes?.[node.type] || NODE_TYPES[node.type] || { label: node.type, swatch: "var(--muted)", desc: "Module unavailable" };
  const update = (key, val) => setNodes(ns => ns.map(n => n.id === node.id ? { ...n, config: { ...n.config, [key]: val } } : n));

  return (
    <div className="stack-3">
      <div className="row" style={{ gap: 8 }}>
        <span style={{ width: 8, height: 8, background: t.swatch, display: "inline-block" }} />
        <h3 className="serif" style={{ fontSize: 17, fontWeight: 500, margin: 0 }}>{t.label}</h3>
      </div>
      <p className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 0.04, margin: 0 }}>{t.desc}</p>
      <hr className="dashed" />

      {node.type === "supply" && <>
        <Field label="Asset">
          <Select value={node.config.asset} options={["USDC","ETH","WBTC","ARB","DAI"]} onChange={v => update("asset", v)} />
        </Field>
        <Field label="Amount" hint="encrypted client-side before submission">
          <TextInput value={node.config.amount} suffix={node.config.asset} onChange={v => update("amount", v)} />
        </Field>
      </>}

      {node.type === "borrow" && <>
        <Field label="Asset">
          <Select value={node.config.asset} options={["USDC","ETH","WBTC","ARB","DAI"]} onChange={v => update("asset", v)} />
        </Field>
        <Field label="Target LTV" hint="ratio checked on ciphertext">
          <Slider value={node.config.ltv} min={0} max={80} liq={80} onChange={v => update("ltv", v)} />
        </Field>
        <Field label="Borrow amount">
          <TextInput value={node.config.amount} suffix={node.config.asset} onChange={v => update("amount", v)} />
        </Field>
      </>}

      {node.type === "swap" && <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="From">
            <Select value={node.config.from} options={["USDC","ETH","WBTC","ARB","DAI"]} onChange={v => update("from", v)} />
          </Field>
          <Field label="To">
            <Select value={node.config.to} options={["USDC","ETH","WBTC","ARB","DAI"]} onChange={v => update("to", v)} />
          </Field>
        </div>
        <Field label="Slippage" hint="enforced via minAmountOut">
          <TextInput value={String(node.config.slip)} suffix="%" onChange={v => update("slip", parseFloat(v) || 0)} />
        </Field>
        <Field label="Estimated out">
          <TextInput value={node.config.amount} suffix={node.config.to} onChange={v => update("amount", v)} />
        </Field>
      </>}

      {node.type === "repeat" && <>
        <Field label="Loop depth" hint="capped by strategy.loopCount">
          <Slider value={node.config.loops} min={1} max={8} onChange={v => update("loops", v)} />
        </Field>
      </>}

      {node.type === "settle" && <>
        <p style={{ fontSize: 13, color: "var(--ink-2)", margin: 0, lineHeight: 1.55 }}>
          Grants decrypt rights to your wallet for every balance touched above. Required at the end of every strategy.
        </p>
      </>}

      <hr className="dashed" />
      <div className="kv"><span className="k">est. gas</span><span className="v">{node.type === "borrow" ? "≈ 448k" : node.type === "swap" ? "≈ 196k" : node.type === "settle" ? "≈ 22k" : "≈ 312k"}</span></div>
    </div>
  );
}

function IssuesPanel({ issues, applyAction }) {
  if (!issues.length) {
    return <EmptyState text="No issues. Looks good." />;
  }
  return (
    <div className="stack-3">
      {issues.map((iss, i) => (
        <div key={i} style={{
          padding: "10px 12px",
          background: iss.severity === "error" ? "var(--danger-soft)" : iss.severity === "warn" ? "var(--accent-soft)" : "var(--paper-2)",
          border: "1px solid " + (iss.severity === "error" ? "var(--danger)" : iss.severity === "warn" ? "var(--accent)" : "var(--hairline)"),
        }}>
          <div className="mono" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.1, color: iss.severity === "error" ? "var(--danger)" : iss.severity === "warn" ? "var(--accent-ink)" : "var(--muted)", marginBottom: 6 }}>
            {iss.severity === "error" ? "error" : iss.severity === "warn" ? "warning" : "tip"}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>{iss.msg}</div>
          {iss.action && (
            <button className="btn ghost sm" style={{ marginTop: 8, fontSize: 11 }} onClick={() => applyAction(iss)}>Apply <span className="ar">→</span></button>
          )}
        </div>
      ))}
    </div>
  );
}

function PlainSummary({ nodes, runOrder }) {
  if (!nodes.length) return <EmptyState text="Empty pipeline." />;
  const phrasing = {
    supply:  (c) => <>Shield <strong>{c.amount} {c.asset}</strong> as collateral, encrypted client-side.</>,
    borrow:  (c) => <>Borrow <strong>{c.amount} {c.asset}</strong> at <strong>{c.ltv}%</strong> LTV. Ratio checked on ciphertext.</>,
    swap:    (c) => <>Swap encrypted <strong>{c.from}</strong> for <strong>{c.to}</strong> with {c.slip}% slippage.</>,
    repeat:  (c) => <>Repeat previous steps <strong>{c.loops}×</strong>, compounding the position.</>,
    settle:  ()  => <>Grant your wallet permission to decrypt every touched balance. Pipeline ends.</>,
  };
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {runOrder.map((id, i) => {
        const n = nodes.find(n => n.id === id);
        if (!n) return null;
        const t = NODE_TYPES[n.type];
        return (
          <li key={id} style={{
            display: "grid", gridTemplateColumns: "20px auto 1fr", gap: 10, alignItems: "baseline",
            padding: "10px 0", borderTop: i === 0 ? "0" : "1px dashed var(--hairline-2)",
          }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{String(i+1).padStart(2,"0")}</span>
            <span style={{ width: 8, height: 8, background: t.swatch, display: "inline-block", marginTop: 4 }} />
            <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>{phrasing[n.type]?.(n.config) || t.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function EmptyState({ text }) {
  return <div className="mono" style={{ fontSize: 12, color: "var(--muted)", padding: 12, textAlign: "center" }}>{text}</div>;
}

function Field({ label, hint, children }) {
  return (
    <div className="stack-2">
      <span className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 0.08, textTransform: "uppercase" }}>{label}</span>
      {children}
      {hint && <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.45 }}>{hint}</span>}
    </div>
  );
}

function TextInput({ value, suffix, onChange, readOnly }) {
  return (
    <div className="row" style={{ gap: 8, border: "1px solid var(--hairline)", padding: "7px 10px", background: readOnly ? "var(--paper-2)" : "var(--paper)" }}>
      <input
        value={value} onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
        style={{ border: 0, outline: "none", background: "transparent", fontFamily: "var(--mono)", fontSize: 13, flex: 1, color: "var(--ink)", minWidth: 0 }}
      />
      {suffix && <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{suffix}</span>}
    </div>
  );
}

function Select({ value, options, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "7px 10px",
        border: "1px solid var(--hairline)", background: "var(--paper)", color: "var(--ink)",
        fontFamily: "var(--mono)", fontSize: 13,
      }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Slider({ value, min, max, liq, onChange }) {
  return (
    <div className="stack-2">
      <div className="spread">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)}
               style={{ width: "100%", accentColor: "var(--ink)" }} />
        <span className="mono" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", marginLeft: 8, flex: "0 0 auto" }}>{value}{max === 8 ? "×" : "%"}</span>
      </div>
      {liq && (
        <div className="meter">
          <div className="fill" style={{ width: (value / max) * 100 + "%", background: value > liq * 0.85 ? "var(--accent)" : "var(--ink)" }} />
          <div className="tick danger" style={{ left: (liq / max) * 100 + "%" }} />
        </div>
      )}
    </div>
  );
}

/* ─── Deploy toast (success or error) ─── */
function DeployToast({ result, onClose, onRetry }) {
  useEffectB(() => {
    if (!result.ok) return; // only auto-dismiss success
    const id = setTimeout(onClose, 6000);
    return () => clearTimeout(id);
  }, [onClose, result.ok]);
  return (
    <div style={{
      position: "absolute", left: "50%", bottom: 18, transform: "translateX(-50%)",
      zIndex: 12,
      background: result.ok ? "var(--ink)" : "var(--danger-soft)",
      color: result.ok ? "var(--paper)" : "var(--danger)",
      border: result.ok ? "1px solid var(--ink)" : "1px solid var(--danger)",
      padding: "12px 18px",
      boxShadow: result.ok
        ? "5px 5px 0 0 var(--accent-ink)"
        : "5px 5px 0 0 var(--danger)",
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      maxWidth: "calc(100% - 36px)",
      animation: "toastIn 320ms var(--ease-out) forwards",
    }}>
      <style>{`
        @keyframes toastIn {
          from { transform: translateX(-50%) translateY(10px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `}</style>
      {result.ok ? (
        <>
          <Tag tone="positive">deployed</Tag>
          <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            <span className="mono" style={{ fontSize: 11, opacity: 0.8 }}>tx {result.tx}</span>
            <span style={{ margin: "0 6px" }}>·</span>
            block #{result.block.toLocaleString()}
          </span>
          <button onClick={onClose} className="mono" style={{
            border: "1px solid currentColor", background: "transparent", color: "inherit",
            padding: "3px 9px", fontSize: 11, cursor: "pointer", letterSpacing: 0.06,
            opacity: 0.85,
          }}>Dismiss</button>
        </>
      ) : (
        <>
          <Tag tone="danger">reverted</Tag>
          <span style={{ fontSize: 13, color: "var(--danger)" }}>{result.msg}</span>
          <button onClick={onRetry} className="btn sm" style={{
            background: "var(--danger)", borderColor: "var(--danger)", color: "var(--paper)",
          }}>Retry <span className="ar">→</span></button>
          <button onClick={onClose} style={{
            border: "1px solid var(--danger)", background: "transparent", color: "var(--danger)",
            padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "var(--mono)",
          }}>Dismiss</button>
        </>
      )}
    </div>
  );
}

Object.assign(window, {
  BuilderWorkspace, TEMPLATES, NODE_TYPES, walkOrder, detectIssues, organizeLayout, DEFAULT_CONFIG,
});

/* ─── Keyboard cheatsheet overlay ─── */
function KeyboardCheatsheet({ onClose }) {
  const SHORTCUTS = [
    ["Canvas", [
      ["F",            "toggle fullscreen canvas"],
      ["I",            "toggle config panel"],
      ["⌘B",           "toggle list rail"],
      ["⌘+wheel",      "zoom around cursor"],
      ["+ / -",        "zoom in / out"],
      ["⌘0",           "reset zoom"],
      ["Shift+1",      "zoom to fit all"],
      ["Shift+2",      "zoom to selection"],
      ["Space+drag",   "pan canvas (Figma-style)"],
      ["Shift+drag",   "pan canvas"],
      ["H",            "toggle hand tool"],
      ["V",            "move / select tool"],
    ]],
    ["Editing", [
      ["1–5",          "drop Supply / Borrow / Swap / Repeat / Settle"],
      ["Tab / ⇧Tab",   "cycle node selection"],
      ["Arrows",       "nudge selected node"],
      ["⇧Arrows",      "nudge 8×"],
      ["⌘+click",      "add to multi-select"],
      ["⌘A",           "select all nodes"],
      ["⌘D",           "duplicate selected"],
      ["⌘C / ⌘V",     "copy / paste"],
      ["⌫ / Del",      "delete selected"],
      ["⌘Z / ⌘⇧Z",     "undo / redo"],
      ["R",            "reset selection"],
      ["O",            "organize layout"],
    ]],
    ["Workflow", [
      ["S",            "simulate strategy"],
      ["⌘+ / ⌘-",     "zoom in / out"],
      ["Esc",          "cancel pending / exit fullscreen"],
      ["?",            "show this overlay"],
    ]],
  ];
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 90,
      background: "color-mix(in oklch, var(--ink) 50%, transparent)",
      display: "grid", placeItems: "center",
      padding: 24,
      animation: "fadeIn 200ms var(--ease) forwards",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--paper)",
        border: "1px solid var(--ink)",
        boxShadow: "6px 6px 0 0 var(--ink)",
        padding: 28,
        width: "min(560px, 100%)",
      }}>
        <div className="spread" style={{ marginBottom: 18 }}>
          <h3 className="serif" style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Keyboard shortcuts</h3>
          <button onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>Esc</button>
        </div>
        {SHORTCUTS.map(([group, list]) => (
          <div key={group} style={{ marginBottom: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>{group}</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px" }}>
              {list.map(([key, desc]) => (
                <React.Fragment key={key}>
                  <kbd style={{
                    fontFamily: "var(--mono)", fontSize: 11,
                    padding: "2px 7px", border: "1px solid var(--hairline)",
                    background: "var(--paper-2)", color: "var(--ink)",
                    minWidth: 64, textAlign: "center",
                  }}>{key}</kbd>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{desc}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.KeyboardCheatsheet = KeyboardCheatsheet;

/* ─── IssueToast: transient ─── */
function IssueToast({ text }) {
  return (
    <div style={{
      position: "absolute", left: "50%", top: 76, transform: "translateX(-50%)",
      zIndex: 7,
      padding: "8px 14px",
      background: "var(--ink)",
      color: "var(--paper)",
      fontFamily: "var(--mono)", fontSize: 11, letterSpacing: 0.06,
      textTransform: "uppercase",
      boxShadow: "3px 3px 0 0 var(--accent-ink)",
      animation: "issueToastIn 240ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
    }}>
      <style>{`
        @keyframes issueToastIn {
          from { transform: translateX(-50%) translateY(-8px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `}</style>
      {text}
    </div>
  );
}

/* ─── AutoFixModal: backdrop blur + before/after ─── */
function AutoFixModal({ issue, onConfirm, onCancel }) {
  const explain = {
    "merge-swaps": {
      what: "Combine consecutive Swap intents into one router call.",
      why: "Each Swap calls submitSwapIntent(). Two in a row pay the call cost twice.",
      saves: `≈${(issue.action.pairs.length * 196).toLocaleString()}k gas`,
      tradeoff: "A single fill failure now fails both swaps atomically. The original tolerates partial fills.",
    },
  };
  const info = explain[issue.action?.kind] || { what: issue.msg, why: "", saves: "", tradeoff: "" };
  return (
    <div onClick={onCancel} style={{
      position: "absolute", inset: 0, zIndex: 8,
      backdropFilter: "blur(8px)",
      background: "color-mix(in oklch, var(--ink) 30%, transparent)",
      display: "grid", placeItems: "center",
      animation: "fadeIn 200ms var(--ease) forwards",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--paper)",
        border: "1px solid var(--ink)",
        boxShadow: "6px 6px 0 0 var(--ink)",
        padding: 24,
        width: "min(520px, 90%)",
      }}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <Tag tone="accent">auto-fix</Tag>
          <button onClick={onCancel} style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer" }}>✕</button>
        </div>
        <h3 className="serif" style={{ fontSize: 20, fontWeight: 500, margin: "0 0 8px 0" }}>{info.what}</h3>
        {info.why && <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, margin: "0 0 14px 0" }}>{info.why}</p>}
        <div style={{ background: "var(--paper-2)", border: "1px solid var(--hairline)", padding: 14, marginBottom: 14 }}>
          {info.saves && <div className="kv"><span className="k">saves</span><span className="v" style={{ color: "var(--positive)" }}>{info.saves}</span></div>}
          {info.tradeoff && <div className="kv"><span className="k">tradeoff</span><span className="v" style={{ whiteSpace: "normal", fontSize: 12, color: "var(--muted)", textAlign: "right" }}>{info.tradeoff}</span></div>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={onCancel} style={{ flex: 1 }}>Keep original</button>
          <button className="btn sm" onClick={onConfirm} style={{ flex: 1 }}>Apply fix <span className="ar">→</span></button>
        </div>
      </div>
    </div>
  );
}

window.IssueToast = IssueToast;
window.AutoFixModal = AutoFixModal;

/* ─── ToolbarOverflow: a compact ⋯ menu ─── */
function ToolbarOverflow({ fullscreen, setFullscreen, showInspector, setShowInspector, onShowCheat }) {
  const [open, setOpen] = useStateB(false);
  const ref = useRefB(null);
  useEffectB(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative" }}>
      <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} title="More" aria-label="More actions">⋯</button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 20,
          background: "var(--paper)", border: "1px solid var(--ink)",
          boxShadow: "3px 3px 0 0 var(--ink)",
          padding: 4, minWidth: 180,
          display: "flex", flexDirection: "column", gap: 1,
        }}>
          {[
            { label: fullscreen ? "Exit fullscreen" : "Fullscreen canvas", kbd: "F", fn: () => { setFullscreen(f => !f); setOpen(false); } },
            { label: "Keyboard shortcuts", kbd: "?", fn: () => { onShowCheat(); setOpen(false); } },
          ].map(item => (
            <button key={item.label} onClick={item.fn} style={{
              border: 0, background: "transparent",
              padding: "7px 10px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              gap: 18, fontSize: 12, color: "var(--ink)",
              cursor: "pointer", textAlign: "left",
              transition: "background-color var(--t-feedback) var(--ease)",
            }} onMouseEnter={(e) => e.currentTarget.style.background = "var(--paper-2)"}
               onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <span>{item.label}</span>
              <kbd style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)" }}>{item.kbd}</kbd>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
window.ToolbarOverflow = ToolbarOverflow;

/* ─── SuggestionPill: ghosted "+ [next-type]" near an orphan node ─── */
function SuggestionPill({ x, y, label, onAccept }) {
  return (
    <button
      onClick={onAccept}
      style={{
        position: "absolute", left: x, top: y, zIndex: 3,
        padding: "3px 8px",
        background: "var(--paper)",
        border: "1px dashed var(--muted-2)",
        color: "var(--muted)",
        fontFamily: "var(--mono)", fontSize: 10,
        letterSpacing: 0.06, textTransform: "uppercase",
        cursor: "pointer",
        opacity: 0.65,
        transition: "opacity var(--t-feedback) var(--ease), background-color var(--t-feedback) var(--ease), color var(--t-feedback) var(--ease), border-color var(--t-feedback) var(--ease)",
        animation: "suggestPulse 2.2s var(--ease) infinite",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.background = "var(--accent-soft)";
        e.currentTarget.style.color = "var(--accent-ink)";
        e.currentTarget.style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "0.65";
        e.currentTarget.style.background = "var(--paper)";
        e.currentTarget.style.color = "var(--muted)";
        e.currentTarget.style.borderColor = "var(--muted-2)";
      }}
      title={`Add a ${label} node, connect from here`}
    >
      + {label}
      <style>{`
        @keyframes suggestPulse {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(2px); }
        }
      `}</style>
    </button>
  );
}
window.SuggestionPill = SuggestionPill;

/* ─── EdgePopover: shown when a line is selected ─── */
function EdgePopover({ x, y, from, to, onDelete, onClose }) {
  const fromT = NODE_TYPES[from.type];
  const toT   = NODE_TYPES[to.type];
  const dataLabel = from.type === "supply"  ? `${from.config.asset} collateral`
                  : from.type === "borrow"  ? `${from.config.asset} debt`
                  : from.type === "swap"    ? `${from.config.from}→${from.config.to}`
                  : from.type === "repeat"  ? `loop ×${from.config.loops}`
                  : "control flow";
  const gas = from.type === "borrow" ? 448 : from.type === "swap" ? 196 : from.type === "settle" ? 22 : 312;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: x - 130, top: y + 18,
        zIndex: 5, width: 260,
        background: "var(--paper)",
        border: "1px solid var(--ink)",
        boxShadow: "3px 3px 0 0 var(--accent-ink)",
        padding: 14,
        animation: "fadeIn 200ms var(--ease) forwards",
      }}
    >
      <div className="spread" style={{ marginBottom: 10 }}>
        <Tag tone="accent">link</Tag>
        <button onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}>esc</button>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <span style={{ width: 6, height: 6, background: fromT.swatch, display: "inline-block" }} />
        <span style={{ fontSize: 13 }}>{fromT.label}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>→</span>
        <span style={{ width: 6, height: 6, background: toT.swatch, display: "inline-block" }} />
        <span style={{ fontSize: 13 }}>{toT.label}</span>
      </div>
      <div className="kv"><span className="k">flows</span><span className="v">{dataLabel}</span></div>
      <div className="kv"><span className="k">est. gas</span><span className="v">≈ {gas}k</span></div>
      <div className="row" style={{ gap: 6, marginTop: 12 }}>
        <button className="btn ghost sm" style={{ flex: 1, color: "var(--danger)", borderColor: "var(--danger)" }} onClick={onDelete}>
          Delete link
        </button>
      </div>
    </div>
  );
}
window.EdgePopover = EdgePopover;

/* ─── IssuePin: floating annotation near a problematic node ─── */
function IssuePin({ x, y, severity, msg, onApply }) {
  const [open, setOpen] = useStateB(false);
  // All severities now use the accent palette — no alarm red
  const color = severity === "error" ? "var(--accent-ink)" : "var(--accent)";
  const bg    = "var(--accent-soft)";
  return (
    <span
      style={{ position: "absolute", left: x, top: y, zIndex: 4 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 18, height: 18, borderRadius: 50,
          background: color, color: "var(--paper)",
          border: 0, cursor: "pointer",
          fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700,
          display: "grid", placeItems: "center",
          boxShadow: "1px 1px 0 0 var(--ink)",
          animation: "issuePinPulse 1.6s var(--ease) infinite",
        }}
        title={msg}
      >
        {severity === "error" ? "!" : "?"}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: 24, left: -120,
          width: 260, padding: 12,
          background: bg, border: "1px solid " + color,
          boxShadow: "2px 2px 0 0 var(--ink)",
          animation: "fadeIn 200ms var(--ease) forwards",
        }}>
          <div className="mono" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.1, color, marginBottom: 4 }}>
            {severity}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--ink-2)" }}>{msg}</div>
          {onApply && (
            <button className="btn ghost sm" style={{ marginTop: 8, fontSize: 11, width: "100%" }} onClick={onApply}>
              Auto-fix <span className="ar">→</span>
            </button>
          )}
        </div>
      )}
      <style>{`
        @keyframes issuePinPulse {
          0%, 100% { box-shadow: 1px 1px 0 0 var(--ink); }
          50%      { box-shadow: 1px 1px 0 0 var(--ink), 0 0 0 4px color-mix(in oklch, ${color === "var(--danger)" ? "var(--danger)" : "var(--accent)"} 40%, transparent); }
        }
      `}</style>
    </span>
  );
}
window.IssuePin = IssuePin;

/* ─── DeployProgressModal: progressive contract-call walkthrough ─── */
function DeployProgressModal({ nodes, runOrder, onComplete, onCancel }) {
  const [step, setStep] = useStateB(0);
  const [status, setStatus] = useStateB("running"); // running | done | failed
  const [txResults, setTxResults] = useStateB([]);
  const [errorMsg, setErrorMsg] = useStateB(null);
  const stepsCount = Math.max(1, runOrder.length);
  const cancelledRef = useRefB(false);

  useEffectB(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  useEffectB(() => {
    if (status !== "running" || cancelledRef.current) return;

    if (step >= stepsCount) {
      // All steps complete — gather results
      const lastTx = txResults[txResults.length - 1];
      setStatus("done");
      onComplete({ ok: true, tx: lastTx?.txHash || "confirmed", block: lastTx?.block || 0, results: txResults });
      return;
    }

    const nodeId = runOrder[step];
    const node = nodes.find(n => n.id === nodeId);
    if (!node) { setStep(s => s + 1); return; }

    let cancelled = false;
    (async () => {
      try {
        const bridge = typeof window !== "undefined" ? window.bridge : null;
        if (!bridge?.contract?.write) throw new Error("Bridge not ready");

        const ctx = typeof window !== "undefined" ? window.__forgeCtx : null;
        const account = ctx?.address;
        const tokenMap = {};
        if (bridge?.data?.markets) {
          bridge.data.markets.forEach(m => { if (m.asset && m.assetAddress) tokenMap[m.asset] = m.assetAddress; });
        }
        const cfg = node.config || {};
        const tokenAddr = tokenMap[cfg.asset] || tokenMap[cfg.from] || Object.values(tokenMap)[0];
        const amount = parseAmountBW(cfg.amount || "0");
        let result = null;

        if (node.type === "supply" && amount > 0n) {
          const tx1 = await bridge.contract.write.shieldCommit(tokenAddr, amount, account);
          if (tx1.status === "reverted") throw new Error("Supply commit reverted");
          const tx2 = await bridge.contract.write.shieldExecute(tokenAddr, tx1.commitId, account);
          if (tx2.status === "reverted") throw new Error("Supply execute reverted");
          result = { txHash: tx2.txHash, block: tx2.block };
        } else if (node.type === "borrow" && amount > 0n) {
          const tx1 = await bridge.contract.write.borrowCommit(tokenAddr, amount, BigInt(cfg.ltv || 50), 100n, account);
          if (tx1.status === "reverted") throw new Error("Borrow commit reverted");
          const tx2 = await bridge.contract.write.borrowExecute(tx1.commitId, account);
          if (tx2.status === "reverted") throw new Error("Borrow execute reverted");
          result = { txHash: tx2.txHash, block: tx2.block };
        } else if (node.type === "swap" && amount > 0n) {
          const tokenOut = tokenMap[cfg.to] || Object.values(tokenMap)[0];
          const slipBps = Math.round((cfg.slip || 0.5) * 100);
          const minOut = amount * BigInt(10000 - slipBps) / 10000n;
          const tx = await bridge.contract.write.submitSwapIntent(tokenAddr, tokenOut, amount, minOut, 300n, account);
          result = { txHash: tx.txHash, block: tx.block };
        } else {
          result = { txHash: "skipped", block: 0 };
        }

        if (cancelled || cancelledRef.current) return;
        setTxResults(prev => [...prev, result]);
        setStep(s => s + 1);
      } catch (e) {
        if (cancelled || cancelledRef.current) return;
        setStatus("failed");
        setErrorMsg(e.message || "Transaction failed");
        onComplete({ ok: false, msg: e.message || "Transaction failed" });
      }
    })();

    return () => { cancelled = true; };
  }, [step, status, stepsCount, runOrder, nodes, onComplete, txResults]);

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 9,
      backdropFilter: "blur(8px)",
      background: "color-mix(in oklch, var(--ink) 40%, transparent)",
      display: "grid", placeItems: "center",
      animation: "fadeIn 240ms var(--ease) forwards",
    }}>
      <div style={{
        background: "var(--paper)",
        border: "1px solid var(--ink)",
        boxShadow: "6px 6px 0 0 var(--ink)",
        padding: 28, width: "min(560px, 92%)",
      }}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <Tag tone={status === "failed" ? "danger" : status === "done" ? "positive" : "accent"}>
            {status === "failed" ? "reverted" : status === "done" ? "confirmed" : "signing"}
          </Tag>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
            step {Math.min(step + 1, stepsCount)} / {stepsCount}
          </span>
        </div>
        <h3 className="serif" style={{ fontSize: 18, fontWeight: 500, margin: "0 0 16px 0" }}>Composer call</h3>
        {errorMsg && (
          <div style={{ padding: "8px 12px", marginBottom: 12, border: "1px solid var(--danger)", color: "var(--danger)", fontSize: 12 }}>
            {errorMsg}
          </div>
        )}
        <ol style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 320, overflowY: "auto" }}>
          {runOrder.map((id, i) => {
            const n = nodes.find(x => x.id === id);
            if (!n) return null;
            const t = NODE_TYPES[n.type];
            const done = i < step;
            const active = i === step && status === "running";
            const failed = i === step && status === "failed";
            const txResult = txResults[i];
            return (
              <li key={id} style={{
                display: "grid", gridTemplateColumns: "26px auto 1fr auto", gap: 10, alignItems: "center",
                padding: "8px 0",
                borderTop: i === 0 ? 0 : "1px dashed var(--hairline-2)",
                opacity: done ? 1 : active || failed ? 1 : 0.45,
              }}>
                <span className="mono" style={{ fontSize: 11, color: done ? "var(--positive)" : failed ? "var(--danger)" : active ? "var(--accent-ink)" : "var(--muted)" }}>
                  {done ? "✓" : failed ? "✗" : active ? "···" : String(i+1).padStart(2,"0")}
                </span>
                <span style={{ width: 8, height: 8, background: failed ? "var(--danger)" : t.swatch, display: "inline-block" }} />
                <span style={{ fontSize: 13 }}>{t.label}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                  {done && txResult?.txHash && txResult.txHash !== "skipped"
                    ? txResult.txHash.slice(0, 10) + "…"
                    : n.type === "borrow" ? "448k" : n.type === "swap" ? "196k" : n.type === "settle" ? "22k" : "312k"} gas
                </span>
              </li>
            );
          })}
        </ol>
        {(status === "running" || status === "failed") && (
          <div className="row" style={{ gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
            <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
window.DeployProgressModal = DeployProgressModal;
