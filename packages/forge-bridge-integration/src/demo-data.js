/* ──────────────────────────────────────────────
   Demo / mock data for DataFetcherV2.

   All hardcoded demo payloads used by startDemoMode() live here
   so data-fetcher-v2.js can stay focused on polling logic.

   Keys match what the Babel plugin's MOCK_CONSTANTS and
   VALUE_TO_MOCK_KEY mappings expect.
   ────────────────────────────────────────────── */

/**
 * Domain data returned by _generateDemoData().
 * Each key maps 1:1 to a BridgeBus 'data:*' event.
 */
var DEMO_DATA = {
  // ── Ticker ──────────────────────────────────
  // Matches the 9-item format from landing.jsx Ticker component.
  // Shorter lists cause visible repetition with the seamless-loop
  // [...items, ...items] marquee technique.
  ticker: [
    'block #182,944,108',
    'gas \u00B7 0.014 gwei',
    'USDC pool tvl \u00B7 $8.42M',
    'ETH pool tvl \u00B7 $4.18M',
    'WBTC pool tvl \u00B7 $1.80M',
    'encrypted ops \u00B7 1.42M',
    'permit decrypts \u00B7 42k / day',
    'active strategies \u00B7 412',
    'deployed via composer \u00B7 1,284',
  ],

  // ── Markets (lending.jsx) ────────────────────
  markets: [
    {
      asset: 'USDC',
      supplyApy: 4.82,
      borrowApy: 6.21,
      util: 64,
      tvl: '8.42M',
      totalSupply: '8.42M',
      totalBorrow: '5.39M',
      liq: 80,
      oracle: 'Pyth',
      price: '$1.000',
      icon: 'USDC',
    },
    {
      asset: 'ETH',
      supplyApy: 2.14,
      borrowApy: 3.78,
      util: 41,
      tvl: '4.18M',
      totalSupply: '4.18M',
      totalBorrow: '1.71M',
      liq: 75,
      oracle: 'Pyth',
      price: '$2,544.10',
      icon: 'ETH',
    },
    {
      asset: 'WBTC',
      supplyApy: 1.66,
      borrowApy: 3.1,
      util: 22,
      tvl: '1.80M',
      totalSupply: '1.80M',
      totalBorrow: '0.40M',
      liq: 70,
      oracle: 'Pyth',
      price: '$94,210',
      icon: 'WBTC',
    },
    {
      asset: 'ARB',
      supplyApy: 5.42,
      borrowApy: 8.2,
      util: 68,
      tvl: '924k',
      totalSupply: '0.92M',
      totalBorrow: '0.63M',
      liq: 65,
      oracle: 'Pyth \u00B7 fb',
      price: '$0.74',
      icon: 'ARB',
    },
    {
      asset: 'DAI',
      supplyApy: 3.91,
      borrowApy: 5.04,
      util: 51,
      tvl: '612k',
      totalSupply: '0.61M',
      totalBorrow: '0.31M',
      liq: 78,
      oracle: 'Pyth',
      price: '$1.000',
      icon: 'DAI',
    },
  ],

  // ── Activities (dashboard.jsx) ───────────────
  activities: [
    {
      id: 'a1',
      block: 182944108,
      age: '14s',
      what: 'S/01 \u00B7 loop iter 3',
      kind: 'shield',
      asset: 'USDC',
      delta: '+5,200.00',
    },
    {
      id: 'a2',
      block: 182944094,
      age: '47s',
      what: 'Composer open',
      kind: 'borrow',
      asset: 'ETH',
      delta: '\u22121.480',
    },
    {
      id: 'a3',
      block: 182944081,
      age: '1m',
      what: 'Pool \u00B7 interest',
      kind: 'accrue',
      asset: 'USDC',
      delta: '+12.04',
    },
    {
      id: 'a4',
      block: 182943988,
      age: '4m',
      what: 'Swap intent filled',
      kind: 'swap',
      asset: 'ETH\u2192USDC',
      delta: '\u22484,820',
    },
    {
      id: 'a5',
      block: 182943890,
      age: '11m',
      what: 'S/02 \u00B7 re-supply',
      kind: 'shield',
      asset: 'WETH',
      delta: '+0.840',
    },
    {
      id: 'a6',
      block: 182943742,
      age: '26m',
      what: 'Permit \u00B7 renewed',
      kind: 'permit',
      asset: '\u2013',
      delta: '\u2013',
    },
  ],

  // ── Positions (dashboard.jsx) ────────────────
  positions: [
    {
      id: 'p1',
      venue: 'Lending Pool',
      asset: 'USDC',
      side: 'supply',
      amount: '42,084.13',
      apy: '+4.82%',
      liq: null,
    },
    {
      id: 'p2',
      venue: 'Lending Pool',
      asset: 'ETH',
      side: 'borrow',
      amount: '5.420',
      apy: '\u22123.14%',
      liq: '$1,820',
    },
    {
      id: 'p3',
      venue: 'Vault \u00B7 S/01',
      asset: 'USDC',
      side: 'vault',
      amount: '12,840.00',
      apy: '+11.4%',
      liq: null,
    },
    {
      id: 'p4',
      venue: 'Vault \u00B7 S/02',
      asset: 'WETH',
      side: 'vault',
      amount: '3.205',
      apy: '+8.7%',
      liq: null,
    },
    {
      id: 'p5',
      venue: 'Vault \u00B7 S/03',
      asset: 'WBTC',
      side: 'vault',
      amount: '0.1402',
      apy: '+14.2%',
      liq: null,
    },
  ],

  // ── Strategies (dashboard.jsx) ───────────────
  strategies: [
    {
      id: 's1',
      name: 'Lean USDC leverage',
      apy: '+11.4%',
      staked: '12,840 USDC',
      loops: 4,
      last: '2m ago',
    },
    {
      id: 's2',
      name: 'ETH delta-neutral',
      apy: '+8.7%',
      staked: '8,200 USDC',
      loops: 3,
      last: '11m ago',
    },
    {
      id: 's3',
      name: 'WBTC carry & swap',
      apy: '+14.2%',
      staked: '4,108 USDC',
      loops: 5,
      last: '1h ago',
    },
  ],

  // ── Proposals (governance.jsx) ───────────────
  proposals: [
    {
      id: 'P-08',
      title: 'WBTC liquidation 75% \u2192 70%',
      status: 'active',
      body: 'Tightens WBTC liquidation threshold by 500 bps after two near-liquidation events. Affects 18 open positions, recipients pre-notified.',
      forVotes: 412840,
      againstVotes: 88200,
      abstain: 12400,
      quorum: 460000,
      proposer: '0x9f3a\u2026b4a39',
      timeLeft: '1d 14h',
      created: '2026-05-28',
    },
    {
      id: 'P-07',
      title: 'Add ARB as collateral (65% LTV)',
      status: 'active',
      body: 'Whitelist ARB with 65% initial LTV, 70% liquidation, Pyth oracle.',
      forVotes: 188400,
      againstVotes: 142900,
      abstain: 9120,
      quorum: 460000,
      proposer: '0xd1c2\u20267e84',
      timeLeft: '3d 02h',
      created: '2026-05-25',
    },
    {
      id: 'P-06',
      title: 'Raise Composer loop cap to 8',
      status: 'queued',
      body: 'Allow strategies up to 8 loop iterations (current cap: 6). Gas analysis attached.',
      forVotes: 512300,
      againstVotes: 38000,
      abstain: 4200,
      quorum: 460000,
      proposer: '0x4a92\u20260f10',
      timeLeft: 'executes in 1d 03h',
      created: '2026-05-20',
    },
    {
      id: 'P-05',
      title: 'Treasury: 24,000 FFT executor grant',
      status: 'executed',
      body: 'Pay swap-intent solver #03 24,000 FFT over 6 months.',
      forVotes: 622400,
      againstVotes: 19200,
      abstain: 2200,
      quorum: 460000,
      proposer: '0x9f3a\u2026b4a39',
      timeLeft: 'executed \u00B7 6d ago',
      created: '2026-05-15',
    },
    {
      id: 'P-04',
      title: 'Pause GHO market',
      status: 'defeated',
      body: 'Defeated 142k for / 304k against. Community rejected pause.',
      forVotes: 142000,
      againstVotes: 304800,
      abstain: 18900,
      quorum: 460000,
      proposer: '0x8c11\u20262d44',
      timeLeft: 'ended 11d ago',
      created: '2026-05-10',
    },
  ],

  // ── Community Strategies (market.jsx) ─────────
  community: [
    {
      id: 'c-lev',
      name: 'Lean USDC leverage',
      author: '@symulacr',
      risk: 'low',
      apy: 11.4,
      tvl: '1,284,210',
      asset: 'USDC',
      deployers: 412,
      template: 'leverage',
    },
    {
      id: 'c-dn',
      name: 'ETH delta-neutral',
      author: '@haven',
      risk: 'med',
      apy: 8.7,
      tvl: '612,950',
      asset: 'ETH',
      deployers: 188,
      template: 'deltaNeutral',
    },
    {
      id: 'c-wbtc',
      name: 'WBTC carry & swap',
      author: '@symulacr',
      risk: 'high',
      apy: 14.2,
      tvl: '402,180',
      asset: 'WBTC',
      deployers: 71,
      template: 'leverage',
    },
    {
      id: 'c-arb',
      name: 'ARB incentive sweep',
      author: '@plux',
      risk: 'med',
      apy: 22.8,
      tvl: '298,400',
      asset: 'ARB',
      deployers: 240,
      template: 'rebalance',
    },
    {
      id: 'c-skim',
      name: 'Stable fee skim',
      author: '@quietco',
      risk: 'low',
      apy: 5.6,
      tvl: '1,840,210',
      asset: 'USDC',
      deployers: 612,
      template: 'rebalance',
    },
  ],

  // ── Templates (builder-workspace.jsx) ─────────
  templates: {
    blank: {
      label: 'Blank',
      nodes: [{ id: 'n1', type: 'settle', x: 40, y: 40, config: {} }],
      edges: [],
    },
    leverage: {
      label: 'Leverage loop',
      nodes: [
        {
          id: 'n1',
          type: 'supply',
          x: 16,
          y: 32,
          config: { asset: 'USDC', amount: '20,000' },
        },
        {
          id: 'n2',
          type: 'borrow',
          x: 192,
          y: 32,
          config: { asset: 'ETH', ltv: 65, amount: '8,400' },
        },
        {
          id: 'n3',
          type: 'swap',
          x: 368,
          y: 32,
          config: { from: 'ETH', to: 'USDC', slip: 0.5, amount: '\u224820,400' },
        },
        { id: 'n4', type: 'repeat', x: 192, y: 148, config: { loops: 4 } },
        { id: 'n5', type: 'settle', x: 368, y: 148, config: {} },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5' },
      ],
    },
    deltaNeutral: {
      label: 'Delta-neutral',
      nodes: [
        { id: 'n1', type: 'supply', x: 16, y: 32, config: { asset: 'ETH', amount: '10' } },
        {
          id: 'n2',
          type: 'borrow',
          x: 192,
          y: 32,
          config: { asset: 'USDC', ltv: 50, amount: '12,500' },
        },
        {
          id: 'n3',
          type: 'swap',
          x: 368,
          y: 32,
          config: { from: 'USDC', to: 'ETH', slip: 0.3, amount: '\u22484.9' },
        },
        { id: 'n5', type: 'settle', x: 368, y: 148, config: {} },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n5' },
      ],
    },
    rebalance: {
      label: 'Auto-rebalance',
      nodes: [
        {
          id: 'n1',
          type: 'supply',
          x: 16,
          y: 32,
          config: { asset: 'USDC', amount: '5,000' },
        },
        { id: 'n4', type: 'repeat', x: 192, y: 32, config: { loops: 2 } },
        { id: 'n5', type: 'settle', x: 368, y: 32, config: {} },
      ],
      edges: [
        { from: 'n1', to: 'n4' },
        { from: 'n4', to: 'n5' },
      ],
    },
  },

  // ── Node Types (builder-workspace.jsx) ───────
  nodeTypes: {
    supply: {
      label: 'Supply',
      kicker: 'lend',
      swatch: 'var(--positive)',
      desc: 'Shield ERC-20 into pool',
    },
    borrow: {
      label: 'Borrow',
      kicker: 'debt',
      swatch: 'var(--danger)',
      desc: 'Encrypted borrowWithLtv',
    },
    swap: { label: 'Swap', kicker: 'dex', swatch: 'var(--accent)', desc: 'Intent or Uni V3' },
    repeat: {
      label: 'Repeat',
      kicker: 'loop',
      swatch: 'var(--ink-2)',
      desc: 'Composer loop depth',
    },
    settle: {
      label: 'Settle',
      kicker: 'fin',
      swatch: 'var(--ink)',
      desc: 'Grant ACL, end pipeline',
    },
  },

  // ── Wallet Balance / Portfolio Metrics ─────
  walletBalance: {
    netValue: '68,412.07',
    portfolioLTV: '30.00',
    ltvGaugeValue: 30,
    balance: '22,508.30',
  },
};

/**
 * Mapping from DEMO_DATA keys → window.__MOCK__ property names.
 * Used by _writeMockData() to avoid repetitive assignment statements.
 */
var MOCK_KEY_MAP = {
  ticker: 'TICKER_ITEMS',
  markets: 'L_MARKETS',
  activities: 'D_ACTIVITY',
  positions: 'D_POSITIONS',
  strategies: 'D_STRATS',
  proposals: 'PROPOSALS',
  nodeTypes: 'NODE_TYPES',
  community: 'COMMUNITY',
  templates: 'TEMPLATES',
};

/**
 * Static builder config written to __MOCK__.DEFAULT_CONFIG.
 */
var DEFAULT_CONFIG = {
  supply: { asset: 'USDC', amount: '10,000' },
  borrow: { asset: 'ETH', ltv: 50, amount: '4,000' },
  swap: { from: 'ETH', to: 'USDC', slip: 0.5, amount: '\u224810,200' },
  repeat: { loops: 3 },
  settle: {},
};

/**
 * Scalar cipher values written to window.__MOCK__ (VALUE_TO_MOCK_KEY).
 */
var CIPHER_VALUES = {
  PORTFOLIO_NET_VALUE: '68,412.07',
  PORTFOLIO_LTV: '30.00',
  DEMO_SUPPLIED_VALUE: '12,456.78',
  DEMO_BORROWED_VALUE: '4,320.50',
  DEMO_STRATS_VALUE: '228,100',
  USER_NET_SUPPLIED: '42,084',
  USER_NET_BORROWED: '5.42 ETH',
  WALLET_BALANCE: '22,508.30',
  PORTFOLIO_CHANGE_24H: '+2.41%',
  POSITION_INTEREST: '142.08',
  HEALTH_AFTER_SUPPLY: '2.84',
  HEALTH_AFTER_BORROW: '1.62',
  GAS_ETH: '0.412',
  EMPTY_PORTFOLIO: '0.00',
};

/**
 * Demo rows for the landing page table.
 */
var DEMO_ROWS = [
  ['Supplied', '42,084.13', 'USDC'],
  ['Borrowed', '18,910.00', 'ETH'],
  ['In strategies', '7,418.94', 'USDC'],
];

// ── Exports ───────────────────────────────────
// UMD-style: works in browsers (global) and bundlers (CJS/ESM via bridge-loader).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEMO_DATA: DEMO_DATA,
    MOCK_KEY_MAP: MOCK_KEY_MAP,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    CIPHER_VALUES: CIPHER_VALUES,
    DEMO_ROWS: DEMO_ROWS,
  };
} else if (typeof window !== 'undefined') {
  window.__demoData = {
    DEMO_DATA: DEMO_DATA,
    MOCK_KEY_MAP: MOCK_KEY_MAP,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    CIPHER_VALUES: CIPHER_VALUES,
    DEMO_ROWS: DEMO_ROWS,
  };
}
