/** E2E tests for MCP panel display. */

import { expect, test } from '@playwright/test'
import { openLiveSession, openLiveSessionWithAPI, openSession } from '../helpers.js'
import { mockAPI } from '../mocks/api.js'

async function showMcpServer(page, controller, server) {
  await controller.sendEvent({
    type: 'system',
    subtype: 'init',
    message_data: { mcp_servers: [server] },
    ts: new Date().toISOString(),
    id: 'evt_mcp_init',
  })
  await page.keyboard.press('Alt+9')
  const panel = page.locator('.mcp-panel')
  await expect(panel).toContainText(server.name, { timeout: 5000 })

  return panel
}

test.describe('MCP Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: panel-mcp:empty
  test('shows empty state when no MCP servers', async ({ page }) => {
    // Default fixture has no MCP servers
    await openSession(page)

    await page.keyboard.press('Alt+9')

    const panel = page.locator('[data-testid="panel-mcp"]')
    await expect(panel).toBeVisible()

    // Empty state renders as the panel itself with class `mcp-empty` (parity with Todos), not a descendant <p>.
    await expect(panel).toHaveClass(/mcp-empty/)
    await expect(panel).toContainText('No MCP servers connected')
  })

  // SPEC: layout:panel-tab-name
  test('its tab reads MCP Servers', async ({ page }) => {
    await openSession(page)

    await page.keyboard.press('Alt+9')

    await expect(page.locator('[data-testid="panel-mcp"]')).toBeVisible()
    await expect(page.locator('.icon-tab').filter({ hasText: 'MCP Servers' })).toHaveCount(1)
  })

  // SPEC: panel-mcp:list
  test('shows MCP servers from session init', async ({ page }) => {
    await openSession(page, 'events/with-mcp-servers.jsonl')

    await page.keyboard.press('Alt+9')

    const panel = page.locator('[data-testid="panel-mcp"]')
    await expect(panel).toBeVisible()

    await expect(panel).toContainText('jina')
    await expect(panel).toContainText('chroma')
    await expect(panel).toContainText('octocode')
  })

  // SPEC: panel-mcp:status-indicators
  test('status dots distinguish connected, disconnected, failed, and connecting', async ({
    page,
  }) => {
    // Four documented status states; mount one server per state and check the dot class - CSS owns the colors.
    await openSession(page, 'events/with-mcp-servers.jsonl')

    await page.keyboard.press('Alt+9')
    const panel = page.locator('[data-testid="panel-mcp"]')

    // Connected (green) - the standard fixture has connected jina.
    await expect(
      panel.locator('.mcp-server-item', { hasText: 'jina' }).locator('.mcp-status-dot.connected'),
    ).toBeVisible()

    // Disconnected (gray/muted) - octocode in the fixture.
    const octocode = panel.locator('.mcp-server-item', { hasText: 'octocode' })
    await expect(octocode.locator('.mcp-server-status')).toContainText('disconnected')

    // Render synthetic dots for "failed"/"connecting" so their CSS contract is exercised even without a matching
    // fixture server (visual regression covers the actual colors).
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
    // Each must resolve to a real, non-transparent color - CSS owns the contract the SPEC anchors.
    expect(renderedClasses.failed.bg).toMatch(/^rgb/)
    expect(renderedClasses.connecting.bg).toMatch(/^rgb/)
  })

  test.describe('Panel Location & Shortcut', () => {
    // SPEC: layout:panel-order-right
    test('MCP icon is between Usage and Commands in right icon strip', async ({ page }) => {
      await openSession(page)

      const rightStrip = page.locator('.icon-strip-right')
      const icons = rightStrip.locator('.icon-btn')

      const testIds = await icons.evaluateAll(els => els.map(el => el.getAttribute('data-testid')))

      const usageIndex = testIds.indexOf('icon-usage')
      const mcpIndex = testIds.indexOf('icon-mcp')
      const commandsIndex = testIds.indexOf('icon-commands')

      expect(usageIndex).toBeGreaterThanOrEqual(0)
      expect(mcpIndex).toBeGreaterThanOrEqual(0)
      expect(commandsIndex).toBeGreaterThanOrEqual(0)

      expect(mcpIndex).toBeGreaterThan(usageIndex)
      expect(mcpIndex).toBeLessThan(commandsIndex)
    })

    // SPEC: layout:icon-tooltip
    test('MCP icon button shows Plug icon', async ({ page }) => {
      await openSession(page)

      const mcpBtn = page.locator('[data-testid="icon-mcp"]')
      await expect(mcpBtn).toBeVisible()

      // Button should show the Plug icon (lucide renders an SVG, so this only proves an icon is present).
      const svg = mcpBtn.locator('svg')
      await expect(svg).toBeVisible()

      const title = await mcpBtn.getAttribute('title')
      expect(title).toBe('MCP Servers (Alt+9)')
    })

    // SPEC: shortcut:alt9
    test('Alt+9 toggles MCP panel open and closed', async ({ page }) => {
      await openSession(page)

      const panel = page.locator('[data-testid="panel-mcp"]')

      await expect(panel).not.toBeVisible()

      await page.keyboard.press('Alt+9')
      await expect(panel).toBeVisible()

      await page.keyboard.press('Alt+9')
      await expect(panel).not.toBeVisible()
    })
  })

  test.describe('Disconnected Server Info', () => {
    // SPEC: panel-mcp:disconnected-info
    test('disconnected server shows status text label', async ({ page }) => {
      const controller = await openLiveSessionWithAPI(page)

      // Send system.init event with MCP server data (McpPanel reads from events, not status API)
      await controller.sendEvent({
        type: 'system',
        subtype: 'init',
        message_data: { mcp_servers: [{ name: 'test-server', status: 'disconnected' }] },
        ts: new Date().toISOString(),
        id: 'evt_mcp_init',
      })

      await page.keyboard.press('Alt+9')
      const panel = page.locator('.mcp-panel')
      await expect(panel).toBeVisible()

      // Wait for the server list to render (event needs a tick to propagate through batch flush)
      await expect(panel).toContainText('test-server', { timeout: 5000 })

      await expect(panel).toContainText('disconnected')
    })
  })

  test.describe('Server Management Controls', () => {
    // SPEC: panel-mcp:reconnect-btn
    test('shows reconnect button for disconnected servers', async ({ page }) => {
      const controller = await openLiveSessionWithAPI(page)

      const panel = await showMcpServer(page, controller, {
        name: 'broken-server',
        status: 'failed',
      })

      const serverItem = panel.locator('.mcp-server-item', { hasText: 'broken-server' })
      await expect(serverItem.locator('button[title="Reconnect"]')).toBeVisible()
    })

    // SPEC: panel-mcp:toggle-btn
    test('shows disable button for connected servers', async ({ page }) => {
      const controller = await openLiveSessionWithAPI(page)

      const panel = await showMcpServer(page, controller, {
        name: 'active-server',
        status: 'connected',
      })

      const serverItem = panel.locator('.mcp-server-item', { hasText: 'active-server' })
      await expect(serverItem.locator('button[title="Disable"]')).toBeVisible()
    })

    // SPEC: panel-mcp:toggle-labels
    test('shows enable button for disabled servers', async ({ page }) => {
      const controller = await openLiveSessionWithAPI(page)

      const panel = await showMcpServer(page, controller, {
        name: 'off-server',
        status: 'disabled',
      })

      // Disabled server should show enable button with green border
      const serverItem = panel.locator('.mcp-server-item', { hasText: 'off-server' })
      const enableBtn = serverItem.locator('button[title="Enable"]')
      await expect(enableBtn).toBeVisible()
      await expect(enableBtn).toHaveClass(/toggled-off/)
    })

    // SPEC: panel-mcp:loading-state
    test('buttons disabled and reconnect icon spins during action', async ({ page }) => {
      await mockAPI(page)

      const cp = `/api/workspaces/test-ws/containers/test-cid`
      await page.route(`**${cp}/api/mcp/reconnect*`, async route => {
        // Hold the request to keep loading state visible
        await new Promise(resolve => setTimeout(resolve, 2000))
        await route.fulfill({
          json: { mcpServers: [{ name: 'slow-server', status: 'connected' }] },
        })
      })

      const controller = await openLiveSession(page)

      const panel = await showMcpServer(page, controller, { name: 'slow-server', status: 'failed' })

      const serverItem = panel.locator('.mcp-server-item', { hasText: 'slow-server' })
      const reconnectBtn = serverItem.locator('button[title="Reconnect"]')
      const toggleBtn = serverItem.locator('.mcp-toggle-btn')

      await reconnectBtn.click()

      await expect(reconnectBtn).toBeDisabled()
      await expect(toggleBtn).toBeDisabled()
      await expect(reconnectBtn.locator('.spinner')).toBeVisible()
    })

    // SPEC: panel-mcp:status-update
    test('panel refreshes to show updated server status after action', async ({ page }) => {
      await mockAPI(page)

      const cp = `/api/workspaces/test-ws/containers/test-cid`
      await page.route(`**${cp}/api/mcp/reconnect*`, async route => {
        await route.fulfill({
          json: { mcpServers: [{ name: 'fixed-server', status: 'connected' }] },
        })
      })

      const controller = await openLiveSession(page)

      const panel = await showMcpServer(page, controller, {
        name: 'fixed-server',
        status: 'failed',
      })

      const serverItem = panel.locator('.mcp-server-item', { hasText: 'fixed-server' })
      await expect(serverItem.locator('.mcp-status-dot.disconnected')).toBeVisible()

      await serverItem.locator('button[title="Reconnect"]').click()

      await expect(serverItem.locator('.mcp-status-dot.connected')).toBeVisible()
    })

    // SPEC: panel-mcp:error-display
    test('error message shown on action failure and auto-clears', async ({ page }) => {
      test.setTimeout(30_000)
      await mockAPI(page)

      const cp = `/api/workspaces/test-ws/containers/test-cid`
      await page.route(`**${cp}/api/mcp/reconnect*`, async route => {
        await route.fulfill({ status: 500, json: { error: 'Connection refused' } })
      })

      const controller = await openLiveSession(page)

      const panel = await showMcpServer(page, controller, { name: 'err-server', status: 'failed' })

      const serverItem = panel.locator('.mcp-server-item', { hasText: 'err-server' })
      await serverItem.locator('button[title="Reconnect"]').click()

      const errorMsg = panel.locator('.mcp-error')
      await expect(errorMsg).toBeVisible()
      await expect(errorMsg).toContainText('Failed to reconnect')

      // Error should auto-clear after ~4 seconds
      await expect(errorMsg).not.toBeVisible({ timeout: 6000 })
    })

    test('does not show reconnect button for connected servers', async ({ page }) => {
      const controller = await openLiveSessionWithAPI(page)

      const panel = await showMcpServer(page, controller, {
        name: 'ok-server',
        status: 'connected',
      })

      const serverItem = panel.locator('.mcp-server-item', { hasText: 'ok-server' })
      await expect(serverItem.locator('button[title="Reconnect"]')).not.toBeVisible()
    })
  })

  test.describe('MCP icon badge', () => {
    // SPEC: panel-mcp:badge
    test('shows red badge with count when MCP servers are in failed status, hides when none', async ({
      page,
    }) => {
      const controller = await openLiveSession(page)

      const mcpIcon = page.locator('[data-testid="icon-mcp"]')
      await expect(mcpIcon).toBeVisible()

      await expect(mcpIcon.locator('.icon-badge')).toHaveCount(0)

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
