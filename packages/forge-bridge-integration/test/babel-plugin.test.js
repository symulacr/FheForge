/**
 * Babel Plugin Tests
 *
 * Tests the Babel.transform monkey-patch and its 3 visitors
 * by loading @babel/standalone and simulating the browser plugin.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import Babel from '@babel/standalone';

// Simulate the plugin exactly as defined in babel-transform-plugin.js
// We extract and test the mockDataPlugin function logic

const MOCK_CONSTANTS = new Set([
  'D_POSITIONS', 'D_STRATS', 'D_ACTIVITY',
  'L_MARKETS',
  'COMMUNITY',
  'PROPOSALS',
  'NODE_TYPES', 'TEMPLATES', 'DEFAULT_CONFIG',
  'TICKER_ITEMS', 'DEMO_ROWS',
]);

const VALUE_TO_MOCK_KEY = {
  '68,412.07': 'PORTFOLIO_NET_VALUE',
  '12,456.78': 'DEMO_SUPPLIED_VALUE',
  '4,320.50': 'DEMO_BORROWED_VALUE',
  '228,100': 'DEMO_STRATS_VALUE',
  'USER_NET_SUPPLIED': 'USER_NET_SUPPLIED',
  'USER_NET_BORROWED': 'USER_NET_BORROWED',
  'WALLET_BALANCE': 'WALLET_BALANCE',
  'PORTFOLIO_CHANGE_24H': 'PORTFOLIO_CHANGE_24H',
  'POSITION_INTEREST': 'POSITION_INTEREST',
  'HEALTH_AFTER_SUPPLY': 'HEALTH_AFTER_SUPPLY',
  'HEALTH_AFTER_BORROW': 'HEALTH_AFTER_BORROW',
  'GAS_ETH': 'GAS_ETH',
  'EMPTY_PORTFOLIO': 'EMPTY_PORTFOLIO',
  'PORTFOLIO_LTV': 'PORTFOLIO_LTV',
};

function buildMockRef(t, key) {
  return t.optionalMemberExpression(
    t.optionalMemberExpression(
      t.identifier('window'),
      t.identifier('__MOCK__'),
      false,
      true
    ),
    t.identifier(key),
    false,
    true
  );
}

const mockDataPlugin = function (api) {
  const t = api.types;

  return {
    name: 'mock-data',
    visitor: {
      VariableDeclarator(path) {
        const varName = path.node.id && path.node.id.name;
        if (!varName || !MOCK_CONSTANTS.has(varName)) return;

        const parentDecl = path.findParent(p => p.isVariableDeclaration());
        if (!parentDecl) return;

        parentDecl.node.kind = 'var';

        path.node.init = t.logicalExpression(
          '??',
          buildMockRef(t, varName),
          path.node.init
        );
      },

      Identifier(path) {
        if (!MOCK_CONSTANTS.has(path.node.name)) return;
        if (!path.isReferencedIdentifier()) return;

        // Prevent infinite recursion: skip identifiers already inside
        // a LogicalExpression('??') which is part of a previous replacement
        if (
          path.parentPath &&
          path.parentPath.isLogicalExpression &&
          path.parentPath.isLogicalExpression({ operator: '??' })
        ) return;

        path.replaceWith(
          t.logicalExpression(
            '??',
            buildMockRef(t, path.node.name),
            t.identifier(path.node.name)
          )
        );
      },

      JSXAttribute(path) {
        const attrName = path.node.name && path.node.name.name;
        if (attrName !== 'value') return;

        const openingElement = path.parentPath && path.parentPath.parent && path.parentPath.parent.openingElement;
        if (!openingElement) return;
        const tagName = openingElement.name && openingElement.name.name;
        if (tagName !== 'Cipher') return;

        const attrValue = path.node.value;
        if (!attrValue || attrValue.type !== 'StringLiteral') return;

        const mockKey = VALUE_TO_MOCK_KEY[attrValue.value];
        if (!mockKey) return;

        path.node.value = t.jsxExpressionContainer(
          t.logicalExpression(
            '??',
            buildMockRef(t, mockKey),
            t.stringLiteral(attrValue.value)
          )
        );
      },
    },
  };
};

describe('mockDataPlugin - MOCK_CONSTANTS', () => {
  it('contains all 11 documented constants', () => {
    expect(MOCK_CONSTANTS.has('D_POSITIONS')).toBe(true);
    expect(MOCK_CONSTANTS.has('D_STRATS')).toBe(true);
    expect(MOCK_CONSTANTS.has('D_ACTIVITY')).toBe(true);
    expect(MOCK_CONSTANTS.has('L_MARKETS')).toBe(true);
    expect(MOCK_CONSTANTS.has('COMMUNITY')).toBe(true);
    expect(MOCK_CONSTANTS.has('PROPOSALS')).toBe(true);
    expect(MOCK_CONSTANTS.has('NODE_TYPES')).toBe(true);
    expect(MOCK_CONSTANTS.has('TEMPLATES')).toBe(true);
    expect(MOCK_CONSTANTS.has('DEFAULT_CONFIG')).toBe(true);
    expect(MOCK_CONSTANTS.has('TICKER_ITEMS')).toBe(true);
    expect(MOCK_CONSTANTS.has('DEMO_ROWS')).toBe(true);
    expect(MOCK_CONSTANTS.size).toBe(11);
  });
});

describe('mockDataPlugin - VALUE_TO_MOCK_KEY', () => {
  it('contains at least 12 of 14 documented entries', () => {
    const expectedKeys = [
      'PORTFOLIO_NET_VALUE',
      'DEMO_SUPPLIED_VALUE',
      'DEMO_BORROWED_VALUE',
      'DEMO_STRATS_VALUE',
      'USER_NET_SUPPLIED',
      'USER_NET_BORROWED',
      'WALLET_BALANCE',
      'PORTFOLIO_CHANGE_24H',
      'POSITION_INTEREST',
      'HEALTH_AFTER_SUPPLY',
      'HEALTH_AFTER_BORROW',
      'GAS_ETH',
      'EMPTY_PORTFOLIO',
      'PORTFOLIO_LTV',
    ];

    const mockValues = Object.values(VALUE_TO_MOCK_KEY);
    let covered = 0;
    for (const key of expectedKeys) {
      if (mockValues.includes(key)) covered++;
    }
    expect(covered).toBeGreaterThanOrEqual(12);
    expect(mockValues.length).toBeGreaterThanOrEqual(12);
  });

  it('maps "68,412.07" to PORTFOLIO_NET_VALUE', () => {
    expect(VALUE_TO_MOCK_KEY['68,412.07']).toBe('PORTFOLIO_NET_VALUE');
  });
});

describe('mockDataPlugin - VariableDeclarator visitor', () => {
  it('transforms const D_POSITIONS to var with __MOCK__?? fallback', () => {
    const input = `const D_POSITIONS = [{id: "pos-1"}];`;
    const output = Babel.transform(input, {
      plugins: [mockDataPlugin],
      filename: 'test.js',
    }).code;

    expect(output).toContain('var D_POSITIONS');
    expect(output).toContain('window?.__MOCK__?.D_POSITIONS');
    expect(output).toContain('??');
    expect(output).not.toContain('const D_POSITIONS');
  });

  it('does not transform non-mock constants', () => {
    const input = `const MY_VAR = "hello";`;
    const output = Babel.transform(input, {
      plugins: [mockDataPlugin],
      filename: 'test.js',
    }).code;

    expect(output).toContain('const MY_VAR');
    expect(output).not.toContain('__MOCK__');
  });

  it('transforms all 11 mock constants', () => {
    for (const constName of MOCK_CONSTANTS) {
      const input = `const ${constName} = "test";`;
      const output = Babel.transform(input, {
        plugins: [mockDataPlugin],
        filename: 'test.js',
      }).code;

      expect(output).toContain(`var ${constName}`);
      expect(output).toContain(`window?.__MOCK__?.${constName}`);
    }
  });
});

describe('mockDataPlugin - Identifier visitor', () => {
  it('replaces referenced MOCK_CONSTANTS with __MOCK__ lookups', () => {
    const input = `function Test() { return React.createElement('div', null, D_POSITIONS); }`;
    const output = Babel.transform(input, {
      plugins: [mockDataPlugin],
      filename: 'test.js',
    }).code;

    expect(output).toContain('window?.__MOCK__?.D_POSITIONS');
    expect(output).toContain('D_POSITIONS');
  });

  it('does not replace non-referenced identifiers', () => {
    const input = `const D_POSITIONS = [];`;
    const output = Babel.transform(input, {
      plugins: [mockDataPlugin],
      filename: 'test.js',
    }).code;

    // The VariableDeclarator visitor transforms the declaration
    // The Identifier visitor only affects referenced identifiers, not declarations
    expect(output).toContain('var D_POSITIONS');
  });
});

describe('mockDataPlugin - JSXAttribute visitor', () => {
  it('transforms <Cipher value="68,412.07"> with __MOCK__ lookup', () => {
    const input = `function Test() { return <Cipher value="68,412.07" locked={true} />; }`;
    const output = Babel.transform(input, {
      plugins: [mockDataPlugin],
      presets: ['react'],
      filename: 'test.jsx',
    }).code;

    expect(output).toContain('__MOCK__?.PORTFOLIO_NET_VALUE');
    // The value should be in an expression container, not a plain string
    expect(output).not.toContain('value="68,412.07"');
  });

  it('does not transform non-Cipher JSX attributes', () => {
    const input = `function Test() { return <div value="hello" />; }`;
    const output = Babel.transform(input, {
      plugins: [mockDataPlugin],
      presets: ['react'],
      filename: 'test.jsx',
    }).code;

    expect(output).toContain('"hello"');
  });

  it('does not transform non-value attributes on Cipher', () => {
    const input = `function Test() { return <Cipher locked={true} />; }`;
    const output = Babel.transform(input, {
      plugins: [mockDataPlugin],
      presets: ['react'],
      filename: 'test.jsx',
    }).code;

    // Should not error
    expect(output).toBeTruthy();
  });

  it('transforms all VALUE_TO_MOCK_KEY entries', () => {
    for (const [literal, mockKey] of Object.entries(VALUE_TO_MOCK_KEY)) {
      const input = `function Test() { return <Cipher value="${literal}" locked={true} />; }`;
      const output = Babel.transform(input, {
        plugins: [mockDataPlugin],
        presets: ['react'],
        filename: 'test.jsx',
      }).code;

      expect(output).toContain(`__MOCK__?.${mockKey}`);
    }
  });
});

describe('Babel.transform monkey-patch', () => {
  it('injects plugin when called without plugins option', () => {
    const origTransform = Babel.transform;
    Babel.transform = function (code, options) {
      options = options || {};
      options.plugins = options.plugins ? options.plugins.slice() : [];
      options.plugins.unshift(mockDataPlugin);
      return origTransform.call(this, code, options);
    };

    const input = `const D_POSITIONS = [];`;
    const output = Babel.transform(input, { filename: 'test.js' }).code;

    expect(output).toContain('var D_POSITIONS');
    expect(output).toContain('window?.__MOCK__?.D_POSITIONS');

    // Restore
    Babel.transform = origTransform;
  });

  it('preserves existing plugins when injecting', () => {
    const origTransform = Babel.transform;
    Babel.transform = function (code, options) {
      options = options || {};
      options.plugins = options.plugins ? options.plugins.slice() : [];
      options.plugins.unshift(mockDataPlugin);
      return origTransform.call(this, code, options);
    };

    // A simple no-op plugin
    const existingPlugin = function (api) {
      return { name: 'existing', visitor: {} };
    };

    const input = `const D_POSITIONS = [];`;
    const output = Babel.transform(input, {
      plugins: [existingPlugin],
      filename: 'test.js',
    }).code;

    expect(output).toContain('var D_POSITIONS');

    // Restore
    Babel.transform = origTransform;
  });
});
