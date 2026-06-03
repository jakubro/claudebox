/** E2E tests for progress indicator functionality. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Progress Indicators', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Working State', () => {
    // SPEC: turn:progress-working
    test('active turn shows Working indicator with spinner', async ({ page }) => {
      await mockSSE(page, 'events/progress-working.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for turn to appear
      await expect(page.locator('.turn-container').first()).toBeVisible()

      // Should show "Working" indicator
      await expect(page.locator('.turn-progress-working').first()).toBeVisible()
      await expect(page.getByText('Working').first()).toBeVisible()

      // Should have spinner
      await expect(page.locator('.progress-spinner').first()).toBeVisible()
    })

    // SPEC: turn:progress-working
    test('working indicator has animated spinner', async ({ page }) => {
      await mockSSE(page, 'events/progress-working.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for spinner to appear
      const spinner = page.locator('.progress-spinner').first()
      await expect(spinner).toBeVisible()

      // Verify it's animating (has animation CSS property)
      const animation = await spinner.evaluate(el => {
        const style = getComputedStyle(el)
        return style.animation || style.animationName
      })

      // Should have some animation
      expect(animation).not.toBe('none')
    })
  })

  test.describe('Stopping State', () => {
    // SPEC: turn:progress-stopping
    test('interrupt shows Stopping indicator', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send a turn that's "working" (no result event)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Do something',
          is_human: true,
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working on it...',
          timestamp: Date.now() + 1000,
          ts: new Date().toISOString(),
        },
      ])

      // Wait for turn to appear
      await expect(page.locator('.turn-container').first()).toBeVisible()

      // Focus textarea so Ctrl+. is caught by ChatInput's onKeyDown handler
      await page.locator('[data-testid="chat-input"]').click()
      // Trigger interrupt (Ctrl+.)
      await page.keyboard.press('Control+.')

      // Should show "Stopping" indicator
      await expect(page.getByText(/Stopping/i).first()).toBeVisible()
    })

    // SPEC: shortcut:ctrl-dot
    test('stop button triggers interrupt API', async ({ page }) => {
      let interruptCalled = false

      const controller = await createSSEController(page)
      await mockAPI(page, {
        handlers: {
          interrupt: async route => {
            interruptCalled = true
            await route.fulfill({ status: 200, json: { success: true } })
          },
        },
      })
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Start a turn
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Test',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])

      // Wait for Working indicator
      await expect(page.locator('.turn-progress-working').first()).toBeVisible()

      // Focus textarea so Ctrl+. is caught by ChatInput's onKeyDown handler
      await page.locator('[data-testid="chat-input"]').click()
      // Press Ctrl+. to interrupt
      await page.keyboard.press('Control+.')

      // Poll until interrupt API is called
      await expect.poll(() => interruptCalled).toBe(true)
    })

    // SPEC: error:state-stopped-clear
    test('stopped state clears on result event', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send a turn that's "working"
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Test prompt',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])

      // Wait for turn to appear
      await expect(page.locator('.turn-container').first()).toBeVisible()

      // Focus textarea so Ctrl+. is caught by ChatInput's onKeyDown handler, then interrupt
      await page.locator('[data-testid="chat-input"]').click()
      await page.keyboard.press('Control+.')
      await expect(page.getByText(/Stopping/i).first()).toBeVisible()

      // Send a result event (as would arrive from the backend after interrupt)
      await controller.sendEvent({
        type: 'result',
        subtype: 'success',
        timestamp: Date.now() + 500,
      })

      // Stopped state should clear automatically without user action
      await expect
        .poll(async () => {
          const footerStatus = page.locator('[data-testid="footer-status"]')
          const statusText = await footerStatus.textContent()
          return statusText?.includes('Stopped') ?? false
        })
        .toBe(false)
    })
  })
})
