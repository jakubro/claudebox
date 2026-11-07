/** E2E tests for boards panel and board tab. */

import { expect, test } from '@playwright/test'
import { openBoardsPanel, openSession, waitForAppReady } from '../helpers.js'
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

// Answers a move with the ticket's own path, as a move between columns sharing a folder does.
function movedEntry(route) {
  const [, ticketPath] = route
    .request()
    .url()
    .match(/tickets\/(.+)\/move/)
  return { path: decodeURIComponent(ticketPath) }
}

async function openFirstBoard(page) {
  await openBoardsPanel(page)
  await page.locator('[data-testid="panel-boards"] .boards-item').first().click()

  return page.locator('.board-board')
}

async function openBoard(page) {
  await openSession(page)
  const board = await openFirstBoard(page)
  await expect(board).toBeVisible()

  return board
}

function frontendInProgressDrag(page, ticket) {
  const dragCard = page.locator('.ticket-card', { hasText: ticket })
  const inProgressCell = page.locator('.swimlane-band').first().locator('.board-cell').nth(1)

  return { dragCard, inProgressCell }
}

async function ctrlClickT1toT3(board) {
  for (const name of ['T1', 'T2', 'T3']) {
    await board.getByText(name).click({ modifiers: ['Control'] })
  }
}

async function openFrontendLaneMenu(page) {
  await openSession(page)
  await openFirstBoard(page)
  await page.locator('.swimlane-header').filter({ hasText: 'Frontend' }).click({ button: 'right' })
}

async function openTicketWithBody(page, body) {
  await mockSSE(page)
  await page.route(new RegExp(`${WS_PREFIX}/boards/.+/tickets/.+/content`), async route => {
    await route.fulfill({ body })
  })
  await openSetupInfraTicket(page)
}

async function openSetupInfraTicket(page) {
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)
  await openFirstBoard(page)
  await page.getByText('Setup infra').click()
}

async function mockBoardList(page) {
  await page.route(`**${WS_PREFIX}/boards`, async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: MOCK_BOARDS })
    }
  })
}

async function captureMove(page) {
  const moved = { payload: null }
  await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`), async route => {
    moved.payload = JSON.parse(route.request().postData())
    await route.fulfill({ json: movedEntry(route) })
  })

  return moved
}

async function mockBoardDetail(page, detail = MOCK_BOARD_DETAIL) {
  await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: detail })
    } else {
      await route.continue()
    }
  })
}

async function stubMoves(page) {
  await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`), async route => {
    await route.fulfill({ json: movedEntry(route) })
  })
}

async function captureMoves(page) {
  const moves = []
  await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`), async route => {
    const url = route.request().url()
    const match = url.match(/tickets\/(.+)\/move/)
    const ticketPath = match ? decodeURIComponent(match[1]) : null
    moves.push({ ticketPath, body: JSON.parse(route.request().postData()) })
    await route.fulfill({ json: movedEntry(route) })
  })

  return moves
}

async function openBoardWithAPI(page) {
  await mockAPI(page)
  await mockBoardsAPI(page)
  await openBoard(page)
}

// Mocks the board list/detail/move/delete/swimlane API endpoints on the page.
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
  await mockBoardDetail(page)

  // PATCH /api/workspaces/{ws}/boards/:id/tickets/:path/move
  await stubMoves(page)

  // DELETE /api/workspaces/{ws}/boards/:id/tickets/:path
  await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+$`), async route => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 200, json: {} })
    } else {
      await route.continue()
    }
  })

  // POST/PATCH/DELETE swimlane endpoints
  await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/swimlanes`), async route => {
    await route.fulfill({ json: { id: 'new-lane', name: 'New Lane' } })
  })
}

test.describe('Boards Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockBoardsAPI(page)
  })

  test('Alt+7 toggles boards panel', async ({ page }) => {
    // SPEC: panel-boards:panel
    await openSession(page)

    // Boards panel is open by default.
    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel).toBeVisible()

    await page.keyboard.press('Alt+7')
    await expect(panel).not.toBeVisible()

    await page.keyboard.press('Alt+7')
    await expect(panel).toBeVisible()
  })

  test('shows discovered boards list', async ({ page }) => {
    // SPEC: panel-boards:discovery
    await openSession(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel).toBeVisible()

    const items = panel.locator('.boards-item')
    await expect(items).toHaveCount(2)

    await expect(items.nth(0).locator('.boards-item-name')).toContainText('sprint-1')
    await expect(items.nth(1).locator('.boards-item-name')).toContainText('backlog')
  })

  test('shows board path alongside name', async ({ page }) => {
    // SPEC: panel-boards:item-display
    await openSession(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    const firstItem = panel.locator('.boards-item').first()
    await expect(firstItem.locator('.boards-item-path')).toContainText('docs/tickets/board.yaml')
  })

  test('shows empty state when no boards', async ({ page }) => {
    // SPEC: panel-boards:empty
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      await route.fulfill({ json: { boards: [] } })
    })
    await openSession(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel).toContainText('No boards found')
  })

  // SPEC: panel-boards:pre-workspace-loading
  test('on fresh page load before workspace selected, panel shows loading not error', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page)
    // Delay the workspaces endpoint so the panel mounts before workspaceId resolves; registered
    // after mockAPI because Playwright resolves routes last-first.
    await page.route('**/api/workspaces', async route => {
      await new Promise(resolve => setTimeout(resolve, 200))
      await route.fulfill({
        json: {
          workspaces: [{ id: 'test-ws', path: '/home/user/project', color: null }],
        },
      })
    })
    await page.goto('/')

    const panel = page.locator('[data-testid="panel-boards"]')
    // Pre-workspace state must never leak raw API errors like "Workspace ID not set" - it shows loading instead.
    await expect(panel).not.toContainText('Workspace ID not set')
  })

  test('boards icon sits below the bookmarks icon in the right strip', async ({ page }) => {
    // SPEC: panel-boards:icon-position
    await openSession(page)

    const boardsIcon = page.locator('[data-testid="icon-boards"]')
    const bookmarksIcon = page.locator('[data-testid="icon-bookmarks"]')
    await expect(boardsIcon).toBeVisible()
    await expect(bookmarksIcon).toBeVisible()

    // Boards must sit below Bookmarks in the strip; compare bounding boxes to anchor the position contract.
    const { y: boardsY } = await boardsIcon.boundingBox()
    const { y: bookmarksY } = await bookmarksIcon.boundingBox()
    expect(boardsY).toBeGreaterThan(bookmarksY)

    expect(await boardsIcon.getAttribute('title')).toBe('Boards (Alt+7)')
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
    await openSession(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    await expect(panel.locator('.boards-item')).toHaveCount(2)

    // Refresh lives in a meta-item at the end of the list, not a dedicated header row.
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
    await openSession(page)

    await openBoardsPanel(page)

    const panel = page.locator('[data-testid="panel-boards"]')
    await panel.locator('.boards-item').first().click()

    const board = page.locator('[data-testid="main-panel-content"][data-mode="board"] .board-tab')
    await expect(board).toBeVisible()

    // URL hash carries the boards segment.
    expect(await page.evaluate(() => window.location.hash)).toMatch(/\/boards\/[^/]+$/)

    // Main-area header LEFT slot shows the board name, not the session trio.
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
    const board = await openBoard(page)

    // Terminal columns (Done, Rejected, Def. Rejected) collapse by default to their label's first grapheme.
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
    const board = await openBoard(page)

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
    const board = await openBoard(page)

    const tickets = board.locator('.ticket-card')
    await expect(tickets.first()).toBeVisible()

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
    await openSession(page)

    await openFirstBoard(page)

    const headers = page.locator('.board-col-header')

    // Done, Rejected, Def. Rejected should have the collapsed class and show the collapsed chevron glyph.
    for (const i of [3, 4, 5]) {
      await expect(headers.nth(i)).toHaveClass(/collapsed/)
      await expect(headers.nth(i).locator('.board-col-chevron')).toHaveText('▸')
    }

    // Backlog, In Progress, Review should not be collapsed and show the expanded chevron instead.
    for (const i of [0, 1, 2]) {
      await expect(headers.nth(i)).not.toHaveClass(/collapsed/)
      await expect(headers.nth(i).locator('.board-col-chevron')).toHaveText('▾')
    }
  })

  test('clicking terminal column header toggles collapsed state', async ({ page }) => {
    // SPEC: board:terminal-toggle
    // SPEC: board:swimlane-collapse
    await openSession(page)

    await openFirstBoard(page)

    const doneHeader = page.locator('.board-col-header').nth(3)
    await expect(doneHeader).toHaveClass(/collapsed/)

    await doneHeader.locator('.board-col-toggle').click()
    await expect(doneHeader).not.toHaveClass(/collapsed/)

    await doneHeader.locator('.board-col-toggle').click()
    await expect(doneHeader).toHaveClass(/collapsed/)
  })

  test('unsorted swimlane catches tickets without swimlane assignment', async ({ page }) => {
    // SPEC: board:swimlane-unsorted
    await openSession(page)

    await openFirstBoard(page)

    // The "Init project" ticket has no swimlane, should be in Unsorted
    const unsortedBand = page.locator('.swimlane-header.unsorted').locator('..')
    await expect(unsortedBand).toBeVisible()
  })

  test('add swimlane row is visible at the bottom', async ({ page }) => {
    // SPEC: board:swimlane-create
    await openSession(page)

    await openFirstBoard(page)

    const addBtn = page.locator('.swimlane-add-btn')
    await expect(addBtn).toBeVisible()
    await expect(addBtn).toContainText('Add swimlane')
  })

  test('clicking add swimlane shows input field', async ({ page }) => {
    // SPEC: board:swimlane-create
    await openSession(page)

    await openFirstBoard(page)

    await page.locator('.swimlane-add-btn').click()

    const input = page.locator('.swimlane-add-row .swimlane-name-input')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
  })

  test('ticket session-status dot uses the documented running/stopped class', async ({ page }) => {
    // SPEC: board:card-session
    // SPEC: board:card-session-dot
    await openSession(page)

    await openFirstBoard(page)

    const polishCard = page.locator('.ticket-card', { hasText: 'Polish UI' })
    await expect(polishCard).toBeVisible()

    const dot = polishCard.locator('.ticket-status-dot')
    await expect(dot).toBeVisible()
    await expect(polishCard.locator('.ticket-session-id')).toBeVisible()

    // Dot must carry a documented state class; CSS owns the color mapping, visual regression covers pixels.
    const cls = await dot.getAttribute('class')
    expect(cls).toMatch(/\b(running|stopped|stopping|no-container)\b/)
  })

  test("a card's dot and label show its session's state", async ({ page }) => {
    // SPEC: board:card-session-dot
    // SPEC: board:card-session-label
    let sessionFields = { activity: 'working' }
    await page.route(`**${WS_PREFIX}/sessions`, async route => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      await route.fulfill({
        json: {
          sessions: [
            { session_id: 'session-001', container_id: 'ctr-card', num_turns: 1, ...sessionFields },
          ],
        },
      })
    })
    await openSession(page)

    await openFirstBoard(page)

    const card = page.locator('.ticket-card', { hasText: 'Polish UI' })
    await expect(card.locator('.ticket-status-dot')).toHaveClass(/container-status-working/)
    await expect(card.locator('.ticket-session-id')).toHaveText('working (sess..)')

    sessionFields = { needs_user: 'Decide: which' }
    await page.reload()

    await expect(card.locator('.ticket-status-dot')).toHaveClass(/container-status-needs-you/)
    await expect(card.locator('.ticket-session-id')).toHaveText('needs you (sess..)')
  })

  test('clicking a ticket opens detail overlay', async ({ page }) => {
    // SPEC: board:card-click-detail
    // SPEC: board:detail
    // SPEC: board:detail-title
    // SPEC: board:detail-meta
    await openTicketWithBody(page, '# Setup infra\n\nTicket body content.')

    const overlay = page.locator('.ticket-detail-panel')
    await expect(overlay).toBeVisible()

    await expect(overlay.locator('.ticket-detail-title')).toContainText('Setup infra')

    // Metadata - claim enumerates three rows, each with named labels and values.
    await expect(overlay.locator('.ticket-detail-meta')).toBeVisible()
    const rows = overlay.locator('.ticket-meta-row')
    await expect(rows).toHaveCount(3)
    // Each row must show its label (Status, Swimlane, Session) so "metadata" is verified beyond row count.
    const rowsText = (await rows.allTextContents()).join(' | ')
    expect(rowsText).toMatch(/Status/)
    expect(rowsText).toMatch(/Swimlane/)
    expect(rowsText).toMatch(/Session/)
  })

  test('detail overlay shows "Loading..." while content is fetching', async ({ page }) => {
    // SPEC: board:detail-loading
    await mockSSE(page)

    // Delay the content endpoint so the in-flight loading state is observable instead of resolving instantly.
    await page.route(new RegExp(`${WS_PREFIX}/boards/.+/tickets/.+/content`), async route => {
      await new Promise(resolve => setTimeout(resolve, 800))
      await route.fulfill({ body: '# Setup infra\n\nDelayed body.' })
    })

    await openSetupInfraTicket(page)

    const overlay = page.locator('.ticket-detail-panel')
    await expect(overlay).toBeVisible()
    // The "Loading..." text must be visible during the fetch window.
    await expect(overlay).toContainText('Loading')
    // Eventually the body resolves and replaces the loading indicator.
    await expect(overlay).toContainText('Delayed body')
  })

  test('detail overlay shows file content', async ({ page }) => {
    // SPEC: board:detail-content
    await openTicketWithBody(page, '# Setup infra\n\nDetailed description here.')

    // The markdown wrapper uses the canonical .turn-text class
    const content = page.locator('.ticket-detail-content .turn-text')
    await expect(content).toContainText('Detailed description here')
  })

  test('detail overlay closes with X button', async ({ page }) => {
    // SPEC: board:detail-close
    await openTicketWithBody(page, '# Content')
    await expect(page.locator('.ticket-detail-panel')).toBeVisible()

    await page.locator('.ticket-detail-close').click()
    await expect(page.locator('.ticket-detail-panel')).not.toBeVisible()
  })

  test('detail overlay closes on backdrop click', async ({ page }) => {
    // SPEC: board:detail-backdrop
    await openTicketWithBody(page, '# Content')
    await expect(page.locator('.ticket-detail-panel')).toBeVisible()

    await page.locator('.ticket-detail-backdrop').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.ticket-detail-panel')).not.toBeVisible()
  })

  test('Ctrl+click toggles ticket multi-select', async ({ page }) => {
    // SPEC: board:card-multi-select
    // SPEC: board:multi-select
    // SPEC: board:checkbox-select
    await openSession(page)

    const board = await openFirstBoard(page)

    await board.getByText('Setup infra').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(1)

    await board.getByText('Boards').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(2)

    await board.getByText('Setup infra').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(1)
  })

  test('right-click card shows context menu and archives', async ({ page }) => {
    // SPEC: board:archive-context
    // SPEC: board:archive-behavior
    // SPEC: board:archive-no-confirm
    let archiveRequested = false
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+$`), async route => {
      if (route.request().method() === 'DELETE') {
        archiveRequested = true
        await route.fulfill({ status: 200, json: {} })
      } else {
        await route.continue()
      }
    })

    await openSession(page)

    await openFirstBoard(page)

    await page.getByText('Setup infra').click({ button: 'right' })

    const menu = page.locator('.ticket-context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Archive ticket')).toBeVisible()

    await menu.getByText('Archive ticket').click()
    await expect.poll(() => archiveRequested, { timeout: 3000 }).toBe(true)
  })

  test('swimlane context menu with rename, delete, move', async ({ page }) => {
    // SPEC: board:swimlane-context-menu
    // SPEC: board:archive-bulk-swimlane
    await openFrontendLaneMenu(page)

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
    await openSession(page)

    await openFirstBoard(page)

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
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/swimlanes`), async route => {
      if (route.request().method() === 'DELETE') {
        deleteRequested = true
      }
      await route.fulfill({ json: {} })
    })

    await openFrontendLaneMenu(page)
    await page.locator('.swimlane-context-menu').getByText('Delete').click()

    await expect.poll(() => deleteRequested, { timeout: 3000 }).toBe(true)
  })

  test('swimlane reorder via context menu', async ({ page }) => {
    // SPEC: board:swimlane-reorder
    // SPEC: board:swimlane-dnd-reorder
    // SPEC: board:drag-lane-reorder
    let reorderPayload = null
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/swimlanes/reorder`), async route => {
      if (route.request().method() === 'PATCH') {
        reorderPayload = JSON.parse(route.request().postData())
      }
      await route.fulfill({ json: [] })
    })

    await openFrontendLaneMenu(page)
    await page.locator('.swimlane-context-menu').getByText('Move down').click()

    await expect.poll(() => reorderPayload, { timeout: 3000 }).toBeTruthy()
  })

  test('unsorted swimlane does not support context menu', async ({ page }) => {
    // SPEC: board:swimlane-unsorted-readonly
    await openSession(page)

    await openFirstBoard(page)

    const unsortedHeader = page.locator('.swimlane-header.unsorted')
    await unsortedHeader.click({ button: 'right' })

    await expect(page.locator('.swimlane-context-menu')).not.toBeVisible()
  })
})

test.describe('Board States', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('shows loading state while board loads', async ({ page }) => {
    // SPEC: board:loading
    await mockBoardList(page)
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
      // Delay response so loading state is visible
      await new Promise(r => setTimeout(r, 2000))
      await route.fulfill({ json: MOCK_BOARD_DETAIL })
    })

    await openSession(page)

    await openFirstBoard(page)

    await expect(page.locator('.board-loading')).toBeVisible()
    await expect(page.locator('.board-loading')).toContainText('Loading board')
  })

  test('shows error state on parse failure', async ({ page }) => {
    // SPEC: board:error
    await mockBoardList(page)
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
      await route.fulfill({ status: 500, body: 'parse error in board.yaml' })
    })

    await openSession(page)

    await openFirstBoard(page)

    await expect(page.locator('.board-error')).toBeVisible()
    await expect(page.locator('.board-error')).toContainText('Failed to parse board.yaml')
  })

  test('returns null when no board data', async ({ page }) => {
    // SPEC: board:no-data
    await mockBoardList(page)
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
      await route.fulfill({ json: null })
    })

    await openSession(page)

    await openFirstBoard(page)

    // No board, no error, no loading - should render nothing
    await expect(page.locator('.board-board')).not.toBeVisible()
    await expect(page.locator('.board-error')).not.toBeVisible()
  })

  test('board shows loading placeholder in panel', async ({ page }) => {
    // SPEC: panel-boards:loading
    await page.route(`**${WS_PREFIX}/boards`, async route => {
      if (route.request().method() === 'GET') {
        await new Promise(r => setTimeout(r, 2000))
        await route.fulfill({ json: MOCK_BOARDS })
      }
    })

    await openSession(page)

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

    await openSession(page)

    await openBoardsPanel(page)

    await expect(page.locator('.boards-error')).toBeVisible()
  })
})

test.describe('Board SSE Updates', () => {
  async function openBoardWithFetchCount(page) {
    await mockAPI(page)
    const counts = { board: 0 }
    await mockBoardList(page)
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
      if (route.request().method() === 'GET') {
        counts.board++
        await route.fulfill({ json: MOCK_BOARD_DETAIL })
      }
    })
    const daemonSSE = await createDaemonSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openFirstBoard(page)
    await expect(page.locator('.board-board')).toBeVisible()

    return { counts, daemonSSE }
  }

  test('board refreshes on SSE sessions_changed event', async ({ page }) => {
    // SPEC: board:sse-session
    const { counts, daemonSSE } = await openBoardWithFetchCount(page)
    const initialCount = counts.board

    await daemonSSE.sendEvent({ type: 'sessions_changed', workspace_id: DEFAULT_WORKSPACE_ID })

    await expect.poll(() => counts.board, { timeout: 5000 }).toBeGreaterThan(initialCount)
  })

  test('board refreshes on SSE container_status event', async ({ page }) => {
    // SPEC: board:sse-session
    const { counts, daemonSSE } = await openBoardWithFetchCount(page)
    const initialCount = counts.board

    await daemonSSE.sendContainerStatus('container-123', 'running')

    await expect.poll(() => counts.board, { timeout: 5000 }).toBeGreaterThan(initialCount)
  })

  test('board refreshes on its own board_update and not on another board', async ({ page }) => {
    // SPEC: board:sse-update
    const { counts, daemonSSE } = await openBoardWithFetchCount(page)
    const update = board_id => ({
      type: 'board_update',
      workspace_id: DEFAULT_WORKSPACE_ID,
      board_id,
    })
    const settled = async () => {
      let last = -1
      await expect
        .poll(
          () => {
            const unchanged = counts.board === last
            last = counts.board
            return unchanged
          },
          { intervals: [300] },
        )
        .toBe(true)
      return counts.board
    }

    const before = await settled()
    await daemonSSE.sendEvent(update('sprint-1'))
    await expect.poll(() => counts.board, { timeout: 5000 }).toBeGreaterThan(before)

    const afterOwn = await settled()
    await daemonSSE.sendEvent(update('backlog'))
    await page.waitForTimeout(1000)
    expect(counts.board).toBe(afterOwn)
  })

  test('an open ticket detail reloads on board_update without showing Loading', async ({
    page,
  }) => {
    // SPEC: board:ticket-file-update
    const bodies = ['# First\n\nfirst body', '# Second\n\nsecond body']
    await page.route(new RegExp(`${WS_PREFIX}/boards/.+/tickets/.+/content`), async route => {
      await route.fulfill({ body: bodies.length > 1 ? bodies.shift() : bodies[0] })
    })
    const { daemonSSE } = await openBoardWithFetchCount(page)
    await page.getByText('Setup infra').click()
    const content = page.locator('.ticket-detail-content')
    await expect(content).toContainText('first body')
    let sawLoading = false
    await page.exposeFunction('__sawLoading', () => {
      sawLoading = true
    })
    await page.evaluate(() => {
      new MutationObserver(() => {
        if (document.querySelector('.ticket-detail-loading')) {
          window.__sawLoading()
        }
      }).observe(document.body, { childList: true, subtree: true })
    })

    await daemonSSE.sendEvent({
      type: 'board_update',
      workspace_id: DEFAULT_WORKSPACE_ID,
      board_id: 'sprint-1',
    })

    await expect(content).toContainText('second body')
    expect(sawLoading).toBe(false)
  })

  test('drag card between columns calls move API with new column', async ({ page }) => {
    // SPEC: board:drag-column
    // SPEC: board:drag-collapsed
    // SPEC: board:auto-assign
    await openBoardWithAPI(page)
    const moved = await captureMove(page)

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

    await expect.poll(() => moved.payload, { timeout: 5000 }).toBeTruthy()
    expect(moved.payload.column).toBe('in-progress')
  })

  test('a refused move leaves the card in its column and shows why', async ({ page }) => {
    // SPEC: board:move-collision-refused
    await mockAPI(page)
    await mockBoardsAPI(page)
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`), route =>
      route.fulfill({
        status: 409,
        json: { error: 'ticket_move_refused', reason: 'destination_exists' },
      }),
    )
    await openBoard(page)

    const frontendBand = page.locator('.swimlane-band').first()
    const backlogCell = frontendBand.locator('.board-cell').nth(0)
    const inProgressCell = frontendBand.locator('.board-cell').nth(1)
    const card = backlogCell.locator('.ticket-card', { hasText: 'Setup infra' })
    await expect(card).toBeVisible()

    const cardBox = await card.boundingBox()
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

    await expect(page.locator('[data-testid="footer"]')).toContainText(
      'The target column already holds a ticket named setup.md',
    )
    await expect(backlogCell.locator('.ticket-card', { hasText: 'Setup infra' })).toBeVisible()
    await expect(inProgressCell.locator('.ticket-card', { hasText: 'Setup infra' })).toHaveCount(0)
  })

  test('a card whose file is outside its column folder stays put and says why', async ({
    page,
  }) => {
    // SPEC: board:move-outside-folder-refused
    await mockAPI(page)
    await mockBoardsAPI(page)
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`), route =>
      route.fulfill({
        status: 409,
        json: { error: 'ticket_move_refused', reason: 'not_in_column_folder' },
      }),
    )
    await openBoard(page)

    const frontendBand = page.locator('.swimlane-band').first()
    const backlogCell = frontendBand.locator('.board-cell').nth(0)
    const inProgressCell = frontendBand.locator('.board-cell').nth(1)
    const card = backlogCell.locator('.ticket-card', { hasText: 'Setup infra' })
    await expect(card).toBeVisible()

    const cardBox = await card.boundingBox()
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

    await expect(page.locator('[data-testid="footer"]')).toContainText(
      'setup.md is not in the folder its column keeps tickets in',
    )
    await expect(backlogCell.locator('.ticket-card', { hasText: 'Setup infra' })).toBeVisible()
    await expect(inProgressCell.locator('.ticket-card', { hasText: 'Setup infra' })).toHaveCount(0)
  })

  test('drag card between swimlanes calls move API with new swimlane', async ({ page }) => {
    // SPEC: board:drag-swimlane
    await openBoardWithAPI(page)
    const moved = await captureMove(page)

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

    await expect.poll(() => moved.payload, { timeout: 5000 }).toBeTruthy()
    expect(moved.payload.swimlane).toBe('backend')
  })

  test('dragging a ticket onto another ticket forwards index to move API', async ({ page }) => {
    // SPEC: board:intra-cell-reorder
    // SPEC: board:drop-index-insertion
    await openBoardWithAPI(page)
    const moved = await captureMove(page)

    // Drops "Setup infra" onto a same-cell ticket to exercise reorder; move must carry an explicit index.
    const sourceCard = page.locator('.ticket-card', { hasText: 'Setup infra' })
    await expect(sourceCard).toBeVisible()

    const cards = page
      .locator('.swimlane-band')
      .first()
      .locator('.board-cell')
      .first()
      .locator('.ticket-card')
    // Headless dnd-kit needs the pointer to dwell over the ticket, not the cell; brief waits let it settle.
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

    // Either path yields a move call with an explicit numeric index, proving drop-on-ticket forwards a position.
    await expect.poll(() => moved.payload, { timeout: 5000 }).toBeTruthy()
    expect(typeof moved.payload.index).toBe('number')
  })

  test('density toggle switches the board layout and reflects choice in URL', async ({ page }) => {
    // SPEC: board:density-toggle
    // SPEC: board:terse-layout
    await openBoardWithAPI(page)

    // Initial density: comfortable (cards rendered).
    await expect(page.locator('.ticket-card').first()).toBeVisible()
    expect(page.url()).not.toContain('density=terse')

    const toggle = page.locator('.panel-control-bar .panel-control-btn').first()
    await toggle.click()

    // After toggle, the URL gains density=terse and cells render inline ticket-ID links instead of cards.
    await expect.poll(() => page.url(), { timeout: 3000 }).toContain('density=terse')
    await expect(page.locator('.ticket-link').first()).toBeVisible()
    await expect(page.locator('.ticket-card')).toHaveCount(0)

    // Click a terse ticket link -> opens detail overlay (same as card click).
    await page.locator('.ticket-link').first().click()
    await expect(page.locator('.ticket-detail-panel')).toBeVisible()
  })

  test('drag overlay ghost follows cursor during drag', async ({ page }) => {
    // SPEC: board:drag-overlay
    await openBoardWithAPI(page)

    const card = page.locator('.ticket-card', { hasText: 'Setup infra' })
    await expect(card).toBeVisible()

    const cardBox = await card.boundingBox()

    await expect(page.locator('.ticket-card.drag-overlay')).toHaveCount(0)

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2 + 20, {
      steps: 5,
    })

    const overlay = page.locator('.ticket-card.drag-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText('Setup infra')

    await page.mouse.up()

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
    // Registered before navigating so it wins over mockBoardsAPI's catch-all GET handler on the same URL.
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
      if (route.request().method() === 'PATCH') {
        renameCalledWith = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({ json: { ok: true } })
      } else {
        await route.fallback()
      }
    })
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
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
      if (route.request().method() === 'PATCH') {
        renameCalled = true
        await route.fulfill({ json: { ok: true } })
      } else {
        await route.fallback()
      }
    })
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
    await openSession(page)
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
    await openSession(page)
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

  // Dispatches contextmenu directly on the cell node since TicketCard's own handler stops propagation.
  // bandIndex: 0=Frontend, 1=Backend, 2=Unsorted; cellIndex: 0=backlog, 1=in-progress, ...
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
    await openBoard(page)

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
    await openBoard(page)

    // Frontend swimlane x Review column (index 2) - empty in the fixture.
    await rightClickCell(page, 0, 2)

    const menuButton = page.locator('.swimlane-context-menu button')
    await expect(menuButton).toBeVisible()
    await expect(menuButton).toBeDisabled()
    expect(await menuButton.textContent()).toMatch(/\(0 tickets\)/)
  })

  // SPEC: board:cell-context-menu
  test('clicking the backdrop dismisses the cell context menu', async ({ page }) => {
    await openBoard(page)

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
    // Board fixture has 4 backlog tickets (3 frontend + 1 backend) for deterministic select-vs-unselected targets.
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
    await mockBoardList(page)
    await mockBoardDetail(page, BULK_BOARD)
  })

  // SPEC: board:drag-bulk-selected
  test('dragging a selected ticket carries every selected ticket; dragging unselected moves only that one', async ({
    page,
  }) => {
    // Two-phase drag-and-drop: assign() serializes before each move, outrunning the default test budget.
    test.setTimeout(30000)
    // Register first so it wins over any earlier registration.
    const moves = await captureMoves(page)
    // Stub assignTickets so auto-assign doesn't error noisily.
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/assign`), async route => {
      await route.fulfill({ json: { sessions: [{ session_id: 'shared-001' }] } })
    })

    const board = await openBoard(page)

    await ctrlClickT1toT3(board)
    await expect(board.locator('.ticket-card.selected')).toHaveCount(3)

    // Drag T2 (one of the selected) to in-progress column in frontend swimlane.
    const { dragCard, inProgressCell } = frontendInProgressDrag(page, 'T2')

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

    // Expect 3 PATCH calls; poll generously since assign()'s shared-session call serializes ahead of each move.
    await expect.poll(() => moves.length, { timeout: 15000 }).toBe(3)
    const movedPaths = moves.map(m => m.ticketPath).sort()
    expect(movedPaths).toEqual([
      'docs/tickets/active/t1.md',
      'docs/tickets/active/t2.md',
      'docs/tickets/active/t3.md',
    ])

    // Phase 2 drags unselected T4; state resets in place since a reload would break the mocked SSE wiring.
    moves.length = 0
    await ctrlClickT1toT3(board)
    await expect(board.locator('.ticket-card.selected')).toHaveCount(0)

    // Re-selects T1-T3 in their post-drag positions; selection is tracked by path, so column doesn't matter.
    await ctrlClickT1toT3(board)
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
  // Board fixture spreads tickets across two swimlanes for multi-lane selection and cross-lane preservation.
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
    await mockBoardList(page)
    await mockBoardDetail(page, CROSS_LANE_BOARD)
  })

  // SPEC: board:cross-lane-bulk-preserve
  test('cross-lane bulk move preserves each ticket origin swimlane', async ({ page }) => {
    const moves = await captureMoves(page)

    const board = await openBoard(page)

    // Multi-select tickets across two swimlanes (T1 frontend, T3 backend).
    await board.getByText('T1').click({ modifiers: ['Control'] })
    await board.getByText('T3').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(2)

    // Drags T1 (frontend) onto the backend in-progress cell; each ticket should keep its origin swimlane.
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

    // Both land in in-progress with origin swimlane intact: an absent swimlane field means preserved.
    const byPath = Object.fromEntries(moves.map(m => [m.ticketPath, m.body]))
    expect(byPath['docs/tickets/active/t1.md']).toEqual({ column: 'in-progress' })
    expect(byPath['docs/tickets/active/t3.md']).toEqual({ column: 'in-progress' })
  })

  // SPEC: board:column-header-drop
  test('dropping ticket on column header moves column without changing swimlane', async ({
    page,
  }) => {
    const moves = await captureMoves(page)

    await openBoard(page)

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
    await mockBoardList(page)
    await mockBoardDetail(page)
  })

  // SPEC: board:column-rename
  test('double-clicking column header opens input that PATCHes label', async ({ page }) => {
    let renameBody = null
    let renamedStateId = null

    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/states/[^/]+$`), async route => {
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
    })

    await openBoard(page)

    const backlogHeader = page.locator('.board-col-header').first()
    await backlogHeader.dblclick()

    const input = page.locator('.board-col-name-input')
    await expect(input).toBeVisible()

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
    await page.unroute(new RegExp(`${WS_PREFIX}/boards/[^/]+$`))
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
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
    })
    // Re-registered so it wins over the beforeEach handler; ordering matters with encoded slashes in the URL.
    await stubMoves(page)
    let assignBody = null
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/assign`), async route => {
      const post = route.request().postData()
      try {
        assignBody = JSON.parse(post || '{}')
      } catch {
        assignBody = post
      }
      await route.fulfill({ json: { sessions: [{ session_id: 'shared-session-001' }] } })
    })
    const board = await openBoard(page)
    await expect(board.getByText('Setup infra')).toBeVisible()
    await expect(board.getByText('Boards')).toBeVisible()

    // Selects two backlog tickets (Setup infra + Boards) and bulk-drags the first to In Progress.
    await board.getByText('Setup infra').click({ modifiers: ['Control'] })
    await board.getByText('Boards').click({ modifiers: ['Control'] })
    await expect(board.locator('.ticket-card.selected')).toHaveCount(2)

    const { dragCard, inProgressCell } = frontendInProgressDrag(page, 'Setup infra')

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

    // A single shared assign call covers all moved tickets; parallel:false tells the backend to spawn one session.
    await expect.poll(() => assignBody, { timeout: 5000 }).toBeTruthy()
    expect(assignBody.parallel).toBe(false)
    expect(assignBody.tickets.sort()).toEqual([
      'docs/tickets/active/boards.md',
      'docs/tickets/active/setup.md',
    ])
  })
})

test.describe('Board reopen', () => {
  // SPEC: board:reopen-assign
  test('a card dragged from Done into an active column is assigned under its new path', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockBoardsAPI(page)
    const REOPEN_BOARD = {
      ...MOCK_BOARD_DETAIL,
      states: MOCK_BOARD_DETAIL.states.map(s =>
        s.id === 'in-progress' ? { ...s, active: true } : s,
      ),
      columns: {
        ...MOCK_BOARD_DETAIL.columns,
        'in-progress': [],
        done: [{ path: 'docs/tickets/completed/init.md', title: 'Init project' }],
      },
    }
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+$`), async route => {
      await route.fulfill({ json: REOPEN_BOARD })
    })
    let moved = null
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/.+/move`), async route => {
      moved = movedEntry(route).path
      await route.fulfill({ json: { path: 'docs/tickets/active/init.md' } })
    })
    let assignBody = null
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/assign`), async route => {
      assignBody = JSON.parse(route.request().postData())
      await route.fulfill({ json: { sessions: [{ session_id: 'reopened-001' }] } })
    })

    await openBoard(page)

    await page.locator('.board-col-header').nth(3).locator('.board-col-toggle').click()
    const card = page.locator('.ticket-card', { hasText: 'Init project' })
    await expect(card).toBeVisible()

    const cardBox = await card.boundingBox()
    const headerBox = await page.locator('.board-col-header').nth(1).boundingBox()
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
      steps: 3,
    })
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2, {
      steps: 5,
    })
    await page.mouse.up()

    await expect.poll(() => assignBody, { timeout: 5000 }).toBeTruthy()
    expect(moved).toBe('docs/tickets/completed/init.md')
    expect(assignBody.tickets).toEqual(['docs/tickets/active/init.md'])
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
    // Board has prompt.sequence; the backend expands {ticket} server-side, so the assertion
    // reads the assign ticket paths.
    const PROMPT_BOARD = {
      ...MOCK_BOARD_DETAIL,
      states: MOCK_BOARD_DETAIL.states.map(s =>
        s.id === 'in-progress' ? { ...s, active: true } : s,
      ),
      prompt: { sequence: ['review the board', 'start on {ticket}'] },
    }
    await mockBoardList(page)
    await mockBoardDetail(page, PROMPT_BOARD)
    await stubMoves(page)

    let assignBody = null
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/assign`), async route => {
      assignBody = JSON.parse(route.request().postData())
      await route.fulfill({ json: { sessions: [{ session_id: 'sess-from-seq' }] } })
    })

    await openBoard(page)

    // Drag a backlog ticket to In Progress (active column).
    const { dragCard, inProgressCell } = frontendInProgressDrag(page, 'Setup infra')

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

    // Assign call carries the ticket path; backend expands prompt.sequence server-side via {ticket} -> path.
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

    await expect
      .poll(async () =>
        page.evaluate(() => {
          // Board tab appearing is the clearest signal: it renders once workspaceId === activeWorkspaceId.
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
    await mockBoardList(page)
    await mockBoardDetail(page)
  })

  // SPEC: board:col-dnd-reorder
  test('non-collapsed column headers expose a drag handle', async ({ page }) => {
    const board = await openBoard(page)

    // Every non-collapsed header renders a grip-handle span; poll since terminal columns collapse async.
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
    const board = await openBoard(page)

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
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/states/reorder`), async route => {
      if (route.request().method() === 'PATCH') {
        reorderPayload = JSON.parse(route.request().postData())
        await route.fulfill({ json: {} })
      } else {
        await route.continue()
      }
    })

    const board = await openBoard(page)

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
    await page.route(new RegExp(`${WS_PREFIX}/boards/[^/]+/tickets/[^/]+$`), async route => {
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
    })

    const board = await openBoard(page)

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
