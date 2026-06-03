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
     MOCK_CONSTANTS — 13 module/function-scoped constants
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
    // Function-scoped variable names in landing.jsx mapped to __MOCK__ keys
    'items',  // Ticker() → maps to TICKER_ITEMS
    'rows',   // DemoCard() → maps to DEMO_ROWS
  ]);

  /* ──────────────────────────────────────────────
     VARIABLE_TO_MOCK_KEY — Maps function-scoped
     variable names to their __MOCK__ key.
     Used when the variable name differs from
     the mock key (e.g. 'items' → 'TICKER_ITEMS').
     ────────────────────────────────────────────── */

  var VARIABLE_TO_MOCK_KEY = {
    'items': 'TICKER_ITEMS',
    'rows': 'DEMO_ROWS',
  };

  /* ──────────────────────────────────────────────
     VALUE_TO_MOCK_KEY — Cipher value → mock key
     ────────────────────────────────────────────── */

  var VALUE_TO_MOCK_KEY = {
    '68,412.07': 'PORTFOLIO_NET_VALUE',
  };

  /* ──────────────────────────────────────────────
     Helper: build window.__MOCK__.KEY reference
     ────────────────────────────────────────────── */

  function buildMockRef(t, key) {
    // window.__MOCK__.key
    return t.memberExpression(
      t.memberExpression(
        t.identifier('window'),
        t.identifier('__MOCK__'),
        false
      ),
      t.identifier(key),
      false
    );
  }

  /* ──────────────────────────────────────────────
     Plugin: mockDataPlugin — 4 visitors
     ────────────────────────────────────────────── */

  var mockDataPlugin = function (api) {
    var t = api.types;
    var renderCallPaths = [];

    return {
      name: 'mock-data',
      visitor: {
        /* ------------------------------------------------------
           1. VariableDeclarator
              const X = val  →  var X = window.__MOCK__.Y != null ? window.__MOCK__.Y : val
              where Y = VARIABLE_TO_MOCK_KEY[X] || X
           ------------------------------------------------------ */
        VariableDeclarator: function (path) {
          var varName = path.node.id && path.node.id.name;
          if (!varName || !MOCK_CONSTANTS.has(varName)) return;

          var parentDecl = path.findParent(function (p) { return p.isVariableDeclaration(); });
          if (!parentDecl) return;

          // Change declaration kind to "var" (hoisted, re-assignable)
          parentDecl.node.kind = 'var';

          // Resolve mock key: use mapping when varName differs from __MOCK__ key
          var mockKey = VARIABLE_TO_MOCK_KEY[varName] || varName;

          // Wrap init: window.__MOCK__.Y != null ? window.__MOCK__.Y : originalValue
          var mockRef = buildMockRef(t, mockKey);
          path.node.init = t.conditionalExpression(
            t.binaryExpression('!=', mockRef, t.nullLiteral()),
            mockRef,
            path.node.init
          );
        },

        /* ------------------------------------------------------
           2. JSXAttribute
              <Cipher value="68,412.07" locked={locked} />
              → <Cipher value={window.__MOCK__.PORTFOLIO_NET_VALUE != null ? window.__MOCK__.PORTFOLIO_NET_VALUE : "68,412.07"} locked={locked} />
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
          var mockRef = buildMockRef(t, mockKey);
          path.node.value = t.jsxExpressionContainer(
            t.conditionalExpression(
              t.binaryExpression('!=', mockRef, t.nullLiteral()),
              mockRef,
              t.stringLiteral(attrValue.value)
            )
          );
        },

        /* ------------------------------------------------------
           3. CallExpression — collect render call paths
              ReactDOM.createRoot(...).render(<App />) — collected
              for processing in Program.exit.
           ------------------------------------------------------ */
        CallExpression: function (path) {
          var callee = path.node.callee;

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
          renderCallPaths.push(path);
        },

        /* ------------------------------------------------------
           4. Program.exit (v2)
              ReactDOM.createRoot(...).render(<App />)
              → ReactDOM.createRoot(...).render(
                  React.createElement(ForgeProvider, null, <App />)
                )
              Processes accumulated CallExpression paths.
           ------------------------------------------------------ */
        Program: {
          exit: function (path) {
            for (var i = 0; i < renderCallPaths.length; i++) {
              var nodePath = renderCallPaths[i];
              var renderArg = nodePath.node.arguments[0];
              if (!renderArg) continue;

              // Wrap with ForgeProvider:
              //   React.createElement(ForgeProvider, null, renderArg)
              nodePath.node.arguments[0] = t.callExpression(
                t.memberExpression(t.identifier('React'), t.identifier('createElement')),
                [t.identifier('ForgeProvider'), t.nullLiteral(), renderArg]
              );
            }
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
        presets: ['react', ['env', { targets: { esmodules: true } }]],
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

      // Suppress the standard Babel in-browser transformer warning.
      // This is a dev-only setup where in-browser transformation is intentional.
      // The production build will precompile all scripts.
      // To re-enable: set window.__BABEL_WARN__ = true before this script loads.
      if (window.__BABEL_WARN__) {
        console.warn(
          'You are using the in-browser Babel transformer. ' +
          'Be sure to precompile your scripts for production - https://babeljs.io/docs/setup/',
        );
      }

      // ── Load scripts sequentially ──────────────────────
      var contents = [];
      var loaded = 0;

      function loadNext(idx) {
        if (idx >= jsxScripts.length) {
          // All loaded — transform and execute in order
          flushAll();
          return;
        }

        try {
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
        } catch (err) {
          console.error('[BabelTransform] Failed to process script:', script.getAttribute('src') || 'inline', err);
          contents[idx] = null;
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
            console.error('[BabelTransform] Failed to process script:', filename, err);
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
    // all text/babel scripts after DOM is fully parsed (so text/babel
    // <script> elements exist in the DOM).
    function processScripts() {
      if (typeof runScriptsWithPatchedTransform === 'function') {
        runScriptsWithPatchedTransform();
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', processScripts);
    } else {
      processScripts();
    }
  })();
})();
