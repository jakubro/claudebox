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

      await expect(page.locator('.turn-container').first()).toBeVisible()

      await expect(page.locator('.turn-progress-working').first()).toBeVisible()
      await expect(page.getByText('Working').first()).toBeVisible()

      await expect(page.locator('.progress-spinner').first()).toBeVisible()
    })

    // SPEC: turn:progress-working
    test('working indicator has animated spinner', async ({ page }) => {
      await mockSSE(page, 'events/progress-working.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const spinner = page.locator('.progress-spinner').first()
      await expect(spinner).toBeVisible()

      const animation = await spinner.evaluate(el => {
        const style = getComputedStyle(el)
        return style.animation || style.animationName
      })

      expect(animation).not.toBe('none')
    })
  })

  test.describe('Stopping State', () => {
    // SPEC: turn:progress-stopping
    test('interrupt shows Stopping indicator', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // No result event, so the turn stays in the "working" state.
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

      await expect(page.locator('.turn-container').first()).toBeVisible()

      // Focus textarea so Ctrl+. is caught by ChatInput's onKeyDown handler
      await page.locator('[data-testid="chat-input"]').click()
      await page.keyboard.press('Control+.')

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

      await expect(page.locator('.turn-progress-working').first()).toBeVisible()

      // Focus textarea so Ctrl+. is caught by ChatInput's onKeyDown handler
      await page.locator('[data-testid="chat-input"]').click()
      await page.keyboard.press('Control+.')

      await expect.poll(() => interruptCalled).toBe(true)
    })

    // SPEC: error:state-stopped-clear
    test('stopped state clears on result event', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
