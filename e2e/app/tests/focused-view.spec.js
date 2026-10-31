/** E2E tests for the Focused view: read-only calls leave a turn; Show everything brings them back. */

import { devices, expect, test } from '@playwright/test'
import {
  disableAutoCollapse,
  openBookmarksPanel,
  openLiveSession,
  openSession,
  openSessionWithAPI,
  sessionsHandler,
  waitForAppReady,
  waitForMobileReady,
  waitForStableScrollHeight,
} from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_URL, loadFixture, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

const { defaultBrowserType: _ignored, ...PIXEL_5 } = devices['Pixel 5']

const FIXTURE = 'events/focused-view.jsonl'
const FOCUSED = {}
const EVERYTHING = { rightSlotView: 'everything' }
const ROOT_SESSION_ID = 'root-session'

const HIDDEN = [
  'tu_read',
  'tu_grep',
  'tu_glob',
  'tu_websearch',
  'tu_webfetch',
  'tu_tasklist',
  'tu_taskget',
  'tu_taskoutput',
  'tu_skill',
  'tu_bash_ro',
  'tu_session_read',
  'tu_list_res',
  'tu_read_res',
  'tu_read_res_dir',
  'tu_mcp_ro',
]
const SHOWN = ['tu_write', 'tu_edit', 'tu_bash', 'tu_mcp', 'tu_task']

const block = (scope, id) => scope.locator(`[data-testid="tool-block"][data-tool-use-id="${id}"]`)
const turn = (page, turnId) => page.locator(`.turn-container[data-turn-id="${turnId}"]`)
const eye = page => page.getByTestId('right-slot-view-everything')
const ancestor = page =>
  page.locator(`[data-testid="rail-ancestor"][data-session-id="${ROOT_SESSION_ID}"]`)

test.describe('Focused view', () => {
  // SPEC: chat:focused-view-default
  test('a session that never picked a view opens Focused, with no picker button pressed', async ({
    page,
  }) => {
    await openInView(page, FOCUSED)

    const picker = page.getByTestId('right-slot-view-picker').locator('button')
    await expect(picker).toHaveCount(3)
    await expect(picker.first()).toHaveAttribute('data-testid', 'right-slot-view-everything')
    await expect(picker.first()).toHaveAttribute('title', 'Show everything')
    await expect(picker.and(page.locator('[aria-pressed="true"]'))).toHaveCount(0)
    await expect(block(page, 'tu_edit')).toBeVisible()
    await expect(block(page, 'tu_read')).toHaveCount(0)
  })

  // SPEC: chat:focused-view-default
  test('a session whose right column was turned off before opens in Everything', async ({
    page,
  }) => {
    await openInView(page, { rightSlotView: 'off' })

    await expect(eye(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(block(page, 'tu_read')).toBeVisible()
  })

  // SPEC: chat:focused-view-hides
  test('calls that only read leave the turn', async ({ page }) => {
    await openInView(page, FOCUSED)

    await expect(block(page, 'tu_edit')).toBeVisible()
    for (const id of [...HIDDEN, 'tu_toolsearch']) {
      await expect(block(page, id), id).toHaveCount(0)
    }
  })

  // SPEC: chat:focused-view-hides
  test('a shell command its run settles leaves or joins the turn once it finished', async ({
    page,
  }) => {
    await openInView(page, FOCUSED, 'events/tool-bash-traced.jsonl')

    await expect(block(page, 'tool_measured_writer')).toBeVisible()
    await expect(block(page, 'tool_unmeasured')).toBeVisible()
    await expect(block(page, 'tool_measured_reader_failed')).toBeVisible()
    await expect(block(page, 'tool_measured_reader')).toHaveCount(0)
  })

  // SPEC: chat:focused-view-hides
  test('a shell command left out while it ran appears once it changed something, and the reverse', async ({
    page,
  }) => {
    await mockAPI(page, { sessionUiStateDefaults: FOCUSED })
    const controller = await openLiveSession(page)
    const call = (id, command, extra = {}) => ({
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Bash',
      tool_use_id: id,
      tool_name: 'Bash',
      tool_input: { command },
      ...extra,
    })
    const result = (id, changed) => ({
      type: 'user',
      subtype: 'tool_result',
      content: 'line 2\nline 1',
      tool_use_id: id,
      command_changed: changed,
    })

    await controller.sendEvents([
      { type: 'user', subtype: 'text', is_human: true, content: 'reverse it', turn_id: 't1' },
      call('tu_tac', 'cat notes.txt | tac', { command_read_only: true }),
      call('tu_print', "python3 -c 'print(1)'"),
    ])
    await expect(block(page, 'tu_print')).toBeVisible()
    await expect(block(page, 'tu_tac')).toHaveCount(0)

    await controller.sendEvents([result('tu_tac', true), result('tu_print', false)])
    await expect(block(page, 'tu_tac')).toBeVisible()
    await expect(block(page, 'tu_print')).toHaveCount(0)
  })

  // SPEC: chat:focused-view-failed-shown
  test('a read that failed shows, marked failed', async ({ page }) => {
    await openInView(page, FOCUSED)

    await expect(block(page, 'tu_read_failed')).toHaveAttribute('data-tool-status', 'error')
  })

  // SPEC: chat:focused-view-shows
  test('writes, edits, other commands, subagents, task changes and other MCP calls stay', async ({
    page,
  }) => {
    await openInView(page, FOCUSED)

    for (const id of SHOWN) {
      await expect(block(page, id), id).toBeVisible()
    }
    await expect(turn(page, 'turn_001').getByTestId('todos-group')).toBeVisible()
  })

  // SPEC: chat:focused-view-subagent
  test("a subagent's read leaves its Activity; its edit and its own text stay", async ({
    page,
  }) => {
    await openInView(page, FOCUSED)

    const task = block(page, 'tu_task')
    await task.locator('.tool-header-area').first().click()
    await expect(task.locator('[data-tool-use-id="tu_sub_edit"]')).toBeVisible()
    await expect(task).toContainText("I'll fix the failing test.")
    await expect(task.locator('[data-tool-use-id="tu_sub_read"]')).toHaveCount(0)
  })

  // SPEC: chat:focused-view-while-running
  test('a running read never shows; the turn shows its Working line', async ({ page }) => {
    await recordPresence(page, 'tu_live_read')
    await mockAPI(page, { sessionUiStateDefaults: FOCUSED })
    const controller = await openLiveSession(page)

    await controller.sendEvent(human('Read the notes', 'turn_live'))
    await controller.sendEvent(call('tu_live_read', 'Read', { file_path: '/home/user/notes.md' }))
    await expect(page.getByTestId('turn-progress-working')).toBeVisible()
    await controller.sendEvent(result('tu_live_read', '     1\tkept'))
    await controller.sendEvent(call('tu_live_write', 'Write', { file_path: 'a.md', content: 'x' }))

    await expect(block(page, 'tu_live_write')).toBeVisible()
    await expect(page.getByTestId('turn-progress-working')).toBeVisible()
    expect(await presence(page)).toEqual([])
  })

  // SPEC: chat:focused-view-no-trace
  test('a finished turn keeps no trace of the calls it left out', async ({ page }) => {
    await openInView(page, FOCUSED)

    await expect(turn(page, 'turn_002').getByTestId('message-user')).toBeVisible()
    await expect(turn(page, 'turn_002').getByTestId('message-assistant')).toHaveCount(0)

    const reads = turn(page, 'turn_003')
    await expect(reads.locator('[data-testid="tool-block"]')).toHaveCount(1)
    await reads.locator('.turn-meta-collapsible').click()
    await expect(reads.locator('.turn-preview-text')).toHaveText('1 tool used')
  })

  // SPEC: chat:added-text-anchor
  test('text added right after a read it leaves out hangs on the user message', async ({
    page,
  }) => {
    await openInView(page, FOCUSED)

    const user = turn(page, 'turn_003').getByTestId('message-user')
    await expect(user.getByTestId('injected-context-toggle')).toHaveAttribute('title', 'Stop hook')
  })

  // SPEC: chat:focused-view-mcp-unreported
  // SPEC: chat:focused-view-earlier-recordings
  test('MCP and shell calls carrying no mark stay; MCP resource listings and reads still leave', async ({
    page,
  }) => {
    await openInView(page, FOCUSED, [
      human('Look it up', 't1'),
      call('lg_mcp', 'search_notes', { query: 'parser' }),
      result('lg_mcp'),
      call('lg_list', 'list_mcp_resources', {}),
      result('lg_list'),
      call('lg_read', 'read_mcp_resource', { server: 'notes', uri: 'notes://a' }),
      result('lg_read'),
      call('old_mcp', 'mcp__notes__read', { id: 'a' }),
      result('old_mcp'),
      call('old_bash', 'Bash', { command: 'ls -a' }),
      result('old_bash', '.\n..\nnotes.md'),
      call('old_list', 'ListMcpResourcesTool', {}),
      result('old_list'),
      { type: 'assistant', subtype: 'text', content: 'Found it.' },
      { type: 'result', subtype: 'success', turn_id: 't1' },
    ])

    await expect(block(page, 'lg_mcp')).toBeVisible()
    await expect(block(page, 'old_mcp')).toBeVisible()
    await expect(block(page, 'old_bash')).toBeVisible()
    for (const id of ['lg_list', 'lg_read', 'old_list']) {
      await expect(block(page, id), id).toHaveCount(0)
    }
  })

  // SPEC: chat:everything-view
  test('Show everything brings every call back in call order; releasing it is Focused again', async ({
    page,
  }) => {
    await openInView(page, FOCUSED)

    await eye(page).click()
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(eye(page)).toHaveAttribute('title', 'Hide calls that only read')
    await expect(block(page, 'tu_read')).toBeVisible()
    const order = [
      ...HIDDEN,
      'tu_read_failed',
      'tu_write',
      'tu_edit',
      'tu_bash',
      'tu_mcp',
      'tu_task',
    ]
    const ids = await turn(page, 'turn_001')
      .locator('[data-testid="tool-block"]')
      .evaluateAll(blocks => blocks.map(b => b.dataset.toolUseId))
    expect(ids.filter(id => order.includes(id))).toEqual(order)

    await eye(page).click()
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(block(page, 'tu_read')).toHaveCount(0)
  })

  // SPEC: chat:right-slot-view-persist
  test('Show everything survives a reload', async ({ page }) => {
    await openInView(page, FOCUSED)

    await eye(page).click()
    await expect(block(page, 'tu_read')).toBeVisible()
    await page.reload()
    await waitForAppReady(page)

    await expect(eye(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(block(page, 'tu_four_0')).toBeVisible()
  })

  // SPEC: chat:terminal-split-toggle-off
  test('releasing the terminal button returns the chat to Focused', async ({ page }) => {
    await openInView(page, FOCUSED)

    const terminal = page.getByTestId('right-slot-view-terminal')
    await terminal.click()
    await expect(terminal).toHaveAttribute('aria-pressed', 'true')
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(block(page, 'tu_read')).toBeVisible()

    await terminal.click()
    await expect(terminal).toHaveAttribute('aria-pressed', 'false')
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(block(page, 'tu_bash')).toBeVisible()
    await expect(block(page, 'tu_read')).toHaveCount(0)
  })

  // SPEC: chat:focused-view-bookmarked
  test('a read bookmarked in Everything stays in Focused, counted, until its bookmark goes', async ({
    page,
  }) => {
    await openInView(page, EVERYTHING)

    const read = block(page, 'tu_four_1')
    await read.locator('.tool-header').hover()
    await read.locator('.tool-bookmark-btn').click()
    await expect(read.locator('.tool-bookmark-btn')).toHaveClass(/active/)

    await eye(page).click()
    await expect(block(page, 'tu_four_0')).toHaveCount(0)
    await expect(read).toHaveClass(/bookmarked/)
    const reads = turn(page, 'turn_003')
    await reads.locator('.turn-meta-collapsible').click()
    await expect(reads.locator('.turn-preview-text')).toHaveText('2 tools used')
    await reads.locator('.turn-meta-collapsible').click()

    await read.locator('.tool-header').hover()
    await read.locator('.tool-bookmark-btn').click()
    await expect(read).toHaveCount(0)
  })

  // SPEC: chat:focused-view-bookmarked
  // SPEC: panel-bookmarks:part-scroll
  test("in Focused a read's bookmark lands on its block and flashes it", async ({ page }) => {
    await page.addInitScript(() => {
      window.__flashed = []
      new MutationObserver(records => {
        for (const r of records) {
          if (r.target.classList?.contains('jump-highlight')) {
            window.__flashed.push(r.target.dataset.toolUseId)
          }
        }
      }).observe(document, { attributes: true, attributeFilter: ['class'], subtree: true })
    })
    const bookmark = 'turn_001:tool-tu_read'
    const global = {
      bookmarkedTurns: { [DEFAULT_SESSION_ID]: [bookmark] },
      bookmarkMeta: { [`${DEFAULT_SESSION_ID}/${bookmark}`]: { preview: 'Read(parser.py)' } },
    }
    await mockAPI(page, {
      handlers: { getUIState: route => route.fulfill({ json: { global, session: FOCUSED } }) },
    })
    await openSession(page, FIXTURE)
    await openBookmarksPanel(page)
    await waitForStableScrollHeight(page.getByTestId('chat-messages'))

    await page.locator('[data-testid="bookmark-item"]').first().click()

    await expect.poll(() => page.evaluate(() => window.__flashed)).toContain('tu_read')
    await expect(block(page, 'tu_read')).toBeInViewport()
    await expect(block(page, 'tu_grep')).toHaveCount(0)
  })

  // SPEC: chat:focused-view-first-frame
  test('a session that picked Everything has every call from its first frame', async ({ page }) => {
    await recordPresence(page, 'tu_four_0')
    await openInView(page, EVERYTHING)

    await expect(block(page, 'tu_four_0')).toBeVisible()
    expect(await presence(page)).toEqual([true])
  })

  // SPEC: chat:focused-view-first-frame
  test('a session in Focused never draws a call it leaves out', async ({ page }) => {
    await recordPresence(page, 'tu_four_0')
    await openInView(page, FOCUSED)

    await expect(block(page, 'tu_four_edit')).toBeVisible()
    expect(await presence(page)).toEqual([])
  })
})

test.describe('A session whose view reads slowly', () => {
  // SPEC: chat:focused-view-first-frame
  // SPEC: url:session-turn-part
  test('a link naming a turn still lands on it once the view is read', async ({ page }) => {
    await page.addInitScript(() => {
      window.__flashed = []
      new MutationObserver(records => {
        for (const r of records) {
          if (r.target.classList?.contains('jump-highlight')) {
            window.__flashed.push(r.target.closest('[data-turn-id]')?.dataset.turnId)
          }
        }
      }).observe(document, { attributes: true, attributeFilter: ['class'], subtree: true })
    })
    await mockSlowView(page)
    await mockSSE(page, FIXTURE)
    await page.goto(`${DEFAULT_SESSION_URL}/turns/a-turn_001`)
    await waitForAppReady(page)

    await expect.poll(() => page.evaluate(() => window.__flashed)).toContain('turn_001')
    await expect(turn(page, 'turn_001').getByTestId('message-assistant')).toBeInViewport()
  })

  // SPEC: chat:focused-view-first-frame
  test('a session opens at its end once the view is read', async ({ page }) => {
    await mockSlowView(page)
    await openSession(page, FIXTURE)

    await expect(block(page, 'tu_four_edit')).toBeVisible()
    await expect
      .poll(() =>
        page
          .getByTestId('chat-messages')
          .evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight),
      )
      .toBeLessThan(2)
  })
})

test.describe('A session opening on a slow machine', () => {
  for (const [name, uiState, readPresence] of [
    ['Focused', FOCUSED, []],
    ['Everything', EVERYTHING, [true]],
  ]) {
    // SPEC: chat:focused-view-first-frame
    test(`a ${name} session keeps its turns and control bar once they are drawn`, async ({
      page,
    }) => {
      await recordPresence(page, 'tu_four_0')
      await page.addInitScript(() => {
        window.__drawn = { turns: [], bar: [] }
        new MutationObserver(() => {
          const turns = document.querySelectorAll('.turn-container').length
          const bar = Boolean(
            document.querySelector('[data-testid="panel-chat"] .panel-control-bar'),
          )
          for (const [series, now] of [
            [window.__drawn.turns, turns],
            [window.__drawn.bar, bar],
          ]) {
            if (series.at(-1) !== now) {
              series.push(now)
            }
          }
        }).observe(document, { childList: true, subtree: true })
      })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
      await openSessionWithAPI(page, FIXTURE, { sessionUiStateDefaults: uiState })
      await expect(page.locator('.turn-container')).toHaveCount(3)
      await page.waitForTimeout(1500)

      const { turns, bar } = await page.evaluate(() => window.__drawn)
      expect(turns.slice(turns.findIndex(n => n > 0))).not.toContain(0)
      expect(bar.slice(bar.indexOf(true))).toEqual([true])
      expect(await presence(page)).toEqual(readPresence)
    })
  }
})

test.describe('Focused view on the rail', () => {
  for (const [label, rootView, reads] of [
    ['Focused, leaving its read out', FOCUSED, 0],
    ['in Everything, as it picked', EVERYTHING, 1],
    ['in Everything when it picked Terminal', { rightSlotView: 'terminal' }, 1],
  ]) {
    // SPEC: chat:rail-ancestor-single-column
    test(`an ancestor group shows its own session ${label}`, async ({ page }) => {
      await openRail(page, rootView)

      await expect(block(ancestor(page), 'tool_root_write')).toBeVisible()
      await expect(block(ancestor(page), 'tool_root_read')).toHaveCount(reads)
    })
  }

  // SPEC: chat:focused-view-bookmarked
  test('an ancestor group in Focused shows a read its session bookmarked', async ({ page }) => {
    await openRail(page, FOCUSED, { [ROOT_SESSION_ID]: ['t1:tool-tool_root_read'] })

    await expect(block(ancestor(page), 'tool_root_read')).toBeVisible()
  })
})

test.describe('Focused view on a phone', () => {
  test.use({ ...PIXEL_5, hasTouch: true })

  // SPEC: chat:focused-view-phone
  test('a phone shows Focused, whatever the desktop picked', async ({ page }) => {
    await mockAPI(page, { sessionUiStateDefaults: EVERYTHING })
    await mockSSE(page, FIXTURE)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForMobileReady(page)

    await expect(block(page, 'tu_four_edit')).toBeVisible()
    await expect(block(page, 'tu_four_0')).toHaveCount(0)
  })
})

test.describe('Needs you in Focused', () => {
  // SPEC: notify:needs-you-call-focused
  test('the needs-you call shows no block; its reply buttons still show', async ({ page }) => {
    await mockAPI(page, { sessionUiStateDefaults: FOCUSED })
    await mockNeedsUser(page)
    await openSession(page, 'events/needs-user-replies.jsonl')

    await expect(
      page.getByTestId('needs-user-replies').locator('button:not(.needs-user-reply-edit)'),
    ).toHaveText(['Go', 'Hold'])
    await expect(block(page, 'tu_needs_1')).toHaveCount(0)
  })

  // SPEC: notify:needs-you-call-focused
  test('when the needs-you call is all its turn made, the reply buttons still show', async ({
    page,
  }) => {
    await mockAPI(page, { sessionUiStateDefaults: FOCUSED })
    await mockNeedsUser(page)
    await openSession(page, [
      human('File it?', 't1'),
      call('tu_needs', 'mcp__claudebox__needs_user', {
        reason: 'Approve',
        replies: ['Go', 'Hold'],
      }),
      result('tu_needs', 'The user has been told this session needs them.'),
      { type: 'result', subtype: 'success', turn_id: 't1' },
    ])

    await expect(
      page.getByTestId('needs-user-replies').locator('button:not(.needs-user-reply-edit)'),
    ).toHaveText(['Go', 'Hold'])
    await expect(page.getByTestId('message-assistant')).toHaveCount(0)
  })
})

async function openInView(page, uiState, events = FIXTURE) {
  await openSessionWithAPI(page, events, { sessionUiStateDefaults: uiState })
  await disableAutoCollapse(page)
}

async function mockSlowView(page) {
  await mockAPI(page, {
    handlers: {
      getUIState: async route => {
        if (new URL(route.request().url()).searchParams.get('session_id')) {
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
        await route.fulfill({ json: { global: {}, session: {} } })
      },
    },
  })
}

async function openRail(page, rootView, bookmarkedTurns = {}) {
  const sessions = [
    { session_id: ROOT_SESSION_ID, name: 'research', parent_session_id: null, num_turns: 1 },
    {
      session_id: DEFAULT_SESSION_ID,
      name: 'branch-1',
      parent_session_id: ROOT_SESSION_ID,
      num_turns: 1,
      container_id: 'test-cid',
      is_side_thread: true,
    },
  ]
  const events = [
    human('pick the branch boundaries', 't1'),
    call('tool_root_read', 'Read', { file_path: '/home/user/project/outline.md' }),
    result('tool_root_read', '     1\toutline'),
    call('tool_root_write', 'Write', { file_path: '/home/user/project/outline.md', content: 'x' }),
    result('tool_root_write', 'written'),
    { type: 'assistant', subtype: 'text', content: 'Branch 1 covers the listener.' },
    { type: 'result', subtype: 'success', turn_id: 't1' },
  ]
  await mockAPI(page, {
    handlers: {
      getSessions: sessionsHandler(sessions),
      getSessionEvents: route => route.fulfill({ json: { events, running: false } }),
      getUIState: route => {
        const sessionId = new URL(route.request().url()).searchParams.get('session_id')
        const session = { [ROOT_SESSION_ID]: rootView, [DEFAULT_SESSION_ID]: EVERYTHING }
        return route.fulfill({
          json: { global: { bookmarkedTurns }, session: session[sessionId] ?? {} },
        })
      },
    },
  })
  await openSession(page)
}

async function mockNeedsUser(page) {
  await page.route('**/api/sessions/current**', async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback()
    }
    await route.fulfill({
      json: {
        ...loadFixture('status/default.json'),
        needs_user: 'Approve: file the ticket',
        needs_user_replies: ['Go', 'Hold'],
      },
    })
  })
}

async function recordPresence(page, toolUseId) {
  await page.addInitScript(id => {
    window.__presence = []
    new MutationObserver(() => {
      const present = Boolean(document.querySelector(`[data-tool-use-id="${id}"]`))
      if ((window.__presence.at(-1) ?? false) !== present) {
        window.__presence.push(present)
      }
    }).observe(document, { childList: true, subtree: true })
  }, toolUseId)
}

function presence(page) {
  return page.evaluate(() => window.__presence)
}

function human(content, turnId) {
  return { type: 'user', subtype: 'text', is_human: true, content, turn_id: turnId }
}

function call(id, name, input) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content: name,
    tool_name: name,
    tool_use_id: id,
    tool_input: input,
  }
}

function result(id, content = 'ok') {
  return { type: 'user', subtype: 'tool_result', tool_use_id: id, content }
}
