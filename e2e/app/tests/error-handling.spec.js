/** E2E tests for error handling including turn errors, tool errors, SSE reconnection, API degradation, and interrupt visualization. */

import { expect, test } from '@playwright/test'
import { assertColor, assertRedColor, openLogsPanel, waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_URL,
  mockAPI,
  mockAPIWithError,
} from '../mocks/api.js'
import {
  createDaemonSSEController,
  createLogsSSEController,
  createSSEController,
  mockSSE,
} from '../mocks/sse.js'

test.describe('Error Handling', () => {
  test.describe('Turn Errors', () => {
    // SPEC: error:turn
    // SPEC: chat:error-border
    test('error turn shows red border', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/chat-with-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for the message content to appear
      await expect(page.getByText('Do something that fails').first()).toBeVisible()

      // Error turn should have error styling with red border
      const errorTurn = page.locator('.turn-error').first()
      await expect(errorTurn).toBeVisible()

      // Verify red border CSS per SPEC
      await assertRedColor(errorTurn, 'borderLeftColor')
    })
  })

  test.describe('Tool Errors', () => {
    // SPEC: error:tool
    // SPEC: tool:bullet-error
    test('tool error shows error styling', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/tool-with-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for tool block with error status
      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="error"]').first()
      await expect(toolBlock).toBeVisible()

      // Should have error class
      await expect(toolBlock).toHaveClass(/tool-error/)

      // Error bullet should have red color
      const bullet = toolBlock.locator('.tool-bullet')
      await expect(bullet).toBeVisible()
      await assertRedColor(bullet, 'color')
    })

    // SPEC: error:tool
    test('tool error shows error message', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/tool-with-error.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Error message should be visible
      await expect(page.getByText('File not found').first()).toBeVisible()
    })
  })

  test.describe('SSE Errors', () => {
    // SPEC: error:auto-reconnect
    // MOCK-LIMITED: SSE mock cannot verify EventSource teardown/rebuild
    test('SSE error triggers reconnection', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Get initial connection count
      const initialCount = await controller.getConnectionCount()

      // Trigger SSE error
      await controller.triggerError()

      // Poll until reconnection happens (RECONNECT_BASE_DELAY is 1000ms)
      await expect.poll(() => controller.getConnectionCount()).toBeGreaterThan(initialCount)
    })

    // SPEC: error:sse
    test('SSE error updates connection status', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for initial connection to be ready
      await expect(page.locator('[data-testid="footer-status"][data-status="ready"]')).toBeVisible()

      // Trigger SSE error
      await controller.triggerError()

      // Eventually should reconnect and return to ready (status cycles through reconnecting/connecting)
      await expect(page.locator('[data-testid="footer-status"][data-status="ready"]')).toBeVisible()
    })

    // SPEC: footer:reconnecting
    test('SSE error shows "Reconnecting" status in footer', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Trigger SSE error
      await controller.triggerError()

      // Footer should show "Reconnecting" with reconnecting status
      await expect(
        page.locator('[data-testid="footer-status"][data-status="reconnecting"]'),
      ).toBeVisible()
      await expect(page.getByText('Reconnecting')).toBeVisible()
    })
  })

  test.describe('API Errors', () => {
    // SPEC: error:api
    test('API send failure surfaces a transient error in the footer', async ({ page }) => {
      // Footer must surface a transient error indication when a send fails.
      await mockSSE(page)
      await mockAPI(page, {
        handlers: {
          send: async route => {
            await route.fulfill({ status: 500, json: { error: 'Server error' } })
          },
        },
      })
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeEnabled()

      await input.fill('Test message')
      await input.press('Enter')

      // Footer must surface the error status. The state-clear test below
      // additionally proves the auto-clear after 4s.
      await expect(page.locator('[data-testid="footer-status"][data-status="error"]')).toBeVisible({
        timeout: 8000,
      })
    })
  })

  test.describe('Daemon Restart Recovery', () => {
    // SSE reconnect uses 1s+ baseDelay; bump per-test timeout above the
    // global 5s ceiling so the recovery cycle has room to settle.
    test.describe.configure({ timeout: 20_000 })

    // SPEC: error:daemon-restart-recovery
    test('automatically recovers session after daemon restart', async ({ page }) => {
      let resumeCount = 0
      const chat = await createSSEController(page)
      const daemon = await createDaemonSSEController(page)
      await mockAPI(page, {
        handlers: {
          resumeSession: async route => {
            resumeCount += 1
            // Use the default container id so the mocked container-proxied
            // routes (sessions/current etc.) keep matching.
            await route.fulfill({
              json: { session_id: 'test-session-001', container_id: DEFAULT_CONTAINER_ID },
            })
          },
        },
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Initial resume (SessionRoutingEffect) consumed one call. Reset counter
      // so the assertion only sees the recovery-driven resume.
      const baselineResumeCount = resumeCount

      // Simulate the container's chat SSE dying alongside the daemon - and
      // staying dead until a fresh container_id arrives.
      await chat.kill()

      // Daemon drops and useSSE auto-reconnects; daemonReconnected increments
      // when the new connection opens, triggering DaemonReconnectEffect.
      // Chat remains killed so isConnected stays false and the recovery branch
      // (containerId && isConnected -> skip) is NOT taken.
      await daemon.disconnect()

      // Resume must be called after the daemon reconnects.
      await expect.poll(() => resumeCount, { timeout: 10000 }).toBeGreaterThan(baselineResumeCount)
    })

    // SPEC: error:daemon-restart-recovery
    test('shows "Session reconnect failed" when resume fails after daemon restart', async ({
      page,
    }) => {
      let resumeCount = 0
      const chat = await createSSEController(page)
      const daemon = await createDaemonSSEController(page)
      await mockAPI(page, {
        handlers: {
          resumeSession: async route => {
            resumeCount += 1
            // First call (initial session load via SessionRoutingEffect) succeeds
            // so the app can boot. Subsequent calls (the recovery-driven
            // resume) fail to drive the failure-path message.
            if (resumeCount === 1) {
              await route.fulfill({
                json: { session_id: 'test-session-001', container_id: DEFAULT_CONTAINER_ID },
              })
            } else {
              await route.fulfill({ status: 500, json: { error: 'Resume failed' } })
            }
          },
        },
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await chat.kill()
      await daemon.disconnect()

      // Footer surfaces the recovery failure as an error status.
      await expect(page.locator('.footer-error-text')).toContainText('Session reconnect failed', {
        timeout: 10000,
      })
    })
  })

  test.describe('Manual Recovery', () => {
    // SPEC: error:manual-reconnect
    // MOCK-LIMITED: Cannot verify real SSE connection reset
    test('reload button reconnects to server', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Get initial connection count
      const initialCount = await controller.getConnectionCount()

      // Click reload button in footer (second button with RefreshCw icon, title contains "Reload")
      const reloadBtn = page.locator('button[title*="Reload"]')
      await expect(reloadBtn).toBeVisible()
      await reloadBtn.click()

      // Poll until another connection is made
      await expect.poll(() => controller.getConnectionCount()).toBeGreaterThan(initialCount)
    })

    // SPEC: error:preserve-state
    test('session state preserved across reconnects', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send some events to establish state
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hello before reconnect',
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Response before reconnect',
          timestamp: Date.now() + 100,
        },
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_001',
          timestamp: Date.now() + 200,
        },
      ])

      // Wait for messages to appear
      await expect(page.getByText('Hello before reconnect')).toBeVisible()
      await expect(page.getByText('Response before reconnect')).toBeVisible()

      // Trigger SSE error to force reconnect
      await controller.triggerError()

      // Messages should still be visible after reconnect (state preserved)
      // Using longer timeout to account for reconnection delay
      await expect(page.getByText('Hello before reconnect')).toBeVisible()
      await expect(page.getByText('Response before reconnect')).toBeVisible()
    })
  })

  test.describe('Error State Recovery', () => {
    // SPEC: error:state-clear
    test('error state auto-clears after 4 seconds', async ({ page }) => {
      test.setTimeout(10000)

      await createSSEController(page)
      await mockAPI(page, {
        handlers: {
          send: async route => {
            await route.fulfill({ status: 500, json: { error: 'Server error' } })
          },
        },
      })
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeEnabled()

      // Send a message that triggers an error
      await input.fill('Test message')
      await input.press('Enter')

      // Error state should appear
      await expect(page.locator('[data-testid="footer-status"][data-status="error"]')).toBeVisible()

      // Error auto-clears after 4s without any user action
      await expect(
        page.locator('[data-testid="footer-status"][data-status="error"]'),
      ).not.toBeVisible({ timeout: 6000 })
    })
  })

  test.describe('Error Interrupt', () => {
    // SPEC: error:interrupt
    test('interrupted turn displays yellow left border', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/interrupted-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for interrupted turn content
      await expect(page.getByText('Once upon a time').first()).toBeVisible()

      // Verify the interrupted turn has a yellow left border via CSS
      const interruptedTurn = page.locator('.turn-interrupted').first()
      await expect(interruptedTurn).toBeVisible()

      const borderLeftColor = await interruptedTurn.evaluate(
        el => getComputedStyle(el).borderLeftColor,
      )

      // Yellow border - parse as RGB and verify high red+green, low blue
      const match = borderLeftColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      expect(match).toBeTruthy()
      const [, r, g, b] = match.map(Number)
      // Yellow hues have high red (>150), high green (>150), and low blue (<100)
      expect(r).toBeGreaterThan(150)
      expect(g).toBeGreaterThan(150)
      expect(b).toBeLessThan(100)
    })
  })

  test.describe('Startup Errors', () => {
    // SPEC: error:api
    test('startup failure when /api/sessions/current returns 500', async ({ page }) => {
      // Session fetch retries 3× with exponential backoff (1s+2s+4s=7s) before reporting error
      test.setTimeout(15000)
      await mockAPI(page)
      await mockAPIWithError(page, '**/api/sessions/current', { status: 500 })
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)

      // After retries exhaust, SessionDataContext calls onError -> footer shows error status
      await expect(page.locator('[data-testid="footer-status"][data-status="error"]')).toBeVisible({
        timeout: 12000,
      })
    })

    // SPEC: error:api
    test('startup failure when /api/sessions/current returns 500 still renders app shell', async ({
      page,
    }) => {
      await mockAPI(page)
      await mockAPIWithError(page, '**/api/sessions/current', { status: 500 })
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)

      // App shell should still render (footer, header)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()
    })
  })

  test.describe('API Degradation', () => {
    // SPEC: error:api
    test('file tree 500 degrades gracefully', async ({ page }) => {
      await mockAPI(page)
      await mockAPIWithError(page, /\/api\/files\/tree/, { status: 500 }) // regex matches proxied path
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Chat should still work despite file tree failure
      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeEnabled()
    })

    // SPEC: error:api
    test('session-defaults endpoint timeout degrades gracefully', async ({ page }) => {
      await mockAPI(page)
      await mockAPIWithError(page, '**/session-defaults')
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Chat should still work despite session-defaults timeout
      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeEnabled()
    })
  })

  test.describe('Malformed SSE', () => {
    // SPEC: error:sse
    test('malformed SSE data does not crash the app', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send malformed event data (not valid JSON)
      const injected = await page.evaluate(() => {
        const instance = window.__sseChatInstance
        if (!instance || instance.readyState !== 1) {
          return false
        }
        const malformed = { data: 'not-valid-json{{{' }
        if (instance.onmessage) {
          instance.onmessage(malformed)
        }
        instance._emit('message', malformed)
        return true
      })
      expect(injected, 'Malformed SSE data must be injected into active stream').toBe(true)

      // App should survive - chat input still works
      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeEnabled()

      // Send a valid event after the malformed one
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'After malformed',
          timestamp: Date.now(),
          turn_id: 'turn_mal',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Still working!',
          timestamp: Date.now() + 100,
        },
        { type: 'result', subtype: 'success', turn_id: 'turn_mal', timestamp: Date.now() + 200 },
      ])

      // Valid events should still render
      await expect(page.getByText('Still working!')).toBeVisible()
    })
  })

  test.describe('LogsPanel SSE Error', () => {
    test('logs SSE error keeps panel rendered without crashing', async ({ page }) => {
      const logsController = await createLogsSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      await openLogsPanel(page)

      // Send a log entry first
      await logsController.sendLog({
        timestamp: 1706123456,
        level: 'INFO',
        logger: 'test',
        message: 'Before error',
      })
      await expect(page.getByText('Before error')).toBeVisible()

      // Trigger logs SSE error
      await logsController.triggerLogsError()

      // Panel should still be visible (not crash)
      await expect(page.locator('[data-testid="panel-logs"]')).toBeVisible()
    })
  })

  test.describe('Interrupt Visualization', () => {
    // SPEC: chat:interrupt-visual
    // SPEC: chat:interrupt-border
    test('interrupted turn has turn-interrupted class', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/interrupted-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for the interrupted turn content
      await expect(page.getByText('Once upon a time').first()).toBeVisible()

      // Turn should have interrupted class (yellow border)
      const interruptedTurn = page.locator('.turn-interrupted')
      await expect(interruptedTurn.first()).toBeVisible()

      // Verify yellow border color: high R, high G, low B
      await assertColor(interruptedTurn.first(), 'borderLeftColor', { r: 200, g: 200, b: 0 }, 80)
    })

    // SPEC: chat:interrupt-range
    test('interrupt ack is suppressed - no Interrupted text indicator', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/interrupted-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByText('Once upon a time').first()).toBeVisible()

      // Interrupt indicator text no longer renders - yellow border is sufficient
      await expect(page.getByText('Interrupted')).not.toBeVisible()
    })

    // SPEC: chat:interrupt-ack-hidden
    test('SDK ack message is not shown as user bubble', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/interrupted-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for turn to render
      await expect(page.getByText('Once upon a time').first()).toBeVisible()

      // SDK ack text should NOT appear as visible user message
      await expect(page.getByText('[Request interrupted by user]')).not.toBeVisible()
    })

    // SPEC: chat:interrupt-visual
    test('non-interrupted turn has no interrupted styling', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/interrupted-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for second (non-interrupted) turn
      await expect(page.getByText('2 + 2 equals 4.').first()).toBeVisible()

      // Count interrupted turns - should be exactly 1 (only the first turn)
      const interruptedTurns = page.locator('.turn-interrupted')
      await expect(interruptedTurns).toHaveCount(1)
    })
  })
})
