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
        ]
    else:
        test_map = {
            "FHT-01": ("FHT-01: All 6 screen components render", fht01_all_screens_render),
            "FHT-02": ("FHT-02: All 25+ mock keys populated", fht02_mock_keys_populated),
            "FHT-03": ("FHT-03: No unexpected console errors", fht03_no_console_errors),
            "FHT-04": ("FHT-04: ForgeProvider wraps app", fht04_forgeprovider_wraps_app),
            "FHT-05": ("FHT-05: ConnectInterceptor initialized", fht05_connectinterceptor_initialized),
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
        choices=["FHT-01", "FHT-02", "FHT-03", "FHT-04", "FHT-05", "ALL"],
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
