#!/usr/bin/env python3
"""Headless browser helper for in-container UI debugging — observe and interact."""

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


DEFAULT_URL = "http://localhost:41930"
DEFAULT_OUTPUT = Path("/tmp/claudebox-test")


# Observe commands
# --------------------------------------------------------------------------------------------------


def cmd_screenshot(page, args) -> None:
    """Capture full-page or element screenshot."""

    args.output.mkdir(parents=True, exist_ok=True)

    if args.selector:
        el = page.query_selector(args.selector)
        if not el:
            print(f"Selector not found: {args.selector}", file=sys.stderr)
            sys.exit(1)
        path = args.output / "element.png"
        el.screenshot(path=str(path))
    else:
        path = args.output / "screenshot.png"
        page.screenshot(path=str(path), full_page=True)

    print(f"Screenshot saved: {path}")


def cmd_console(page, args) -> None:
    """Capture console messages for 5 seconds."""

    args.output.mkdir(parents=True, exist_ok=True)
    messages = []
    page.on("console", lambda msg: messages.append(f"[{msg.type}] {msg.text}"))
    page.wait_for_timeout(5000)

    path = args.output / "console.log"
    path.write_text("\n".join(messages))
    print(f"Console log saved: {path} ({len(messages)} messages)")


def cmd_network(page, args) -> None:
    """Capture network requests for 5 seconds."""

    args.output.mkdir(parents=True, exist_ok=True)
    requests = []

    def on_response(response):
        """Record response URL, status, and method."""

        requests.append(f"{response.status} {response.request.method} {response.url}")

    page.on("response", on_response)
    page.wait_for_timeout(5000)

    path = args.output / "network.log"
    path.write_text("\n".join(requests))
    print(f"Network log saved: {path} ({len(requests)} requests)")


# Interact commands
# --------------------------------------------------------------------------------------------------


def cmd_click(page, args) -> None:
    """Click an element by selector."""

    page.click(args.selector)
    page.wait_for_timeout(1000)
    print(f"Clicked: {args.selector}")


def cmd_fill(page, args) -> None:
    """Fill an input field by selector."""

    page.fill(args.selector, args.value)
    print(f"Filled: {args.selector} = {args.value!r}")


def cmd_navigate(page, args) -> None:
    """Navigate to a path (appended to base URL)."""

    url = args.url.rstrip("/") + "/" + args.path.lstrip("/")
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    print(f"Navigated to: {page.url}")
    print(f"Title: {page.title()}")


def cmd_eval(page, args) -> None:
    """Evaluate JavaScript in page context."""

    result = page.evaluate(args.expression)
    if isinstance(result, (dict, list)):
        print(json.dumps(result, indent=2))
    else:
        print(result)


# CLI
# --------------------------------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    """Build argument parser with subcommands."""

    parser = argparse.ArgumentParser(
        description="Headless browser helper for UI debugging",
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="Base URL (default: %(default)s)")
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT, help="Output directory for captures"
    )

    sub = parser.add_subparsers(dest="command", required=True)

    # Observe
    p = sub.add_parser("screenshot", help="Capture full-page or element screenshot")
    p.add_argument("selector", nargs="?", help="CSS selector for element screenshot")

    sub.add_parser("console", help="Capture console messages for 5s")
    sub.add_parser("network", help="Capture network requests for 5s")

    # Interact
    p = sub.add_parser("click", help="Click an element")
    p.add_argument("selector", help="CSS selector")

    p = sub.add_parser("fill", help="Fill an input field")
    p.add_argument("selector", help="CSS selector")
    p.add_argument("value", help="Value to fill")

    p = sub.add_parser("navigate", help="Navigate to a path")
    p.add_argument("path", help="URL path (appended to base URL)")

    p = sub.add_parser("eval", help="Evaluate JavaScript in page context")
    p.add_argument("expression", help="JS expression to evaluate")

    return parser


COMMANDS = {
    "screenshot": cmd_screenshot,
    "console": cmd_console,
    "network": cmd_network,
    "click": cmd_click,
    "fill": cmd_fill,
    "navigate": cmd_navigate,
    "eval": cmd_eval,
}


def main() -> None:
    """Run browser command against test UI."""

    parser = build_parser()
    args = parser.parse_args()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            channel="chrome",
            headless=True,
            args=["--no-sandbox"],
        )
        page = browser.new_page()

        # Navigate commands handle their own navigation
        if args.command != "navigate":
            try:
                page.goto(args.url, wait_until="domcontentloaded")
                page.wait_for_timeout(3000)
            except Exception as e:
                print(f"Failed to load {args.url}: {e}", file=sys.stderr)
                browser.close()
                sys.exit(1)

        COMMANDS[args.command](page, args)
        browser.close()


if __name__ == "__main__":
    main()
