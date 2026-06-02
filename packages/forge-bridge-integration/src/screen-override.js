/* ──────────────────────────────────────────────
   Screen Override — Wraps forge screen components
   with key={dataVersion} re-mount on bridge data change.
   Loaded BEFORE forge screen scripts (step 5) to intercept
   window.* assignments via polling.
   ────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────
     BridgeScreenWrapper HOC
     Wraps any screen component to re-mount when
     __BRIDGE__ dataVersion changes.
     ────────────────────────────────────────────── */

  function BridgeScreenWrapper(ScreenComponent, screenName) {
    function WrappedComponent(props) {
      var dataVersion = React.useState(0);
      var version = dataVersion[0];
      var setVersion = dataVersion[1];

      React.useEffect(function () {
        // Subscribe to bridge data updates
        return window.__BRIDGE__.onDataUpdate(function () {
          setVersion(function (v) { return v + 1; });
        });
      }, []);

      // key={dataVersion} forces React to unmount/remount
      return React.createElement(
        ScreenComponent,
        Object.assign({}, props, { key: version })
      );
    }

    // Display name for devtools
    WrappedComponent.displayName = 'Bridge(' + screenName + ')';
    WrappedComponent.__wrapped = true;

    return WrappedComponent;
  }

  /* ──────────────────────────────────────────────
     ConnectModal Wrapper — Intercepts onNext
     Step 0→1: bridge.wallet.connect()
     Step 1→2: bridge.api.auth JWT flow
     Step 2→3: bridge.fhe.permitGrant()
     ────────────────────────────────────────────── */

  function BridgeConnectModal(OriginalModal) {
    function WrappedConnectModal(props) {
      var dataVersion = React.useState(0);
      var version = dataVersion[0];
      var setVersion = dataVersion[1];

      React.useEffect(function () {
        return window.__BRIDGE__.onDataUpdate(function () {
          setVersion(function (v) { return v + 1; });
        });
      }, []);

      // Intercept onNext to call real adapter methods
      function interceptedOnNext(step, context) {
        switch (step) {
          case 0:
            // Step 0→1: wallet selection → bridge.wallet.connect()
            if (window.bridge && context && context.wallet) {
              window.bridge.wallet.connect(context.wallet)
                .then(function () {
                  context.setCtx({ connected: true });
                })
                .catch(function (err) {
                  console.error('[BridgeConnectModal] wallet.connect failed:', err);
                  context.setError(err);
                });
            }
            break;

          case 1:
            // Step 1→2: sign message → JWT auth flow
            if (window.bridge && context && context.address) {
              // Get nonce → sign message → POST login → store JWT
              window.bridge.api.auth.getNonce(context.address)
                .then(function (nonceResult) {
                  if (window.ethereum) {
                    return window.ethereum.request({
                      method: 'personal_sign',
                      params: [nonceResult.nonce, context.address],
                    }).then(function (signature) {
                      return window.bridge.api.auth.login(context.address, signature);
                    });
                  }
                  throw new Error('Ethereum provider not available');
                })
                .then(function (loginResult) {
                  if (loginResult && loginResult.token) {
                    localStorage.setItem('fheforge:jwt', loginResult.token);
                  }
                  context.setCtx({ connected: true });
                })
                .catch(function (err) {
                  console.error('[BridgeConnectModal] JWT flow failed:', err);
                  context.setError(err);
                });
            }
            break;

          case 2:
            // Step 2→3: permit grant → bridge.fhe.permitGrant()
            if (window.bridge) {
              window.bridge.fhe.permitGrant()
                .then(function (permitResult) {
                  var permitSeconds = (permitResult && permitResult.seconds) || 900;
                  context.setCtx({
                    permitUnlocked: true,
                    permitSeconds: permitSeconds,
                  });
                })
                .catch(function (err) {
                  console.error('[BridgeConnectModal] permitGrant failed:', err);
                  context.setError(err);
                });
            }
            break;

          default:
            // Pass through for unrecognized steps
            if (context && context.onNext) {
              context.onNext();
            }
        }
      }

      return React.createElement(
        OriginalModal,
        Object.assign({}, props, {
          key: version,
          onNext: interceptedOnNext,
        })
      );
    }

    WrappedConnectModal.displayName = 'Bridge(ConnectModal)';
    WrappedConnectModal.__wrapped = true;

    return WrappedConnectModal;
  }

  /* ──────────────────────────────────────────────
     Screen Names to wrap
     ────────────────────────────────────────────── */

  var SCREEN_NAMES = [
    'Landing',
    'Dashboard',
    'Lending',
    'Market',
    'Governance',
    'ConnectModal',
  ];

  var CONNECT_MODAL_NAME = 'ConnectModal';

  /* ──────────────────────────────────────────────
     Wrap registered screen components
     ────────────────────────────────────────────── */

  function wrapScreens() {
    for (var i = 0; i < SCREEN_NAMES.length; i++) {
      var name = SCREEN_NAMES[i];
      var orig = window[name];
      if (orig && !orig.__wrapped) {
        if (name === CONNECT_MODAL_NAME) {
          window[name] = BridgeConnectModal(orig);
        } else {
          window[name] = BridgeScreenWrapper(orig, name);
        }
      }
    }
  }

  /* ──────────────────────────────────────────────
     Schedule wrapping attempts
     Forge screens are loaded as text/babel scripts
     and transformed by Babel asynchronously.
     ────────────────────────────────────────────── */

  // Try immediately
  wrapScreens();

  // Try on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', wrapScreens);

  // Poll until all screens are wrapped
  var wrapTimer = setInterval(function () {
    wrapScreens();
    // All wrapped? Count wrapped screens
    var wrapped = 0;
    for (var i = 0; i < SCREEN_NAMES.length; i++) {
      if (window[SCREEN_NAMES[i]] && window[SCREEN_NAMES[i]].__wrapped) {
        wrapped++;
      }
    }
    if (wrapped >= SCREEN_NAMES.length) {
      clearInterval(wrapTimer);
    }
  }, 100);

  // Expose helper for explicit wrapping
  window.__wrapScreens = wrapScreens;
})();
