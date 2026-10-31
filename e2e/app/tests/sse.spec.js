/** E2E tests for SSE (Server-Sent Events) functionality. */

import { expect, test } from '@playwright/test'
import { openLiveSessionWithAPI, sendFinishedTurn } from '../helpers.js'

test.describe('SSE', () => {
  test.describe('Manual Reconnect', () => {
    // SPEC: error:manual-reconnect
    test('reload button clears events and reconnects', async ({ page }) => {
      const controller = await openLiveSessionWithAPI(page)

      await sendFinishedTurn(controller, 'Hi there')

      await expect(page.getByText('Hello')).toBeVisible()
      await expect(page.getByText('Hi there')).toBeVisible()

      const initialCount = await controller.getConnectionCount()

      const reloadBtn = page.locator('button[title*="Reload"]')
      await expect(reloadBtn).toBeVisible()
      await reloadBtn.click()

      await expect.poll(() => controller.getConnectionCount()).toBeGreaterThan(initialCount)

      // SSE reconnects with empty state, so turn containers from the previous session should be gone.
      await expect
        .poll(async () => {
          const turnCount = await page.locator('.turn-container').count()
          return turnCount
        })
        .toBe(0)
    })
  })

  test.describe('Automatic Reconnect', () => {
    // SPEC: error:reconnect-no-repeat
    test('an automatic reconnect (no reload click) does not duplicate the transcript', async ({
      page,
    }) => {
      const controller = await openLiveSessionWithAPI(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Before the drop',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        { type: 'assistant', subtype: 'text', content: 'Reply', timestamp: Date.now() + 100 },
        { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() + 200 },
      ])
      await expect(page.getByText('Before the drop')).toBeVisible()

      const beforeDrop = await controller.getConnectionCount()
      // Unlike the reload-button test above, nothing here calls reconnectSSE() - the manager
      // reopens on its own.
      await controller.triggerError()
      await expect.poll(() => controller.getConnectionCount()).toBeGreaterThan(beforeDrop)

      // The new connection's own (empty) replay boundary is what clears the pre-drop turn.
      await expect.poll(() => page.locator('.turn-container').count()).toBe(0)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'After the drop',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_002',
        },
        { type: 'assistant', subtype: 'text', content: 'Reply', timestamp: Date.now() + 100 },
        { type: 'result', subtype: 'success', turn_id: 'turn_002', timestamp: Date.now() + 200 },
      ])

      await expect(page.getByText('After the drop')).toBeVisible()
      await expect(page.locator('.turn-container')).toHaveCount(1)
      await expect(page.getByText('Before the drop')).toHaveCount(0)
    })
  })

  test.describe('Session Polling', () => {
    test('polls current session when turn completes', async ({ page }) => {
      let sessionStatusFetchCount = 0

      const controller = await openLiveSessionWithAPI(page, {
        handlers: {
          getSessionStatus: async route => {
            sessionStatusFetchCount++
            await route.fulfill({
              json: {
                session_id: 'test-session-001',
                workspace: '/home/user/project',
                model: 'claude-sonnet',
                num_turns: sessionStatusFetchCount,
                total_cost_usd: 0.05 * sessionStatusFetchCount,
                total_duration_ms: 1000 * sessionStatusFetchCount,
                last_context_tokens: 1000 * sessionStatusFetchCount,
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                first_message: null,
                last_message: null,
                todos: [],
                commands: { custom: ['help', 'clear'], mcp: [], builtin: [] },
                session_dir: '/tmp/sessions/test-session-001',
              },
            })
          },
        },
      })

      await expect.poll(() => sessionStatusFetchCount).toBeGreaterThanOrEqual(1)

      const initialFetchCount = sessionStatusFetchCount

      // Sending user + assistant events puts the app in the "responding" state.
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Test message',
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

      await expect(page.getByText('Response')).toBeVisible()

      // Result event triggers the transition from responding back to not responding.
      await controller.sendEvents([
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_001',
          timestamp: Date.now() + 300,
        },
      ])

      // Session status is refetched once more after turn completion.
      await expect.poll(() => sessionStatusFetchCount).toBeGreaterThan(initialFetchCount)
    })
  })
})
