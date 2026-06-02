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
     Also triggers screen-specific data fetches on mount
     so each screen loads its relevant data on navigation.
     ────────────────────────────────────────────── */

  function BridgeScreenWrapper(ScreenComponent, screenName) {
    function WrappedComponent(props) {
      var dataVersion = React.useState(0);
      var version = dataVersion[0];
      var setVersion = dataVersion[1];

      React.useEffect(function () {
        // Subscribe to bridge data updates
        var unsubscribe = window.__BRIDGE__.onDataUpdate(function () {
          setVersion(function (v) { return v + 1; });
        });

        // Trigger screen-specific data fetch on mount
        // This ensures the screen's relevant data is loaded from bridge
        triggerScreenData(screenName);

        return unsubscribe;
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
     ConnectModal is no longer wrapped here.
     ConnectInterceptor (connect-interceptor.js) replaces the
     BridgeConnectModal wrapper and is injected at app.jsx level.
     It uses BridgeBus events for step detection (not setCtx interception).
     ────────────────────────────────────────────── */

  /* ──────────────────────────────────────────────
     Screen-specific data sources to fetch on mount
     Each screen triggers its relevant data fetchers
     when it mounts, ensuring data is loaded on navigation.
     ────────────────────────────────────────────── */

  var SCREEN_DATA_MAP = {
    Landing: ['ticker', 'positions', 'walletBalance'],
    Dashboard: ['positions', 'strategies', 'activity', 'walletBalance'],
    Lending: ['markets', 'positions', 'walletBalance'],
    Market: ['community'],
    Governance: ['proposals'],
    BuilderWorkspace: ['nodeTypes'],
  };

  /* ──────────────────────────────────────────────
     Trigger screen-specific data fetches
     ────────────────────────────────────────────── */

  function triggerScreenData(screenName) {
    var dataSources = SCREEN_DATA_MAP[screenName] || [];
    var df = window.__integration && window.__integration.DataFetcher;
    if (!df || !df.fetchNow) return;
    for (var i = 0; i < dataSources.length; i++) {
      df.fetchNow(dataSources[i]);
    }
  }

  /* ──────────────────────────────────────────────
     Screen Names to wrap
     Note: ConnectModal is no longer wrapped here.
     The ConnectInterceptor (connect-interceptor.js) handles
     ConnectModal at the app.jsx level using BridgeBus events.
     ────────────────────────────────────────────── */

  var SCREEN_NAMES = [
    'Landing',
    'Dashboard',
    'Lending',
    'Market',
    'Governance',
    'BuilderWorkspace',
  ];

  var BUILDER_WORKSPACE_NAME = 'BuilderWorkspace';

  /* ──────────────────────────────────────────────
     BuilderWorkspace Wrapper — Adds sim/deploy
     overrides and NODE_TYPES data fetch on mount.
     ────────────────────────────────────────────── */

  function BridgeBuilderWorkspace(OriginalBuilderWorkspace) {
    function WrappedBuilderWorkspace(props) {
      var dataVersion = React.useState(0);
      var version = dataVersion[0];
      var setVersion = dataVersion[1];

      React.useEffect(function () {
        // Subscribe to bridge data updates
        var unsubscribe = window.__BRIDGE__.onDataUpdate(function () {
          setVersion(function (v) { return v + 1; });
        });

        // Trigger NODE_TYPES and builder-specific data fetch on mount
        triggerScreenData('BuilderWorkspace');

        return unsubscribe;
      }, []);

      // Expose sim/deploy overrides on window for integration layer
      // These are set on mount and cleared on unmount
      React.useEffect(function () {
        // Simulate override — calls bridge API simulateDefiStrategy
        window.__bridgeSimulate = function (canvasState) {
          if (!window.bridge || !window.bridge.api) {
            return Promise.reject(new Error('Bridge not connected'));
          }
          return window.bridge.api.defiStrategies.simulateDefiStrategy(canvasState)
            .then(function (result) {
              window.__BRIDGE__.notify();
              return result;
            })
            .catch(function (err) {
              console.error('[BridgeBuilderWorkspace] simulate failed:', err);
              throw err;
            });
        };

        // Deploy override — calls bridge contract write
        window.__bridgeDeploy = function (deployParams) {
          if (!window.bridge || !window.bridge.contract) {
            return Promise.reject(new Error('Bridge not connected'));
          }
          // Convert canvas nodes to contract params and execute
          return window.bridge.contract.write('LendingPool', 'openPosition', deployParams)
            .then(function (txResult) {
              window.__BRIDGE__.notify();
              return txResult;
            })
            .catch(function (err) {
              console.error('[BridgeBuilderWorkspace] deploy failed:', err);
              throw err;
            });
        };

        return function () {
          // Cleanup on unmount
          delete window.__bridgeSimulate;
          delete window.__bridgeDeploy;
        };
      }, []);

      // key={dataVersion} forces React to unmount/remount
      return React.createElement(
        OriginalBuilderWorkspace,
        Object.assign({}, props, { key: version })
      );
    }

    WrappedBuilderWorkspace.displayName = 'Bridge(BuilderWorkspace)';
    WrappedBuilderWorkspace.__wrapped = true;

    return WrappedBuilderWorkspace;
  }

  /* ──────────────────────────────────────────────
     Wrap registered screen components
     Uses BridgeScreenWrapper for standard screens,
     BridgeConnectModal for the ConnectModal (intercepts onNext),
     and BridgeBuilderWorkspace for the BuilderWorkspace
     (adds sim/deploy overrides and NODE_TYPES fetching).
     ────────────────────────────────────────────── */

  function wrapScreens() {
    for (var i = 0; i < SCREEN_NAMES.length; i++) {
      var name = SCREEN_NAMES[i];
      var orig = window[name];
      if (orig && !orig.__wrapped) {
        if (name === BUILDER_WORKSPACE_NAME) {
          window[name] = BridgeBuilderWorkspace(orig);
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
