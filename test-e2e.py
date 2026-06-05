#!/usr/bin/env python3
"""FheForge E2E smoke tests — Playwright headless."""
import sys
from playwright.sync_api import sync_playwright

BASE = "https://fheforge-xkq.vercel.app"
PASS = 0
FAIL = 0

def check(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name} {detail}")

def run():
    global PASS, FAIL
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # ── 1. Landing page loads ──
        print("\n[1] Landing page")
        page.goto(BASE, wait_until="networkidle", timeout=30000)
        check("Page loads", page.title() != "")
        check("Has FheForge text", "FheForge" in page.content() or "fheforge" in page.content().lower())
        check("Has nav links", page.locator("nav").count() > 0 or page.locator("[aria-label*='navigation']").count() > 0)
        check("lang attribute", page.locator("html[lang='en']").count() > 0)

        # ── 2. Route navigation via nav buttons ──
        print("\n[2] Route navigation")
        for label in ["Portfolio", "Lend", "Strategies", "Governance", "Home"]:
            btn = page.locator(f"nav button:has-text('{label}')").first
            if btn.count() > 0:
                btn.click()
                page.wait_for_timeout(1500)
                check(f"Navigate to {label}", True)
            else:
                check(f"Navigate to {label}", False, "button not found")

        # ── 3. Lending page ──
        print("\n[3] Lending page")
        page.locator("nav button:has-text('Lend')").first.click()
        page.wait_for_timeout(3000)
        check("Lending URL", "lend" in page.url.lower())
        # Check for tab-like buttons (Supply, Borrow, Repay, Withdraw)
        tabs = page.locator("button:has-text('Supply'), button:has-text('Borrow'), button:has-text('Repay'), button:has-text('Withdraw')")
        check("Has lending action buttons", tabs.count() >= 2, f"found {tabs.count()}")
        # Check for amount input
        inputs = page.locator("input")
        check("Has input elements", inputs.count() > 0, f"found {inputs.count()}")

        # ── 4. Governance page ──
        print("\n[4] Governance page")
        page.locator("nav button:has-text('Governance')").first.click()
        page.wait_for_timeout(3000)
        check("Governance URL", "governance" in page.url.lower())
        # Check for governance content
        gov_content = page.locator("text=/proposal|governance|coming soon|vote/i")
        check("Has governance content", gov_content.count() > 0, f"found {gov_content.count()}")
        # Check for any buttons on governance page
        gov_btns = page.locator("button")
        check("Has governance buttons", gov_btns.count() > 0, f"found {gov_btns.count()}")

        # ── 5. Strategies page ──
        print("\n[5] Strategies page")
        page.locator("nav button:has-text('Strategies')").first.click()
        page.wait_for_timeout(2000)
        check("Strategies URL", "strategies" in page.url.lower() or "builder" in page.url.lower())

        # ── 6. Dashboard page ──
        print("\n[6] Dashboard page")
        page.locator("nav button:has-text('Portfolio')").first.click()
        page.wait_for_timeout(2000)
        check("Dashboard URL", "portfolio" in page.url.lower() or "dashboard" in page.url.lower())

        # ── 7. Connect modal ──
        print("\n[7] Connect modal")
        page.locator("nav button:has-text('Home')").first.click()
        page.wait_for_timeout(2000)
        connect_btns = page.locator("button:has-text('Connect')")
        if connect_btns.count() > 0:
            connect_btns.first.click()
            page.wait_for_timeout(1000)
            modal = page.locator("[role='dialog']")
            check("Connect modal opens", modal.count() > 0)
            check("Modal has aria-modal", page.locator("[aria-modal='true']").count() > 0)
            # Close modal
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
        else:
            check("Connect button exists", False, "no connect button found")

        # ── 8. ARIA checks ──
        print("\n[8] Accessibility")
        check("Main landmark", page.locator("main").count() > 0)
        nav_labels = page.locator("[aria-label*='navigation']")
        check("Nav has aria-label", nav_labels.count() > 0, f"found {nav_labels.count()}")
        skip_link = page.locator("a[href='#main']")
        check("Skip-to-content link", skip_link.count() > 0)

        # ── 9. Console errors ──
        print("\n[9] Console errors")
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(BASE, wait_until="networkidle", timeout=15000)
        page.wait_for_timeout(3000)
        # Filter out expected errors (wallet not connected, etc.)
        critical = [e for e in errors if "wallet" not in e.lower() and "connect" not in e.lower() and "permit" not in e.lower()]
        check("No critical console errors", len(critical) == 0, f"found {len(critical)}: {critical[:3]}")

        # ── 10. Backend API ──
        print("\n[10] Backend API")
        api = browser.new_context()
        api_page = api.new_page()
        api_page.set_extra_http_headers({"Origin": "https://fheforge-xkq.vercel.app"})

        resp = api_page.goto("https://fheforge-api-production-6465.up.railway.app/health", wait_until="load", timeout=10000)
        check("Backend health 200", resp and resp.status == 200, f"status={resp.status if resp else 'None'}")

        resp = api_page.goto("https://fheforge-api-production-6465.up.railway.app/markets", wait_until="load", timeout=10000)
        check("Markets endpoint 200", resp and resp.status == 200)

        resp = api_page.goto("https://fheforge-api-production-6465.up.railway.app/ai-strategy-builder/health", wait_until="load", timeout=10000)
        check("AI health endpoint 200", resp and resp.status == 200)

        api.close()

        browser.close()

    print(f"\n{'='*50}")
    print(f"Results: {PASS} passed, {FAIL} failed, {PASS+FAIL} total")
    return FAIL

if __name__ == "__main__":
    sys.exit(run())
