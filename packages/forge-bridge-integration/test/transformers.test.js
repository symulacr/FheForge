/**
 * Transformer Functions Tests
 *
 * Tests all pure transformation functions defined in transformers.js.
 */

import { describe, it, expect } from 'bun:test';

// Browser globals (window) set up by test/setup.js

import '../src/transformers.js';

const t = globalThis.window.__transformers;

describe('transformMarkets', () => {
  it('returns empty array for null/undefined input', () => {
    expect(t.transformMarkets(null)).toEqual([]);
    expect(t.transformMarkets(undefined)).toEqual([]);
    expect(t.transformMarkets('not-array')).toEqual([]);
  });

  it('transforms API market shape to forge format', () => {
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
    expect(result[0].supplyApy).toBe('3.45%');
    expect(result[0].borrowApy).toBe('5.67%');
    expect(result[0].util).toBe(72);
    expect(result[0].tvl).toBe('1000000');
    expect(result[0].liq).toBe('500000');
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
  });
});

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
    expect(result[1].side).toBe('borrow');
    expect(result[1].asset).toBe('USDC');
  });

  it('returns empty array for null inputs', () => {
    expect(t.transformPositions(null, null, null)).toEqual([]);
    expect(t.transformPositions([], [], [])).toEqual([]);
  });
});

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
  });

  it('returns empty array for null input', () => {
    expect(t.transformActivities(null)).toEqual([]);
  });
});

describe('formatTicker', () => {
  it('returns exactly 9 strings', () => {
    const stats = {
      blockNumber: '12345678',
      gasPrice: '12.5',
      poolTvl: '$10M',
      vaultTvl: '$5M',
      composerTvl: '$2M',
      encryptedOps: '1,234',
      dailyPermits: '567',
      activeStrategies: '42',
      composerDeploys: '18',
    };

    const result = t.formatTicker(stats);
    expect(result).toHaveLength(9);
    expect(result[0]).toContain('12345678');
    expect(result[1]).toContain('12.5');
    expect(result[2]).toContain('$10M');
  });

  it('handles empty stats gracefully', () => {
    const result = t.formatTicker({});
    expect(result).toHaveLength(9);
    result.forEach(s => expect(s).toBeTruthy());
  });
});

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
    expect(result[0].name).toBe('Yield Optimizer');
    expect(result[0].apy).toBe('12.50%');
  });

  it('returns empty array for null input', () => {
    expect(t.transformStrategies(null)).toEqual([]);
  });
});

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
    expect(result[0].title).toBe('Increase ETH Collateral Factor');
    expect(result[0].status).toBe('active');
    expect(result[0].forVotes).toBe('1000000');
  });

  it('returns empty array for null input', () => {
    expect(t.transformProposals(null)).toEqual([]);
  });
});

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
  });

  it('maps modules to node types', () => {
    const modules = [
      { id: 'custom-supply', action: 'supply', protocol: 'AAVE', name: 'Aave Supply' },
      { id: 'custom-borrow', action: 'borrow', protocol: 'Compound', name: 'Compound Borrow' },
    ];

    const result = t.transformNodeTypes(modules);
    expect(result['custom-supply']).toBeDefined();
    expect(result['custom-supply'].label).toBe('Supply');
    expect(result['custom-supply'].protocol).toBe('AAVE');
    expect(result['custom-borrow'].label).toBe('Borrow');
    expect(result['custom-borrow'].protocol).toBe('Compound');
  });
});

describe('calculateNetValue', () => {
  it('calculates net value from positions', () => {
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
  });
});

describe('calculateLTV', () => {
  it('calculates LTV ratio', () => {
    const positions = [
      { side: 'supply', amount: '10000' },
      { side: 'borrow', amount: '3000' },
    ];

    const result = t.calculateLTV(positions);
    // 3000 / 10000 * 100 = 30%
    expect(result.ratio).toBe('30.00');
    expect(result.gaugeValue).toBe(30);
  });

  it('returns 0 for no supply', () => {
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
  });
});
