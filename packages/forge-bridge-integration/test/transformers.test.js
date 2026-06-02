/**
 * Transformer Functions Tests
 *
 * Tests all 9 pure transformation functions defined in transformers.js:
 * transformMarkets, transformPositions, transformActivities, formatTicker,
 * transformStrategies, transformProposals, transformNodeTypes,
 * calculateNetValue, calculateLTV.
 *
 * Covers:
 * - Normal inputs with known outputs (VAL-INTEGRATION-DATA-002 through 009)
 * - Null/undefined/malformed inputs (edge cases)
 * - Alternative field name mappings
 * - Format expectations: APY as percentage, util as integer, signed deltas,
 *   relative timestamps, 9 ticker strings, lowercased status
 * - Division-by-zero safety, negative values
 */

import { describe, it, expect } from 'bun:test';

// Browser globals (window) set up by test/setup.js

import '../src/transformers.js';

const t = globalThis.window.__transformers;

/* ──────────────────────────────────────────────
   transformMarkets (VAL-INTEGRATION-DATA-002)
   ────────────────────────────────────────────── */
describe('transformMarkets', () => {
  it('returns empty array for null/undefined/primitive input', () => {
    expect(t.transformMarkets(null)).toEqual([]);
    expect(t.transformMarkets(undefined)).toEqual([]);
    expect(t.transformMarkets('not-array')).toEqual([]);
    expect(t.transformMarkets(42)).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    expect(t.transformMarkets([])).toEqual([]);
  });

  it('transforms API market shape to forge format with all fields', () => {
    const apiMarkets = [
      {
        asset: 'ETH',
        supplyApy: 3.45,
        borrowApy: 5.67,
        utilization: 72,
        tvl: '1000000',
        liquidity: '500000',
        oraclePrice: '3500',
        price: '3500',
      },
    ];

    const result = t.transformMarkets(apiMarkets);
    expect(result).toHaveLength(1);
    expect(result[0].asset).toBe('ETH');
    // APY as percentage string
    expect(result[0].supplyApy).toBe('3.45%');
    expect(result[0].borrowApy).toBe('5.67%');
    // util as integer
    expect(result[0].util).toBe(72);
    expect(result[0].tvl).toBe('1000000');
    expect(result[0].liq).toBe('500000');
    expect(result[0].oracle).toBe('3500');
    expect(result[0].price).toBe('3500');
  });

  it('handles alternative field names', () => {
    const apiMarkets = [
      {
        symbol: 'BTC',
        supplyRate: 2.1,
        borrowRate: 4.2,
        util: 65,
        totalSupplyUsd: '2000000',
        totalBorrowUsd: '1000000',
        price: '50000',
      },
    ];

    const result = t.transformMarkets(apiMarkets);
    expect(result[0].asset).toBe('BTC');
    expect(result[0].supplyApy).toBe('2.10%');
    expect(result[0].borrowApy).toBe('4.20%');
    expect(result[0].tvl).toBe('2000000');
    expect(result[0].liq).toBe('1000000');
  });

  it('handles null/undefined APY values', () => {
    const result = t.transformMarkets([
      { asset: 'ETH', supplyApy: null, borrowApy: undefined },
    ]);
    expect(result[0].supplyApy).toBe('—');
    expect(result[0].borrowApy).toBe('—');
  });

  it('handles string APY values', () => {
    const result = t.transformMarkets([
      { asset: 'ETH', supplyApy: '3.5', borrowApy: '5.0' },
    ]);
    expect(result[0].supplyApy).toBe('3.50%');
    expect(result[0].borrowApy).toBe('5.00%');
  });

  it('rounds util to integer', () => {
    const result = t.transformMarkets([
      { asset: 'ETH', utilization: 72.8 },
    ]);
    expect(result[0].util).toBe(73);
  });

  it('defaults to 0 for missing util', () => {
    const result = t.transformMarkets([
      { asset: 'ETH' },
    ]);
    expect(result[0].util).toBe(0);
  });

  it('defaults asset to UNKNOWN when missing', () => {
    const result = t.transformMarkets([
      { supplyApy: 1.0 },
    ]);
    expect(result[0].asset).toBe('UNKNOWN');
  });
});

/* ──────────────────────────────────────────────
   transformPositions (VAL-INTEGRATION-DATA-003)
   ────────────────────────────────────────────── */
describe('transformPositions', () => {
  it('combines supplies and borrows into position array', () => {
    const supplies = [
      { asset: 'ETH', amountUsd: '5000', apy: 3.5 },
    ];
    const borrows = [
      { asset: 'USDC', amountUsd: '2000', apy: 5.0 },
    ];
    const markets = [];

    const result = t.transformPositions(supplies, borrows, markets);
    expect(result).toHaveLength(2);
    expect(result[0].side).toBe('supply');
    expect(result[0].asset).toBe('ETH');
    expect(result[0].venue).toBe('Lending Pool');
    expect(result[0].amount).toBe('5000');
    expect(result[1].side).toBe('borrow');
    expect(result[1].asset).toBe('USDC');
    expect(result[1].venue).toBe('Lending Pool');
    expect(result[1].amount).toBe('2000');
  });

  it('looks up APY from markets array', () => {
    const supplies = [
      { asset: 'ETH', amountUsd: '5000' },
    ];
    const borrows = [
      { asset: 'USDC', amountUsd: '2000' },
    ];
    const markets = [
      { asset: 'ETH', supplyApy: 3.45, borrowApy: 5.67 },
      { asset: 'USDC', supplyApy: 2.10, borrowApy: 4.20 },
    ];

    const result = t.transformPositions(supplies, borrows, markets);
    // Supply position for ETH → uses supplyApy from ETH market
    expect(result[0].apy).toBe('3.45%');
    // Borrow position for USDC → uses borrowApy from USDC market
    expect(result[1].apy).toBe('4.20%');
  });

  it('returns empty array for null/undefined inputs', () => {
    expect(t.transformPositions(null, null, null)).toEqual([]);
    expect(t.transformPositions(undefined, undefined, undefined)).toEqual([]);
    expect(t.transformPositions([], [], [])).toEqual([]);
  });

  it('handles only supplies (no borrows)', () => {
    const result = t.transformPositions(
      [{ asset: 'ETH', amountUsd: '5000' }],
      null,
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].side).toBe('supply');
  });

  it('handles only borrows (no supplies)', () => {
    const result = t.transformPositions(
      null,
      [{ asset: 'USDC', amountUsd: '2000' }],
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].side).toBe('borrow');
  });

  it('generates id from asset when id is missing', () => {
    const result = t.transformPositions(
      [{ asset: 'ETH', amountUsd: '5000' }],
      [],
      []
    );
    expect(result[0].id).toContain('sup-');
  });

  it('preserves existing id if present', () => {
    const result = t.transformPositions(
      [{ id: 'custom-id', asset: 'ETH', amountUsd: '5000' }],
      [],
      []
    );
    expect(result[0].id).toBe('custom-id');
  });

  it('shows — for APY when no market match found', () => {
    const result = t.transformPositions(
      [{ asset: 'UNKNOWN_TOKEN', amountUsd: '5000' }],
      [],
      [{ asset: 'ETH', supplyApy: 3.45 }]
    );
    expect(result[0].apy).toBe('—');
  });

  it('includes liquidation threshold when provided', () => {
    const result = t.transformPositions(
      [{ asset: 'ETH', amountUsd: '5000', liquidationThreshold: '8000' }],
      [],
      []
    );
    expect(result[0].liq).toBe('8000');
  });
});

/* ──────────────────────────────────────────────
   transformActivities (VAL-INTEGRATION-DATA-004)
   ────────────────────────────────────────────── */
describe('transformActivities', () => {
  it('transforms API activities to forge format', () => {
    const apiActivities = [
      {
        id: 'tx-1',
        blockNumber: 12345678,
        description: 'Supplied 10 ETH',
        kind: 'supply',
        asset: 'ETH',
        amount: '10',
        side: 'supply',
        timestamp: new Date().toISOString(),
      },
    ];

    const result = t.transformActivities(apiActivities);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('tx-1');
    expect(result[0].block).toBe('12345678');
    expect(result[0].what).toBe('Supplied 10 ETH');
    expect(result[0].kind).toBe('supply');
    expect(result[0].asset).toBe('ETH');
    // delta should be positive for supply
    expect(result[0].delta).toContain('+');
  });

  it('returns empty array for null/undefined/primitive input', () => {
    expect(t.transformActivities(null)).toEqual([]);
    expect(t.transformActivities(undefined)).toEqual([]);
    expect(t.transformActivities('not-array')).toEqual([]);
    expect(t.transformActivities([])).toEqual([]);
  });

  it('generates positive delta for supply actions', () => {
    const result = t.transformActivities([
      { amount: '5000', side: 'supply', timestamp: new Date().toISOString() },
    ]);
    expect(result[0].delta).toContain('+');
  });

  it('generates negative delta for borrow/withdraw actions', () => {
    const result = t.transformActivities([
      { amount: '2000', side: 'borrow', timestamp: new Date().toISOString() },
    ]);
    expect(result[0].delta).toContain('-');
  });

  it('generates negative delta for withdraw side', () => {
    const result = t.transformActivities([
      { amount: '1000', side: 'withdraw', timestamp: new Date().toISOString() },
    ]);
    expect(result[0].delta).toContain('-');
  });

  it('handles alternative field names (action instead of side)', () => {
    const result = t.transformActivities([
      { amount: '3000', action: 'borrow', timestamp: new Date().toISOString() },
    ]);
    expect(result[0].kind).toBe('borrow');
  });

  it('handles alternative field names (type instead of description)', () => {
    const result = t.transformActivities([
      { type: 'Swap completed', timestamp: new Date().toISOString() },
    ]);
    expect(result[0].what).toBe('Swap completed');
  });

  it('generates relative age string', () => {
    const justNow = new Date().toISOString();
    const result = t.transformActivities([
      { timestamp: justNow },
    ]);
    // Should be "0s" or "—" if relative time is 0
    expect(result[0].age).toBeDefined();
  });

  it('returns empty string for missing amount in delta', () => {
    const result = t.transformActivities([
      { timestamp: new Date().toISOString() },
    ]);
    expect(result[0].delta).toBe('');
  });

  it('generates ID from txHash when id missing', () => {
    const result = t.transformActivities([
      { txHash: '0xabc', timestamp: new Date().toISOString() },
    ]);
    expect(result[0].id).toBe('0xabc');
  });
});

/* ──────────────────────────────────────────────
   formatTicker (VAL-INTEGRATION-DATA-005)
   ────────────────────────────────────────────── */
describe('formatTicker', () => {
  it('returns exactly 9 strings', () => {
    const stats = {
      blockNumber: '182,944,108',
      gasPrice: '0.014',
      poolTvl: '$8.42M',
      vaultTvl: '$4.18M',
      composerTvl: '$1.80M',
      encryptedOps: '1,420,000',
      dailyPermits: '42,000',
      activeStrategies: '412',
      composerDeploys: '1,284',
    };

    const result = t.formatTicker(stats);
    expect(result).toHaveLength(9);
  });

  it('formats all 9 entries with correct prefixes', () => {
    const stats = {
      blockNumber: '182,944,108',
      gasPrice: '0.014',
      poolTvl: '$8.42M',
      vaultTvl: '$4.18M',
      composerTvl: '$1.80M',
      encryptedOps: '1,420,000',
      dailyPermits: '42,000',
      activeStrategies: '412',
      composerDeploys: '1,284',
    };

    const result = t.formatTicker(stats);

    // Block number entry
    expect(result[0]).toContain('⧫');
    expect(result[0]).toContain('182,944,108');

    // Gas price entry
    expect(result[1]).toContain('GAS');
    expect(result[1]).toContain('0.014');
    expect(result[1]).toContain('gwei');

    // Pool TVL entries
    expect(result[2]).toContain('POOL');
    expect(result[2]).toContain('$8.42M');
    expect(result[3]).toContain('VAULT');
    expect(result[3]).toContain('$4.18M');
    expect(result[4]).toContain('COMP');
    expect(result[4]).toContain('$1.80M');

    // Encrypted ops
    expect(result[5]).toContain('ENCRYPTED');
    expect(result[5]).toContain('1,420,000');

    // Permits
    expect(result[6]).toContain('PERMITS');
    expect(result[6]).toContain('42,000');

    // Active strategies
    expect(result[7]).toContain('STRATS');
    expect(result[7]).toContain('412');

    // Composer deploys
    expect(result[8]).toContain('DEPLOYS');
    expect(result[8]).toContain('1,284');
  });

  it('shows — for all missing/null fields', () => {
    const result = t.formatTicker({});

    result.forEach(function (s) {
      expect(s).toContain('—');
    });
  });

  it('handles null stats input', () => {
    const result = t.formatTicker(null);
    expect(result).toHaveLength(9);
    expect(result[0]).toContain('—');
  });
});

/* ──────────────────────────────────────────────
   transformStrategies (VAL-INTEGRATION-DATA-006)
   ────────────────────────────────────────────── */
describe('transformStrategies', () => {
  it('transforms API strategies to forge format', () => {
    const apiStrategies = [
      {
        id: 'strat-1',
        name: 'Yield Optimizer',
        apy: 12.5,
        totalStakedUsd: '500000',
        loopCount: 3,
        lastUpdated: new Date().toISOString(),
      },
    ];

    const result = t.transformStrategies(apiStrategies);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('strat-1');
    expect(result[0].name).toBe('Yield Optimizer');
    expect(result[0].apy).toBe('12.50%');
    expect(result[0].staked).toBe('500000');
    expect(result[0].loops).toBe(3);
    // last should be a relative time string
    expect(result[0].last).toBeDefined();
  });

  it('returns empty array for null/undefined/primitive input', () => {
    expect(t.transformStrategies(null)).toEqual([]);
    expect(t.transformStrategies(undefined)).toEqual([]);
    expect(t.transformStrategies('not-array')).toEqual([]);
    expect(t.transformStrategies([])).toEqual([]);
  });

  it('handles alternative field names', () => {
    const result = t.transformStrategies([
      {
        strategyId: 's-1',
        name: 'Auto Compounder',
        estimatedApy: 8.5,
        staked: '250000',
        loops: 2,
        updatedAt: new Date().toISOString(),
      },
    ]);
    expect(result[0].id).toBe('s-1');
    expect(result[0].apy).toBe('8.50%');
    expect(result[0].staked).toBe('250000');
  });

  it('defaults missing name to Strategy', () => {
    const result = t.transformStrategies([
      { updatedAt: new Date().toISOString() },
    ]);
    expect(result[0].name).toBe('Strategy');
  });

  it('shows — for null APY', () => {
    const result = t.transformStrategies([
      { apy: null, updatedAt: new Date().toISOString() },
    ]);
    expect(result[0].apy).toBe('—');
  });

  it('defaults loops to 0 when missing', () => {
    const result = t.transformStrategies([
      { updatedAt: new Date().toISOString() },
    ]);
    expect(result[0].loops).toBe(0);
  });
});

/* ──────────────────────────────────────────────
   transformProposals (VAL-INTEGRATION-DATA-007)
   ────────────────────────────────────────────── */
describe('transformProposals', () => {
  it('transforms governance proposals to forge format', () => {
    const apiProposals = [
      {
        id: 'prop-1',
        title: 'Increase ETH Collateral Factor',
        status: 'ACTIVE',
        description: 'Proposal to increase...',
        forVotes: '1000000',
        againstVotes: '500000',
        abstainVotes: '100000',
        quorum: '1000000',
        deadline: new Date(Date.now() + 86400000).toISOString(),
        proposer: '0x1234',
      },
    ];

    const result = t.transformProposals(apiProposals);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('prop-1');
    expect(result[0].title).toBe('Increase ETH Collateral Factor');
    // Status lowercased
    expect(result[0].status).toBe('active');
    expect(result[0].body).toBe('Proposal to increase...');
    expect(result[0].forVotes).toBe('1000000');
    expect(result[0].againstVotes).toBe('500000');
    expect(result[0].abstain).toBe('100000');
    expect(result[0].quorum).toBe('1000000');
    expect(result[0].proposer).toBe('0x1234');
  });

  it('returns empty array for null/undefined/primitive input', () => {
    expect(t.transformProposals(null)).toEqual([]);
    expect(t.transformProposals(undefined)).toEqual([]);
    expect(t.transformProposals('not-array')).toEqual([]);
    expect(t.transformProposals([])).toEqual([]);
  });

  it('lowercases various status values', () => {
    const result = t.transformProposals([
      { status: 'PENDING', deadline: new Date().toISOString() },
      { status: 'ACTIVE', deadline: new Date().toISOString() },
      { status: 'EXECUTED', deadline: new Date().toISOString() },
      { status: 'FAILED', deadline: new Date().toISOString() },
    ]);
    expect(result[0].status).toBe('pending');
    expect(result[1].status).toBe('active');
    expect(result[2].status).toBe('executed');
    expect(result[3].status).toBe('failed');
  });

  it('defaults status to pending when missing', () => {
    const result = t.transformProposals([
      { deadline: new Date().toISOString() },
    ]);
    expect(result[0].status).toBe('pending');
  });

  it('calculates timeLeft for past deadlines (relative time)', () => {
    // Deadline 1 hour ago (relativeTime works with past dates)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const result = t.transformProposals([
      { deadline: oneHourAgo },
    ]);
    // Should show hours since it happened 1 hour ago
    expect(result[0].timeLeft).toContain('h');
    expect(result[0].timeLeft).not.toBe('—');
  });

  it('shows — for missing deadline', () => {
    const result = t.transformProposals([
      {},
    ]);
    expect(result[0].timeLeft).toBe('—');
  });

  it('defaults title to Proposal when missing', () => {
    const result = t.transformProposals([
      {},
    ]);
    expect(result[0].title).toBe('Proposal');
  });

  it('handles alternative field names', () => {
    const result = t.transformProposals([
      {
        proposalId: 'p-1',
        title: 'Test',
        status: 'active',
        body: 'body text',
        deadline: new Date().toISOString(),
        creator: '0xabcd',
      },
    ]);
    expect(result[0].id).toBe('p-1');
    expect(result[0].body).toBe('body text');
    expect(result[0].proposer).toBe('0xabcd');
  });
});

/* ──────────────────────────────────────────────
   transformNodeTypes (VAL-INTEGRATION-DATA-008)
   ────────────────────────────────────────────── */
describe('transformNodeTypes', () => {
  it('creates default node types when no modules provided', () => {
    const result = t.transformNodeTypes(null);
    expect(result.supply).toBeDefined();
    expect(result.borrow).toBeDefined();
    expect(result.swap).toBeDefined();
    expect(result.repeat).toBeDefined();
    expect(result.settle).toBeDefined();
    expect(result.supply.label).toBe('Supply');
    expect(result.supply.kicker).toBe('SUP');
    expect(result.supply.swatch).toBe('#22c55e');
    expect(result.supply.desc).toBeTruthy();
    expect(result.supply.protocol).toBe('');
  });

  it('returns defaults for undefined input', () => {
    const result = t.transformNodeTypes(undefined);
    expect(result.supply).toBeDefined();
    expect(result.borrow).toBeDefined();
    expect(result.swap).toBeDefined();
    expect(result.repeat).toBeDefined();
    expect(result.settle).toBeDefined();
  });

  it('maps modules to node types by action', () => {
    const modules = [
      { id: 'custom-supply', action: 'supply', protocol: 'AAVE', name: 'Aave Supply' },
      { id: 'custom-borrow', action: 'borrow', protocol: 'Compound', name: 'Compound Borrow' },
    ];

    const result = t.transformNodeTypes(modules);
    expect(result['custom-supply']).toBeDefined();
    expect(result['custom-supply'].label).toBe('Supply');
    expect(result['custom-supply'].kicker).toBe('SUP');
    expect(result['custom-supply'].protocol).toBe('AAVE');
    expect(result['custom-borrow'].label).toBe('Borrow');
    expect(result['custom-borrow'].kicker).toBe('BRW');
    expect(result['custom-borrow'].protocol).toBe('Compound');
  });

  it('filters unknown/unrecognized actions', () => {
    const modules = [
      { id: 'unknown-mod', action: 'unknown_action', protocol: 'Test' },
      { id: 'supply-mod', action: 'supply', protocol: 'AAVE' },
    ];

    const result = t.transformNodeTypes(modules);
    // Unknown action should not create a node type
    expect(result['unknown-mod']).toBeUndefined();
    // Known action should still be included
    expect(result['supply-mod']).toBeDefined();
  });

  it('ensures all 5 default actions exist even when only one module matches', () => {
    const result = t.transformNodeTypes([
      { id: 'm1', action: 'supply', protocol: 'Test' },
    ]);
    // The module creates key 'm1' with kicker 'SUP'.
    // Then the defaults loop adds the 4 missing actions (borrow, swap, repeat, settle)
    // since borrow and others don't match any existing kicker.
    // Total: m1 + 4 defaults = 5 keys
    expect(Object.keys(result).length).toBe(5);
    expect(result.m1).toBeDefined();
    expect(result.m1.kicker).toBe('SUP');
    expect(result.borrow).toBeDefined();
    expect(result.swap).toBeDefined();
    expect(result.repeat).toBeDefined();
    expect(result.settle).toBeDefined();
  });

  it('handles modules with type field (alternative to action)', () => {
    const result = t.transformNodeTypes([
      { id: 'swap-mod', type: 'swap', protocol: 'Uniswap' },
    ]);
    expect(result['swap-mod']).toBeDefined();
    expect(result['swap-mod'].label).toBe('Swap');
    expect(result['swap-mod'].protocol).toBe('Uniswap');
  });
});

/* ──────────────────────────────────────────────
   calculateNetValue (VAL-INTEGRATION-DATA-009)
   ────────────────────────────────────────────── */
describe('calculateNetValue', () => {
  it('calculates net value from supplies minus borrows', () => {
    const positions = [
      { side: 'supply', amount: '10000' },
      { side: 'supply', amount: '5000' },
      { side: 'borrow', amount: '3000' },
    ];

    const result = t.calculateNetValue(positions);
    // 10000 + 5000 - 3000 = 12000
    expect(result).toBe('12,000.00');
  });

  it('returns 0.00 for empty positions', () => {
    expect(t.calculateNetValue([])).toBe('0.00');
    expect(t.calculateNetValue(null)).toBe('0.00');
    expect(t.calculateNetValue(undefined)).toBe('0.00');
  });

  it('handles negative net value (more borrowed than supplied)', () => {
    const positions = [
      { side: 'supply', amount: '1000' },
      { side: 'borrow', amount: '5000' },
    ];
    const result = t.calculateNetValue(positions);
    // 1000 - 5000 = -4000
    expect(result).toBe('-4,000.00');
  });

  it('handles only supplies (no borrows)', () => {
    const result = t.calculateNetValue([
      { side: 'supply', amount: '10000' },
      { side: 'supply', amount: '20000' },
    ]);
    expect(result).toBe('30,000.00');
  });

  it('handles only borrows (no supplies)', () => {
    const result = t.calculateNetValue([
      { side: 'borrow', amount: '5000' },
    ]);
    expect(result).toBe('-5,000.00');
  });

  it('handles large numbers', () => {
    const result = t.calculateNetValue([
      { side: 'supply', amount: '1000000000' },
      { side: 'borrow', amount: '500000000' },
    ]);
    expect(result).toBe('500,000,000.00');
  });

  it('handles amounts with dollar signs and commas', () => {
    const result = t.calculateNetValue([
      { side: 'supply', amount: '$10,000' },
      { side: 'borrow', amount: '$3,000' },
    ]);
    expect(result).toBe('7,000.00');
  });

  it('handles zero values', () => {
    const result = t.calculateNetValue([
      { side: 'supply', amount: '0' },
      { side: 'borrow', amount: '0' },
    ]);
    expect(result).toBe('0.00');
  });
});

/* ──────────────────────────────────────────────
   calculateLTV (VAL-INTEGRATION-DATA-009)
   ────────────────────────────────────────────── */
describe('calculateLTV', () => {
  it('calculates LTV ratio as totalBorrow/totalSupply * 100', () => {
    const positions = [
      { side: 'supply', amount: '10000' },
      { side: 'borrow', amount: '3000' },
    ];

    const result = t.calculateLTV(positions);
    // 3000 / 10000 * 100 = 30%
    expect(result.ratio).toBe('30.00');
    expect(result.gaugeValue).toBe(30);
  });

  it('returns 0 for zero total supply', () => {
    const positions = [
      { side: 'borrow', amount: '3000' },
    ];

    const result = t.calculateLTV(positions);
    expect(result.ratio).toBe('0.00');
    expect(result.gaugeValue).toBe(0);
  });

  it('returns 0 for empty positions', () => {
    expect(t.calculateLTV([]).ratio).toBe('0.00');
    expect(t.calculateLTV(null).ratio).toBe('0.00');
    expect(t.calculateLTV(undefined).ratio).toBe('0.00');
  });

  it('returns 0 when both supply and borrow are 0', () => {
    const result = t.calculateLTV([
      { side: 'supply', amount: '0' },
      { side: 'borrow', amount: '0' },
    ]);
    expect(result.ratio).toBe('0.00');
    expect(result.gaugeValue).toBe(0);
  });

  it('caps gaugeValue at 100', () => {
    const result = t.calculateLTV([
      { side: 'supply', amount: '100' },
      { side: 'borrow', amount: '150' },
    ]);
    // 150/100 * 100 = 150% → gaugeValue capped at 100
    expect(parseFloat(result.ratio)).toBeGreaterThan(100);
    expect(result.gaugeValue).toBe(100);
  });

  it('handles fractional LTV values', () => {
    const result = t.calculateLTV([
      { side: 'supply', amount: '15000' },
      { side: 'borrow', amount: '1234' },
    ]);
    // 1234 / 15000 * 100 = 8.2266...
    const expected = ((1234 / 15000) * 100).toFixed(2);
    expect(result.ratio).toBe(expected);
    expect(result.gaugeValue).toBe(8); // Math.round(8.226) = 8
  });

  it('handles amounts with dollar signs and commas', () => {
    const result = t.calculateLTV([
      { side: 'supply', amount: '$10,000' },
      { side: 'borrow', amount: '$2,000' },
    ]);
    expect(result.ratio).toBe('20.00'); // 2000/10000*100 = 20%
    expect(result.gaugeValue).toBe(20);
  });

  it('handles only supplies (LTV 0%)', () => {
    const result = t.calculateLTV([
      { side: 'supply', amount: '5000' },
      { side: 'supply', amount: '3000' },
    ]);
    expect(result.ratio).toBe('0.00');
    expect(result.gaugeValue).toBe(0);
  });
});
