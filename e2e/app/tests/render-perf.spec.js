/** E2E perf checks: ChatInput render counter and wheel-latency for autoscroll. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Render perf', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
  })

  // SPEC: input:smooth-during-response
  test('typing during streaming reply preserves every keystroke', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    const input = await waitForAppReady(page)

    await input.focus()

    // Chat is paint-active from the streaming fixture; no character should drop.
    const typed = 'smooth-during-response'
    await page.keyboard.type(typed, { delay: 0 })
    await page.waitForTimeout(100)
    await expect(input).toHaveValue(typed)
  })

  // Perf check (no SPEC claim) guarding ChatInput re-renders via window.__cb_test_hooks.chatInputRenderCount.
  test('typing 20 chars into ChatInput re-renders fewer than 30 times', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    const input = await waitForAppReady(page)

    // Reset counter via the DEV-only test hook before measurement.
    await page.evaluate(() => {
      window.__cb_test_hooks ??= {}
      window.__cb_test_hooks.chatInputRenderCount = 0
    })

    await input.focus()
    const startCount = await page.evaluate(() => window.__cb_test_hooks?.chatInputRenderCount ?? 0)

    await page.keyboard.type('abcdefghijklmnopqrst', { delay: 0 })

    // Allow any pending effects to flush.
    await page.waitForTimeout(100)

    const endCount = await page.evaluate(() => window.__cb_test_hooks?.chatInputRenderCount ?? 0)
    const renders = endCount - startCount
    // Headroom above 20 for state-related re-renders, while still catching cascades.
    expect(renders).toBeLessThan(30)
  })
})

test.describe('Wheel latency / autoscroll disengage', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/long-conversation.jsonl')
  })

  // Behavioral perf check (no SPEC claim) guarding against wheel->autoscroll-disengage latency.
  test('wheel event on .chat-messages disengages autoscroll within ~1 frame', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const messages = page.locator('[data-testid="chat-messages"]')
    await expect(messages).toBeVisible()

    // The list is windowed and opens at the bottom, so wait on the newest turn.
    await expect(page.locator('[data-testid="turn-container"]').last()).toBeVisible()

    // Hover over messages so wheel events target the right element.
    const box = await messages.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    const initialScrollTop = await messages.evaluate(el => el.scrollTop)

    const before = Date.now()
    await page.mouse.wheel(0, -100)

    // Poll briefly (a few frames) - a coalesced wheel event would push the disengage out by hundreds of ms.
    await expect
      .poll(
        async () => {
          const top = await messages.evaluate(el => el.scrollTop)
          return top !== initialScrollTop
        },
        { timeout: 250, intervals: [16, 16, 32] },
      )
      .toBe(true)

    const elapsed = Date.now() - before
    expect(elapsed).toBeLessThan(500)
  })
})
