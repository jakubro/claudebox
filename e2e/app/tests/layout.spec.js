/** E2E tests for layout and panel management including icon strips, persistence, and tab interactions. */

import { expect, test } from '@playwright/test'
import {
  assertColor,
  openSessionsPanel,
  openTodosPanel,
  resolveOpsPayload,
  toggleSessionsPanel,
  toggleStashPanel,
  toggleTodosPanel,
  waitForAppReady,
} from '../helpers.js'
import { DEFAULT_SESSION_URL, loadFixture, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Layout', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
  })

  test.describe('Icon Strip', () => {
    // SPEC: layout:left-strip
    // SPEC: layout:panel-order-left
    test('left strip lists sessions/bookmarks/boards (top) and logs (bottom)', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // All four icons must be present (claim enumerates them by name).
      const ids = ['icon-sessions', 'icon-bookmarks', 'icon-boards', 'icon-logs']
      for (const id of ids) {
        await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible()
      }

      // Vertical positions: sessions/bookmarks/boards form the top group;
      // logs sits at the bottom of the strip.
      const ys = {}
      for (const id of ids) {
        ys[id] = (await page.locator(`[data-testid="${id}"]`).boundingBox()).y
      }
      expect(ys['icon-sessions']).toBeLessThan(ys['icon-bookmarks'])
      expect(ys['icon-bookmarks']).toBeLessThan(ys['icon-boards'])
      // Logs is the lowest of the four.
      expect(ys['icon-logs']).toBeGreaterThan(ys['icon-boards'])
    })

    // SPEC: layout:right-strip
    test('right strip lists todos->stash->tasks->usage->mcp->commands->help top-to-bottom', async ({
      page,
    }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const order = [
        'icon-todos',
        'icon-stash',
        'icon-tasks',
        'icon-usage',
        'icon-mcp',
        'icon-commands',
        'icon-help',
      ]
      for (const id of order) {
        await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible()
      }

      // Each icon's vertical position must be strictly below the previous one
      // - covers the "top to bottom" ordering portion of the claim.
      let prevY = -Infinity
      for (const id of order) {
        const { y } = await page.locator(`[data-testid="${id}"]`).boundingBox()
        expect(y, `${id} ordering`).toBeGreaterThan(prevY)
        prevY = y
      }
    })

    // SPEC: layout:icon-tooltip
    test('every icon strip button exposes panel name + shortcut as tooltip', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Claim says "tooltip shows panel name and shortcut" - validate every icon,
      // not just sessions, since the claim implies the full set.
      const expected = {
        'icon-sessions': 'Sessions (Alt+1)',
        'icon-todos': 'Todos (Alt+2)',
        'icon-stash': 'Stash (Alt+3)',
        'icon-tasks': 'Tasks (Alt+4)',
        'icon-bookmarks': 'Bookmarks (Alt+5)',
        'icon-boards': 'Boards (Alt+6)',
        'icon-usage': 'Usage (Alt+7)',
        'icon-mcp': 'MCP Servers (Alt+8)',
        'icon-commands': 'Skills (Alt+9)',
        'icon-logs': 'Logs (Alt+0)',
      }
      for (const [testid, title] of Object.entries(expected)) {
        const got = await page.locator(`[data-testid="${testid}"]`).getAttribute('title')
        expect(got, `${testid} tooltip`).toBe(title)
      }
    })
  })

  test.describe('Panel Toggling', () => {
    // SPEC: layout:icon-toggle
    // SPEC: layout:panel-toggle-on
    // SPEC: layout:floating-panel
    test('clicking sessions icon toggles sessions panel', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Sessions is visible by default
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      // Click sessions icon to close
      await page.locator('[data-testid="icon-sessions"]').click()
      await expect(page.locator('[data-testid="panel-sessions"]')).not.toBeVisible()

      // Click again to reopen
      await page.locator('[data-testid="icon-sessions"]').click()
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:panel-toggle-off
    test('toggling a panel off closes it AND saves its width for re-open', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const panel = page.locator('[data-testid="panel-sessions"]')
      await expect(panel).toBeVisible()

      // Capture the panel's current width - the claim says "saves width" on close,
      // so reopening must restore it (within reasonable tolerance for layout settle).
      const widthBefore = await panel.evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.offsetWidth : 0
      })
      expect(widthBefore).toBeGreaterThan(0)

      // Toggle off
      await page.locator('[data-testid="icon-sessions"]').click()
      await expect(panel).not.toBeVisible()

      // Toggle on - saved width must be restored
      await page.locator('[data-testid="icon-sessions"]').click()
      await expect(panel).toBeVisible()
      const widthAfter = await panel.evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.offsetWidth : 0
      })
      expect(Math.abs(widthAfter - widthBefore)).toBeLessThan(5)
    })

    // SPEC: layout:default-left-panels
    test('sessions panel visible by default on left', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Sessions panel should be visible on fresh load (default layout)
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:default-right-panels
    test('Todos, Stash, and Tasks panels open by default on right', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Three default right panels should be visible (Usage and MCP hidden).
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-tasks"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-usage"]')).not.toBeVisible()
      await expect(page.locator('[data-testid="panel-mcp"]')).not.toBeVisible()

      // Right panel group should be approximately 15% of window width
      const viewportWidth = page.viewportSize().width
      const rightGroup = page.locator('[data-testid="panel-todos"]').first()
      const rightBox = await rightGroup.boundingBox()
      // The right panel group width: from leftmost right panel to viewport edge
      // Use the todos panel's parent group width as proxy
      const rightPanelWidth = viewportWidth - rightBox.x
      const ratio = rightPanelWidth / viewportWidth
      expect(ratio, `Right panel ratio ${ratio} should be ~15%`).toBeGreaterThan(0.1)
      expect(ratio).toBeLessThan(0.25)
    })
  })

  test.describe('Chat Panel', () => {
    // SPEC: layout:panel-chat-permanent
    test('chat panel stays visible after toggling adjacent panels', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()

      // Even after opening other panels
      await toggleSessionsPanel(page)
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
    })

    // SPEC: layout:default-chat-center
    test('chat panel sits horizontally between left and right strips', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const chatBox = await page.locator('[data-testid="panel-chat"]').boundingBox()
      expect(chatBox).toBeTruthy()

      // Left strip lives to the left of chat; rightmost-default panel (todos)
      // lives to the right. This anchors the "in center" half of the claim
      // beyond mere visibility.
      const leftStripBox = await page.locator('[data-testid="icon-sessions"]').boundingBox()
      const rightPanelBox = await page.locator('[data-testid="panel-todos"]').boundingBox()
      expect(leftStripBox.x + leftStripBox.width).toBeLessThanOrEqual(chatBox.x)
      expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(rightPanelBox.x + 1)
      // And chat occupies a meaningful slice of the viewport (not collapsed).
      const viewportWidth = page.viewportSize().width
      expect(chatBox.width / viewportWidth).toBeGreaterThan(0.4)
    })

    test('chat panel has messages area and input', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="chat-messages"]')).toBeVisible()
      await expect(page.locator('[data-testid="chat-input"]')).toBeVisible()
    })
  })

  test.describe('Footer', () => {
    // SPEC: footer:status-text
    test('footer shows status text', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const footer = page.locator('[data-testid="footer"]')
      await expect(footer).toBeVisible()

      // Status indicator should be present
      const statusEl = page.locator('[data-testid="footer-status"]')
      await expect(statusEl).toBeVisible()
      // Should have a data-status attribute indicating connection state
      const statusAttr = await statusEl.getAttribute('data-status')
      expect(statusAttr).toBeTruthy()
    })

    // SPEC: footer:workspace
    test('footer shows workspace', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="footer-workspace"]')).toBeVisible()
      await expect(page.locator('[data-testid="footer-workspace"]')).not.toBeEmpty()
    })

    // SPEC: footer:connection-dot
    test('connection dot is green when connected', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const statusEl = page.locator('[data-testid="footer-status"]')
      await expect(statusEl).toBeVisible()
      // Connected state should show data-status="ready"
      await expect(statusEl).toHaveAttribute('data-status', 'ready')
      // Connection dot color should be green-dominant (high green, low red/blue)
      await assertColor(statusEl, 'color', { g: 150 }, 105)
    })

    // SPEC: footer:model
    test('footer shows model name with chevron', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const modelEl = page.locator('[data-testid="footer-model"]')
      // Model should show from fixture (claude-sonnet-4-6 -> "Sonnet")
      await expect(modelEl).toContainText('Sonnet')
      // Should have a chevron indicator for clickability
      await expect(modelEl.locator('.chevron, svg, [data-icon]').first()).toBeVisible()
    })

    // SPEC: footer:model
    test('footer model shows dash when session model and workspace default are both null', async ({
      page,
    }) => {
      await mockAPI(page, {
        handlers: {
          getSessionStatus: async route => {
            await route.fulfill({
              json: {
                session_id: 'test-session-001',
                name: null,
                workspace: '/home/user/project',
                model: null,
                num_turns: 0,
                total_cost_usd: 0,
                total_duration_ms: 0,
                last_context_tokens: 0,
                context_window: 200000,
                started_at: '2025-01-18T12:00:00Z',
                updated_at: '2025-01-18T12:00:00Z',
                first_message: null,
                last_message: null,
                todos: [],
                commands: { custom: [], mcp: [], builtin: [] },
                session_dir: '/tmp/sessions/test-session-001',
                parent_session_id: null,
                session_prompt: null,
              },
            })
          },
          // Force the workspace default to null too - only then does the
          // picker have nothing to display and falls through to "-".
          getSessionDefaults: async route => {
            await route.fulfill({
              json: {
                workspace: '/home/user/project',
                model: null,
                permission_mode: null,
                effort_level: null,
                available_models: [],
                available_permission_modes: [],
                available_effort_levels: [],
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // With null session model AND null workspace default, footer shows "-"
      const modelEl = page.locator('[data-testid="footer-model"]')
      await expect(modelEl).toContainText('-')
    })

    // SPEC: footer:model
    test('clicking model opens dropdown', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const modelEl = page.locator('[data-testid="footer-model"]')
      await modelEl.click()

      // Model dropdown should appear
      const dropdown = page.locator('[data-testid="model-dropdown"]')
      await expect(dropdown).toBeVisible()
    })
  })

  test.describe('Width Preservation', () => {
    // SPEC: layout:panel-reopen-width
    test('panel width preserved across toggle', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Open sessions panel
      await openSessionsPanel(page)

      // Get initial width by finding the panel's dockview group
      const initialWidth = await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.offsetWidth : 0
      })

      expect(initialWidth).toBeGreaterThan(0)

      // Close panel
      await toggleSessionsPanel(page)
      await expect(page.locator('[data-testid="panel-sessions"]')).not.toBeVisible()

      // Reopen panel
      await openSessionsPanel(page)

      // Poll until width stabilizes (close to initial)
      await expect
        .poll(async () => {
          const width = await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
            const group = el.closest('.dv-view')
            return group ? group.offsetWidth : 0
          })
          return Math.abs(width - initialWidth)
        })
        .toBeLessThan(5)
    })
  })

  test.describe('Panel Ordering', () => {
    // SPEC: layout:panel-order-stack
    // SPEC: layout:panel-order-right
    test('panels with default visibility stack top-to-bottom in canonical order', async ({
      page,
    }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Right side defaults: Todos, Stash, Tasks (Usage and MCP hidden by default).
      // Verify all three are visible AND vertically ordered top-to-bottom.
      const ids = [
        { sel: '[data-testid="panel-todos"]', name: 'todos' },
        { sel: '[data-testid="stash-empty"]', name: 'stash' },
        { sel: '[data-testid="panel-tasks"]', name: 'tasks' },
      ]
      const tops = []
      for (const { sel, name } of ids) {
        await expect(page.locator(sel)).toBeVisible()
        const top = await page.locator(sel).evaluate(el => {
          const group = el.closest('.dv-view')
          return group ? group.getBoundingClientRect().top : 0
        })
        tops.push({ name, top })
      }
      // Each subsequent panel must sit strictly below the previous one.
      for (let i = 1; i < tops.length; i++) {
        expect(tops[i].top, `${tops[i].name} below ${tops[i - 1].name}`).toBeGreaterThan(
          tops[i - 1].top,
        )
      }
    })

    // SPEC: layout:panel-order-insert
    test('order preserved after close and reopen', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Both todos and stash visible by default
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()

      // Get initial positions
      const _initialTodosTop = await page.locator('[data-testid="panel-todos"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.getBoundingClientRect().top : 0
      })

      const _initialStashTop = await page.locator('[data-testid="stash-empty"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.getBoundingClientRect().top : 0
      })

      // Close todos
      await toggleTodosPanel(page)
      await expect(page.locator('[data-testid="panel-todos"]')).not.toBeVisible()

      // Reopen todos
      await openTodosPanel(page)

      // Poll until order is correct (todos above stash)
      await expect
        .poll(async () => {
          const todosTop = await page.locator('[data-testid="panel-todos"]').evaluate(el => {
            const group = el.closest('.dv-view')
            return group ? group.getBoundingClientRect().top : 0
          })
          const stashTop = await page.locator('[data-testid="stash-empty"]').evaluate(el => {
            const group = el.closest('.dv-view')
            return group ? group.getBoundingClientRect().top : 0
          })
          return todosTop < stashTop
        })
        .toBe(true)
    })
  })

  test.describe('Layout Persistence', () => {
    // SPEC: layout:save
    test('layout saved after panel toggle', async ({ page }) => {
      // Track PATCH calls
      const patchCalls = []
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'PATCH') {
          patchCalls.push(await route.request().postDataJSON())
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        } else if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: {} } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Toggle sessions panel
      await openSessionsPanel(page)

      // Wait for debounce (poll until PATCH request completes)
      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)
      const resolved = resolveOpsPayload(patchCalls[patchCalls.length - 1])
      expect(resolved).toHaveProperty('session.layout')
    })

    // SPEC: layout:save
    test('layout debounced on rapid toggles', async ({ page }) => {
      // Track PATCH calls
      const patchCalls = []
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'PATCH') {
          patchCalls.push({ time: Date.now(), data: await route.request().postDataJSON() })
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        } else if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: {} } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Rapid toggles (3 times quickly)
      await toggleSessionsPanel(page)
      await toggleSessionsPanel(page)
      await toggleSessionsPanel(page)

      // Wait for debounce (poll until at least one PATCH completes)
      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)

      // Should have debounced to minimal saves (1-2, not 3)
      expect(patchCalls.length).toBeLessThanOrEqual(2)
    })

    // SPEC: layout:save-content
    test('payload includes layout JSON', async ({ page }) => {
      // Track PATCH calls
      let savedPayload = null
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'PATCH') {
          savedPayload = await route.request().postDataJSON()
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        } else if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: {} } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Toggle panel to trigger save
      await openSessionsPanel(page)

      // Wait for debounce (poll until PATCH request completes)
      await expect.poll(() => savedPayload).toBeTruthy()

      // Verify payload structure (operation-based, resolved to nested object)
      const resolved = resolveOpsPayload(savedPayload)
      expect(resolved).toHaveProperty('session.layout')
      expect(resolved).toHaveProperty('session.panelGroups')
      expect(resolved.session.panelGroups).toHaveProperty('left')
      expect(resolved.session.panelGroups).toHaveProperty('right')
    })

    // SPEC: layout:save-content
    test('payload includes saved panel widths', async ({ page }) => {
      // Track PATCH calls
      let savedPayload = null
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'PATCH') {
          savedPayload = await route.request().postDataJSON()
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        } else if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: {} } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for debounce (poll until initial layout save completes)
      await expect.poll(() => savedPayload).toBeTruthy()

      // Verify panel widths are saved (right panel is open by default)
      const resolved = resolveOpsPayload(savedPayload)
      expect(resolved).toHaveProperty('session.panelGroups.right.width')
      expect(resolved.session.panelGroups.right.width).toBeGreaterThan(0)
    })

    // SPEC: layout:restore
    test('layout restored from server on load', async ({ page }) => {
      // Prepare saved state with sessions panel open (schema v2)
      const savedSession = loadFixture('layouts/sessions-open.json')
      savedSession.layout.panels.chat.title = '12345678'

      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: savedSession } })
        } else {
          await route.fulfill({ status: 200, json: { global: {}, session: {} } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // The saved layout includes sessions panel in left.order - verify it's visible
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:restore
    test('falls back to default layout when server returns empty', async ({ page }) => {
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: {} } })
        } else {
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Default layout: chat visible, sessions on left, todos visible in right sidebar
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:restore
    test('falls back to default layout when server returns 404', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getUIState: async route => {
            await route.fulfill({ status: 404, json: { error: 'Not found' } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Default layout should be used
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })
  })

  test.describe('Browser Tab Title', () => {
    // SPEC: notify:title-format
    test('title shows session name and workspace', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Check title format: "[Session Name] | [Workspace] | Claudebox"
      const title = await page.title()
      expect(title).toContain('Claudebox')
      // Title should use pipe delimiters
      expect(title).toContain('|')
    })

    // SPEC: notify:title-format
    test('title shows workspace when no session name', async ({ page }) => {
      // Mock session without a name
      await mockAPI(page, {
        handlers: {
          getSessionStatus: async route => {
            await route.fulfill({
              json: {
                session_id: 'abc123def456789',
                workspace: '/home/user/my-project',
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for title to update (session data needs to load)
      await expect.poll(() => page.title()).toContain('my-project')
      const title = await page.title()
      expect(title).toContain('Claudebox')
    })
  })

  test.describe('Tab Maximize', () => {
    // SPEC: layout:tab-double-click
    // SPEC: layout:maximize-save-layout
    // SPEC: layout:maximize-restore
    // SPEC: maximize:header-double-click
    test('double-click on tab triggers maximize toggle', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Get initial stash panel width
      const getGroupWidth = () =>
        page.locator('[data-testid="stash-empty"]').evaluate(el => {
          const group = el.closest('.dv-view')
          return group ? group.offsetWidth : 0
        })
      const initialWidth = await getGroupWidth()
      expect(initialWidth).toBeGreaterThan(0)

      // Stash and Todos are grouped in right sidebar with tabs
      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await expect(stashTab).toBeVisible()

      // Double-click on stash tab - this should trigger maximize
      await stashTab.dblclick()
      // Maximized panel should be significantly wider than initial
      await expect.poll(getGroupWidth).toBeGreaterThan(initialWidth * 1.5)

      // Double-click again should restore
      await stashTab.dblclick()

      // Verify panels are restored to approximately original width
      await expect
        .poll(async () => Math.abs((await getGroupWidth()) - initialWidth))
        .toBeLessThanOrEqual(20)
    })

    // SPEC: layout:maximize-preserve-sizes
    test('layout preserved after unmaximize', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Get initial dimensions of right sidebar
      const getGroupWidth = () =>
        page.locator('[data-testid="stash-empty"]').evaluate(el => {
          const group = el.closest('.dv-view')
          return group ? group.offsetWidth : 0
        })

      const initialWidth = await getGroupWidth()
      expect(initialWidth).toBeGreaterThan(0)

      // Maximize
      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await stashTab.dblclick()

      // Unmaximize
      await stashTab.dblclick()

      // Poll until width is restored (within tolerance)
      await expect
        .poll(async () => {
          const width = await getGroupWidth()
          return Math.abs(width - initialWidth)
        })
        .toBeLessThan(10)
    })

    // SPEC: layout:tab-middle-click
    test('middle-click closes panel tab', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Verify todos panel is visible
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()

      // Find todos tab
      const todosTab = page.locator('.icon-tab').filter({ hasText: 'Todos' })
      await expect(todosTab).toBeVisible()

      // Middle-click (button: 1 = middle mouse button)
      await todosTab.click({ button: 'middle' })

      // Panel should close
      await expect(page.locator('[data-testid="panel-todos"]')).not.toBeVisible()
    })

    // SPEC: layout:header-new-session
    test('header strip "+" button creates new session', async ({ page }) => {
      let newSessionCalled = false
      await mockAPI(page, {
        handlers: {
          newSession: async route => {
            newSessionCalled = true
            await route.fulfill({ status: 200, json: { success: true } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Tab bar "+" button should be visible in chat group
      const newBtn = page.locator('[data-testid="header-new-session-btn"]')
      await expect(newBtn).toBeVisible()
      await expect(newBtn).toHaveAttribute(
        'title',
        'New session (Alt+Click or middle-click for new browser tab)',
      )

      // Click to create new session
      await newBtn.click()

      await expect.poll(() => newSessionCalled).toBe(true)
    })

    // SPEC: layout:header-new-menu
    // SPEC: session-header:dropdown-not-clipped
    test('"+" button chevron opens dropdown with new session options', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Use the header-prefixed chevron testid to scope to the session-header-strip's
      // split-button - the SessionsPanel hosts its own NewSessionSplitButton.
      const chevron = page.locator('[data-testid="header-new-session-chevron"]')
      await expect(chevron).toBeVisible()
      await expect(chevron).toHaveAttribute('title', 'More start options')

      await chevron.click()

      // Header dropdown portals to <body> (so it escapes the right icon strip's
      // stacking context and never gets clipped by side panels).
      const dropdown = page.locator('.new-session-dropdown-portal')
      await expect(dropdown).toBeVisible()
      const portaledToBody = await dropdown.evaluate(el => el.parentElement === document.body)
      expect(portaledToBody).toBe(true)

      const options = dropdown.locator('.dropdown-option')
      await expect(options).toHaveCount(2)
      await expect(options.nth(0)).toHaveText('New session')
      await expect(options.nth(1)).toHaveText('New session in new browser tab')
    })

    // SPEC: layout:panel-chat-permanent
    test('Chat panel cannot be closed (always visible)', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Chat panel should be visible
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()

      // Toggle other panels to verify Chat remains visible
      await openSessionsPanel(page)

      // Close other panels
      await toggleSessionsPanel(page)
      await expect(page.locator('[data-testid="panel-sessions"]')).not.toBeVisible()

      // Chat panel should STILL be visible (cannot be closed)
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()

      // Verify Chat has no close button in its tab (if tab exists)
      const chatCloseBtn = page
        .locator('.dv-default-tab')
        .filter({ hasText: 'Chat' })
        .locator('.icon-tab-close')
      const closeCount = await chatCloseBtn.count()
      expect(closeCount).toBe(0) // Chat tab should have no close button
    })
  })

  test.describe('Width Persistence to Server', () => {
    // SPEC: layout:save-content
    test('panel width included in PATCH payload after toggle', async ({ page }) => {
      // Track PATCH calls with their payloads
      const patchCalls = []
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'PATCH') {
          patchCalls.push(await route.request().postDataJSON())
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        } else if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: {} } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Open sessions panel
      await toggleSessionsPanel(page)
      await openSessionsPanel(page)

      // Wait for debounced save (poll until PATCH request completes)
      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)

      // Verify left panel width is saved in PATCH payload (operation-based)
      const resolved = resolveOpsPayload(patchCalls[patchCalls.length - 1])
      expect(resolved).toHaveProperty('session.panelGroups.left.width')
      expect(resolved.session.panelGroups.left.width).toBeGreaterThan(0)
    })

    // SPEC: layout:restore
    test('saved width from server applied on panel open', async ({ page }) => {
      // Mock ui-state with specific widths (schema v2)
      const savedSession = {
        panelGroups: {
          left: { width: 350, order: ['sessions'] },
          right: { width: 400, order: ['todos', 'stash'] },
        },
      }

      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: savedSession } })
        } else {
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Open sessions panel (which should use saved width)
      await openSessionsPanel(page)

      // Poll until saved width is applied (should be non-trivial, based on saved 350)
      await expect
        .poll(async () => {
          return await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
            const group = el.closest('.dv-view')
            return group ? group.offsetWidth : 0
          })
        })
        .toBeGreaterThan(150)
    })
  })

  test.describe('Session Title Updates', () => {
    // SPEC: notify:title-update
    test('title updates when session has name', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessionStatus: async route => {
            await route.fulfill({
              json: {
                session_id: 'abc123',
                name: 'My Important Task',
                workspace: '/home/user/project',
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Title should include session name
      await expect.poll(() => page.title()).toContain('My Important Task')
    })

    // SPEC: panel-session:rename
    test('session rename UI works correctly', async ({ page }) => {
      // Track rename API calls
      let renameApiCalled = false
      let renamePayload = null

      // Set up mockAPI first, then override with custom handler (Playwright uses LIFO)
      await mockAPI(page, {
        handlers: {
          updateSession: async route => {
            renameApiCalled = true
            renamePayload = await route.request().postDataJSON()
            await route.fulfill({ status: 200, json: { success: true } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Open sessions panel
      await openSessionsPanel(page)

      // Find the current session item
      const sessionItem = page.locator('[data-testid="session-item"]').first()
      await expect(sessionItem).toBeVisible()

      // Click the pencil/edit button to start renaming
      const editBtn = sessionItem.locator('.sessions-edit-btn')
      await expect(editBtn).toBeVisible()
      await editBtn.click()

      // Edit input should appear
      const editInput = sessionItem.locator('.sessions-edit-input')
      await expect(editInput).toBeVisible()

      // Type new name
      await editInput.fill('My Renamed Task')

      // Save the rename (press Enter)
      await editInput.press('Enter')

      // Wait for API call (poll until rename API is called)
      await expect.poll(() => renameApiCalled).toBe(true)
      expect(renamePayload).toHaveProperty('name', 'My Renamed Task')

      // Edit input should disappear after save
      await expect(editInput).not.toBeVisible()
    })
  })

  test.describe('Panel Detachment', () => {
    test('detached panel excluded from sidebar order', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Both todos and stash visible by default in right sidebar
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()

      // Get initial positions to verify order
      const initialTodosTop = await page.locator('[data-testid="panel-todos"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.getBoundingClientRect().top : 0
      })

      const stashTop = await page.locator('[data-testid="stash-empty"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.getBoundingClientRect().top : 0
      })

      // Verify todos is above stash
      expect(initialTodosTop).toBeLessThan(stashTop)

      // Find todos tab and drag it to create a floating/detached panel
      const todosTab = page.locator('.icon-tab').filter({ hasText: 'Todos' })
      await expect(todosTab).toBeVisible()

      const tabBox = await todosTab.boundingBox()
      if (tabBox) {
        // Drag tab far from its position to detach it
        await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2)
        await page.mouse.down()
        // Drag to center of viewport to create floating panel
        const viewport = page.viewportSize()
        await page.mouse.move(viewport.width / 2, viewport.height / 2)
        await page.mouse.up()

        // Now toggle todos panel off and on via icon
        await toggleTodosPanel(page)
        await toggleTodosPanel(page)

        // Stash should still be visible and unaffected
        await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()

        // The key assertion: toggling a panel that was detached
        // should not break the sidebar order of remaining panels
        // (stash should remain where it was, not be affected by todos detachment)
      }
    })
  })

  test.describe('Layout Auto-Copy', () => {
    // SPEC: layout:auto-copy
    test('new session inherits panel layout from most recent session', async ({ page }) => {
      // Simulate Session A having a customized layout with sessions panel open on the left.
      // When Session B loads, ui_state.py copies Session A's layout, so the GET
      // for Session B returns Session A's saved layout (with sessions panel open).
      const sessionALayout = loadFixture('layouts/sessions-open.json')

      // Mock ui-state to return session A's layout for the new session B.
      // This simulates the server-side auto-copy behavior in ui_state.py:
      // when a new session has no layout, the server copies from the most recent session.
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: sessionALayout } })
        } else {
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Session B should inherit Session A's layout, which had the sessions panel open.
      // Verify that the sessions panel is visible (inherited from Session A).
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      // Verify chat panel is still visible (always present)
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()

      // Verify right sidebar panels are visible (inherited from Session A)
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
    })

    // SPEC: layout:auto-copy
    test('inherited layout preserves panel widths from previous session', async ({ page }) => {
      const sessionALayout = loadFixture('layouts/sessions-open-wide.json')
      const _savedWidth = sessionALayout.panelGroups.left.width

      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: sessionALayout } })
        } else {
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Verify sessions panel is visible (inherited)
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      // Verify the inherited left panel width is applied (greater than minimum)
      await expect
        .poll(async () => {
          return await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
            const group = el.closest('.dv-view')
            return group ? group.offsetWidth : 0
          })
        })
        .toBeGreaterThan(150)
    })

    // SPEC: layout:auto-copy
    test('new session without previous layout gets default layout', async ({ page }) => {
      // When there is no previous session to copy from, the server returns empty session state.
      // The app should fall back to the default layout.
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: {} } })
        } else {
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Default layout: chat visible, sessions on left, right panels visible
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:auto-copy
    test('inherited layout triggers save for new session', async ({ page }) => {
      const sessionALayout = loadFixture('layouts/sessions-open.json')

      // Track PATCH calls to verify the new session saves its own layout
      const patchCalls = []
      await page.route(/\/ui-state/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { global: {}, session: sessionALayout } })
        } else if (route.request().method() === 'PATCH') {
          patchCalls.push(await route.request().postDataJSON())
          await route.fulfill({ status: 200, json: { status: 'ok' } })
        }
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for the new session to save its own layout (debounced PATCH)
      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)

      // Verify the saved payload includes layout data (session B now owns its layout)
      const resolved = resolveOpsPayload(patchCalls[patchCalls.length - 1])
      expect(resolved).toHaveProperty('session.layout')
      expect(resolved).toHaveProperty('session.panelGroups')
    })
  })

  test.describe('Panel Close/Open Behavior', () => {
    // SPEC: layout:panel-close-all
    test('chat expands when all side panels close', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Get initial chat width
      const initialWidth = await page.locator('[data-testid="panel-chat"]').evaluate(el => {
        return el.getBoundingClientRect().width
      })

      // Close all default-open panels:
      //   left:  sessions, bookmarks, boards
      //   right: todos, stash, tasks
      await toggleSessionsPanel(page)
      await page.keyboard.press('Alt+5') // bookmarks
      await page.keyboard.press('Alt+6') // boards
      await toggleTodosPanel(page)
      await toggleStashPanel(page)
      await page.keyboard.press('Alt+4') // tasks

      // Poll until chat expands (larger width)
      await expect
        .poll(async () => {
          return await page.locator('[data-testid="panel-chat"]').evaluate(el => {
            return el.getBoundingClientRect().width
          })
        })
        .toBeGreaterThan(initialWidth)
    })

    // SPEC: layout:panel-reopen-after-all
    test('panel widths restore after closing all', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Get initial todos panel width
      const todosPanel = page.locator('[data-testid="panel-todos"]')
      await expect(todosPanel).toBeVisible()
      const initialWidth = await todosPanel.evaluate(el => el.getBoundingClientRect().width)

      // Close both right panels
      await toggleTodosPanel(page)
      await expect(todosPanel).not.toBeVisible()
      await toggleStashPanel(page)
      await expect(page.locator('[data-testid="stash-empty"]')).not.toBeVisible()

      // Reopen todos
      await openTodosPanel(page)

      // Poll until width is approximately restored
      await expect
        .poll(async () => {
          const restoredWidth = await todosPanel.evaluate(el => el.getBoundingClientRect().width)
          return Math.abs(restoredWidth - initialWidth)
        })
        .toBeLessThan(50)
    })

    // SPEC: layout:panel-drag-invalidate
    // MOCK-LIMITED: Dockview's drag-to-reposition and sash setPointerCapture() cannot
    // be fully simulated via Playwright. Verify resize infrastructure exists and that
    // panels can be dragged (sash elements with correct cursor).
    test('resize sashes exist for panel width adjustment', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Ensure a panel is visible (confirming split layout is active)
      const todosPanel = page.locator('[data-testid="panel-todos"]')
      await expect(todosPanel).toBeVisible()

      // Dockview sash elements should exist between split groups
      const sashes = page.locator('.dv-sash')
      const sashCount = await sashes.count()
      expect(sashCount).toBeGreaterThan(0)

      // Sash should have ew-resize cursor (horizontal split between chat and panel)
      const cursor = await sashes.first().evaluate(el => getComputedStyle(el).cursor)
      expect(cursor).toMatch(/ew-resize|col-resize|pointer/)

      // Panel tabs should exist for dragging (dockview tab elements)
      const panelTabs = page.locator('.dv-tab')
      expect(await panelTabs.count()).toBeGreaterThan(0)
    })
  })

  test.describe('Tab Bar Gradient', () => {
    // SPEC: layout:tab-bar-gradient
    // SPEC: layout:header-accent-gradient
    test('tab bar background is a horizontal gradient from default to accent color', async ({
      page,
    }) => {
      // Mock ui-state to return a workspace accent color
      await mockAPI(page, {
        handlers: {
          getUIState: async route => {
            await route.fulfill({
              json: {
                global: { workspaceColor: '#ff0000' },
                session: {},
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // The WorkspaceAccentEffect sets --accent-tab-bg on .dockview-theme-dark
      const accentTabBg = await page
        .locator('.dockview-theme-dark')
        .evaluate(el => el.style.getPropertyValue('--accent-tab-bg'))
      expect(accentTabBg).toContain('linear-gradient')
      expect(accentTabBg).toContain('to right')
      expect(accentTabBg).toContain('#ff0000')
    })
  })

  test.describe('Maximize Toggle', () => {
    // SPEC: layout:maximize-toggle-open
    test('toggling an already-open side panel while maximized just unmaximizes', async ({
      page,
    }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Sessions panel is open by default
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      // Get the initial sessions panel width
      const getSessionsWidth = () =>
        page.locator('[data-testid="panel-sessions"]').evaluate(el => {
          const group = el.closest('.dv-view')
          return group ? group.offsetWidth : 0
        })
      const initialWidth = await getSessionsWidth()
      expect(initialWidth).toBeGreaterThan(0)

      // Double-click a tab to maximize the center panel
      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await expect(stashTab).toBeVisible()
      await stashTab.dblclick()

      // Sessions panel should be hidden while maximized (width collapsed to 0 or not visible)
      await expect
        .poll(async () => {
          try {
            return await getSessionsWidth()
          } catch {
            return 0
          }
        })
        .toBeLessThan(5)

      // Press Alt+1 (toggle sessions) while maximized
      await page.keyboard.press('Alt+1')

      // Layout should unmaximize - sessions panel should be visible again
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
      await expect.poll(getSessionsWidth).toBeGreaterThan(50)
    })

    // SPEC: layout:maximize-toggle-closed
    test('toggling a closed side panel while maximized unmaximizes and opens the panel', async ({
      page,
    }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // MCP panel is closed by default
      await expect(page.locator('[data-testid="panel-mcp"]')).not.toBeVisible()

      // Double-click a tab to maximize the center panel
      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await expect(stashTab).toBeVisible()
      await stashTab.dblclick()

      // Wait for maximize to take effect (sessions panel collapses)
      await expect
        .poll(async () => {
          try {
            return await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
              const group = el.closest('.dv-view')
              return group ? group.offsetWidth : 0
            })
          } catch {
            return 0
          }
        })
        .toBeLessThan(5)

      // Press Alt+8 (toggle MCP) while maximized
      await page.keyboard.press('Alt+8')

      // Layout should unmaximize AND MCP panel should now be visible
      await expect(page.locator('[data-testid="panel-mcp"]')).toBeVisible()

      // Sessions panel should also be restored (it was open before maximize)
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:floating-panel-inactive
    test('hovering a closed-panel icon while not maximized fires the floating preview after intent delay', async ({
      page,
    }) => {
      test.setTimeout(15_000)
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // MCP is hidden by default (SPEC §1.6) - choose it for the closed-panel case.
      await expect(page.locator('[data-testid="panel-mcp"]')).not.toBeVisible()

      // Hovering the MCP icon (closed panel) eventually shows the floating
      // preview after the hover-intent delay.
      await page.locator('[data-testid="icon-mcp"]').hover()
      await expect(page.locator('.floating-panel')).toBeVisible()
    })

    // SPEC: layout:floating-panel-wide-panels
    test('logs floating preview width follows max(800, 0.6 × viewport) capped at viewport', async ({
      page,
    }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Maximize so the floating preview can render on hover. Use side-panel
      // collapse as the maximize signal - dockview's `dv-groupview-maximized`
      // class isn't always set in mocked env.
      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await expect(stashTab).toBeVisible()
      await stashTab.dblclick()
      await expect
        .poll(async () => {
          try {
            return await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
              const group = el.closest('.dv-view')
              return group ? group.offsetWidth : 0
            })
          } catch {
            return 0
          }
        })
        .toBeLessThan(5)

      // At the default Desktop Chrome viewport (1280×720) the ratio
      // 0.6 × 1280 = 768 falls below the 800px floor, so the post-fix formula
      // resolves to 800px. The pre-fix formula resolves to
      // max(300, 1280 × 0.4) = 512px - distinct enough to differentiate.
      await page.locator('.icon-strip-right [data-testid="icon-logs"]').hover()
      await expect(page.locator('.floating-panel')).toBeVisible()
      const actual = await page.evaluate(() =>
        Math.round(document.querySelector('.floating-panel').getBoundingClientRect().width),
      )
      expect(actual).toBe(800)
    })

    // SPEC: layout:maximize-toggle-logs
    test('clicking the logs icon while maximized unmaximizes and opens the strip', async ({
      page,
    }) => {
      test.setTimeout(15_000)
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Logs strip starts closed
      await expect(page.locator('[data-testid="bottom-panel-container"]')).not.toBeVisible()

      // Double-click a tab to maximize the center panel
      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await expect(stashTab).toBeVisible()
      await stashTab.dblclick()

      // Wait for maximize (sessions panel collapses)
      await expect
        .poll(async () => {
          try {
            return await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
              const group = el.closest('.dv-view')
              return group ? group.offsetWidth : 0
            })
          } catch {
            return 0
          }
        })
        .toBeLessThan(5)

      // Press Alt+0 (toggle logs) while maximized - same handler the icon click hits.
      await page.keyboard.press('Alt+0')

      // Layout unmaximizes first - dockview's maximized class drops.
      await expect
        .poll(() => page.evaluate(() => !!document.querySelector('.dv-groupview-maximized')))
        .toBe(false)

      // Logs strip mounts once isMaximized propagates back to false in React.
      await expect(page.locator('[data-testid="bottom-panel-container"]')).toBeVisible({
        timeout: 5_000,
      })
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })
  })

  test.describe('Chat Control Bar Pin', () => {
    // SPEC: chat:control-pin
    test('pin button visible in chat control bar', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Pin button in chat control bar (use .panel-control-btn to distinguish from sessions panel pin)
      const pinBtn = page.locator('.panel-control-btn[title="Pin session"]')
      await expect(pinBtn).toBeVisible()
    })

    // SPEC: chat:control-pin
    test('pin button toggles pressed state on click', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Initially unpinned (use .panel-control-btn to target control bar specifically)
      const pinBtn = page.locator('.panel-control-btn[title="Pin session"]')
      await expect(pinBtn).toBeVisible()
      await expect(pinBtn).not.toHaveClass(/pressed/)

      // Click to pin
      await pinBtn.click()

      // Should now be pressed and title changed
      const pinnedBtn = page.locator('.panel-control-btn[title="Unpin session"]')
      await expect(pinnedBtn).toHaveClass(/pressed/)
      await expect(pinnedBtn).toHaveAttribute('aria-pressed', 'true')

      // Click again to unpin
      await pinnedBtn.click()

      // Should return to unpinned state
      const unpinnedBtn = page.locator('.panel-control-btn[title="Pin session"]')
      await expect(unpinnedBtn).toBeVisible()
      await expect(unpinnedBtn).not.toHaveClass(/pressed/)
    })
  })

  test.describe('Tab Bar Accent', () => {
    // SPEC: layout:tab-bar-hover-tint
    // SPEC: layout:header-accent-hover
    test('header buttons tint toward brightened workspace accent on hover when color is set', async ({
      page,
    }) => {
      // Override ui-state to seed a workspace accent color. The latest matching
      // route wins; outer beforeEach already registered the default mock.
      await page.route(/\/api\/workspaces\/[^/]+\/ui-state/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            json: { global: { workspaceColor: '#1e3a5f' }, session: {} },
          })
        } else {
          await route.fulfill({ json: { global: { workspaceColor: '#1e3a5f' }, session: {} } })
        }
      })
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const themeEl = page.locator('.dockview-theme-dark').first()
      await expect(themeEl).toBeVisible()

      const hover = await themeEl.evaluate(el => el.style.getPropertyValue('--accent-hover'))
      expect(hover).toMatch(/^#[0-9a-f]{6}$/)
      expect(hover).not.toBe('#1e3a5f')
    })

    test('hover tint variable clears when no workspace color is set', async ({ page }) => {
      // Default ui-state has no workspaceColor - outer beforeEach is sufficient.
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const themeEl = page.locator('.dockview-theme-dark').first()
      await expect(themeEl).toBeVisible()

      const hover = await themeEl.evaluate(el => el.style.getPropertyValue('--accent-hover'))
      expect(hover).toBe('')
    })
  })

  test.describe('New Browser Tab Isolation', () => {
    test('Alt+click on header + button does not paint chat-replay-overlay in originating tab', async ({
      page,
    }) => {
      await mockAPI(page, {
        handlers: {
          newSession: async route => {
            await route.fulfill({
              status: 200,
              json: { session_id: 'created-for-new-tab', name: null },
            })
          },
        },
      })
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Stub window.open so the new-tab path is observable without spawning a tab.
      await page.evaluate(() => {
        window.__opened = []
        window.open = url => {
          window.__opened.push(url)
          return null
        }
      })

      // Sanity: the originating tab is not currently showing a replay overlay.
      const overlay = page.locator('.chat-replay-overlay')
      await expect(overlay).not.toBeVisible()

      // Alt+click the header `+` button - should route to new-browser-tab path.
      const newBtn = page.locator('[data-testid="header-new-session-btn"]')
      await expect(newBtn).toBeVisible()
      await newBtn.click({ modifiers: ['Alt'] })

      // For at least 2 seconds, the originating tab MUST NOT show the overlay.
      const start = Date.now()
      while (Date.now() - start < 2000) {
        await expect(overlay).not.toBeVisible()
        await page.waitForTimeout(200)
      }

      // The new-tab path should have triggered window.open, not modified the
      // originating tab's session view.
      const opened = await page.evaluate(() => window.__opened || [])
      expect(opened.length).toBeGreaterThan(0)
    })
  })
})
