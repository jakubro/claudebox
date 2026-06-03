/** E2E tests for Logs panel including SSE streaming, log formatting, and autoscroll. */

import { expect, test } from '@playwright/test'
import { openLogsPanel, toggleLogsPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, DEFAULT_WORKSPACE_ID, mockAPI } from '../mocks/api.js'
import { createLogsSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Logs Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
  })

  // SPEC: shortcut:alt0
  test('Alt+0 toggles logs panel', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Logs panel not visible by default
    await expect(page.locator('[data-testid="panel-logs"]')).not.toBeVisible()

    // Press Alt+0 to open
    await page.keyboard.press('Alt+0')
    await expect(page.locator('[data-testid="panel-logs"]')).toBeVisible()

    // Press Alt+0 again to close
    await page.keyboard.press('Alt+0')
    await expect(page.locator('[data-testid="panel-logs"]')).not.toBeVisible()
  })

  // SPEC: layout:left-strip
  // SPEC: layout:right-strip
  // SPEC: layout:logs-right-bottom
  test('Logs icon sits at the bottom of the right icon strip (not on the left)', async ({
    page,
  }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const sessionsIcon = page.locator('[data-testid="icon-sessions"]')
    const logsIcon = page.locator('[data-testid="icon-logs"]')

    await expect(sessionsIcon).toBeVisible()
    await expect(logsIcon).toBeVisible()

    // Sessions on the left strip; Logs on the right strip.
    const sessionsStripClass = await sessionsIcon.evaluate(
      el => el.closest('.icon-strip')?.className || '',
    )
    const logsStripClass = await logsIcon.evaluate(el => el.closest('.icon-strip')?.className || '')
    expect(sessionsStripClass).toContain('icon-strip-left')
    expect(logsStripClass).toContain('icon-strip-right')

    // Vertical sanity: logs sits below the top-aligned sessions icon.
    const sessionsTop = await sessionsIcon.evaluate(el => el.getBoundingClientRect().top)
    const logsTop = await logsIcon.evaluate(el => el.getBoundingClientRect().top)
    expect(logsTop).toBeGreaterThan(sessionsTop)
  })

  // SPEC: layout:icon-tooltip
  test('Logs icon button has correct tooltip', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const logsIcon = page.locator('[data-testid="icon-logs"]')
    await expect(logsIcon).toBeVisible()

    const title = await logsIcon.getAttribute('title')
    expect(title).toBe('Logs (Alt+0)')
  })

  // SPEC: panel-log:empty
  test('shows empty state when no logs', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openLogsPanel(page)

    // Should show empty/connecting state
    const logsPanel = page.locator('[data-testid="panel-logs"]')
    await expect(logsPanel).toBeVisible()
    // Panel should contain "No logs yet" in empty state
    await expect(logsPanel).toContainText('No logs yet')
  })

  // SPEC: layout:icon-toggle
  test('clicking logs icon opens panel', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Click logs icon
    await page.locator('[data-testid="icon-logs"]').click()

    // Panel should be visible
    await expect(page.locator('[data-testid="panel-logs"]')).toBeVisible()
  })

  // SPEC: layout:logs-strip-full-width
  // SPEC: layout:bottom-panel-split
  // The bottom-panel split claim's "1 slot fills the strip" half is verified
  // here; the "2 slots split 50/50" half is exercised by containers-panel.spec.
  test('logs strip spans the full width above the footer', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Open via icon click — strip is closed by default.
    await page.locator('[data-testid="icon-logs"]').click()

    const strip = page.locator('[data-testid="bottom-panel-container"]')
    await expect(strip).toBeVisible()

    const viewportWidth = page.viewportSize().width
    const stripBox = await strip.boundingBox()
    expect(stripBox.x).toBe(0)
    expect(stripBox.width).toBe(viewportWidth)

    // Footer remains at viewport bottom; the strip sits above it.
    const footerBox = await page.locator('[data-testid="footer"]').boundingBox()
    expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(footerBox.y + 1)

    // Closing returns the space to the main row.
    await page.locator('[data-testid="icon-logs"]').click()
    await expect(strip).not.toBeVisible()
  })

  test('logs panel can be toggled via helper', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Open
    await toggleLogsPanel(page)
    await expect(page.locator('[data-testid="panel-logs"]')).toBeVisible()

    // Close
    await toggleLogsPanel(page)
    await expect(page.locator('[data-testid="panel-logs"]')).not.toBeVisible()
  })

  test.describe('Connection States', () => {
    // SPEC: panel-log:loading
    // SPEC: panel-log:connecting
    test('shows loading or connecting state before logs arrive', async ({ page }) => {
      await createLogsSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      await openLogsPanel(page)

      // Panel should show a loading/connecting indicator before any logs are sent
      const logsPanel = page.locator('[data-testid="panel-logs"]')
      await expect(logsPanel).toBeVisible()
      // Panel should show a meaningful state message, not just be non-empty
      const text = await logsPanel.textContent()
      expect(text.length).toBeGreaterThan(0)
      const hasExpectedText =
        text.includes('Connecting') || text.includes('Loading') || text.includes('No logs')
      expect(
        hasExpectedText,
        `Expected panel to contain "Connecting", "Loading", or "No logs", got: "${text}"`,
      ).toBe(true)
    })
  })

  test.describe('Log Content', () => {
    // SPEC: panel-log:format
    test('log entries show timestamp, level, logger, message', async ({ page }) => {
      const logsController = await createLogsSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)

      // Wait for footer (indicates app ready, doesn't require chat input)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      await openLogsPanel(page)

      // Send a log entry
      await logsController.sendLog({
        timestamp: 1706123456,
        level: 'INFO',
        logger: 'claudebox.api',
        message: 'Server started on port 8080',
      })

      // Verify log entry structure
      const logLine = page.locator('.log-line').first()
      await expect(logLine).toBeVisible()
      await expect(logLine.locator('.log-timestamp')).toBeVisible()
      await expect(logLine.locator('.log-level')).toContainText('INFO')
      await expect(logLine.locator('.log-logger')).toContainText('claudebox.api')
      await expect(logLine.locator('.log-message')).toContainText('Server started on port 8080')
    })

    // SPEC: panel-log:colors
    test('log levels have distinct colors via CSS classes', async ({ page }) => {
      const logsController = await createLogsSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      await openLogsPanel(page)

      // Send logs at different levels
      await logsController.sendLogs([
        { timestamp: 1706123456, level: 'DEBUG', logger: 'test', message: 'Debug message' },
        { timestamp: 1706123457, level: 'INFO', logger: 'test', message: 'Info message' },
        { timestamp: 1706123458, level: 'WARNING', logger: 'test', message: 'Warning message' },
        { timestamp: 1706123459, level: 'ERROR', logger: 'test', message: 'Error message' },
      ])

      // Verify each level has its CSS class
      await expect(page.locator('.log-level-debug')).toBeVisible()
      await expect(page.locator('.log-level-info')).toBeVisible()
      await expect(page.locator('.log-level-warning')).toBeVisible()
      await expect(page.locator('.log-level-error')).toBeVisible()

      // Verify at least two different log levels have distinct computed colors
      const debugColor = await page
        .locator('.log-level-debug')
        .evaluate(el => getComputedStyle(el).color)
      const errorColor = await page
        .locator('.log-level-error')
        .evaluate(el => getComputedStyle(el).color)
      expect(debugColor).not.toBe(errorColor)
    })

    // SPEC: panel-log:colors
    test('critical log level has distinct color coding', async ({ page }) => {
      const logsController = await createLogsSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      await openLogsPanel(page)

      await logsController.sendLog({
        timestamp: 1706123460,
        level: 'CRITICAL',
        logger: 'test',
        message: 'Critical system failure',
      })

      await expect(page.locator('.log-level-critical')).toBeVisible()
    })

    // SPEC: panel-log:autoscroll
    test('auto-scrolls to latest log entries', async ({ page }) => {
      const logsController = await createLogsSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      await openLogsPanel(page)

      // Send many logs to trigger scroll
      const logs = Array.from({ length: 50 }, (_, i) => ({
        timestamp: 1706123456 + i,
        level: 'INFO',
        logger: 'test',
        message: `Log entry ${i + 1}`,
      }))
      await logsController.sendLogs(logs)

      // Wait for logs to render
      await expect(page.locator('.log-line')).toHaveCount(50)

      // Last log should be visible (auto-scrolled)
      const lastLog = page.locator('.log-line').last()
      await expect(lastLog).toContainText('Log entry 50')
      await expect(lastLog).toBeInViewport()
    })

    // SPEC: panel-log:resume
    test('shows "Resuming..." during session replay', async ({ page }) => {
      await mockAPI(page)
      // Use resuming fixture to trigger isReplaying state
      await mockSSE(page, 'events/resuming.jsonl')
      await page.goto(DEFAULT_SESSION_URL)

      // Wait for footer (app ready indicator that doesn't depend on chat input)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      // Open logs panel via icon click
      await page.locator('[data-testid="icon-logs"]').click()

      // Should show resuming state
      await expect(page.locator('[data-testid="panel-logs"]')).toContainText('Resuming...')
    })
  })

  test.describe('No Container State', () => {
    // SPEC: panel-log:no-container
    test('shows "No active session" when no container', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)

      // Navigate to workspace without a session (no containerId)
      await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      // Open logs panel
      await page.keyboard.press('Alt+0')
      await expect(page.locator('[data-testid="panel-logs"]')).toBeVisible()

      await expect(page.locator('[data-testid="panel-logs"]')).toContainText('No active session')
    })
  })
})
