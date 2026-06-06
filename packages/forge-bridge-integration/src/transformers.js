/* ──────────────────────────────────────────────
   Transformers — Pure functions that map
   bridge adapter data shapes → forge mock-compatible shapes.
   All functions are side-effect-free and browser-compatible.
   ────────────────────────────────────────────── */

(() => {
  var transformers = {};

  /* ──────────────────────────────────────────────
     Module-level constants — created once,
     shared across all transformer calls.
     ────────────────────────────────────────────── */

  var ACTION_MAP = {
    supply: {
      label: 'Supply',
      kicker: 'SUP',
      swatch: '#22c55e',
      desc: 'Supply assets to lending pool',
    },
    borrow: {
      label: 'Borrow',
      kicker: 'BRW',
      swatch: '#eab308',
      desc: 'Borrow assets from lending pool',
    },
    swap: { label: 'Swap', kicker: 'SWP', swatch: '#3b82f6', desc: 'Swap tokens via DEX' },
    repeat: { label: 'Repeat', kicker: 'RPT', swatch: '#888888', desc: 'Repeat previous action' },
    settle: { label: 'Settle', kicker: 'STL', swatch: '#ef4444', desc: 'Settle/repay position' },
  };

  /* ──────────────────────────────────────────────
     Shared helpers
     ────────────────────────────────────────────── */

  function _pick(raw) {
    for (var i = 1; i < arguments.length; i++) {
      if (raw[arguments[i]] != null && raw[arguments[i]] !== '') return raw[arguments[i]];
    }
    return undefined;
  }

  function _mapPosition(item, side, prefix, markets) {
    return {
      id: item.id || `${prefix}-${item.asset || Math.random().toString(36).slice(2, 8)}`,
      venue: 'Lending Pool',
      asset: item.asset || 'UNKNOWN',
      tokenAddress: item.tokenAddress || item.token || item.assetAddress || null,
      side: side,
      amount: item.amountUsd || item.amount || '0',
      amountWei: item.amountWei || item.rawAmount || item.balanceWei || null,
      decimals: item.decimals || item.tokenDecimals || null,
      apy: lookupApy(markets, item.asset, side),
      liq: item.liquidationThreshold || '0',
    };
  }

  function _totals(positions) {
    var supply = 0;
    var borrow = 0;
    for (var i = 0; i < positions.length; i++) {
      var amt = parseUsd(positions[i].amount);
      if (positions[i].side === 'borrow') {
        borrow += amt;
      } else {
        supply += amt;
      }
    }
    return { supply: supply, borrow: borrow };
  }

  /* ──────────────────────────────────────────────
     transformMarkets
     API /markets → forge L_MARKETS format
     ────────────────────────────────────────────── */
  function transformMarkets(apiMarkets) {
    if (!Array.isArray(apiMarkets)) return [];
    return apiMarkets.map((m) => ({
      asset: _pick(m, 'asset', 'symbol', 'UNKNOWN'),
      assetAddress: m.assetAddress || null,
      supplyApy: formatApy(_pick(m, 'supplyAPY', 'supplyRate', 'supplyApy')),
      borrowApy: formatApy(_pick(m, 'borrowAPY', 'borrowRate', 'borrowApy')),
      util: formatPercentValue(_pick(m, 'util', 'utilization')),
      tvl: formatUsdDisplay(_pick(m, 'tvl', 'totalSupplyUsd', 'totalSupply')),
      liq: formatPercentValue(_pick(m, 'liq', 'liquidationThreshold')),
      oracle: m.oracle || m.oracleSource || (m.oraclePrice != null ? 'on-chain' : 'unavailable'),
      price: m.price || formatUsdDisplay(m.oraclePrice),
      totalBorrowed: formatUsdDisplay(m.totalBorrowed) || m.totalBorrowed || null,
      totalSupplied: formatUsdDisplay(m.totalSupplied) || m.totalSupplied || null,
      healthAfterSupply: m.healthAfterSupply,
      healthAfterBorrow: m.healthAfterBorrow,
      healthFactor: m.healthFactor ?? null,
      liqPrice: _pick(m, 'liqPrice', 'liquidationPrice') ?? null,
      estimatedGas: m.estimatedGas,
      updatedAt: _pick(m, 'updatedAt', 'oracleUpdatedAt'),
    }));
  }

  /* ──────────────────────────────────────────────
     transformPositions
     Supply/borrow objects → forge D_POSITIONS format
     ────────────────────────────────────────────── */
  function transformPositions(supplies, borrows, markets) {
    var positions = [];
    if (Array.isArray(supplies)) {
      supplies.forEach((s) => positions.push(_mapPosition(s, 'supply', 'sup', markets)));
    }
    if (Array.isArray(borrows)) {
      borrows.forEach((b) => positions.push(_mapPosition(b, 'borrow', 'bor', markets)));
    }
    return positions;
  }

  /* ──────────────────────────────────────────────
     transformVaultPositions
     API vault positions → forge-compatible shape
     ────────────────────────────────────────────── */
  function transformVaultPositions(apiVaultPositions) {
    if (!Array.isArray(apiVaultPositions)) return [];
    return apiVaultPositions.map((v) => ({
      id: v.id || v.vaultId || `vault-${Math.random().toString(36).slice(2, 8)}`,
      vaultAddress: _pick(v, 'vaultAddress', 'address', null),
      name: _pick(v, 'name', 'vaultName', 'Vault'),
      asset: _pick(v, 'asset', 'depositAsset', 'UNKNOWN'),
      depositedAmount: _pick(v, 'depositedAmount', 'amount', '0'),
      depositedUsd: _pick(v, 'depositedUsd', 'amountUsd', '0'),
      shares: _pick(v, 'shares', 'shareBalance', '0'),
      apy: v.apy || 0,
      strategy: _pick(v, 'strategy', 'strategyName', ''),
      pendingRewards: v.pendingRewards || '0',
    }));
  }

  /* ──────────────────────────────────────────────
     transformActivities
     API events → forge D_ACTIVITY format
     ────────────────────────────────────────────── */
  function transformActivities(apiActivities) {
    if (!Array.isArray(apiActivities)) return [];
    return apiActivities.map((a) => ({
      id: a.id || a.txHash || `act-${Math.random().toString(36).slice(2, 8)}`,
      block: a.blockNumber != null ? String(a.blockNumber) : '',
      age: relativeTime(_pick(a, 'timestamp', 'createdAt')),
      what: _pick(a, 'description', 'type', 'Transaction'),
      kind: _pick(a, 'kind', 'action', 'swapped'),
      asset: _pick(a, 'asset', 'token', ''),
      delta: formatDelta(a.amount, a.side),
    }));
  }

  /* ──────────────────────────────────────────────
     formatTicker
     Stats → 9 formatted ticker strings
     ────────────────────────────────────────────── */
  function formatTicker(stats) {
    var s = stats || {};
    var poolTvls = s.poolTvls || {};
    var entries = [
      ['TVL', function () { return formatUsdDisplay(s.tvlUsd); }],
      ['MARKETS', function () { return s.activeMarkets != null ? s.activeMarkets : '—'; }],
      ['STRATS', function () { return s.activeStrategies != null ? s.activeStrategies : '—'; }],
      ['DEPLOYS', function () { return s.totalDeployments != null ? s.totalDeployments : '—'; }],
      ['ENCRYPTED', function () { return s.encryptedOps != null ? s.encryptedOps : '—'; }],
      ['PERMITS', function () { return s.permitDecryptsDay != null ? s.permitDecryptsDay : '—'; }],
      ['USDC TVL', function () { return formatUsdDisplay(poolTvls.USDC); }],
      ['ETH TVL', function () { return formatUsdDisplay(poolTvls.ETH); }],
      ['STATUS', function () { return s.status || 'unavailable'; }],
    ];
    return entries.map(function (e) { return e[0] + ': ' + e[1](); });
  }

  /* ──────────────────────────────────────────────
     transformStrategies
     API defi-strategies → forge D_STRATS format
     ────────────────────────────────────────────── */
  function transformStrategies(apiStrategies) {
    if (!Array.isArray(apiStrategies)) return [];
    return apiStrategies.map((s) => ({
      id: s.id || s.strategyId || `strat-${Math.random().toString(36).slice(2, 8)}`,
      name: s.name || 'Strategy',
      apy: formatApy(_pick(s, 'apy', 'estimatedApy')),
      staked: _pick(s, 'totalStakedUsd', 'staked', '0'),
      loops: _pick(s, 'loopCount', 'loops', 0),
      last: relativeTime(_pick(s, 'lastUpdated', 'updatedAt', 'createdAt')),
    }));
  }

  /* ──────────────────────────────────────────────
     transformProposals
     Governance API → forge PROPOSALS format
     ────────────────────────────────────────────── */
  function transformProposals(apiProposals) {
    if (!Array.isArray(apiProposals)) return [];
    return apiProposals.map((p) => ({
      id: p.id || p.proposalId || `prop-${Math.random().toString(36).slice(2, 8)}`,
      title: p.title || 'Proposal',
      status: (p.status || 'pending').toLowerCase(),
      body: _pick(p, 'description', 'body', ''),
      forVotes: String(_pick(p, 'forVotes', 'votesFor', 0)),
      againstVotes: String(_pick(p, 'againstVotes', 'votesAgainst', 0)),
      abstain: p.abstainVotes != null ? String(p.abstainVotes) : '0',
      quorum: p.quorum ? String(p.quorum) : '0',
      timeLeft: _pick(p, 'deadline', 'endsAt') != null
        ? relativeTime(_pick(p, 'deadline', 'endsAt'))
        : '—',
      proposer: _pick(p, 'proposer', 'creator', '0x0000'),
    }));
  }

  /* ──────────────────────────────────────────────
     transformCommunity
     API community strategies → forge COMMUNITY format
     ────────────────────────────────────────────── */
  function transformCommunity(apiCommunity) {
    if (!Array.isArray(apiCommunity)) return [];
    return apiCommunity.map((item) => ({
      id: item.id || item.strategyId || `comm-${Math.random().toString(36).slice(2, 8)}`,
      name: _pick(item, 'name', 'strategistName', 'Strategy'),
      author: _pick(item, 'author', 'strategistHandle', 'strategistName', 'anonymous'),
      risk: (item.risk || 'medium').toLowerCase(),
      apy: _pick(item, 'apy', 'estimatedApy', 0),
      tvl: _pick(item, 'tvl', 'totalStakedUsd', '0'),
      asset: _pick(item, 'asset', 'token', 'UNKNOWN'),
      deployers: _pick(item, 'deployers', 'deployerCount', 0),
      template: _pick(item, 'template', 'templateId', ''),
    }));
  }

  /* ──────────────────────────────────────────────
     transformNodeTypes
     Defi modules → node type definition map
     ────────────────────────────────────────────── */
  function transformNodeTypes(modules) {
    if (!Array.isArray(modules)) {
      return defaultNodeTypes();
    }
    var nodeTypes = {};
    modules.forEach((m) => {
      var action = (_pick(m, 'action', 'type') || '').toLowerCase();
      if (ACTION_MAP[action]) {
        nodeTypes[m.id || action] = {
          ...ACTION_MAP[action],
          protocol: _pick(m, 'protocol', 'name', ''),
        };
      }
    });
    // Ensure defaults exist
    const keys = Object.keys(ACTION_MAP);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!Object.values(nodeTypes).some((n) => n.kicker === ACTION_MAP[k].kicker)) {
        // Use object spread instead of Object.assign({}, ...) to avoid
        // creating both an empty object and a copy
        nodeTypes[k] = { ...ACTION_MAP[k] };
      }
    }
    return nodeTypes;
  }

  /* ──────────────────────────────────────────────
     Portfolio metrics
     ────────────────────────────────────────────── */
  function calculateNetValue(positions) {
    if (!Array.isArray(positions) || positions.length === 0) return '0.00';
    var t = _totals(positions);
    var net = t.supply - t.borrow;
    return net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function calculateLTV(positions) {
    if (!Array.isArray(positions) || positions.length === 0)
      return { ratio: '0.00', gaugeValue: 0 };
    var t = _totals(positions);
    if (t.supply === 0) return { ratio: '0.00', gaugeValue: 0 };
    var ratio = (t.borrow / t.supply) * 100;
    return {
      ratio: ratio.toFixed(2),
      gaugeValue: Math.min(Math.round(ratio), 100),
    };
  }

  /* ──────────────────────────────────────────────
     Internal helpers
     ────────────────────────────────────────────── */

  function formatApy(val) {
    if (val == null) return '—';
    var num = typeof val === 'string' ? parseFloat(val) : val;
    if (Number.isNaN(num)) return '—';
    // Backend returns decimal (0.065 = 6.5%). Multiply if ≤ 1, pass through if already > 1.
    return (num <= 1 ? num * 100 : num).toFixed(2);
  }

  function formatPercentValue(val) {
    if (val == null) return 0;
    var num = typeof val === 'string' ? parseFloat(val) : val;
    if (Number.isNaN(num)) return 0;
    return Math.round(num > 0 && num <= 1 ? num * 100 : num);
  }

  function formatUsdDisplay(val) {
    if (val == null) return 'unavailable';
    var num = typeof val === 'string' ? parseFloat(String(val).replace(/[$,]/g, '')) : val;
    if (Number.isNaN(num)) return String(val);
    return `$${num.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }

  function parseUsd(val) {
    if (val == null) return 0;
    if (typeof val === 'number') return val;
    var cleaned = String(val).replace(/[$,]/g, '');
    var num = parseFloat(cleaned);
    return Number.isNaN(num) ? 0 : num;
  }

  function relativeTime(timestamp) {
    if (!timestamp) return '—';
    var now = Date.now();
    var then = new Date(timestamp).getTime();
    if (Number.isNaN(then)) return String(timestamp);
    var diff = now - then;
    var seconds = Math.floor(diff / 1000);
    if (seconds < 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    var days = Math.floor(hours / 24);
    return `${days}d`;
  }

  function formatDelta(amount, side) {
    if (amount == null) return '';
    var prefix = side === 'borrow' || side === 'withdraw' ? '-' : '+';
    var num = typeof amount === 'string' ? parseUsd(amount) : amount;
    if (typeof num === 'number') {
      return (
        prefix + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      );
    }
    return prefix + String(amount);
  }

  function lookupApy(markets, asset, side) {
    if (!Array.isArray(markets) || !asset) return '—';
    for (let i = 0; i < markets.length; i++) {
      const m = markets[i];
      if ((m.asset || m.symbol) === asset) {
        const raw =
          side === 'supply'
            ? m.supplyAPY != null
              ? m.supplyAPY
              : m.supplyRate != null
                ? m.supplyRate
                : m.supplyApy
            : m.borrowAPY != null
              ? m.borrowAPY
              : m.borrowRate != null
                ? m.borrowRate
                : m.borrowApy;
        return formatApy(raw);
      }
    }
    return '—';
  }

  function defaultNodeTypes() {
    return Object.fromEntries(
      Object.entries(ACTION_MAP).map(([k, v]) => [k, { ...v, protocol: '' }]),
    );
  }

  /* ──────────────────────────────────────────────
     Export to window scope
     ────────────────────────────────────────────── */

  transformers.transformMarkets = transformMarkets;
  transformers.transformPositions = transformPositions;
  transformers.transformActivities = transformActivities;
  transformers.formatTicker = formatTicker;
  transformers.transformStrategies = transformStrategies;
  transformers.transformProposals = transformProposals;
  transformers.transformCommunity = transformCommunity;
  transformers.transformNodeTypes = transformNodeTypes;
  transformers.transformVaultPositions = transformVaultPositions;
  transformers.calculateNetValue = calculateNetValue;
  transformers.calculateLTV = calculateLTV;

  if (typeof window !== 'undefined') {
    window.__transformers = transformers;
  }
})();
