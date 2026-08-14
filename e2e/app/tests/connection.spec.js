/** E2E tests for SSE connection behavior including initial connection, session data fetch, and reconnection. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Connection', () => {
  test.describe('Initial Connection', () => {
    test('connects to SSE on page load', async ({ page }) => {
      // Controller must be created BEFORE mockAPI so addInitScript runs first
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const connectionCount = await controller.getConnectionCount()
      expect(connectionCount).toBeGreaterThanOrEqual(1)
    })

    test('fetches session data on connect', async ({ page }) => {
      let sessionDataFetched = false
      await mockAPI(page, {
        handlers: {
          getSessionStatus: async route => {
            sessionDataFetched = true
            await route.fulfill({
              json: {
                session_id: 'test-session-001',
                name: null,
                workspace: '/home/user/project',
                model: 'claude-sonnet-5',
                num_turns: 0,
                total_cost_usd: 0,
                total_duration_ms: 0,
                last_context_tokens: 0,
                started_at: '2025-01-18T12:00:00Z',
                updated_at: '2025-01-18T12:00:00Z',
                first_message: null,
                last_message: null,
                todos: [],
                commands: { custom: ['help', 'clear', 'compact'], mcp: [], builtin: [] },
                session_dir: '/tmp/sessions/test-session-001',
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect.poll(() => sessionDataFetched).toBe(true)
    })

    // SPEC: footer:status-text
    test('shows Ready status when connected', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="footer-status"][data-status="ready"]')).toBeVisible()
      await expect(page.getByText('Ready')).toBeVisible()
    })
  })

  test.describe('Resume Replay', () => {
    // SPEC: error:resuming-panels
    test('every SSE-dependent panel shows "Resuming..." during replay', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/resuming.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      // Panels on the chat SSE stream show replay state; MCP/Usage use separate streams, out of scope here.
      await page.locator('[data-testid="icon-logs"]').click()
      await expect(page.locator('[data-testid="panel-logs"]')).toContainText('Resuming...')

      await page.locator('[data-testid="icon-commands"]').click()
      await expect(page.locator('[data-testid="panel-skills"]')).toContainText('Resuming...')

      // Tasks panel is default-visible
      await expect(page.locator('[data-testid="panel-tasks"]')).toContainText('Resuming...')
    })
  })

  test.describe('Reconnection', () => {
    // SPEC: error:auto-reconnect
    test('automatically reconnects after SSE error without user interaction', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const initialCount = await controller.getConnectionCount()
      expect(initialCount).toBeGreaterThanOrEqual(1)

      const errorTime = Date.now()

      // Trigger error on SSE - no user interaction after this
      await controller.triggerError()

      // Auto-reconnect happens automatically (RECONNECT_BASE_DELAY ~1000ms); no clicks or interactions here.
      await expect
        .poll(() => controller.getConnectionCount(), { timeout: 5000 })
        .toBeGreaterThan(initialCount)

      // Verify reconnection took at least 1s (not instant - there's a delay)
      const elapsed = Date.now() - errorTime
      expect(elapsed).toBeGreaterThanOrEqual(1000)
    })

    // SPEC: panel-session:resume
    // SPEC: panel-session:auto-refresh
    test('session resume calls API, reconnects SSE, and focuses chat', async ({ page }) => {
      let resumeSessionCalled = false

      const controller = await createSSEController(page)
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          resumeSession: async route => {
            resumeSessionCalled = true
            await route.fulfill({
              status: 200,
              json: { session_id: 'test-session-002', container_id: 'test-cid' },
            })
          },
        },
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const initialConnections = await controller.getConnectionCount()

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hello',
          timestamp: 1705600000000,
        },
        { type: 'assistant', subtype: 'text', content: 'Hi there!', timestamp: 1705600001000 },
        { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: 1705600002000 },
      ])

      await expect(page.getByText('Hello')).toBeVisible()

      // Sessions panel is visible by default
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      await page.locator('[data-testid="session-resume-btn"]').first().click()

      await expect.poll(() => resumeSessionCalled).toBe(true)
      await expect.poll(() => controller.getConnectionCount()).toBeGreaterThan(initialConnections)

      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
      await expect(page.locator('[data-testid="chat-input"]')).toBeVisible()
    })
  })
})
