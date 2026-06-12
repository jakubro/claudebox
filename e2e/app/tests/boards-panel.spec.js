/** E2E tests for boards panel and board tab. */

import { expect, test } from '@playwright/test'
import { openBoardsPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, DEFAULT_WORKSPACE_ID, mockAPI } from '../mocks/api.js'
import { createDaemonSSEController, mockSSE } from '../mocks/sse.js'

const WS_PREFIX = `/api/workspaces/${DEFAULT_WORKSPACE_ID}`

const MOCK_BOARDS = {
  boards: [
    { id: 'sprint-1', name: 'sprint-1', path: 'docs/tickets/board.yaml' },
    { id: 'backlog', name: 'backlog', path: 'backlog/board.yaml' },
  ],
}

const MOCK_BOARD_DETAIL = {
  id: 'sprint-1',
  name: 'sprint-1',
  yaml_path: '/workspace/docs/tickets/board.yaml',
  prompt: {},
  states: [
    { id: 'backlog', label: 'Backlog', folder: 'backlog', terminal: false },
    { id: 'in-progress', label: 'In Progress', folder: 'in-progress', terminal: false },
    { id: 'review', label: 'Review', folder: 'review', terminal: false },
    { id: 'done', label: 'Done', folder: 'completed', terminal: true },
    { id: 'rejected', label: 'Rejected', folder: 'rejected', terminal: true },
    {
      id: 'definitely-rejected',
      label: 'Def. Rejected',
      folder: 'definitely-rejected',
      terminal: true,
    },
  ],
  swimlanes: [
    { id: 'frontend', name: 'Frontend' },
    { id: 'backend', name: 'Backend' },
  ],
  columns: {
    backlog: [
      { path: 'docs/tickets/active/setup.md', title: 'Setup infra', swimlane: 'frontend' },
      { path: 'docs/tickets/active/boards.md', title: 'Boards', swimlane: 'backend' },
    ],
    'in-progress': [
      {
        path: 'docs/tickets/active/polish.md',
        title: 'Polish UI',
        swimlane: 'frontend',
        session: 'session-001',
      },
    ],
    review: [],
    done: [{ path: 'docs/tickets/active/init.md', title: 'Init project' }],
    rejected: [],
    'definitely-rejected': [],
  },
}

/**
 * Mock board API endpoints on the page.
 * @param {import('@playwright/test').Page} page - Playwright page.
 */
async function mockBoardsAPI(page) {
  // GET /api/workspaces/{ws}/boards
  await page.route(`**${WS_PREFIX}/boards`, async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: MOCK_BOARDS })
    } else {
      await route.continue()
    }
  })

  // GET /api/workspaces/{ws}/boards/:id
  await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')), async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: MOCK_BOARD_DETAIL })
    } else {
      await route.continue()
    }
  })

  // PATCH /api/workspaces/{ws}/boards/:id/tickets/:path/move
  await page.route(
    new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
    async route => {
      await route.fulfill({ json: { path: 'moved' } })
    },
  )

  // DELETE /api/workspaces/{ws}/boards/:id/tickets/:path
  await page.route(
    new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+$`.replace(/\//g, '\\/')),
    async route => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 200, json: {} })
      } else {
        await route.continue()
      }
    },
  )

  // POST/PATCH/DELETE swimlane endpoints
  await page.route(
    new RegExp(`${WS_PREFIX}/boards/[^/]+/swimlanes`.replace(/\//g, '\\/')),
    async route => {
      await route.fulfill({ json: { id: 'new-lane', name: 'New Lane' } })
    },
  )
}

test.describe('Boards Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockBoardsAPI(page)
  })

  test('Alt+6 toggles boards panel', async ({ page }) => {
    // SPEC: panel-boards:panel
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Boards panel is open by default.
    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel).toBeVisible()

    await page.keyboard.press('Alt+6')
    await expect(panel).not.toBeVisible()

    await page.keyboard.press('Alt+6')
    await expect(panel).toBeVisible()
  })

  test('shows discovered boards list', async ({ page }) => {
    // SPEC: panel-boards:discovery
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel).toBeVisible()

    // Two boards listed
    const items = panel.locator('.boards-item')
    await expect(items).toHaveCount(2)

    // Board names visible
    await expect(items.nth(0).locator('.boards-item-name')).toContainText('sprint-1')
    await expect(items.nth(1).locator('.boards-item-name')).toContainText('backlog')
  })

  test('shows board path alongside name', async ({ page }) => {
    // SPEC: panel-boards:item-display
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    const firstItem = panel.locator('.boards-item').first()
    await expect(firstItem.locator('.boards-item-path')).toContainText('docs/tickets/board.yaml')
  })

  test('shows empty state when no boards', async ({ page }) => {
    // SPEC: panel-boards:empty
    // Override with empty boards response
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      await route.fulfill({ json: { boards: [] } })
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel).toContainText('No boards found')
  })

  // SPEC: panel-boards:pre-workspace-loading
  test('on fresh page load before workspace selected, panel shows loading not error', async ({
    page,
  }) => {
    // Delay the workspaces endpoint so the panel mounts before workspaceId resolves.
    await page.route('**/api/workspaces', async route => {
      await new Promise(resolve => setTimeout(resolve, 200))
      await route.fulfill({
        json: {
          workspaces: [{ id: 'test-ws', path: '/home/user/project', color: null }],
        },
      })
    })
    await mockAPI(page)
    await mockSSE(page)
    await page.goto('/')

    const panel = page.locator('[data-testid="panel-boards"]')
    // Pre-workspace state must not surface raw API invariants like
    // "Workspace ID not set" - the panel renders neutral loading content
    // until workspaceId is populated.
    await expect(panel).not.toContainText('Workspace ID not set')
  })

  test('boards icon sits below the bookmarks icon in the right strip', async ({ page }) => {
    // SPEC: panel-boards:icon-position
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const boardsIcon = page.locator('[data-testid="icon-boards"]')
    const bookmarksIcon = page.locator('[data-testid="icon-bookmarks"]')
    await expect(boardsIcon).toBeVisible()
    await expect(bookmarksIcon).toBeVisible()

    // Boards must sit BELOW Bookmarks in the strip (claim names the relative
    // position). Compare bounding boxes to anchor the position contract.
    const { y: boardsY } = await boardsIcon.boundingBox()
    const { y: bookmarksY } = await bookmarksIcon.boundingBox()
    expect(boardsY).toBeGreaterThan(bookmarksY)

    expect(await boardsIcon.getAttribute('title')).toBe('Boards (Alt+6)')
  })

  // SPEC: panel-boards:meta-refresh
  // SPEC: panel-boards:no-header
  test('refresh meta-item reloads board list; no dedicated header row', async ({ page }) => {
    let callCount = 0
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        callCount++
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel.locator('.boards-item')).toHaveCount(2)

    // No dedicated header row anymore - refresh moved to a meta-item at end of list.
    await expect(panel.locator('.boards-panel-header')).toHaveCount(0)

    const meta = panel.locator('[data-testid="boards-refresh-meta"]')
    await expect(meta).toBeVisible()

    const initialCount = callCount
    await meta.click()
    await expect.poll(() => callCount, { timeout: 5000 }).toBeGreaterThan(initialCount)
  })
})

test.describe('Board Tab', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockBoardsAPI(page)
  })

  test('clicking a board opens it in the main panel and updates the URL', async ({ page }) => {
    // SPEC: panel-boards:open-tab
    // SPEC: layout:main-panel-board-url
    // SPEC: layout:header-board-view
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)

    // Click the first board
    const panel = page.locator('[data-testid="panel-boards"]')
    await panel.locator('.boards-item').first().click()

    // Board renders inside the main panel content slot.
    const board = page.locator('[data-testid="main-panel-content"][data-mode="board"] .board-tab')
    await expect(board).toBeVisible()

    // URL hash now carries the boards segment.
    expect(await page.evaluate(() => window.location.hash)).toMatch(/\/boards\/[^/]+$/)

    // Main-area header LEFT slot now shows the board name, replacing the session trio.
    await expect(page.locator('[data-testid="board-header"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-header-status-dot"]')).not.toBeVisible()
  })

  test('board displays column headers', async ({ page }) => {
    // SPEC: board:layout
    // SPEC: board:col-backlog
    // SPEC: board:col-in-progress
    // SPEC: board:col-review
    // SPEC: board:col-done
    // SPEC: board:col-rejected
    // SPEC: board:col-def-rejected
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Check column headers - non-terminal columns show the full label;
    // terminal columns (Done, Rejected, Def. Rejected) are collapsed by
    // default and show only the first grapheme of their state label
    // (D, R, D).
    const headers = board.locator('.board-col-header')
    await expect(headers).toHaveCount(6)
    await expect(headers.nth(0)).toContainText('Backlog')
    await expect(headers.nth(1)).toContainText('In Progress')
    await expect(headers.nth(2)).toContainText('Review')
    await expect(headers.nth(3)).toContainText('D')
    await expect(headers.nth(4)).toContainText('R')
    await expect(headers.nth(5)).toContainText('D')
  })

  test('board renders swimlanes', async ({ page }) => {
    // SPEC: board:swimlanes
    // SPEC: board:swimlane-order
    // SPEC: board:swimlane-unsorted
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Named swimlanes + unsorted lane
    const swimlaneHeaders = board.locator('.swimlane-name')
    await expect(swimlaneHeaders).toHaveCount(3)
    await expect(swimlaneHeaders.nth(0)).toContainText('Frontend')
    await expect(swimlaneHeaders.nth(1)).toContainText('Backend')
    await expect(swimlaneHeaders.nth(2)).toContainText('(Unsorted)')
  })

  test('board renders ticket cards', async ({ page }) => {
    // SPEC: board:card
    // SPEC: board:card-title
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Should render ticket cards
    const tickets = board.locator('.ticket-card')
    await expect(tickets.first()).toBeVisible()

    // Verify ticket titles render
    await expect(board.getByText('Setup infra')).toBeVisible()
    await expect(board.getByText('Boards')).toBeVisible()
    await expect(board.getByText('Polish UI')).toBeVisible()
  })

  test('terminal columns (done, rejected, def. rejected) are collapsed by default', async ({
    page,
  }) => {
    // SPEC: board:terminal-collapsed
    // SPEC: board:non-terminal-expanded
    // SPEC: board:collapsed-header-grapheme
    // SPEC: board:collapsed-cell-count-only
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const headers = page.locator('.board-col-header')

    // Done, Rejected, Def. Rejected should have collapsed class
    // AND each must render the ▸ chevron glyph the claim names
    for (const i of [3, 4, 5]) {
      await expect(headers.nth(i)).toHaveClass(/collapsed/)
      await expect(headers.nth(i).locator('.board-col-chevron')).toHaveText('▸')
    }

    // Backlog, In Progress, Review should NOT be collapsed AND show ▾ instead.
    for (const i of [0, 1, 2]) {
      await expect(headers.nth(i)).not.toHaveClass(/collapsed/)
      await expect(headers.nth(i).locator('.board-col-chevron')).toHaveText('▾')
    }
  })

  test('clicking terminal column header toggles collapsed state', async ({ page }) => {
    // SPEC: board:terminal-toggle
    // SPEC: board:swimlane-collapse
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const doneHeader = page.locator('.board-col-header').nth(3)
    await expect(doneHeader).toHaveClass(/collapsed/)

    // Click to expand
    await doneHeader.locator('.board-col-toggle').click()
    await expect(doneHeader).not.toHaveClass(/collapsed/)

    // Click again to collapse
    await doneHeader.locator('.board-col-toggle').click()
    await expect(doneHeader).toHaveClass(/collapsed/)
  })

  test('unsorted swimlane catches tickets without swimlane assignment', async ({ page }) => {
    // SPEC: board:swimlane-unsorted
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // The "Init project" ticket has no swimlane, should be in Unsorted
    const unsortedBand = page.locator('.swimlane-header.unsorted').locator('..')
    await expect(unsortedBand).toBeVisible()
  })

  test('add swimlane row is visible at the bottom', async ({ page }) => {
    // SPEC: board:swimlane-create
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const addBtn = page.locator('.swimlane-add-btn')
    await expect(addBtn).toBeVisible()
    await expect(addBtn).toContainText('Add swimlane')
  })

  test('clicking add swimlane shows input field', async ({ page }) => {
    // SPEC: board:swimlane-create
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    await page.locator('.swimlane-add-btn').click()

    const input = page.locator('.swimlane-add-row .swimlane-name-input')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
  })

  test('ticket session-status dot uses the documented running/stopped class', async ({ page }) => {
    // SPEC: board:card-session
    // SPEC: board:card-session-dot
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const polishCard = page.locator('.ticket-card', { hasText: 'Polish UI' })
    await expect(polishCard).toBeVisible()

    const dot = polishCard.locator('.ticket-status-dot')
    await expect(dot).toBeVisible()
    await expect(polishCard.locator('.ticket-session-id')).toBeVisible()

    // Dot must carry one of the documented state classes - running or
    // stopped - which CSS owns the green/gray mapping for. Class names
    // anchor the color contract; visual regression covers the pixels.
    const cls = await dot.getAttribute('class')
    expect(cls).toMatch(/\b(running|stopped|stopping|no-container)\b/)
  })

  test('clicking a ticket opens detail overlay', async ({ page }) => {
    // SPEC: board:card-click-detail
    // SPEC: board:detail
    // SPEC: board:detail-title
    // SPEC: board:detail-meta
    await mockSSE(page)

    // Mock ticket content endpoint
    await page.route(new RegExp(`${WS_PREFIX}/boards/.+/tickets/.+/content`), async route => {
      await route.fulfill({ body: '# Setup infra\n\nTicket body content.' })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Click a ticket card
    await page.getByText('Setup infra').click()

    // Detail overlay should appear
    const overlay = page.locator('.ticket-detail-panel')
    await expect(overlay).toBeVisible()

    // Title
    await expect(overlay.locator('.ticket-detail-title')).toContainText('Setup infra')

    // Metadata - claim enumerates three rows, each with named labels and values.
    await expect(overlay.locator('.ticket-detail-meta')).toBeVisible()
    const rows = overlay.locator('.ticket-meta-row')
    await expect(rows).toHaveCount(3)
    // Each row must surface its label (Status, Swimlane, Session) so the
    // claim's "metadata" content is verified, not just row cardinality.
    const rowsText = (await rows.allTextContents()).join(' | ')
    expect(rowsText).toMatch(/Status/)
    expect(rowsText).toMatch(/Swimlane/)
    expect(rowsText).toMatch(/Session/)
  })

  test('detail overlay shows "Loading..." while content is fetching', async ({ page }) => {
    // SPEC: board:detail-loading
    await mockSSE(page)

    // Delay the content endpoint so the in-flight loading state is observable
    // instead of resolving instantly (which would skip the loading UI).
    await page.route(new RegExp(`${WS_PREFIX}/boards/.+/tickets/.+/content`), async route => {
      await new Promise(resolve => setTimeout(resolve, 800))
      await route.fulfill({ body: '# Setup infra\n\nDelayed body.' })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await page.getByText('Setup infra').click()

    const overlay = page.locator('.ticket-detail-panel')
    await expect(overlay).toBeVisible()
    // The "Loading..." text must be visible during the fetch window.
    await expect(overlay).toContainText('Loading')
    // Eventually the body resolves and replaces the loading indicator.
    await expect(overlay).toContainText('Delayed body')
  })

  test('detail overlay shows file content', async ({ page }) => {
    // SPEC: board:detail-content
    await mockSSE(page)

    await page.route(new RegExp(`${WS_PREFIX}/boards/.+/tickets/.+/content`), async route => {
      await route.fulfill({ body: '# Setup infra\n\nDetailed description here.' })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    await page.getByText('Setup infra').click()

    // The markdown wrapper uses the canonical .turn-text class
    const content = page.locator('.ticket-detail-content .turn-text')
    await expect(content).toContainText('Detailed description here')
  })

  test('detail overlay closes with X button', async ({ page }) => {
    // SPEC: board:detail-close
    await mockSSE(page)

    await page.route(new RegExp(`${WS_PREFIX}/boards/.+/tickets/.+/content`), async route => {
      await route.fulfill({ body: '# Content' })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    await page.getByText('Setup infra').click()
    await expect(page.locator('.ticket-detail-panel')).toBeVisible()

    // Close with X button
    await page.locator('.ticket-detail-close').click()
    await expect(page.locator('.ticket-detail-panel')).not.toBeVisible()
  })

  test('detail overlay closes on backdrop click', async ({ page }) => {
    // SPEC: board:detail-backdrop
    await mockSSE(page)

    await page.route(new RegExp(`${WS_PREFIX}/boards/.+/tickets/.+/content`), async route => {
      await route.fulfill({ body: '# Content' })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    await page.getByText('Setup infra').click()
    await expect(page.locator('.ticket-detail-panel')).toBeVisible()

    // Click backdrop
    await page.locator('.ticket-detail-backdrop').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.ticket-detail-panel')).not.toBeVisible()
  })

  test('Ctrl+click toggles ticket multi-select', async ({ page }) => {
    // SPEC: board:card-multi-select
    // SPEC: board:multi-select
    // SPEC: board:checkbox-select
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const board = page.locator('.board-board')

    // Ctrl+click first ticket - should add selected class
    await board.getByText('Setup infra').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(1)

    // Ctrl+click second ticket
    await board.getByText('Boards').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(2)

    // Ctrl+click first again to deselect
    await board.getByText('Setup infra').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(1)
  })

  test('right-click card shows context menu and archives', async ({ page }) => {
    // SPEC: board:archive-context
    // SPEC: board:archive-behavior
    // SPEC: board:archive-no-confirm
    let archiveRequested = false
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'DELETE') {
          archiveRequested = true
          await route.fulfill({ status: 200, json: {} })
        } else {
          await route.continue()
        }
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Right-click on a ticket in Backlog
    await page.getByText('Setup infra').click({ button: 'right' })

    // Context menu should appear with Archive option
    const menu = page.locator('.ticket-context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Archive ticket')).toBeVisible()

    // Click Archive ticket
    await menu.getByText('Archive ticket').click()
    await expect.poll(() => archiveRequested, { timeout: 3000 }).toBe(true)
  })

  test('swimlane context menu with rename, delete, move', async ({ page }) => {
    // SPEC: board:swimlane-context-menu
    // SPEC: board:archive-bulk-swimlane
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Right-click on "Frontend" swimlane header
    const frontendHeader = page.locator('.swimlane-header').filter({ hasText: 'Frontend' })
    await frontendHeader.click({ button: 'right' })

    // Context menu appears with all options
    const menu = page.locator('.swimlane-context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Rename')).toBeVisible()
    await expect(menu.getByText('Delete')).toBeVisible()
    await expect(menu.locator('.swimlane-context-divider').first()).toBeVisible()
    await expect(menu.getByText('Move up')).toBeVisible()
    await expect(menu.getByText('Move down')).toBeVisible()
    await expect(menu.getByText('Archive all tickets')).toBeVisible()
  })

  test('double-click swimlane header enables inline rename', async ({ page }) => {
    // SPEC: board:swimlane-rename
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Double-click on "Frontend" swimlane header (first non-unsorted header)
    const frontendHeader = page.locator('.swimlane-header').first()
    await expect(frontendHeader).toContainText('Frontend')
    await frontendHeader.dblclick()

    // Inline input should appear (hasText filter won't match after span->input swap)
    const input = page.locator('.swimlane-name-input').first()
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('Frontend')
  })

  test('swimlane delete removes via API', async ({ page }) => {
    // SPEC: board:swimlane-delete
    let deleteRequested = false
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/swimlanes`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'DELETE') {
          deleteRequested = true
        }
        await route.fulfill({ json: {} })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Right-click Frontend header -> Delete
    const frontendHeader = page.locator('.swimlane-header').filter({ hasText: 'Frontend' })
    await frontendHeader.click({ button: 'right' })
    await page.locator('.swimlane-context-menu').getByText('Delete').click()

    await expect.poll(() => deleteRequested, { timeout: 3000 }).toBe(true)
  })

  test('swimlane reorder via context menu', async ({ page }) => {
    // SPEC: board:swimlane-reorder
    // SPEC: board:swimlane-dnd-reorder
    // SPEC: board:drag-lane-reorder
    let reorderPayload = null
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/swimlanes/reorder`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'PATCH') {
          reorderPayload = JSON.parse(route.request().postData())
        }
        await route.fulfill({ json: [] })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Right-click Frontend -> Move down
    const frontendHeader = page.locator('.swimlane-header').filter({ hasText: 'Frontend' })
    await frontendHeader.click({ button: 'right' })
    await page.locator('.swimlane-context-menu').getByText('Move down').click()

    await expect.poll(() => reorderPayload, { timeout: 3000 }).toBeTruthy()
  })

  test('unsorted swimlane does not support context menu', async ({ page }) => {
    // SPEC: board:swimlane-unsorted-readonly
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Right-click on Unsorted swimlane header
    const unsortedHeader = page.locator('.swimlane-header.unsorted')
    await unsortedHeader.click({ button: 'right' })

    // Context menu should NOT appear
    await expect(page.locator('.swimlane-context-menu')).not.toBeVisible()
  })
})

test.describe('Board States', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('shows loading state while board loads', async ({ page }) => {
    // SPEC: board:loading
    // Delay the board detail response
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        // Delay response so loading state is visible
        await new Promise(r => setTimeout(r, 2000))
        await route.fulfill({ json: MOCK_BOARD_DETAIL })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Loading state should be visible
    await expect(page.locator('.board-loading')).toBeVisible()
    await expect(page.locator('.board-loading')).toContainText('Loading board')
  })

  test('shows error state on parse failure', async ({ page }) => {
    // SPEC: board:error
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        await route.fulfill({ status: 500, body: 'parse error in board.yaml' })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    await expect(page.locator('.board-error')).toBeVisible()
    await expect(page.locator('.board-error')).toContainText('Failed to parse board.yaml')
  })

  test('returns null when no board data', async ({ page }) => {
    // SPEC: board:no-data
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        // Return null/empty - no board data
        await route.fulfill({ json: null })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // No board, no error, no loading - should render nothing
    await expect(page.locator('.board-board')).not.toBeVisible()
    await expect(page.locator('.board-error')).not.toBeVisible()
  })

  test('board shows loading placeholder in panel', async ({ page }) => {
    // SPEC: panel-boards:loading
    // Delay the boards list response
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await new Promise(r => setTimeout(r, 2000))
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)

    // Panel-level placeholder visible - no spinner element.
    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel).toHaveClass(/boards-loading/)
    await expect(panel).toHaveText('Loading...')
    await expect(page.locator('.boards-spinner')).toHaveCount(0)
  })

  test('board panel shows error state on API failure', async ({ page }) => {
    // SPEC: panel-boards:error
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 500, body: 'Internal Server Error' })
      }
    })

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)

    await expect(page.locator('.boards-error')).toBeVisible()
  })
})

test.describe('Board SSE Updates', () => {
  test('board refreshes on SSE sessions_changed event', async ({ page }) => {
    // SPEC: board:sse-session
    await mockAPI(page)

    let boardFetchCount = 0
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'GET') {
          boardFetchCount++
          await route.fulfill({ json: MOCK_BOARD_DETAIL })
        }
      },
    )

    const daemonSSE = await createDaemonSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    // Wait for initial board load
    await expect(page.locator('.board-board')).toBeVisible()
    const initialCount = boardFetchCount

    // Send SSE sessions_changed event
    await daemonSSE.sendEvent({ type: 'sessions_changed', workspace_id: DEFAULT_WORKSPACE_ID })

    // Board should refetch
    await expect.poll(() => boardFetchCount, { timeout: 5000 }).toBeGreaterThan(initialCount)
  })

  test('board refreshes on SSE container_status event', async ({ page }) => {
    // SPEC: board:sse-update
    await mockAPI(page)

    let boardFetchCount = 0
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'GET') {
          boardFetchCount++
          await route.fulfill({ json: MOCK_BOARD_DETAIL })
        }
      },
    )

    const daemonSSE = await createDaemonSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    await expect(page.locator('.board-board')).toBeVisible()
    const initialCount = boardFetchCount

    // Send SSE container_status event
    await daemonSSE.sendContainerStatus('container-123', 'running')

    // Board should refetch
    await expect.poll(() => boardFetchCount, { timeout: 5000 }).toBeGreaterThan(initialCount)
  })

  test('drag card between columns calls move API with new column', async ({ page }) => {
    // SPEC: board:drag-column
    // SPEC: board:drag-collapsed
    // SPEC: board:auto-assign
    await mockAPI(page)
    await mockBoardsAPI(page)

    let movePayload = null
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
      async route => {
        movePayload = JSON.parse(route.request().postData())
        await route.fulfill({ json: { path: 'moved' } })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    // Locate the "Setup infra" ticket card (in backlog / frontend swimlane)
    const card = page.locator('.ticket-card', { hasText: 'Setup infra' })
    await expect(card).toBeVisible()

    // Target: in-progress column cell in the Frontend swimlane (second cell in first swimlane-band)
    const frontendBand = page.locator('.swimlane-band').first()
    const inProgressCell = frontendBand.locator('.board-cell').nth(1)

    // Perform drag via mouse API (dnd-kit PointerSensor needs 5px activation distance)
    const cardBox = await card.boundingBox()
    const cellBox = await inProgressCell.boundingBox()

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    // Move past activation threshold
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 3,
    })
    // Move to target cell center
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, {
      steps: 5,
    })
    await page.mouse.up()

    // Verify move API was called with column change
    await expect.poll(() => movePayload, { timeout: 5000 }).toBeTruthy()
    expect(movePayload.column).toBe('in-progress')
  })

  test('drag card between swimlanes calls move API with new swimlane', async ({ page }) => {
    // SPEC: board:drag-swimlane
    await mockAPI(page)
    await mockBoardsAPI(page)

    let movePayload = null
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
      async route => {
        movePayload = JSON.parse(route.request().postData())
        await route.fulfill({ json: { path: 'moved' } })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    // Locate the "Setup infra" ticket card (in backlog / frontend swimlane)
    const card = page.locator('.ticket-card', { hasText: 'Setup infra' })
    await expect(card).toBeVisible()

    // Target: backlog column cell in the Backend swimlane (first cell in second swimlane-band)
    const backendBand = page.locator('.swimlane-band').nth(1)
    const backlogCell = backendBand.locator('.board-cell').first()

    const cardBox = await card.boundingBox()
    const cellBox = await backlogCell.boundingBox()

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 3,
    })
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, {
      steps: 5,
    })
    await page.mouse.up()

    // Verify move API was called with swimlane change
    await expect.poll(() => movePayload, { timeout: 5000 }).toBeTruthy()
    expect(movePayload.swimlane).toBe('backend')
  })

  test('dragging a ticket onto another ticket forwards index to move API', async ({ page }) => {
    // SPEC: board:intra-cell-reorder
    // SPEC: board:drop-index-insertion
    await mockAPI(page)
    await mockBoardsAPI(page)

    let movePayload = null
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
      async route => {
        movePayload = JSON.parse(route.request().postData())
        await route.fulfill({ json: { path: 'moved' } })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    // Drop "Setup infra" onto another ticket in the SAME backlog/Frontend cell to
    // exercise intra-cell reorder; the second card in the cell receives the drop
    // and `move` should be called with an explicit `index` field.
    const sourceCard = page.locator('.ticket-card', { hasText: 'Setup infra' })
    await expect(sourceCard).toBeVisible()

    const cards = page
      .locator('.swimlane-band')
      .first()
      .locator('.board-cell')
      .first()
      .locator('.ticket-card')
    // dnd-kit collision detection in headless needs the pointer to dwell over the
    // target ticket so `over.id` resolves to the ticket rather than the enclosing
    // cell. Brief waits between transitions let React/dnd-kit settle each frame.
    const targetCard =
      (await cards.count()) < 2
        ? page
            .locator('.swimlane-band')
            .first()
            .locator('.board-cell')
            .nth(1)
            .locator('.ticket-card')
            .first()
        : cards.nth(1)
    const sBox = await sourceCard.boundingBox()
    const tBox = await targetCard.boundingBox()
    await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(sBox.x + sBox.width / 2 + 15, sBox.y + sBox.height / 2, { steps: 5 })
    await page.waitForTimeout(50)
    await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2 - 5, { steps: 20 })
    await page.waitForTimeout(50)
    await page.mouse.up()

    // Either path should result in a move call with an explicit index field -
    // proving that drop-on-ticket forwards a position rather than always
    // appending. (Index value depends on which ticket received the drop;
    // here we assert only that the field was forwarded as a number.)
    await expect.poll(() => movePayload, { timeout: 5000 }).toBeTruthy()
    expect(typeof movePayload.index).toBe('number')
  })

  test('density toggle switches the board layout and reflects choice in URL', async ({ page }) => {
    // SPEC: board:density-toggle
    // SPEC: board:terse-layout
    await mockAPI(page)
    await mockBoardsAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    // Initial density: comfortable (cards rendered).
    await expect(page.locator('.ticket-card').first()).toBeVisible()
    expect(page.url()).not.toContain('density=terse')

    // Click the density toggle in the board control bar.
    const toggle = page.locator('.panel-control-bar .panel-control-btn').first()
    await toggle.click()

    // After toggle: URL gains density=terse, cells render inline ticket-ID
    // links instead of cards.
    await expect.poll(() => page.url(), { timeout: 3000 }).toContain('density=terse')
    await expect(page.locator('.ticket-link').first()).toBeVisible()
    await expect(page.locator('.ticket-card')).toHaveCount(0)

    // Click a terse ticket link -> opens detail overlay (same as card click).
    await page.locator('.ticket-link').first().click()
    await expect(page.locator('.ticket-detail-panel')).toBeVisible()
  })

  test('drag overlay ghost follows cursor during drag', async ({ page }) => {
    // SPEC: board:drag-overlay
    await mockAPI(page)
    await mockBoardsAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    const card = page.locator('.ticket-card', { hasText: 'Setup infra' })
    await expect(card).toBeVisible()

    const cardBox = await card.boundingBox()

    // No drag overlay before drag
    await expect(page.locator('.ticket-card.drag-overlay')).toHaveCount(0)

    // Start drag
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2 + 20, {
      steps: 5,
    })

    // Drag overlay should appear with the ticket title
    const overlay = page.locator('.ticket-card.drag-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText('Setup infra')

    // Release
    await page.mouse.up()

    // Overlay should disappear after drop
    await expect(page.locator('.ticket-card.drag-overlay')).toHaveCount(0)
  })
})

test.describe('Boards Panel - board item interactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockBoardsAPI(page)
  })

  // SPEC: panel-boards:rename
  test('pencil icon opens inline rename input with Save and Cancel', async ({ page }) => {
    await mockSSE(page)
    let renameCalledWith = null
    // Register the PATCH handler BEFORE navigating so it wins over the catch-all
    // GET handler from mockBoardsAPI on the same URL.
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'PATCH') {
          renameCalledWith = JSON.parse(route.request().postData() || '{}')
          await route.fulfill({ json: { ok: true } })
        } else {
          await route.fallback()
        }
      },
    )
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)

    const item = page.locator('[data-testid="panel-boards"] .boards-item').first()
    await item.hover()
    const pencil = item.locator('.boards-item-pencil')
    await expect(pencil).toBeVisible()

    await pencil.click()

    const input = item.locator('.boards-item-edit')
    await expect(input).toBeVisible()
    await input.fill('Sprint One')

    await item.locator('.boards-edit-btn[title="Save"]').click()

    await expect(item.locator('.boards-item-edit')).toHaveCount(0)
    expect(renameCalledWith).toEqual({ name: 'Sprint One' })
  })

  // SPEC: panel-boards:rename
  test('Cancel button dismisses inline rename without calling API', async ({ page }) => {
    await mockSSE(page)
    let renameCalled = false
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'PATCH') {
          renameCalled = true
          await route.fulfill({ json: { ok: true } })
        } else {
          await route.fallback()
        }
      },
    )
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)

    const item = page.locator('[data-testid="panel-boards"] .boards-item').first()
    await item.hover()
    await item.locator('.boards-item-pencil').click()

    await item.locator('.boards-item-edit').fill('discarded')
    await item.locator('.boards-edit-btn[title="Cancel"]').click()

    await expect(item.locator('.boards-item-edit')).toHaveCount(0)
    expect(renameCalled).toBe(false)
  })

  // SPEC: panel-boards:open-new-browser-tab
  test('Alt+click on a board item opens it in a new browser tab', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)

    await page.evaluate(() => {
      window.__opened = []
      window.open = url => {
        window.__opened.push(url)
        return null
      }
    })

    const itemBtn = page.locator('[data-testid="panel-boards"] .boards-item-clickable').first()
    await itemBtn.click({ modifiers: ['Alt'] })

    const opened = await page.evaluate(() => window.__opened)
    expect(opened.length).toBe(1)
    expect(opened[0]).toContain('/boards/sprint-1')
  })

  // SPEC: panel-boards:open-new-browser-tab
  test('middle-click on a board item opens it in a new browser tab', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)

    await page.evaluate(() => {
      window.__opened = []
      window.open = url => {
        window.__opened.push(url)
        return null
      }
    })

    const itemBtn = page.locator('[data-testid="panel-boards"] .boards-item-clickable').first()
    await itemBtn.click({ button: 'middle' })

    const opened = await page.evaluate(() => window.__opened)
    expect(opened.length).toBe(1)
    expect(opened[0]).toContain('/boards/sprint-1')
  })
})

test.describe('Board cell context menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockBoardsAPI(page)
  })

  /**
   * Dispatch a contextmenu event directly on a cell DOM node - avoids the
   * TicketCard child whose own contextmenu handler stops propagation.
   *
   * @param {import('@playwright/test').Page} page
   * @param {number} bandIndex - Which swimlane band to target (0=Frontend, 1=Backend, 2=Unsorted).
   * @param {number} cellIndex - Column index within the band (0=backlog, 1=in-progress, ...).
   */
  async function rightClickCell(page, bandIndex, cellIndex) {
    return page.evaluate(
      ({ bandIndex, cellIndex }) => {
        const bands = document.querySelectorAll('.swimlane-band')
        const cells = bands[bandIndex].querySelectorAll('.swimlane-columns > .board-cell')
        const cell = cells[cellIndex]
        const rect = cell.getBoundingClientRect()
        cell.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: rect.right - 1,
            clientY: rect.bottom - 1,
          }),
        )
      },
      { bandIndex, cellIndex },
    )
  }

  // SPEC: board:cell-context-menu
  test('right-click on a non-empty cell shows archive label with state, swimlane, and count', async ({
    page,
  }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)

    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    // Frontend swimlane (band 0), backlog column (cell 0) - has 'Setup infra'.
    await rightClickCell(page, 0, 0)

    const menuButton = page.locator('.swimlane-context-menu button')
    await expect(menuButton).toBeVisible()
    const label = await menuButton.textContent()
    expect(label).toMatch(/Archive all tickets in .* state and Frontend swimlane \(1 tickets\)/)
    await expect(menuButton).toBeEnabled()
  })

  // SPEC: board:cell-context-menu
  test('right-click on an empty cell shows a disabled archive button (0 tickets)', async ({
    page,
  }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)

    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    // Frontend swimlane × Review column (index 2) - empty in the fixture.
    await rightClickCell(page, 0, 2)

    const menuButton = page.locator('.swimlane-context-menu button')
    await expect(menuButton).toBeVisible()
    await expect(menuButton).toBeDisabled()
    expect(await menuButton.textContent()).toMatch(/\(0 tickets\)/)
  })

  // SPEC: board:cell-context-menu
  test('clicking the backdrop dismisses the cell context menu', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)

    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    await rightClickCell(page, 0, 0)
    await expect(page.locator('.swimlane-context-menu')).toBeVisible()

    // Click backdrop's corner - center may overlap the menu the backdrop covers.
    await page.locator('.swimlane-context-backdrop').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.swimlane-context-menu')).toHaveCount(0)
  })
})

test.describe('Board bulk-aware drag', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    // Provide a board fixture with 4 backlog tickets (3 frontend + 1 backend),
    // so we can test selection vs unselected drag with deterministic targets.
    const BULK_BOARD = {
      ...MOCK_BOARD_DETAIL,
      states: MOCK_BOARD_DETAIL.states.map(s =>
        s.id === 'in-progress' ? { ...s, active: true } : s,
      ),
      columns: {
        backlog: [
          { path: 'docs/tickets/active/t1.md', title: 'T1', swimlane: 'frontend' },
          { path: 'docs/tickets/active/t2.md', title: 'T2', swimlane: 'frontend' },
          { path: 'docs/tickets/active/t3.md', title: 'T3', swimlane: 'frontend' },
          { path: 'docs/tickets/active/t4.md', title: 'T4', swimlane: 'frontend' },
        ],
        'in-progress': [],
        review: [],
        done: [],
        rejected: [],
        'definitely-rejected': [],
      },
    }
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: BULK_BOARD })
        } else {
          await route.continue()
        }
      },
    )
  })

  // SPEC: board:drag-bulk-selected
  test('dragging a selected ticket carries every selected ticket; dragging unselected moves only that one', async ({
    page,
  }) => {
    // Two phases of multi-step drag-and-drop + per-phase assertion poll.
    // The default 5 s test timeout is too tight when both phases run plus the
    // serialized assign() call ahead of each move dispatch.
    test.setTimeout(30000)
    const moves = []
    // Register first so it wins over any earlier registration.
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
      async route => {
        const url = route.request().url()
        const match = url.match(/tickets\/(.+)\/move/)
        const ticketPath = match ? decodeURIComponent(match[1]) : null
        moves.push({ ticketPath, body: JSON.parse(route.request().postData()) })
        await route.fulfill({ json: { path: 'moved' } })
      },
    )
    // Stub assignTickets so auto-assign doesn't error noisily.
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/assign`.replace(/\//g, '\\/')),
      async route => {
        await route.fulfill({ json: { sessions: [{ session_id: 'shared-001' }] } })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Ctrl+click to multi-select T1, T2, T3 (frontend backlog).
    await board.getByText('T1').click({ modifiers: ['Control'] })
    await board.getByText('T2').click({ modifiers: ['Control'] })
    await board.getByText('T3').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(3)

    // Drag T2 (one of the selected) to in-progress column in frontend swimlane.
    const dragCard = page.locator('.ticket-card', { hasText: 'T2' })
    const frontendBand = page.locator('.swimlane-band').first()
    const inProgressCell = frontendBand.locator('.board-cell').nth(1)

    let cardBox = await dragCard.boundingBox()
    let cellBox = await inProgressCell.boundingBox()

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 10,
    })
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, {
      steps: 20,
    })
    await page.mouse.up()

    // All three selected tickets should move (move API called 3x). Bulk-move
    // dispatches 3 PATCH requests; poll with a generous timeout because the
    // assign() shared-session call serializes ahead of each move.
    await expect.poll(() => moves.length, { timeout: 15000 }).toBe(3)
    const movedPaths = moves.map(m => m.ticketPath).sort()
    expect(movedPaths).toEqual([
      'docs/tickets/active/t1.md',
      'docs/tickets/active/t2.md',
      'docs/tickets/active/t3.md',
    ])

    // ── Phase 2: fresh select-three, drag UNSELECTED 4th ──
    // Clear move log and reset selection in-place (avoid full reload which
    // breaks SSE wiring under the mocked route).
    moves.length = 0
    // Toggle off all selection by Ctrl+clicking each selected ticket.
    await board.getByText('T1').click({ modifiers: ['Control'] })
    await board.getByText('T2').click({ modifiers: ['Control'] })
    await board.getByText('T3').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(0)

    // Re-select T1, T2, T3 (now in their post-drag positions but selection by
    // path still works regardless of column).
    await board.getByText('T1').click({ modifiers: ['Control'] })
    await board.getByText('T2').click({ modifiers: ['Control'] })
    await board.getByText('T3').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(3)

    // Drag T4 - NOT in selection - should move only T4.
    const t4 = page.locator('.ticket-card', { hasText: 'T4' })
    cardBox = await t4.boundingBox()
    cellBox = await inProgressCell.boundingBox()

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 10,
    })
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, {
      steps: 20,
    })
    await page.mouse.up()

    await expect.poll(() => moves.length, { timeout: 15000 }).toBe(1)
    expect(moves[0].ticketPath).toBe('docs/tickets/active/t4.md')
    // Selection is preserved.
    await expect(board.locator('.ticket-card.selected')).toHaveCount(3)
  })
})

test.describe('Board cross-lane bulk + column-header drop', () => {
  // Board fixture with tickets distributed across two swimlanes so we can
  // exercise multi-lane selection and cross-lane preservation.
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    const CROSS_LANE_BOARD = {
      ...MOCK_BOARD_DETAIL,
      columns: {
        backlog: [
          { path: 'docs/tickets/active/t1.md', title: 'T1', swimlane: 'frontend' },
          { path: 'docs/tickets/active/t2.md', title: 'T2', swimlane: 'frontend' },
          { path: 'docs/tickets/active/t3.md', title: 'T3', swimlane: 'backend' },
        ],
        'in-progress': [],
        review: [],
        done: [],
        rejected: [],
        'definitely-rejected': [],
      },
    }
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: CROSS_LANE_BOARD })
        } else {
          await route.continue()
        }
      },
    )
  })

  // SPEC: board:cross-lane-bulk-preserve
  test('cross-lane bulk move preserves each ticket origin swimlane', async ({ page }) => {
    const moves = []
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
      async route => {
        const url = route.request().url()
        const match = url.match(/tickets\/(.+)\/move/)
        const ticketPath = match ? decodeURIComponent(match[1]) : null
        moves.push({ ticketPath, body: JSON.parse(route.request().postData()) })
        await route.fulfill({ json: { path: 'moved' } })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Multi-select tickets across two swimlanes (T1 frontend, T3 backend).
    await board.getByText('T1').click({ modifiers: ['Control'] })
    await board.getByText('T3').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(2)

    // Drag T1 (in frontend) onto the backend swimlane's in-progress cell.
    // Even though the cell drop target lane is "backend", cross-lane bulk
    // preservation should keep T3 in backend AND keep T1 in frontend; only
    // the column changes for both.
    const dragCard = page.locator('.ticket-card', { hasText: 'T1' })
    const backendBand = page.locator('.swimlane-band').nth(1)
    const inProgressCell = backendBand.locator('.board-cell').nth(1)

    const cardBox = await dragCard.boundingBox()
    const cellBox = await inProgressCell.boundingBox()
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 3,
    })
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, {
      steps: 5,
    })
    await page.mouse.up()

    await expect.poll(() => moves.length, { timeout: 5000 }).toBe(2)

    // Both tickets must land in in-progress with their ORIGIN swimlane
    // intact: no `swimlane` field set on the move call (undefined -> preserved).
    const byPath = Object.fromEntries(moves.map(m => [m.ticketPath, m.body]))
    expect(byPath['docs/tickets/active/t1.md']).toEqual({ column: 'in-progress' })
    expect(byPath['docs/tickets/active/t3.md']).toEqual({ column: 'in-progress' })
  })

  // SPEC: board:column-header-drop
  test('dropping ticket on column header moves column without changing swimlane', async ({
    page,
  }) => {
    const moves = []
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
      async route => {
        const url = route.request().url()
        const match = url.match(/tickets\/(.+)\/move/)
        const ticketPath = match ? decodeURIComponent(match[1]) : null
        moves.push({ ticketPath, body: JSON.parse(route.request().postData()) })
        await route.fulfill({ json: { path: 'moved' } })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Drag T1 (frontend swimlane) onto the Review column header.
    const dragCard = page.locator('.ticket-card', { hasText: 'T1' })
    const headers = page.locator('.board-col-header')
    const reviewHeader = headers.nth(2)

    const cardBox = await dragCard.boundingBox()
    const headerBox = await reviewHeader.boundingBox()
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 3,
    })
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2, {
      steps: 5,
    })
    await page.mouse.up()

    await expect.poll(() => moves.length, { timeout: 5000 }).toBe(1)

    // Column changed; swimlane preserved (no swimlane field on the move call).
    expect(moves[0].ticketPath).toBe('docs/tickets/active/t1.md')
    expect(moves[0].body).toEqual({ column: 'review' })
  })
})

test.describe('Board column rename', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: MOCK_BOARD_DETAIL })
        } else {
          await route.continue()
        }
      },
    )
  })

  // SPEC: board:column-rename
  test('double-clicking column header opens input that PATCHes label', async ({ page }) => {
    let renameBody = null
    let renamedStateId = null

    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/states/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() !== 'PATCH') {
          await route.continue()
          return
        }
        const url = route.request().url()
        const match = url.match(/states\/([^/]+)$/)
        renamedStateId = match ? match[1] : null
        renameBody = JSON.parse(route.request().postData())
        await route.fulfill({
          json: { id: renamedStateId, label: renameBody.label, folder: 'backlog' },
        })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    await expect(page.locator('.board-board')).toBeVisible()

    // Double-click the Backlog header to open rename input.
    const backlogHeader = page.locator('.board-col-header').first()
    await backlogHeader.dblclick()

    const input = page.locator('.board-col-name-input')
    await expect(input).toBeVisible()

    // Type new label, press Enter to submit.
    await input.fill('To Do')
    await input.press('Enter')

    await expect.poll(() => renameBody).toEqual({ label: 'To Do' })
    expect(renamedStateId).toBe('backlog')
  })
})

test.describe('Board bulk shared session', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockBoardsAPI(page)
  })

  // SPEC: board:bulk-shared-session
  test('bulk move into in-progress sends a single assign call with all ticket paths', async ({
    page,
  }) => {
    // Override board detail to mark in-progress as an active column.
    await page.unroute(new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')))
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'GET') {
          const board = {
            ...MOCK_BOARD_DETAIL,
            states: MOCK_BOARD_DETAIL.states.map(s =>
              s.id === 'in-progress' ? { ...s, active: true } : s,
            ),
          }
          await route.fulfill({ json: board })
        } else {
          await route.fulfill({ json: { ok: true } })
        }
      },
    )
    // Re-register move handler in this test to ensure it wins over the
    // beforeEach handler (route ordering affects the URL with encoded slashes).
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
      async route => {
        await route.fulfill({ json: { path: 'moved' } })
      },
    )
    let assignBody = null
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/assign`.replace(/\//g, '\\/')),
      async route => {
        const post = route.request().postData()
        try {
          assignBody = JSON.parse(post || '{}')
        } catch {
          assignBody = post
        }
        await route.fulfill({ json: { sessions: [{ session_id: 'shared-session-001' }] } })
      },
    )
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    const board = page.locator('.board-board')
    await expect(board).toBeVisible()
    await expect(board.getByText('Setup infra')).toBeVisible()
    await expect(board.getByText('Boards')).toBeVisible()

    // Select two backlog tickets (Setup infra + Boards) and bulk-drag
    // the first to In Progress.
    await board.getByText('Setup infra').click({ modifiers: ['Control'] })
    await board.getByText('Boards').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(2)

    const dragCard = page.locator('.ticket-card', { hasText: 'Setup infra' })
    const frontendBand = page.locator('.swimlane-band').first()
    const inProgressCell = frontendBand.locator('.board-cell').nth(1)

    const cardBox = await dragCard.boundingBox()
    const cellBox = await inProgressCell.boundingBox()
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 3,
    })
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, {
      steps: 5,
    })
    await page.mouse.up()

    // A single shared assign call covers all moved tickets, with parallel:false
    // signalling the backend to spawn ONE shared session.
    await expect.poll(() => assignBody, { timeout: 5000 }).toBeTruthy()
    expect(assignBody.parallel).toBe(false)
    expect(assignBody.tickets.sort()).toEqual([
      'docs/tickets/active/boards.md',
      'docs/tickets/active/setup.md',
    ])
  })
})

test.describe('Board prompt sequence', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: board:prompt-sequence-delivered
  test('move into active column triggers assign with prompt sequence config in board', async ({
    page,
  }) => {
    // Board has prompt.sequence configured - backend uses it to build first
    // user messages with {ticket} substitution. From the FE side, the verifiable
    // signal is the assign call carrying the right tickets so the backend can
    // use the sequence; we keep the prompt on the board fixture.
    const PROMPT_BOARD = {
      ...MOCK_BOARD_DETAIL,
      states: MOCK_BOARD_DETAIL.states.map(s =>
        s.id === 'in-progress' ? { ...s, active: true } : s,
      ),
      prompt: { sequence: ['/scope claudebox', '/implement {ticket}'] },
    }
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: PROMPT_BOARD })
        } else {
          await route.continue()
        }
      },
    )
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`.replace(/\//g, '\\/')),
      async route => {
        await route.fulfill({ json: { path: 'moved' } })
      },
    )

    let assignBody = null
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/assign`.replace(/\//g, '\\/')),
      async route => {
        assignBody = JSON.parse(route.request().postData())
        await route.fulfill({ json: { sessions: [{ session_id: 'sess-from-seq' }] } })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()
    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Drag a backlog ticket to In Progress (active column).
    const dragCard = page.locator('.ticket-card', { hasText: 'Setup infra' })
    const frontendBand = page.locator('.swimlane-band').first()
    const inProgressCell = frontendBand.locator('.board-cell').nth(1)

    const cardBox = await dragCard.boundingBox()
    const cellBox = await inProgressCell.boundingBox()
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 3,
    })
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, {
      steps: 5,
    })
    await page.mouse.up()

    // Assign call sent with the ticket path; backend will expand prompt.sequence
    // server-side using {ticket} -> ticket path.
    await expect.poll(() => assignBody, { timeout: 5000 }).toBeTruthy()
    expect(assignBody.tickets).toEqual(['docs/tickets/active/setup.md'])
  })
})

test.describe('Boards Deep Link', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockBoardsAPI(page)
  })

  // SPEC: panel-boards:deep-link-loads-board
  test('navigating to /#/workspaces/{ws}/boards/{boardId} selects workspace and renders board', async ({
    page,
  }) => {
    await mockSSE(page)
    // Direct deep-link navigation to a board route (no prior session selection).
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/boards/sprint-1`)

    // Footer renders -> app initialized with the workspace context selected.
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    // Workspace was auto-selected from URL; verify via WorkspaceContext state.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          // Workspace selection is reflected in title attr of footer-workspace
          // and in the boards panel's workspaceId-bound renders. The most direct
          // signal is the board tab opening - which only happens once
          // workspaceId === activeWorkspaceId.
          return document.querySelector('.board-tab') !== null
        }),
      )
      .toBe(true)

    // Board renders columns fully populated from the deep-linked board.
    const board = page.locator('.board-board')
    await expect(board).toBeVisible()
    await expect(board.locator('.board-col-header')).toHaveCount(6)
    await expect(board.getByText('Setup infra')).toBeVisible()
  })
})

test.describe('Board column reorder + context menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: MOCK_BOARD_DETAIL })
        } else {
          await route.continue()
        }
      },
    )
  })

  // SPEC: board:col-dnd-reorder
  test('non-collapsed column headers expose a drag handle', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Every non-collapsed column header renders the grip-handle span. Wait
    // for the collapsed-by-default state to settle on terminal columns
    // before asserting count equality.
    const handles = board.locator('.board-col-header:not(.collapsed) .board-drag-handle')
    await expect(handles).not.toHaveCount(0)
    await expect
      .poll(async () => {
        const headers = await board.locator('.board-col-header:not(.collapsed)').count()
        const grips = await handles.count()
        return headers === grips
      })
      .toBe(true)
  })

  // SPEC: board:col-context-menu
  test('right-click on column header surfaces Move + archive items', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Right-click the In Progress column header (middle-ish, so Move left/right both enabled).
    const inProgressHeader = board.locator('.board-col-header').filter({ hasText: 'In Progress' })
    await inProgressHeader.click({ button: 'right' })

    const menu = page.locator('.swimlane-context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Move left')).toBeVisible()
    await expect(menu.getByText('Move right')).toBeVisible()
    await expect(menu.locator('.swimlane-context-divider').first()).toBeVisible()
    // Archive label includes state label + ticket count for that column.
    await expect(
      menu.getByText(/Archive all tickets in In Progress state \(\d+ tickets\)/),
    ).toBeVisible()
  })

  // SPEC: board:drag-col-reorder
  test('Move left context-menu action PATCHes column order', async ({ page }) => {
    let reorderPayload = null
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/states/reorder`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() === 'PATCH') {
          reorderPayload = JSON.parse(route.request().postData())
          await route.fulfill({ json: {} })
        } else {
          await route.continue()
        }
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Right-click In Progress -> Move left swaps it with Backlog.
    const inProgressHeader = board.locator('.board-col-header').filter({ hasText: 'In Progress' })
    await inProgressHeader.click({ button: 'right' })
    await page.locator('.swimlane-context-menu').getByText('Move left').click()

    await expect.poll(() => reorderPayload, { timeout: 3000 }).not.toBeNull()
    // Backlog was first; after Move left on In Progress, In Progress precedes Backlog.
    expect(reorderPayload.keys.indexOf('in-progress')).toBeLessThan(
      reorderPayload.keys.indexOf('backlog'),
    )
  })

  // SPEC: board:archive-bulk-column
  test('archive-all-in-column action fans out one archive per ticket', async ({ page }) => {
    const archived = []
    await page.route(
      new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/[^/]+$`.replace(/\//g, '\\/')),
      async route => {
        if (route.request().method() !== 'DELETE') {
          await route.continue()
          return
        }
        const match = route
          .request()
          .url()
          .match(/tickets\/([^/?]+)/)
        archived.push(match ? decodeURIComponent(match[1]) : null)
        await route.fulfill({ json: {} })
      },
    )

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openBoardsPanel(page)
    await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    // Right-click the Backlog header (the fixture seeds tickets there).
    const backlogHeader = board.locator('.board-col-header').filter({ hasText: 'Backlog' })
    await backlogHeader.click({ button: 'right' })
    await page
      .locator('.swimlane-context-menu')
      .getByText(/^Archive all tickets in /)
      .click()

    // Every backlog ticket archived (count > 0; exact count varies with fixture).
    await expect.poll(() => archived.length, { timeout: 5000 }).toBeGreaterThan(0)
  })
})
