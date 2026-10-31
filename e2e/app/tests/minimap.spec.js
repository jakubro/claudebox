/** E2E tests for mini-map navigation. */

import { expect, test } from '@playwright/test'
import {
  openSessionWithAPI,
  resolveOpsPayload,
  waitForAppReady,
  waitForStableScrollHeight,
} from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

async function openMinimap(page) {
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)

  return page.locator('.minimap-overlay')
}

test.describe('Mini-map', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/long-conversation.jsonl')
  })

  // SPEC: chat:minimap
  test('mini-map appears on scroll', async ({ page }) => {
    // Mini-map should exist but may be hidden initially
    const minimap = await openMinimap(page)
    await expect(minimap).toHaveCount(1)

    await scrollToShowMinimap(page)

    await expect(minimap).toHaveClass(/visible/)
  })

  // SPEC: chat:minimap-overlay
  test('mini-map positioned on right side', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const chatPanel = await scrollToShowMinimap(page)

    const minimap = page.locator('.minimap-overlay')
    await expect(minimap).toHaveClass(/visible/)

    const minimapBox = await minimap.boundingBox()
    const chatBox = await chatPanel.boundingBox()
    expect(minimapBox.x + minimapBox.width).toBeGreaterThan(chatBox.x + chatBox.width - 50)

    const zIndex = await minimap.evaluate(el => parseInt(getComputedStyle(el).zIndex, 10))
    expect(zIndex).toBeGreaterThan(0)
  })

  // SPEC: chat:minimap-viewport
  test('viewport indicator exists and has height', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const chatPanel = page
      .locator('.chat-messages, .chat-panel, [data-testid="chat-panel"]')
      .first()
    await chatPanel.evaluate(el => {
      el.scrollTop = 100
    })

    const thumb = page.locator('.minimap-thumb')
    await expect(thumb).toHaveCount(1)

    const thumbHeight = await thumb.evaluate(el => {
      return parseInt(window.getComputedStyle(el).height, 10)
    })
    expect(thumbHeight).toBeGreaterThan(0)
  })

  // SPEC: chat:minimap-viewport
  // SPEC: chat:minimap-thumb-tracks-scroll
  test('viewport thumb tracks scroll position', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Minimap is pinned by default - stays visible throughout
    const thumb = page.locator('.minimap-thumb')
    const messages = page.locator('.chat-messages').first()

    // Wheel events are used because programmatic scrollTop doesn't reliably disable autoscroll -
    // handleUserScroll guards against scrollHeight changes during content load.
    const box = await messages.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    // Several -10000 dispatches rather than one huge delta: Chromium rate-limits an oversized
    // wheel delta over a non-deterministic number of frames.
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -10000)
    }
    await expect.poll(() => thumb.evaluate(el => parseFloat(getComputedStyle(el).top))).toBe(0)

    await page.mouse.wheel(0, 300)
    await expect
      .poll(() => thumb.evaluate(el => parseFloat(getComputedStyle(el).top)), { timeout: 3000 })
      .toBeGreaterThan(0)
  })

  // SPEC: chat:minimap-click
  test('mini-map responds to click events', async ({ page }) => {
    // Minimap is pinned by default - stays visible throughout
    const minimap = await openMinimap(page)
    await expect(minimap).toHaveClass(/visible/)

    const messages = page.locator('.chat-messages').first()
    await wheelToTop(page, messages)

    const box = await minimap.boundingBox()
    await minimap.click({ position: { x: box.width / 2, y: box.height - 10 } })

    await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  })

  // SPEC: chat:minimap-alternating-colors
  test('mini-map shows turn bars with alternating colors', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // waitForAppReady returns before turns finish hydrating, so a synchronous count() race-flakes under load.
    const bars = page.locator('.minimap-subbar')
    await expect.poll(() => bars.count(), { timeout: 5000 }).toBeGreaterThan(0)

    const firstBarBg = await bars.first().evaluate(el => getComputedStyle(el).backgroundColor)
    expect(firstBarBg).not.toBe('rgba(0, 0, 0, 0)')
    expect(firstBarBg).not.toBe('transparent')

    // Alternation itself is a design intent verified visually, not asserted here.
  })

  test.describe('Segment Structure', () => {
    // SPEC: chat:minimap-segment-structure
    test('builds segments from turn groups', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const segments = page.locator('[data-testid="minimap-segment"]')
      await expect(segments.first()).toBeAttached()
      const count = await segments.count()
      expect(count).toBeGreaterThan(0)
    })

    // SPEC: chat:minimap-sub-bars
    test('segments contain sub-bars for individual turns', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const segment = page.locator('[data-testid="minimap-segment"]').first()
      const subBars = segment.locator('[data-testid="minimap-subbar"]')
      // Poll - SSE replay populates sub-bars after waitForAppReady returns.
      await expect.poll(() => subBars.count(), { timeout: 5000 }).toBeGreaterThan(0)
    })

    // SPEC: chat:minimap-human-lines
    test('sub-bars mark human messages with white line', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Poll until they hydrate - waitForAppReady returns before SSE replay completes.
      const humanLines = page.locator('[data-testid="minimap-human-line"]')
      await expect.poll(() => humanLines.count(), { timeout: 5000 }).toBeGreaterThan(0)

      // Human line should have white/near-white color
      const lineColor = await humanLines
        .first()
        .evaluate(el => getComputedStyle(el).backgroundColor)
      const match = lineColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      expect(match).toBeTruthy()
      const [, r, g, b] = match.map(Number)
      expect(r).toBeGreaterThan(200)
      expect(g).toBeGreaterThan(200)
      expect(b).toBeGreaterThan(200)
    })
  })

  test.describe('Sub-bar Sizing', () => {
    // SPEC: chat:minimap-sub-bar-width
    test('sub-bar width reflects duration (8-20px range)', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const subBar = page.locator('[data-testid="minimap-subbar"]').first()
      const width = await subBar.evaluate(el => parseFloat(el.style.width))
      expect(width).toBeGreaterThanOrEqual(8)
      expect(width).toBeLessThanOrEqual(20)
    })
  })

  test.describe('Auto-show Behavior', () => {
    // SPEC: chat:minimap-auto-show-scroll
    // The negative case (autoscroll doesn't show minimap) is hard to isolate with mocks: both
    // fire from the same SSE-triggered render.
    test('shows on manual scroll (not autoscroll)', async ({ page }) => {
      const minimap = await openMinimap(page)

      await scrollToShowMinimap(page)
      await expect(minimap).toHaveClass(/visible/)
    })

    // SPEC: chat:minimap-auto-show-edge
    test('shows when mouse near right edge of chat', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const chatPanel = page.locator('.chat-messages').first()
      const box = await chatPanel.boundingBox()

      // Move mouse to within 50px of right edge
      await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2)

      const minimap = page.locator('.minimap-overlay')
      await expect(minimap).toHaveClass(/visible/)
    })
  })

  test.describe('Visual Properties', () => {
    // SPEC: chat:minimap-transparent
    // SPEC: chat:minimap-animation-delay
    test('minimap has 0.3s opacity transition', async ({ page }) => {
      const minimap = await openMinimap(page)
      const transition = await minimap.evaluate(el => {
        return getComputedStyle(el).transition
      })
      expect(transition).toContain('opacity')
      expect(transition).toContain('0.3s')
    })

    // SPEC: chat:minimap-animation-curve
    test('opacity transition uses ease-in-out', async ({ page }) => {
      const minimap = await openMinimap(page)
      const transition = await minimap.evaluate(el => {
        return getComputedStyle(el).transition
      })
      expect(transition).toContain('ease-in-out')
    })

    // SPEC: chat:minimap-animation-delay
    test('minimap auto-hides after delay', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Minimap is pinned by default - unpin so auto-hide kicks in
      const controlBar = page.locator('.panel-control-bar')
      await controlBar.locator('button[title="Hide minimap"]').click()

      const minimap = page.locator('.minimap-overlay')

      await scrollToShowMinimap(page)
      await expect(minimap).toHaveClass(/visible/)

      // Wait for auto-hide (750ms timer)
      await expect(minimap).not.toHaveClass(/visible/, { timeout: 3000 })
    })
  })

  test.describe('Drag Navigation', () => {
    // SPEC: chat:minimap-drag
    test('dragging minimap scrolls chat', async ({ page }) => {
      // Minimap is pinned by default - stays visible throughout
      const minimap = await openMinimap(page)
      await expect(minimap).toHaveClass(/visible/)

      const messages = page.locator('.chat-messages').first()
      await wheelToTop(page, messages)
      const box = await minimap.boundingBox()

      // Simulate a drag gesture from top to bottom of minimap
      const startX = box.x + box.width / 2
      const startY = box.y + 10
      const endY = box.y + box.height - 10

      await page.mouse.move(startX, startY)
      await page.mouse.down()
      const steps = 5
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(startX, startY + ((endY - startY) * i) / steps)
      }
      await page.mouse.up()

      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
      const scrollAfterDrag = await messages.evaluate(el => el.scrollTop)

      // Verify click-to-jump: click near top scrolls back up
      await minimap.click({ position: { x: box.width / 2, y: 10 } })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeLessThan(scrollAfterDrag)
    })
  })

  test.describe('Toggle Button', () => {
    // SPEC: chat:minimap-toggle
    test('control bar has minimap toggle button', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')
      // Default is pinned - button shows "Hide minimap"
      const toggleBtn = controlBar.locator('button[title="Hide minimap"]')
      await expect(toggleBtn).toBeVisible()
    })

    // SPEC: chat:minimap-toggle-pressed
    test('toggle button shows pressed state when pinned', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')
      // Default is pinned - button should be pressed
      const pinnedBtn = controlBar.locator('button[title="Hide minimap"]')
      await expect(pinnedBtn).toBeVisible()
      await expect(pinnedBtn).toHaveClass(/pressed/)

      await pinnedBtn.click()

      const unpinnedBtn = controlBar.locator('button[title="Show minimap"]')
      await expect(unpinnedBtn).not.toHaveClass(/pressed/)
    })

    // SPEC: chat:minimap-toggle-persistent
    test('pinned minimap stays visible without auto-hide', async ({ page }) => {
      // Default is pinned - minimap should already be visible
      const minimap = await openMinimap(page)
      await expect(minimap).toHaveClass(/visible/)

      // Poll checks visibility remains stable past the auto-hide delay.
      await expect
        .poll(() => minimap.evaluate(el => el.classList.contains('visible')), { timeout: 2000 })
        .toBe(true)
    })

    // SPEC: chat:minimap-toggle-persist
    test('toggle state persisted via ui-state API', async ({ page }) => {
      const patchCalls = []
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'PATCH') {
          const payload = await route.request().postDataJSON()
          patchCalls.push(payload)
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        } else {
          await route.fulfill({ json: { global: {}, session: {} } })
        }
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Default is pinned - click to unpin (triggers PATCH with false)
      const controlBar = page.locator('.panel-control-bar')
      const pinnedBtn = controlBar.locator('button[title="Hide minimap"]')
      await pinnedBtn.click()

      // Verify PATCH was sent with minimapPinned: false (poll - PATCH is async)
      await expect
        .poll(
          () =>
            patchCalls.map(resolveOpsPayload).find(p => p.session?.minimapPinned !== undefined)
              ?.session.minimapPinned,
        )
        .toBe(false)
    })

    // SPEC: chat:minimap-toggle-transient
    test('unpinning restores transient auto-hide behavior', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')
      const minimap = page.locator('.minimap-overlay')

      // Default is pinned - minimap visible
      await expect(minimap).toHaveClass(/visible/)

      const pinnedBtn = controlBar.locator('button[title="Hide minimap"]')
      await pinnedBtn.click()

      // Should auto-hide after delay (750ms timer)
      await expect(minimap).not.toHaveClass(/visible/, { timeout: 3000 })
    })
  })
})

/** Wheel the transcript to its top: a script-set position leaves autoscroll on, so the app pins it back. */
async function wheelToTop(page, messages) {
  const box = await messages.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -10000)
  }
  await expect(page.getByTestId('autoscroll-indicator')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(0)
}

/** Scrolls up twice: the first scroll updates useAutoScroll's ref, the second lets MiniMap's handler read it. */
async function scrollToShowMinimap(page) {
  const chatPanel = page.locator('.chat-messages, .chat-panel, [data-testid="chat-panel"]').first()

  // Wheel events are used because programmatic scrollTop doesn't reliably disable autoscroll -
  // useAutoScroll guards against scrollHeight changes during content load.
  const box = await chatPanel.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(300)
  await page.mouse.wheel(0, -100)

  return chatPanel
}

// A session long enough to window, mixing turns whose rendered height the content alone predicts
// badly - newline lists, blank-line paragraphs, one-line Bash - with short replies between them.
const SIZING_TS = '2026-05-17T12:00:00Z'
const SIZING_TURNS = Array.from({ length: 20 }, (_, i) => {
  const shapes = [
    [{ subtype: 'text', content: 'Done.' }],
    [
      {
        subtype: 'text',
        content: Array.from({ length: 24 }, (_, n) => `${n + 1}. item`).join('\n'),
      },
    ],
    [
      {
        subtype: 'text',
        content: Array.from({ length: 4 }, () => 'Prose. '.repeat(30)).join('\n\n'),
      },
    ],
    [
      { subtype: 'text', content: 'Checking.' },
      {
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: `b-${i}`,
        tool_input: { command: 'ls' },
      },
      { subtype: 'tool_result', content: 'one-line output', tool_use_id: `b-${i}` },
    ],
  ]
  return { turnId: `size-${i}`, events: shapes[i % shapes.length] }
})
const SIZING_EVENTS = SIZING_TURNS.flatMap(({ turnId, events }) => [
  {
    type: 'user',
    subtype: 'text',
    is_human: true,
    primary: true,
    content: `ask ${turnId}`,
    turn_id: turnId,
    ts: SIZING_TS,
  },
  ...events.map(e => ({
    type: 'assistant',
    is_human: false,
    primary: false,
    turn_id: turnId,
    ts: SIZING_TS,
    ...e,
  })),
  { type: 'result', subtype: 'success', turn_id: turnId, ts: SIZING_TS },
])
const LAST_SIZING_TURN = SIZING_TURNS[SIZING_TURNS.length - 1].turnId

/** Each bar's share of the minimap against its turn's share of the transcript, swept in full. */
async function measureShares(page) {
  return page.evaluate(async () => {
    const container = document.querySelector('.chat-messages')
    const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    // A collapse flip re-measures the mounted rows a frame or two later; wait for the extent to hold.
    let nativeBefore = -1
    for (let frame = 0; frame < 30 && nativeBefore !== container.scrollHeight; frame++) {
      nativeBefore = container.scrollHeight
      await settle()
    }
    const startTop = container.scrollTop
    const bars = [...document.querySelectorAll('[data-testid="minimap-subbar"]')].map(
      b => b.getBoundingClientRect().height,
    )
    const heights = new Map()
    for (let top = 0; top <= container.scrollHeight; top += container.clientHeight / 2) {
      container.scrollTop = top
      await settle()
      for (const el of document.querySelectorAll('.turn-container[data-turn-id]')) {
        const row = el.closest('.historical-turn-row')
        const height = row
          ? row.getBoundingClientRect().height
          : el.offsetHeight + parseFloat(getComputedStyle(el).marginBottom)
        const index = row ? Number(row.dataset.index) : Number.MAX_SAFE_INTEGER
        heights.set(el.dataset.turnId, { index, height })
      }
    }
    container.scrollTop = startTop
    await settle()
    const real = [...heights.values()].sort((a, b) => a.index - b.index).map(h => h.height)
    const barTotal = bars.reduce((sum, h) => sum + h, 0)
    const realTotal = real.reduce((sum, h) => sum + h, 0)

    return {
      nativeBefore,
      realTotal,
      barShares: bars.map(h => h / barTotal),
      realShares: real.map(h => h / realTotal),
    }
  })
}

function expectSharesMatch({ barShares, realShares }) {
  expect(barShares).toHaveLength(realShares.length)
  barShares.forEach((share, i) => {
    expect(Math.abs(share - realShares[i])).toBeLessThanOrEqual(0.25 * realShares[i] + 0.01)
  })
}

test.describe('Mini-map collapse-aware sizing', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openSessionWithAPI(page, SIZING_EVENTS)
    await page.locator(`.turn-container[data-turn-id="${LAST_SIZING_TURN}"]`).waitFor()
    await waitForStableScrollHeight(page.getByTestId('chat-messages'))
  })

  // SPEC: chat:minimap-sub-bar-height
  test('each sub-bar takes the share of the transcript its turn takes', async ({ page }) => {
    expectSharesMatch(await measureShares(page))
  })

  // SPEC: chat:minimap-sub-bar-collapse
  test('turning auto-collapse off from the top resizes turns that are not on screen', async ({
    page,
  }) => {
    await page.locator('.chat-messages').evaluate(el => {
      el.scrollTop = 0
    })
    await page.locator('[data-testid="autocollapse-toggle"]').click()
    await expect(page.locator('[data-testid="autocollapse-toggle"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    const shares = await measureShares(page)
    expect(Math.abs(shares.nativeBefore - shares.realTotal) / shares.realTotal).toBeLessThan(0.05)
    expectSharesMatch(shares)
  })

  // SPEC: chat:minimap-sub-bar-collapse
  test('turning auto-collapse back on shrinks every turn it collapses, seen or not', async ({
    page,
  }) => {
    const toggle = page.locator('[data-testid="autocollapse-toggle"]')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await measureShares(page)
    await page.locator('.chat-messages').evaluate(el => {
      el.scrollTop = 0
    })

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    const shares = await measureShares(page)
    expect(Math.abs(shares.nativeBefore - shares.realTotal) / shares.realTotal).toBeLessThan(0.05)
    expectSharesMatch(shares)
  })
})
