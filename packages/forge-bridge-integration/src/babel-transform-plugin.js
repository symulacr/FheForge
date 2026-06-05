(() => {
  if (typeof Babel === 'undefined') return;

  /* ──────────────────────────────────────────────
     Initialize window.__MOCK__ and window.__BRIDGE__
     ────────────────────────────────────────────── */

  window.__MOCK__ = window.__MOCK__ || {};

  if (!window.__BRIDGE__) {
    window.__BRIDGE__ = {
      setMockData(key, value) {
        window.__MOCK__[key] = value;
        this._listeners.forEach((fn) => {
          fn(key, value);
        });
      },
      getMockData(key) {
        return window.__MOCK__ != null ? window.__MOCK__[key] : undefined;
      },
      onDataUpdate(fn) {
        this._listeners.add(fn);

        return () => {
          this._listeners.delete(fn);
        };
      },
      notify() {
        this._dataVersion++;
        this._listeners.forEach(
          function (fn) {
            fn(this._dataVersion);
          }.bind(this),
        );
      },
      _listeners: new Set(),
      _dataVersion: 0,
    };
  }

  /* ──────────────────────────────────────────────
     MOCK_CONSTANTS — 13 module/function-scoped constants
     ────────────────────────────────────────────── */

  const MOCK_CONSTANTS = new Set([
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
    'items', // Ticker() → maps to TICKER_ITEMS
    'rows', // DemoCard() → maps to DEMO_ROWS
  ]);

  /* ──────────────────────────────────────────────
     VARIABLE_TO_MOCK_KEY — Maps function-scoped
     variable names to their __MOCK__ key.
     Used when the variable name differs from
     the mock key (e.g. 'items' → 'TICKER_ITEMS').
     ────────────────────────────────────────────── */

  const VARIABLE_TO_MOCK_KEY = {
    items: 'TICKER_ITEMS',
    rows: 'DEMO_ROWS',
  };

  /* ──────────────────────────────────────────────
     VALUE_TO_MOCK_KEY — Cipher value → mock key
     ────────────────────────────────────────────── */

  const VALUE_TO_MOCK_KEY = {
    '68,412.07': 'PORTFOLIO_NET_VALUE',
  };

  /* ──────────────────────────────────────────────
     Helper: build window.__MOCK__.KEY reference
     ────────────────────────────────────────────── */

  function buildMockRef(t, key) {
    // window.__MOCK__.key
    return t.memberExpression(
      t.memberExpression(t.identifier('window'), t.identifier('__MOCK__'), false),
      t.identifier(key),
      false,
    );
  }

  /* ──────────────────────────────────────────────
     Plugin: mockDataPlugin — 4 visitors
     ────────────────────────────────────────────── */

  const mockDataPlugin = (api) => {
    const t = api.types;
    const renderCallPaths = [];

    return {
      name: 'mock-data',
      visitor: {
        /* ------------------------------------------------------
           1. VariableDeclarator
              const X = val  →  var X = window.__MOCK__.Y != null ? window.__MOCK__.Y : val
              where Y = VARIABLE_TO_MOCK_KEY[X] || X
           ------------------------------------------------------ */
        VariableDeclarator: (path) => {
          const varName = path.node.id?.name;
          if (!varName || !MOCK_CONSTANTS.has(varName)) return;

          const parentDecl = path.findParent((p) => p.isVariableDeclaration());
          if (!parentDecl) return;

          // Change declaration kind to "var" (hoisted, re-assignable)
          parentDecl.node.kind = 'var';

          // Resolve mock key: use mapping when varName differs from __MOCK__ key
          const mockKey = VARIABLE_TO_MOCK_KEY[varName] || varName;

          // Wrap init: window.__MOCK__.Y != null ? window.__MOCK__.Y : originalValue
          const mockRef = buildMockRef(t, mockKey);
          path.node.init = t.conditionalExpression(
            t.binaryExpression('!=', mockRef, t.nullLiteral()),
            mockRef,
            path.node.init,
          );
        },

        /* ------------------------------------------------------
           2. JSXAttribute
              <Cipher value="68,412.07" locked={locked} />
              → <Cipher value={window.__MOCK__.PORTFOLIO_NET_VALUE != null ? window.__MOCK__.PORTFOLIO_NET_VALUE : "68,412.07"} locked={locked} />
           ------------------------------------------------------ */
        JSXAttribute: (path) => {
          const attrName = path.node.name?.name;
          if (attrName !== 'value') return;

          // Check parent element is <Cipher>
          const openingElement = path.parentPath?.parent?.openingElement;
          if (!openingElement) return;
          const tagName = openingElement.name?.name;
          if (tagName !== 'Cipher') return;

          const attrValue = path.node.value;
          if (attrValue?.type !== 'StringLiteral') return;

          const mockKey = VALUE_TO_MOCK_KEY[attrValue.value];
          if (!mockKey) return;

          // Replace string literal with JSX expression container
          const mockRef = buildMockRef(t, mockKey);
          path.node.value = t.jsxExpressionContainer(
            t.conditionalExpression(
              t.binaryExpression('!=', mockRef, t.nullLiteral()),
              mockRef,
              t.stringLiteral(attrValue.value),
            ),
          );
        },

        /* ------------------------------------------------------
           3. CallExpression — collect render call paths
              ReactDOM.createRoot(...).render(<App />) — collected
              for processing in Program.exit.
           ------------------------------------------------------ */
        CallExpression: (path) => {
          const callee = path.node.callee;

          // Must be xxx.render(...)
          if (!t.isMemberExpression(callee)) return;
          if (!t.isIdentifier(callee.property) || callee.property.name !== 'render') return;

          // The object must be ReactDOM.createRoot(...)
          const object = callee.object;
          if (!t.isCallExpression(object)) return;

          const objectCallee = object.callee;
          if (!t.isMemberExpression(objectCallee)) return;
          if (!t.isIdentifier(objectCallee.object) || objectCallee.object.name !== 'ReactDOM')
            return;
          if (!t.isIdentifier(objectCallee.property) || objectCallee.property.name !== 'createRoot')
            return;

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
          exit: (_path) => {
            for (let i = 0; i < renderCallPaths.length; i++) {
              const nodePath = renderCallPaths[i];
              const renderArg = nodePath.node.arguments[0];
              if (!renderArg) continue;

              // Wrap with ForgeProvider:
              //   React.createElement(ForgeProvider, null, renderArg)
              nodePath.node.arguments[0] = t.callExpression(
                t.memberExpression(t.identifier('React'), t.identifier('createElement')),
                [t.identifier('ForgeProvider'), t.nullLiteral(), renderArg],
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

  const origTransform = Babel.transform;

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

  (() => {
    if (typeof Babel.transformScriptTags !== 'function') return;

    const SCRIPT_TYPES = new Set(['text/jsx', 'text/babel']);

    /**
     * Build Babel options compatible with what the internal
     * buildBabelOptions produces for plain scripts.
     */
    function buildOptions(_scriptEl, filename) {
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
      let headEl = document.getElementsByTagName('head')[0];
      if (!headEl) headEl = document.head || document.documentElement;

      if (!scripts) {
        scripts = document.getElementsByTagName('script');
      }

      // Collect text/babel scripts in document order
      const jsxScripts = [];
      for (let i = 0; i < scripts.length; i++) {
        const s = scripts.item ? scripts.item(i) : scripts[i];
        const type = (s.type || '').split(';')[0];
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
      const contents = [];
      const _loaded = 0;

      function loadNext(idx) {
        if (idx >= jsxScripts.length) {
          // All loaded — transform and execute in order
          flushAll();
          return;
        }

        try {
          const script = jsxScripts[idx];
          const src = script.getAttribute('src');

          if (src) {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', src, true);
            if ('overrideMimeType' in xhr) xhr.overrideMimeType('text/plain');
            xhr.onreadystatechange = () => {
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
          console.error(
            '[BabelTransform] Failed to process script:',
            script.getAttribute('src') || 'inline',
            err,
          );
          contents[idx] = null;
          loadNext(idx + 1);
        }
      }

      function flushAll() {
        for (let j = 0; j < jsxScripts.length; j++) {
          const content = contents[j];
          if (content === null || content === undefined) continue;

          const scriptEl = jsxScripts[j];
          const filename = scriptEl.getAttribute('src') || 'Inline Babel script';

          try {
            const result = Babel.transform(content, buildOptions(scriptEl, filename));
            const out = document.createElement('script');
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
