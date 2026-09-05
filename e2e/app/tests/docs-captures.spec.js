/** Documentation screenshots, recorded from the same mocks the rest of the suite runs on. */

import { expect, test } from '@playwright/test'
import {
  openLogsPanel,
  openSessionsPanel,
  openSkillsPanel,
  waitForAppReady,
  waitForShortcutsReady,
} from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  loadFixture,
  mockAPI,
  mockBoards,
} from '../mocks/api.js'
import { createLogsSSEController, mockSSE } from '../mocks/sse.js'

// Captures compare at the default zero tolerance, never the visual suite's one-percent allowance:
// a drifted capture is a stale picture. Masks are out too - one paints a box into a shipped PNG.

// Snapshot names are arrays, never slash-bearing strings: Playwright sanitises a string name, and
// the capture would land flat in docs/ rather than under the directory it names.
const FEATURES = ['features', 'images']
const GUIDE = ['guide', 'images']
const ROOT = ['images']
const REFERENCE = ['reference', 'images']

const THREE_WORKSPACES = [
  { id: DEFAULT_WORKSPACE_ID, path: '/home/user/project', name: 'project' },
  { id: 'ws-docs', path: '/home/user/docs', name: 'docs' },
  { id: 'ws-infra', path: '/home/user/infrastructure', name: 'infrastructure' },
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
  return mockAPI(page, { statusFixture: 'status/docs.json', ...options })
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

/** Serve one preloaded dockview layout to whichever ui-state call the app makes. */
function layoutHandler(layout) {
  return async route => {
    await route.fulfill({ json: { global: {}, session: layout } })
  }
}

test.use({ viewport: { width: 1280, height: 720 } })

test.describe('Docs captures - chat', () => {
  test('a long transcript, older turns folded, minimap beside it', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Auto-collapse is on by default, which is the state the page describes - do not disable it.
    await expect(page.locator('.turn-container.turn-collapsed').first()).toBeVisible()
    await expect(page.locator('[data-testid="minimap"]')).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...FEATURES,
      'chat-minimap.png',
    ])
  })

  test('the terminal column, with a failed command marked', async ({ page }) => {
    await mockSSE(page, 'events/terminal-column-mixed.jsonl')
    await mockDocsAPI(page, { sessionUiStateDefaults: { terminalSplitEnabled: true } })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const column = page.locator('[data-testid="terminal-column"]')
    await expect(column.locator('.terminal-entry-failed').first()).toBeVisible()

    await expect(column).toHaveScreenshot([...FEATURES, 'chat-terminal.png'])
  })
})

test.describe('Docs captures - rendering', () => {
  test('markdown, math and highlighted code in one reply', async ({ page }) => {
    await mockSSE(page, 'events/docs-rendering.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.katex').first()).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...FEATURES,
      'rendering-markdown.png',
    ])
  })

  test('a word-level edit diff', async ({ page }) => {
    await mockSSE(page, 'events/tool-edit-char-highlight.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const block = page.locator('[data-testid="tool-block"]').first()
    await expect(block.locator('.tool-expanded-content')).toBeVisible()

    await expect(block).toHaveScreenshot([...FEATURES, 'rendering-edit-diff.png'])
  })

  test('a Mermaid diagram in the zoom overlay', async ({ page }) => {
    await mockSSE(page, 'events/mermaid-diagram.jsonl')
    await mockDocsAPI(page)
    // The overlay dims the app rather than hiding it, so what shows through needs its routes.
    await mockBoards(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // The renderer swaps its placeholder for the SVG asynchronously; shooting earlier catches it.
    await expect(page.locator('.mermaid-diagram').first()).toBeVisible()
    await page.locator('.mermaid-container').first().click()
    const overlay = page.locator('.zoom-overlay')
    await expect(overlay).toBeVisible()

    await expect(overlay).toHaveScreenshot([...FEATURES, 'rendering-mermaid-zoom.png'])
  })
})

test.describe('Docs captures - panels', () => {
  test.use({ viewport: { width: 1680, height: 900 } })

  test('panels docked around the chat, both icon strips in frame', async ({ page }) => {
    await mockSSE(page, 'events/docs-panels.jsonl')
    await mockDocsAPI(page, {
      sessionsFixture: 'sessions/multiple.json',
      handlers: { getUIState: layoutHandler(dockedLayout()) },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
    await mockSSE(page, 'events/docs-panels-running.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
    await mockBoards(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/boards/sprint-1`)
    await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')
    await page.evaluate(() => document.fonts.ready)

    const board = page.locator('.board-board')
    await expect(board).toBeVisible()

    await expect(board).toHaveScreenshot([...FEATURES, 'boards-swimlanes.png'])
  })
})

test.describe('Docs captures - nested containers', () => {
  test('an inner build and the service it starts, in the terminal column', async ({ page }) => {
    await mockSSE(page, 'events/docs-nested-containers.jsonl')
    await mockDocsAPI(page, { sessionUiStateDefaults: { terminalSplitEnabled: true } })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const column = page.locator('[data-testid="terminal-column"]')
    await expect(column.locator('.terminal-entry-failed').first()).toBeVisible()

    await expect(column).toHaveScreenshot([...FEATURES, 'nested-containers-terminal.png'])
  })
})

test.describe('Docs captures - many sessions', () => {
  test('the sessions tree, forks nested under what they forked from', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page, {
      sessionsFixture: 'sessions/docs-tree.json',
      handlers: {
        getUIState: layoutHandler(singlePanelLayout('sessions', 'Sessions', 330, 'left')),
      },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Forks arrive folded under the session they came from; the page's point is seeing them.
    await page.locator('.sessions-expand-btn').first().click()
    await expect(page.locator('[data-testid="session-item"]')).toHaveCount(3)

    await expect(page.locator('[data-testid="panel-sessions"]')).toHaveScreenshot([
      ...FEATURES,
      'multi-session-tree.png',
    ])
  })

  test('the workspace switcher, listing what is registered', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page, { workspaces: THREE_WORKSPACES })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('[data-testid="workspace-switcher"]').click()
    const dropdown = page.locator('[data-testid="workspace-switcher-dropdown"]')
    await expect(dropdown.locator('.workspace-switcher-option')).toHaveCount(3)

    await expect(dropdown).toHaveScreenshot([...FEATURES, 'multi-session-switcher.png'])
  })

  test('a session an agent started, appearing as an ordinary row', async ({ page }) => {
    await mockSSE(page, 'events/docs-session-spawn.jsonl')
    await mockDocsAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: DEFAULT_SESSION_ID,
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
                  session_id: 'sib-index',
                  name: 'events index',
                  workspace: '/home/user/project',
                  model: 'claude-sonnet-5',
                  parent_session_id: null,
                  num_turns: 2,
                  total_cost_usd: 0.03,
                  total_duration_ms: 41000,
                  started_at: '2025-01-18T12:00:04Z',
                  updated_at: '2025-01-18T12:00:45Z',
                  first_message: 'Add the index on the events table',
                  last_message: 'Cold path is 1.4s with the index.',
                  container_id: 'claudebox-sib-index',
                },
              ],
            },
          })
        },
      },
    })
    // The whole viewport: the point is the spawning call and the ordinary row it produced, together.
    await mockBoards(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSessionsPanel(page)
    await expect(page.locator('[data-testid="tool-block"]').first()).toBeVisible()

    await expect(page).toHaveScreenshot([...FEATURES, 'multi-session-spawned.png'])
  })
})

test.describe('Docs captures - threads', () => {
  test('a quote holding its highlight, with the reply box beside it', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: 'root-session',
                  name: 'reports rollup',
                  parent_session_id: null,
                  num_turns: 9,
                },
                {
                  session_id: DEFAULT_SESSION_ID,
                  name: 'cache invalidation',
                  parent_session_id: 'root-session',
                  num_turns: 3,
                  container_id: DEFAULT_CONTAINER_ID,
                  is_side_thread: true,
                },
              ],
            },
          })
        },
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
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="rail-ancestor"]')).toBeVisible()

    await expect(page.locator('[data-testid="chat-rail"]')).toHaveScreenshot([
      ...FEATURES,
      'threads-rail.png',
    ])
  })

  test('the control bar offering where a fork should land', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.chat-control-fork-chevron').click()
    const dropdown = page.locator('.chat-control-fork-dropdown')
    await expect(dropdown).toBeVisible()

    await expect(dropdown).toHaveScreenshot([...FEATURES, 'threads-fork-menu.png'])
  })
})

test.describe('Docs captures - the queue', () => {
  test('messages waiting their turn under the conversation', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
    await mockSSE(page, 'events/docs-mcp-servers.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('[data-testid="icon-mcp"]').hover()
    const preview = page.locator('.floating-panel')
    await expect(preview).toBeVisible()
    await expect(preview.locator('.mcp-panel')).toBeVisible()

    await expect(preview).toHaveScreenshot([...FEATURES, 'panels-hover-preview.png'])
  })
})

test.describe('Docs captures - a board in motion', () => {
  test('a card carrying the status of the session working it', async ({ page }) => {
    await mockSSE(page)
    // The dot reads running only when the ticket's session id resolves to a live container, which
    // takes both a sessions entry and a container carrying that id.
    await mockDocsAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
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
              ],
            },
          })
        },
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
    await mockBoards(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/boards/sprint-1`)
    await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')
    await page.evaluate(() => document.fonts.ready)

    const card = page.locator('.ticket-card', { hasText: 'Polish UI' })
    await expect(card.locator('.ticket-status-dot')).toBeVisible()

    await expect(card).toHaveScreenshot([...FEATURES, 'boards-card-status.png'])
  })

  test('a card mid-drag toward another column', async ({ page }) => {
    await mockSSE(page)
    await mockDocsAPI(page)
    await mockBoards(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/boards/sprint-1`)
    await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')
    await page.evaluate(() => document.fonts.ready)

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
    await mockDocsAPI(page)
    // The whole viewport is in frame, so every panel behind the welcome screen needs its route.
    await mockBoards(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await expect(page.locator('[data-testid="welcome-page"]')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    await expect(page).toHaveScreenshot([...ROOT, 'start-welcome.png'])
  })

  test('the first message answered', async ({ page }) => {
    await mockSSE(page, 'events/docs-first-reply.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.getByText('mounted at the same path inside the container')).toBeVisible()

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveScreenshot([
      ...ROOT,
      'start-first-reply.png',
    ])
  })
})

test.describe('Docs captures - guides', () => {
  test('the Skills panel, showing what the profile gave the agent', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page, {
      statusFixture: 'status/docs-skills.json',
      handlers: { getUIState: layoutHandler(singlePanelLayout('commands', 'Skills', 420)) },
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.skills-item')).toHaveCount(4)
    await expect(page.locator('.skills-item-description').first()).toBeVisible()

    await expect(page.locator('.skills-panel')).toHaveScreenshot([...GUIDE, 'profiles-skills.png'])
  })

  test('the model picker open beside the runtime the session is on', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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

    await expect(page.locator('.logs-panel')).toHaveScreenshot([
      ...GUIDE,
      'troubleshooting-logs.png',
    ])
  })
})

test.describe('Docs captures - reference', () => {
  // The overlay is taller than a 720px window, and a clipped shortcut table is worse than none.
  test.use({ viewport: { width: 1280, height: 1000 } })

  test('the keyboard help overlay', async ({ page }) => {
    await mockSSE(page, 'events/docs-conversation.jsonl')
    await mockDocsAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await waitForShortcutsReady(page)
    await page.keyboard.press('Alt+?')
    const modal = page.locator('.help-overlay-modal')
    await expect(modal).toBeVisible()

    await expect(modal).toHaveScreenshot([...REFERENCE, 'shortcuts-help-overlay.png'])
  })
})
