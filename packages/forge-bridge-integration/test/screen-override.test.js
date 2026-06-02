/**
 * Screen Override Tests
 *
 * Tests the BridgeScreenWrapper and BridgeConnectModal HOCs.
 */

import { describe, it, expect } from 'bun:test';

// Browser globals (window, document, React, __BRIDGE__) set up by test/setup.js

import '../src/screen-override.js';

describe('screen-override.js', () => {
  it('defines BridgeScreenWrapper function via __wrapScreens', () => {
    expect(typeof globalThis.window.__wrapScreens).toBe('function');
  });

  it('wraps a screen component with key={dataVersion}', () => {
    const FakeScreen = function (props) {
      return { type: 'screen', props };
    };
    globalThis.window.Landing = FakeScreen;

    // Run wrapScreens
    globalThis.window.__wrapScreens();

    // Should be wrapped now
    expect(globalThis.window.Landing).not.toBe(FakeScreen);
    expect(globalThis.window.Landing.__wrapped).toBe(true);

    // Render the wrapped component
    const rendered = globalThis.window.Landing({ customProp: 'test' });
    expect(rendered.props.key).toBeDefined();
    expect(typeof rendered.props.key).toBe('number');
    expect(rendered.props.customProp).toBe('test');
  });

  it('wraps ConnectModal with BridgeConnectModal', () => {
    const FakeModal = function (props) {
      return { type: 'modal', props };
    };
    globalThis.window.ConnectModal = FakeModal;

    globalThis.window.__wrapScreens();

    expect(globalThis.window.ConnectModal).not.toBe(FakeModal);
    expect(globalThis.window.ConnectModal.__wrapped).toBe(true);
  });

  it('wraps all 6 screen names', () => {
    const screens = ['Landing', 'Dashboard', 'Lending', 'Market', 'Governance', 'ConnectModal'];
    screens.forEach(function (name) {
      const Fake = function (props) { return { name: name, props: props }; };
      globalThis.window[name] = Fake;
    });

    globalThis.window.__wrapScreens();

    screens.forEach(function (name) {
      expect(globalThis.window[name].__wrapped).toBe(true);
    });
  });
});

describe('BridgeConnectModal onNext interception', () => {
  it('ConnectModal wrapper passes onNext through props', () => {
    const FakeModal = function (props) {
      return { type: 'modal', props };
    };
    globalThis.window.ConnectModal = FakeModal;
    globalThis.window.__wrapScreens();

    const Wrapped = globalThis.window.ConnectModal;
    const rendered = Wrapped({ onNext: 'original-onnext', customProp: 'test' });

    // Should have onNext in props (passed through)
    expect(rendered.props.onNext).toBeDefined();
    // The key should be set
    expect(rendered.props.key).toBeDefined();
    expect(typeof rendered.props.key).toBe('number');
  });
});
