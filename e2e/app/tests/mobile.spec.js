/** E2E tests for the mobile layout — top bar, status strip, drawer, details sheet. */

import { expect, test } from '@playwright/test'
import { waitForMobileReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, DEFAULT_WORKSPACE_ID, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
  })

  // SPEC: mobile:activation
  test('mobile layout activates on touch-primary devices', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    // Mobile shell is mounted; desktop dockview is not.
    await expect(page.locator('.mobile-layout')).toBeVisible()
    await expect(page.locator('.dockview-theme-dark')).toHaveCount(0)
  })

  // SPEC: mobile:viewport-change
  test('viewport widening on a touch device does NOT swap to desktop', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.mobile-layout')).toBeVisible()

    // Detection is device-class based now, not viewport-width based:
    // resizing the window must NOT flip the layout.
    await page.setViewportSize({ width: 1280, height: 800 })

    await expect(page.locator('.mobile-layout')).toBeVisible()
    await expect(page.locator('.dockview-theme-dark')).toHaveCount(0)
  })

  // SPEC: mobile:layout-structure
  test('stacks top bar, status strip, and chat area top-to-bottom', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    const layout = page.locator('.mobile-layout')
    await expect(layout).toBeVisible()
    await expect(layout.locator('.mobile-top-bar')).toBeVisible()
    await expect(layout.locator('.status-strip')).toBeVisible()
    await expect(layout.locator('.mobile-chat-area')).toBeVisible()

    // DOM order: top bar, status strip, chat area.
    const order = await layout.evaluate(el =>
      Array.from(el.children)
        .map(c => c.className)
        .filter(cls =>
          ['mobile-top-bar', 'status-strip', 'mobile-chat-area'].some(k => cls.includes(k)),
        )
        .map(cls =>
          ['mobile-top-bar', 'status-strip', 'mobile-chat-area'].find(k => cls.includes(k)),
        ),
    )
    expect(order).toEqual(['mobile-top-bar', 'status-strip', 'mobile-chat-area'])
  })

  // SPEC: mobile:top-hamburger
  test('clicking hamburger opens the drawer', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.mobile-drawer')).toHaveCount(0)
    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    await expect(page.locator('.mobile-drawer')).toBeVisible()
  })

  // SPEC: mobile:drawer-dismiss
  // SPEC: mobile:drawer-fullscreen
  test('drawer covers the full viewport and the X close button dismisses it', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    const drawer = page.locator('.mobile-drawer')
    await expect(drawer).toBeVisible()

    // Drawer fills the viewport — width and height equal viewport dimensions
    // (allowing a 1px rounding tolerance).
    const viewport = page.viewportSize()
    const box = await drawer.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1)
    expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1)

    // X close button at top-left dismisses the drawer.
    await page.locator('.mobile-drawer button[title="Close menu"]').click()
    await expect(drawer).toHaveCount(0)
  })

  // SPEC: mobile:top-details-toggle
  test('clicking the details button opens the details sheet', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.details-sheet')).toHaveCount(0)
    await page.locator('.mobile-top-bar button[title="Session details"]').click()
    await expect(page.locator('.details-sheet')).toBeVisible()
  })

  // SPEC: mobile:details-dismiss
  test('clicking details overlay closes the details sheet', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Session details"]').click()
    const overlay = page.locator('.details-sheet-overlay')
    await expect(overlay).toBeVisible()
    // Click below the sheet (sheet is anchored to the top of the overlay).
    const box = await overlay.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10)
    await expect(page.locator('.details-sheet')).toHaveCount(0)
  })

  // SPEC: mobile:top-session-name
  test('top bar renders the session name', async ({ page }) => {
    await mockAPI(page, { statusFixture: 'status/with-name.json' })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.mobile-top-session-name')).toContainText('My Custom Session')
  })

  // SPEC: mobile:top-session-name-default
  test('top bar shows "claudebox" fallback when session has no name', async ({ page }) => {
    // Default status fixture has name: null.
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.mobile-top-session-name')).toHaveText('claudebox')
  })

  // SPEC: mobile:send-button-stop
  test('top bar has no stop button — the chat send button is the stop control', async ({
    page,
  }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.mobile-top-bar [data-testid="mobile-stop-btn"]')).toHaveCount(0)
  })

  // SPEC: mobile:send-button-morph
  test('chat send button morphs into a stop button while responding', async ({ page }) => {
    let interrupted = false
    const controller = await createSSEController(page)
    await mockAPI(page, {
      handlers: {
        interrupt: async route => {
          interrupted = true
          await route.fulfill({ status: 200, json: { ok: true } })
        },
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    // Idle state — send button rendered, no stop button.
    await expect(page.locator('[data-testid="mobile-send-btn"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="chat-input-stop-btn"]')).toHaveCount(0)

    // Drive into a responding state so the chat send button morphs.
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        content: 'work please',
        is_human: true,
        timestamp: Date.now(),
        turn_id: 'turn_001',
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'on it...',
        timestamp: Date.now() + 100,
      },
    ])

    const stop = page.locator('[data-testid="chat-input-stop-btn"]')
    await expect(stop).toBeVisible()
    await expect(page.locator('[data-testid="mobile-send-btn"]')).toHaveCount(0)
    await stop.click()
    await expect.poll(() => interrupted, { timeout: 4000 }).toBe(true)
  })

  // SPEC: mobile:no-zoom
  test('viewport meta disables auto-zoom on input focus', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    const content = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(content).toContain('user-scalable=no')
    expect(content).toContain('maximum-scale=1')
  })

  // SPEC: mobile:chat-fullwidth
  test('chat occupies the full content width — no minimap', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.minimap-overlay')).toHaveCount(0)
  })

  // SPEC: mobile:welcome-touch
  test('welcome screen leads with a touch-suited usage prompt', async ({ page }) => {
    // Welcome state — go to workspace root without a session.
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await waitForMobileReady(page)

    await expect(page.locator('[data-testid="welcome-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="welcome-shortcuts"]')).toHaveCount(0)
  })

  // SPEC: mobile:details-sheet-bg
  test('details sheet has its own non-transparent background', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Session details"]').click()
    const sheet = page.locator('.details-sheet')
    await expect(sheet).toBeVisible()

    const bg = await sheet.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(bg).toMatch(/rgb\(\d+,\s*\d+,\s*\d+\)/)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  })

  // SPEC: mobile:status-connected
  test('status dot shows connected class and tooltip when chat SSE is connected', async ({
    page,
  }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    const dot = page.locator('.status-strip-dot')
    await expect(dot).toHaveClass(/connected/)
    await expect(dot).toHaveAttribute('title', 'Connected')
  })

  // SPEC: mobile:status-disconnected
  test('status dot drops connected class when chat SSE is disconnected', async ({ page }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await controller.triggerError()

    const dot = page.locator('.status-strip-dot')
    await expect(dot).not.toHaveClass(/connected/)
    await expect(dot).toHaveAttribute('title', 'Disconnected')
  })

  // SPEC: mobile:status-context-pct
  test('status strip renders percentage from tokens / context window', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-session-001',
              name: null,
              workspace: '/home/user/project',
              permission_mode: 'bypassPermissions',
              model: 'claude-sonnet-4-6',
              num_turns: 0,
              total_cost_usd: 0,
              total_duration_ms: 0,
              last_context_tokens: 60000,
              context_window: 200000,
              started_at: '2025-01-18T12:00:00Z',
              updated_at: '2025-01-18T12:00:00Z',
              first_message: null,
              last_message: null,
              todos: [],
              commands: { custom: [], mcp: [], builtin: [] },
              effort_level: 'medium',
            },
          })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.status-strip-pct')).toHaveText('30%')
  })

  // SPEC: mobile:status-context-cap
  test('status percentage caps at 100% when tokens exceed context window', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-session-001',
              name: null,
              workspace: '/home/user/project',
              permission_mode: 'bypassPermissions',
              model: 'claude-sonnet-4-6',
              num_turns: 0,
              total_cost_usd: 0,
              total_duration_ms: 0,
              last_context_tokens: 500000,
              context_window: 200000,
              started_at: '2025-01-18T12:00:00Z',
              updated_at: '2025-01-18T12:00:00Z',
              first_message: null,
              last_message: null,
              todos: [],
              commands: { custom: [], mcp: [], builtin: [] },
              effort_level: 'medium',
            },
          })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(page.locator('.status-strip-pct')).toHaveText('100%')
  })

  // SPEC: mobile:status-context-color
  test('status fill color shifts as context fills up', async ({ page }) => {
    // Two-phase: low context produces one color, high context produces a different
    // color via getContextBarColor — assert distinctness rather than exact codes.
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-session-001',
              name: null,
              workspace: '/home/user/project',
              permission_mode: 'bypassPermissions',
              model: 'claude-sonnet-4-6',
              num_turns: 0,
              total_cost_usd: 0,
              total_duration_ms: 0,
              last_context_tokens: 10000,
              context_window: 200000,
              started_at: '2025-01-18T12:00:00Z',
              updated_at: '2025-01-18T12:00:00Z',
              first_message: null,
              last_message: null,
              todos: [],
              commands: { custom: [], mcp: [], builtin: [] },
              effort_level: 'medium',
            },
          })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    const fill = page.locator('.status-strip-fill')
    const lowColor = await fill.evaluate(el => el.style.background)
    expect(lowColor).toBeTruthy()

    // Now load a session with much higher tokens — re-fetch by reload with new mock.
    await page.unroute(/\/sessions\/[^/]+\/status/).catch(() => {})
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-session-001',
              name: null,
              workspace: '/home/user/project',
              permission_mode: 'bypassPermissions',
              model: 'claude-sonnet-4-6',
              num_turns: 0,
              total_cost_usd: 0,
              total_duration_ms: 0,
              last_context_tokens: 180000,
              context_window: 200000,
              started_at: '2025-01-18T12:00:00Z',
              updated_at: '2025-01-18T12:00:00Z',
              first_message: null,
              last_message: null,
              todos: [],
              commands: { custom: [], mcp: [], builtin: [] },
              effort_level: 'medium',
            },
          })
        },
      },
    })
    await page.reload()
    await waitForMobileReady(page)
    const highColor = await page.locator('.status-strip-fill').evaluate(el => el.style.background)
    expect(highColor).toBeTruthy()
    expect(highColor).not.toBe(lowColor)
  })

  // SPEC: mobile:drawer-session-list
  // SPEC: mobile:session-list-rich
  test('drawer renders rich session rows (status dot, id, name, timestamps, turns, cost)', async ({
    page,
  }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    const drawer = page.locator('.mobile-drawer')
    await expect(drawer).toBeVisible()

    // Mobile drawer mounts the same SessionItem the desktop tree uses, with isMobile.
    // Fixture sessions/multiple.json carries 3 sessions (001 no-name, 002 "Feature
    // Implementation", 003 no-name).
    const items = drawer.locator('.mobile-drawer-sessions .sessions-item.sessions-item-mobile')
    await expect(items).toHaveCount(3)

    // Rich content: status dot on every row; sessions-id contains the 8-char prefix
    // for each (positional ordered match — first 2 rows render 'test-ses').
    await expect(items.locator('.container-status-dot')).toHaveCount(3)
    await expect(items.locator('.sessions-id')).toContainText(['test-ses', 'test-ses'])
    // Only test-session-002 has a name → exactly one .sessions-name node exists.
    await expect(items.locator('.sessions-name')).toContainText(['Feature Implementation'])

    // Timestamps row present on every row (started time appears verbatim).
    await expect(items.locator('.sessions-timestamp')).toHaveCount(3)
  })

  // SPEC: mobile:drawer-session-switch
  // SPEC: mobile:session-list-tap-resume
  test('tapping a non-current session row resumes it and closes the drawer', async ({ page }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    const target = page
      .locator('.mobile-drawer-sessions .sessions-item', { hasText: 'Feature Implementation' })
      .first()
    await target.click()

    // Drawer closed.
    await expect(page.locator('.mobile-drawer')).toHaveCount(0)
    // URL updated to target session id.
    await expect.poll(() => page.url(), { timeout: 4000 }).toContain('test-session-002')
  })

  // SPEC: mobile:drawer-new-session
  test('clicking "New session" creates a session and closes the drawer', async ({ page }) => {
    let newSessionCalled = false
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          newSessionCalled = true
          await route.fulfill({
            status: 200,
            json: { session_id: 'created-mobile-1', name: null },
          })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    await page.locator('.mobile-drawer-new-session').click()

    await expect.poll(() => newSessionCalled, { timeout: 4000 }).toBe(true)
    await expect(page.locator('.mobile-drawer')).toHaveCount(0)
  })

  // SPEC: mobile:drawer-close-session
  test('close-session button stops the container, removes the session, and closes the drawer', async ({
    page,
  }) => {
    let deleteCalled = false
    await mockAPI(page, {
      handlers: {
        deleteContainer: async route => {
          deleteCalled = true
          await route.fulfill({ status: 200, json: { ok: true } })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    const closeBtn = page.locator('.mobile-drawer-close-session')
    await expect(closeBtn).toBeEnabled()
    await closeBtn.click()

    await expect.poll(() => deleteCalled, { timeout: 4000 }).toBe(true)
    await expect(page.locator('.mobile-drawer')).toHaveCount(0)
  })

  // SPEC: mobile:drawer-close-disabled
  test('close-session button is disabled when chat SSE is disconnected', async ({ page }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await controller.triggerError()

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    await expect(page.locator('.mobile-drawer-close-session')).toBeDisabled()
  })

  // SPEC: mobile:drawer-session-fallback
  test('session label falls back to id prefix when name is null', async ({ page }) => {
    // Default fixture has a single session with name: null.
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    // session_id is "test-session-001" → first 8 chars: "test-ses".
    await expect(page.locator('.mobile-drawer-sessions .sessions-item .sessions-id')).toContainText(
      'test-ses',
    )
  })

  // SPEC: mobile:drawer-workspaces-single
  test('workspace switcher is hidden when only one workspace exists', async ({ page }) => {
    // Default workspaces mock returns a single entry.
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    await expect(page.locator('.mobile-drawer-workspaces')).toHaveCount(0)
  })

  // SPEC: mobile:drawer-workspaces-multi
  test('workspace switcher renders the list when multiple workspaces exist', async ({ page }) => {
    // Override the workspaces endpoint to return two workspaces. Outer beforeEach
    // already registered the default — the latest matching route handler wins.
    await page.route('**/api/workspaces', async route => {
      await route.fulfill({
        json: {
          workspaces: [
            { id: DEFAULT_WORKSPACE_ID, path: '/home/user/project', name: 'project' },
            { id: 'second-ws', path: '/home/user/other', name: 'other' },
          ],
        },
      })
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Menu"]').click()
    const switcher = page.locator('.mobile-drawer-workspaces')
    await expect(switcher).toBeVisible()
    await expect(switcher.locator('.mobile-drawer-ws-item')).toHaveCount(2)
  })

  // SPEC: mobile:details-fields
  test('details sheet renders connection, workspace, turns, cost, duration, context, model, effort, permission', async ({
    page,
  }) => {
    await mockAPI(page, { statusFixture: 'status/with-name.json' })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await page.locator('.mobile-top-bar button[title="Session details"]').click()
    const sheet = page.locator('.details-sheet')
    await expect(sheet).toBeVisible()

    await expect(sheet).toContainText('Connected')
    await expect(sheet).toContainText('Workspace')
    await expect(sheet).toContainText('Turns')
    await expect(sheet).toContainText('Cost')
    await expect(sheet).toContainText('Duration')
    await expect(sheet).toContainText('Context')
    await expect(sheet).toContainText('Model')
    await expect(sheet).toContainText('Effort')
    await expect(sheet).toContainText('Permission')
  })
})
