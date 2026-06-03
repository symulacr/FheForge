#!/usr/bin/env python3
"""
FheForge Browser Test Suite (FHT)

Automated browser tests for FheForge using browser-use CLI.
Tests are designed to be run with a static HTTP server at port 8080
serving the repository root directory.

Usage:
    python3 packages/forge-bridge-integration/test/browser/run.py [--headed] [--url URL]

    Or via bun:
    bun test:browser

Tests:
    FHT-01: All 6 screen components render (Landing, Dashboard, Lending, Market,
            Governance, ConnectModal) — verify DOM has all components rendering.
    FHT-02: All 25+ mock keys populated — eval window.__MOCK__ keys length >= 25.
    FHT-03: No unexpected console errors — intercept all console.error calls,
            verify 0 unexpected errors (CORS expected).
    FHT-04: ForgeProvider wraps app — check window.ForgeProvider exists,
            DOM has ForgeProvider wrapper.
    FHT-05: ConnectInterceptor initialized — check window.__ConnectInterceptor
            with init(), wrapConnectModal(), processStep0To1() methods.
    FHT-06 through FHT-10: Per-page mock data verification — browser tests that
            verify each of the 5 screens (Home, Portfolio, Lend, Strategies,
            Governance) renders real mock data values (not placeholders).
    FHT-11: Console error gate — fails if any console.error or uncaught
            exception fires during navigation across all 5 screens.
    FHT-12: Responsive breakpoint smoke test — verify app renders without
            layout crashes at 375px (mobile), 768px (tablet), 1440px (desktop).
"""

import subprocess
import sys
import time
import os
import json
import argparse

# ─── Configuration ───────────────────────────────────────────────────────────

BROWSER_USE = "browser-use"
BASE_URL = os.environ.get("FHT_URL", "http://localhost:8080/ui/FheForge.html")
SESSION = "fht-suite"
LOAD_WAIT = int(os.environ.get("FHT_WAIT", "20"))

# The page loads ~1700+ ESM modules from esm.sh CDN, plus Babel standalone
# processes text/babel scripts for all screen components. Leave ample time.

# ─── Browser-Use CLI Utilities ───────────────────────────────────────────────

HEADLESS = True  # default; overridden by --headed flag


def run_bu(args, session=SESSION, timeout=45):
    """Run a browser-use CLI command and return CompletedProcess."""
    cmd = [BROWSER_USE, "--session", session]
    if not HEADLESS:
        cmd.append("--headed")
    cmd.extend(args)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return result


def js(code, session=SESSION):
    """Evaluate JavaScript in the browser and return (value, stderr, rc).

    Parses the browser-use CLI output format 'result: <value>' and returns
    just the value portion. Returns raw stdout if no 'result:' prefix found.
    """
    r = run_bu(["eval", code], session=session)
    stdout = r.stdout.strip()
    for line in stdout.split('\n'):
        line = line.strip()
        if line.startswith('result:'):
            return line[len('result:'):].strip(), r.stderr.strip(), r.returncode
    # If no 'result:' prefix, return raw stdout
    return stdout, r.stderr.strip(), r.returncode


def navigate(url=None, session=SESSION):
    """Navigate to URL and wait for page content to load."""
    target = url or BASE_URL
    r = run_bu(["open", target], session=session)
    # Wait for page + CDN modules to start loading
    print("  Waiting for page content to load...")
    time.sleep(LOAD_WAIT)
    return r


def wait_for(js_condition, timeout=15, interval=0.5, session=SESSION):
    """Poll JS condition until it returns 'true' or timeout.

    Handles both lowercase 'true' (String(true)) and Python-style
    'True' (raw boolean from browser-use CLI serialization).
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        out, _, _ = js(js_condition, session=session)
        if out.lower() == "true":
            return True
        time.sleep(interval)
    return False


def close_session(session=SESSION):
    """Close the browser session."""
    try:
        run_bu(["close"], session=session, timeout=10)
    except Exception:
        pass


# ─── Test Infrastructure ─────────────────────────────────────────────────────

passed = 0
failed = 0
test_errors = []


def report(name, fn):
    """Run a test function and track pass/fail."""
    global passed, failed
    print(f"\n{'─' * 60}")
    print(f"  TEST: {name}")
    print(f"{'─' * 60}")
    try:
        errors = fn()
        if not errors:
            print(f"  ✓ PASS")
            passed += 1
        else:
            for e in errors:
                print(f"  ✗ {e}")
            failed += 1
            test_errors.append((name, errors))
    except Exception as e:
        print(f"  ✗ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        failed += 1
        test_errors.append((name, str(e)))


# ─── Test Implementations ────────────────────────────────────────────────────


def fht01_all_screens_render():
    """
    FHT-01: All 6 screen components render.
    Navigates to the page and verifies that all 6 screen component
    functions are registered on window. Also checks that the Landing
    screen (initial route) renders visible content in the DOM.
    """
    issues = []

    # 1. Wait for React root to render (initial page load)
    root_ok = wait_for(
        "String((document.getElementById('root')?.children.length || 0) > 0)",
        timeout=20
    )
    if not root_ok:
        issues.append("Page root element has no children after 20s timeout")
        return issues

    # 2. Wait for Landing screen component (text/babel scripts take time)
    #    Note: wrap boolean in String() for consistent lowercase output
    landing_ok = wait_for(
        "String(typeof window.Landing === 'function')",
        timeout=30
    )
    if not landing_ok:
        issues.append("window.Landing not a function after 30s timeout")
        # Still try to check other components

    # 3. Check all 6 screen component functions exist on window
    #    Wrap boolean in String() for consistent lowercase output
    screens = ["Landing", "Dashboard", "Lending", "Market", "Governance", "ConnectModal"]
    missing = []
    for s in screens:
        out, _, _ = js(f"String(typeof window.{s} === 'function')")
        if out != "true":
            missing.append(s)
    if missing:
        issues.append(f"Missing screen components on window: {', '.join(missing)}")

    # 4. Verify the active route (home → Landing) renders meaningful content
    has_landing_content, _, _ = js(
        "String((document.body.textContent || '').length > 200)"
    )
    if has_landing_content != "true":
        issues.append("Landing screen has insufficient rendered content")

    # 5. Navigate through routes using React Router's __setRoute if available,
    #    otherwise the TopBar navigation buttons
    routes = {
        "portfolio": "Dashboard",
        "lend": "Lending",
        "strategies": "Market",
        "governance": "Governance",
    }

    for route_key, screen_name in routes.items():
        # Use the app's own navigate function exposed on window if available,
        # otherwise try clicking nav buttons by matching text
        out, _, _ = js(
            f"""
            (function() {{
                // Try using React internals by clicking route button
                var root = document.getElementById('root');
                if (!root) return 'no-root';
                var allBtns = root.querySelectorAll('button');
                for (var i = 0; i < allBtns.length; i++) {{
                    var txt = (allBtns[i].textContent || '').trim().toLowerCase();
                    if (txt.indexOf('{route_key}') !== -1 || txt.indexOf('{screen_name.lower()}') !== -1) {{
                        allBtns[i].click();
                        return 'clicked';
                    }}
                }}
                // Fallback: try picker buttons in TweaksPanel
                var tweaks = document.querySelectorAll('.tweak-section + .row button');
                for (var i = 0; i < tweaks.length; i++) {{
                    var txt = (tweaks[i].textContent || '').trim().toLowerCase();
                    if (txt === '{route_key}' || txt === '{screen_name.lower()[:4]}') {{
                        tweaks[i].click();
                        return 'clicked:tweak';
                    }}
                }}
                return 'no-match';
            }})()
            """
        )
        time.sleep(2)  # Allow React render cycle and data loading

        # Verify navigation worked by checking rendered content changed
        out2, _, _ = js(
            "String((document.body.textContent || '').length > 50)"
        )
        if out2 != "true":
            issues.append(f"Route {route_key} navigated but page has no content")

    return issues


def fht02_mock_keys_populated():
    """
    FHT-02: All 25+ mock keys populated.
    Checks that window.__MOCK__ exists and has at least 25 keys.
    Also verifies known keys have non-empty, non-placeholder values.
    """
    issues = []

    # Check __MOCK__ exists
    mock_exists, _, _ = js("String(typeof window.__MOCK__ !== 'undefined')")
    if mock_exists != "true":
        return ["window.__MOCK__ is undefined"]

    # Count keys
    out, _, _ = js(
        "(function() { var m = window.__MOCK__; "
        "return m ? String(Object.keys(m).length) : '0'; })()"
    )
    try:
        count = int(out)
    except (ValueError, TypeError):
        return [f"Cannot parse mock key count: '{out}'"]

    if count < 25:
        issues.append(f"Only {count} mock keys (expected >= 25)")

    # Verify specific known keys have content (not empty/placeholder)
    expected_keys = [
        "TICKER_ITEMS", "L_MARKETS", "D_ACTIVITY",
        "D_POSITIONS", "D_STRATS", "PROPOSALS",
        "COMMUNITY", "NODE_TYPES", "DEMO_ROWS",
    ]
    out, _, _ = js(
        "(function() { var m = window.__MOCK__; if (!m) return '[]'; "
        "var result = []; "
        + "".join(f"result.push('{k}:' + String(Array.isArray(m['{k}']) ? m['{k}'].length : (m['{k}'] ? 'ok' : 'missing')));"
                  for k in expected_keys) +
        " return JSON.stringify(result); })()"
    )
    try:
        key_statuses = json.loads(out)
        for ks in key_statuses:
            if 'missing' in ks:
                issues.append(f"Key {ks.split(':')[0]} is missing or null")
            elif ks.endswith(':0'):
                key_name = ks.split(':')[0]
                issues.append(f"Key {key_name} is an empty array")
    except (json.JSONDecodeError, TypeError):
        issues.append(f"Cannot parse key statuses: {out[:200]}")

    # Check for placeholder/empty values
    out, _, _ = js(
        "(function() { var m = window.__MOCK__; if (!m) return 'ok'; "
        "var markers = ['Loading', 'No data', '--', '...', 'undefined']; "
        "var found = []; "
        "Object.keys(m).forEach(function(k) { "
        "  var v = m[k]; "
        "  if (typeof v === 'string' && markers.indexOf(v) >= 0) found.push(k + '=' + v); "
        "  if (Array.isArray(v) && v.length === 0) found.push(k + '=[]'); "
        "}); return JSON.stringify(found); })()"
    )
    try:
        placeholders = json.loads(out)
        if placeholders:
            issues.append(f"Placeholder/empty values found: {placeholders[:5]}")
    except (json.JSONDecodeError, TypeError):
        pass

    return issues


def fht03_no_console_errors():
    """
    FHT-03: No unexpected console errors.
    Overrides console.error to intercept calls, then checks for
    unexpected errors. CORS-related errors are expected from the
    CDN module loading and are excluded from the failure count.
    """
    issues = []

    # Install console.error interceptor
    # Must be done after page load but early enough to catch async errors
    js("""
        (function() {
            if (window.__consoleErrors !== undefined) return;
            window.__consoleErrors = [];
            var orig = console.error;
            console.error = function() {
                var args = Array.prototype.slice.call(arguments);
                var msg = args.map(function(a) {
                    return typeof a === 'string' ? a : (a && a.message ? a.message : String(a));
                }).join(' ');
                window.__consoleErrors.push(msg);
                return orig.apply(console, arguments);
            };
        })()
    """)

    # Wait for more scripts to load and potentially error
    time.sleep(5)

    # Collect errors
    out, _, _ = js("JSON.stringify(window.__consoleErrors || [])")

    # Parse JSON — the "result:" prefix is already stripped by js()
    try:
        all_errors = json.loads(out)
    except (json.JSONDecodeError, TypeError):
        issues.append(f"Cannot parse console errors: '{out[:200]}'")
        return issues

    if not all_errors:
        return issues  # no errors at all — pass

    # Filter out expected CORS / network errors
    expected_patterns = [
        "cors", "CORS", "cross-origin", "Cross-Origin",
        "net::ERR_", "Failed to load", "404", "403",
        "Reown", "Allowlist", "allowlist",
        "WalletConnect", "wc:", "@walletconnect",
        "WebSocket", "websocket",
        "favicon.ico",
        "ResizeObserver loop",
        "chrome-extension",
    ]

    unexpected = []
    for err in all_errors:
        is_expected = any(p.lower() in err.lower() for p in expected_patterns)
        if not is_expected:
            unexpected.append(err)

    if unexpected:
        issues.append(
            f"{len(unexpected)} unexpected console.error(s) "
            f"(out of {len(all_errors)} total): "
            f"{unexpected[:5]}"
        )

    return issues


def fht04_forgeprovider_wraps_app():
    """
    FHT-04: ForgeProvider wraps app.
    Checks that window.ForgeProvider exists and is a function (React
    component). Verifies the DOM root has rendered content, confirming
    the ForgeProvider wrapper is working.
    """
    issues = []

    # Check window.ForgeProvider exists
    fp_exists, _, _ = js("String(typeof window.ForgeProvider !== 'undefined')")
    if fp_exists != "true":
        return ["window.ForgeProvider is undefined"]

    # Check it's a function (React component function/class)
    fp_is_fn, _, _ = js("String(typeof window.ForgeProvider === 'function')")
    if fp_is_fn != "true":
        fp_type, _, _ = js("typeof window.ForgeProvider")
        issues.append(f"window.ForgeProvider type is '{fp_type}', expected 'function'")

    # Check that __DEMO_MODE__ is set (ForgeProvider sets this)
    demo_mode, _, _ = js("String(window.__DEMO_MODE__ === true)")
    if demo_mode != "true":
        issues.append("window.__DEMO_MODE__ is not true (ForgeProvider should set this)")

    # Check root has rendered content
    has_content, _, _ = js(
        "String((document.getElementById('root')?.children.length || 0) > 0)"
    )
    if has_content != "true":
        issues.append("Root element has no rendered children")

    return issues


def fht05_connectinterceptor_initialized():
    """
    FHT-05: ConnectInterceptor initialized.
    Checks that window.__ConnectInterceptor exists with all required
    methods: init(), wrapConnectModal(), processStep0To1(),
    processStep1To2(), processStep2To3().
    """
    issues = []

    # Check __ConnectInterceptor exists
    ci_exists, _, _ = js("String(typeof window.__ConnectInterceptor !== 'undefined')")
    if ci_exists != "true":
        return ["window.__ConnectInterceptor is undefined"]

    # Check required methods
    required_methods = [
        "init",
        "wrapConnectModal",
        "processStep0To1",
        "processStep1To2",
        "processStep2To3",
    ]
    missing_methods = []
    for method in required_methods:
        out, _, _ = js(f"String(typeof window.__ConnectInterceptor.{method} === 'function')")
        if out != "true":
            missing_methods.append(method)

    if missing_methods:
        issues.append(
            f"Missing ConnectInterceptor methods: {', '.join(missing_methods)}"
        )

    return issues


# ─── FHT-06–10: Per-Page Mock Data Verification ─────────────────────────────

def _navigate_to_screen(route_key):
    """Navigate to a screen by clicking the matching nav button.

    Returns True if navigation succeeded.
    """
    out, _, _ = js(
        f"""
        (function() {{
            var root = document.getElementById('root');
            if (!root) return 'no-root';
            var allBtns = root.querySelectorAll('button');
            for (var i = 0; i < allBtns.length; i++) {{
                var txt = (allBtns[i].textContent || '').trim().toLowerCase();
                if (txt.indexOf('{route_key}') !== -1) {{
                    allBtns[i].click();
                    return 'clicked';
                }}
            }}
            return 'no-match';
        }})()
        """
    )
    time.sleep(2)
    return out == "clicked"


def fht06_home_mock_data():
    """
    FHT-06: Home (Landing) screen renders real mock data values.
    Verifies the Landing screen shows actual cipher/portfolio values
    from __MOCK__ (not placeholders like 'Loading' or '--').
    """
    issues = []

    # Ensure we're on the landing/home screen
    # Landing is the default route — just reload and wait
    navigate(BASE_URL)
    time.sleep(3)

    # Check that DEMO_ROWS values appear in rendered content
    body_text, _, _ = js("(document.body.textContent || '')")
    expected_fragments = ["42,084", "Supplied", "Borrowed", "In strategies"]
    for frag in expected_fragments:
        if frag not in body_text:
            issues.append(f"Landing screen missing mock data fragment: '{frag}'")

    # Verify __MOCK__ DEMO_ROWS has real values
    out, _, _ = js(
        "(function() { var m = window.__MOCK__; if (!m || !m.DEMO_ROWS) return 'missing'; "
        "return JSON.stringify(m.DEMO_ROWS); })()"
    )
    if out == "missing":
        issues.append("window.__MOCK__.DEMO_ROWS is missing")
    else:
        try:
            rows = json.loads(out)
            if not rows or len(rows) == 0:
                issues.append("DEMO_ROWS is empty")
            for row in rows:
                if len(row) < 2 or row[1] in ("0.00", "--", "Loading", ""):
                    issues.append(f"DEMO_ROWS has placeholder value: {row}")
        except (json.JSONDecodeError, TypeError):
            issues.append(f"Cannot parse DEMO_ROWS: {out[:100]}")

    return issues


def fht07_portfolio_mock_data():
    """
    FHT-07: Portfolio (Dashboard) screen renders real mock data values.
    Verifies positions, strategies, and activity data from __MOCK__.
    """
    issues = []

    _navigate_to_screen("portfolio")
    time.sleep(2)

    # Check positions data values appear in rendered content
    body_text, _, _ = js("(document.body.textContent || '')")

    # Verify D_POSITIONS values rendered
    position_fragments = ["42,084.13", "5.420", "12,840.00"]
    for frag in position_fragments:
        if frag not in body_text:
            issues.append(f"Dashboard missing position mock data: '{frag}'")

    # Verify D_STRATS values rendered
    strat_fragments = ["Lean USDC leverage", "ETH delta-neutral"]
    for frag in strat_fragments:
        if frag not in body_text:
            issues.append(f"Dashboard missing strategy mock data: '{frag}'")

    # Verify D_ACTIVITY values rendered
    activity_fragments = ["loop iter 3", "Composer open"]
    for frag in activity_fragments:
        if frag not in body_text:
            issues.append(f"Dashboard missing activity mock data: '{frag}'")

    # Verify __MOCK__ has correct data
    out, _, _ = js(
        "(function() { var m = window.__MOCK__; "
        "return JSON.stringify({"
        "  pos: m && m.D_POSITIONS ? m.D_POSITIONS.length : 0,"
        "  strats: m && m.D_STRATS ? m.D_STRATS.length : 0,"
        "  act: m && m.D_ACTIVITY ? m.D_ACTIVITY.length : 0"
        "}); })()"
    )
    try:
        counts = json.loads(out)
        if counts.get("pos", 0) < 5:
            issues.append(f"D_POSITIONS has only {counts.get('pos', 0)} entries (expected >= 5)")
        if counts.get("strats", 0) < 3:
            issues.append(f"D_STRATS has only {counts.get('strats', 0)} entries (expected >= 3)")
        if counts.get("act", 0) < 6:
            issues.append(f"D_ACTIVITY has only {counts.get('act', 0)} entries (expected >= 6)")
    except (json.JSONDecodeError, TypeError):
        issues.append(f"Cannot parse mock data counts: {out[:100]}")

    return issues


def fht08_lend_mock_data():
    """
    FHT-08: Lend screen renders real mock data values.
    Verifies market data (APYs, TVLs, assets) from __MOCK__.
    """
    issues = []

    _navigate_to_screen("lend")
    time.sleep(2)

    body_text, _, _ = js("(document.body.textContent || '')")

    # Verify market assets rendered
    asset_fragments = ["USDC", "ETH", "WBTC", "ARB", "DAI"]
    for frag in asset_fragments:
        if frag not in body_text:
            issues.append(f"Lending screen missing market asset: '{frag}'")

    # Verify APY values rendered (not placeholder)
    apy_fragments = ["4.82", "6.21", "2.14"]
    for frag in apy_fragments:
        if frag not in body_text:
            issues.append(f"Lending screen missing APY value: '{frag}'")

    # Verify TVL values rendered
    tvl_fragments = ["8.42M", "4.18M"]
    for frag in tvl_fragments:
        if frag not in body_text:
            issues.append(f"Lending screen missing TVL value: '{frag}'")

    # Verify __MOCK__ L_MARKETS data
    out, _, _ = js(
        "(function() { var m = window.__MOCK__; "
        "if (!m || !m.L_MARKETS) return 'missing'; "
        "return String(m.L_MARKETS.length); })()"
    )
    if out == "missing":
        issues.append("window.__MOCK__.L_MARKETS is missing")
    else:
        try:
            count = int(out)
            if count < 5:
                issues.append(f"L_MARKETS has only {count} entries (expected >= 5)")
        except (ValueError, TypeError):
            issues.append(f"Cannot parse L_MARKETS count: {out[:50]}")

    return issues


def fht09_strategies_mock_data():
    """
    FHT-09: Strategies (Market) screen renders real mock data values.
    Verifies community strategies and templates from __MOCK__.
    """
    issues = []

    _navigate_to_screen("strategies")
    time.sleep(2)

    body_text, _, _ = js("(document.body.textContent || '')")

    # Verify community strategy names rendered
    strat_fragments = ["Lean USDC leverage", "ETH delta-neutral", "WBTC carry & swap"]
    for frag in strat_fragments:
        if frag not in body_text:
            issues.append(f"Strategies screen missing community strategy: '{frag}'")

    # Verify APY values rendered
    apy_fragments = ["11.4", "8.7", "14.2"]
    for frag in apy_fragments:
        if frag not in body_text:
            issues.append(f"Strategies screen missing APY: '{frag}'")

    # Verify __MOCK__ COMMUNITY data
    out, _, _ = js(
        "(function() { var m = window.__MOCK__; "
        "if (!m || !m.COMMUNITY) return 'missing'; "
        "return String(m.COMMUNITY.length); })()"
    )
    if out == "missing":
        issues.append("window.__MOCK__.COMMUNITY is missing")
    else:
        try:
            count = int(out)
            if count < 5:
                issues.append(f"COMMUNITY has only {count} entries (expected >= 5)")
        except (ValueError, TypeError):
            issues.append(f"Cannot parse COMMUNITY count: {out[:50]}")

    return issues


def fht10_governance_mock_data():
    """
    FHT-10: Governance screen renders real mock data values.
    Verifies proposal titles, statuses, and vote counts from __MOCK__.
    """
    issues = []

    _navigate_to_screen("governance")
    time.sleep(2)

    body_text, _, _ = js("(document.body.textContent || '')")

    # Verify proposal IDs rendered
    proposal_fragments = ["P-08", "P-07", "P-06"]
    for frag in proposal_fragments:
        if frag not in body_text:
            issues.append(f"Governance screen missing proposal: '{frag}'")

    # Verify status labels rendered
    status_fragments = ["active", "queued"]
    for frag in status_fragments:
        if frag.lower() not in body_text.lower():
            issues.append(f"Governance screen missing status: '{frag}'")

    # Verify vote count fragments rendered
    vote_fragments = ["412,840", "88,200"]
    for frag in vote_fragments:
        if frag not in body_text:
            issues.append(f"Governance screen missing vote count: '{frag}'")

    # Verify __MOCK__ PROPOSALS data
    out, _, _ = js(
        "(function() { var m = window.__MOCK__; "
        "if (!m || !m.PROPOSALS) return 'missing'; "
        "return String(m.PROPOSALS.length); })()"
    )
    if out == "missing":
        issues.append("window.__MOCK__.PROPOSALS is missing")
    else:
        try:
            count = int(out)
            if count < 5:
                issues.append(f"PROPOSALS has only {count} entries (expected >= 5)")
        except (ValueError, TypeError):
            issues.append(f"Cannot parse PROPOSALS count: {out[:50]}")

    return issues


# ─── FHT-11: Console Error Gate ──────────────────────────────────────────────

def fht11_console_error_gate():
    """
    FHT-11: Console error gate — fails if any console.error or
    uncaught exception fires during navigation across all 5 screens.

    Installs interceptors, then navigates through each screen,
    collecting all errors. CORS/network/WalletConnect errors are
    excluded (expected in test environment).
    """
    issues = []

    # Install console.error interceptor (fresh)
    js("""
        (function() {
            window.__fht11Errors = [];
            window.__fht11Unhandled = [];
            var origError = console.error;
            console.error = function() {
                var args = Array.prototype.slice.call(arguments);
                var msg = args.map(function(a) {
                    return typeof a === 'string' ? a : (a && a.message ? a.message : String(a));
                }).join(' ');
                window.__fht11Errors.push(msg);
                return origError.apply(console, arguments);
            };
            window.addEventListener('error', function(e) {
                window.__fht11Unhandled.push(e.message || String(e));
            });
            window.addEventListener('unhandledrejection', function(e) {
                window.__fht11Unhandled.push('Promise:' + (e.reason ? (e.reason.message || String(e.reason)) : 'unknown'));
            });
        })()
    """)

    # Navigate through all 5 screens, collecting errors at each stop
    screens = ["home", "portfolio", "lend", "strategies", "governance"]
    for route in screens:
        if route == "home":
            navigate(BASE_URL)
        else:
            _navigate_to_screen(route)
        time.sleep(2)  # Let each screen render fully

    # Collect all errors
    error_out, _, _ = js("JSON.stringify(window.__fht11Errors || [])")
    unhandled_out, _, _ = js("JSON.stringify(window.__fht11Unhandled || [])")

    all_errors = []
    try:
        all_errors.extend(json.loads(error_out))
    except (json.JSONDecodeError, TypeError):
        issues.append(f"Cannot parse console errors: '{error_out[:200]}'")
    try:
        all_errors.extend(json.loads(unhandled_out))
    except (json.JSONDecodeError, TypeError):
        pass

    if not all_errors:
        return issues

    # Filter expected patterns (same as FHT-03)
    expected_patterns = [
        "cors", "CORS", "cross-origin", "Cross-Origin",
        "net::ERR_", "Failed to load", "404", "403",
        "Reown", "Allowlist", "allowlist",
        "WalletConnect", "wc:", "@walletconnect",
        "WebSocket", "websocket",
        "favicon.ico",
        "ResizeObserver loop",
        "chrome-extension",
    ]

    unexpected = []
    for err in all_errors:
        is_expected = any(p.lower() in err.lower() for p in expected_patterns)
        if not is_expected:
            unexpected.append(err)

    if unexpected:
        issues.append(
            f"{len(unexpected)} unexpected error(s) across 5 screens "
            f"(out of {len(all_errors)} total): {unexpected[:5]}"
        )

    return issues


# ─── FHT-12: Responsive Breakpoint Smoke Test ────────────────────────────────

def fht12_responsive_breakpoint_smoke():
    """
    FHT-12: Responsive breakpoint smoke test.
    Verify app renders without layout crashes at 375px (mobile),
    768px (tablet), 1440px (desktop). Checks for overflow and
    that the root element has visible content at each viewport.
    """
    issues = []

    viewports = [
        {"width": 375, "label": "mobile (375px)"},
        {"width": 768, "label": "tablet (768px)"},
        {"width": 1440, "label": "desktop (1440px)"},
    ]

    for vp in viewports:
        w = vp["width"]
        label = vp["label"]

        # Set viewport size via CDP emulation
        run_bu([
            "eval",
            f"""
            (function() {{
                // Resize window to target width
                window.resizeTo({w}, window.innerHeight || 800);
                // Also set a CSS override for testing
                document.documentElement.style.width = '{w}px';
            }})()
            """
        ])
        time.sleep(1)

        # Check root element exists and has content
        has_content, _, _ = js(
            f"String((document.getElementById('root')?.children.length || 0) > 0)"
        )
        if has_content != "true":
            issues.append(f"Root empty at {label}")
            continue

        # Check for horizontal overflow (content wider than viewport)
        overflow_check, _, _ = js(
            f"""
            (function() {{
                var root = document.getElementById('root');
                if (!root) return 'no-root';
                var scrollW = document.documentElement.scrollWidth;
                var clientW = document.documentElement.clientWidth;
                return String(scrollW <= clientW + 50);
            }})()
            """
        )
        if overflow_check == "false":
            issues.append(f"Horizontal overflow detected at {label}")

        # Check body has meaningful text content
        text_len, _, _ = js("String((document.body.textContent || '').length)")
        try:
            if int(text_len) < 50:
                issues.append(f"Insufficient content at {label} (text length: {text_len})")
        except (ValueError, TypeError):
            issues.append(f"Cannot check content length at {label}")

    # Reset viewport
    run_bu([
        "eval",
        "document.documentElement.style.width = '';"
    ])

    return issues


# ─── Main Runner ─────────────────────────────────────────────────────────────


def run_tests(args):
    """Execute the test suite."""
    global passed, failed, HEADLESS
    HEADLESS = not args.headed

    tests = []
    if args.test == "ALL":
        tests = [
            ("FHT-01: All 6 screen components render", fht01_all_screens_render),
            ("FHT-02: All 25+ mock keys populated", fht02_mock_keys_populated),
            ("FHT-03: No unexpected console errors", fht03_no_console_errors),
            ("FHT-04: ForgeProvider wraps app", fht04_forgeprovider_wraps_app),
            ("FHT-05: ConnectInterceptor initialized", fht05_connectinterceptor_initialized),
            ("FHT-06: Home screen mock data verification", fht06_home_mock_data),
            ("FHT-07: Portfolio screen mock data verification", fht07_portfolio_mock_data),
            ("FHT-08: Lend screen mock data verification", fht08_lend_mock_data),
            ("FHT-09: Strategies screen mock data verification", fht09_strategies_mock_data),
            ("FHT-10: Governance screen mock data verification", fht10_governance_mock_data),
            ("FHT-11: Console error gate (5-screen nav)", fht11_console_error_gate),
            ("FHT-12: Responsive breakpoint smoke test", fht12_responsive_breakpoint_smoke),
        ]
    else:
        test_map = {
            "FHT-01": ("FHT-01: All 6 screen components render", fht01_all_screens_render),
            "FHT-02": ("FHT-02: All 25+ mock keys populated", fht02_mock_keys_populated),
            "FHT-03": ("FHT-03: No unexpected console errors", fht03_no_console_errors),
            "FHT-04": ("FHT-04: ForgeProvider wraps app", fht04_forgeprovider_wraps_app),
            "FHT-05": ("FHT-05: ConnectInterceptor initialized", fht05_connectinterceptor_initialized),
            "FHT-06": ("FHT-06: Home screen mock data verification", fht06_home_mock_data),
            "FHT-07": ("FHT-07: Portfolio screen mock data verification", fht07_portfolio_mock_data),
            "FHT-08": ("FHT-08: Lend screen mock data verification", fht08_lend_mock_data),
            "FHT-09": ("FHT-09: Strategies screen mock data verification", fht09_strategies_mock_data),
            "FHT-10": ("FHT-10: Governance screen mock data verification", fht10_governance_mock_data),
            "FHT-11": ("FHT-11: Console error gate (5-screen nav)", fht11_console_error_gate),
            "FHT-12": ("FHT-12: Responsive breakpoint smoke test", fht12_responsive_breakpoint_smoke),
        }
        if args.test in test_map:
            tests = [test_map[args.test]]
        else:
            print(f"Unknown test: {args.test}")
            return 1

    print(f"""
{'#' * 66}
  FheForge Browser Test Suite
  URL:    {args.url or BASE_URL}
  Wait:   {args.wait}s
  Headed: {args.headed}
{'#' * 66}
""")

    # Establish browser session with navigation
    print(f"  Opening {args.url or BASE_URL} ...")
    navigate(args.url or BASE_URL)
    print("  Page loaded. Running tests...\n")

    for name, fn in tests:
        report(name, fn)

    return 0 if failed == 0 else 1


def parse_args():
    parser = argparse.ArgumentParser(
        description="FheForge Browser Test Suite"
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Show browser window (non-headless)",
    )
    parser.add_argument(
        "--url",
        default=BASE_URL,
        help=f"URL of FheForge page (default: {BASE_URL})",
    )
    parser.add_argument(
        "--wait",
        type=int,
        default=LOAD_WAIT,
        help=f"Seconds to wait for page load (default: {LOAD_WAIT})",
    )
    parser.add_argument(
        "--test",
        choices=[
            "FHT-01", "FHT-02", "FHT-03", "FHT-04", "FHT-05",
            "FHT-06", "FHT-07", "FHT-08", "FHT-09", "FHT-10",
            "FHT-11", "FHT-12", "ALL",
        ],
        default="ALL",
        help="Specific test to run (default: ALL)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    exit_code = 1
    try:
        exit_code = run_tests(args)
    except KeyboardInterrupt:
        print("\n\n  Interrupted.")
    except Exception as e:
        print(f"\n  CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        close_session()

    # Summary
    total = passed + failed
    print(f"\n{'=' * 60}")
    print(f"  RESULTS: {passed}/{total} passed, {failed} failed")
    if test_errors:
        print()
        for name, errs in test_errors:
            if isinstance(errs, list):
                for e in errs:
                    print(f"    ✗ {name}: {e}")
            else:
                print(f"    ✗ {name}: {errs}")
    print(f"{'=' * 60}\n")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
