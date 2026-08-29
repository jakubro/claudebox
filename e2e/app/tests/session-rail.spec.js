/** E2E tests for the session rail: an ancestor reads inline, the focused group live and split. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_URL,
  loadFixture,
  mockAPI,
} from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

const ROOT_SESSION_ID = 'root-session'

const ROOT_EVENTS = [
  {
    id: 'e1',
    type: 'user',
    subtype: 'text',
    is_human: true,
    turn_id: 't1',
    content: 'pick the branch boundaries',
  },
  {
    id: 'e2',
    type: 'assistant',
    subtype: 'tool_use',
    content: 'Bash',
    tool_name: 'Bash',
    tool_input: { command: 'git log --oneline' },
    tool_use_id: 'tool_root_1',
  },
  {
    id: 'e3',
    type: 'assistant',
    subtype: 'tool_result',
    content: 'abc123 initial commit',
    tool_use_id: 'tool_root_1',
  },
  {
    id: 'e4',
    type: 'assistant',
    subtype: 'text',
    content: 'Branch 1 covers the socket listener and the tool family.',
  },
]

function sessionsHandlers() {
  return {
    getSessions: async route => {
      await route.fulfill({
        json: {
          sessions: [
            {
              session_id: ROOT_SESSION_ID,
              name: 'research',
              parent_session_id: null,
              num_turns: 4,
            },
            {
              session_id: DEFAULT_SESSION_ID,
              name: 'branch-1',
              parent_session_id: ROOT_SESSION_ID,
              num_turns: 1,
              container_id: 'test-cid',
              is_side_thread: true,
            },
          ],
        },
      })
    },
    getSessionEvents: async route => {
      await route.fulfill({ json: { events: ROOT_EVENTS, running: false } })
    },
  }
}

test.describe('Session Rail', () => {
  // SPEC: chat:rail
  // SPEC: chat:rail-ancestry-order
  // SPEC: chat:rail-one-focused-group
  // SPEC: chat:rail-ancestor-single-column
  // SPEC: chat:rail-message-box-in-focused-group
  // SPEC: chat:rail-send-scoped-to-focused
  // SPEC: chat:rail-drill-pushes-group
  // SPEC: chat:rail-direct-child-link
  // SPEC: chat:rail-ancestors-arrive-after-focused
  // SPEC: chat:minimap-focused-group-only
  test('drilling into a child renders two groups - an ancestor reading inline, the child focused and live', async ({
    page,
  }) => {
    await mockAPI(page, { handlers: sessionsHandlers() })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const rail = page.locator('[data-testid="chat-rail"]')
    await expect(rail).toBeVisible()

    // The message box and the minimap are both scoped to the focused group alone.
    await expect(page.locator('[data-testid="chat-input"]')).toHaveCount(1)
    await expect(page.locator('.chat-rail-ancestor [data-testid="chat-input"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="minimap"]')).toHaveCount(1)
    await expect(page.locator('.chat-rail-ancestor [data-testid="minimap"]')).toHaveCount(0)

    // Exactly one live ChatPanel, and it is inside the focused wrapper.
    await expect(page.locator('[data-testid="panel-chat"]')).toHaveCount(1)

    // The ancestor renders the root's shell command inline - a tool block inside its own
    // transcript column, not routed to any right-hand column (it mounts none).
    const ancestor = page.locator('[data-testid="rail-ancestor"]')
    await expect(ancestor).toHaveAttribute('data-session-id', ROOT_SESSION_ID)
    await expect(ancestor.locator('[data-testid="tool-block"]')).toBeVisible()
    await expect(page.locator('.chat-rail-focused .chat-right-slot')).toHaveCount(0)
  })

  // SPEC: chat:rail-fork-inherits-source-slot
  // SPEC: chat:fork-rail-slot
  test('a fork made inside a promoted thread stands in its slot, keeping the ancestors above it', async ({
    page,
  }) => {
    const THREAD_ID = 'promoted-thread'
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: ROOT_SESSION_ID,
                  name: 'research',
                  parent_session_id: null,
                  num_turns: 4,
                },
                {
                  session_id: THREAD_ID,
                  name: 'a promoted thread',
                  parent_session_id: ROOT_SESSION_ID,
                  num_turns: 2,
                  is_side_thread: true,
                },
                {
                  session_id: DEFAULT_SESSION_ID,
                  name: 'branch-1',
                  parent_session_id: THREAD_ID,
                  num_turns: 1,
                  container_id: 'test-cid',
                },
              ],
            },
          })
        },
        getSessionEvents: async route => {
          await route.fulfill({ json: { events: ROOT_EVENTS, running: false } })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Exactly one ancestor - the root the thread drilled from - with the fork in the thread's
    // slot. The thread's id is absent from both the rail and the header path.
    await expect(page.locator('[data-testid="rail-ancestor"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="rail-ancestor"]')).toHaveAttribute(
      'data-session-id',
      ROOT_SESSION_ID,
    )
    await expect(page.locator(`[data-session-id="${THREAD_ID}"]`)).toHaveCount(0)

    const entries = page.locator('[data-testid="session-header-path-entry"]')
    await expect(entries).toHaveCount(2)
    await expect(entries.nth(0)).toHaveAttribute('data-session-id', ROOT_SESSION_ID)
    await expect(entries.nth(1)).toHaveAttribute('data-session-id', DEFAULT_SESSION_ID)
    await expect(entries.nth(1)).toHaveAttribute('data-focused', 'true')
  })

  // SPEC: layout:header-left-slot
  test('the header path shows one entry per group, ancestry order, the focused one marked', async ({
    page,
  }) => {
    await mockAPI(page, { handlers: sessionsHandlers() })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const entries = page.locator('[data-testid="session-header-path-entry"]')
    await expect(entries).toHaveCount(2)
    await expect(entries.nth(0)).toHaveAttribute('data-session-id', ROOT_SESSION_ID)
    await expect(entries.nth(1)).toHaveAttribute('data-session-id', DEFAULT_SESSION_ID)
    await expect(entries.nth(1)).toHaveAttribute('data-focused', 'true')
  })

  // SPEC: chat:rail-focus-move-keeps-neighbor
  // SPEC: chat:rail-ancestor-catches-up-on-focus
  // SPEC: layout:header-name-click
  // SPEC: url:hash-names-focused-session
  test("clicking an ancestor's header path entry focuses it - the rail expands its split", async ({
    page,
  }) => {
    await mockAPI(page, { handlers: sessionsHandlers() })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const rootName = page
      .locator('[data-testid="session-header-path-entry"]')
      .nth(0)
      .locator('[data-testid="session-header-session-name"]')
    await rootName.click()

    await expect(page).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))
  })

  // SPEC: layout:main-panel-single-slot
  test('a session with no children renders a rail of one group - identical to a bare panel', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="panel-chat"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="rail-ancestor"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="session-header-path-entry"]')).toHaveCount(1)
  })

  // SPEC: chat:rail-depth-cap
  test('a chain longer than the depth cap renders the root and the nearest groups, the rest reachable from the header path', async ({
    page,
  }) => {
    const chain = ['s0', 's1', 's2', 's3', 's4', DEFAULT_SESSION_ID] // s0 root, 6 groups total
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: chain.map((id, i) => ({
                session_id: id,
                name: id,
                parent_session_id: i === 0 ? null : chain[i - 1],
                num_turns: 1,
                container_id: id === DEFAULT_SESSION_ID ? 'test-cid' : undefined,
                is_side_thread: i !== 0,
              })),
            },
          })
        },
        getSessionEvents: async route => {
          await route.fulfill({ json: { events: [], running: false } })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Every group is in the header path, uncapped.
    await expect(page.locator('[data-testid="session-header-path-entry"]')).toHaveCount(6)

    // The rail itself renders fewer groups than the full chain - the cap collapsed the middle.
    const railGroupCount = await page.evaluate(
      () =>
        document.querySelectorAll('[data-testid="rail-ancestor"]').length +
        document.querySelectorAll('.chat-rail-focused').length,
    )
    expect(railGroupCount).toBeLessThan(6)

    // The root is always kept, even though it fell outside the nearest-to-focus window.
    await expect(page.locator('[data-testid="rail-ancestor"][data-session-id="s0"]')).toBeVisible()
  })

  // SPEC: chat:rail-stopped-group-keeps-place
  // SPEC: chat:rail-unreadable-group-keeps-place
  test('a stopped ancestor keeps reading and an unreadable one keeps its place without truncating the chain', async ({
    page,
  }) => {
    const STOPPED_ID = 'stopped-ancestor'
    const UNREADABLE_ID = 'unreadable-ancestor'
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                { session_id: STOPPED_ID, name: 'stopped', parent_session_id: null, num_turns: 2 },
                {
                  session_id: UNREADABLE_ID,
                  name: 'unreadable',
                  parent_session_id: STOPPED_ID,
                  num_turns: 1,
                  is_side_thread: true,
                },
                {
                  session_id: DEFAULT_SESSION_ID,
                  name: 'branch-1',
                  parent_session_id: UNREADABLE_ID,
                  num_turns: 1,
                  container_id: 'test-cid',
                  is_side_thread: true,
                },
              ],
            },
          })
        },
        getSessionEvents: async route => {
          const url = route.request().url()
          if (url.includes(UNREADABLE_ID)) {
            await route.fulfill({ status: 404, json: { error: 'not found' } })
          } else {
            await route.fulfill({ json: { events: ROOT_EVENTS, running: false } })
          }
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Both ancestors keep their rail slot - the chain is not truncated at the unreadable one.
    await expect(
      page.locator(`[data-testid="rail-ancestor"][data-session-id="${STOPPED_ID}"]`),
    ).toBeVisible()
    const unreadable = page.locator(
      `[data-testid="rail-ancestor"][data-session-id="${UNREADABLE_ID}"]`,
    )
    await expect(unreadable).toBeVisible()
    await expect(unreadable).toContainText(/unavailable/i)

    // The stopped ancestor still reads - its transcript is not blank.
    const stopped = page.locator(`[data-testid="rail-ancestor"][data-session-id="${STOPPED_ID}"]`)
    await expect(stopped.locator('[data-testid="tool-block"]')).toBeVisible()
  })

  // SPEC: chat:rail-restores-on-reload
  test('the rail survives a reload with the same groups and the same one focused', async ({
    page,
  }) => {
    await mockAPI(page, { handlers: sessionsHandlers() })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="rail-ancestor"]')).toHaveCount(1)

    await page.reload()
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="rail-ancestor"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="rail-ancestor"]')).toHaveAttribute(
      'data-session-id',
      ROOT_SESSION_ID,
    )
    await expect(
      page.locator('[data-testid="session-header-path-entry"][data-focused="true"]'),
    ).toHaveAttribute('data-session-id', DEFAULT_SESSION_ID)
  })

  // SPEC: chat:rail-includes-quiet-groups
  test('an ancestor with no turns and no container of its own still appears on the rail', async ({
    page,
  }) => {
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: ROOT_SESSION_ID,
                  name: 'quiet',
                  parent_session_id: null,
                  num_turns: 0,
                },
                {
                  session_id: DEFAULT_SESSION_ID,
                  name: 'branch-1',
                  parent_session_id: ROOT_SESSION_ID,
                  num_turns: 1,
                  container_id: 'test-cid',
                  is_side_thread: true,
                },
              ],
            },
          })
        },
        getSessionEvents: async route => {
          await route.fulfill({ json: { events: [], running: false } })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // The Sessions panel's own tree would drop this session (no turns, no container); the rail
    // does not - it is on the rail as an ancestor and in the header path.
    await expect(
      page.locator(`[data-testid="rail-ancestor"][data-session-id="${ROOT_SESSION_ID}"]`),
    ).toBeVisible()
    await expect(
      page.locator(
        `[data-testid="session-header-path-entry"][data-session-id="${ROOT_SESSION_ID}"]`,
      ),
    ).toBeVisible()
  })

  // SPEC: chat:rail-drill-elsewhere-truncates
  // SPEC: shortcut:rail-back-forward-visit-order
  test('drilling into a different child after walking back drops the earlier branch from the rail', async ({
    page,
  }) => {
    const CHILD_B = 'child-b'
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: ROOT_SESSION_ID,
                  name: 'research',
                  parent_session_id: null,
                  num_turns: 4,
                },
                {
                  session_id: DEFAULT_SESSION_ID,
                  name: 'branch-1',
                  parent_session_id: ROOT_SESSION_ID,
                  num_turns: 1,
                  container_id: 'test-cid',
                  is_side_thread: true,
                },
                {
                  session_id: CHILD_B,
                  name: 'branch-1-alt',
                  parent_session_id: ROOT_SESSION_ID,
                  num_turns: 1,
                  container_id: 'test-cid',
                  is_side_thread: true,
                },
              ],
            },
          })
        },
        getSessionEvents: async route => {
          await route.fulfill({ json: { events: ROOT_EVENTS, running: false } })
        },
      },
    })
    await mockSSE(page)

    // Start on the child, walk back to root - the child becomes the walked-back tail.
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await page
      .locator('[data-testid="session-header-path-entry"]')
      .nth(0)
      .locator('[data-testid="session-header-session-name"]')
      .click()
    await expect(page).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))

    // Drill into the OTHER child directly - a genuinely new branch.
    await page.goto(`/#/workspaces/test-ws/sessions/${CHILD_B}`)
    await waitForAppReady(page)

    const entries = page.locator('[data-testid="session-header-path-entry"]')
    await expect(entries).toHaveCount(2)
    await expect(entries.nth(1)).toHaveAttribute('data-session-id', CHILD_B)
    await expect(page.locator(`[data-session-id="${DEFAULT_SESSION_ID}"]`)).toHaveCount(0)

    // Back walks visit order, not rail order - it returns to root, the state immediately before
    // drilling into child B, even though the earlier child has left the rail.
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))
  })

  // SPEC: chat:rail-tail-per-browser-tab
  test('a walked-back branch belongs to the browser tab it was walked back in', async ({
    browser,
  }) => {
    const contextA = await browser.newContext()
    const pageA = await contextA.newPage()
    await mockAPI(pageA, { handlers: sessionsHandlers() })
    await mockSSE(pageA)
    await pageA.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(pageA)

    // Tab A walks back to root - the child becomes its own walked-back tail, rendered on the
    // rail as a non-focused group even though it is no longer an ancestor of the focused one.
    await pageA
      .locator('[data-testid="session-header-path-entry"]')
      .nth(0)
      .locator('[data-testid="session-header-session-name"]')
      .click()
    await expect(pageA).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))
    await expect(pageA.locator('[data-testid="rail-ancestor"]')).toHaveAttribute(
      'data-session-id',
      DEFAULT_SESSION_ID,
    )

    // Tab B opens the same tree fresh - it has no tail, since sessionStorage is per tab.
    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()
    await mockAPI(pageB, { handlers: sessionsHandlers() })
    await mockSSE(pageB)
    await pageB.goto(`/#/workspaces/test-ws/sessions/${ROOT_SESSION_ID}`)
    await waitForAppReady(pageB)

    await expect(pageB.locator('[data-testid="rail-ancestor"]')).toHaveCount(0)

    // Tab A's tail is unchanged by tab B ever having opened.
    await expect(pageA.locator('[data-testid="rail-ancestor"]')).toHaveAttribute(
      'data-session-id',
      DEFAULT_SESSION_ID,
    )

    await contextA.close()
    await contextB.close()
  })

  // SPEC: shortcut:alt-shift-left
  // SPEC: shortcut:alt-shift-right
  // SPEC: shortcut:jump-acts-on-focused-group
  test('Alt+Shift+Left/Right move focus one group along the rail, clamping at both ends', async ({
    page,
  }) => {
    await mockAPI(page, { handlers: sessionsHandlers() })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Assert on the focused path entry, not the URL: the address bar updates ahead of the app's
    // re-render, so only the DOM marker proves the rail has caught up.
    const focusedEntry = page.locator(
      '[data-testid="session-header-path-entry"][data-focused="true"]',
    )

    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await expect(page).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))
    await expect(focusedEntry).toHaveAttribute('data-session-id', ROOT_SESSION_ID)

    // Clamped at the left end - a second Left is a no-op.
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await expect(page).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))

    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect(page).toHaveURL(new RegExp(`/sessions/${DEFAULT_SESSION_ID}$`))
    await expect(focusedEntry).toHaveAttribute('data-session-id', DEFAULT_SESSION_ID)
  })

  // SPEC: chat:rail-stop-focused-returns-to-parent
  test("stopping the focused group's session returns focus to the group it descended from", async ({
    page,
  }) => {
    // DEFAULT_SESSION_ID is an ordinary fork made inside the promoted thread, so it gets its own
    // Stop button; the thread drops out of the rendered chain, leaving root as its predecessor.
    const THREAD_ID = 'promoted-thread'
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                {
                  session_id: ROOT_SESSION_ID,
                  name: 'research',
                  parent_session_id: null,
                  num_turns: 4,
                },
                {
                  session_id: THREAD_ID,
                  name: 'a promoted thread',
                  parent_session_id: ROOT_SESSION_ID,
                  num_turns: 2,
                  is_side_thread: true,
                },
                {
                  session_id: DEFAULT_SESSION_ID,
                  name: 'branch-1',
                  parent_session_id: THREAD_ID,
                  num_turns: 1,
                  container_id: 'test-cid',
                },
              ],
            },
          })
        },
        getSessionEvents: async route => {
          await route.fulfill({ json: { events: ROOT_EVENTS, running: false } })
        },
        deleteContainer: async route => route.fulfill({ status: 200, json: {} }),
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const focusedEntry = page.locator(
      '[data-testid="session-header-path-entry"][data-focused="true"]',
    )
    await focusedEntry.locator('[data-testid="session-header-stop-btn"]').click()

    await expect(page).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))
  })

  // SPEC: chat:rail-stop-ancestor-leaves-focused-running
  test('stopping an ancestor from the header path leaves the focused group running', async ({
    page,
  }) => {
    await mockAPI(page, {
      handlers: {
        ...sessionsHandlers(),
        deleteContainer: async route => route.fulfill({ status: 200, json: {} }),
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // The root ancestor has no container of its own in this fixture, so give it one to stop.
    await page.route(/\/sessions$/, async route => {
      if (route.request().method() !== 'GET') {
        return route.continue()
      }
      await route.fulfill({
        json: {
          sessions: [
            {
              session_id: ROOT_SESSION_ID,
              name: 'research',
              parent_session_id: null,
              num_turns: 4,
              container_id: 'root-cid',
            },
            {
              session_id: DEFAULT_SESSION_ID,
              name: 'branch-1',
              parent_session_id: ROOT_SESSION_ID,
              num_turns: 1,
              container_id: 'test-cid',
              is_side_thread: true,
            },
          ],
        },
      })
    })
    await page.reload()
    await waitForAppReady(page)

    await page
      .locator(
        `[data-testid="session-header-path-entry"][data-session-id="${ROOT_SESSION_ID}"] [data-testid="session-header-stop-btn"]`,
      )
      .click()
    await page.locator('[data-testid="confirm-stop-modal-confirm"]').click()

    // The focused group is still 'branch-1' - stopping the ancestor did not move focus.
    await expect(page).toHaveURL(new RegExp(`/sessions/${DEFAULT_SESSION_ID}$`))
  })

  // SPEC: chat:rail-message-box-follows-focus
  test('the message box takes keyboard focus when focus moves to a different group', async ({
    page,
  }) => {
    await mockAPI(page, { handlers: sessionsHandlers() })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page
      .locator('[data-testid="session-header-path-entry"]')
      .nth(0)
      .locator('[data-testid="session-header-session-name"]')
      .click()
    await expect(page).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))

    await expect(page.locator('[data-testid="chat-input"]')).toBeFocused()
  })

  // SPEC: chat:rail-per-group-split-memory
  test('each group returns to its own persisted right-view choice once focused', async ({
    page,
  }) => {
    // Make the otherwise-static /sessions/current reflect whichever session was most recently
    // resumed, so focusing an ancestor genuinely changes useSessionData().sessionId.
    let mockCurrentSessionId = DEFAULT_SESSION_ID
    await mockAPI(page, {
      handlers: {
        ...sessionsHandlers(),
        resumeSession: async route => {
          const [, sid] = route
            .request()
            .url()
            .match(/\/sessions\/([^/]+)\/resume/)
          mockCurrentSessionId = sid
          await route.fulfill({
            status: 200,
            json: { session_id: mockCurrentSessionId, container_id: DEFAULT_CONTAINER_ID },
          })
        },
        getSessionStatus: async route => {
          await route.fulfill({
            json: { ...loadFixture('status/default.json'), session_id: mockCurrentSessionId },
          })
        },
        getUIState: async route => {
          const url = new URL(route.request().url())
          const sessionId = url.searchParams.get('session_id')
          const session =
            sessionId === DEFAULT_SESSION_ID
              ? { rightSlotView: 'terminal' }
              : sessionId === ROOT_SESSION_ID
                ? { rightSlotView: 'off' }
                : {}
          await route.fulfill({ json: { global: {}, session } })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // The focused group restores its persisted 'terminal' choice - the picker reflects the stored
    // preference even when the rail's width collapses the column itself.
    await expect(page.locator('[data-testid="right-slot-view-terminal"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page
      .locator('[data-testid="session-header-path-entry"]')
      .nth(0)
      .locator('[data-testid="session-header-session-name"]')
      .click()
    await expect(page).toHaveURL(new RegExp(`/sessions/${ROOT_SESSION_ID}$`))
    await expect(
      page.locator('[data-testid="session-header-path-entry"][data-focused="true"]'),
    ).toHaveAttribute('data-session-id', ROOT_SESSION_ID)

    // Now focused, 'research' restores its own persisted 'off' choice.
    await expect(page.locator('[data-testid="right-slot-view-terminal"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  // SPEC: chat:rail-promoted-thread-fold
  test('a promoted thread ancestor folds what it inherited, opening at its own exchange', async ({
    page,
  }) => {
    const THREAD_ID = 'promoted-thread'
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                { session_id: ROOT_SESSION_ID, name: 'research', parent_session_id: null },
                {
                  session_id: THREAD_ID,
                  name: 'a promoted thread',
                  parent_session_id: ROOT_SESSION_ID,
                  num_turns: 2,
                  is_side_thread: true,
                },
                {
                  session_id: DEFAULT_SESSION_ID,
                  name: 'branch-1',
                  parent_session_id: THREAD_ID,
                  num_turns: 1,
                  container_id: 'test-cid',
                  is_side_thread: true,
                },
              ],
            },
          })
        },
        // Only the promoted thread's inherited history carries the fold divider, so one shared
        // handler would double turn_002 onto both ancestors.
        getSessionEvents: async route => {
          const url = route.request().url()
          if (url.includes(THREAD_ID)) {
            await route.fulfill({
              json: {
                events: [
                  {
                    type: 'user',
                    subtype: 'text',
                    is_human: true,
                    content: 'Hello',
                    turn_id: 'turn_001',
                  },
                  { type: 'assistant', subtype: 'text', content: 'context on this branch' },
                  { type: 'result', subtype: 'success', turn_id: 'turn_001' },
                  {
                    type: 'system',
                    subtype: 'container_restarted',
                    message_data: { fork_parent_session_id: ROOT_SESSION_ID },
                  },
                  {
                    type: 'user',
                    is_human: true,
                    content: 'why this branch?',
                    turn_id: 'turn_002',
                  },
                  {
                    type: 'assistant',
                    subtype: 'text',
                    content: 'because it handles the edge case',
                  },
                  { type: 'result', subtype: 'success', turn_id: 'turn_002' },
                ],
                running: false,
              },
            })
          } else {
            await route.fulfill({ json: { events: ROOT_EVENTS, running: false } })
          }
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const ancestor = page.locator(`[data-testid="rail-ancestor"][data-session-id="${THREAD_ID}"]`)
    const foldRow = ancestor.getByTestId('thread-fold-row')
    const inheritedTurn = ancestor.locator(
      '[data-testid="turn-container"][data-turn-id="turn_001"]',
    )
    const ownTurn = ancestor.locator('[data-testid="turn-container"][data-turn-id="turn_002"]')

    // Folded by default: the thread's own exchange draws, what it inherited does not.
    await expect(foldRow).toBeVisible()
    await expect(foldRow).toContainText('1 earlier turn from research')
    await expect(ownTurn).toBeVisible()
    await expect(inheritedTurn).toHaveCount(0)

    // Opening it reveals the inherited exchange without disturbing the thread's own.
    await foldRow.click()
    await expect(inheritedTurn).toBeVisible()
    await expect(ownTurn).toBeVisible()

    // Closing it again folds the inherited exchange back away.
    await foldRow.click()
    await expect(inheritedTurn).toHaveCount(0)
  })
})
