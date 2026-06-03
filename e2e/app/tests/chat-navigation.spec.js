/** E2E tests for chat message jump navigation via keyboard shortcuts and control bar buttons. */

import { expect, test } from '@playwright/test'
import { waitForAppReady, waitForStableScroll } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Chat Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/long-conversation.jsonl')
  })

  test.describe('Alt+Up/Down jump between messages', () => {
    // SPEC: shortcut:alt-up
    test('Alt+Up lands on a HUMAN message that sits above the viewport', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Scroll to bottom first so there are messages above
      await messages.evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)

      const scrollBefore = await messages.evaluate(el => el.scrollTop)

      await page.keyboard.press('Alt+ArrowUp')

      await expect
        .poll(async () => {
          const scrollAfter = await messages.evaluate(el => el.scrollTop)
          return scrollAfter < scrollBefore
        })
        .toBe(true)

      // Claim says "previous HUMAN message" — verify the destination row
      // matches a human-message marker rather than landing on assistant text.
      // Human messages carry data-testid="message-user".
      // The human message that the jump landed on should be near the TOP of
      // the viewport — i.e. the topmost human message currently visible
      // should sit above the viewport mid-line. Widen the tolerance to
      // accommodate scroll-snap rounding and per-turn padding.
      const targetHuman = await messages.evaluate(el => {
        const viewportRect = el.getBoundingClientRect()
        const viewportTop = viewportRect.top
        const viewportMid = viewportTop + viewportRect.height / 2
        const visibleHumans = Array.from(el.querySelectorAll('[data-testid="message-user"]'))
          .map(t => ({ t, top: t.getBoundingClientRect().top }))
          .filter(({ top }) => top >= viewportTop - 200 && top <= viewportMid)
        if (!visibleHumans.length) {
          return null
        }
        const topmost = visibleHumans.sort((a, b) => a.top - b.top)[0]
        return topmost.t.textContent?.slice(0, 80) ?? ''
      })
      expect(
        targetHuman,
        'a human message should sit at the top of the viewport after Alt+Up',
      ).toBeTruthy()
    })

    // SPEC: shortcut:alt-down
    test('Alt+Down lands on a HUMAN message that sat below the viewport', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Dispatch a wheel event first to disengage autoscroll — bare scrollTop
      // writes don't count as user-scroll intent, so autoscroll would otherwise
      // race to snap back to bottom before Alt+Down fires.
      await messages.dispatchEvent('wheel', { deltaY: -100 })
      await messages.evaluate(el => {
        el.scrollTop = 0
      })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(0)

      await page.keyboard.press('Alt+ArrowDown')

      await expect.poll(async () => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)

      // The human message that the jump landed on should be near the TOP of
      // the viewport — i.e. the topmost human message currently visible
      // should sit above the viewport mid-line. Widen the tolerance to
      // accommodate scroll-snap rounding and per-turn padding.
      const targetHuman = await messages.evaluate(el => {
        const viewportRect = el.getBoundingClientRect()
        const viewportTop = viewportRect.top
        const viewportMid = viewportTop + viewportRect.height / 2
        const visibleHumans = Array.from(el.querySelectorAll('[data-testid="message-user"]'))
          .map(t => ({ t, top: t.getBoundingClientRect().top }))
          .filter(({ top }) => top >= viewportTop - 200 && top <= viewportMid)
        if (!visibleHumans.length) {
          return null
        }
        const topmost = visibleHumans.sort((a, b) => a.top - b.top)[0]
        return topmost.t.textContent?.slice(0, 80) ?? ''
      })
      expect(
        targetHuman,
        'a human message should sit at the top of the viewport after Alt+Down',
      ).toBeTruthy()
    })

    // SPEC: shortcut:jump-boundary
    test('Alt+Down at last message scrolls to bottom', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Scroll to bottom so all messages are above viewport
      await messages.evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)

      // Press Alt+Down — no messages below, should stay at bottom
      await page.keyboard.press('Alt+ArrowDown')

      await expect
        .poll(async () => {
          return await messages.evaluate(el => {
            const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight
            return scrollBottom < 50
          })
        })
        .toBe(true)
    })

    // SPEC: shortcut:jump-boundary
    test('Alt+Up at first message scrolls to top', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Disengage autoscroll before forcing scrollTop=0 — without this the
      // autoscroll engine may snap the scroll back to bottom between the
      // programmatic write and the Alt+Up press.
      await messages.dispatchEvent('wheel', { deltaY: -100 })
      await messages.evaluate(el => {
        el.scrollTop = 0
      })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(0)

      // Press Alt+Up — no messages above, should remain at top
      await page.keyboard.press('Alt+ArrowUp')

      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(0)
    })

    // SPEC: shortcut:jump-viewport
    test('Alt+Up/Down targets are viewport-relative', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Wait for the long-conversation fixture to actually render — without
      // this, scrollHeight may still be ≤ clientHeight when we try to seek to
      // the middle, so scrollTop stays 0 and the test races on layout.
      await expect
        .poll(async () => messages.evaluate(el => el.scrollHeight - el.clientHeight))
        .toBeGreaterThan(100)

      // Disengage autoscroll before positioning the scroll mid-document —
      // otherwise it can snap back to bottom before Alt+Up/Down fire.
      await messages.dispatchEvent('wheel', { deltaY: -100 })
      await messages.evaluate(el => {
        el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2)
      })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)

      const scrollMid = await messages.evaluate(el => el.scrollTop)

      // Alt+Up should jump to a message above current viewport
      await page.keyboard.press('Alt+ArrowUp')
      await expect
        .poll(async () => {
          const scrollAfter = await messages.evaluate(el => el.scrollTop)
          return scrollAfter < scrollMid
        })
        .toBe(true)

      // Wait for scroll to stabilize (two consecutive equal reads) before
      // capturing scrollAfterUp — otherwise Alt+Down would race the in-flight
      // scroll animation and could read a non-final position.
      const scrollAfterUp = await waitForStableScroll(messages)

      // Alt+Down should jump to a message below current viewport
      await page.keyboard.press('Alt+ArrowDown')
      await expect
        .poll(async () => {
          const scrollAfter = await messages.evaluate(el => el.scrollTop)
          return scrollAfter > scrollAfterUp
        })
        .toBe(true)
    })
  })

  test.describe('Alt+Home/End', () => {
    // SPEC: shortcut:alt-home
    test('Alt+Home scrolls to top', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Wait for autoscroll to bottom
      await expect
        .poll(async () => {
          return await messages.evaluate(el => el.scrollTop)
        })
        .toBeGreaterThan(0)

      // Press Alt+Home
      await page.keyboard.press('Alt+Home')

      // Should scroll to top
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(0)
    })

    // SPEC: shortcut:alt-end
    test('Alt+End scrolls to bottom', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Wait for initial autoscroll to settle, then use Alt+Home to scroll to top
      // (avoids fighting autoscroll by going through the tested shortcut path)
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
      await page.keyboard.press('Alt+Home')
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(0)

      // Press Alt+End
      await page.keyboard.press('Alt+End')

      // Should scroll near bottom (explicit timeout — preceding steps consume test budget)
      await expect
        .poll(
          async () => {
            return await messages.evaluate(el => {
              const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight
              return scrollBottom < 50
            })
          },
          { timeout: 3000 },
        )
        .toBe(true)
    })
  })

  test.describe('Control bar buttons', () => {
    // SPEC: chat:control-prev
    test('clicking ↑ button navigates to previous message', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Scroll to bottom first
      await messages.evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)

      const scrollBefore = await messages.evaluate(el => el.scrollTop)

      // Click prev button
      await page.locator('button[title="Previous message (Alt+Up)"]').click()

      // Should scroll up
      await expect
        .poll(async () => {
          const scrollAfter = await messages.evaluate(el => el.scrollTop)
          return scrollAfter < scrollBefore
        })
        .toBe(true)
    })

    // SPEC: chat:control-next
    test('clicking ↓ button navigates to next message', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Wheel-scroll up to disengage autoscroll (programmatic scrollTop=0 doesn't
      // qualify as user-scroll, so autoscroll snaps back to bottom on next tick).
      await messages.hover()
      await page.mouse.wheel(0, -10000)
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeLessThan(50)
      const scrollBefore = await messages.evaluate(el => el.scrollTop)

      // Click next button
      await page.locator('button[title="Next message (Alt+Down)"]').click()

      // Should scroll down
      await expect
        .poll(async () => {
          return await messages.evaluate(el => el.scrollTop)
        })
        .toBeGreaterThan(scrollBefore)
    })
  })

  test.describe('Jump highlight', () => {
    // SPEC: shortcut:jump-highlight
    test('jumped-to message gets highlight class', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Scroll to bottom so there are messages above
      await messages.evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)

      // Press Alt+Up
      await page.keyboard.press('Alt+ArrowUp')

      // A message should have the highlight class
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            return document.querySelectorAll('.jump-highlight').length
          })
        })
        .toBeGreaterThan(0)
    })

    // SPEC: shortcut:jump-highlight
    test('jumped-to message scrolls to top of viewport', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messages = page.locator('[data-testid="chat-messages"]')
      await expect(messages).toBeVisible()

      // Scroll to bottom so there are messages above
      await messages.evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeGreaterThan(0)

      // Press Alt+Up to jump to previous human message
      await page.keyboard.press('Alt+ArrowUp')

      // Wait for highlight to appear
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            return document.querySelectorAll('.jump-highlight').length
          })
        })
        .toBeGreaterThan(0)

      // The highlighted message should be near the top of the messages container
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            const container = document.querySelector('[data-testid="chat-messages"]')
            const highlighted = document.querySelector('.jump-highlight')
            if (!(container && highlighted)) {
              return false
            }

            const containerRect = container.getBoundingClientRect()
            const highlightedRect = highlighted.getBoundingClientRect()

            // Message should be within 100px of container top (allowing for padding/margins)
            return highlightedRect.top - containerRect.top < 100
          })
        })
        .toBe(true)
    })
  })
})
