/** Documentation screenshots, recorded from the same mocks the rest of the suite runs on. */

import { readFileSync } from 'node:fs'
import { devices, expect, test } from '@playwright/test'
import {
  disableAutoCollapse,
  openLogsPanel,
  openSessionsPanel,
  sessionsHandler,
  waitForAppReady,
  waitForMobileReady,
  waitForShortcutsReady,
  waitForStableScrollHeight,
} from '../helpers.js'
import { DEFAULT_CONTAINER_ID, loadFixture, mockAPI, mockBoards } from '../mocks/api.js'
import {
  createLogsSSEController,
  createSSEController,
  loadEventsFromFixture,
  mockSSE,
  mockSSEDynamic,
} from '../mocks/sse.js'

// Captures compare at the default zero tolerance, never the visual suite's one-percent allowance:
// a drifted capture is a stale picture. Masks are out too - one paints a box into a shipped PNG.

// Snapshot names are arrays, never slash-bearing strings: Playwright sanitises a string name, and
// the capture would land flat in docs/ rather than under the directory it names.
const FEATURES = ['features', 'images']
const GUIDE = ['guide', 'images']
const ROOT = ['images']
const REFERENCE = ['reference', 'images']

// Not the shared mock ids: the footer, the switcher and every session row print these.
const DOCS_WORKSPACE_ID = 'project'
const DOCS_SESSION_ID = 'c41d7e09-5b2a-4f63-9e18-a07b3d5c2f94'
const DOCS_BACKEND_ID = 'e5a90c3f7b21d4486c0a9e3f52b17d68c04a9b1e3f7d2c56a8e0b4d91f36a27c'
const DOCS_SESSION_URL = `/#/workspaces/${DOCS_WORKSPACE_ID}/sessions/${DOCS_SESSION_ID}`
const DOCS_WORKSPACES = [
  { id: DOCS_WORKSPACE_ID, path: '/home/user/project', containers: { running: 0, stopped: 0 } },
]

const { defaultBrowserType: _ignored, ...PIXEL_5 } = devices['Pixel 5']
const PLOT_PNG = readFileSync(new URL('../fixtures/files/plot.png', import.meta.url))

const THREE_WORKSPACES = [
  { id: DOCS_WORKSPACE_ID, path: '/home/user/project', name: 'project' },
  { id: 'docs', path: '/home/user/docs', name: 'docs' },
  { id: 'infrastructure', path: '/home/user/infrastructure', name: 'infrastructure' },
]

/** Dockview grid filling both sides of the chat, so a capture shows the docked arrangement. */
function dockedLayout() {
  const leaf = (id, size) => ({ type: 'leaf', data: { views: [id], activeView: id, id }, size })
  const panel = (id, title) => ({ id, contentComponent: id, tabComponent: 'icon', title })

  return {
    layout: {
      grid: {
        root: {
          type: 'branch',
          data: [
            leaf('sessions', 260),
            leaf('main', 1060),
            {
              type: 'branch',
              data: [leaf('todos', 300), leaf('tasks', 300), leaf('stash', 300)],
              size: 360,
            },
          ],
          size: 900,
        },
        width: 1680,
        height: 900,
        orientation: 'HORIZONTAL',
      },
      panels: {
        sessions: panel('sessions', 'Sessions'),
        main: panel('main', 'Main'),
        todos: panel('todos', 'Todos'),
        tasks: panel('tasks', 'Tasks'),
        stash: panel('stash', 'Stash'),
      },
      activeGroup: 'main',
    },
    panelGroups: {
      left: { width: 260, order: ['sessions'] },
      right: { width: 360, order: ['todos', 'tasks', 'stash'] },
    },
    stash: [
      { text: 'check whether the nightly job reads the same rollup', timestamp: 1737201600000 },
    ],
    updated_at: '2025-01-18T12:00:00Z',
  }
}

/** Select a run of text wherever an assistant message holds it, firing a real selectionchange. */
async function selectAssistantText(page, substring) {
  await page.evaluate(sub => {
    for (const message of document.querySelectorAll('[data-testid="message-assistant"]')) {
      const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const index = node.textContent.indexOf(sub)
        if (index >= 0) {
          const range = document.createRange()
          range.setStart(node, index)
          range.setEnd(node, index + sub.length)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
          document.dispatchEvent(new Event('selectionchange'))
          return
        }
        node = walker.nextNode()
      }
    }
  }, substring)
}

/** mockAPI carrying the documentation session's own status - named, real numbers, no bypass. */
function mockDocsAPI(page, options = {}) {
  return mockAPI(page, {
    statusFixture: 'status/docs.json',
    sessionsFixture: 'sessions/docs.json',
    workspaceId: DOCS_WORKSPACE_ID,
    sessionId: DOCS_SESSION_ID,
    backendId: DOCS_BACKEND_ID,
    workspaces: DOCS_WORKSPACES,
    ...options,
  })
}

/** Dockview grid with one right-hand panel wide enough to read, for a single-panel capture. */
function singlePanelLayout(id, title, width, side = 'right') {
  const leaf = (view, size) => ({
    type: 'leaf',
    data: { views: [view], activeView: view, id: view },
    size,
  })

  return {
    layout: {
      grid: {
        root: {
          type: 'branch',
          data:
            side === 'left'
              ? [leaf(id, width), leaf('main', 1280 - width)]
              : [leaf('main', 1280 - width), leaf(id, width)],
          size: 720,
        },
        width: 1280,
        height: 720,
        orientation: 'HORIZONTAL',
      },
      panels: {
        main: { id: 'main', contentComponent: 'main', tabComponent: 'icon', title: 'Main' },
        [id]: { id, contentComponent: id, tabComponent: 'icon', title },
      },
      activeGroup: 'main',
    },
    panelGroups:
      side === 'left'
        ? { left: { width, order: [id] }, right: { width: 0, order: [] } }
        : { left: { width: 0, order: [] }, right: { width, order: [id] } },
    updated_at: '2025-01-18T12:00:00Z',
  }
}

async function docsContainerRunning(route) {
  await route.fulfill({
    json: {
      containers: [{ id: DEFAULT_CONTAINER_ID, session_id: DOCS_SESSION_ID, status: 'running' }],
    },
  })
}

/** Serve one preloaded dockview layout to whichever ui-state call the app makes. */
function layoutHandler(layout, global = {}) {
  return async route => {
    await route.fulfill({ json: { global, session: layout } })
  }
}

function chatOnlyLayout(sessionState = {}) {
  return {
    layout: {
      grid: {
        root: {
          type: 'branch',
          data: [
            { type: 'leaf', data: { views: ['main'], activeView: 'main', id: 'main' }, size: 1280 },
          ],
          size: 720,
        },
        width: 1280,
        height: 720,
        orientation: 'HORIZONTAL',
      },
      panels: {
        main: { id: 'main', contentComponent: 'main', tabComponent: 'icon', title: 'Main' },
      },
      activeGroup: 'main',
    },
    panelGroups: { left: { width: 0, order: [] }, right: { width: 0, order: [] } },
    updated_at: '2025-01-18T12:00:00Z',
    ...sessionState,
  }
}

async function openChatOnly(page, fixture, sessionState = {}, apiOptions = {}) {
  await openDocsSession(page, fixture, {
    ...apiOptions,
    handlers: { getUIState: layoutHandler(chatOnlyLayout(sessionState)), ...apiOptions.handlers },
  })
}

test.use({ viewport: { width: 1280, height: 720 } })

async function openSprintBoard(page) {
  await mockBoards(page, DOCS_WORKSPACE_ID)
  await page.goto(`/#/workspaces/${DOCS_WORKSPACE_ID}/boards/sprint-1`)
  await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')
  await page.evaluate(() => document.fonts.ready)
}

async function openDocsSession(page, fixture = 'events/docs-conversation.jsonl', apiOptions) {
  await mockDocsAPI(page, apiOptions)
  await openDocsTranscript(page, fixture)
}

async function openDocsTranscript(page, events) {
  if (Array.isArray(events)) {
    await mockSSEDynamic(page, () => events)
  } else {
    await mockSSE(page, events)
  }
  await page.goto(DOCS_SESSION_URL)

  return waitForAppReady(page)
}

test.describe('Docs captures - chat', () => {
  test('a long transcript, older turns folded, minimap beside it', async ({ page }) => {
    await openDocsSession(page)

    // Auto-collapse is on by default, which is the state the page describes - do not disable it.
    await expect(page.locator('.turn-container.turn-collapsed').first()).toBeVisible()
    await expect(page.locator('[data-testid="minimap"]')).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...FEATURES,
      'chat-minimap.png',
    ])
  })

  test('the terminal column, with a failed command marked', async ({ page }) => {
    await openChatOnly(page, 'events/terminal-column-mixed.jsonl', { rightSlotView: 'terminal' })

    const column = page.locator('[data-testid="terminal-column"]')
    await expect(column.locator('.terminal-entry-failed').first()).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'chat-terminal.png'])
  })

  test('the work column, tool calls grouped by the turn that made them', async ({ page }) => {
    await openChatOnly(page, 'events/docs-tool-calls.jsonl', { rightSlotView: 'work' })

    const column = page.locator('[data-testid="work-column"]')
    await expect(column.locator('[data-tool-use-id="tu_bench"]')).toBeVisible()
    await waitForStableScrollHeight(page.locator('[data-testid="chat-messages"]'))

    await expect(page).toHaveScreenshot([...FEATURES, 'chat-work.png'])
  })

  test('Focused: a turn reduced to what it changed and said, the newest naming its read', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2025-01-18T12:31:16Z') })
    await page.clock.setFixedTime(new Date('2025-01-18T12:31:16Z'))
    await openChatOnly(page, 'events/docs-focused.jsonl')
    await disableAutoCollapse(page)
    const scroller = page.locator('[data-testid="chat-messages"]')
    await waitForStableScrollHeight(scroller)
    await scroller.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })

    await expect(page.getByTestId('turn-progress-working')).toHaveText('Reading notes.md...')
    await expect(page.locator('[data-tool-use-id="tu_write_migration"]')).toBeInViewport()
    await expect(page.locator('[data-tool-use-id="tu_read_schema"]')).toHaveCount(0)

    await expect(page).toHaveScreenshot([...FEATURES, 'chat-focused.png'])
  })

  test('Everything: the same conversation with its reads shown as blocks', async ({ page }) => {
    await page.clock.install({ time: new Date('2025-01-18T12:31:16Z') })
    await page.clock.setFixedTime(new Date('2025-01-18T12:31:16Z'))
    await openChatOnly(page, 'events/docs-focused.jsonl', { rightSlotView: 'everything' })
    await disableAutoCollapse(page)
    const scroller = page.locator('[data-testid="chat-messages"]')
    await waitForStableScrollHeight(scroller)
    await scroller.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })

    await expect(page.locator('[data-tool-use-id="tu_read_schema"]')).toBeInViewport()
    await expect(page.locator('[data-tool-use-id="tu_read_notes"]')).toBeInViewport()

    await expect(page).toHaveScreenshot([...FEATURES, 'chat-everything.png'])
  })

  test('one part of a reply bookmarked, another under the pointer, the panel beside them', async ({
    page,
  }) => {
    const part = 'turn_001:p-evt_002-0-1'
    const bookmarks = {
      bookmarkedTurns: { [DOCS_SESSION_ID]: [part] },
      bookmarkMeta: {
        [`${DOCS_SESSION_ID}/${part}`]: {
          preview: 'The events table carries an index on the account column',
          sessionName: 'reports rollup',
          ts: Date.parse('2025-01-18T12:34:00Z'),
        },
      },
    }
    await page.clock.install({ time: new Date('2025-01-18T12:35:30Z') })
    await page.clock.setFixedTime(new Date('2025-01-18T12:35:30Z'))
    await openDocsSession(page, 'events/docs-part-bookmark.jsonl', {
      handlers: {
        getUIState: layoutHandler(singlePanelLayout('bookmarks', 'Bookmarks', 360), bookmarks),
      },
    })

    const reply = page.locator('[data-testid="message-assistant"] .turn-text')
    await expect(reply.locator('.md-block-bookmarked')).toHaveCount(1)
    await expect(page.locator('[data-testid="bookmark-item"]')).toHaveCount(1)
    await reply.locator('p', { hasText: 'Together, a first open' }).hover()
    await expect(page.getByTestId('block-strip').first()).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'chat-part-bookmark.png'])
  })

  test('a session that needs you, its reason in the sessions list and its replies offered', async ({
    page,
  }) => {
    const reason = 'Approve: merge the index migration'
    const docsStatus = loadFixture('status/docs.json')
    await openDocsSession(page, 'events/docs-needs-user.jsonl', {
      handlers: {
        getUIState: layoutHandler(singlePanelLayout('sessions', 'Sessions', 330, 'left')),
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              ...docsStatus,
              needs_user: reason,
              needs_user_replies: ['Merge it', 'Hold for review'],
            },
          })
        },
        getSessions: sessionsHandler([
          { ...docsStatus, container_id: DEFAULT_CONTAINER_ID, needs_user: reason },
          {
            session_id: '5d03a8c7-e2f9-41b6-9c4e-87a1f6d2b350',
            name: 'release notes',
            workspace: '/home/user/project',
            model: 'claude-sonnet-5-5',
            parent_session_id: null,
            num_turns: 4,
            total_cost_usd: 0.11,
            started_at: '2025-01-18T11:10:00Z',
            updated_at: '2025-01-18T11:40:00Z',
            first_message: 'Draft the notes for the reports changes.',
            last_message: 'The notes are ready for review.',
          },
        ]),
        // A row shows its reason only while its session resolves to a running container.
        getContainers: docsContainerRunning,
      },
    })

    await expect(page.getByTestId('needs-user-replies')).toBeVisible()
    await expect(page.locator('[data-testid="session-item"]', { hasText: reason })).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'chat-needs-you.png'])
  })
})

test.describe('Docs captures - chat on a phone', () => {
  test.use({ ...PIXEL_5, viewport: { width: 393, height: 851 }, hasTouch: true })

  test('the single-column chat with its top bar and status strip', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page)
    await page.goto(DOCS_SESSION_URL)
    await waitForMobileReady(page)
    await expect(page.locator('.turn-container').first()).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'chat-phone.png'])
  })
})

test.describe('Docs captures - rendering', () => {
  test('markdown, math, a callout and highlighted code in one reply', async ({ page }) => {
    await openDocsSession(page, 'events/docs-rendering.jsonl')

    await expect(page.locator('.katex').first()).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...FEATURES,
      'rendering-markdown.png',
    ])
  })

  test('paths in a tool result, a relative link and a relative image in a reply', async ({
    page,
  }) => {
    await mockDocsAPI(page, {
      handlers: { getUIState: layoutHandler(chatOnlyLayout({ rightSlotView: 'everything' })) },
    })
    // Registered after mockAPI, whose own image route answers 404 and would otherwise win.
    await page.route('**/api/workspaces/*/files/image*', route =>
      new URL(route.request().url()).searchParams.get('path') === 'out/plot.png'
        ? route.fulfill({ status: 200, contentType: 'image/png', body: PLOT_PNG })
        : route.fulfill({ status: 404, json: { error: 'file_not_found' } }),
    )
    await page.route('**/api/files/resolve-paths*', async route => {
      const { candidates } = JSON.parse(route.request().postData())
      const resolved = Object.fromEntries(
        candidates
          .filter(path => /^(src|tests)\/\w+/.test(path))
          .map(path => [path, `/home/user/project/${path}`]),
      )
      await route.fulfill({ json: { resolved } })
    })
    await openDocsTranscript(page, 'events/docs-rendering-paths.jsonl')

    const image = page.locator('.turn-text img').first()
    await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
    const search = page.locator('[data-tool-use-id="tu_rg_rollup"]')
    await search.locator('.tool-header-area').first().click()
    await expect(search.locator('.path-link')).toHaveCount(3)
    const scroller = page.locator('[data-testid="chat-messages"]')
    await waitForStableScrollHeight(scroller)
    await scroller.evaluate(el => {
      el.scrollTop = 0
    })

    await expect(page).toHaveScreenshot([...FEATURES, 'rendering-paths.png'])
  })

  test('a word-level edit diff', async ({ page }) => {
    await openDocsSession(page, 'events/docs-edit-diff.jsonl')

    const block = page.locator('[data-testid="tool-block"]').first()
    await expect(block.locator('.tool-expanded-content')).toBeVisible()

    await expect(block).toHaveScreenshot([...FEATURES, 'rendering-edit-diff.png'])
  })
})

test.describe('Docs captures - diagrams', () => {
  test('a Mermaid diagram in the zoom overlay', async ({ page }) => {
    await mockSSE(page, 'events/mermaid-diagram.jsonl')
    await mockDocsAPI(page)
    // The overlay dims the app rather than hiding it, so what shows through needs its routes.
    await mockBoards(page, DOCS_WORKSPACE_ID)
    await page.goto(DOCS_SESSION_URL)
    await waitForAppReady(page)

    // The renderer swaps its placeholder for the SVG asynchronously; shooting earlier catches it.
    await expect(page.locator('.mermaid-diagram').first()).toBeVisible()
    await page.locator('.mermaid-container').first().click()
    const overlay = page.locator('.zoom-overlay')
    await expect(overlay).toBeVisible()

    await expect(overlay).toHaveScreenshot([...FEATURES, 'diagrams-mermaid-zoom.png'])
  })

  test('a GeoJSON map drawn offline, before any tiles load', async ({ page }) => {
    await openDocsSession(page, 'events/docs-diagrams-map.jsonl')

    const map = page.locator('.geo-map').first()
    await expect.poll(() => map.locator('path.leaflet-interactive').count()).toBe(5)

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...FEATURES,
      'diagrams-map.png',
    ])
  })

  test('an STL model shaded in place', async ({ page }) => {
    await openDocsSession(page, 'events/docs-diagrams-model.jsonl')

    await expect(page.locator('.stl-viewer canvas').first()).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...FEATURES,
      'diagrams-model.png',
    ])
  })
})

test.describe('Docs captures - panels', () => {
  test.use({ viewport: { width: 1680, height: 900 } })

  test('panels docked around the chat, both icon strips in frame', async ({ page }) => {
    await openDocsSession(page, 'events/docs-panels.jsonl', {
      sessionsFixture: 'sessions/docs-several.json',
      handlers: { getUIState: layoutHandler(dockedLayout()) },
    })

    await expect(page.locator('.icon-strip-left')).toBeVisible()
    await expect(page.locator('.icon-strip-right')).toBeVisible()
    await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
    // Tasks opens on Active, which a finished task is not - All is the tab that lists it.
    const tasks = page.locator('[data-testid="panel-tasks"]')
    await tasks.locator('.tasks-filter-btn', { hasText: /^All/ }).click()
    await expect(tasks.locator('.tasks-list-empty')).toHaveCount(0)

    await expect(page).toHaveScreenshot([...FEATURES, 'panels-docked.png'])
  })

  test('badges on the icons whose panels have something to say', async ({ page }) => {
    // A running background task is what puts a count on Tasks; the strip is the whole frame, so its
    // spinner inside the panel never reaches the picture.
    await openDocsSession(page, 'events/docs-panels-running.jsonl')

    const strip = page.locator('.icon-strip-right')
    await expect(strip.locator('.icon-badge')).toHaveCount(2)

    // The strip runs the window's height with the badges at its top, so the frame clips to them.
    const box = await strip.boundingBox()
    await expect(page).toHaveScreenshot([...FEATURES, 'panels-badges.png'], {
      clip: { x: box.x - 12, y: box.y, width: box.width + 12, height: 220 },
    })
  })
})

test.describe('Docs captures - boards', () => {
  test('a board with its swimlanes and columns', async ({ page }) => {
    await mockSSE(page)
    await mockDocsAPI(page)
    await openSprintBoard(page)

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    await expect(board).toHaveScreenshot([...FEATURES, 'boards-swimlanes.png'])
  })
})

test.describe('Docs captures - nested containers', () => {
  test('an inner build and the service it starts, in the terminal column', async ({ page }) => {
    await openDocsSession(page, 'events/docs-nested-containers.jsonl', {
      sessionUiStateDefaults: { terminalSplitEnabled: true },
    })

    const column = page.locator('[data-testid="terminal-column"]')
    await expect(column.locator('.terminal-entry-failed').first()).toBeVisible()

    await expect(column).toHaveScreenshot([...FEATURES, 'nested-containers-terminal.png'])
  })
})

test.describe('Docs captures - many sessions', () => {
  test('the sessions tree, forks nested under what they forked from', async ({ page }) => {
    await openDocsSession(page, 'events/docs-conversation.jsonl', {
      sessionsFixture: 'sessions/docs-tree.json',
      handlers: {
        getUIState: layoutHandler(singlePanelLayout('sessions', 'Sessions', 330, 'left')),
      },
    })

    // Forks arrive folded under the session they came from; the page's point is seeing them.
    await page.locator('.sessions-expand-btn').first().click()
    await expect(page.locator('[data-testid="session-item"]')).toHaveCount(3)

    await expect(page.locator('[data-testid="panel-sessions"]')).toHaveScreenshot([
      ...FEATURES,
      'multi-session-tree.png',
    ])
  })

  test('the workspace switcher, listing what is registered', async ({ page }) => {
    await openDocsSession(page, 'events/docs-conversation.jsonl', {
      workspaces: THREE_WORKSPACES,
      handlers: {
        getUIState: layoutHandler(singlePanelLayout('sessions', 'Sessions', 330, 'left')),
        getSessions: sessionsHandler([
          { ...loadFixture('status/docs.json'), container_id: DEFAULT_CONTAINER_ID },
        ]),
      },
    })

    await page.locator('[data-testid="workspace-switcher"]').click()
    const dropdown = page.locator('[data-testid="workspace-switcher-dropdown"]')
    await expect(dropdown.locator('.workspace-switcher-option')).toHaveCount(3)

    await expect(page).toHaveScreenshot([...FEATURES, 'multi-session-switcher.png'])
  })

  test('a session an agent started, its reply arriving under its name', async ({ page }) => {
    await mockSSE(page, 'events/docs-session-spawn.jsonl')
    await mockDocsAPI(page, {
      handlers: {
        getSessions: sessionsHandler([
          {
            session_id: DOCS_SESSION_ID,
            name: 'reports rollup',
            workspace: '/home/user/project',
            model: 'claude-sonnet-5',
            parent_session_id: null,
            num_turns: 9,
            total_cost_usd: 0.42,
            total_duration_ms: 214000,
            started_at: '2025-01-18T12:00:00Z',
            updated_at: '2025-01-18T12:24:00Z',
            first_message: 'Loading the reports page takes twelve seconds.',
            last_message: 'Reports open in about a quarter of a second.',
            container_id: DEFAULT_CONTAINER_ID,
          },
          {
            session_id: 'b8e2f415-63ad-4c09-a7e1-5f2d9b84c036',
            name: 'events index',
            workspace: '/home/user/project',
            model: 'claude-sonnet-5',
            parent_session_id: null,
            num_turns: 2,
            total_cost_usd: 0.03,
            total_duration_ms: 41000,
            started_at: '2025-01-18T12:00:02Z',
            updated_at: '2025-01-18T12:00:48Z',
            first_message: 'Add the index on the events table and measure the cold path',
            last_message: "The reports page's cold path went from 12.1s to 1.4s over five runs.",
            container_id: null,
          },
        ]),
      },
    })
    // The whole viewport: the spawn, the sibling's reply, the stop and the row it left, together.
    await mockBoards(page, DOCS_WORKSPACE_ID)
    await page.goto(DOCS_SESSION_URL)
    await waitForAppReady(page)

    await openSessionsPanel(page)
    await expect(page.locator('[data-testid="sibling-message"]')).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'multi-session-spawned.png'])
  })
})

test.describe('Docs captures - container boundary', () => {
  test('a port request waiting on its card, the session needing you', async ({ page }) => {
    const reason = 'Approve: open port 5173'
    const docsStatus = loadFixture('status/docs.json')
    await openDocsSession(page, 'events/docs-port-request.jsonl', {
      handlers: {
        getUIState: layoutHandler(singlePanelLayout('sessions', 'Sessions', 330, 'left')),
        getSessionStatus: async route => {
          await route.fulfill({ json: { ...docsStatus, needs_user: reason } })
        },
        getSessions: sessionsHandler([
          { ...docsStatus, container_id: DEFAULT_CONTAINER_ID, needs_user: reason },
        ]),
        getContainers: docsContainerRunning,
      },
    })

    await expect(page.getByTestId('port-request')).toBeVisible()
    await expect(page.locator('[data-testid="session-item"]', { hasText: reason })).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'container-boundary-port-request.png'])
  })
})

test.describe('Docs captures - threads', () => {
  test('a quote holding its highlight, with the reply box beside it', async ({ page }) => {
    await openDocsSession(page)

    const affordance = page.locator('[data-testid="quote-affordance"]')
    // Select and click as one retried unit: a settling layout can clear the affordance between.
    await expect(async () => {
      await selectAssistantText(page, 'invalidated by the writer')
      await affordance.click({ timeout: 1500 })
    }).toPass({ timeout: 15000, intervals: [200, 400, 800] })

    await expect(page.locator('.inline-thread').first()).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...FEATURES,
      'threads-quote-reply.png',
    ])
  })

  test('the session rail, one group focused and its parent reading beside it', async ({ page }) => {
    await openDocsSession(page, 'events/docs-conversation.jsonl', {
      handlers: {
        getSessions: sessionsHandler([
          {
            session_id: '9f4c21e6-07b8-4d5a-b3e9-c6a8d1f50e27',
            name: 'reports rollup',
            parent_session_id: null,
            num_turns: 9,
          },
          {
            session_id: DOCS_SESSION_ID,
            name: 'cache invalidation',
            parent_session_id: '9f4c21e6-07b8-4d5a-b3e9-c6a8d1f50e27',
            num_turns: 3,
            container_id: DEFAULT_CONTAINER_ID,
            is_side_thread: true,
          },
        ]),
        getSessionEvents: async route => {
          await route.fulfill({
            json: {
              events: [
                {
                  id: 'e1',
                  type: 'user',
                  subtype: 'text',
                  is_human: true,
                  turn_id: 't1',
                  content: 'Where does the reports page spend its twelve seconds?',
                },
                {
                  id: 'e2',
                  type: 'assistant',
                  subtype: 'text',
                  content: 'One query, recomputed per request. The rendering is under 200ms.',
                },
              ],
              running: false,
            },
          })
        },
      },
    })

    await expect(page.locator('[data-testid="rail-ancestor"]')).toBeVisible()

    await expect(page.locator('[data-testid="chat-rail"]')).toHaveScreenshot([
      ...FEATURES,
      'threads-rail.png',
    ])
  })

  test('a reply asked on its own, answered in the box beside its quote', async ({ page }) => {
    await page.addInitScript(sessionId => {
      localStorage.setItem(
        `inline-replies:${sessionId}`,
        JSON.stringify([
          {
            id: 'r1',
            quote: 'a single call at the end of it',
            from: 'assistant',
            turnId: 'turn_003',
            prefix: '',
            suffix: '',
            offset: 0,
            response: '',
            threadSessionId: 'side-1',
            promotedSessionId: null,
            railPromoted: false,
          },
        ]),
      )
    }, DOCS_SESSION_ID)
    await mockDocsAPI(page, {
      handlers: {
        getUIState: layoutHandler(
          chatOnlyLayout({ inlineReplySizes: { r1: { width: 560, height: 400 } } }),
        ),
      },
    })
    await page.route('**/api/sessions/side-1/events', route =>
      route.fulfill({
        json: {
          events: loadEventsFromFixture('events/docs-ask-alone.jsonl'),
          running: false,
        },
      }),
    )
    await openDocsTranscript(page, 'events/docs-conversation.jsonl')
    await disableAutoCollapse(page)
    const scroller = page.locator('[data-testid="chat-messages"]')
    await waitForStableScrollHeight(scroller)
    await scroller.evaluate(el => {
      el.scrollTop = 0
    })
    await page
      .locator('[data-turn-id="turn_003"]')
      .evaluate(el => el.scrollIntoView({ block: 'start' }))
    await waitForStableScrollHeight(scroller)

    const point = await page.evaluate(sub => {
      for (const message of document.querySelectorAll('[data-testid="message-assistant"]')) {
        const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const index = node.textContent.indexOf(sub)
          if (index >= 0) {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + sub.length)
            const r = range.getBoundingClientRect()
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
          }
        }
      }
      return null
    }, 'a single call at the end of it')
    await page.mouse.click(point.x, point.y)
    const float = page.locator('.inline-float')
    await expect(float.getByTestId('inline-thread-promote')).toBeVisible()
    await expect(float.locator('[data-testid="tool-block"]')).toBeVisible()
    await expect(float.getByTestId('message-user').first()).toBeInViewport()

    await expect(page).toHaveScreenshot([...FEATURES, 'threads-ask-alone.png'])
  })

  test('the control bar offering where a fork should land', async ({ page }) => {
    await openChatOnly(page, 'events/docs-conversation.jsonl')

    await page.locator('.chat-control-fork-chevron').click()
    const dropdown = page.locator('.chat-control-fork-dropdown')
    await expect(dropdown).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'threads-fork-menu.png'])
  })
})

test.describe('Docs captures - the queue', () => {
  test('messages waiting their turn under the conversation', async ({ page }) => {
    await openDocsSession(page)

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('Then show me the query it runs today.')
    await page.keyboard.press('Alt+Enter')
    await input.fill('And whether an index would carry the cold path on its own.')
    await page.keyboard.press('Alt+Enter')

    await expect(page.locator('[data-testid="queued-message-bubble"]')).toHaveCount(2)

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...FEATURES,
      'chat-queue.png',
    ])
  })
})

test.describe('Docs captures - a closed panel on hover', () => {
  test('a closed panel opening as a floating preview', async ({ page }) => {
    // A closed panel with something in it: the rolling cost windows would read all zeros unless
    // the fixture's sessions were dated against the wall clock, which a capture cannot do.
    await openChatOnly(page, 'events/docs-mcp-servers.jsonl')

    await page.locator('[data-testid="icon-mcp"]').hover()
    const preview = page.locator('.floating-panel')
    await expect(preview).toBeVisible()
    await expect(preview.locator('.mcp-panel')).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'panels-hover-preview.png'])
  })
})

test.describe('Docs captures - a board in motion', () => {
  test('a card carrying the status of the session working it', async ({ page }) => {
    await mockSSE(page)
    // The dot reads running only when the ticket's session id resolves to a live container, which
    // takes both a sessions entry and a container carrying that id.
    await mockDocsAPI(page, {
      handlers: {
        getSessions: sessionsHandler([
          {
            session_id: 'session-001',
            name: 'polish the board view',
            workspace: '/home/user/project',
            model: 'claude-sonnet-5',
            num_turns: 3,
            total_cost_usd: 0.08,
            started_at: '2025-01-18T12:00:00Z',
            updated_at: '2025-01-18T12:12:00Z',
            parent_session_id: null,
            container_id: DEFAULT_CONTAINER_ID,
          },
        ]),
        getContainers: async route => {
          await route.fulfill({
            json: {
              containers: [
                { id: DEFAULT_CONTAINER_ID, session_id: 'session-001', status: 'running' },
              ],
            },
          })
        },
      },
    })
    await openSprintBoard(page)

    const card = page.locator('.ticket-card', { hasText: 'Polish UI' })
    await expect(card.locator('.ticket-status-dot')).toBeVisible()

    await expect(card).toHaveScreenshot([...FEATURES, 'boards-card-status.png'])
  })

  test('a card mid-drag toward another column', async ({ page }) => {
    await mockSSE(page)
    await mockDocsAPI(page)
    await openSprintBoard(page)

    const card = page.locator('.ticket-card', { hasText: 'Setup infra' })
    const box = await card.boundingBox()

    // dnd-kit's pointer sensor arms after five pixels of travel, so the drag is pressed and then
    // walked in steps; the frame is taken before the release.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 20, { steps: 8 })
    await expect(page.locator('.ticket-card.drag-overlay')).toBeVisible()

    await expect(page.locator('.board-board')).toHaveScreenshot([
      ...FEATURES,
      'boards-card-drag.png',
    ])
    await page.mouse.up()
  })
})

test.describe('Docs captures - starting out', () => {
  test('the interface on first load, before any session exists', async ({ page }) => {
    await mockSSE(page, 'events/empty.jsonl')
    await mockDocsAPI(page, { sessionsFixture: 'sessions/docs-none.json' })
    // The whole viewport is in frame, so every panel behind the welcome screen needs its route.
    await mockBoards(page, DOCS_WORKSPACE_ID)
    await page.goto(`/#/workspaces/${DOCS_WORKSPACE_ID}`)
    await expect(page.locator('[data-testid="welcome-page"]')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    await expect(page).toHaveScreenshot([...ROOT, 'start-welcome.png'])
  })

  test('the first message answered', async ({ page }) => {
    await openDocsSession(page, 'events/docs-first-reply.jsonl')

    await expect(page.getByText('mounted at the same path inside the container')).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...ROOT,
      'start-first-reply.png',
    ])
  })
})

test.describe('Docs captures - guides', () => {
  test('the Skills panel, showing what the profile gave the agent', async ({ page }) => {
    await openDocsSession(page, 'events/docs-conversation.jsonl', {
      statusFixture: 'status/docs-skills.json',
      handlers: { getUIState: layoutHandler(singlePanelLayout('commands', 'Skills', 420)) },
    })

    await expect(page.locator('.skills-item')).toHaveCount(4)
    await expect(page.locator('.skills-item-description').first()).toBeVisible()
    await page.locator('[data-testid="chat-input"]').fill('/')
    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()

    await expect(page).toHaveScreenshot([...GUIDE, 'profiles-skills.png'])
  })

  test('the model picker open beside the runtime the session is on', async ({ page }) => {
    await openDocsSession(page)

    await page.locator('[data-testid="footer-model"]').click()
    const dropdown = page.locator('.footer-picker-dropdown')
    await expect(dropdown).toBeVisible()

    // The dropdown is absolutely positioned above the footer, so a shot of the footer element
    // catches the closed strip alone; the frame spans both.
    const menu = await dropdown.boundingBox()
    const footer = await page.locator('[data-testid="footer"]').boundingBox()
    await expect(page).toHaveScreenshot([...GUIDE, 'runtimes-model-picker.png'], {
      clip: {
        x: menu.x - 220,
        y: menu.y,
        width: menu.width + 240,
        height: footer.y + footer.height - menu.y,
      },
    })
  })

  test('the Logs panel carrying a stream', async ({ page }) => {
    const logs = await createLogsSSEController(page)
    const chat = await createSSEController(page)
    await mockDocsAPI(page, { handlers: { getUIState: layoutHandler(chatOnlyLayout()) } })
    await page.goto(DOCS_SESSION_URL)
    await waitForAppReady(page)
    await chat.sendEvents(loadEventsFromFixture('events/docs-conversation.jsonl'))
    await expect(page.locator('.turn-container').first()).toBeVisible()

    await openLogsPanel(page)
    // Epoch seconds, the shape the log stream carries; anything else renders as "Invalid Date".
    await logs.sendLogs([
      {
        timestamp: 1737201600,
        level: 'info',
        logger: 'claudebox.session',
        message: 'Session started, container reports healthy',
      },
      {
        timestamp: 1737201603,
        level: 'debug',
        logger: 'claudebox.pipeline',
        message: 'Replayed 42 events from the transcript',
      },
      {
        timestamp: 1737201607,
        level: 'warning',
        logger: 'claudebox.containers',
        message: 'Health probe took 1.9s, above the 1.5s budget',
      },
      {
        timestamp: 1737201612,
        level: 'error',
        logger: 'claudebox.containers',
        message: 'Health check failed: connection refused',
      },
    ])
    await expect(page.locator('.log-line')).toHaveCount(4)

    await expect(page).toHaveScreenshot([...GUIDE, 'troubleshooting-logs.png'])
  })
})

test.describe('Docs captures - reference', () => {
  // The overlay is taller than a 720px window, and a clipped shortcut table is worse than none.
  test.use({ viewport: { width: 1280, height: 1000 } })

  test('the keyboard help overlay', async ({ page }) => {
    await openDocsSession(page)

    await waitForShortcutsReady(page)
    await page.keyboard.press('Alt+?')
    const modal = page.locator('.help-overlay-modal')
    await expect(modal).toBeVisible()

    await expect(modal).toHaveScreenshot([...REFERENCE, 'shortcuts-help-overlay.png'])
  })
})
