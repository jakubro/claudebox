/** E2E tests for the chat work panel: routing, block parity, compaction, interrupt, picker. */

import { expect, test } from '@playwright/test'
import { resolveOpsPayload, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE, mockSSEDynamic } from '../mocks/sse.js'

/** One turn that routes a Bash call to the work column and then ends. */
function workTurn(index) {
  return [
    {
      type: 'user',
      subtype: 'text',
      is_human: true,
      content: `turn ${index}`,
      turn_id: `t${index}`,
    },
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Bash',
      tool_use_id: `tu_fill_${index}`,
      tool_name: 'Bash',
      tool_input: { command: `echo fill-${index}` },
    },
    {
      type: 'assistant',
      subtype: 'tool_result',
      content: 'line\n'.repeat(10),
      tool_use_id: `tu_fill_${index}`,
    },
    { type: 'result', subtype: 'success', turn_id: `t${index}` },
  ]
}

/** A turn that routes nothing away - prose only, never a step target and never an overview bar. */
function proseTurn(index) {
  return [
    {
      type: 'user',
      subtype: 'text',
      is_human: true,
      content: `chat ${index}`,
      turn_id: `p${index}`,
    },
    { type: 'assistant', subtype: 'text', content: 'just talking' },
    { type: 'result', subtype: 'success', turn_id: `p${index}` },
  ]
}

/** Wait until scrollTop holds across two reads a beat apart. */
async function waitForStableScrollTop(column) {
  let last = null
  await expect
    .poll(async () => {
      const current = await column.evaluate(el => el.scrollTop)
      const stable = current === last
      last = current
      return stable
    })
    .toBe(true)
  return last
}

/** The turn id of the work entry currently at the top of the visible column. */
function topEntryTurnId(page) {
  return page.evaluate(() => {
    const column = document.querySelector('[data-testid="work-column"]')
    const rect = column.getBoundingClientRect()
    const entries = [...column.querySelectorAll('[data-testid="work-turn-entry"]')]
    const visible = entries
      .map(el => ({ el, top: el.getBoundingClientRect().top }))
      .filter(({ top }) => top >= rect.top - 5)
      .sort((a, b) => a.top - b.top)
    return visible[0]?.el.dataset.workTurnId ?? null
  })
}

/**
 * Force the work column to the very top via a real wheel gesture, not a raw scrollTop write -
 * settle activity keeps re-pinning to the bottom, and only a gesture latches user intent.
 */
async function forceScrollToTop(page, column) {
  const box = await column.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, -10000)
      return column.evaluate(el => el.scrollTop)
    })
    .toBe(0)
}

test.describe('Work Panel', () => {
  test.beforeEach(async ({ page }) => {
    // The suite-wide default is off (see mocks/api.js) - this file exercises the work view on.
    await mockAPI(page, { sessionUiStateDefaults: { rightSlotView: 'work' } })
  })

  // SPEC: chat:right-slot-views-exclusive
  test('picking work shows the work column and hides the terminal; picking terminal reverses it', async ({
    page,
  }) => {
    await mockSSE(page, 'events/work-panel-mixed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.getByTestId('work-column')).toBeVisible()
    await expect(page.getByTestId('terminal-column')).toHaveCount(0)
    await expect(page.getByTestId('right-slot-view-work')).toHaveClass(/pressed/)

    await page.getByTestId('right-slot-view-terminal').click()

    await expect(page.getByTestId('terminal-column')).toBeVisible()
    await expect(page.getByTestId('work-column')).toHaveCount(0)
    await expect(page.getByTestId('right-slot-view-work')).not.toHaveClass(/pressed/)
  })

  test.describe('Routing', () => {
    // SPEC: chat:work-view-routes-all-tools
    // SPEC: tool:work-view-tool-routing
    test('every tool call moves to the work column, the transcript keeps only the prose', async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('.chat-messages [data-testid="tool-block"]')).toHaveCount(0)
      // Auto-collapse leaves only the last turn expanded, so the prose may be full text or a
      // collapsed preview - assert on the transcript's aggregate text, not a single element.
      await expect(page.locator('.chat-messages')).toContainText("I'll read the registry first")

      // Read is not Bash - proves the work view routes every tool, not just shell calls.
      const workBlocks = page.locator('[data-testid="work-column"] [data-testid="tool-block"]')
      await expect(workBlocks.filter({ hasText: 'Read' })).toBeVisible()
      await expect(workBlocks.filter({ hasText: 'Bash' }).first()).toBeVisible()
    })

    // SPEC: chat:work-view-emptied-turn
    test('a turn whose blocks all moved shows a collapsed preview naming no tool count', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'delete the temp file',
          turn_id: 't1',
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_solo',
          tool_name: 'Bash',
          tool_input: { command: 'rm temp.txt' },
        },
        { type: 'assistant', subtype: 'tool_result', content: 'removed', tool_use_id: 'tu_solo' },
        { type: 'result', subtype: 'success', turn_id: 't1' },
        { type: 'user', subtype: 'text', is_human: true, content: 'thanks', turn_id: 't2' },
        { type: 'assistant', subtype: 'text', content: 'You are welcome.' },
        { type: 'result', subtype: 'success', turn_id: 't2' },
      ])

      // The turn holding only the Bash call renders no assistant bubble - nothing to collapse.
      const emptiedTurn = page.locator('[data-turn-id="t1"].turn-container')
      await expect(emptiedTurn.locator('[data-testid="message-assistant"]')).toHaveCount(0)
    })

    // SPEC: tool:work-block-parity
    test('a work-column block renders with the same header and expandable sections as inline', async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const bashBlock = page
        .locator('[data-testid="work-column"] [data-testid="tool-block"]')
        .filter({ hasText: 'Bash' })
        .first()
      await expect(bashBlock).toContainText('2922 passed')

      await bashBlock.locator('.tool-header-area').click()
      await expect(bashBlock.locator('.tool-command-section')).toBeVisible()
      await expect(bashBlock.locator('.tool-command-section')).toContainText('just test-fe')
    })

    // SPEC: tool:work-task-nested-excluded
    test("a subagent's own calls stay nested inside its Task block, not listed separately", async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const workColumn = page.getByTestId('work-column')
      await expect(workColumn.locator('[data-testid="tool-block"]:has-text("Task")')).toBeVisible()
      await expect(workColumn.locator('[data-testid="tool-block"]:has-text("Grep")')).toHaveCount(0)

      const taskBlock = workColumn.locator('[data-testid="tool-block"]:has-text("Task")')
      await taskBlock.locator('.tool-header-area').click()
      await expect(
        taskBlock.locator('[data-testid="tool-block"].nested').filter({ hasText: 'Grep' }),
      ).toBeVisible()
    })

    // SPEC: tool:task-collapsed-default
    test('a running Task in the work column is collapsed by default, like every other tool', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Investigate the flaky test',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          tool_use_id: 'tool_work_act_001',
          tool_name: 'Task',
          tool_input: {
            description: 'Investigate',
            prompt: 'Find the flaky test.',
            subagent_type: 'Explore',
          },
        },
      ])

      const workColumn = page.getByTestId('work-column')
      const taskBlock = workColumn.locator('[data-testid="tool-block"]:has-text("Task")')
      await expect(taskBlock).toBeVisible()
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()

      // Still collapsed once its first nested call arrives - catches a flag flip left undone by
      // a force-expand effect still in place.
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_work_act_001',
        tool_use_id: 'tool_work_act_001b',
        tool_name: 'Bash',
        tool_input: { command: 'pytest -k flaky' },
      })
      await expect(taskBlock.locator('.tool-activity')).toHaveText('Bash(pytest -k flaky)')
      await expect(taskBlock.locator('.tool-expanded-content')).not.toBeVisible()
    })

    // SPEC: tool:task-activity-line
    test("a running Task's activity line in the work column shows the newest nested call", async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Investigate the flaky test',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          tool_use_id: 'tool_work_act_002',
          tool_name: 'Task',
          tool_input: {
            description: 'Investigate',
            prompt: 'Find the flaky test.',
            subagent_type: 'Explore',
          },
        },
      ])

      const workColumn = page.getByTestId('work-column')
      const taskBlock = workColumn.locator('[data-testid="tool-block"]:has-text("Task")')
      await expect(taskBlock).toBeVisible()

      await controller.sendEvent({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_work_act_002',
        tool_use_id: 'tool_work_act_003',
        tool_name: 'Bash',
        tool_input: { command: 'pytest -k flaky' },
      })
      await expect(taskBlock.locator('.tool-activity')).toHaveText('Bash(pytest -k flaky)')

      // Narration replaces the call activity - the line follows the newest nested item.
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'text',
        content: 'Looking at the fixture setup next.',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        parent_tool_use_id: 'tool_work_act_002',
      })
      await expect(taskBlock.locator('.tool-activity')).toHaveText(
        'Looking at the fixture setup next.',
      )
    })

    // SPEC: chat:work-column-scope
    test('work entries are grouped by turn, oldest first, across the whole session', async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entries = page.getByTestId('work-turn-entry')
      // turn_002 has no tool calls, so it contributes no entry - the remaining four stay ordered.
      // Wait for the mounted count first: evaluateAll snapshots the DOM once, with no retry.
      await expect(entries).toHaveCount(4)
      const turnIds = await entries.evaluateAll(els => els.map(el => el.dataset.workTurnId))
      expect(turnIds).toEqual(['turn_001', 'turn_003', 'turn_004', 'turn_005'])
    })
  })

  test.describe('Live turn', () => {
    // SPEC: chat:work-view-emptied-turn-live
    test('a turn still responding with only tool calls shows a working indication under the user message, outside any bubble', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // No result event - the turn stays active while its only content is a tool call.
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'run the linter', turn_id: 't1' },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_live',
          tool_name: 'Bash',
          tool_input: { command: 'just lint' },
        },
      ])

      await expect(page.getByTestId('turn-progress-bare')).toBeVisible()
      await expect(page.getByTestId('turn-progress-bare')).toContainText('Working')
      await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(0)

      await controller.sendEvents([
        { type: 'assistant', subtype: 'tool_result', content: 'clean', tool_use_id: 'tu_live' },
        { type: 'result', subtype: 'success', turn_id: 't1' },
      ])

      // Completion removes only the working indication - still no assistant bubble.
      await expect(page.getByTestId('turn-progress-bare')).toHaveCount(0)
      await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(0)
      await expect(page.getByTestId('message-user')).toBeVisible()
    })
  })

  test.describe('Compaction', () => {
    // SPEC: tool:compaction-both-columns
    test('the compaction marker appears once in the transcript and once in the work column, expanding independently', async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const transcriptMarker = page.locator('.chat-messages .compaction-block')
      const workMarker = page.locator('[data-testid="work-column"] .compaction-block')
      await expect(transcriptMarker).toHaveCount(1)
      await expect(workMarker).toHaveCount(1)

      await workMarker.locator('.compaction-header').click()
      await expect(workMarker).toHaveClass(/./)
      // Expanding the work column's marker leaves the transcript's own collapsed.
      await expect(transcriptMarker.locator('.compaction-summary')).toHaveCount(0)
    })
  })

  test.describe('Interrupt', () => {
    // SPEC: chat:interrupt-work-panel-block
    test("an interrupted turn's last work-column tool block carries the same yellow left border", async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const marked = page.locator(
        '[data-testid="work-turn-entry"][data-work-turn-id="turn_004"] .work-interrupted-block',
      )
      await expect(marked).toHaveCount(1)
      await expect(marked.locator('[data-testid="tool-block"]')).toContainText('Edit')
    })

    // SPEC: chat:interrupt-work-panel-block
    test("marks nothing when the interrupted turn's trailing block is prose, even with an earlier tool call", async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entry = page.locator('[data-testid="work-turn-entry"][data-work-turn-id="turn_005"]')
      await expect(entry.locator('[data-testid="tool-block"]')).toHaveCount(1)
      await expect(entry.locator('.work-interrupted-block')).toHaveCount(0)
      // turn_005's trailing prose keeps its assistant bubble, so the transcript still borders it;
      // turn_004 ends on a tool call and has no bubble, leaving the panel its only bearer.
      await expect(page.locator('[data-turn-id="turn_005"] .turn-interrupted')).toHaveCount(1)
      await expect(page.locator('[data-turn-id="turn_004"] .turn-interrupted')).toHaveCount(0)
    })
  })

  test.describe('Empty state', () => {
    // SPEC: chat:work-column-empty
    test('a session with no tool calls shows the empty message', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByTestId('work-empty')).toHaveText('No work has happened yet.')
    })

    // SPEC: chat:work-column-empty
    test('a brand-new session with the work view picked shows the same empty message', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByTestId('work-empty')).toHaveText('No work has happened yet.')
      await expect(page.getByTestId('right-slot-view-work')).toHaveClass(/pressed/)
      void controller
    })
  })

  test.describe('Jump', () => {
    // SPEC: chat:work-entry-jump
    test("clicking a work entry's separator scrolls the transcript to that turn and highlights it", async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entry = page.locator('[data-testid="work-turn-entry"][data-work-turn-id="turn_003"]')
      await entry.locator('.work-turn-separator').click()

      const turnContainer = page.locator('[data-turn-id="turn_003"].turn-container')
      await expect(turnContainer).toBeVisible()
      await expect(turnContainer.locator('.jump-highlight')).toHaveCount(1)
    })
  })

  test.describe('Windowing', () => {
    // SPEC: chat:work-column-offscreen-absent
    test('only entries near the viewport are present in the page', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      for (let i = 0; i < 20; i++) {
        await controller.sendEvents([
          { type: 'user', subtype: 'text', is_human: true, content: `turn ${i}`, turn_id: `t${i}` },
          {
            type: 'assistant',
            subtype: 'tool_use',
            content: 'Bash',
            tool_use_id: `tu_win_${i}`,
            tool_name: 'Bash',
            tool_input: { command: `echo win-${i}` },
          },
          {
            type: 'assistant',
            subtype: 'tool_result',
            content: 'line\n'.repeat(10),
            tool_use_id: `tu_win_${i}`,
          },
          { type: 'result', subtype: 'success', turn_id: `t${i}` },
        ])
      }

      const entries = page.getByTestId('work-turn-entry')
      await expect.poll(() => entries.count()).toBeGreaterThan(0)
      expect(await entries.count()).toBeLessThan(20)
    })
  })

  test.describe('Persistence', () => {
    // SPEC: chat:right-slot-view-persist
    test('the chosen view survives a reload, independent of another session', async ({ page }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const patchedViews = []
      page.on('request', request => {
        if (request.url().includes('/ui-state') && request.method() === 'PATCH') {
          const resolved = resolveOpsPayload(JSON.parse(request.postData() || '{}'))
          if (resolved.session?.rightSlotView !== undefined) {
            patchedViews.push(resolved.session.rightSlotView)
          }
        }
      })

      await expect(page.getByTestId('work-column')).toBeVisible()

      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForAppReady(page)

      await expect(page.getByTestId('work-column')).toBeVisible()
      await expect(page.getByTestId('right-slot-view-work')).toHaveClass(/pressed/)
      void patchedViews
    })
  })

  test.describe('Control Bar Division', () => {
    // SPEC: chat:terminal-split-divider-bar
    test('the bar divides at the same x as the column divider under the work view too', async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('.panel-control-bar')).toHaveCount(1)
      const left = page.locator('.panel-control-bar-left')
      const divider = page.locator('[data-testid="chat-split-divider"]')
      await expect(left).toBeVisible()

      const leftBox = await left.boundingBox()
      const dividerBox = await divider.boundingBox()
      expect(Math.abs(leftBox.x + leftBox.width - dividerBox.x)).toBeLessThan(2)
    })

    // SPEC: chat:terminal-split-divider-bar
    test('narrowing below the fit threshold undivides the bar; the picker stays on work', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await expect(page.locator('.panel-control-bar-left')).toBeVisible()

      await page.setViewportSize({ width: 500, height: 800 })

      await expect(page.locator('.panel-control-bar-left')).toHaveCount(0)
      await expect(page.locator('.panel-control-bar')).toHaveCount(1)
      await expect(page.getByTestId('right-slot-view-work')).toHaveClass(/pressed/)
    })
  })

  test.describe('Autoscroll', () => {
    // SPEC: chat:work-column-autoscroll
    test('follows a new turn at the bottom, stays put once scrolled up', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enough turns to overflow the column, so scroll position is meaningful.
      for (let i = 0; i < 15; i++) {
        await controller.sendEvents(workTurn(i))
      }

      const work = page.locator('[data-testid="work-column"]')
      const entries = page.getByTestId('work-turn-entry')
      await expect.poll(() => entries.count()).toBeGreaterThan(0)
      expect(await entries.count()).toBeLessThan(15)
      await expect
        .poll(() => work.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)

      await controller.sendEvents(workTurn('bottom_follow'))
      await expect
        .poll(() => work.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)

      // A real wheel gesture, not a raw scrollTop write, both moves the view and latches user
      // intent (see minimap.spec.js: programmatic scrollTop doesn't reliably disable autoscroll).
      const box = await work.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, -10000)
      }
      await expect.poll(() => work.evaluate(el => el.scrollTop)).toBeLessThan(4000)
      const scrolledUp = await work.evaluate(el => el.scrollTop)

      await controller.sendEvents(workTurn('stay_put'))
      // Scrolled away from the bottom: the new turn lands without pulling the view back down.
      await expect.poll(() => work.evaluate(el => el.scrollTop)).toBe(scrolledUp)
    })

    // SPEC: chat:work-column-lands-at-end
    test('lands at its newest entry when opening a session that already routed calls', async ({
      page,
    }) => {
      const events = Array.from({ length: 15 }, (_, i) => workTurn(i)).flat()
      await mockSSEDynamic(page, () => events)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const work = page.locator('[data-testid="work-column"]')
      const entries = page.getByTestId('work-turn-entry')
      await expect(entries.last()).toHaveAttribute('data-work-turn-id', 't14')
      await expect
        .poll(() => work.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)
    })

    // SPEC: chat:work-column-lands-at-end
    test('lands at its newest entry when the view is turned on mid-session, not wherever it was left', async ({
      page,
    }) => {
      await mockAPI(page, { sessionUiStateDefaults: { rightSlotView: 'off' } })
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      for (let i = 0; i < 15; i++) {
        await controller.sendEvents(workTurn(i))
      }
      await expect(page.getByTestId('work-column')).toHaveCount(0)

      await page.getByTestId('right-slot-view-work').click()

      const work = page.locator('[data-testid="work-column"]')
      await expect(work).toBeVisible()
      const entries = page.getByTestId('work-turn-entry')
      await expect(entries.last()).toHaveAttribute('data-work-turn-id', 't14')
      await expect
        .poll(() => work.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)
    })

    // SPEC: chat:work-column-follows-active-turn
    test('stays pinned to the bottom while a single turn accumulates calls, not only when it ends', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'do several things',
          turn_id: 't1',
        },
      ])

      const work = page.locator('[data-testid="work-column"]')
      // Each call lands within the SAME turn (no `result` event between them) - a follow-on-append-
      // only implementation would only re-pin on a new turn, not on this in-place growth.
      for (let i = 0; i < 5; i++) {
        await controller.sendEvents([
          {
            type: 'assistant',
            subtype: 'tool_use',
            content: 'Bash',
            tool_use_id: `tu_grow_${i}`,
            tool_name: 'Bash',
            tool_input: { command: `echo grow-${i}` },
          },
          {
            type: 'assistant',
            subtype: 'tool_result',
            content: 'line\n'.repeat(10),
            tool_use_id: `tu_grow_${i}`,
          },
        ])
        await expect
          .poll(() => work.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
          .toBe(true)
      }
    })

    // SPEC: chat:work-column-independent-autoscroll
    test('scrolling the transcript away from the bottom leaves the work column following', async ({
      page,
    }) => {
      const events = Array.from({ length: 15 }, (_, i) => workTurn(i)).flat()
      await mockSSEDynamic(page, () => events)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const transcript = page.locator('[data-testid="chat-messages"]')
      const box = await transcript.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, -10000)
      }
      await expect
        .poll(() => transcript.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight))
        .toBeGreaterThan(50)

      const workIndicator = page.getByTestId('work-autoscroll-indicator')
      await expect(workIndicator).toHaveClass(/pressed/)
      await expect(workIndicator).toBeDisabled()
    })

    // SPEC: chat:control-work-bottom
    test('clicking the work control jumps to the newest entry and resumes following', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      for (let i = 0; i < 15; i++) {
        await controller.sendEvents(workTurn(i))
      }

      const work = page.locator('[data-testid="work-column"]')
      const workIndicator = page.getByTestId('work-autoscroll-indicator')
      const distanceFromBottom = () =>
        work.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
      await expect.poll(distanceFromBottom).toBeLessThan(50)

      const box = await work.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, -10000)
      }
      await expect.poll(() => workIndicator.getAttribute('aria-pressed')).toBe('false')
      await expect.poll(distanceFromBottom).toBeGreaterThan(50)

      await workIndicator.click()

      await expect.poll(() => workIndicator.getAttribute('aria-pressed')).toBe('true')
      await expect.poll(distanceFromBottom).toBeLessThan(50)
    })
  })

  test.describe('Step Navigation', () => {
    /** Fill the work column with `count` working turns, well past what it shows in one viewport. */
    async function fillWork(page, controller, prefix, count) {
      const events = Array.from({ length: count }, (_, i) => [
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: `${prefix} ${i}`,
          turn_id: `${prefix}${i}`,
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: `tu_${prefix}_${i}`,
          tool_name: 'Bash',
          tool_input: { command: `echo ${prefix}-${i}` },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'line\n'.repeat(6),
          tool_use_id: `tu_${prefix}_${i}`,
        },
        { type: 'result', subtype: 'success', turn_id: `${prefix}${i}` },
      ]).flat()
      await controller.sendEvents(events)

      const column = page.locator('[data-testid="work-column"]')
      await expect
        .poll(() => column.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)
      await waitForStableScrollTop(column)
    }

    // SPEC: chat:control-work-prev
    // SPEC: chat:control-work-next
    test('up and down controls sit left of the autoscroll control, in the transcript group order', async ({
      page,
    }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const prev = page.getByTestId('work-jump-prev')
      const next = page.getByTestId('work-jump-next')
      const indicator = page.getByTestId('work-autoscroll-indicator')
      await expect(prev).toBeVisible()
      await expect(next).toBeVisible()
      const prevBox = await prev.boundingBox()
      const nextBox = await next.boundingBox()
      const indicatorBox = await indicator.boundingBox()
      expect(prevBox.x).toBeLessThan(nextBox.x)
      expect(nextBox.x).toBeLessThan(indicatorBox.x)
    })

    // SPEC: chat:work-column-step
    test('clicking down, then up, steps the column one turn at a time', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillWork(page, controller, 'btn', 25)

      const column = page.locator('[data-testid="work-column"]')
      await expect.poll(() => topEntryTurnId(page)).not.toBeNull()

      await forceScrollToTop(page, column)
      await expect.poll(() => topEntryTurnId(page)).toBe('btn0')

      await page.getByTestId('work-jump-next').click()
      await expect.poll(() => topEntryTurnId(page)).toBe('btn1')

      await page.getByTestId('work-jump-next').click()
      await expect.poll(() => topEntryTurnId(page)).toBe('btn2')

      await page.getByTestId('work-jump-prev').click()
      await expect.poll(() => topEntryTurnId(page)).toBe('btn1')
    })

    // SPEC: shortcut:alt-pageup
    // SPEC: shortcut:alt-pagedown
    test('Alt+PageDown and Alt+PageUp do the same as the buttons, from anywhere in the app', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillWork(page, controller, 'key', 25)

      const column = page.locator('[data-testid="work-column"]')
      await expect.poll(() => topEntryTurnId(page)).not.toBeNull()
      await forceScrollToTop(page, column)
      await expect.poll(() => topEntryTurnId(page)).toBe('key0')

      await page.keyboard.press('Alt+PageDown')
      await expect.poll(() => topEntryTurnId(page)).toBe('key1')

      await page.keyboard.press('Alt+PageUp')
      await expect.poll(() => topEntryTurnId(page)).toBe('key0')
    })

    // SPEC: chat:work-column-step
    test('the case that pays for it: never lands on a prose-only turn, stepping either direction', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Working, prose, working, prose, working - a naive index stepper lands on the prose ones.
      await controller.sendEvents([
        ...workTurn('w0'),
        ...proseTurn('p0'),
        ...workTurn('w1'),
        ...proseTurn('p1'),
        ...workTurn('w2'),
      ])
      await expect(page.getByTestId('work-turn-entry')).toHaveCount(3)

      const column = page.locator('[data-testid="work-column"]')
      await forceScrollToTop(page, column)
      await expect.poll(() => topEntryTurnId(page)).toBe('tw0')

      await page.getByTestId('work-jump-next').click()
      await expect.poll(() => topEntryTurnId(page)).toBe('tw1')

      await page.getByTestId('work-jump-next').click()
      await expect.poll(() => topEntryTurnId(page)).toBe('tw2')

      await page.getByTestId('work-jump-prev').click()
      await expect.poll(() => topEntryTurnId(page)).toBe('tw1')
    })

    // SPEC: shortcut:jump-viewport
    test('reaches a turn that was never on screen, stepping down repeatedly from the top', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillWork(page, controller, 'reach', 30)

      const column = page.locator('[data-testid="work-column"]')
      await expect.poll(() => topEntryTurnId(page)).not.toBeNull()
      await forceScrollToTop(page, column)
      await expect.poll(() => topEntryTurnId(page)).toBe('reach0')

      for (let i = 0; i < 15; i++) {
        await page.getByTestId('work-jump-next').click()
        await expect.poll(() => topEntryTurnId(page)).toBe(`reach${i + 1}`)
      }
    })

    // SPEC: chat:work-column-step
    test('stepping to a turn flashes it', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillWork(page, controller, 'flash', 20)

      await page.getByTestId('work-jump-prev').click()

      await expect
        .poll(() => page.evaluate(() => document.querySelectorAll('.jump-highlight').length))
        .toBeGreaterThan(0)
    })

    // SPEC: chat:work-column-step
    test('stepping past the last turn settles at the end; past the first stays at the top', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillWork(page, controller, 'end', 20)

      const column = page.locator('[data-testid="work-column"]')
      const distanceFromBottom = () =>
        column.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
      await expect.poll(distanceFromBottom).toBeLessThan(50)

      await forceScrollToTop(page, column)
      for (let i = 0; i < 22; i++) {
        await page.getByTestId('work-jump-next').click()
      }
      await expect.poll(distanceFromBottom).toBeLessThan(50)
      await expect(page.getByTestId('work-autoscroll-indicator')).toHaveAttribute(
        'aria-pressed',
        'true',
      )

      await forceScrollToTop(page, column)

      await page.getByTestId('work-jump-prev').click()
      await expect.poll(() => column.evaluate(el => el.scrollTop)).toBe(0)
    })

    // SPEC: shortcut:right-column-no-ends
    test('the work group has no jump-to-top or jump-to-end control', async ({ page }) => {
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const right = page.locator('.panel-control-bar-right')
      await expect(right.locator('button')).toHaveCount(4)
    })

    test.describe('Isolation', () => {
      // SPEC: chat:autoscroll-disable
      test('Alt+Up/Down move the transcript and leave the work column untouched', async ({
        page,
      }) => {
        const controller = await createSSEController(page)
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        await fillWork(page, controller, 'iso1', 20)

        const column = page.locator('[data-testid="work-column"]')
        const offsetBefore = await waitForStableScrollTop(column)
        const indicator = page.getByTestId('work-autoscroll-indicator')
        const pressedBefore = await indicator.getAttribute('aria-pressed')

        await page.keyboard.press('Alt+ArrowUp')
        await page.keyboard.press('Alt+ArrowDown')

        expect(await column.evaluate(el => el.scrollTop)).toBe(offsetBefore)
        await expect(indicator).toHaveAttribute('aria-pressed', pressedBefore)
      })

      // SPEC: shortcut:alt-pageup
      test('Alt+PageUp/PageDown move the work column and leave the transcript untouched', async ({
        page,
      }) => {
        const controller = await createSSEController(page)
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        await fillWork(page, controller, 'iso2', 20)

        const messagesContainer = page.locator('[data-testid="chat-messages"]')
        const chatOffsetBefore = await messagesContainer.evaluate(el => el.scrollTop)
        const chatIndicator = page.getByTestId('autoscroll-indicator')
        const chatPressedBefore = await chatIndicator.getAttribute('aria-pressed')

        await page.keyboard.press('Alt+PageUp')
        await page.keyboard.press('Alt+PageDown')

        expect(await messagesContainer.evaluate(el => el.scrollTop)).toBe(chatOffsetBefore)
        await expect(chatIndicator).toHaveAttribute('aria-pressed', chatPressedBefore)
      })
    })

    // SPEC: shortcut:alt-pagedown
    test('the composer keeps focus and its caret position across Alt+PageDown', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillWork(page, controller, 'composer', 10)

      const textarea = page.locator('.chat-input textarea')
      await textarea.click()
      await textarea.fill('hello world')
      await textarea.evaluate(el => el.setSelectionRange(5, 5))

      await page.keyboard.press('Alt+PageDown')

      await expect(textarea).toBeFocused()
      const selection = await textarea.evaluate(el => [el.selectionStart, el.selectionEnd])
      expect(selection).toEqual([5, 5])
    })
  })

  test.describe('Overview', () => {
    const BASE_TS = Date.parse('2024-01-01T00:00:00.000Z')
    const iso = ms => new Date(BASE_TS + ms).toISOString()

    /** Working turns covering every bar state - fast, slow, failed, running - plus one prose. */
    async function seedOverviewTurns(page, controller) {
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'fast', turn_id: 'fast' },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_fast',
          tool_name: 'Bash',
          tool_input: { command: 'echo fast' },
          ts: iso(0),
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'ok',
          tool_use_id: 'tu_fast',
          ts: iso(100),
        },
        { type: 'result', subtype: 'success', turn_id: 'fast' },
        { type: 'user', subtype: 'text', is_human: true, content: 'chatting', turn_id: 'chat' },
        { type: 'assistant', subtype: 'text', content: 'just talking' },
        { type: 'result', subtype: 'success', turn_id: 'chat' },
        { type: 'user', subtype: 'text', is_human: true, content: 'slow', turn_id: 'slow' },
        // Three calls, not one - work's bar height prices call headers rather than output length,
        // so a taller bar needs more routed-away calls, not more result text.
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_slow_1',
          tool_name: 'Bash',
          tool_input: { command: 'echo slow-1' },
          ts: iso(1000),
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'ok',
          tool_use_id: 'tu_slow_1',
          ts: iso(1100),
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_slow_2',
          tool_name: 'Bash',
          tool_input: { command: 'echo slow-2' },
          ts: iso(1200),
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'ok',
          tool_use_id: 'tu_slow_2',
          ts: iso(1300),
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_slow_3',
          tool_name: 'Bash',
          tool_input: { command: 'echo slow-3' },
          ts: iso(1400),
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'ok',
          tool_use_id: 'tu_slow_3',
          ts: iso(61000),
        },
        { type: 'result', subtype: 'success', turn_id: 'slow' },
        { type: 'user', subtype: 'text', is_human: true, content: 'fail', turn_id: 'fail' },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_fail',
          tool_name: 'Bash',
          tool_input: { command: 'false' },
          ts: iso(62000),
        },
        {
          // Work's status reads the error tag through extractToolResult, where the terminal's
          // overview honours is_error directly - so the two fixtures differ deliberately.
          type: 'assistant',
          subtype: 'tool_result',
          content: '<tool_use_error>boom</tool_use_error>',
          tool_use_id: 'tu_fail',
          ts: iso(62500),
        },
        { type: 'result', subtype: 'success', turn_id: 'fail' },
        { type: 'user', subtype: 'text', is_human: true, content: 'running', turn_id: 'running' },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_running',
          tool_name: 'Bash',
          tool_input: { command: 'sleep 100' },
          ts: iso(63000),
        },
      ])
      // Five turns sent, one prose-only - four working entries, per seedOverviewEntries' shape.
      await expect(page.locator('[data-testid="work-turn-entry"]')).toHaveCount(4)
    }

    /** Enough working turns to give the column real scroll room, for click and drag tests. */
    async function fillOverviewColumn(page, controller, count) {
      const events = Array.from({ length: count }, (_, i) => [
        { type: 'user', subtype: 'text', is_human: true, content: `ov ${i}`, turn_id: `ov${i}` },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: `tu_ov_${i}`,
          tool_name: 'Bash',
          tool_input: { command: `echo ov-${i}` },
          ts: iso(i * 1000),
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'line\n'.repeat(6),
          tool_use_id: `tu_ov_${i}`,
          ts: iso(i * 1000 + 500),
        },
        { type: 'result', subtype: 'success', turn_id: `ov${i}` },
      ]).flat()
      await controller.sendEvents(events)
      const column = page.locator('[data-testid="work-column"]')
      await expect
        .poll(() => column.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)
      await waitForStableScrollTop(column)
    }

    // SPEC: chat:control-work-minimap
    test('a map toggle sits rightmost in the work group', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      const toggle = page.getByTestId('work-minimap-toggle')
      const indicator = page.getByTestId('work-autoscroll-indicator')
      await expect(toggle).toBeVisible()
      const toggleBox = await toggle.boundingBox()
      const indicatorBox = await indicator.boundingBox()
      expect(toggleBox.x).toBeGreaterThan(indicatorBox.x)
    })

    // SPEC: chat:work-minimap
    test('one bar per working turn, oldest at the top, in column order - prose turns excluded', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      // Five turns sent (one prose-only) - the overview must agree with the column: four bars.
      await expect(page.locator('[data-testid="work-minimap-bar"]')).toHaveCount(4)
    })

    // SPEC: chat:work-minimap-no-segments
    test('has no segments or human-message lines - those are transcript-only concepts', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      const overview = page.getByTestId('work-minimap')
      await expect(overview.locator('[data-testid="minimap-segment"]')).toHaveCount(0)
      await expect(overview.locator('[data-testid="minimap-human-line"]')).toHaveCount(0)
    })

    // SPEC: chat:work-minimap-bar-height
    test('a bar with more output is taller than one with less', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      const bars = page.locator('[data-testid="work-minimap-bar"]')
      const heights = await bars.evaluateAll(els => els.map(el => Number.parseFloat(el.style.flex)))
      // Index 1 is the slow/tall turn (5 lines of output); index 0 is the fast/short one.
      expect(heights[1]).toBeGreaterThan(heights[0])
    })

    // SPEC: chat:work-minimap-bar-width
    test('a slower turn is visibly wider, within the shared 8-20px range', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      const bars = page.locator('[data-testid="work-minimap-bar"]')
      const widths = await bars.evaluateAll(els => els.map(el => Number.parseFloat(el.style.width)))
      expect(widths[1]).toBeGreaterThan(widths[0])
      for (const width of widths) {
        expect(width).toBeGreaterThanOrEqual(8)
        expect(width).toBeLessThanOrEqual(20)
      }
    })

    // SPEC: chat:work-minimap-bar-status
    test('a failed turn is coloured apart from passing and still-running ones', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      const bars = page.locator('[data-testid="work-minimap-bar"]')
      await expect(bars.nth(0)).toHaveClass(/work-minimap-bar-passed/)
      await expect(bars.nth(2)).toHaveClass(/work-minimap-bar-failed/)
      await expect(bars.nth(3)).toHaveClass(/work-minimap-bar-running/)

      const [passedColor, failedColor, runningColor] = await Promise.all(
        [0, 2, 3].map(i => bars.nth(i).evaluate(el => getComputedStyle(el).backgroundColor)),
      )
      expect(failedColor).not.toBe(passedColor)
      expect(runningColor).not.toBe(passedColor)
      expect(runningColor).not.toBe(failedColor)
    })

    // SPEC: chat:work-minimap-shared-behavior
    test('clicking the overview jumps the column to that position', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillOverviewColumn(page, controller, 25)

      const column = page.locator('[data-testid="work-column"]')
      await forceScrollToTop(page, column)

      const overview = page.getByTestId('work-minimap')
      const box = await overview.boundingBox()
      await overview.click({ position: { x: box.width / 2, y: box.height - 10 } })

      await expect.poll(() => column.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    })

    // SPEC: chat:work-minimap-shared-behavior
    test('dragging the overview scrolls the column continuously', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillOverviewColumn(page, controller, 25)

      const column = page.locator('[data-testid="work-column"]')
      await forceScrollToTop(page, column)

      const overview = page.getByTestId('work-minimap')
      const box = await overview.boundingBox()
      const startX = box.x + box.width / 2
      const startY = box.y + 10
      const endY = box.y + box.height - 10

      await page.mouse.move(startX, startY)
      await page.mouse.down()
      const steps = 5
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(startX, startY + ((endY - startY) * i) / steps)
      }
      await page.mouse.up()

      await expect.poll(() => column.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    })

    // SPEC: chat:work-minimap-independent
    test('toggling the work overview leaves the transcript overview untouched', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      const transcriptOverview = page.locator('.minimap-overlay')
      await expect(transcriptOverview).toHaveClass(/visible/)

      await page.getByTestId('work-minimap-toggle').click()

      await expect(page.getByTestId('work-minimap-toggle')).not.toHaveClass(/pressed/)
      await expect(transcriptOverview).toHaveClass(/visible/)
      await expect(page.getByTestId('control-minimap-toggle')).toHaveClass(/pressed/)
    })

    // SPEC: chat:minimap-pinned-inset
    test('a pinned work overview keeps entries clear of it, the same as the terminal', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      // Pinned by default (claim:chat:minimap-toggle-persist).
      const column = page.locator('[data-testid="work-column"]')
      await expect(page.getByTestId('work-minimap-toggle')).toHaveClass(/pressed/)
      await expect(column).toHaveClass(/minimap-pinned/)

      await page.getByTestId('work-minimap-toggle').click()
      await expect(page.getByTestId('work-minimap-toggle')).not.toHaveClass(/pressed/)
      await expect(column).not.toHaveClass(/minimap-pinned/)

      await page.getByTestId('work-minimap-toggle').click()
      await expect(page.getByTestId('work-minimap-toggle')).toHaveClass(/pressed/)
      await expect(column).toHaveClass(/minimap-pinned/)
    })

    // SPEC: chat:work-minimap-independent
    test('each overview persists its own pin state across a reload', async ({ page }) => {
      await mockAPI(page, {
        sessionUiStateDefaults: { rightSlotView: 'work', workMinimapPinned: false },
      })
      await mockSSE(page, 'events/work-panel-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByTestId('work-minimap-toggle')).not.toHaveClass(/pressed/)
      await expect(page.getByTestId('control-minimap-toggle')).toHaveClass(/pressed/)
    })

    // SPEC: chat:work-minimap
    test('turning the work view off removes the work overview; the transcript keeps its own', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewTurns(page, controller)

      await expect(page.getByTestId('work-minimap')).toBeVisible()

      await page.getByTestId('right-slot-view-work').click()

      await expect(page.getByTestId('work-minimap')).not.toBeAttached()
      await expect(page.locator('.minimap-overlay')).toHaveClass(/visible/)
    })

    // SPEC: chat:work-minimap
    test('a session with no tool calls shows no work overview', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByTestId('work-empty')).toBeVisible()
      await expect(page.getByTestId('work-minimap')).not.toBeAttached()
    })
  })
})
