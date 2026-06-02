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
     ConnectModal Wrapper — Intercepts setCtx + grantPermit
     to call real bridge adapter methods.
     
     Strategy:
     - The original ConnectModal uses setCtx() for step 1→2 (mock connect)
       and grantPermit() for step 2→3 (mock permit).
     - We intercept setCtx to detect when the mock connected transition
       happens (step 1→2), and instead perform the real wallet connect +
       JWT auth flow.
     - We intercept grantPermit to call bridge.fhe.permitGrant().
     - We detect step 0→1 via sessionStorage polling for wallet connect.
     
     Step 0→1 (wallet selection):
       The original ConnectModal advances step via internal setStep(1).
       We poll sessionStorage for "fheforge:connect:step" changes
       to detect 0→1 and trigger wallet.connect().
     
     Step 1→2 (sign message / JWT):
       The original's onNext calls setCtx with mock values.
       Our wrapped setCtx detects {connected:true, address:mockAddr}
       pattern, intercepts it, and performs:
         bridge.wallet.connect() → bridge.wallet.login() → real ctx update
     
     Step 2→3 (permit grant):
       Original calls grantPermit() → our wrapper calls
       bridge.fhe.permitGrant() → ctx.permitUnlocked=true
     
     Step 3 (ready):
       Auto-dismiss already handled by original component (1.6s timeout).
     
     Network mismatch:
       After wallet connect, checks chainId !== 421614 and calls
       bridge.wallet.switchNetwork(421614).
     
     onPermitChange wiring:
       Subscribes to bridge.fhe.onPermitChange() and updates ctx
       permit state reactively.
     ────────────────────────────────────────────── */

  /** The mock address used by the original ConnectModal in step 1→2 */
  var MOCK_CONNECT_ADDRESS = '0x9f3a2c4b1e0d8f7a6c5b4a39';

  /** Session storage key used by the original component */
  var SESSION_STORAGE_STEP_KEY = 'fheforge:connect:step';

  /**
   * Perform the real wallet connect + JWT flow.
   * Called when we detect the mock connected transition.
   *
   * @param {object} ctx - Current ctx (mutable reference)
   * @param {function} setCtx - Original setCtx from props
   * @returns {Promise<void>}
   */
  function performRealConnectFlow(ctx, setCtx) {
    if (!window.bridge || !window.bridge.wallet) {
      // No bridge — let the mock flow proceed
      setCtx({ connected: true, address: MOCK_CONNECT_ADDRESS });
      return Promise.resolve();
    }

    var connectFlowInProgress = window.__connectFlowInProgress;
    if (connectFlowInProgress) return connectFlowInProgress;

    var flowPromise = _executeConnectFlow(ctx, setCtx);
    window.__connectFlowInProgress = flowPromise;

    return flowPromise
      .then(function () {
        window.__connectFlowInProgress = null;
      })
      .catch(function (err) {
        window.__connectFlowInProgress = null;
        throw err;
      });
  }

  /** @private */
  function _executeConnectFlow(ctx, setCtx) {
    return (window.bridge.wallet.connect()  // Try default connector
      .then(function () {
        // Check for network mismatch
        var chainId = window.bridge.wallet.getChainId();
        if (chainId && chainId !== 421614) {
          return window.bridge.wallet.switchNetwork(421614)
            .then(function () {
              return window.bridge.wallet.connect();
            })
            .catch(function (switchErr) {
              console.error('[BridgeConnectModal] Network switch failed:', switchErr);
              // Continue anyway — user may have fixed manually
            });
        }
      })
      .then(function () {
        var realAddress = window.bridge.wallet.getAccount();
        if (!realAddress) {
          throw new Error('Wallet connection failed: no account returned');
        }

        // Perform JWT login flow
        return window.bridge.wallet.login()
          .then(function (loginResult) {
            // Update ctx with real values
            setCtx({
              connected: true,
              address: realAddress,
              jwtStored: !!loginResult.accessToken,
            });

            // Notify bridge data update so screens react
            if (window.__BRIDGE__) {
              window.__BRIDGE__.notify();
            }
          })
          .catch(function (loginErr) {
            console.error('[BridgeConnectModal] JWT login failed:', loginErr);
            // Still set connected=true even if JWT fails (wallet is connected)
            setCtx({
              connected: true,
              address: realAddress,
              connectError: 'JWT login failed: ' + (loginErr.message || 'unknown error'),
            });
          });
      })
      .catch(function (err) {
        console.error('[BridgeConnectModal] Connection flow error:', err);
        // Do NOT apply the mock update — show error state
        // The UI will need a retry mechanism
        setCtx({
          connected: false,
          address: null,
          connectError: err.message || 'Wallet connection failed',
        });
        throw err;
      })
    );
  }

  function BridgeConnectModal(OriginalModal) {
    function WrappedConnectModal(props) {
      var dataVersion = React.useState(0);
      var version = dataVersion[0];
      var setVersion = dataVersion[1];

      var connectInProgressRef = React.useRef(false);

      React.useEffect(function () {
        return window.__BRIDGE__.onDataUpdate(function () {
          setVersion(function (v) { return v + 1; });
        });
      }, []);

      // ─── Subscribe to onPermitChange for real permit state ───
      React.useEffect(function () {
        if (window.bridge && window.bridge.fhe && window.bridge.fhe.onPermitChange) {
          var unsubscribe = window.bridge.fhe.onPermitChange(function (permitState) {
            props.setCtx({
              permitUnlocked: permitState.unlocked,
              permitSeconds: permitState.secondsLeft,
            });
          });
          return unsubscribe;
        }
      }, []);

      // ─── Poll sessionStorage for step 0→1 transition ───
      // The original ConnectModal persists step to sessionStorage.
      // When step changes 0→1, we trigger wallet connect early.
      React.useEffect(function () {
        if (!props.open) return;

        var prevStep = -1;
        var pollTimer = setInterval(function () {
          try {
            var saved = sessionStorage.getItem(SESSION_STORAGE_STEP_KEY);
            if (saved !== null) {
              var currentStep = parseInt(saved, 10);

              // Detect step 0→1 transition (wallet selection)
              if (prevStep === 0 && currentStep === 1 && window.bridge && window.bridge.wallet) {
                // User selected a wallet and clicked Continue.
                // Connect the wallet early so it's ready for signing.
                window.bridge.wallet.connect()
                  .catch(function (err) {
                    console.error('[BridgeConnectModal] Early wallet connect failed:', err);
                    // Will retry during the JWT flow when user clicks "Sign"
                  });
              }

              prevStep = currentStep;
            }
          } catch (e) {
            // sessionStorage may not be available
          }
        }, 200);

        return function () { clearInterval(pollTimer); };
      }, [props.open]);

      // ─── Wrapped setCtx — detect mock connected transition ───
      function wrappedSetCtx(update) {
        if (typeof update === 'function') {
          // Evaluate the updater to see what it's setting
          var prevCtx = props.ctx || {};
          var nextCtx = update(prevCtx);

          // Detect the step 1→2 mock connection: connected goes from false to true
          // with the known mock address
          if (
            !prevCtx.connected &&
            nextCtx.connected &&
            nextCtx.address === MOCK_CONNECT_ADDRESS
          ) {
            // This is the mock connect transition — intercept and do real flow
            if (!connectInProgressRef.current) {
              connectInProgressRef.current = true;
              performRealConnectFlow(props.ctx, props.setCtx)
                .catch(function () {
                  // Error already handled in performRealConnectFlow
                })
                .finally(function () {
                  connectInProgressRef.current = false;
                });
            }
            // Do NOT apply the mock update — real flow will set real values
            return;
          }

          // For all other updates, pass through
          props.setCtx(update);
        } else {
          // Object updates — check for connected-related patterns
          if (update && update.connected && update.address === MOCK_CONNECT_ADDRESS) {
            // Also intercept object-form mock connection
            if (!connectInProgressRef.current) {
              connectInProgressRef.current = true;
              performRealConnectFlow(props.ctx, props.setCtx)
                .catch(function () {})
                .finally(function () {
                  connectInProgressRef.current = false;
                });
            }
            return;
          }
          props.setCtx(update);
        }
      }

      // ─── Wrapped grantPermit — call bridge.fhe.permitGrant() ───
      function wrappedGrantPermit() {
        if (window.bridge && window.bridge.fhe && window.bridge.fhe.permitGrant) {
          window.bridge.fhe.permitGrant()
            .then(function (permitResult) {
              var seconds = 900;
              if (permitResult && permitResult.secondsLeft != null) {
                seconds = permitResult.secondsLeft;
              }
              props.setCtx({
                permitUnlocked: true,
                permitSeconds: seconds,
              });
            })
            .catch(function (err) {
              console.error('[BridgeConnectModal] permitGrant failed:', err);
              // Fallback to original behavior
              if (props.grantPermit) {
                props.grantPermit();
              }
            });
        } else {
          // No bridge — fall through to original
          if (props.grantPermit) {
            props.grantPermit();
          }
        }
      }

      return React.createElement(
        OriginalModal,
        Object.assign({}, props, {
          key: version,
          setCtx: wrappedSetCtx,
          grantPermit: wrappedGrantPermit,
        })
      );
    }

    WrappedConnectModal.displayName = 'Bridge(ConnectModal)';
    WrappedConnectModal.__wrapped = true;

    return WrappedConnectModal;
  }

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
    ConnectModal: [], // No automatic fetch — triggered by connection flow
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
     ────────────────────────────────────────────── */

  var SCREEN_NAMES = [
    'Landing',
    'Dashboard',
    'Lending',
    'Market',
    'Governance',
    'BuilderWorkspace',
    'ConnectModal',
  ];

  var CONNECT_MODAL_NAME = 'ConnectModal';
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
        if (name === CONNECT_MODAL_NAME) {
          window[name] = BridgeConnectModal(orig);
        } else if (name === BUILDER_WORKSPACE_NAME) {
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
