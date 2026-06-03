/** E2E tests for pending turn functionality. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  mockAPI,
} from '../mocks/api.js'
import { createSSEController } from '../mocks/sse.js'

test.describe('Pending Turns', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Pending Message Display', () => {
    // SPEC: turn:pending-show
    test('shows pending message immediately after send', async ({ page }) => {
      // Use SSE controller for manual event control
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      const input = await waitForAppReady(page)

      // Type and send message
      await input.fill('Test pending message')
      await input.press('Enter')

      // Pending message should appear immediately (before SSE confirmation)
      await expect(page.getByText('Test pending message')).toBeVisible()

      // Should have pending styling
      await expect(page.locator('.turn-container.pending')).toBeVisible()
    })

    // SPEC: turn:pending-remove
    test('pending message removed when SSE confirms', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      const input = await waitForAppReady(page)

      // Send message
      await input.fill('Confirm this message')
      await input.press('Enter')

      // Pending should appear
      await expect(page.locator('.turn-container.pending')).toBeVisible()

      // Send SSE confirmation
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Confirm this message',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
      ])

      // Pending should be removed (replaced by real message)
      await expect(page.locator('.turn-container.pending')).not.toBeVisible()

      // Real message should still be visible
      await expect(page.getByText('Confirm this message')).toBeVisible()
    })

    // SPEC: turn:pending-no-duplicate
    test('no duplicate pending messages on rapid send attempts', async ({ page }) => {
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      const input = await waitForAppReady(page)

      // Type message
      await input.fill('Test message')

      // Rapid double-send attempt
      await input.press('Enter')
      // Input should be cleared after first Enter, so second Enter should not send again
      await input.press('Enter')

      // Poll to verify only one pending message (or message area)
      await expect
        .poll(() => page.locator('.turn-container.pending').count())
        .toBeLessThanOrEqual(1)
    })
  })

  test.describe('Session Scoping', () => {
    // SPEC: chat:pending-session-scoped
    test('pending messages clear when switching to another session', async ({ page }) => {
      // Single-session mode: switching sessions happens via the SessionsPanel
      // resume click (or URL navigation), not an in-app tab.
      const controller = await createSSEController(page)
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          resumeSession: async route => {
            await route.fulfill({
              json: { session_id: 'test-session-002', container_id: DEFAULT_CONTAINER_ID },
            })
          },
        },
      })
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send SSE events so the session is active (not resuming)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Earlier message',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Response',
          timestamp: Date.now() + 100,
        },
      ])

      // Type and send a message to create a pending turn
      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Pending in session 1')
      await input.press('Enter')

      // Pending message should be visible
      await expect(page.locator('.turn-container.pending')).toBeVisible()

      // Switch sessions via the URL hash (single-session-mode replacement
      // for the in-app tab click).
      await page.evaluate(wsId => {
        window.location.hash = `#/workspaces/${wsId}/sessions/test-session-002`
      }, DEFAULT_WORKSPACE_ID)

      // Pending message from old session should no longer be visible
      await expect(page.locator('.turn-container.pending')).not.toBeVisible()
    })
  })
})
