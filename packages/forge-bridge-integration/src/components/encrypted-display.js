/**
 * @file encrypted-display.js — EncryptedDisplay Component
 *
 * Generic encrypted data wrapper. Blurs/obscures child content when locked,
 * and shows it normally when unlocked (permit granted).
 *
 * Provides a visual container with:
 *   - Blurred overlay when data is encrypted
 *   - Clear display when data is decrypted
 *   - Lock icon indicator (SVG lock icon)
 *   - Context-appropriate title/tooltip
 *
 * Browser usage:
 *   const EncryptedDisplay = window.__BRIDGE_COMPONENTS.EncryptedDisplay;
 *   React.createElement(EncryptedDisplay, { locked: true },
 *     React.createElement('span', null, 'sensitive data')
 *   );
 *
 * JSX usage:
 *   <EncryptedDisplay locked={locked}>
 *     <span>sensitive data</span>
 *   </EncryptedDisplay>
 *
 * @param {Object} props
 * @param {boolean} [props.locked=true] - Whether content is encrypted/blurred
 * @param {'sm'|'md'|'lg'} [props.size='md'] - Container size/emphasis
 * @param {boolean} [props.showIcon=true] - Whether to show the lock icon indicator
 * @param {boolean} [props.inline=false] - Display as inline-block vs block
 * @param {string} [props.label] - Label shown below the blurred content
 * @param {React.ReactNode} [props.children] - The content to encrypt/protect
 * @param {Object} [props.style] - Additional inline styles
 * @param {string} [props.className] - Additional CSS class name
 * @returns {React.ReactElement}
 */

/**
 * EncryptedDisplay — wraps content with encrypted/decrypted visual state.
 *
 * @param {Object} props
 * @returns {React.ReactElement}
 */
function EncryptedDisplay(_ref) {
  var _ref$locked = _ref.locked,
      locked = _ref$locked === void 0 ? true : _ref$locked,
      _ref$size = _ref.size,
      size = _ref$size === void 0 ? 'md' : _ref$size,
      _ref$showIcon = _ref.showIcon,
      showIcon = _ref$showIcon === void 0 ? true : _ref$showIcon,
      _ref$inline = _ref.inline,
      inline = _ref$inline === void 0 ? false : _ref$inline,
      label = _ref.label,
      children = _ref.children,
      style = _ref.style,
      className = _ref.className;

  var display = inline ? 'inline-block' : 'block';

  var wrapperStyle = Object.assign({
    display: display,
    position: 'relative',
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace',
  }, style || {});

  var contentStyle = {
    display: 'inline-block',
    position: 'relative',
    filter: locked ? 'blur(6px) saturate(0.3)' : 'none',
    transition: 'filter 1.1s ease, opacity 0.35s ease',
    opacity: locked ? 0.6 : 1,
    userSelect: locked ? 'none' : 'auto',
    pointerEvents: locked ? 'none' : 'auto',
  };

  var indicatorStyle = {
    display: showIcon && locked ? 'inline-flex' : 'none',
    alignItems: 'center',
    gap: 4,
    fontSize: size === 'lg' ? 11 : 10,
    color: 'var(--muted, #888)',
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
    marginTop: 4,
  };

  return React.createElement('span', {
    className: 'encrypted-display' + (locked ? ' locked' : ' unlocked') + (className ? ' ' + className : ''),
    style: wrapperStyle,
    title: locked
      ? 'Encrypted on-chain. Grant a permit to view this data.'
      : 'Decrypted with your active permit.',
  },
    React.createElement('span', { className: 'encrypted-content', style: contentStyle },
      children
    ),
    (showIcon && locked)
      ? React.createElement('span', { className: 'encrypted-indicator', style: indicatorStyle },
          React.createElement('span', { className: 'encrypted-lock-icon', style: { display: 'inline-block', width: 10, height: 10 } },
            React.createElement('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none' },
              React.createElement('rect', { x: '2', y: '4', width: '6', height: '5', rx: '1', stroke: 'currentColor', strokeWidth: '0.8', fill: 'none' }),
              React.createElement('path', { d: 'M3 4V3a2 2 0 1 1 4 0v1', stroke: 'currentColor', strokeWidth: '0.8', fill: 'none' })
            )
          ),
          label || 'encrypted'
        )
      : null
  );
}

// ─── Window Export (for IIFE / non-module consumers) ─────────────────────

if (typeof window !== 'undefined') {
  window.__BRIDGE_COMPONENTS = window.__BRIDGE_COMPONENTS || {};
  window.__BRIDGE_COMPONENTS.EncryptedDisplay = EncryptedDisplay;
}

export default EncryptedDisplay;
