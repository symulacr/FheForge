/**
 * @file status-badge.js — StatusBadge Component
 *
 * Status indicator component. Maps status values to visual tones
 * following the FheForge design system colors.
 *
 * Status-to-tone mapping:
 *   active / live / healthy  → accent (#3b82f6)
 *   confirmed / executed / success → success (#22c55e)
 *   pending / queued / warning → warning (#eab308)
 *   defeated / failed / error / danger → destructive (#ef4444)
 *   default / other → muted (#888888)
 *
 * Design tokens (follows DESIGN.md):
 *   - zero border-radius, pill shape (rounded-full) is allowed per DESIGN.md
 *   - uppercase monospace label
 *   - JetBrains Mono font family
 *
 * Browser usage:
 *   const StatusBadge = window.__BRIDGE_COMPONENTS.StatusBadge;
 *   React.createElement(StatusBadge, { status: "active" });
 *
 * JSX usage:
 *   <StatusBadge status="active" />
 *   <StatusBadge status="executed" />
 *   <StatusBadge status="defeated" />
 *
 * @param {Object} props
 * @param {string} props.status - Status value to display (e.g. "active", "executed", "defeated", "pending")
 * @param {'sm'|'md'} [props.size='md'] - Badge size
 * @param {boolean} [props.pill=true] - Use pill shape (rounded-full) or sharp corners
 * @param {string} [props.customLabel] - Override label text (defaults to status)
 * @param {Object} [props.customTone] - Custom tone colors { bg, text, border }
 * @param {Object} [props.style] - Additional inline styles
 * @returns {React.ReactElement}
 */

/**
 * Default status-to-tone mapping.
 * Maps common DeFi/governance status values to design tokens.
 *
 * @type {Object<string, {bg: string, text: string, border: string}>}
 */
var STATUS_TONES = {
  // Active / live states → accent
  active: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6', border: '#3b82f6' },
  live: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6', border: '#3b82f6' },
  running: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6', border: '#3b82f6' },
  open: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6', border: '#3b82f6' },

  // Success / confirmed states → success (#22c55e)
  executed: { bg: 'rgba(34, 197, 94, 0.12)', text: '#22c55e', border: '#22c55e' },
  confirmed: { bg: 'rgba(34, 197, 94, 0.12)', text: '#22c55e', border: '#22c55e' },
  success: { bg: 'rgba(34, 197, 94, 0.12)', text: '#22c55e', border: '#22c55e' },
  done: { bg: 'rgba(34, 197, 94, 0.12)', text: '#22c55e', border: '#22c55e' },
  healthy: { bg: 'rgba(34, 197, 94, 0.12)', text: '#22c55e', border: '#22c55e' },
  encrypted: { bg: 'rgba(34, 197, 94, 0.12)', text: '#22c55e', border: '#22c55e' },

  // Warning / pending states → warning (#eab308)
  pending: { bg: 'rgba(234, 179, 8, 0.12)', text: '#eab308', border: '#eab308' },
  queued: { bg: 'rgba(234, 179, 8, 0.12)', text: '#eab308', border: '#eab308' },
  warning: { bg: 'rgba(234, 179, 8, 0.12)', text: '#eab308', border: '#eab308' },
  atRisk: { bg: 'rgba(234, 179, 8, 0.12)', text: '#eab308', border: '#eab308' },

  // Error / danger states → destructive (#ef4444)
  defeated: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: '#ef4444' },
  failed: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: '#ef4444' },
  error: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: '#ef4444' },
  danger: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: '#ef4444' },
  reverted: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: '#ef4444' },
  liquidation: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: '#ef4444' },

  // Default / fallback → muted
  default: { bg: 'rgba(136, 136, 136, 0.12)', text: '#888888', border: '#888888' },
  unknown: { bg: 'rgba(136, 136, 136, 0.12)', text: '#888888', border: '#888888' },
};

/** Size config */
var SIZE_CFG = {
  sm: { fs: 9, px: '2px 5px' },
  md: { fs: 10, px: '3px 7px' },
};

/**
 * StatusBadge — displays a status label with appropriate tone colors.
 *
 * @param {Object} props
 * @returns {React.ReactElement}
 */
function StatusBadge(_ref) {
  var status = _ref.status,
    _ref$size = _ref.size,
    size = _ref$size === void 0 ? 'md' : _ref$size,
    _ref$pill = _ref.pill,
    pill = _ref$pill === void 0 ? true : _ref$pill,
    customLabel = _ref.customLabel,
    customTone = _ref.customTone,
    style = _ref.style;

  var normalizedStatus = (status || 'unknown').toLowerCase();
  var tones = customTone || STATUS_TONES[normalizedStatus] || STATUS_TONES.unknown;
  var cfg = SIZE_CFG[size] || SIZE_CFG.md;

  var label = customLabel || status || 'unknown';

  var badgeStyle = Object.assign(
    {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace',
      fontSize: cfg.fs,
      letterSpacing: 0.1,
      textTransform: 'uppercase',
      padding: cfg.px,
      background: tones.bg,
      color: tones.text,
      border: `1px solid ${tones.border}`,
      borderRadius: pill ? 9999 : 0,
      lineHeight: 1.4,
    },
    style || {},
  );

  return React.createElement(
    'span',
    {
      className: `status-badge status-${normalizedStatus}`,
      style: badgeStyle,
    },
    label,
  );
}

// ─── Window Export (for IIFE / non-module consumers) ─────────────────────

if (typeof window !== 'undefined') {
  window.__BRIDGE_COMPONENTS = window.__BRIDGE_COMPONENTS || {};
  window.__BRIDGE_COMPONENTS.StatusBadge = StatusBadge;
}

export default StatusBadge;
