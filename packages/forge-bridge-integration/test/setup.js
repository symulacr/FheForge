/**
 * Test Setup — provides browser-like globals for source files
 * that reference window, document, etc.
 *
 * Loaded via --preload in bun test.
 */

// Set up window global
globalThis.window = globalThis.window || {};

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

// Set up React global (for screen-override.js)
globalThis.React = globalThis.React || {
  createElement: function (comp, props) {
    var args = Array.prototype.slice.call(arguments);
    var children = args.length > 2 ? args.slice(2) : [];
    return { comp: comp, props: props || {}, children: children };
  },
  useState: function (init) {
    var state = typeof init === 'function' ? init() : init;
    var setState = function (v) {
      state = typeof v === 'function' ? v(state) : v;
    };
    return [state, setState];
  },
  useEffect: function (fn) { if (typeof fn === 'function') fn(); return function () {}; },
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
