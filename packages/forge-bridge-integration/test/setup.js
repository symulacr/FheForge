/**
 * Test Setup — provides browser-like globals for source files
 * that reference window, document, etc.
 *
 * Loaded via --preload in bun test.
 */

// Set up window global
globalThis.window = globalThis.window || {};

// Ensure window has addEventListener/removeEventListener (needed by DataFetcherV2)
if (!globalThis.window.addEventListener) {
  var _windowListeners = {};
  globalThis.window.addEventListener = function (event, handler) {
    if (!_windowListeners[event]) _windowListeners[event] = [];
    _windowListeners[event].push(handler);
  };
  globalThis.window.removeEventListener = function (event, handler) {
    if (_windowListeners[event]) {
      var idx = _windowListeners[event].indexOf(handler);
      if (idx !== -1) _windowListeners[event].splice(idx, 1);
    }
  };
}

// Set up document global (for screen-override.js and integration-adapter.js)
globalThis.document = globalThis.document || {
  addEventListener: function (event, handler) {
    if (event === 'DOMContentLoaded') {
      // Store handler for manual triggering
      if (!this._domReadyHandlers) this._domReadyHandlers = [];
      this._domReadyHandlers.push(handler);
    }
  },
  removeEventListener: function () {},
  readyState: 'complete',
  documentElement: { style: {} },
};

// ─── React Mock State ──────────────────────────────────────────────────────
// Tracks internal state across hook calls for testing.
// Reset between tests via __REACT_MOCK__.reset()

var _stateStack = [];
var _stateIdx = 0;
var _cleanupFns = [];
var _effectFn = null; // tracks the most recent effect function

// Set up React global (for screen-override.js and bridge-context.js)
globalThis.React = globalThis.React || {
  // Base Component class for error boundary and class component support.
  Component: class Component {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
    setState(partial) {
      var nextState = typeof partial === 'function'
        ? partial(this.state, this.props)
        : partial;
      this.state = Object.assign({}, this.state, nextState);
    }
  },

  createElement: function (comp, props) {
    var args = Array.prototype.slice.call(arguments);
    var children = args.length > 2 ? args.slice(2) : [];
    return { comp: comp, props: props || {}, children: children };
  },

  useState: function (init) {
    var idx = _stateIdx++;
    if (_stateStack[idx] === undefined) {
      _stateStack[idx] = typeof init === 'function' ? init() : init;
    }
    var setState = function (v) {
      _stateStack[idx] = typeof v === 'function' ? v(_stateStack[idx]) : v;
    };
    return [_stateStack[idx], setState];
  },

  useEffect: function (fn) {
    if (typeof fn === 'function') {
      var cleanup = fn();
      if (typeof cleanup === 'function') {
        _cleanupFns.push(cleanup);
      }
      _effectFn = fn;
    }
    return function () {};
  },

  useRef: function (initialValue) {
    return { current: initialValue };
  },

  useCallback: function (fn, deps) {
    return fn;
  },

  createContext: function (defaultValue) {
    var ctx = {
      _value: defaultValue,
      _defaultValue: defaultValue,
      Provider: function (props) {
        ctx._value = props.value;
        // Provider renders children
        return props.children;
      },
      Consumer: function (props) {
        return props.children(ctx._value);
      },
    };
    ctx.Provider.displayName = 'BridgeContext.Provider';
    return ctx;
  },

  useContext: function (ctx) {
    return ctx._value !== undefined ? ctx._value : ctx._defaultValue;
  },

  useMemo: function (fn, deps) {
    return fn();
  },

  useReducer: function (reducer, initialArg, init) {
    var idx = _stateIdx++;
    if (_stateStack[idx] === undefined) {
      _stateStack[idx] = init ? init(initialArg) : initialArg;
    }
    var dispatch = function (action) {
      _stateStack[idx] = reducer(_stateStack[idx], action);
    };
    return [_stateStack[idx], dispatch];
  },
};

// Expose mock state helpers for test files
globalThis.__REACT_MOCK__ = {
  reset: function () {
    _stateStack = [];
    _stateIdx = 0;
    _cleanupFns = [];
    _effectFn = null;
  },
  getStateStack: function () { return _stateStack; },
  getCleanupFns: function () { return _cleanupFns; },
  runCleanups: function () {
    _cleanupFns.forEach(function (fn) { fn(); });
    _cleanupFns = [];
  },
};

// Set up __MOCK__ and __BRIDGE__ globals (as in babel-transform-plugin.js)
globalThis.window.__MOCK__ = globalThis.window.__MOCK__ || {};
if (!globalThis.window.__BRIDGE__) {
  globalThis.window.__BRIDGE__ = {
    setMockData: function (key, value) {
      globalThis.window.__MOCK__[key] = value;
      this._listeners.forEach(function (fn) { fn(key, value); });
    },
    getMockData: function (key) {
      return globalThis.window.__MOCK__ != null ? globalThis.window.__MOCK__[key] : undefined;
    },
    onDataUpdate: function (fn) {
      this._listeners.add(fn);
      var self = this;
      return function () { self._listeners.delete(fn); };
    },
    notify: function () {
      this._dataVersion++;
      this._listeners.forEach(function (fn) { fn(this._dataVersion); }.bind(this));
    },
    _listeners: new Set(),
    _dataVersion: 0,
  };
}
