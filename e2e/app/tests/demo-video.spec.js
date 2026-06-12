/** Choreographed demo video recording for Claudebox showcase. */

import { test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController } from '../mocks/sse.js'

// ─── Event factories ──────────────────────────────────────────────────────────

let evtSeq = 0
const ts = () => new Date(Date.now() + evtSeq * 100).toISOString()
const nextId = () => `evt_${String(++evtSeq).padStart(3, '0')}`

function userMessage(turnId, content) {
  return {
    type: 'user',
    subtype: 'text',
    is_human: true,
    content,
    turn_id: turnId,
    ts: ts(),
    id: nextId(),
    primary: true,
  }
}

function assistantText(content) {
  return {
    type: 'assistant',
    subtype: 'text',
    content,
    ts: ts(),
    id: nextId(),
    primary: true,
    is_human: false,
  }
}

function assistantThinking(content) {
  return {
    type: 'assistant',
    subtype: 'thinking',
    content,
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

function toolUse(toolName, toolInput, toolUseId) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content: toolName,
    tool_name: toolName,
    tool_use_id: toolUseId,
    tool_input: toolInput,
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

function toolResult(toolUseId, content) {
  return {
    type: 'assistant',
    subtype: 'tool_result',
    content,
    tool_use_id: toolUseId,
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

function turnResult(turnId) {
  return {
    type: 'result',
    subtype: 'success',
    turn_id: turnId,
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

function systemInit(mcpServers) {
  return {
    type: 'system',
    subtype: 'init',
    message_data: { mcp_servers: mcpServers },
    ts: ts(),
    id: nextId(),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const wait = ms => new Promise(r => setTimeout(r, ms))

/** Scroll chat messages container to bottom. */
async function scrollToBottom(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-messages"]')
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

/** Send an event and scroll to bottom. */
async function sendAndScroll(controller, page, event, delayMs = 400) {
  await controller.sendEvent(event)
  await scrollToBottom(page)
  await wait(delayMs)
}

/** Inject click ripple overlay into the page. */
async function injectClickHighlight(page) {
  await page.addStyleTag({
    content: `
      .demo-click-ripple {
        position: fixed;
        pointer-events: none;
        z-index: 999999;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(66, 133, 244, 0.5);
        border: 2px solid rgba(66, 133, 244, 0.8);
        transform: translate(-50%, -50%) scale(0.3);
        animation: demo-ripple 0.6s ease-out forwards;
      }
      @keyframes demo-ripple {
        0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(2.0); opacity: 0; }
      }
    `,
  })
  await page.evaluate(() => {
    document.addEventListener(
      'click',
      e => {
        const dot = document.createElement('div')
        dot.className = 'demo-click-ripple'
        dot.style.left = `${e.clientX}px`
        dot.style.top = `${e.clientY}px`
        document.body.appendChild(dot)
        setTimeout(() => dot.remove(), 650)
      },
      true,
    )
  })
}

// ─── Demo content ─────────────────────────────────────────────────────────────

const WEATHER_PY = `#!/usr/bin/env python3
"""Fetch and display weather data with colored terminal output."""

import argparse
import sys

import requests
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

API_BASE = "https://api.openweathermap.org/data/2.5/weather"
console = Console()


def fetch_weather(city: str, api_key: str) -> dict:
    """Fetch current weather for a city."""
    params = {"q": city, "appid": api_key, "units": "metric"}
    resp = requests.get(API_BASE, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()


def display_weather(data: dict) -> None:
    """Render weather data as a colored Rich panel."""
    city = data["name"]
    temp = data["main"]["temp"]
    feels = data["main"]["feels_like"]
    desc = data["weather"][0]["description"]
    humidity = data["main"]["humidity"]
    wind = data["wind"]["speed"]

    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column(style="bold cyan")
    table.add_column()
    table.add_row("🌡️  Temperature", f"[bold]{temp}°C[/] (feels like {feels}°C)")
    table.add_row("☁️  Conditions", desc.capitalize())
    table.add_row("💧 Humidity", f"{humidity}%")
    table.add_row("💨 Wind", f"{wind} m/s")

    panel = Panel(table, title=f"[bold blue]{city}[/]", border_style="blue")
    console.print(panel)


def main():
    parser = argparse.ArgumentParser(description="Weather CLI")
    parser.add_argument("city", help="City name")
    parser.add_argument("--api-key", required=True, help="OpenWeatherMap API key")
    args = parser.parse_args()

    try:
        data = fetch_weather(args.city, args.api_key)
        display_weather(data)
    except requests.HTTPError as e:
        console.print(f"[red]Error:[/] {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()`

const CACHE_DIFF = `--- old
+++ new
@@ -5,0 +5,28 @@
+import json
+import time
+from pathlib import Path
+
+CACHE_DIR = Path.home() / ".cache" / "weather-cli"
+CACHE_TTL = 300  # 5 minutes
+
+
+def get_cached(city: str) -> dict | None:
+    """Return cached weather data if fresh enough."""
+    cache_file = CACHE_DIR / f"{city.lower()}.json"
+    if not cache_file.exists():
+        return None
+    data = json.loads(cache_file.read_text())
+    if time.time() - data["_cached_at"] > CACHE_TTL:
+        return None
+    return data
+
+
+def set_cached(city: str, data: dict) -> None:
+    """Write weather data to cache."""
+    CACHE_DIR.mkdir(parents=True, exist_ok=True)
+    data["_cached_at"] = time.time()
+    cache_file = CACHE_DIR / f"{city.lower()}.json"
+    cache_file.write_text(json.dumps(data))`

// ─── Demo script ──────────────────────────────────────────────────────────────

test.use({
  video: { mode: 'on', size: { width: 1280, height: 720 } },
  viewport: { width: 1280, height: 720 },
})

test.describe('Demo Video', () => {
  test('claudebox showcase', async ({ page }) => {
    test.setTimeout(120000)

    await mockAPI(page)
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Inject click highlight overlay
    await injectClickHighlight(page)

    // ─── Init: Set up MCP servers ───────────────────────────────────────────
    await controller.sendEvent(
      systemInit([
        { name: 'jina', status: 'connected' },
        { name: 'chroma', status: 'connected' },
        { name: 'deepwiki', status: 'connected' },
      ]),
    )

    await wait(1500)

    // ─── Turn 1: User types and sends a message ─────────────────────────────
    const input = page.locator('[data-testid="chat-input"]')
    await input.click()
    await page.keyboard.type('Build a CLI weather tool in Python with colored output', {
      delay: 35,
    })
    await wait(600)
    await page.keyboard.press('Enter')
    await wait(800)

    // Inject user message event (transitions pending -> actual with turn_id)
    await sendAndScroll(
      controller,
      page,
      userMessage('turn_001', 'Build a CLI weather tool in Python with colored output'),
      500,
    )

    // Thinking block
    await sendAndScroll(
      controller,
      page,
      assistantThinking(
        "I'll create a Python CLI that fetches weather data from OpenWeatherMap and displays it with rich colored output using the `rich` library. I'll need to:\n1. Set up argument parsing with `argparse`\n2. Fetch data from the weather API\n3. Format output with colors and icons",
      ),
      1200,
    )

    // First assistant text
    await sendAndScroll(
      controller,
      page,
      assistantText(
        "I'll create a weather CLI with colored terminal output. Let me write the main script:",
      ),
      800,
    )

    // Write tool - create weather.py
    await sendAndScroll(
      controller,
      page,
      toolUse(
        'Write',
        { file_path: '/home/user/project/weather.py', content: WEATHER_PY },
        'tool_001',
      ),
      1500,
    )
    await sendAndScroll(
      controller,
      page,
      toolResult('tool_001', 'File created at /home/user/project/weather.py'),
      600,
    )

    // Bash tool - install deps
    await sendAndScroll(
      controller,
      page,
      toolUse('Bash', { command: 'pip install requests rich' }, 'tool_002'),
      1000,
    )
    await sendAndScroll(
      controller,
      page,
      toolResult(
        'tool_002',
        'Successfully installed requests-2.31.0 rich-13.7.0 markdown-it-py-3.0.0 pygments-2.17.2',
      ),
      600,
    )

    // Final text
    await sendAndScroll(
      controller,
      page,
      assistantText(
        'Done! Run it with:\n\n```bash\npython weather.py London --api-key YOUR_KEY\n```\n\nThe output displays temperature, conditions, humidity, and wind speed in a styled panel with color-coded labels.',
      ),
      400,
    )
    await sendAndScroll(controller, page, turnResult('turn_001'), 2000)

    // ─── Bookmark the first turn ────────────────────────────────────────────
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await wait(500)
    const bookmarkBtn = userMsg.locator('.message-bookmark-btn')
    await bookmarkBtn.dispatchEvent('click')
    await wait(1500)

    // ─── Turn 2: Second message ─────────────────────────────────────────────
    await input.click()
    await page.keyboard.type('Add a 5-minute file cache so repeated queries are instant', {
      delay: 30,
    })
    await wait(400)
    await page.keyboard.press('Enter')
    await wait(800)

    await sendAndScroll(
      controller,
      page,
      userMessage('turn_002', 'Add a 5-minute file cache so repeated queries are instant'),
      500,
    )

    await sendAndScroll(
      controller,
      page,
      assistantText("I'll add a JSON file cache with 5-minute TTL:"),
      800,
    )

    // Edit tool - modify weather.py
    await sendAndScroll(
      controller,
      page,
      toolUse(
        'Edit',
        {
          file_path: '/home/user/project/weather.py',
          old_string: 'API_BASE = "https://api.openweathermap.org/data/2.5/weather"',
          new_string:
            '# ... cache code ...\n\nAPI_BASE = "https://api.openweathermap.org/data/2.5/weather"',
        },
        'tool_003',
      ),
      1200,
    )
    await sendAndScroll(
      controller,
      page,
      toolResult(
        'tool_003',
        `The file /home/user/project/weather.py has been updated.\n${CACHE_DIFF}`,
      ),
      600,
    )

    await sendAndScroll(
      controller,
      page,
      assistantText(
        'Cache added. Now `fetch_weather` checks the cache first and writes results after fetching. Repeated queries within 5 minutes return instantly from `~/.cache/weather-cli/`.',
      ),
      400,
    )
    await sendAndScroll(controller, page, turnResult('turn_002'), 2000)

    // ─── Show fork UI (no execution) ────────────────────────────────────────
    // Scroll to first message to show rewind button
    await userMsg.scrollIntoViewIfNeeded()
    await wait(500)
    await userMsg.hover()
    await wait(1000)

    // Show fork variants dropdown if available
    const rewindSplit = userMsg.locator('.message-rewind-split')
    const chevronBtn = rewindSplit.locator('.message-rewind-chevron')
    const hasChevron = (await chevronBtn.count()) > 0
    if (hasChevron) {
      await chevronBtn.click()
      await wait(2000)
      await page.keyboard.press('Escape')
      await wait(500)
    } else {
      const rewindBtn = userMsg.locator('.message-rewind-btn')
      await rewindBtn.hover()
      await wait(2000)
    }

    // ─── Re-engage autoscroll before next message ───────────────────────────
    // Click the autoscroll/jump-to-bottom button in control bar
    const autoscrollBtn = page.locator('button[title="Last message (Alt+End)"]')
    if (await autoscrollBtn.isVisible()) {
      await autoscrollBtn.click()
      await wait(800)
    } else {
      // Fallback: use keyboard shortcut
      await page.keyboard.press('Alt+End')
      await wait(800)
    }

    // ─── Turn 3: Queue messages while "responding" ──────────────────────────
    await input.click()
    await page.keyboard.type('Now add unit tests', { delay: 35 })
    await wait(400)
    await page.keyboard.press('Enter')
    await wait(600)

    // Inject user message and start a response (no result = still responding)
    await sendAndScroll(controller, page, userMessage('turn_003', 'Now add unit tests'), 500)
    await sendAndScroll(
      controller,
      page,
      assistantText("I'll write comprehensive tests using pytest. Let me create the test file:"),
      1000,
    )

    // Queue a message while responding
    await input.click()
    await page.keyboard.type('Also add a --format json flag for machine-readable output', {
      delay: 30,
    })
    await wait(300)
    await page.keyboard.press('Alt+Enter')
    await wait(1500)

    // Queue another
    await page.keyboard.type('And update the README with usage examples', { delay: 30 })
    await wait(300)
    await page.keyboard.press('Alt+Enter')
    await wait(2000)
    await scrollToBottom(page)
    await wait(500)

    // Complete turn 3
    await sendAndScroll(
      controller,
      page,
      toolUse(
        'Write',
        {
          file_path: '/home/user/project/tests/test_weather.py',
          content:
            '"""Tests for weather CLI."""\n\nimport pytest\nfrom unittest.mock import patch, MagicMock\n\nfrom weather import fetch_weather, get_cached, set_cached\n\n\ndef test_fetch_weather_success():\n    """Test successful API call."""\n    with patch("weather.requests.get") as mock_get:\n        mock_get.return_value.json.return_value = {"name": "London"}\n        result = fetch_weather("London", "key")\n        assert result["name"] == "London"\n\n\ndef test_cache_hit():\n    """Test that cached data is returned within TTL."""\n    ...\n\n\ndef test_cache_expired():\n    """Test that expired cache triggers fresh fetch."""\n    ...',
        },
        'tool_004',
      ),
      1200,
    )
    await sendAndScroll(
      controller,
      page,
      toolResult('tool_004', 'File created at /home/user/project/tests/test_weather.py'),
      600,
    )
    await sendAndScroll(
      controller,
      page,
      assistantText('Tests created covering API fetching, cache hits, and cache expiration.'),
      400,
    )
    await sendAndScroll(controller, page, turnResult('turn_003'), 2500)

    // ─── Open Bookmarks panel ───────────────────────────────────────────────
    await page.keyboard.press('Alt+5')
    await wait(2500)
    await page.keyboard.press('Alt+5')
    await wait(1000)

    // Final pause
    await wait(3000)

    // Save video to accessible location
    await page.close()
    await page.video().saveAs('/tmp/claudebox-demo.webm')
  })
})
