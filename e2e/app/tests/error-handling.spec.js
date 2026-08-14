/** E2E tests for error handling including turn errors, tool errors, SSE reconnection, API degradation, and interrupt visualization. */

import { expect, test } from '@playwright/test'
import {
  assertColor,
  assertRedColor,
  openLogsPanel,
  openStashPanel,
  openTodosPanel,
  waitForAppReady,
} from '../helpers.js'
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

      await expect(page.getByText('Do something that fails').first()).toBeVisible()

      const errorTurn = page.locator('.turn-error').first()
      await expect(errorTurn).toBeVisible()

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

      const toolBlock = page.locator('[data-testid="tool-block"][data-tool-status="error"]').first()
      await expect(toolBlock).toBeVisible()

      await expect(toolBlock).toHaveClass(/tool-error/)

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

      const initialCount = await controller.getConnectionCount()

      await controller.triggerError()

      // RECONNECT_BASE_DELAY is 1000ms.
      await expect.poll(() => controller.getConnectionCount()).toBeGreaterThan(initialCount)
    })

    // SPEC: error:sse
    test('SSE error updates connection status', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="footer-status"][data-status="ready"]')).toBeVisible()

      await controller.triggerError()

      // Status cycles through reconnecting/connecting before returning to ready.
      await expect(page.locator('[data-testid="footer-status"][data-status="ready"]')).toBeVisible()
    })

    // SPEC: footer:reconnecting
    test('SSE error shows "Reconnecting" status in footer', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.triggerError()

      await expect(
        page.locator('[data-testid="footer-status"][data-status="reconnecting"]'),
      ).toBeVisible()
      await expect(page.getByText('Reconnecting')).toBeVisible()
    })
  })

  test.describe('API Errors', () => {
    // SPEC: error:api
    test('API send failure surfaces a transient error in the footer', async ({ page }) => {
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

      // The state-clear test below proves the 4s auto-clear on top of this.
      await expect(page.locator('[data-testid="footer-status"][data-status="error"]')).toBeVisible({
        timeout: 8000,
      })
    })
  })

  test.describe('Daemon Restart Recovery', () => {
    // SSE reconnect uses a 1s+ baseDelay, so the recovery cycle needs headroom above the global 5s timeout.
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
            // The default container id keeps the mocked container-proxied routes matching.
            await route.fulfill({
              json: { session_id: 'test-session-001', container_id: DEFAULT_CONTAINER_ID },
            })
          },
        },
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // SessionRoutingEffect already consumed one resume call on load; baseline it so the assertion below only
      // sees the recovery-driven resume.
      const baselineResumeCount = resumeCount

      // The container's chat SSE dies alongside the daemon and stays dead until a fresh container_id arrives.
      await chat.kill()

      // useSSE auto-reconnects on the daemon connection, incrementing daemonReconnected and
      // triggering DaemonReconnectEffect. Chat stays killed so isConnected stays false and
      // the recovery branch's skip condition (containerId && isConnected) is not taken.
      await daemon.disconnect()

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
            // The first call (initial load via SessionRoutingEffect) succeeds so the app can boot; later calls
            // (the recovery-driven resume) fail to drive the failure path.
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

      const initialCount = await controller.getConnectionCount()

      // Reload button is the footer's RefreshCw-icon button, titled "Reload".
      const reloadBtn = page.locator('button[title*="Reload"]')
      await expect(reloadBtn).toBeVisible()
      await reloadBtn.click()

      await expect.poll(() => controller.getConnectionCount()).toBeGreaterThan(initialCount)
    })

    // SPEC: error:preserve-state
    test('session state preserved across reconnects', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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

      await expect(page.getByText('Hello before reconnect')).toBeVisible()
      await expect(page.getByText('Response before reconnect')).toBeVisible()

      await controller.triggerError()

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

      await input.fill('Test message')
      await input.press('Enter')

      await expect(page.locator('[data-testid="footer-status"][data-status="error"]')).toBeVisible()

      // Auto-clear timer is 4s; the 6s wait below leaves margin.
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

      await expect(page.getByText('Once upon a time').first()).toBeVisible()

      const interruptedTurn = page.locator('.turn-interrupted').first()
      await expect(interruptedTurn).toBeVisible()

      const borderLeftColor = await interruptedTurn.evaluate(
        el => getComputedStyle(el).borderLeftColor,
      )

      const match = borderLeftColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      expect(match).toBeTruthy()
      const [, r, g, b] = match.map(Number)
      expect(r).toBeGreaterThan(150)
      expect(g).toBeGreaterThan(150)
      expect(b).toBeLessThan(100)
    })
  })

  test.describe('Startup Errors', () => {
    // SPEC: error:api
    test('startup failure when /api/sessions/current returns 500', async ({ page }) => {
      // Session fetch retries 3x with exponential backoff (1s+2s+4s=7s) before reporting error.
      test.setTimeout(15000)
      await mockAPI(page)
      await mockAPIWithError(page, '**/api/sessions/current', { status: 500 })
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)

      // After retries exhaust, SessionDataContext calls onError, which shows the error status.
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

      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeEnabled()

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

      await logsController.sendLog({
        timestamp: 1706123456,
        level: 'INFO',
        logger: 'test',
        message: 'Before error',
      })
      await expect(page.getByText('Before error')).toBeVisible()

      await logsController.triggerLogsError()

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

      await expect(page.getByText('Once upon a time').first()).toBeVisible()

      const interruptedTurn = page.locator('.turn-interrupted')
      await expect(interruptedTurn.first()).toBeVisible()

      await assertColor(interruptedTurn.first(), 'borderLeftColor', { r: 200, g: 200, b: 0 }, 80)
    })

    // SPEC: chat:interrupt-range
    test('interrupt ack is suppressed - no Interrupted text indicator', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/interrupted-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByText('Once upon a time').first()).toBeVisible()

      // Interrupt state is signaled by the yellow border alone, not by text.
      await expect(page.getByText('Interrupted')).not.toBeVisible()
    })

    // SPEC: chat:interrupt-ack-hidden
    test('SDK ack message is not shown as user bubble', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/interrupted-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByText('Once upon a time').first()).toBeVisible()

      await expect(page.getByText('[Request interrupted by user]')).not.toBeVisible()
    })

    // SPEC: chat:interrupt-visual
    test('non-interrupted turn has no interrupted styling', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/interrupted-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // '2 + 2 equals 4.' is the fixture's second, non-interrupted turn.
      await expect(page.getByText('2 + 2 equals 4.').first()).toBeVisible()

      const interruptedTurns = page.locator('.turn-interrupted')
      await expect(interruptedTurns).toHaveCount(1)
    })
  })

  test.describe('Render Failure Containment', () => {
    // SPEC: error:render-containment
    test('a panel that throws shows a retryable fallback; the rest of the app keeps working', async ({
      page,
    }) => {
      // Test-only escape hatch (see panelThrowInjection.js); must run before mockAPI.
      await page.addInitScript(() => {
        window.__claudeboxAllowThrowPanel = true
      })
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Opens todos first (persisted layout) before reloading with the throw param: dockview swallows
      // failures on a brand-new panel's first mount, so this targets an existing one.
      await openTodosPanel(page)
      await page.goto(DEFAULT_SESSION_URL.replace('/#', '/?throwPanel=todos#'))
      await waitForAppReady(page)

      const fallback = page.locator('[data-testid="error-boundary-todos"]')
      await expect(fallback).toBeVisible()
      await expect(fallback).toContainText('This panel stopped responding.')

      // Other panels stay unaffected: composer input and another panel's toggle both work.
      await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled()
      await openStashPanel(page)

      // Strips the throwPanel query param so Retry lands on a working condition.
      await page.evaluate(() =>
        window.history.replaceState(null, '', window.location.pathname + window.location.hash),
      )
      await fallback.getByRole('button', { name: 'Retry' }).click()

      await expect(fallback).not.toBeVisible()
      await expect(page.locator('.todos-panel')).toBeVisible()
    })
  })
})
