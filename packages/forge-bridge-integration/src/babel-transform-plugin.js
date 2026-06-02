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

        /* ------------------------------------------------------
           4. Program.exit (v2)
              ReactDOM.createRoot(...).render(<App />)
              → ReactDOM.createRoot(...).render(
                  React.createElement(ForgeProvider, null, <App />)
                )
              Injects ForgeProvider wrapper around the root App component.
              Runs after all other transforms complete.
           ------------------------------------------------------ */
        Program: {
          exit: function (path) {
            path.traverse({
              CallExpression: function (nodePath) {
                var callee = nodePath.node.callee;

                // Must be xxx.render(...)
                if (!t.isMemberExpression(callee)) return;
                if (!t.isIdentifier(callee.property) || callee.property.name !== 'render') return;

                // The object must be ReactDOM.createRoot(...)
                var object = callee.object;
                if (!t.isCallExpression(object)) return;

                var objectCallee = object.callee;
                if (!t.isMemberExpression(objectCallee)) return;
                if (!t.isIdentifier(objectCallee.object) || objectCallee.object.name !== 'ReactDOM') return;
                if (!t.isIdentifier(objectCallee.property) || objectCallee.property.name !== 'createRoot') return;

                // Found ReactDOM.createRoot(...).render(...)
                // Get the first render argument (the App component element)
                var renderArg = nodePath.node.arguments[0];
                if (!renderArg) return;

                // Wrap with ForgeProvider:
                //   React.createElement(ForgeProvider, null, renderArg)
                nodePath.node.arguments[0] = t.callExpression(
                  t.memberExpression(t.identifier('React'), t.identifier('createElement')),
                  [t.identifier('ForgeProvider'), t.nullLiteral(), renderArg]
                );
              },
            });
          },
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

  /* ──────────────────────────────────────────────
     Override Babel.transformScriptTags

     Babel standalone uses an INTERNAL transform function reference
     (the minified variable FEe) to process text/babel scripts—
     NOT the public Babel.transform API.  Our monkey-patch of
     Babel.transform therefore has NO EFFECT on text/babel scripts.

     Fix: replace Babel.transformScriptTags entirely so that it
     calls the patched Babel.transform instead of the internal
     FEe closure.

     This reimplements the same logic (find text/babel scripts,
     load external src via XHR, transform, append to <head>) but
     feeds all input through Babel.transform, which now includes
     the mockDataPlugin.
     ────────────────────────────────────────────── */

  (function () {
    if (typeof Babel.transformScriptTags !== 'function') return;

    var SCRIPT_TYPES = new Set(['text/jsx', 'text/babel']);

    /**
     * Build Babel options compatible with what the internal
     * buildBabelOptions produces for plain scripts.
     */
    function buildOptions(scriptEl, filename) {
      return {
        filename: filename,
        presets: ['react', 'env'],
        sourceMaps: 'inline',
        sourceFileName: filename,
      };
    }

    /**
     * Process text/babel scripts using Babel.transform (patched).
     * Mirrors the original runScripts + loadScripts + run pipeline.
     */
    function runScriptsWithPatchedTransform(scripts) {
      var headEl = document.getElementsByTagName('head')[0];
      if (!headEl) headEl = document.head || document.documentElement;

      if (!scripts) {
        scripts = document.getElementsByTagName('script');
      }

      // Collect text/babel scripts in document order
      var jsxScripts = [];
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts.item ? scripts.item(i) : scripts[i];
        var type = (s.type || '').split(';')[0];
        if (SCRIPT_TYPES.has(type)) {
          jsxScripts.push(s);
        }
      }

      if (jsxScripts.length === 0) return;

      console.warn(
        'You are using the in-browser Babel transformer. ' +
        'Be sure to precompile your scripts for production - https://babeljs.io/docs/setup/',
      );

      // ── Load scripts sequentially ──────────────────────
      var contents = [];
      var loaded = 0;

      function loadNext(idx) {
        if (idx >= jsxScripts.length) {
          // All loaded — transform and execute in order
          flushAll();
          return;
        }

        var script = jsxScripts[idx];
        var src = script.getAttribute('src');

        if (src) {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', src, true);
          if ('overrideMimeType' in xhr) xhr.overrideMimeType('text/plain');
          xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
              if (xhr.status === 0 || xhr.status === 200) {
                contents[idx] = xhr.responseText;
              } else {
                console.error('[BabelPlugin] Could not load script:', src);
                contents[idx] = null;
              }
              loadNext(idx + 1);
            }
          };
          xhr.send(null);
        } else {
          contents[idx] = script.innerHTML;
          loadNext(idx + 1);
        }
      }

      function flushAll() {
        for (var j = 0; j < jsxScripts.length; j++) {
          var content = contents[j];
          if (content === null || content === undefined) continue;

          var scriptEl = jsxScripts[j];
          var filename = scriptEl.getAttribute('src') || 'Inline Babel script';

          try {
            var result = Babel.transform(content, buildOptions(scriptEl, filename));
            var out = document.createElement('script');
            out.text = result.code;
            headEl.appendChild(out);
          } catch (err) {
            console.error('[BabelPlugin] Transform error for', filename, err);
          }
        }
      }

      loadNext(0);
    }

    // Replace the built-in transformScriptTags with our version
    Babel.transformScriptTags = runScriptsWithPatchedTransform;

    // Babel.disableScriptTags() was called right after Babel loaded, so the
    // auto-processing on DOMContentLoaded was suppressed.  Now that our
    // patched transformScriptTags is in place, trigger the processing of
    // all text/babel scripts manually.
    if (typeof runScriptsWithPatchedTransform === 'function') {
      runScriptsWithPatchedTransform();
    }
  })();
})();
