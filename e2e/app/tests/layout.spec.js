/** E2E tests for layout and panels: icon strips, persistence, tab interactions. */

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

      // sessions/bookmarks/boards form the top group; logs sits at the bottom of the strip.
      const ys = {}
      for (const id of ids) {
        ys[id] = (await page.locator(`[data-testid="${id}"]`).boundingBox()).y
      }
      expect(ys['icon-sessions']).toBeLessThan(ys['icon-bookmarks'])
      expect(ys['icon-bookmarks']).toBeLessThan(ys['icon-boards'])
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

      // Covers the "top to bottom" ordering portion of the claim.
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

      // Validates every icon, not just sessions, since the claim implies the full set.
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

      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      await page.locator('[data-testid="icon-sessions"]').click()
      await expect(page.locator('[data-testid="panel-sessions"]')).not.toBeVisible()

      await page.locator('[data-testid="icon-sessions"]').click()
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:panel-toggle-off
    test('toggling a panel off closes it AND saves its width for re-open', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const panel = page.locator('[data-testid="panel-sessions"]')
      await expect(panel).toBeVisible()

      // The claim says "saves width" on close, so reopening must restore it within tolerance.
      const widthBefore = await panel.evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.offsetWidth : 0
      })
      expect(widthBefore).toBeGreaterThan(0)

      await page.locator('[data-testid="icon-sessions"]').click()
      await expect(panel).not.toBeVisible()

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

      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:default-right-panels
    test('Todos, Stash, and Tasks panels open by default on right', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-tasks"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-usage"]')).not.toBeVisible()
      await expect(page.locator('[data-testid="panel-mcp"]')).not.toBeVisible()

      const viewportWidth = page.viewportSize().width
      const rightGroup = page.locator('[data-testid="panel-todos"]').first()
      const rightBox = await rightGroup.boundingBox()
      // Todos panel's parent group stands in for the right group's width (leftmost panel to edge).
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

      await toggleSessionsPanel(page)
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
    })

    // SPEC: layout:default-chat-center
    test('chat panel sits horizontally between left and right strips', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const chatBox = await page.locator('[data-testid="panel-chat"]').boundingBox()
      expect(chatBox).toBeTruthy()

      // Left strip left of chat, todos right of it - anchors "in center" beyond mere visibility.
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

      const statusEl = page.locator('[data-testid="footer-status"]')
      await expect(statusEl).toBeVisible()
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
      await expect(statusEl).toHaveAttribute('data-status', 'ready')
      await assertColor(statusEl, 'color', { g: 150 }, 105)
    })

    // SPEC: footer:model
    test('footer shows model name with chevron', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const modelEl = page.locator('[data-testid="footer-model"]')
      // Fixture's model id claude-sonnet-5 maps to the display name "Sonnet".
      await expect(modelEl).toContainText('Sonnet')
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
          // Only when the workspace default is also null does the picker have nothing to
          // display and fall through to "-".
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

      const modelEl = page.locator('[data-testid="footer-model"]')
      await expect(modelEl).toContainText('-')
    })

    // SPEC: footer:model
    test('clicking model opens dropdown', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const modelEl = page.locator('[data-testid="footer-model"]')
      await modelEl.click()

      const dropdown = page.locator('[data-testid="model-dropdown"]')
      await expect(dropdown).toBeVisible()
    })
  })

  test.describe('Width Preservation', () => {
    // SPEC: layout:panel-reopen-width
    test('panel width preserved across toggle', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      const initialWidth = await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.offsetWidth : 0
      })

      expect(initialWidth).toBeGreaterThan(0)

      await toggleSessionsPanel(page)
      await expect(page.locator('[data-testid="panel-sessions"]')).not.toBeVisible()

      await openSessionsPanel(page)

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

      // Right side defaults are Todos, Stash, Tasks; Usage and MCP are hidden by default.
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

      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()

      const _initialTodosTop = await page.locator('[data-testid="panel-todos"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.getBoundingClientRect().top : 0
      })

      const _initialStashTop = await page.locator('[data-testid="stash-empty"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.getBoundingClientRect().top : 0
      })

      await toggleTodosPanel(page)
      await expect(page.locator('[data-testid="panel-todos"]')).not.toBeVisible()

      await openTodosPanel(page)

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

      await openSessionsPanel(page)

      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)
      const resolved = resolveOpsPayload(patchCalls[patchCalls.length - 1])
      expect(resolved).toHaveProperty('session.layout')
    })

    // SPEC: layout:save
    test('layout debounced on rapid toggles', async ({ page }) => {
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

      await toggleSessionsPanel(page)
      await toggleSessionsPanel(page)
      await toggleSessionsPanel(page)

      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)

      // Debouncing should collapse 3 rapid toggles to 1-2 saves.
      expect(patchCalls.length).toBeLessThanOrEqual(2)
    })

    // SPEC: layout:save-content
    test('payload includes layout JSON', async ({ page }) => {
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

      await openSessionsPanel(page)

      await expect.poll(() => savedPayload).toBeTruthy()

      // The payload is operation-based; resolve it to a nested object before asserting.
      const resolved = resolveOpsPayload(savedPayload)
      expect(resolved).toHaveProperty('session.layout')
      expect(resolved).toHaveProperty('session.panelGroups')
      expect(resolved.session.panelGroups).toHaveProperty('left')
      expect(resolved.session.panelGroups).toHaveProperty('right')
    })

    // SPEC: layout:save-content
    test('payload includes saved panel widths', async ({ page }) => {
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

      await expect.poll(() => savedPayload).toBeTruthy()

      // Right panel is open by default, so its width should be in the initial save.
      const resolved = resolveOpsPayload(savedPayload)
      expect(resolved).toHaveProperty('session.panelGroups.right.width')
      expect(resolved.session.panelGroups.right.width).toBeGreaterThan(0)
    })

    // SPEC: layout:restore
    test('layout restored from server on load', async ({ page }) => {
      // Fixture is schema v3, with the sessions panel open.
      const savedSession = loadFixture('layouts/sessions-open.json')
      savedSession.layout.panels.main.title = '12345678'

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

      // Fixture's left.order includes sessions.
      const sessionsPanel = page.locator('[data-testid="panel-sessions"]')
      await expect(sessionsPanel).toBeVisible()

      // The fixture's 400px width only survives a real restore; a default rebuild gives ~192px.
      // Polled: dockview's resize pass can still be settling right after mount.
      await expect
        .poll(async () => {
          return await sessionsPanel.evaluate(el => {
            const group = el.closest('.dv-view')
            return group ? group.offsetWidth : 0
          })
        })
        .toBeGreaterThan(350)
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

      // Expected format: "[Session Name] | [Workspace] | Claudebox"
      const title = await page.title()
      expect(title).toContain('Claudebox')
      expect(title).toContain('|')
    })

    // SPEC: notify:title-format
    test('title shows workspace when no session name', async ({ page }) => {
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

      // Title updates once session data finishes loading.
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

      const getGroupWidth = () =>
        page.locator('[data-testid="stash-empty"]').evaluate(el => {
          const group = el.closest('.dv-view')
          return group ? group.offsetWidth : 0
        })
      const initialWidth = await getGroupWidth()
      expect(initialWidth).toBeGreaterThan(0)

      // Stash and Todos share a tabbed group in the right sidebar.
      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await expect(stashTab).toBeVisible()

      await stashTab.dblclick()
      await expect.poll(getGroupWidth).toBeGreaterThan(initialWidth * 1.5)

      await stashTab.dblclick()

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

      const getGroupWidth = () =>
        page.locator('[data-testid="stash-empty"]').evaluate(el => {
          const group = el.closest('.dv-view')
          return group ? group.offsetWidth : 0
        })

      const initialWidth = await getGroupWidth()
      expect(initialWidth).toBeGreaterThan(0)

      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await stashTab.dblclick()
      await stashTab.dblclick()

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

      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()

      const todosTab = page.locator('.icon-tab').filter({ hasText: 'Todos' })
      await expect(todosTab).toBeVisible()

      await todosTab.click({ button: 'middle' })

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

      const newBtn = page.locator('[data-testid="header-new-session-btn"]')
      await expect(newBtn).toBeVisible()
      await expect(newBtn).toHaveAttribute(
        'title',
        'New session (Alt+Click or middle-click for new browser tab)',
      )

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

      // The header-prefixed testid disambiguates from SessionsPanel's own similar-chevron button.
      const chevron = page.locator('[data-testid="header-new-session-chevron"]')
      await expect(chevron).toBeVisible()
      await expect(chevron).toHaveAttribute('title', 'More start options')

      await chevron.click()

      // Portaling to <body> escapes the icon strip's stacking context, so panels can't clip it.
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

      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()

      await openSessionsPanel(page)

      await toggleSessionsPanel(page)
      await expect(page.locator('[data-testid="panel-sessions"]')).not.toBeVisible()

      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()

      const chatCloseBtn = page
        .locator('.dv-default-tab')
        .filter({ hasText: 'Chat' })
        .locator('.icon-tab-close')
      const closeCount = await chatCloseBtn.count()
      expect(closeCount).toBe(0)
    })
  })

  test.describe('Width Persistence to Server', () => {
    // SPEC: layout:save-content
    test('panel width included in PATCH payload after toggle', async ({ page }) => {
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

      await toggleSessionsPanel(page)
      await openSessionsPanel(page)

      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)

      const resolved = resolveOpsPayload(patchCalls[patchCalls.length - 1])
      expect(resolved).toHaveProperty('session.panelGroups.left.width')
      expect(resolved.session.panelGroups.left.width).toBeGreaterThan(0)
    })

    // SPEC: layout:restore
    test('saved width from server applied on panel open', async ({ page }) => {
      // Schema v3 ui-state - restoreFromServer reads `layout` (not `panelGroups`) to decide
      // whether a restore happened at all, so the fixture needs a real dockview-shaped `layout`.
      const savedSession = loadFixture('layouts/session-open-panel.json')
      const savedWidth = savedSession.panelGroups.left.width

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

      await openSessionsPanel(page)

      // Fixture width 500 is far above the default rebuild's ~192px here, so this proves a restore.
      await expect
        .poll(async () => {
          return await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
            const group = el.closest('.dv-view')
            return group ? group.offsetWidth : 0
          })
        })
        .toBeGreaterThan(savedWidth - 100)
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

      await expect.poll(() => page.title()).toContain('My Important Task')
    })

    // SPEC: panel-session:rename
    test('session rename UI works correctly', async ({ page }) => {
      let renameApiCalled = false
      let renamePayload = null

      // Playwright resolves routes LIFO, so this custom handler overrides mockAPI's default.
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

      await openSessionsPanel(page)

      const sessionItem = page.locator('[data-testid="session-item"]').first()
      await expect(sessionItem).toBeVisible()

      const editBtn = sessionItem.locator('.sessions-edit-btn')
      await expect(editBtn).toBeVisible()
      await editBtn.click()

      const editInput = sessionItem.locator('.sessions-edit-input')
      await expect(editInput).toBeVisible()

      await editInput.fill('My Renamed Task')
      await editInput.press('Enter')

      await expect.poll(() => renameApiCalled).toBe(true)
      expect(renamePayload).toHaveProperty('name', 'My Renamed Task')

      await expect(editInput).not.toBeVisible()
    })
  })

  test.describe('Panel Detachment', () => {
    test('detached panel excluded from sidebar order', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()

      const initialTodosTop = await page.locator('[data-testid="panel-todos"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.getBoundingClientRect().top : 0
      })

      const stashTop = await page.locator('[data-testid="stash-empty"]').evaluate(el => {
        const group = el.closest('.dv-view')
        return group ? group.getBoundingClientRect().top : 0
      })

      expect(initialTodosTop).toBeLessThan(stashTop)

      const todosTab = page.locator('.icon-tab').filter({ hasText: 'Todos' })
      await expect(todosTab).toBeVisible()

      const tabBox = await todosTab.boundingBox()
      if (tabBox) {
        // Drag the tab to the viewport center to detach it into a floating panel.
        await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2)
        await page.mouse.down()
        const viewport = page.viewportSize()
        await page.mouse.move(viewport.width / 2, viewport.height / 2)
        await page.mouse.up()

        await toggleTodosPanel(page)
        await toggleTodosPanel(page)

        // Toggling the detached panel must not disturb stash's position in the sidebar.
        await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
      }
    })
  })

  test.describe('Layout Auto-Copy', () => {
    // SPEC: layout:auto-copy
    test('new session inherits panel layout from most recent session', async ({ page }) => {
      // Simulates Session A's layout (sessions panel open). Session B has none of its own, so
      // ui_state.py's server-side auto-copy returns Session A's saved layout for B's ui-state GET.
      const sessionALayout = loadFixture('layouts/sessions-open.json')

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

      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
    })

    // SPEC: layout:auto-copy
    test('inherited layout preserves panel widths from previous session', async ({ page }) => {
      const sessionALayout = loadFixture('layouts/sessions-open-wide.json')
      const savedWidth = sessionALayout.panelGroups.left.width

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

      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      // Fixture width 450 is far above the default rebuild's ~192px here, so this proves a restore.
      await expect
        .poll(async () => {
          return await page.locator('[data-testid="panel-sessions"]').evaluate(el => {
            const group = el.closest('.dv-view')
            return group ? group.offsetWidth : 0
          })
        })
        .toBeGreaterThan(savedWidth - 100)
    })

    // SPEC: layout:auto-copy
    test('new session without previous layout gets default layout', async ({ page }) => {
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

      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: layout:auto-copy
    test('inherited layout triggers save for new session', async ({ page }) => {
      const sessionALayout = loadFixture('layouts/sessions-open.json')

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

      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)

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

      const initialWidth = await page.locator('[data-testid="panel-chat"]').evaluate(el => {
        return el.getBoundingClientRect().width
      })

      // Close every default-open panel: left sessions/bookmarks/boards, right todos/stash/tasks.
      await toggleSessionsPanel(page)
      await page.keyboard.press('Alt+5') // bookmarks
      await page.keyboard.press('Alt+6') // boards
      await toggleTodosPanel(page)
      await toggleStashPanel(page)
      await page.keyboard.press('Alt+4') // tasks

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

      const todosPanel = page.locator('[data-testid="panel-todos"]')
      await expect(todosPanel).toBeVisible()
      const initialWidth = await todosPanel.evaluate(el => el.getBoundingClientRect().width)

      await toggleTodosPanel(page)
      await expect(todosPanel).not.toBeVisible()
      await toggleStashPanel(page)
      await expect(page.locator('[data-testid="stash-empty"]')).not.toBeVisible()

      await openTodosPanel(page)

      await expect
        .poll(async () => {
          const restoredWidth = await todosPanel.evaluate(el => el.getBoundingClientRect().width)
          return Math.abs(restoredWidth - initialWidth)
        })
        .toBeLessThan(50)
    })

    // SPEC: layout:panel-drag-invalidate
    // MOCK-LIMITED: dockview drag/sash setPointerCapture() isn't simulable - checks sashes exist.
    test('resize sashes exist for panel width adjustment', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const todosPanel = page.locator('[data-testid="panel-todos"]')
      await expect(todosPanel).toBeVisible()

      const sashes = page.locator('.dv-sash')
      const sashCount = await sashes.count()
      expect(sashCount).toBeGreaterThan(0)

      const cursor = await sashes.first().evaluate(el => getComputedStyle(el).cursor)
      expect(cursor).toMatch(/ew-resize|col-resize|pointer/)

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

      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      const getSessionsWidth = () =>
        page.locator('[data-testid="panel-sessions"]').evaluate(el => {
          const group = el.closest('.dv-view')
          return group ? group.offsetWidth : 0
        })
      const initialWidth = await getSessionsWidth()
      expect(initialWidth).toBeGreaterThan(0)

      const stashTab = page.locator('.icon-tab').filter({ hasText: 'Stash' })
      await expect(stashTab).toBeVisible()
      await stashTab.dblclick()

      // The width read can throw once the panel unmounts while maximized; treat that as 0.
      await expect
        .poll(async () => {
          try {
            return await getSessionsWidth()
          } catch {
            return 0
          }
        })
        .toBeLessThan(5)

      // Alt+1 toggles sessions.
      await page.keyboard.press('Alt+1')

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

      await expect(page.locator('[data-testid="panel-mcp"]')).not.toBeVisible()

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

      // Alt+8 toggles MCP.
      await page.keyboard.press('Alt+8')

      await expect(page.locator('[data-testid="panel-mcp"]')).toBeVisible()

      // Sessions was open before maximize, so unmaximizing should restore it too.
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

      // MCP is hidden by default (SPEC section 1.6) - choose it for the closed-panel case.
      await expect(page.locator('[data-testid="panel-mcp"]')).not.toBeVisible()

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

      // Maximizing lets the floating preview render on hover; side-panel collapse stands in as the
      // maximize signal since dockview's dv-groupview-maximized class isn't always set when mocked.
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

      // Default Desktop Chrome viewport (1280x720): 0.6x1280=768 is below the 800px floor, so the
      // formula resolves to 800; a naive max(300, 0.4x viewport) would give 512, ruled out below.
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

      await expect(page.locator('[data-testid="bottom-panel-container"]')).not.toBeVisible()

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

      // .panel-control-btn scopes to the chat control bar, not the sessions panel's pin.
      const pinBtn = page.locator('.panel-control-btn[title="Pin session"]')
      await expect(pinBtn).toBeVisible()
    })

    // SPEC: chat:control-pin
    test('pin button toggles pressed state on click', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const pinBtn = page.locator('.panel-control-btn[title="Pin session"]')
      await expect(pinBtn).toBeVisible()
      await expect(pinBtn).not.toHaveClass(/pressed/)

      await pinBtn.click()

      const pinnedBtn = page.locator('.panel-control-btn[title="Unpin session"]')
      await expect(pinnedBtn).toHaveClass(/pressed/)
      await expect(pinnedBtn).toHaveAttribute('aria-pressed', 'true')

      await pinnedBtn.click()

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
      // Overrides the outer beforeEach's default mock; the latest matching Playwright route wins.
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

      // The new-tab path triggers window.open rather than modifying this tab's session view.
      const opened = await page.evaluate(() => window.__opened || [])
      expect(opened.length).toBeGreaterThan(0)
    })
  })
})
