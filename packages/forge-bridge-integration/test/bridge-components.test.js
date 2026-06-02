/**
 * @file bridge-components.test.js — Tests for shared bridge UI components
 *
 * Tests CipherValue, StatusBadge, and EncryptedDisplay components:
 *   - Correct rendering via React.createElement
 *   - Proper window.__BRIDGE_COMPONENTS registration
 *   - Props handling (locked/unlocked states, sizes, custom tones)
 *   - Edge cases (missing props, unknown statuses, inline modes)
 */

import { describe, it, expect, beforeEach } from 'bun:test';

// ─── React Mock Safeguard ─────────────────────────────────────────────
// Other test files (e.g., connect-interceptor.test.js) may replace
// globalThis.React with a partial mock that doesn't handle children args.
// We save the full React mock from setup.js and restore it in beforeEach.

/**
 * Override React.createElement with the correct version that handles children.
 * Some test files (connect-interceptor) replace React with a mock that only
 * accepts (type, props) and ignores children. Our components pass children
 * as separate arguments: createElement(type, props, child1, child2).
 * We always install the correct version in beforeEach to stay robust.
 */
function ensureReactCreateElement() {
  if (typeof React === 'undefined') {
    globalThis.React = {};
  }
  React.createElement = function (comp, props) {
    var args = Array.prototype.slice.call(arguments);
    var children = args.length > 2 ? args.slice(2) : [];
    return { comp: comp, props: props || {}, children: children };
  };
}

// ─── Setup ─────────────────────────────────────────────────────────────

// Ensure window.__BRIDGE_COMPONENTS exists
if (typeof window !== 'undefined' && !window.__BRIDGE_COMPONENTS) {
  window.__BRIDGE_COMPONENTS = {};
}

// Reset React mock state between tests and protect createElement
beforeEach(function () {
  if (typeof __REACT_MOCK__ !== 'undefined' && __REACT_MOCK__.reset) {
    __REACT_MOCK__.reset();
  }
  ensureReactCreateElement();
});

// ─── CipherValue ────────────────────────────────────────────────────────

describe('CipherValue', function () {
  var CipherValue;

  var getCipherValue = function () {
    if (!CipherValue) {
      return import('../src/components/cipher-value.js').then(function (mod) {
        CipherValue = mod.default;
      });
    }
    return Promise.resolve();
  };

  it('exports CipherValue via default export', function () {
    return getCipherValue().then(function () {
      expect(CipherValue).toBeDefined();
      expect(typeof CipherValue).toBe('function');
    });
  });

  it('registers on window.__BRIDGE_COMPONENTS', function () {
    return getCipherValue().then(function () {
      expect(window.__BRIDGE_COMPONENTS).toBeDefined();
      expect(window.__BRIDGE_COMPONENTS.CipherValue).toBeDefined();
      expect(typeof window.__BRIDGE_COMPONENTS.CipherValue).toBe('function');
    });
  });

  it('renders a span with class "cipher"', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: false });
      expect(el).toBeDefined();
      expect(el.comp).toBe('span');
      expect(el.props.className).toContain('cipher');
    });
  });

  it('adds "locked" class when locked is true', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: true });
      expect(el.props.className).toContain('locked');
    });
  });

  it('adds "unlocked" class when locked is false', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: false });
      expect(el.props.className).toContain('unlocked');
    });
  });

  it('shows value text in children', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '68,412.07', locked: false });
      var plainSpan = el.children[0];
      expect(plainSpan).toBeDefined();
      expect(plainSpan.props.className).toBe('plain');
      expect(plainSpan.children[0]).toBe('68,412.07');
    });
  });

  it('shows unit when provided', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', unit: 'ETH', locked: false });
      var plainSpan = el.children[0];
      var unitSpan = plainSpan.children[1];
      expect(unitSpan).toBeDefined();
      expect(unitSpan.props.style.marginLeft).toBe(4);
      expect(unitSpan.children[0]).toBe('ETH');
    });
  });

  it('shows lock-mark when locked and not inline', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: true, inline: false });
      var lockMark = el.children[1];
      expect(lockMark).toBeDefined();
      expect(lockMark.props.className).toContain('lock-mark');
      expect(lockMark.children[0]).toBe('encrypted');
    });
  });

  it('hides lock-mark when inline (children[1] is null)', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: true, inline: true });
      expect(el.children[1]).toBeNull();
    });
  });

  it('applies blur filter when locked', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: true });
      var plainSpan = el.children[0];
      expect(plainSpan.props.style.filter).toContain('blur');
    });
  });

  it('removes blur filter when unlocked', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: false });
      var plainSpan = el.children[0];
      expect(plainSpan.props.style.filter).toBe('none');
    });
  });

  it('applies dim opacity when dim is true', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: false, dim: true });
      expect(el.props.style.opacity).toBe(0.55);
    });
  });

  it('applies size-based font sizing', function () {
    return getCipherValue().then(function () {
      var elSm = CipherValue({ value: '42', locked: false, size: 'sm' });
      expect(elSm.props.style.fontSize).toBe('13px');
      var elLg = CipherValue({ value: '42', locked: false, size: 'lg' });
      expect(elLg.props.style.fontSize).toBe('22px');
    });
  });

  it('defaults locked to true', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42' });
      expect(el.props.className).toContain('locked');
    });
  });

  it('has descriptive title attribute', function () {
    return getCipherValue().then(function () {
      var el = CipherValue({ value: '42', locked: true });
      expect(el.props.title).toContain('Encrypted on-chain');
      var el2 = CipherValue({ value: '42', locked: false });
      expect(el2.props.title).toContain('Decrypted locally');
    });
  });
});

// ─── StatusBadge ────────────────────────────────────────────────────────

describe('StatusBadge', function () {
  var StatusBadge;

  var getStatusBadge = function () {
    if (!StatusBadge) {
      return import('../src/components/status-badge.js').then(function (mod) {
        StatusBadge = mod.default;
      });
    }
    return Promise.resolve();
  };

  it('exports StatusBadge via default export', function () {
    return getStatusBadge().then(function () {
      expect(StatusBadge).toBeDefined();
      expect(typeof StatusBadge).toBe('function');
    });
  });

  it('registers on window.__BRIDGE_COMPONENTS', function () {
    return getStatusBadge().then(function () {
      expect(window.__BRIDGE_COMPONENTS).toBeDefined();
      expect(window.__BRIDGE_COMPONENTS.StatusBadge).toBeDefined();
      expect(typeof window.__BRIDGE_COMPONENTS.StatusBadge).toBe('function');
    });
  });

  it('renders a span with class "status-badge"', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'active' });
      expect(el).toBeDefined();
      expect(el.comp).toBe('span');
      expect(el.props.className).toContain('status-badge');
    });
  });

  it('displays the status text', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'active' });
      expect(el.children[0]).toBe('active');
    });
  });

  it('maps "active" to accent blue tone', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'active' });
      expect(el.props.style.color).toBe('#3b82f6');
    });
  });

  it('maps "executed" to success green tone', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'executed' });
      expect(el.props.style.color).toBe('#22c55e');
    });
  });

  it('maps "pending" to warning yellow tone', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'pending' });
      expect(el.props.style.color).toBe('#eab308');
    });
  });

  it('maps "defeated" to destructive red tone', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'defeated' });
      expect(el.props.style.color).toBe('#ef4444');
    });
  });

  it('maps "failed" to destructive red tone', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'failed' });
      expect(el.props.style.color).toBe('#ef4444');
    });
  });

  it('maps unknown status to muted gray tone', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'unknown-status-value' });
      expect(el.props.style.color).toBe('#888888');
    });
  });

  it('handles undefined status gracefully', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({});
      expect(el.children[0]).toBe('unknown');
      expect(el.props.className).toContain('status-unknown');
    });
  });

  it('uses customLabel when provided', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'active', customLabel: 'LIVE' });
      expect(el.children[0]).toBe('LIVE');
    });
  });

  it('uses customTone when provided', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({
        status: 'active',
        customTone: { bg: '#000', text: '#fff', border: '#333' },
      });
      expect(el.props.style.background).toBe('#000');
      expect(el.props.style.color).toBe('#fff');
      expect(el.props.style.border).toContain('#333');
    });
  });

  it('uses pill shape by default', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'active' });
      expect(el.props.style.borderRadius).toBe(9999);
    });
  });

  it('uses sharp corners when pill is false', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'active', pill: false });
      expect(el.props.style.borderRadius).toBe(0);
    });
  });

  it('handles case-insensitive status values', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'ACTIVE' });
      expect(el.props.style.color).toBe('#3b82f6');
    });
  });

  it('applies size "sm" correctly', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'active', size: 'sm' });
      expect(el.props.style.fontSize).toBe(9);
    });
  });

  it('maps "queued" to warning yellow tone', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'queued' });
      expect(el.props.style.color).toBe('#eab308');
    });
  });

  it('maps "encrypted" to success green tone', function () {
    return getStatusBadge().then(function () {
      var el = StatusBadge({ status: 'encrypted' });
      expect(el.props.style.color).toBe('#22c55e');
    });
  });
});

// ─── EncryptedDisplay ───────────────────────────────────────────────────

describe('EncryptedDisplay', function () {
  var EncryptedDisplay;

  var getED = function () {
    if (!EncryptedDisplay) {
      return import('../src/components/encrypted-display.js').then(function (mod) {
        EncryptedDisplay = mod.default;
      });
    }
    return Promise.resolve();
  };

  it('exports EncryptedDisplay via default export', function () {
    return getED().then(function () {
      expect(EncryptedDisplay).toBeDefined();
      expect(typeof EncryptedDisplay).toBe('function');
    });
  });

  it('registers on window.__BRIDGE_COMPONENTS', function () {
    return getED().then(function () {
      expect(window.__BRIDGE_COMPONENTS).toBeDefined();
      expect(window.__BRIDGE_COMPONENTS.EncryptedDisplay).toBeDefined();
      expect(typeof window.__BRIDGE_COMPONENTS.EncryptedDisplay).toBe('function');
    });
  });

  it('renders a span with class "encrypted-display"', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: false, children: 'sensitive data' });
      expect(el).toBeDefined();
      expect(el.comp).toBe('span');
      expect(el.props.className).toContain('encrypted-display');
    });
  });

  it('adds "locked" class when locked is true', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: true, children: 'data' });
      expect(el.props.className).toContain('locked');
    });
  });

  it('adds "unlocked" class when locked is false', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: false, children: 'data' });
      expect(el.props.className).toContain('unlocked');
    });
  });

  it('renders children inside the content wrapper', function () {
    return getED().then(function () {
      var childEl = { comp: 'span', props: { id: 'test-child' }, children: [] };
      var el = EncryptedDisplay({ locked: false, children: childEl });
      var contentSpan = el.children[0];
      expect(contentSpan).toBeDefined();
      expect(contentSpan.props.className).toBe('encrypted-content');
      expect(contentSpan.children[0].props.id).toBe('test-child');
    });
  });

  it('applies blur filter when locked', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: true, children: 'data' });
      var contentSpan = el.children[0];
      expect(contentSpan.props.style.filter).toContain('blur');
    });
  });

  it('removes blur filter when unlocked', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: false, children: 'data' });
      var contentSpan = el.children[0];
      expect(contentSpan.props.style.filter).toBe('none');
    });
  });

  it('shows encrypted indicator with label when locked', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: true, children: 'data' });
      var indicator = el.children[1];
      expect(indicator).toBeDefined();
      expect(indicator.props.className).toContain('encrypted-indicator');
      expect(indicator.children[1]).toBe('encrypted');
    });
  });

  it('hides encrypted indicator when unlocked (null)', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: false, children: 'data' });
      expect(el.children[1]).toBeNull();
    });
  });

  it('uses custom label for encrypted indicator', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: true, children: 'data', label: 'shielded' });
      var indicator = el.children[1];
      expect(indicator.children[1]).toBe('shielded');
    });
  });

  it('hides indicator when showIcon is false (null)', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: true, children: 'data', showIcon: false });
      expect(el.children[1]).toBeNull();
    });
  });

  it('renders as inline-block when inline is true', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: false, children: 'data', inline: true });
      expect(el.props.style.display).toBe('inline-block');
    });
  });

  it('renders as block by default', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: false, children: 'data' });
      expect(el.props.style.display).toBe('block');
    });
  });

  it('includes className when provided', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: false, children: 'data', className: 'extra-class' });
      expect(el.props.className).toContain('extra-class');
    });
  });

  it('has descriptive title when locked', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: true, children: 'data' });
      expect(el.props.title).toContain('Encrypted on-chain');
    });
  });

  it('has descriptive title when unlocked', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: false, children: 'data' });
      expect(el.props.title).toContain('Decrypted with your active permit');
    });
  });

  it('defaults locked to true', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ children: 'data' });
      expect(el.props.className).toContain('locked');
    });
  });

  it('renders SVG lock icon in indicator', function () {
    return getED().then(function () {
      var el = EncryptedDisplay({ locked: true, children: 'data' });
      var indicator = el.children[1];
      var iconSpan = indicator.children[0];
      expect(iconSpan).toBeDefined();
      expect(iconSpan.props.className).toContain('encrypted-lock-icon');
      var svg = iconSpan.children[0];
      expect(svg).toBeDefined();
      expect(svg.comp).toBe('svg');
    });
  });
});

// ─── bridge-components.js barrel ──────────────────────────────────────

describe('bridge-components.js barrel', function () {
  it('imports bridge-components and exports all components', function () {
    return import('../src/components/bridge-components.js').then(function (mod) {
      expect(mod.CipherValue).toBeDefined();
      expect(mod.StatusBadge).toBeDefined();
      expect(mod.EncryptedDisplay).toBeDefined();
    });
  });

  it('registers all components on window.__BRIDGE_COMPONENTS', function () {
    return import('../src/components/bridge-components.js').then(function () {
      expect(window.__BRIDGE_COMPONENTS.CipherValue).toBeDefined();
      expect(window.__BRIDGE_COMPONENTS.StatusBadge).toBeDefined();
      expect(window.__BRIDGE_COMPONENTS.EncryptedDisplay).toBeDefined();
    });
  });
});

// ─── components/index.js barrel ───────────────────────────────────────

describe('components/index.js barrel', function () {
  it('exports CipherValue', function () {
    return import('../src/components/index.js').then(function (mod) {
      expect(mod.CipherValue).toBeDefined();
      expect(typeof mod.CipherValue).toBe('function');
    });
  });

  it('exports StatusBadge', function () {
    return import('../src/components/index.js').then(function (mod) {
      expect(mod.StatusBadge).toBeDefined();
      expect(typeof mod.StatusBadge).toBe('function');
    });
  });

  it('exports EncryptedDisplay', function () {
    return import('../src/components/index.js').then(function (mod) {
      expect(mod.EncryptedDisplay).toBeDefined();
      expect(typeof mod.EncryptedDisplay).toBe('function');
    });
  });
});

// ─── Backward Compatibility ────────────────────────────────────────────

describe('window.__BRIDGE_COMPONENTS backward compatibility', function () {
  it('provides IIFE consumers access to all components', function () {
    return import('../src/components/bridge-components.js').then(function () {
      var bc = window.__BRIDGE_COMPONENTS;
      expect(bc).toBeDefined();
      expect(typeof bc.CipherValue).toBe('function');
      expect(typeof bc.StatusBadge).toBe('function');
      expect(typeof bc.EncryptedDisplay).toBe('function');

      // Can be used with React.createElement pattern
      var cipherEl = bc.CipherValue({ value: '100', locked: true });
      expect(cipherEl).toBeDefined();
      expect(cipherEl.props.className).toContain('cipher');

      var badgeEl = bc.StatusBadge({ status: 'active' });
      expect(badgeEl).toBeDefined();
      expect(badgeEl.props.style.color).toBe('#3b82f6');

      var encEl = bc.EncryptedDisplay({ locked: true, children: 'data' });
      expect(encEl).toBeDefined();
      expect(encEl.props.className).toContain('encrypted-display');
    });
  });
});
