"""Walk the prototype through its main flows and screenshot every state.

For the critic pass of the gauntlet loop: the same states, captured the same
way each round, so one round's pictures can be compared with the last.

    python prototype/tools/capture_flow.py --out prototype/.shots/round-2

Needs the server running (python prototype/server.py) and Playwright with
Chromium. The clock is pinned to a weekday morning so routes are daytime
routes whatever the real time is; the origin is ISM (Gedimino pr. 7).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://localhost:8765"
ISM = {"latitude": 54.68688, "longitude": 25.2827}
MORNING = datetime(2026, 9, 28, 8, 0)   # a Monday


def seed(page, prefs=True):
    """Start as a returning user: preferences set, two saved places."""
    places = [
        {"id": "home", "name": "Namai", "subtitle": "Žirmūnų g.", "lat": 54.7045, "lon": 25.2963},
        {"id": "akro", "name": "Akropolis", "subtitle": "Prekybos centras, Ozo g. 25, Vilnius", "lat": 54.71051, "lon": 25.26314},
    ]
    script = "localStorage.clear();"
    if prefs:
        script += (
            "localStorage.setItem('vc.prefs', JSON.stringify({priority:'fastest', walk:'normal'}));"
            f"localStorage.setItem('vc.places', {json.dumps(json.dumps(places))});"
            "localStorage.setItem('vc.originChoice', JSON.stringify('gps'));"
        )
    page.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ {script} sessionStorage.setItem('seeded','1'); }}")


def ready(page):
    page.wait_for_function("document.querySelector('#server-status')?.textContent.includes('Tvarkaraščiai')", timeout=60_000)
    page.wait_for_timeout(600)


def shot(page, out: Path, name: str, errors: list):
    page.wait_for_timeout(700)   # let transitions settle
    page.screenshot(path=str(out / f"{name}.png"))
    print("  ", name)


def run(browser, out: Path, width: int, height: int, scheme: str, errors: list):
    tag = f"{width}-{scheme}"
    context = browser.new_context(
        viewport={"width": width, "height": height},
        color_scheme=scheme,
        geolocation=ISM,
        permissions=["geolocation"],
        locale="lt-LT",
        timezone_id="Europe/Vilnius",
        device_scale_factor=1,
    )
    page = context.new_page()
    page.on("console", lambda m: errors.append(f"[{tag}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[{tag}] pageerror {e}"))
    page.clock.install(time=MORNING)
    page.clock.resume()

    # First run: onboarding.
    seed(page, prefs=False)
    page.goto(URL)
    ready(page)
    shot(page, out, f"{tag}-01-onboarding", errors)
    page.click('[data-action="draft-next"]')
    shot(page, out, f"{tag}-02-onboarding-walk", errors)
    context.close()

    # Returning user.
    context = browser.new_context(
        viewport={"width": width, "height": height}, color_scheme=scheme, geolocation=ISM,
        permissions=["geolocation"], locale="lt-LT", timezone_id="Europe/Vilnius", device_scale_factor=1,
    )
    page = context.new_page()
    page.on("console", lambda m: errors.append(f"[{tag}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[{tag}] pageerror {e}"))
    page.clock.install(time=MORNING)
    page.clock.resume()
    seed(page)
    page.goto(URL)
    ready(page)
    shot(page, out, f"{tag}-03-lock", errors)

    page.click('[data-action="lock-button"]')
    shot(page, out, f"{tag}-04-banner-ask", errors)

    typed = page.locator("#typed-voice")
    if typed.is_visible():
        typed.fill("Man reikia į Akropolį dabar")
        typed.press("Enter")
        page.wait_for_timeout(2500)
        shot(page, out, f"{tag}-05-trip-now", errors)

        for i, label in enumerate(["kryptis", "visa"], start=6):
            nxt = page.locator(".pager-next").first
            if nxt.count():
                nxt.click()
                shot(page, out, f"{tag}-{i:02d}-trip-page-{label}", errors)
        dots = page.locator('.dot[data-page="0"]').first
        if dots.count():
            dots.click()

        for i in range(8, 13):
            page.click("#jump-stage")
            shot(page, out, f"{tag}-{i:02d}-stage", errors)

    # Unlocked: home, search, results, detail.
    page.click("#toggle-lock")
    shot(page, out, f"{tag}-20-home", errors)
    island = page.locator("#island.compact")
    if island.count():
        island.click()
        shot(page, out, f"{tag}-21-island-expanded", errors)
        page.mouse.click(5, 5)

    search = page.locator("#search")
    search.click()
    search.fill("Akropolis")
    page.wait_for_timeout(2500)
    shot(page, out, f"{tag}-22-search", errors)
    page.locator('[data-action="go"]').first.click()
    page.wait_for_timeout(2500)
    shot(page, out, f"{tag}-23-results", errors)
    option = page.locator('[data-action="open-option"]').first
    if option.count():
        option.click()
        page.wait_for_timeout(2000)
        shot(page, out, f"{tag}-24-detail", errors)
    context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--quick", action="store_true", help="dark desktop only")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    runs = [(1440, 900, "dark")] if args.quick else [(1440, 900, "dark"), (1440, 900, "light"), (390, 844, "dark")]
    with sync_playwright() as p:
        # The full Chromium build in new headless mode; the separate
        # headless shell is not installed on this machine.
        browser = p.chromium.launch(channel="chromium")
        for width, height, scheme in runs:
            print(f"{width}x{height} {scheme}")
            run(browser, out, width, height, scheme, errors)
        browser.close()
    (out / "console-errors.txt").write_text("\n".join(errors) or "none", "utf-8")
    print("console errors:", len(errors))


if __name__ == "__main__":
    main()
