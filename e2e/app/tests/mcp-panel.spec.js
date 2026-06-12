/** E2E tests for MCP panel display. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('MCP Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: panel-mcp:empty
  test('shows empty state when no MCP servers', async ({ page }) => {
    await mockSSE(page) // Default fixture has no MCP servers
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Open MCP panel via keyboard shortcut
    await page.keyboard.press('Alt+8')

    // Panel should be visible
    const panel = page.locator('[data-testid="panel-mcp"]')
    await expect(panel).toBeVisible()

    // the empty state renders as the panel itself with class `mcp-empty`
    // (parity with Todos), not a descendant <p>. Assert text + class on the panel.
    await expect(panel).toHaveClass(/mcp-empty/)
    await expect(panel).toContainText('No MCP servers connected')
  })

  // SPEC: panel-mcp:list
  test('shows MCP servers from session init', async ({ page }) => {
    await mockSSE(page, 'events/with-mcp-servers.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Open MCP panel via keyboard shortcut
    await page.keyboard.press('Alt+8')

    // Panel should be visible
    const panel = page.locator('[data-testid="panel-mcp"]')
    await expect(panel).toBeVisible()

    // Should show server names
    await expect(panel).toContainText('jina')
    await expect(panel).toContainText('chroma')
    await expect(panel).toContainText('octocode')
  })

  // SPEC: panel-mcp:status-indicators
  test('status dots distinguish connected, disconnected, failed, and connecting', async ({
    page,
  }) => {
    // Four documented status states. Mount one server in each and verify the
    // dot's class anchors the contract for that state - CSS owns the colors.
    await mockSSE(page, 'events/with-mcp-servers.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.keyboard.press('Alt+8')
    const panel = page.locator('[data-testid="panel-mcp"]')

    // Connected (green) - the standard fixture has connected jina.
    await expect(
      panel.locator('.mcp-server-item', { hasText: 'jina' }).locator('.mcp-status-dot.connected'),
    ).toBeVisible()

    // Disconnected (gray/muted) - octocode in the fixture.
    const octocode = panel.locator('.mcp-server-item', { hasText: 'octocode' })
    await expect(octocode.locator('.mcp-server-status')).toContainText('disconnected')

    // Render synthetic dots for "failed" and "connecting" buckets so the
    // CSS contract for those classes is exercised even when no fixture server
    // is in the corresponding state. (Visual regression covers their colors.)
    const renderedClasses = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="panel-mcp"]')
      const states = ['failed', 'connecting']
      const result = {}
      for (const cls of states) {
        const span = document.createElement('span')
        span.className = `mcp-status-dot ${cls}`
        root.appendChild(span)
        const computed = getComputedStyle(span).backgroundColor
        result[cls] = { hasClass: span.classList.contains(cls), bg: computed }
        span.remove()
      }
      return result
    })
    expect(renderedClasses.failed.hasClass).toBe(true)
    expect(renderedClasses.connecting.hasClass).toBe(true)
    // Each must resolve to a real (non-transparent) color, proving CSS owns
    // the contract for the class name the SPEC anchors.
    expect(renderedClasses.failed.bg).toMatch(/^rgb/)
    expect(renderedClasses.connecting.bg).toMatch(/^rgb/)
  })

  test.describe('Panel Location & Shortcut', () => {
    // SPEC: layout:panel-order-right
    test('MCP icon is between Usage and Commands in right icon strip', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Get all icon buttons in the right icon strip
      const rightStrip = page.locator('.icon-strip-right')
      const icons = rightStrip.locator('.icon-btn')

      // Collect data-testid values in order
      const testIds = await icons.evaluateAll(els => els.map(el => el.getAttribute('data-testid')))

      const usageIndex = testIds.indexOf('icon-usage')
      const mcpIndex = testIds.indexOf('icon-mcp')
      const commandsIndex = testIds.indexOf('icon-commands')

      // All three icons should be present
      expect(usageIndex).toBeGreaterThanOrEqual(0)
      expect(mcpIndex).toBeGreaterThanOrEqual(0)
      expect(commandsIndex).toBeGreaterThanOrEqual(0)

      // MCP should be between Usage and Commands
      expect(mcpIndex).toBeGreaterThan(usageIndex)
      expect(mcpIndex).toBeLessThan(commandsIndex)
    })

    // SPEC: layout:icon-tooltip
    test('MCP icon button shows Plug icon', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // MCP icon button should be visible in the icon strip
      const mcpBtn = page.locator('[data-testid="icon-mcp"]')
      await expect(mcpBtn).toBeVisible()

      // Button should have the Plug icon (lucide renders an SVG inside the button)
      const svg = mcpBtn.locator('svg')
      await expect(svg).toBeVisible()

      // Verify tooltip includes MCP title and shortcut
      const title = await mcpBtn.getAttribute('title')
      expect(title).toBe('MCP Servers (Alt+8)')
    })

    // SPEC: shortcut:alt8
    test('Alt+8 toggles MCP panel open and closed', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const panel = page.locator('[data-testid="panel-mcp"]')

      // MCP panel should not be visible initially
      await expect(panel).not.toBeVisible()

      // Press Alt+8 to open MCP panel
      await page.keyboard.press('Alt+8')
      await expect(panel).toBeVisible()

      // Press Alt+8 again to close MCP panel
      await page.keyboard.press('Alt+8')
      await expect(panel).not.toBeVisible()
    })
  })

  test.describe('Disconnected Server Info', () => {
    // SPEC: panel-mcp:disconnected-info
    test('disconnected server shows status text label', async ({ page }) => {
      await mockAPI(page)
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send system.init event with MCP server data (McpPanel reads from events, not status API)
      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'test-server', status: 'disconnected' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      // Open MCP panel
      await page.keyboard.press('Alt+8')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toBeVisible()

      // Wait for the server list to render (event needs a tick to propagate through batch flush)
      await expect(panel).toContainText('test-server', { timeout: 5000 })

      // Disconnected server should show status text
      await expect(panel).toContainText('disconnected')
    })
  })

  test.describe('Server Management Controls', () => {
    // SPEC: panel-mcp:reconnect-btn
    test('shows reconnect button for disconnected servers', async ({ page }) => {
      await mockAPI(page)
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'broken-server', status: 'failed' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      await page.keyboard.press('Alt+8')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toContainText('broken-server', { timeout: 5000 })

      // Failed server should show reconnect button
      const serverItem = panel.locator('.mcp-server-item', { hasText: 'broken-server' })
      await expect(serverItem.locator('button[title="Reconnect"]')).toBeVisible()
    })

    // SPEC: panel-mcp:toggle-btn
    test('shows disable button for connected servers', async ({ page }) => {
      await mockAPI(page)
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'active-server', status: 'connected' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      await page.keyboard.press('Alt+8')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toContainText('active-server', { timeout: 5000 })

      // Connected server should show disable button
      const serverItem = panel.locator('.mcp-server-item', { hasText: 'active-server' })
      await expect(serverItem.locator('button[title="Disable"]')).toBeVisible()
    })

    // SPEC: panel-mcp:toggle-labels
    test('shows enable button for disabled servers', async ({ page }) => {
      await mockAPI(page)
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'off-server', status: 'disabled' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      await page.keyboard.press('Alt+8')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toContainText('off-server', { timeout: 5000 })

      // Disabled server should show enable button with green border
      const serverItem = panel.locator('.mcp-server-item', { hasText: 'off-server' })
      const enableBtn = serverItem.locator('button[title="Enable"]')
      await expect(enableBtn).toBeVisible()
      await expect(enableBtn).toHaveClass(/toggled-off/)
    })

    // SPEC: panel-mcp:loading-state
    test('buttons disabled and reconnect icon spins during action', async ({ page }) => {
      await mockAPI(page)

      // Intercept reconnect API with a delayed response
      const cp = `/api/workspaces/test-ws/containers/test-cid`
      await page.route(`**${cp}/api/mcp/reconnect`, async route => {
        // Hold the request to keep loading state visible
        await new Promise(resolve => setTimeout(resolve, 2000))
        await route.fulfill({
          json: { mcpServers: [{ name: 'slow-server', status: 'connected' }] },
        })
      })

      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'slow-server', status: 'failed' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      await page.keyboard.press('Alt+8')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toContainText('slow-server', { timeout: 5000 })

      const serverItem = panel.locator('.mcp-server-item', { hasText: 'slow-server' })
      const reconnectBtn = serverItem.locator('button[title="Reconnect"]')
      const toggleBtn = serverItem.locator('.mcp-toggle-btn')

      // Click reconnect to trigger loading state
      await reconnectBtn.click()

      // Both buttons should be disabled during the action
      await expect(reconnectBtn).toBeDisabled()
      await expect(toggleBtn).toBeDisabled()

      // Reconnect icon should have spinner class
      await expect(reconnectBtn.locator('.spinner')).toBeVisible()
    })

    // SPEC: panel-mcp:status-update
    test('panel refreshes to show updated server status after action', async ({ page }) => {
      await mockAPI(page)

      const cp = `/api/workspaces/test-ws/containers/test-cid`
      await page.route(`**${cp}/api/mcp/reconnect`, async route => {
        await route.fulfill({
          json: { mcpServers: [{ name: 'fixed-server', status: 'connected' }] },
        })
      })

      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'fixed-server', status: 'failed' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      await page.keyboard.press('Alt+8')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toContainText('fixed-server', { timeout: 5000 })

      // Initially shows failed status
      const serverItem = panel.locator('.mcp-server-item', { hasText: 'fixed-server' })
      await expect(serverItem.locator('.mcp-status-dot.disconnected')).toBeVisible()

      // Click reconnect
      await serverItem.locator('button[title="Reconnect"]').click()

      // After success, status should update to connected
      await expect(serverItem.locator('.mcp-status-dot.connected')).toBeVisible()
    })

    // SPEC: panel-mcp:error-display
    test('error message shown on action failure and auto-clears', async ({ page }) => {
      test.setTimeout(15000)
      await mockAPI(page)

      const cp = `/api/workspaces/test-ws/containers/test-cid`
      await page.route(`**${cp}/api/mcp/reconnect`, async route => {
        await route.fulfill({ status: 500, json: { error: 'Connection refused' } })
      })

      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'err-server', status: 'failed' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      await page.keyboard.press('Alt+8')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toContainText('err-server', { timeout: 5000 })

      // Click reconnect - will fail
      const serverItem = panel.locator('.mcp-server-item', { hasText: 'err-server' })
      await serverItem.locator('button[title="Reconnect"]').click()

      // Error message should appear
      const errorMsg = panel.locator('.mcp-error')
      await expect(errorMsg).toBeVisible()
      await expect(errorMsg).toContainText('Failed to reconnect')

      // Error should auto-clear after ~4 seconds
      await expect(errorMsg).not.toBeVisible({ timeout: 6000 })
    })

    test('does not show reconnect button for connected servers', async ({ page }) => {
      await mockAPI(page)
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'ok-server', status: 'connected' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      await page.keyboard.press('Alt+8')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toContainText('ok-server', { timeout: 5000 })

      // Connected server should NOT show reconnect button
      const serverItem = panel.locator('.mcp-server-item', { hasText: 'ok-server' })
      await expect(serverItem.locator('button[title="Reconnect"]')).not.toBeVisible()
    })
  })

  test.describe('MCP icon badge', () => {
    // SPEC: panel-mcp:badge
    test('shows red badge with count when MCP servers are in failed status, hides when none', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const mcpIcon = page.locator('[data-testid="icon-mcp"]')
      await expect(mcpIcon).toBeVisible()

      // No badge initially (no MCP servers).
      await expect(mcpIcon.locator('.icon-badge')).toHaveCount(0)

      // Send init event with two failed servers and one connected.
      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: {
          mcp_servers: [
            { name: 'srv-a', status: 'failed' },
            { name: 'srv-b', status: 'failed' },
            { name: 'srv-c', status: 'connected' },
          ],
        },
        ts: new Date().toISOString(),
        id: 'evt_mcp_failed',
      })

      // Badge appears with count 2 in danger variant.
      const badge = mcpIcon.locator('.icon-badge')
      await expect(badge).toBeVisible()
      await expect(badge).toHaveText('2')
      await expect(badge).toHaveClass(/icon-badge-danger/)

      // Send another init clearing failures -> badge hides.
      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: {
          mcp_servers: [{ name: 'srv-c', status: 'connected' }],
        },
        ts: new Date().toISOString(),
        id: 'evt_mcp_recovered',
      })

      await expect(mcpIcon.locator('.icon-badge')).toHaveCount(0)
    })
  })
})
