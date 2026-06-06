// screens/lending.jsx · Lend (v4, master-detail)
// Left: bridge markets + my position summary.
// Right: action panel for the selected market.

const { useState: useStateL, useEffect: useEffectL } = React;
const EMPTY_BRIDGE_CONTEXT_L = React.createContext({ data: {}, meta: { errors: [] } });

function useOptionalBridgeL() {
  const bridgeContext = typeof window !== "undefined" ? window.BridgeContext : null;
  return React.useContext(bridgeContext || EMPTY_BRIDGE_CONTEXT_L);
}

function getBridgeStatusL(bridge, key, fallback) {
  const meta = (bridge && bridge.meta) || {};
  const data = (bridge && bridge.data) || {};
  const readiness = meta.readiness || bridge.readiness || data.readiness || {};
  const entry = readiness[key] || readiness[String(key).replace(/s$/, "")] || null;
  if (entry) {
    const status = String(entry.status || entry.state || "").toLowerCase();
    const reason = String(entry.reason || entry.message || "");
    if (status === "ready" || status === "ok" || status === "available") return null;
    if (reason) return classifyBridgeStatusL(reason, fallback);
    if (status) return classifyBridgeStatusL(status, fallback);
  }
  const errors = Array.isArray(meta.errors) ? meta.errors : [];
  const error = errors.slice().reverse().find((err) => {
    const source = String(err && err.source || "").toLowerCase();
    const message = String(err && (err.message || (err.error && err.error.message)) || "").toLowerCase();
    return source.includes(key) || message.includes(key) || message.includes("registry") || message.includes("rpc");
  });
  return error ? classifyBridgeStatusL(String(error.message || (error.error && error.error.message) || error), fallback) : fallback;
}

function classifyBridgeStatusL(message, fallback) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("registry")) return "registry unavailable";
  if (lower.includes("rpc") || lower.includes("viem") || lower.includes("contract") || lower.includes("on-chain")) return "RPC unavailable";
  if (lower.includes("backend") || lower.includes("api") || lower.includes("fetch") || lower.includes("network") || lower.includes("request")) return "backend unavailable";
  return fallback || "bridge unavailable";
}

function getMarketAssetL(market) {
  return market && (market.asset || market.symbol || market.token || market.name);
}

function normalizeMarketL(market) {
  const asset = getMarketAssetL(market) || "–";
  const utilization = market.util ?? market.utilization ?? 0;
  const liq = market.liq ?? market.liquidationThreshold ?? 80;
  return {
    asset,
    assetAddress: market.assetAddress || null,
    supplyApy: market.supplyApy ?? market.supplyAPY ?? market.depositApy ?? market.depositAPY ?? 0,
    borrowApy: market.borrowApy ?? market.borrowAPY ?? 0,
    util: utilization > 0 && utilization <= 1 ? Math.round(utilization * 100) : Math.round(utilization),
    tvl: market.tvl ?? market.totalSupply ?? "unavailable",
    liq: liq > 0 && liq <= 1 ? Math.round(liq * 100) : Math.round(liq),
    oracle: market.oracle || market.oracleSource || (market.oraclePrice != null ? "on-chain" : "unavailable"),
    price: market.price || market.oraclePrice || "unavailable",
    healthAfterSupply: market.healthAfterSupply,
    healthAfterBorrow: market.healthAfterBorrow,
    liqPrice: market.liqPrice || market.liquidationPrice,
    estimatedGas: market.estimatedGas,
    updatedAt: market.updatedAt || market.oracleUpdatedAt,
  };
}

function getBridgePositionItemsL(positions) {
  if (Array.isArray(positions)) return positions;
  if (positions && Array.isArray(positions.items)) return positions.items;
  return [];
}

function parseNumberL(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatAmountL(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(value);
}

function sumPositionsL(items, side) {
  return items.reduce((sum, item) => {
    if (item.side !== side) return sum;
    const n = parseNumberL(item.amountUsd ?? item.amount ?? item.value);
    return n == null ? sum : sum + n;
  }, 0);
}

function getPositionSummaryL(bridgeData) {
  const positions = bridgeData.positions;
  const items = getBridgePositionItemsL(positions);
  const status = positions && positions.status ? positions.status : (positions == null ? "loading" : "empty");
  const supplied = sumPositionsL(items, "supply");
  const borrowed = sumPositionsL(items, "borrow");
  const ltvRaw = bridgeData.walletBalance && (bridgeData.walletBalance.portfolioLTV ?? bridgeData.walletBalance.ltvGaugeValue);
  const ltv = parseNumberL(ltvRaw);
  const fallback = status === "empty" ? "no position" : status;
  return {
    suppliedLabel: supplied > 0 ? formatAmountL(supplied, fallback) : fallback,
    borrowedLabel: borrowed > 0 ? formatAmountL(borrowed, fallback) : fallback,
    ltvLabel: ltv != null ? `${ltv}%` : fallback,
    ltvGauge: ltv != null ? ltv : 0,
    walletBalance: bridgeData.walletBalance || null,
  };
}


function Lending({ setRoute, ctx, grantPermit, openConnect }) {
  const [faucetResult, setFaucetResult] = useStateL(null);
  const [liqTargets, setLiqTargets] = useStateL(null);
  const [liqTargetsStatus, setLiqTargetsStatus] = useStateL("loading");
  const [liqResult, setLiqResult] = useStateL(null);
  const [liqSubmitting, setLiqSubmitting] = useStateL(false);

  // Fetch liquidation targets on mount
  useEffectL(() => {
    let cancelled = false;
    async function fetchLiqTargets() {
      try {
        const base = (typeof window !== "undefined" && window.__API_BASE) || "http://localhost:3001";
        const res = await fetch(`${base}/lending/positions/liquidation-targets`, { method: "POST", headers: { "Content-Type": "application/json" } });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setLiqTargets(Array.isArray(data) ? data : (data.targets || data.positions || []));
          setLiqTargetsStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setLiqTargets([]);
          setLiqTargetsStatus("unavailable");
        }
      }
    }
    fetchLiqTargets();
    return () => { cancelled = true; };
  }, []);

  async function handleLiquidate(target) {
    if (liqSubmitting) return;
    if (!ctx.connected) { openConnect(); return; }
    setLiqSubmitting(true);
    setLiqResult(null);
    try {
      const bridge = typeof window !== "undefined" ? window.bridge : null;
      if (!bridge?.contract) { setLiqResult({ type: "error", message: "bridge unavailable" }); return; }

      const { borrower, collateralToken, debtToken, debtToCover, debtHandle, supplyHandle } = target;
      if (!borrower || !collateralToken || !debtToken) {
        setLiqResult({ type: "error", message: "missing target data" });
        return;
      }

      // Default to max liquidation if no amount specified
      const amount = debtToCover ? BigInt(debtToCover) : 0n;
      if (amount <= 0n && !debtHandle) {
        setLiqResult({ type: "error", message: "no repay amount or encrypted handles available" });
        return;
      }

      setLiqResult({ type: "info", message: "decrypting balances…" });
      const tx = await bridge.contract.write.liquidateWithProof(
        borrower, collateralToken, debtToken, amount,
        debtHandle || "0x", supplyHandle || "0x", ctx.address
      );
      if (tx.status === "reverted") {
        setLiqResult({ type: "error", message: "liquidation reverted" });
      } else {
        setLiqResult({ type: "success", message: `liquidated · tx ${tx.hash}` });
      }
    } catch (err) {
      setLiqResult({ type: "error", message: err?.message || "liquidation failed" });
    } finally {
      setLiqSubmitting(false);
    }
    setTimeout(() => setLiqResult(null), 10000);
  }

  async function handleFaucetDrip(tokenAddress, e) {
    if (e) e.stopPropagation();
    if (!ctx.connected) { openConnect(); return; }
    setFaucetResult(null);
    try {
      const { createWalletClient, custom } = await import("viem");
      const { arbitrumSepolia } = await import("viem/chains");
      const walletClient = createWalletClient({ chain: arbitrumSepolia, transport: custom(window.ethereum) });
      const [account] = await walletClient.getAddresses();
      const hash = await walletClient.writeContract({
        address: tokenAddress,
        abi: [{ type: "function", name: "faucetMint", inputs: [], outputs: [], stateMutability: "nonpayable" }],
        functionName: "faucetMint",
        account,
      });
      setFaucetResult({ type: "success", message: "Tokens minted! tx: " + hash });
    } catch (err) {
      setFaucetResult({ type: "error", message: err?.shortMessage || err?.message || "Faucet failed" });
    }
    setTimeout(() => setFaucetResult(null), 8000);
  }
  const bridge = useOptionalBridgeL();
  const bridgeData = bridge.data || {};
  const markets = Array.isArray(bridgeData.markets) ? bridgeData.markets.map(normalizeMarketL) : null;
  const marketStatus = getBridgeStatusL(bridge, "markets", "loading bridge markets");
  const locked = !ctx.permitUnlocked;
  const [assetId, setAssetId] = useStateL("USDC");
  const [side, setSide] = useStateL("supply");
  const [amount, setAmount] = useStateL("");
  const [ltv, setLtv] = useStateL(45);
  const market = markets && markets.length ? (markets.find(m => m.asset === assetId) || markets[0]) : null;
  const positionSummary = getPositionSummaryL(bridgeData);

  useEffectL(() => {
    if (market && market.asset !== assetId) setAssetId(market.asset);
  }, [market && market.asset, assetId]);

  return (
    <MasterDetail
      collapseKey="lend"
      listHeader={
        <>
          <span className="eyebrow">Lend</span>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{markets ? `${markets.length} markets · public totals only` : `markets · ${marketStatus}`}</span>
          </div>
        </>
      }
      listBody={
        <>
          <MDGroup>Your position</MDGroup>
          <div style={{ padding: "12px 20px", borderBottom: "1px dashed var(--hairline-2)" }}>
            <div className="kv"><span className="k">net supplied</span><span className="v"><Cipher value={positionSummary.suppliedLabel} locked={locked} size="sm" inline /></span></div>
            <div className="kv"><span className="k">net borrowed</span><span className="v"><Cipher value={positionSummary.borrowedLabel} locked={locked} size="sm" inline /></span></div>
            <div className="kv"><span className="k">ltv · weighted</span><span className="v">{positionSummary.ltvLabel}</span></div>
            <div style={{ marginTop: 10 }}>
              <LtvGauge ltv={positionSummary.ltvGauge} liqAt={80} labels={false} height={6} />
            </div>
          </div>

          {faucetResult && (
            <div
              role={faucetResult.type === "error" ? "alert" : "status"}
              aria-live="polite"
              style={{
                margin: "0 20px",
                padding: "10px 12px",
                background: faucetResult.type === "error" ? "var(--danger-soft, #2a0a0a)" : "var(--success-soft, #0a2a1a)",
                border: "1px solid " + (faucetResult.type === "error" ? "var(--destructive)" : "var(--success)"),
                color: faucetResult.type === "error" ? "var(--destructive)" : "var(--success)",
                fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.55,
                wordBreak: "break-all",
              }}
            >
              <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>
                {faucetResult.type === "error" ? "Faucet failed" : "Faucet"}
              </strong> · {faucetResult.message}
            </div>
          )}

          <MDGroup>Markets · {markets ? markets.length : "loading"}</MDGroup>
          {!markets ? (
            <div className="mono" style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11 }}>
              {marketStatus}
            </div>
          ) : markets.length === 0 ? (
            <div className="mono" style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11 }}>
              no markets available
            </div>
          ) : markets.map((m, i) => (
            <MDItem
              key={m.asset}
              idx={
                <span style={{ display: "inline-flex" }}>
                  <AssetGlyph sym={m.asset} size={20} />
                </span>
              }
              title={m.asset}
              sub={`util ${m.util}% · TVL ${m.tvl}`}
              right={
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--positive)" }}>+{m.supplyApy}%</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--danger)" }}>−{m.borrowApy}%</span>
                  {m.assetAddress && ctx.connected && (
                    <button
                      className="btn ghost sm"
                      style={{ padding: "2px 6px", fontSize: 9, letterSpacing: 0.06, textTransform: "uppercase", marginTop: 2 }}
                      onClick={(e) => handleFaucetDrip(m.assetAddress, e)}
                      data-testid="drip-button"
                    >Drip</button>
                  )}
                  {i === 0 && ctx.connected && (
                    <a
                      href="https://faucets.chain.link/arbitrum-sepolia"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn ghost sm"
                      style={{ padding: "2px 6px", fontSize: 9, letterSpacing: 0.06, textTransform: "uppercase", marginTop: 2, textDecoration: "none" }}
                      data-testid="eth-faucet-link"
                    >Get ETH ↗</a>
                  )}
                </div>
              }
              selected={assetId === m.asset}
              onClick={() => setAssetId(m.asset)}
            />
          ))}

          {/* ── Liquidation targets ── */}
          {ctx.connected && (
            <>
              <MDGroup>Liquidation targets</MDGroup>
              {liqResult && (
                <div
                  role={liqResult.type === "error" ? "alert" : "status"}
                  aria-live="polite"
                  style={{
                    margin: "0 20px",
                    padding: "10px 12px",
                    background: liqResult.type === "error" ? "var(--danger-soft, #2a0a0a)" : liqResult.type === "success" ? "var(--success-soft, #0a2a1a)" : "var(--accent-soft, #0a1a2a)",
                    border: "1px solid " + (liqResult.type === "error" ? "var(--destructive)" : liqResult.type === "success" ? "var(--success)" : "var(--accent)"),
                    color: liqResult.type === "error" ? "var(--destructive)" : liqResult.type === "success" ? "var(--success)" : "var(--accent)",
                    fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.55,
                    wordBreak: "break-all",
                  }}
                >
                  <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>
                    {liqResult.type === "error" ? "Liquidation failed" : liqResult.type === "success" ? "Liquidated" : "Liquidating"}
                  </strong> · {liqResult.message}
                </div>
              )}
              {liqTargetsStatus === "loading" ? (
                <div className="mono" style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11 }}>
                  scanning positions…
                </div>
              ) : liqTargetsStatus === "unavailable" ? (
                <div className="mono" style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11 }}>
                  liquidation scanner unavailable
                </div>
              ) : !liqTargets || liqTargets.length === 0 ? (
                <div className="mono" style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11 }}>
                  no positions near liquidation
                </div>
              ) : liqTargets.map((t, idx) => {
                const borrower = t.borrower || t.user || t.address;
                const healthFactor = t.healthFactor ?? t.health_factor ?? t.hf;
                const collateral = t.collateralToken || t.collateralTokenAddress;
                const debt = t.debtToken || t.debtTokenAddress || t.borrowToken;
                const collSym = t.collateralSymbol || t.collateral || "–";
                const debtSym = t.debtSymbol || t.debt || "–";
                return (
                  <MDItem
                    key={borrower + "-" + idx}
                    idx={
                      <span className="mono" style={{ fontSize: 10, color: "var(--destructive)", letterSpacing: 0.06 }}>LIQ</span>
                    }
                    title={borrower ? borrower.slice(0, 6) + "…" + borrower.slice(-4) : "unknown"}
                    sub={`hf ${healthFactor != null ? Number(healthFactor).toFixed(2) : "–"} · ${collSym} → ${debtSym}`}
                    right={
                      <button
                        className="btn sm"
                        style={{ padding: "3px 8px", fontSize: 9, letterSpacing: 0.06, textTransform: "uppercase", background: "var(--destructive)", color: "#fff", border: 0 }}
                        onClick={(e) => { e.stopPropagation(); handleLiquidate(t); }}
                        disabled={liqSubmitting}
                        data-testid="liquidate-button"
                      >
                        {liqSubmitting ? "…" : "Liquidate"}
                      </button>
                    }
                    selected={false}
                    onClick={() => {}}
                  />
                );
              })}
            </>
          )}
        </>
      }
      detailHeader={
        market ? (
          <>
            <div className="row" style={{ gap: 14 }}>
              <AssetGlyph sym={market.asset} size={26} />
              <div>
                <h2 className="serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.012, margin: 0 }}>
                  {market.asset}
                </h2>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                  price {market.price} · oracle {market.oracle}
                </div>
              </div>
            </div>
            <div className="tabstrip" style={{ border: 0 }} role="tablist">
              {["supply", "borrow", "repay", "withdraw"].map(s => (
                <button key={s} className={"tab" + (side === s ? " active" : "")}
                  role="tab"
                  aria-selected={side === s}
                  aria-controls={`panel-${s}`}
                  onClick={() => setSide(s)}
                  data-testid={`tab-${s}`}>{s}</button>
              ))}
            </div>
          </>
        ) : (
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{marketStatus}</span>
        )
      }
      detailBody={
        market ? (
          <div role="tabpanel" id={`panel-${side}`}>
            <LendAction
              market={market} side={side} amount={amount} setAmount={setAmount}
              ltv={ltv} setLtv={setLtv}
              locked={locked} grantPermit={grantPermit} ctx={ctx} openConnect={openConnect}
              bridgeData={bridgeData} positionSummary={positionSummary}
              markets={markets}
            />
          </div>
        ) : (
          <div className="mono" style={{ padding: 20, color: "var(--muted)", fontSize: 12 }}>
            {!markets ? marketStatus : "no markets available"}
          </div>
        )
      }
    />
  );
}

function getDecimalsForAssetL(asset) {
  const sym = String(asset || "").toUpperCase();
  if (sym === "USDC" || sym === "USDT") return 6;
  if (sym === "WBTC" || sym === "PPGS") return 8;
  return 18;
}

function toWeiL(amountStr, asset) {
  const n = Number(String(amountStr || "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const decimals = getDecimalsForAssetL(asset);
  return BigInt(Math.round(n * 10 ** decimals));
}

function LendAction({ market, side, amount, setAmount, ltv, setLtv, locked, grantPermit, ctx, openConnect, bridgeData, positionSummary, markets }) {
  const apy = side === "supply" || side === "repay" ? market.supplyApy : market.borrowApy;
  const walletBalance = bridgeData && bridgeData.walletBalance;
  const walletValue = !ctx.connected ? "wallet required" : walletBalance && walletBalance.balance != null ? walletBalance.balance : "unavailable";
  const walletNumeric = parseNumberL(walletValue);
  const [crStep, setCrStep] = useStateL("idle"); // idle | committing | decrypting | executing | done | failed
  const [commitId, setCommitId] = useStateL(null);
  const [crError, setCrError] = useStateL(null);
  const [borrowAssetId, setBorrowAssetId] = useStateL(null);
  const [submitting, setSubmitting] = useStateL(false);

  async function handleSupply() {
    if (submitting) return;
    if (Number(amount) <= 0) { setCrStep("failed"); setCrError("Amount must be greater than 0"); return; }
    if (walletNumeric != null && Number(amount) > walletNumeric) {
      setCrStep("failed"); setCrError(`Insufficient ${market.asset} balance. Available: ${walletNumeric}`); return;
    }
    setSubmitting(true);
    try {
      if (!market.assetAddress) { setCrStep("failed"); setCrError("missing token address"); return; }
      const wei = toWeiL(amount, market.asset);
      if (!wei) { setCrStep("failed"); setCrError("invalid amount"); return; }
      const bridge = typeof window !== "undefined" ? window.bridge : null;
      if (!bridge?.contract) { setCrStep("failed"); setCrError("bridge unavailable"); return; }

      // Approval check
      const LENDING_POOL = "0x4ed64f1708139E31C4c48A19f285AD50dC68EB35";
      const allowance = await bridge.contract.read.erc20Allowance(market.assetAddress, ctx.address, LENDING_POOL);
      if (BigInt(allowance) < wei) {
        const approvalRes = await bridge.contract.write.erc20Approve(market.assetAddress, LENDING_POOL, ctx.address);
        if (approvalRes.status === "reverted") { setCrStep("failed"); setCrError("approval failed"); return; }
      }

      // TX1: Commit
      setCrStep("committing");
      try {
        const tx1 = await bridge.contract.write.shieldCommit(market.assetAddress, wei, ctx.address);
        if (tx1.status === "reverted") { setCrStep("failed"); setCrError("commit reverted"); return; }
        setCommitId(tx1.commitId);
        setCrStep("decrypting");

        // TX2: Execute (bridge internally calls decryptForExecute)
        setCrStep("executing");
        const tx2 = await bridge.contract.write.shieldExecute(market.assetAddress, tx1.commitId, tx1.ctHash, ctx.address);
        if (tx2.status === "reverted") { setCrStep("failed"); setCrError("execute reverted"); return; }
        setCrStep("done");
        window.__bridgeBus?.set("transaction:confirmed", {});
      } catch (e) {
        setCrStep("failed");
        setCrError(e.message || "transaction failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBorrow() {
    if (submitting) return;
    if (Number(amount) <= 0) { setCrStep("failed"); setCrError("Amount must be greater than 0"); return; }
    setSubmitting(true);
    try {
      if (!market.assetAddress) { setCrStep("failed"); setCrError("missing token address"); return; }
      const wei = toWeiL(amount, market.asset);
      if (!wei) { setCrStep("failed"); setCrError("invalid amount"); return; }
      const bridge = typeof window !== "undefined" ? window.bridge : null;
      if (!bridge?.contract) { setCrStep("failed"); setCrError("bridge unavailable"); return; }
      const borrowMarket = markets && markets.find(m => m.asset === (borrowAssetId || (markets.find(mm => mm.asset !== market.asset) || {}).asset));
      const borrowTokenAddr = borrowMarket ? borrowMarket.assetAddress : market.assetAddress;
      const ltvNum = BigInt(Math.round(ltv));
      const ltvDen = 100n;

      // TX1: Commit
      setCrStep("committing");
      try {
        const tx1 = await bridge.contract.write.borrowCommit(market.assetAddress, borrowTokenAddr, wei, ltvNum, ltvDen, ctx.address);
        if (tx1.status === "reverted") { setCrStep("failed"); setCrError("commit reverted"); return; }
        setCommitId(tx1.commitId);
        setCrStep("decrypting");

        // TX2: Execute
        setCrStep("executing");
        const tx2 = await bridge.contract.write.borrowExecute(tx1.commitId, tx1.ctHash, ctx.address);
        if (tx2.status === "reverted") { setCrStep("failed"); setCrError("execute reverted"); return; }
        setCrStep("done");
        window.__bridgeBus?.set("transaction:confirmed", {});
      } catch (e) {
        setCrStep("failed");
        setCrError(e.message || "transaction failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRepay() {
    if (submitting) return;
    if (Number(amount) <= 0) { setCrStep("failed"); setCrError("Amount must be greater than 0"); return; }
    if (walletNumeric != null && Number(amount) > walletNumeric) {
      setCrStep("failed"); setCrError(`Amount exceeds your wallet balance. Available: ${walletNumeric} ${market.asset}`); return;
    }
    setSubmitting(true);
    try {
      if (!market.assetAddress) { setCrStep("failed"); setCrError("missing token address"); return; }
      const wei = toWeiL(amount, market.asset);
      if (!wei) { setCrStep("failed"); setCrError("invalid amount"); return; }
      const bridge = typeof window !== "undefined" ? window.bridge : null;
      if (!bridge?.contract) { setCrStep("failed"); setCrError("bridge unavailable"); return; }

      // Approval check (repay needs transferFrom)
      const LENDING_POOL = "0x4ed64f1708139E31C4c48A19f285AD50dC68EB35";
      const allowance = await bridge.contract.read.erc20Allowance(market.assetAddress, ctx.address, LENDING_POOL);
      if (BigInt(allowance) < wei) {
        const approvalRes = await bridge.contract.write.erc20Approve(market.assetAddress, LENDING_POOL, ctx.address);
        if (approvalRes.status === "reverted") { setCrStep("failed"); setCrError("approval failed"); return; }
      }

      // TX1: Commit
      setCrStep("committing");
      try {
        const tx1 = await bridge.contract.write.repayCommit(market.assetAddress, wei, ctx.address);
        if (tx1.status === "reverted") { setCrStep("failed"); setCrError("commit reverted"); return; }
        setCommitId(tx1.commitId);
        setCrStep("decrypting");

        // TX2: Execute
        setCrStep("executing");
        const tx2 = await bridge.contract.write.repayExecute(market.assetAddress, tx1.commitId, tx1.ctHash, ctx.address);
        if (tx2.status === "reverted") { setCrStep("failed"); setCrError("execute reverted"); return; }
        setCrStep("done");
        window.__bridgeBus?.set("transaction:confirmed", {});
      } catch (e) {
        setCrStep("failed");
        setCrError(e.message || "transaction failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw() {
    if (submitting) return;
    if (Number(amount) <= 0) { setCrStep("failed"); setCrError("Amount must be greater than 0"); return; }
    setSubmitting(true);
    try {
      if (!market.assetAddress) { setCrStep("failed"); setCrError("missing token address"); return; }
      const wei = toWeiL(amount, market.asset);
      if (!wei) { setCrStep("failed"); setCrError("invalid amount"); return; }
      const bridge = typeof window !== "undefined" ? window.bridge : null;
      if (!bridge?.contract) { setCrStep("failed"); setCrError("bridge unavailable"); return; }

      // TX1: Commit
      setCrStep("committing");
      try {
        const tx1 = await bridge.contract.write.withdrawCommit(market.assetAddress, wei, ctx.address);
        if (tx1.status === "reverted") { setCrStep("failed"); setCrError("commit reverted"); return; }
        setCommitId(tx1.commitId);
        setCrStep("decrypting");

        // TX2: Execute
        setCrStep("executing");
        const tx2 = await bridge.contract.write.withdrawExecute(market.assetAddress, tx1.commitId, tx1.ctHash, ctx.address);
        if (tx2.status === "reverted") { setCrStep("failed"); setCrError("execute reverted · amount may exceed your supply"); return; }
        setCrStep("done");
        window.__bridgeBus?.set("transaction:confirmed", {});
      } catch (e) {
        setCrStep("failed");
        setCrError(e.message || "transaction failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const handleActions = { supply: handleSupply, borrow: handleBorrow, repay: handleRepay, withdraw: handleWithdraw };
  const handleAction = handleActions[side] || handleSupply;
  return (
    <div className="fade-enter" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 28, alignItems: "start" }}>
      {/* Action form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <div className="spread" style={{ marginBottom: 10 }}>
            <span className="eyebrow">Amount</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
              wallet · <Cipher value={walletValue} locked={locked} size="sm" inline /> {market.asset}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, border: "1px solid var(--ink)", padding: "14px 16px", background: "var(--paper)" }}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              aria-label={side === "supply" ? "Amount to supply" : "Amount to borrow"}
              style={{ border: 0, outline: "none", background: "transparent", fontFamily: "var(--mono)", fontSize: 30, flex: 1, color: "var(--ink)", fontVariantNumeric: "tabular-nums", minWidth: 0 }}
              data-testid="amount-input"
            />
            <span className="mono" style={{ fontSize: 14, color: "var(--muted)", alignSelf: "center" }}>{market.asset}</span>
          </div>
          <div className="row mono" style={{ gap: 8, fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
            {["25%", "50%", "75%", "Max"].map(p => (
              <button key={p} onClick={() => {
                if (walletNumeric == null) return;
                const pct = p === "Max" ? 1 : Number(p.replace("%", "")) / 100;
                setAmount(String(Math.floor(walletNumeric * pct)));
              }} disabled={walletNumeric == null} className="btn ghost sm" style={{ padding: "3px 8px", fontSize: 10 }}>{p}</button>
            ))}
            <hr className="dashed" style={{ flex: 1 }} />
            <span>encrypted before it leaves your browser</span>
          </div>
        </div>

        {locked && (
          <div style={{
            padding: "12px 14px",
            background: "var(--accent-soft)", border: "1px solid var(--accent)",
            color: "var(--accent-ink)", fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.55,
          }}>
            <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>Permit required</strong> · grant a permit so your wallet can encrypt and submit this amount. One signature, no gas, expires in 15 minutes.
          </div>
        )}

        {side === "borrow" && markets && markets.length > 1 && (
          <div style={{ marginBottom: 8 }}>
            <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Borrow asset</span>
            <select
              value={borrowAssetId || (markets.find(m => m.asset !== market.asset) || {}).asset || ""}
              onChange={(e) => setBorrowAssetId(e.target.value)}
              aria-label="Borrow asset"
              style={{ width: "100%", padding: "8px", background: "var(--input)", color: "var(--foreground)", border: "1px solid var(--border)" }}
              data-testid="borrow-asset-select"
            >
              {markets.filter(m => m.asset !== market.asset).map(m => (
                <option key={m.asset} value={m.asset}>{m.asset}</option>
              ))}
            </select>
          </div>
        )}

        {side === "borrow" && (
          <div>
            <div className="spread" style={{ marginBottom: 8 }}>
              <span className="eyebrow" title="How much you borrow relative to your collateral. Higher = riskier.">Loan-to-value</span>
              <span className="mono" style={{ fontSize: 12 }}>{ltv}%</span>
            </div>
            <input type="range" min="0" max="80" value={ltv}
                   onChange={(e) => setLtv(+e.target.value)}
                   aria-valuemin={0}
                   aria-valuemax={80}
                   aria-valuenow={ltv}
                   aria-label="Loan to value ratio"
                   style={{ width: "100%", accentColor: "var(--ink)" }} />
            <LtvGauge ltv={ltv} liqAt={market.liq} />
            {ltv >= 70 && (
              <div style={{
                marginTop: 10, padding: "10px 12px",
                background: "var(--danger-soft)", border: "1px solid var(--danger)",
                color: "var(--danger)", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.55,
              }}>
                <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>Liq risk</strong> · a {Math.round((1 - ltv / market.liq) * 100)}% price drop will liquidate this position.
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {!ctx.connected ? (
            <button className="btn lg" style={{ flex: 1 }} onClick={openConnect}>Connect to {side} <span className="ar">→</span></button>
          ) : locked ? (
            <button className="btn accent lg" style={{ flex: 1 }} onClick={grantPermit}>Grant permit first <span className="ar">→</span></button>
          ) : (
            <button className="btn lg" style={{ flex: 1 }} onClick={handleAction} disabled={submitting || (crStep !== "idle" && crStep !== "done" && crStep !== "failed")} data-testid="submit-action">
              {crStep === "committing" ? "Committing…" :
               crStep === "decrypting" ? "Decrypting… (est. 10-30s)" :
               crStep === "executing" ? "Executing…" :
               `Encrypt & ${side} ${amount} ${market.asset}`}
              <span className="ar">→</span>
            </button>
          )}
        </div>

        {crStep === "decrypting" && (
          <div role="status" aria-live="polite" style={{ marginTop: 8, padding: "10px 12px", background: "var(--accent-soft, #0a1a2a)", border: "1px solid var(--accent)", color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
            <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>Decrypting</strong> · waiting for CoFHE threshold network · est. 10-30s
          </div>
        )}
        {crStep === "done" && (
          <div role="status" aria-live="polite" style={{ marginTop: 8, padding: "10px 12px", background: "var(--success-soft, #0a2a1a)", border: "1px solid var(--success)", color: "var(--success)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
            <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>Confirmed</strong> · {side} complete
          </div>
        )}
        {crStep === "failed" && crError && (
          <div role="alert" aria-live="assertive" style={{ marginTop: 8, padding: "10px 12px", background: "var(--danger-soft, #2a0a0a)", border: "1px solid var(--destructive)", color: "var(--destructive)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
            <strong style={{ letterSpacing: 0.06, textTransform: "uppercase", fontSize: 10 }}>Failed</strong> · {crError}
          </div>
        )}
      </div>

      {/* Summary card */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 20 }}>
          <span className="eyebrow">summary</span>
          <div className="stack-2" style={{ marginTop: 12 }}>
            <div className="kv"><span className="k">{side} apy</span><span className="v" style={{ color: side === "supply" || side === "repay" ? "var(--positive)" : "var(--danger)" }}>{side === "supply" || side === "repay" ? "+" : "−"}{apy}%</span></div>
            <div className="kv"><span className="k">health after</span><span className="v"><Cipher value={side === "supply" || side === "repay" ? (market.healthAfterSupply || "unavailable") : (market.healthAfterBorrow || "unavailable")} locked={locked} size="sm" inline /></span></div>
            <div className="kv"><span className="k">liq price</span><span className="v">{market.liqPrice || "–"}</span></div>
            <div className="kv"><span className="k">est. gas</span><span className="v">{market.estimatedGas || "unavailable"}</span></div>
          </div>
        </div>

        <div style={{ background: "var(--paper)", border: "1px solid var(--hairline)", padding: 20 }}>
          <span className="eyebrow">market · {market.asset}</span>
          <div className="stack-2" style={{ marginTop: 12 }}>
            <div className="kv"><span className="k">utilization</span><span className="v">{market.util}%</span></div>
            <div style={{ marginTop: 6 }}>
              <div className="meter" style={{ height: 6 }}>
                <div className="fill" style={{ width: market.util + "%" }} />
              </div>
            </div>
            <div className="kv"><span className="k">public tvl</span><span className="v">{market.tvl}</span></div>
            <div className="kv"><span className="k">liq threshold</span><span className="v">{market.liq}%</span></div>
            <div className="kv"><span className="k">last oracle</span><span className="v">{market.updatedAt || "unavailable"}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Lending = Lending;
