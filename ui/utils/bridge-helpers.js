// ui/utils/bridge-helpers.js — shared bridge context helpers
// Loaded before screen files. Exposes shared functions on window.

var EMPTY_BRIDGE_CONTEXT_SHARED = React.createContext({ data: {}, meta: { errors: [] } });

function useOptionalBridge() {
  var bridgeContext = typeof window !== "undefined" ? window.BridgeContext : null;
  return React.useContext(bridgeContext || EMPTY_BRIDGE_CONTEXT_SHARED);
}

function classifyBridgeStatus(message, fallback) {
  var lower = String(message || "").toLowerCase();
  if (lower.includes("registry")) return "registry unavailable";
  if (lower.includes("rpc") || lower.includes("viem") || lower.includes("contract") || lower.includes("on-chain")) return "RPC unavailable";
  if (lower.includes("backend") || lower.includes("api") || lower.includes("fetch") || lower.includes("network") || lower.includes("request")) return "backend unavailable";
  return fallback || "bridge unavailable";
}

function getBridgeStatus(bridge, key, fallback) {
  var meta = (bridge && bridge.meta) || {};
  var data = (bridge && bridge.data) || {};
  var readiness = meta.readiness || bridge.readiness || data.readiness || {};
  var entry = readiness[key] || readiness[String(key).replace(/s$/, "")] || null;
  if (entry) {
    var status = String(entry.status || entry.state || "").toLowerCase();
    var reason = String(entry.reason || entry.message || "");
    if (status === "ready" || status === "ok" || status === "available") return null;
    if (reason) return classifyBridgeStatus(reason, fallback);
    if (status) return classifyBridgeStatus(status, fallback);
  }
  var errors = Array.isArray(meta.errors) ? meta.errors : [];
  var error = errors.slice().reverse().find(function(err) {
    var source = String(err && err.source || "").toLowerCase();
    var message = String(err && (err.message || (err.error && err.error.message)) || "").toLowerCase();
    return source.includes(key) || message.includes(key) || message.includes("registry") || message.includes("rpc");
  });
  return error ? classifyBridgeStatus(String(error.message || (error.error && error.error.message) || error), fallback) : fallback;
}
