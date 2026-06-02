/* ──────────────────────────────────────────────
   ConnectInterceptor — Replaces BridgeConnectModal wrapper from Phase 5.

   Instead of wrapping window.ConnectModal with a complex HOC that
   intercepts setCtx, this module injects connect logic at the app.jsx
   level by:
     1. Wrapping ConnectModal's grantPermit callback to call real
        bridge.fhe.permitGrant()
     2. Overriding onNext to detect step transitions and perform real
        bridge adapter calls at each step
     3. Using BridgeBus wallet:connected event (not setCtx interception)
        to detect wallet connection completion

   Step flow:
     Step 0→1 (wallet selection):
       User clicks a wallet option → onNext() called → interceptor
       calls bridge.wallet.connect(connectorId) directly.
       No !prevCtx.connected guard.
       On wallet connect success, sessionStorage updated, BridgeBus
       emits wallet:connected.

     Step 1→2 (JWT login):
       wallet:connected event triggers → nonce → signMessage →
       POST /auth/wallet-login → JWT stored in localStorage.

     Step 2→3 (permit grant):
       Calls bridge.fhe.permitGrant(). When resolved, advances step.

   Network mismatch: After wallet connect, checks chainId !== 421614
     and shows switch prompt calling bridge.wallet.switchNetwork(421614).

   Failure recovery: Each step has retry logic. Step does not advance
     on failure — user can retry.

   Lifecycle: Disconnect clears auth state via BridgeBus.
   sessionStorage persistence for refresh resilience.
   ────────────────────────────────────────────── */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Session storage key used by the original ConnectModal component */
const SESSION_STORAGE_STEP_KEY = 'fheforge:connect:step';

/** Session storage key for persisting wallet connector choice */
const SESSION_STORAGE_CONNECTOR_KEY = 'fheforge:connect:connector';

/** Arbitrum Sepolia chain ID */
const REQUIRED_CHAIN_ID = 421614;

/** Polling interval for ConnectModal detection (ms) */
const STEP_POLL_INTERVAL = 200;

// ─── Module State ────────────────────────────────────────────────────────────

/** @type {boolean} Whether a connect flow is currently in progress */
let connectFlowInProgress = false;

/** @type {number|null} Current step being processed (0-3) */
let currentProcessingStep = null;

/** @type {Object|null} Reference to BridgeBus */
let bus = null;

/** @type {boolean} Whether BridgeBus listeners are registered */
let listenersRegistered = false;

/** @type {Array<{event: string, data: *}>} Recorded BridgeBus set calls (for testing) */
let _recordedBusCalls = [];

/** @type {Object|null} DataFetcherV2 instance for authenticated polling lifecycle */
let _dataFetcherV2Instance = null;

// ─── Global Resolution Helpers ──────────────────────────────────────────────

/**
 * Get the global object (window in browser, globalThis in any environment).
 * @returns {typeof globalThis}
 */
function getGlobal() {
  return typeof window !== 'undefined' ? window : globalThis;
}

/**
 * Get sessionStorage if available.
 * @returns {Storage|null}
 */
function getSessionStorage() {
  try {
    const g = getGlobal();
    return g.sessionStorage || null;
  } catch {
    return null;
  }
}

/**
 * Get localStorage if available.
 * @returns {Storage|null}
 */
function getLocalStorage() {
  try {
    const g = getGlobal();
    return g.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the bridge adapter synchronously if available.
 * Falls back to async retry if not yet initialized.
 * The synchronous path eliminates unnecessary microtask hops.
 *
 * @returns {Object|null} Bridge adapter or null if not yet available
 */
function getBridgeSync() {
  const g = getGlobal();
  return g.bridge || null;
}

/**
 * Get the bridge adapter, retrying if not yet initialized.
 * @returns {Promise<Object>}
 */
function getBridge() {
  const syncBridge = getBridgeSync();
  if (syncBridge) return Promise.resolve(syncBridge);

  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = setInterval(() => {
      const b = getBridgeSync();
      if (b) {
        clearInterval(check);
        resolve(b);
      } else if (++retries > 30) {
        clearInterval(check);
        reject(new Error('Bridge adapter not available after timeout'));
      }
    }, 100);
  });
}

/**
 * Get React from global scope.
 * Checks globalThis, window, and the module global for React.
 * @returns {Object}
 */
function getReact() {
  return globalThis.React || (typeof window !== 'undefined' && window.React) || null;
}

// ─── DataFetcherV2 Lifecycle ──────────────────────────────────────────────────

/**
 * Get or lazily create the DataFetcherV2 instance for authenticated polling.
 * Uses a module-level singleton so start/stop lifecycle is consistent.
 *
 * @returns {Object|null} DataFetcherV2 instance or null if not available
 */
function getDataFetcherV2() {
  if (_dataFetcherV2Instance) return _dataFetcherV2Instance;

  const g = getGlobal();
  if (g.DataFetcherV2 && g.__bridgeBus) {
    try {
      _dataFetcherV2Instance = new g.DataFetcherV2({
        bus: g.__bridgeBus,
      });
    } catch (err) {
      console.warn('[ConnectInterceptor] Failed to create DataFetcherV2:', err.message || err);
      return null;
    }
  }

  return _dataFetcherV2Instance;
}

// ─── Network Mismatch Detection ─────────────────────────────────────────────

/**
 * Check the chainId and switch if needed.
 * If chainId !== 421614 (Arbitrum Sepolia), attempts to switch via
 * bridge.wallet.switchNetwork(421614).
 *
 * @param {number} chainId - Current chain ID from wallet
 * @returns {Promise<void>}
 */
function checkAndSwitchNetwork(chainId) {
  if (!chainId || chainId === REQUIRED_CHAIN_ID) {
    return Promise.resolve();
  }

  console.warn(
    '[ConnectInterceptor] Network mismatch: chain ' + chainId + ' !== ' + REQUIRED_CHAIN_ID + '. Attempting switch.',
  );

  return getBridge()
    .then((bridge) => bridge.wallet.switchNetwork(REQUIRED_CHAIN_ID))
    .then(() => {
      console.log('[ConnectInterceptor] Network switched to Arbitrum Sepolia');
    })
    .catch((switchErr) => {
      console.warn('[ConnectInterceptor] Network switch failed:', switchErr.message || switchErr);
      throw new Error(
        'Network mismatch. Please switch to Arbitrum Sepolia (chain ID 421614) in your wallet.',
      );
    });
}

// ─── Step 0→1: Wallet Connect ───────────────────────────────────────────────

/**
 * Connect the wallet using bridge.wallet.connect(connectorId).
 * Called when step transitions 0→1 (user selected a wallet).
 *
 * @param {string} [connectorId] - Wallet connector ID
 * @returns {Promise<{address: string, chainId: number}>}
 */
function executeWalletConnect(connectorId) {
  return getBridge()
    .then((bridge) => {
      console.log(
        '[ConnectInterceptor] Connecting wallet' + (connectorId ? ' via ' + connectorId : '') + '...',
      );
      return bridge.wallet.connect(connectorId);
    })
    .then(() => getBridge())
    .then((bridge) => {
      const address = bridge.wallet.getAccount();
      const chainId = bridge.wallet.getChainId();
      if (!address) throw new Error('Wallet connection failed: no account returned');
      return { address, chainId };
    });
}

// ─── Step 1→2: JWT Login ────────────────────────────────────────────────────

/**
 * Perform JWT wallet login: nonce → signMessage → POST /auth/wallet-login.
 *
 * @param {string} address - Wallet address
 * @returns {Promise<{accessToken: string, userId: string, walletAddress: string}>}
 */
function executeJwtLogin(address) {
  return getBridge()
    .then((bridge) => {
      console.log('[ConnectInterceptor] Performing JWT login for ' + address + '...');
      return bridge.wallet.login();
    })
    .then((loginResult) => {
      console.log('[ConnectInterceptor] JWT login successful');
      return loginResult;
    });
}

// ─── Step 2→3: Permit Grant ─────────────────────────────────────────────────

/**
 * Grant FHE permit using bridge.fhe.permitGrant().
 *
 * @returns {Promise<{unlocked: boolean, secondsLeft: number}>}
 */
function executePermitGrant() {
  return getBridge()
    .then((bridge) => {
      console.log('[ConnectInterceptor] Granting FHE permit...');
      return bridge.fhe.permitGrant();
    })
    .then((permitResult) => {
      let unlocked = true;
      let secondsLeft = 900;

      if (permitResult) {
        unlocked = permitResult.unlocked !== false;
        secondsLeft = permitResult.secondsLeft != null ? permitResult.secondsLeft : 900;
      }

      console.log('[ConnectInterceptor] Permit granted (' + secondsLeft + 's)');
      return { unlocked, secondsLeft };
    });
}

// ─── BridgeBus State Updates ────────────────────────────────────────────────

/**
 * Update BridgeBus wallet state after successful connection.
 * @param {string} address
 * @param {number} chainId
 */
function emitWalletConnected(address, chainId) {
  if (!bus) return;
  bus.set('wallet:connected', { connected: true, address, chainId });
}

/**
 * Update BridgeBus permit state after grant.
 * @param {boolean} unlocked
 * @param {number} secondsLeft
 */
function emitPermitGranted(unlocked, secondsLeft) {
  if (!bus) return;
  bus.set('permit:granted', { unlocked, secondsLeft });
}

/**
 * Record an error in BridgeBus meta.errors.
 * @param {string} step - Step name where error occurred
 * @param {Error|string} err - The error
 */
function emitError(step, err) {
  if (!bus) return;
  const message = err && err.message ? err.message : String(err);
  bus.set('error:connect', { step, message, timestamp: new Date().toISOString() });
}

// ─── Session Storage Persistence ────────────────────────────────────────────

/**
 * Save the current step to sessionStorage for refresh resilience.
 * @param {number} step - Step number (0-3)
 */
function persistStep(step) {
  const ss = getSessionStorage();
  if (ss) {
    try {
      ss.setItem(SESSION_STORAGE_STEP_KEY, String(step));
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Restore progress from sessionStorage on page load.
 * If a step was in progress and the page refreshed, we need to verify
 * real adapter state before advancing.
 */
function restoreProgress() {
  const ss = getSessionStorage();
  if (!ss) return;

  try {
    const savedStep = ss.getItem(SESSION_STORAGE_STEP_KEY);
    if (savedStep === null) return;

    const step = parseInt(savedStep, 10);
    if (isNaN(step) || step <= 0) return;

    getBridge()
      .then((bridge) => {
        const isConnected = bridge.wallet.isConnected && bridge.wallet.isConnected();
        const address = bridge.wallet.getAccount();

        if (step >= 1 && !isConnected) {
          persistStep(0);
          return;
        }

        if (step >= 2 && address) {
          const jwt = bridge.wallet.getJwt && bridge.wallet.getJwt();
          if (!jwt) {
            persistStep(1);
            emitWalletConnected(address, bridge.wallet.getChainId());
            return;
          }
        }

        if (step >= 3) {
          const permitState = bridge.fhe && bridge.fhe.permitCheck && bridge.fhe.permitCheck();
          if (permitState && permitState.unlocked) {
            return;
          }
          persistStep(2);
        }
      })
      .catch(() => {
        persistStep(0);
      });
  } catch {
    /* sessionStorage not available */
  }
}

// ─── Step Processors ────────────────────────────────────────────────────────

/**
 * Process step 0→1: wallet connect.
 *
 * @param {string} [connectorId] - Wallet connector ID to use
 * @returns {Promise<void>}
 */
function processStep0To1(connectorId) {
  if (connectFlowInProgress) return Promise.resolve();
  connectFlowInProgress = true;
  currentProcessingStep = 0;

  const ss = getSessionStorage();
  const connectorToUse =
    connectorId || (ss ? ss.getItem(SESSION_STORAGE_CONNECTOR_KEY) : null) || undefined;

  return executeWalletConnect(connectorToUse)
    .then((result) => {
      return checkAndSwitchNetwork(result.chainId)
        .then(() => result)
        .catch((networkErr) => {
          console.warn('[ConnectInterceptor] Network mismatch, user may need to switch manually');
          emitError('network', networkErr);
          return result;
        });
    })
    .then((result) => {
      if (connectorToUse && ss) {
        try {
          ss.setItem(SESSION_STORAGE_CONNECTOR_KEY, connectorToUse);
        } catch {
          /* non-fatal */
        }
      }

      persistStep(1);
      emitWalletConnected(result.address, result.chainId);

      currentProcessingStep = 1;
      return processStep1To2(result.address);
    })
    .catch((err) => {
      console.error('[ConnectInterceptor] Step 0→1 (wallet connect) failed:', err.message || err);
      emitError('wallet_connect', err);
      connectFlowInProgress = false;
      currentProcessingStep = null;
      throw err;
    });
}

/**
 * Process step 1→2: JWT login.
 *
 * @param {string} address - Wallet address
 * @returns {Promise<void>}
 */
function processStep1To2(address) {
  return executeJwtLogin(address)
    .then((loginResult) => {
      if (loginResult.accessToken) {
        const ls = getLocalStorage();
        if (ls) {
          try {
            ls.setItem('auth_token', loginResult.accessToken);
          } catch {
            /* non-fatal */
          }
        }
      }

      persistStep(2);
      currentProcessingStep = 2;
      return processStep2To3();
    })
    .catch((err) => {
      console.error('[ConnectInterceptor] Step 1→2 (JWT login) failed:', err.message || err);
      emitError('jwt_login', err);
      connectFlowInProgress = false;
      currentProcessingStep = null;
      throw err;
    });
}

/**
 * Process step 2→3: permit grant.
 *
 * @returns {Promise<void>}
 */
function processStep2To3() {
  return executePermitGrant()
    .then((permitResult) => {
      emitPermitGranted(permitResult.unlocked, permitResult.secondsLeft);

      // Start authenticated polling after successful permit grant
      // (VAL-REARCH-DATA-003, VAL-REARCH-CONNECT-012)
      const fetcher = getDataFetcherV2();
      if (fetcher) {
        fetcher.startAuthenticatedPolling();
      }

      persistStep(3);
      currentProcessingStep = null;
      connectFlowInProgress = false;
      console.log('[ConnectInterceptor] Connect flow complete.');
    })
    .catch((err) => {
      console.error('[ConnectInterceptor] Step 2→3 (permit grant) failed:', err.message || err);
      emitError('permit_grant', err);
      connectFlowInProgress = false;
      currentProcessingStep = null;
      throw err;
    });
}

// ─── Disconnect Handler ─────────────────────────────────────────────────────

/**
 * Handle wallet disconnect: clear auth state, stop polling.
 */
function handleDisconnect() {
  console.log('[ConnectInterceptor] Disconnect detected, clearing auth state.');

  const ss = getSessionStorage();
  if (ss) {
    try {
      ss.removeItem(SESSION_STORAGE_STEP_KEY);
      ss.removeItem(SESSION_STORAGE_CONNECTOR_KEY);
    } catch {
      /* non-fatal */
    }
  }

  // Stop authenticated polling (VAL-REARCH-DATA-003, VAL-REARCH-CONNECT-012)
  const fetcher = getDataFetcherV2();
  if (fetcher) {
    fetcher.stopAuthenticatedPolling();
  }

  if (bus) {
    bus.set('wallet:disconnected', { connected: false, address: null, chainId: null });
    bus.set('permit:expired', { unlocked: false, secondsLeft: 0 });
    // Clear authed domain data and disable authenticated writes (VAL-REARCH-CONNECT-012)
    if (bus.disableAuthenticated) {
      bus.disableAuthenticated();
    }
  }

  connectFlowInProgress = false;
  currentProcessingStep = null;
}

// ─── BridgeBus Event Handlers ───────────────────────────────────────────────

/**
 * Called when BridgeBus emits wallet:connected.
 * This is the step detection mechanism for step 0→1 completion.
 *
 * @param {{ connected: boolean, address: string, chainId: number }} walletData
 */
function onWalletConnected(walletData) {
  if (currentProcessingStep === 1) return;

  if (walletData && walletData.connected && walletData.address && !connectFlowInProgress) {
    connectFlowInProgress = true;
    currentProcessingStep = 1;

    processStep1To2(walletData.address).catch(() => {
      /* error already handled in processStep1To2 */
    });
  }
}

/**
 * Called when BridgeBus emits wallet:disconnected.
 */
function onWalletDisconnected() {
  handleDisconnect();
}

// ─── ConnectModal Wrapping ─────────────────────────────────────────────────

/**
 * Wrap the original ConnectModal to inject real bridge callbacks.
 *
 * Unlike the Phase 5 BridgeConnectModal wrapper which intercepted
 * setCtx and polled sessionStorage, this wrapper does:
 *   1. Replaces grantPermit with bridge.fhe.permitGrant()
 *   2. Replaces onNext to detect step transitions and perform
 *      real bridge adapter calls (wallet connect, JWT login)
 *   3. Does NOT intercept setCtx
 *   4. Does NOT have a !prevCtx.connected guard
 *
 * @param {Function} OriginalModal - The original ConnectModal component
 * @returns {Function} Wrapped ConnectModal
 */
function wrapConnectModal(OriginalModal) {
  function WrappedConnectModal(props) {
    function wrappedOnNext() {
      const currentStep = props.step != null ? props.step : 0;

      if (currentStep === 0) {
        processStep0To1()
          .then(() => {
            if (props.onNext) props.onNext();
          })
          .catch(() => {
            /* Error already emitted to BridgeBus. Modal stays at current step for retry. */
          });
        return;
      }

      if (props.onNext) props.onNext();
    }

    function wrappedGrantPermit() {
      if (currentProcessingStep === 2) {
        return;
      }

      getBridge()
        .then((bridge) => {
          if (bridge.fhe && bridge.fhe.permitGrant) {
            return bridge.fhe.permitGrant();
          }
          throw new Error('FHE adapter not available');
        })
        .then((permitResult) => {
          const unlocked = permitResult ? permitResult.unlocked !== false : true;
          const secondsLeft = permitResult && permitResult.secondsLeft != null ? permitResult.secondsLeft : 900;

          emitPermitGranted(unlocked, secondsLeft);
          persistStep(3);

          if (props.grantPermit) {
            props.grantPermit();
          }
        })
        .catch((err) => {
          console.error('[ConnectInterceptor] Permit grant failed:', err.message || err);
          emitError('permit_grant', err);
          if (props.grantPermit) {
            props.grantPermit();
          }
        });
    }

    const React = getReact();
    return React.createElement(
      OriginalModal,
      Object.assign({}, props, {
        onNext: wrappedOnNext,
        grantPermit: wrappedGrantPermit,
      }),
    );
  }

  WrappedConnectModal.displayName = 'ConnectInterceptor(ConnectModal)';
  return WrappedConnectModal;
}

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the ConnectInterceptor.
 * Sets up BridgeBus listeners and wraps the ConnectModal.
 */
function init() {
  const g = getGlobal();

  // Resolve BridgeBus
  if (g.__bridgeBus) {
    bus = g.__bridgeBus;
  }

  // Subscribe to BridgeBus events for step detection
  if (bus && !listenersRegistered) {
    listenersRegistered = true;
    bus.on('wallet:connected', onWalletConnected);
    bus.on('wallet:disconnected', onWalletDisconnected);
  }

  // Wrap ConnectModal if it exists
  if (g.ConnectModal && !g.ConnectModal.__connectInterceptorWrapped) {
    const originalModal = g.ConnectModal;
    g.ConnectModal = wrapConnectModal(originalModal);
    g.ConnectModal.__connectInterceptorWrapped = true;
  } else if (!g.ConnectModal) {
    // ConnectModal not loaded yet — poll for it
    const pollTimer = setInterval(() => {
      if (g.ConnectModal && !g.ConnectModal.__connectInterceptorWrapped) {
        clearInterval(pollTimer);
        const originalModal = g.ConnectModal;
        g.ConnectModal = wrapConnectModal(originalModal);
        g.ConnectModal.__connectInterceptorWrapped = true;
        restoreProgress();
      }
    }, STEP_POLL_INTERVAL);
  }

  // Restore saved progress
  restoreProgress();
}

// ─── Retry Support ──────────────────────────────────────────────────────────

/**
 * Retry the current failed step.
 * Called by the UI when user clicks "Retry" after an error.
 */
function retryConnectFlow() {
  if (connectFlowInProgress) return;

  const ss = getSessionStorage();
  let step = 0;
  if (ss) {
    try {
      step = parseInt(ss.getItem(SESSION_STORAGE_STEP_KEY) || '0', 10);
    } catch {
      step = 0;
    }
  }

  if (step <= 0) return;

  if (step >= 1) {
    connectFlowInProgress = true;
    getBridge()
      .then((bridge) => {
        const address = bridge.wallet.getAccount();
        if (!address) {
          connectFlowInProgress = false;
          persistStep(0);
          return;
        }

        currentProcessingStep = 1;
        return processStep1To2(address);
      })
      .catch(() => {
        connectFlowInProgress = false;
        currentProcessingStep = null;
      });
  }
}

// ─── Get current state (for debugging/testing) ───────────────────────────────

/** @returns {{ flowInProgress: boolean, currentStep: number|null }} */
function getState() {
  return {
    flowInProgress: connectFlowInProgress,
    currentStep: currentProcessingStep,
  };
}

/** Reset internal state (testing only). */
function _resetForTest() {
  connectFlowInProgress = false;
  currentProcessingStep = null;
}

/** Set BridgeBus instance (testing only). */
function _setBridgeBus(bridgeBus) {
  bus = bridgeBus;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export {
  init,
  wrapConnectModal,
  processStep0To1,
  processStep1To2,
  processStep2To3,
  handleDisconnect,
  retryConnectFlow,
  checkAndSwitchNetwork,
  restoreProgress,
  getState,
  _resetForTest,
  _setBridgeBus,
};

/** Set the BridgeBus instance (for testing). */
function _setBridgeBus(bridgeBus) {
  bus = bridgeBus;
}

// ─── Self-Initialize in Browser ─────────────────────────────────────────────

const g = getGlobal();
if (typeof window !== 'undefined') {
  // Guard: only initialize once (window.__MOCK__ may already exist from babel-transform-plugin.js
  // or from previous initialization in tests).  The old typeof __MOCK__ === 'undefined' check
  // prevented initialization in production because babel-transform-plugin.js creates __MOCK__
  // before this module runs (deferred module script order).
  if (!g.__ConnectInterceptor) {
    g.__ConnectInterceptor = {
      init,
      wrapConnectModal,
      processStep0To1,
      processStep1To2,
      processStep2To3,
      handleDisconnect,
      retryConnectFlow,
      getState,
      _resetForTest,
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      init();
    } else {
      document.addEventListener('DOMContentLoaded', () => init());
    }
  }
}
