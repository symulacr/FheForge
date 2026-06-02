/**
 * @file cipher-value.js — CipherValue Component
 *
 * Encrypted value display component. Shows numeric values with a blur effect
 * when encrypted (locked) and plain text when decrypted (unlocked).
 * Supports multiple sizes and an inline mode.
 *
 * Design tokens (follows DESIGN.md):
 *   - Locked: filter blur, muted color
 *   - Unlocked: plain text, full opacity
 *   - Lock indicator: uppercase "encrypted" label in muted color
 *
 * Browser usage:
 *   const CipherValue = window.__BRIDGE_COMPONENTS.CipherValue;
 *   React.createElement(CipherValue, { value: "68,412.07", unit: "USD", locked: true, size: "xxl" });
 *
 * JSX usage:
 *   <CipherValue value="68,412.07" unit="USD" locked={locked} size="xxl" />
 *
 * @param {Object} props
 * @param {string} props.value - The value to display (e.g. "68,412.07")
 * @param {string} [props.unit] - Optional unit suffix (e.g. "USD", "ETH")
 * @param {boolean} [props.locked=true] - Whether the value is encrypted/blurred
 * @param {'sm'|'md'|'lg'|'xl'|'xxl'} [props.size='md'] - Display size
 * @param {boolean} [props.inline=false] - Whether to suppress the lock label
 * @param {boolean} [props.dim=false] - Reduce opacity
 * @param {Object} [props.style] - Additional inline styles
 * @returns {React.ReactElement}
 */

/** Size configuration map */
var SIZE_MAP = {
  sm: { fs: 13, gap: 6 },
  md: { fs: 15, gap: 8 },
  lg: { fs: 22, gap: 10 },
  xl: { fs: 36, gap: 12 },
  xxl: { fs: 56, gap: 14 },
};

/**
 * CipherValue — displays encrypted/decrypted values with blur effect.
 *
 * @param {Object} props
 * @returns {React.ReactElement}
 */
function CipherValue(_ref) {
  var value = _ref.value,
      unit = _ref.unit,
      _ref$locked = _ref.locked,
      locked = _ref$locked === void 0 ? true : _ref$locked,
      _ref$size = _ref.size,
      size = _ref$size === void 0 ? 'md' : _ref$size,
      _ref$inline = _ref.inline,
      inline = _ref$inline === void 0 ? false : _ref$inline,
      _ref$dim = _ref.dim,
      dim = _ref$dim === void 0 ? false : _ref$dim,
      style = _ref.style;

  var s = SIZE_MAP[size] || SIZE_MAP.md;
  var isLarge = size === 'xl' || size === 'xxl';

  var containerStyle = Object.assign({
    display: 'inline-flex',
    alignItems: 'baseline',
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    fontSize: isLarge ? 'min(' + s.fs + 'px, ' + (size === 'xxl' ? '14cqi' : '11cqi') + ')' : s.fs + 'px',
    gap: s.gap + 'px',
    opacity: dim ? 0.55 : 1,
    position: 'relative',
  }, style || {});

  var valueStyle = {
    transition: 'filter 1.1s ease, letter-spacing 1.1s ease, color 1.1s ease',
    filter: locked ? 'blur(6.5px) saturate(0.4)' : 'none',
    letterSpacing: locked ? '0.02em' : 'normal',
    color: locked ? 'var(--cipher-haze, #666)' : 'inherit',
    userSelect: locked ? 'none' : 'auto',
  };

  var unitStyle = {
    marginLeft: 4,
    color: 'var(--muted, #888)',
  };

  var lockMarkStyle = {
    marginLeft: 8,
    fontSize: 10,
    color: 'var(--muted, #888)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    opacity: locked ? 1 : 0,
    transition: 'opacity 0.35s ease',
  };

  return React.createElement('span', {
    className: 'cipher' + (locked ? ' locked' : ' unlocked') + (isLarge ? ' cipher-fit' : ''),
    style: containerStyle,
    title: locked
      ? 'Encrypted on-chain. Grant a permit so your wallet can decrypt this value.'
      : 'Decrypted locally with your permit. Re-encrypts when the permit expires.',
  },
    React.createElement('span', { className: 'plain', style: valueStyle },
      value,
      unit ? React.createElement('span', { style: unitStyle }, unit) : null
    ),
    !inline ? React.createElement('span', { className: 'lock-mark', style: lockMarkStyle },
      locked ? 'encrypted' : ''
    ) : null
  );
}

// ─── Window Export (for IIFE / non-module consumers) ─────────────────────

if (typeof window !== 'undefined') {
  window.__BRIDGE_COMPONENTS = window.__BRIDGE_COMPONENTS || {};
  window.__BRIDGE_COMPONENTS.CipherValue = CipherValue;
}

export default CipherValue;
