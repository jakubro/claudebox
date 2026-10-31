/** E2E tests for progress indicator functionality. */

import { expect, test } from '@playwright/test'
import { openLiveSession, openLiveSessionWithAPI, openSession } from '../helpers.js'
import { mockAPI } from '../mocks/api.js'

test.describe('Progress Indicators', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Working State', () => {
    // SPEC: turn:progress-working
    test('active turn shows Working indicator with spinner', async ({ page }) => {
      await openSession(page, 'events/progress-working.jsonl')

      await expect(page.locator('.turn-container').first()).toBeVisible()

      await expect(page.locator('.turn-progress-working').first()).toBeVisible()
      await expect(page.getByText('Working').first()).toBeVisible()

      await expect(page.locator('.progress-spinner').first()).toBeVisible()
    })

    // SPEC: turn:progress-working
    test('working indicator has animated spinner', async ({ page }) => {
      await openSession(page, 'events/progress-working.jsonl')

      const spinner = page.locator('.progress-spinner').first()
      await expect(spinner).toBeVisible()

      const animation = await spinner.evaluate(el => {
        const style = getComputedStyle(el)
        return style.animation || style.animationName
      })

      expect(animation).not.toBe('none')
    })

    // SPEC: turn:progress-working
    test('working shows a drawn, rotating ring', async ({ page }) => {
      await openSession(page, 'events/progress-working.jsonl')

      const ring = page.locator('.turn-progress-working .progress-spinner').first()
      await expect(ring).toBeVisible()
      expect(await ringState(ring)).toMatchObject({ tag: 'svg', rotating: true })
    })
  })

  test.describe('Stopping State', () => {
    // SPEC: turn:progress-stopping
    // SPEC: turn:progress-working
    test('interrupt shows Stopping indicator', async ({ page }) => {
      const controller = await openLiveSession(page)

      // No result event, so the turn stays in the "working" state.
      await sendTurnAndFocusComposer(page, controller, [
        {
          type: 'user',
          subtype: 'text',
          content: 'Do something',
          is_human: true,
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working on it...',
          timestamp: Date.now() + 1000,
          ts: new Date().toISOString(),
        },
      ])
      await page.keyboard.press('Control+.')

      await expect(page.getByText(/Stopping/i).first()).toBeVisible()

      const ring = page.locator('.turn-progress-stopping .progress-spinner')
      expect(await ringState(ring)).toMatchObject({ tag: 'svg', rotating: true })
    })

    // SPEC: shortcut:ctrl-dot
    test('stop button triggers interrupt API', async ({ page }) => {
      let interruptCalled = false

      const controller = await openLiveSessionWithAPI(page, {
        handlers: {
          interrupt: async route => {
            interruptCalled = true
            await route.fulfill({ status: 200, json: { success: true } })
          },
        },
      })

      await sendTurnAndFocusComposer(page, controller, [
        {
          type: 'user',
          subtype: 'text',
          content: 'Test',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])
      await expect(page.locator('.turn-progress-working').first()).toBeVisible()
      await page.keyboard.press('Control+.')

      await expect.poll(() => interruptCalled).toBe(true)
    })

    // SPEC: error:state-stopped-clear
    test('stopped state clears on result event', async ({ page }) => {
      const controller = await openLiveSessionWithAPI(page)

      await sendTurnAndFocusComposer(page, controller, [
        {
          type: 'user',
          subtype: 'text',
          content: 'Test prompt',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])
      await page.keyboard.press('Control+.')
      await expect(page.getByText(/Stopping/i).first()).toBeVisible()

      // Send a result event (as would arrive from the backend after interrupt)
      await controller.sendEvent({
        type: 'result',
        subtype: 'success',
        timestamp: Date.now() + 500,
      })

      // Stopped state should clear automatically without user action
      await expect
        .poll(async () => {
          const footerStatus = page.locator('[data-testid="footer-status"]')
          const statusText = await footerStatus.textContent()
          return statusText?.includes('Stopped') ?? false
        })
        .toBe(false)
    })
  })
})

test.describe('Working line in the Focused view', () => {
  const line = page => page.getByTestId('turn-progress-working')

  // SPEC: turn:progress-names-hidden-call
  // SPEC: turn:progress-follows-newest
  test('names the newest hidden call until something else arrives', async ({ page }) => {
    const controller = await openLive(page)

    await controller.sendEvent(human('Read the notes'))
    await controller.sendEvent({ type: 'assistant', subtype: 'text', content: 'Looking.' })
    await expect(line(page)).toHaveText('Working...')
    await controller.sendEvent(call('tu_read', 'Read', { file_path: '/work/notes.md' }))
    await expect(line(page)).toHaveText('Reading notes.md...')
    await expect(line(page).locator('.dot')).toHaveCount(3)

    await controller.sendEvent(result('tu_read'))
    await expect(line(page)).toHaveText('Reading notes.md...')

    await controller.sendEvent({ type: 'assistant', subtype: 'text', content: 'Two sections.' })
    await expect(line(page)).toHaveText('Working...')

    await controller.sendEvent(call('tu_a', 'Read', { file_path: '/work/a.md' }))
    await controller.sendEvent(call('tu_b', 'Read', { file_path: '/work/b.md' }))
    await expect(line(page)).toHaveText('Reading b.md...')

    await controller.sendEvent(call('tu_edit', 'Edit', { file_path: '/work/b.md' }))
    await expect(line(page)).toHaveText('Working...')
  })

  // SPEC: turn:progress-hidden-call-phrases
  test('reads a search, a web search, a fetch and a skill load in their own words', async ({
    page,
  }) => {
    const controller = await openLive(page)
    await controller.sendEvent(human('Look around'))

    for (const [id, name, input, expected] of [
      ['tu_grep', 'Grep', { pattern: 'TODO' }, 'Searching for TODO...'],
      ['tu_glob', 'Glob', { pattern: '**/*.md' }, 'Searching for **/*.md...'],
      [
        'tu_ws',
        'WebSearch',
        { query: 'vite wasm assets' },
        'Searching the web for vite wasm assets...',
      ],
      [
        'tu_wf',
        'WebFetch',
        { url: 'https://docs.python.org/3/library/re.html' },
        'Fetching docs.python.org...',
      ],
      ['tu_skill', 'Skill', { skill: 'changelog' }, 'Loading changelog skill...'],
    ]) {
      await controller.sendEvent(call(id, name, input))
      await expect(line(page)).toHaveText(expected)
    }
  })

  // SPEC: turn:progress-hidden-command
  test('reads a pure command, a read-only tool-server call and a session read', async ({
    page,
  }) => {
    const controller = await openLive(page)
    await controller.sendEvent(human('Count them'))

    for (const [id, name, input, mark, expected] of [
      [
        'tu_wc',
        'Bash',
        { command: 'wc -l app.log', description: 'Count lines in the log' },
        { command_read_only: true },
        'Count lines in the log...',
      ],
      [
        'tu_wc2',
        'Bash',
        { command: 'wc -l app.log | head -1' },
        { command_read_only: true },
        'Running wc -l app.log...',
      ],
      [
        'tu_url',
        'mcp__jina__read_url',
        { url: 'https://example.com' },
        { mcp_read_only: true },
        'Running read_url...',
      ],
      [
        'tu_sr',
        'mcp__claudebox__session_read',
        { session_id: 'other' },
        {},
        'Running session_read...',
      ],
    ]) {
      await controller.sendEvent({ ...call(id, name, input), ...mark })
      await expect(line(page)).toHaveText(expected)
    }

    await controller.sendEvent(call('tu_log', 'Bash', { command: 'git log --oneline -5' }))
    await expect(line(page)).toHaveText('Working...')
  })

  // SPEC: turn:progress-hidden-other
  test('reads Working while a task-list read or a resource read is newest', async ({ page }) => {
    const controller = await openLive(page)
    await controller.sendEvent(human('Check the tasks'))

    for (const [id, name] of [
      ['tu_read', 'Read'],
      ['tu_list', 'TaskList'],
      ['tu_read2', 'Read'],
      ['tu_res', 'ReadMcpResourceTool'],
    ]) {
      await controller.sendEvent(call(id, name, { file_path: '/work/notes.md', server: 's' }))
      await expect(line(page)).toHaveText(name === 'Read' ? 'Reading notes.md...' : 'Working...')
    }
  })

  // SPEC: turn:progress-calls-not-counted
  test('a tool-schema search and a needs-you call leave the line as it is', async ({ page }) => {
    const controller = await openLive(page)
    await controller.sendEvent(human('Read, then ask'))
    await controller.sendEvent(call('tu_read', 'Read', { file_path: '/work/notes.md' }))
    await expect(line(page)).toHaveText('Reading notes.md...')

    await controller.sendEvent(call('tu_ts', 'ToolSearch', { query: 'notes' }))
    await controller.sendEvent(result('tu_ts'))
    await controller.sendEvent(call('tu_nu', 'mcp__claudebox__needs_user', { reason: 'Approve' }))
    await controller.sendEvent(result('tu_nu'))

    await expect(line(page)).toHaveText('Reading notes.md...')
  })

  // SPEC: turn:progress-subagent-calls
  test("a subagent's reads leave the line as it is", async ({ page }) => {
    const controller = await openLive(page)
    await controller.sendEvent(human('Delegate'))
    await controller.sendEvent(call('tu_task', 'Task', { description: 'Fix the parser' }))
    await controller.sendEvent({
      ...call('tu_sub', 'Read', { file_path: '/work/parser.py' }),
      parent_tool_use_id: 'tu_task',
    })

    await expect(page.locator('[data-tool-use-id="tu_task"] .tool-activity')).toHaveText(
      'Read(parser.py)',
    )
    await expect(line(page)).toHaveText('Working...')
  })

  // SPEC: turn:progress-label-one-line
  test('a long name stays on one line, cut with an ellipsis, its dots still showing', async ({
    page,
  }) => {
    const controller = await openLive(page)
    await controller.sendEvent(human('Read the long one'))
    await controller.sendEvent({ type: 'assistant', subtype: 'text', content: 'Looking.' })
    await expect(line(page)).toHaveText('Working...')
    const workingHeight = (await line(page).boundingBox()).height

    const name = `release-checklist-${'x'.repeat(180)}.md`
    await controller.sendEvent(call('tu_long', 'Read', { file_path: `/work/${name}\nsecond` }))
    await expect(line(page)).toContainText('Reading release-checklist-')

    const geometry = await line(page).evaluate(row => {
      const label = row.querySelector('.turn-progress-label')
      const rowBox = row.getBoundingClientRect()
      return {
        height: rowBox.height,
        cut: label.scrollWidth > label.clientWidth,
        ellipsis: getComputedStyle(label).textOverflow,
        dotsInside: [...row.querySelectorAll('.dot')].every(dot => {
          const box = dot.getBoundingClientRect()
          return box.width > 0 && box.right <= rowBox.right && box.top >= rowBox.top
        }),
        text: label.textContent,
      }
    })
    expect(geometry).toEqual({
      height: workingHeight,
      cut: true,
      ellipsis: 'ellipsis',
      dotsInside: true,
      text: `Reading ${name}`,
    })
  })

  // SPEC: turn:progress-working
  test('in Everything the line reads Working while a read is newest', async ({ page }) => {
    const controller = await openLive(page, { rightSlotView: 'everything' })
    await controller.sendEvent(human('Read the notes'))
    await controller.sendEvent(call('tu_read', 'Read', { file_path: '/work/notes.md' }))

    await expect(page.locator('[data-tool-use-id="tu_read"]')).toBeVisible()
    await expect(line(page)).toHaveText('Working...')
  })
})

async function sendTurnAndFocusComposer(page, controller, events) {
  await controller.sendEvents(events)
  await expect(page.locator('.turn-container').first()).toBeVisible()
  // Focus textarea so Ctrl+. is caught by ChatInput's onKeyDown handler
  await page.locator('[data-testid="chat-input"]').click()
}

async function openLive(page, uiState = {}) {
  await mockAPI(page, { sessionUiStateDefaults: uiState })
  const controller = await openLiveSession(page)
  return controller
}

function human(content) {
  return {
    type: 'user',
    subtype: 'text',
    content,
    is_human: true,
    turn_id: 'turn_live',
    ts: new Date().toISOString(),
  }
}

function call(id, name, input) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content: name,
    tool_name: name,
    tool_use_id: id,
    tool_input: input,
    ts: new Date().toISOString(),
  }
}

function result(id) {
  return { type: 'user', subtype: 'tool_result', tool_use_id: id, content: 'ok' }
}

function ringState(locator) {
  return locator.evaluate(el => ({
    tag: el.tagName.toLowerCase(),
    rotating: el.getAnimations().some(a => a.playState === 'running'),
    opacity: Number(getComputedStyle(el).opacity),
  }))
}
