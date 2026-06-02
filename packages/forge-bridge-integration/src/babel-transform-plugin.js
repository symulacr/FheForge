(function () {
  'use strict';

  if (typeof Babel === 'undefined') return;

  /* ──────────────────────────────────────────────
     Initialize window.__MOCK__ and window.__BRIDGE__
     ────────────────────────────────────────────── */

  window.__MOCK__ = window.__MOCK__ || {};

  if (!window.__BRIDGE__) {
    window.__BRIDGE__ = {
      setMockData(key, value) {
        window.__MOCK__[key] = value;
        this._listeners.forEach(function (fn) { fn(key, value); });
      },
      getMockData(key) {
        return window.__MOCK__ != null ? window.__MOCK__[key] : undefined;
      },
      onDataUpdate(fn) {
        this._listeners.add(fn);
        var self = this;
        return function () { self._listeners.delete(fn); };
      },
      notify() {
        this._dataVersion++;
        this._listeners.forEach(function (fn) { fn(this._dataVersion); }.bind(this));
      },
      _listeners: new Set(),
      _dataVersion: 0,
    };
  }

  /* ──────────────────────────────────────────────
     MOCK_CONSTANTS — 11 module-scoped constants
     ────────────────────────────────────────────── */

  var MOCK_CONSTANTS = new Set([
    'D_POSITIONS',
    'D_STRATS',
    'D_ACTIVITY',
    'L_MARKETS',
    'COMMUNITY',
    'PROPOSALS',
    'NODE_TYPES',
    'TEMPLATES',
    'DEFAULT_CONFIG',
    'TICKER_ITEMS',
    'DEMO_ROWS',
  ]);

  /* ──────────────────────────────────────────────
     VALUE_TO_MOCK_KEY — Cipher value → mock key
     ────────────────────────────────────────────── */

  var VALUE_TO_MOCK_KEY = {
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

  /* ──────────────────────────────────────────────
     Helper: build window.__MOCK__?.KEY reference
     ────────────────────────────────────────────── */

  function buildMockRef(t, key) {
    // window?.__MOCK__?.key
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

  /* ──────────────────────────────────────────────
     Plugin: mockDataPlugin — 3 visitors
     ────────────────────────────────────────────── */

  var mockDataPlugin = function (api) {
    var t = api.types;

    return {
      name: 'mock-data',
      visitor: {
        /* ------------------------------------------------------
           1. VariableDeclarator
              const X = val  →  var X = window.__MOCK__?.X ?? val
           ------------------------------------------------------ */
        VariableDeclarator: function (path) {
          var varName = path.node.id && path.node.id.name;
          if (!varName || !MOCK_CONSTANTS.has(varName)) return;

          var parentDecl = path.findParent(function (p) { return p.isVariableDeclaration(); });
          if (!parentDecl) return;

          // Change declaration kind to "var" (hoisted, re-assignable)
          parentDecl.node.kind = 'var';

          // Wrap init: window.__MOCK__?.X ?? originalValue
          path.node.init = t.logicalExpression(
            '??',
            buildMockRef(t, varName),
            path.node.init
          );
        },

        /* ------------------------------------------------------
           2. Identifier
              <MDList items={D_POSITIONS}>
              → <MDList items={window.__MOCK__?.D_POSITIONS ?? D_POSITIONS}>
           ------------------------------------------------------ */
        Identifier: function (path) {
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

        /* ------------------------------------------------------
           3. JSXAttribute
              <Cipher value="68,412.07" locked={locked} />
              → <Cipher value={window.__MOCK__?.PORTFOLIO_NET_VALUE ?? "68,412.07"} locked={locked} />
           ------------------------------------------------------ */
        JSXAttribute: function (path) {
          var attrName = path.node.name && path.node.name.name;
          if (attrName !== 'value') return;

          // Check parent element is <Cipher>
          var openingElement = path.parentPath && path.parentPath.parent && path.parentPath.parent.openingElement;
          if (!openingElement) return;
          var tagName = openingElement.name && openingElement.name.name;
          if (tagName !== 'Cipher') return;

          var attrValue = path.node.value;
          if (!attrValue || attrValue.type !== 'StringLiteral') return;

          var mockKey = VALUE_TO_MOCK_KEY[attrValue.value];
          if (!mockKey) return;

          // Replace string literal with JSX expression container
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

  /* ──────────────────────────────────────────────
     Monkey-patch Babel.transform
     Save original, inject plugin before all calls
     ────────────────────────────────────────────── */

  var origTransform = Babel.transform;

  Babel.transform = function (code, options) {
    options = options || {};
    options.plugins = options.plugins ? options.plugins.slice() : [];
    options.plugins.unshift(mockDataPlugin);
    return origTransform.call(this, code, options);
  };
})();
