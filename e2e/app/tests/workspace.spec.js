/** E2E tests for workspace discovery, switcher, and URL routing. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  loadFixture,
  mockAPI,
} from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

/** Mock workspace discovery with a custom list; call after mockAPI (Playwright routes resolve LIFO). */
async function mockWorkspaces(page, workspaces) {
  await page.route('**/api/workspaces', async route => {
    await route.fulfill({ json: { workspaces } })
  })
}

const TWO_WORKSPACES = [
  { id: DEFAULT_WORKSPACE_ID, path: '/home/user/project', name: 'project' },
  { id: 'project-b', path: '/home/user/project-b', name: 'project-b' },
]

test.describe('Workspace Discovery', () => {
  // SPEC: workspace:discovery
  test('fetches workspaces on page load', async ({ page }) => {
    let workspacesFetched = false
    await mockAPI(page)
    await mockSSE(page)
    // Playwright routes resolve LIFO, so this override must be registered after mockAPI.
    await page.route('**/api/workspaces', async route => {
      workspacesFetched = true
      await route.fulfill({
        json: {
          workspaces: [{ id: DEFAULT_WORKSPACE_ID, path: '/home/user/project', name: 'project' }],
        },
      })
    })
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    expect(workspacesFetched).toBe(true)
  })

  // SPEC: workspace:auto-select
  test('single workspace auto-selected; no list dropdown shown', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    // mockAPI's default provides a single workspace.
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')

    // The color palette trigger is still allowed; only the multi-workspace dropdown is suppressed.
    const dropdownTrigger = page.locator(
      '[data-testid="workspace-switcher"] button[aria-haspopup="listbox"], [data-testid="workspace-switcher-dropdown-trigger"]',
    )
    await expect(dropdownTrigger).toHaveCount(0)
  })

  // SPEC: workspace:selection-priority
  test('URL hash takes priority over localStorage', async ({ page }) => {
    await mockAPI(page)
    await mockWorkspaces(page, TWO_WORKSPACES)
    await mockSSE(page)

    await page.addInitScript(() => {
      localStorage.setItem('claudebox-workspace-id', 'project-b')
    })

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    const switcher = page.locator('[data-testid="workspace-switcher"]')
    await expect(switcher).toContainText(DEFAULT_WORKSPACE_ID)
  })

  // SPEC: workspace:selection-priority
  test('localStorage used when no hash workspace', async ({ page }) => {
    await mockAPI(page)
    await mockWorkspaces(page, TWO_WORKSPACES)
    await mockSSE(page)

    await page.addInitScript(wsId => {
      localStorage.setItem('claudebox-workspace-id', wsId)
    }, DEFAULT_WORKSPACE_ID)

    await page.goto('/')
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText(
      DEFAULT_WORKSPACE_ID,
    )
  })

  // SPEC: workspace:selection-priority
  test('falls back to first workspace when no hash or localStorage', async ({ page }) => {
    await mockAPI(page)
    await mockWorkspaces(page, TWO_WORKSPACES)
    await mockSSE(page)

    await page.goto('/')
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText(
      DEFAULT_WORKSPACE_ID,
    )
  })
})

test.describe('Workspace Switcher', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockWorkspaces(page, TWO_WORKSPACES)
    await mockSSE(page)
  })

  // SPEC: workspace:switcher
  test('switcher renders in chat-group tab bar AND right-aligned within it', async ({ page }) => {
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    const switcher = page.locator('[data-testid="workspace-switcher"]')
    await expect(switcher).toBeVisible()

    // The switcher's nearest ancestor tab bar must belong to the chat group (contain panel-chat).
    const inChatGroup = await switcher.evaluate(el => {
      const bar =
        el.closest('.dv-tabs-and-actions-container, .tab-bar, .dv-groupview') || el.parentElement
      return bar
        ? !!bar.querySelector('[data-testid="panel-chat"], [data-id="chat"]') ||
            bar.closest('.dv-groupview')?.querySelector('[data-testid="panel-chat"]') !== null
        : false
    })
    expect(inChatGroup, 'switcher should sit inside the chat group').toBe(true)

    // Right-aligned means the switcher's right edge sits within slack of the bar's right edge.
    const positions = await switcher.evaluate(el => {
      const rect = el.getBoundingClientRect()
      const bar =
        el.closest('.dv-tabs-and-actions-container') || el.closest('.tab-bar') || el.parentElement
      const barRect = bar.getBoundingClientRect()
      return { switcherRight: rect.right, barRight: barRect.right, barLeft: barRect.left }
    })
    expect(Math.abs(positions.barRight - positions.switcherRight)).toBeLessThan(40)
  })

  // SPEC: workspace:switcher-label
  test('shows current workspace name with chevron', async ({ page }) => {
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    const switcher = page.locator('[data-testid="workspace-switcher"]')
    await expect(switcher).toContainText(DEFAULT_WORKSPACE_ID)
    await expect(switcher.locator('svg')).toBeVisible()
  })

  // SPEC: workspace:switcher-visibility
  test('shows only color palette for single workspace', async ({ page }) => {
    // Uses the default workspace ID so mockAPI's other endpoints still resolve.
    await mockWorkspaces(page, [
      { id: DEFAULT_WORKSPACE_ID, path: '/home/user/project', name: 'project' },
    ])
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const switcher = page.locator('[data-testid="workspace-switcher"]')
    await expect(switcher).toBeVisible()

    await switcher.click()
    const dropdown = page.locator('[data-testid="workspace-switcher-dropdown"]')
    await expect(dropdown).toBeVisible()
    await expect(dropdown.locator('[data-testid="workspace-color-palette"]')).toBeVisible()
    await expect(dropdown.locator('.workspace-switcher-option')).not.toBeVisible()
  })

  // SPEC: workspace:switcher-list
  test('dropdown lists all workspaces with paths and checkmark on active', async ({ page }) => {
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    await page.locator('[data-testid="workspace-switcher"]').click()
    const dropdown = page.locator('[data-testid="workspace-switcher-dropdown"]')
    await expect(dropdown).toBeVisible()

    await expect(dropdown).toContainText(DEFAULT_WORKSPACE_ID)
    await expect(dropdown).toContainText('project-b')
    await expect(dropdown).toContainText('/home/user/project')
    await expect(dropdown).toContainText('/home/user/project-b')

    const selected = dropdown.locator('.workspace-switcher-option.selected')
    await expect(selected).toContainText(DEFAULT_WORKSPACE_ID)
  })

  // SPEC: workspace:switcher-new-tab
  test('workspace rows have external link button for new browser tab', async ({ page }) => {
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    await page.locator('[data-testid="workspace-switcher"]').click()
    const dropdown = page.locator('[data-testid="workspace-switcher-dropdown"]')
    await expect(dropdown).toBeVisible()

    const newTabBtns = dropdown.locator('.workspace-switcher-newtab')
    await expect(newTabBtns).toHaveCount(2)
    await expect(newTabBtns.first()).toHaveAttribute('title', 'Open in new browser tab')
  })

  // SPEC: workspace:switcher-middle-click
  test('workspace option has onAuxClick handler for middle-click new tab', async ({ page }) => {
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    await page.locator('[data-testid="workspace-switcher"]').click()
    const dropdown = page.locator('[data-testid="workspace-switcher-dropdown"]')
    await expect(dropdown).toBeVisible()

    // Verify the handler is wired by checking middle-click opens a new window
    const option = dropdown.locator('.workspace-switcher-option').first()
    const newPagePromise = page
      .context()
      .waitForEvent('page', { timeout: 3000 })
      .catch(() => null)
    await option.click({ button: 'middle' })
    const newPage = await newPagePromise
    // window.open may be blocked in test - verify dropdown closed (handler ran)
    if (newPage) {
      await newPage.close()
    }
    await expect(dropdown).not.toBeVisible()
  })

  // SPEC: workspace:switcher-reset
  test('switching workspaces updates footer workspace name', async ({ page }) => {
    await page.route('**/api/workspaces/project-b/sessions', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { sessions: [] } })
      }
    })
    await page.route('**/api/workspaces/project-b/ui-state*', async route => {
      await route.fulfill({ json: { global: {}, session: {} } })
    })

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    await page.locator('[data-testid="workspace-switcher"]').click()
    await page.locator('.workspace-switcher-option:has-text("project-b")').click()

    await expect.poll(() => page.url()).toContain('project-b')

    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('project-b')
  })

  // SPEC: workspace:deregister
  // SPEC: workspace:deregister-preserves-marker
  test('trash icon on a workspace row opens confirm modal and DELETEs on confirm', async ({
    page,
  }) => {
    let deletedId = null
    await page.route('**/api/workspaces/project-b', async route => {
      if (route.request().method() === 'DELETE') {
        deletedId = 'project-b'
        await route.fulfill({ status: 200, json: { id: 'project-b', status: 'deregistered' } })
      } else {
        await route.continue()
      }
    })
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)
    await page.locator('[data-testid="workspace-switcher"]').click()
    await expect(page.locator('[data-testid="workspace-switcher-dropdown"]')).toBeVisible()

    // Trash icon present per workspace row (hover-revealed; click bypasses CSS opacity gate).
    const trash = page.locator('[data-testid="workspace-switcher-trash-project-b"]')
    await expect(trash).toHaveCount(1)
    await trash.click()

    const confirm = page.locator('[data-testid="confirm-deregister-modal"]')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('.workspace marker file on disk is preserved')

    await page.locator('[data-testid="confirm-deregister-confirm"]').click()
    await expect.poll(() => deletedId, { timeout: 4000 }).toBe('project-b')
  })

  // SPEC: workspace:register
  test('"+ Register workspace…" footer item opens modal that POSTs the path', async ({ page }) => {
    let registeredPath = null
    await page.route('**/api/workspaces', async route => {
      if (route.request().method() === 'POST') {
        const body = await route.request().postDataJSON()
        registeredPath = body.path
        await route.fulfill({ status: 200, json: { id: 'new-ws', path: body.path } })
      } else {
        await route.continue()
      }
    })
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)
    await page.locator('[data-testid="workspace-switcher"]').click()
    await page.locator('[data-testid="workspace-switcher-register"]').click()

    const modal = page.locator('[data-testid="register-workspace-modal"]')
    await expect(modal).toBeVisible()

    await page.locator('[data-testid="register-workspace-input"]').fill('/home/user/new-ws')
    await page.locator('[data-testid="register-workspace-confirm"]').click()

    await expect.poll(() => registeredPath, { timeout: 4000 }).toBe('/home/user/new-ws')
  })

  // SPEC: workspace:register-idempotent
  test('registering an already-known path shows inline notice and auto-closes', async ({
    page,
  }) => {
    await page.route('**/api/workspaces', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          json: { id: 'project-a', path: '/home/user/project-a', already_registered: true },
        })
      } else {
        await route.continue()
      }
    })
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)
    await page.locator('[data-testid="workspace-switcher"]').click()
    await page.locator('[data-testid="workspace-switcher-register"]').click()

    const modal = page.locator('[data-testid="register-workspace-modal"]')
    await expect(modal).toBeVisible()
    await page.locator('[data-testid="register-workspace-input"]').fill('/home/user/project-a')
    await page.locator('[data-testid="register-workspace-confirm"]').click()

    const notice = page.locator('[data-testid="register-workspace-notice"]')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Already registered as project-a')
  })
})

test.describe('URL Routing', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
  })

  // SPEC: workspace:url-routing
  test('uses hash-based routing format', async ({ page }) => {
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    const url = page.url()
    expect(url).toContain(`#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
  })

  // SPEC: workspace:url-deep-link
  test('deep link loads correct session', async ({ page }) => {
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    // Footer shows only the session id's first fragment.
    await expect(page.locator('[data-testid="footer-session"]')).toContainText(
      DEFAULT_SESSION_ID.split('-')[0],
    )
  })

  // SPEC: workspace:url-cross-workspace
  test('deep link to different workspace triggers workspace switch', async ({ page }) => {
    await mockWorkspaces(page, TWO_WORKSPACES)
    await page.route('**/api/workspaces/project-b/**', async route => {
      const url = route.request().url()
      if (url.includes('/sessions/') && url.includes('/resume')) {
        await route.fulfill({
          json: { session_id: 'cross-ws-session', container_id: DEFAULT_CONTAINER_ID },
        })
      } else if (url.includes('/sessions') && route.request().method() === 'GET') {
        await route.fulfill({ json: { sessions: [] } })
      } else if (url.includes('/ui-state')) {
        await route.fulfill({ json: { global: {}, session: {} } })
      } else if (url.includes(`/containers/${DEFAULT_CONTAINER_ID}/api/sessions/current`)) {
        await route.fulfill({ json: loadFixture('status/default.json') })
      } else {
        await route.continue()
      }
    })

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    await page.evaluate(() => {
      window.location.hash = '#/workspaces/project-b/sessions/cross-ws-session'
    })

    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('project-b')
  })

  // SPEC: workspace:url-update
  test('URL updates on new session creation', async ({ page }) => {
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}`)
    await waitForAppReady(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()

    await expect.poll(() => page.url()).toContain('new-session-id')
  })
})
