/** E2E tests for added text: kept out of the conversation, behind a corner triangle. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI, waitForAppReady } from '../helpers.js'

const NOTE =
  '[Your previous response had no visible output. Please continue and produce a user-visible response.]'
const FEEDBACK = 'Stop hook feedback:\nHOOK-MARKER. Ask before you stop.'

const human = (content, turnId) => ({
  type: 'user',
  subtype: 'text',
  is_human: true,
  content,
  turn_id: turnId,
})
const say = content => ({ type: 'assistant', subtype: 'text', content })
const added = content => ({ type: 'user', subtype: 'text', is_human: false, content })
const call = (id, name, input = {}) => ({
  type: 'assistant',
  subtype: 'tool_use',
  content: name,
  tool_name: name,
  tool_use_id: id,
  tool_input: input,
})
const result = (id, content = 'ok') => ({
  type: 'user',
  subtype: 'tool_result',
  content,
  tool_use_id: id,
})
const done = turnId => ({ type: 'result', subtype: 'success', turn_id: turnId })

const toggleIn = scope => scope.getByTestId('injected-context-toggle')

test.describe('Added text', () => {
  // SPEC: chat:added-text-hidden
  // SPEC: chat:added-text-corner
  test("a held turn draws neither the hook's reason nor Claude Code's note, and marks the blocks they follow", async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/stop-hook-feedback.jsonl')

    const assistant = page.getByTestId('message-assistant')
    await expect(assistant).toContainText('DONE')
    await expect(assistant).not.toContainText('HOOK-MARKER')
    await expect(assistant).not.toContainText('no visible output')

    const held = page.locator('.turn-text', { hasText: 'PING' })
    await expect(toggleIn(held)).toHaveAttribute('title', 'Stop hook')
    const row = page.getByTestId('tool-block')
    await expect(toggleIn(row)).toHaveAttribute('title', 'Claude Code')
    await expect(toggleIn(page.locator('.turn-text', { hasText: 'DONE' }))).toHaveCount(0)
  })

  // SPEC: chat:added-text-box
  test('clicking a triangle opens a box under its block with each entry as received, and closes it again', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/stop-hook-feedback.jsonl')

    const held = page.locator('.turn-text', { hasText: 'PING' })
    await toggleIn(held).click()
    const box = held.getByTestId('injected-context-box')
    await expect(box).toBeVisible()
    expect(await box.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(
      await held.locator('p').evaluate(el => el.getBoundingClientRect().bottom),
    )
    await expect(box.locator('.injected-context-source')).toHaveText(['Stop hook'])
    await expect(box.locator('.injected-context-text')).toHaveText([
      'HOOK-MARKER. Ask before you stop.',
    ])
    await toggleIn(held).click()
    await expect(page.getByTestId('injected-context-box')).toHaveCount(0)

    const row = page.getByTestId('tool-block')
    await toggleIn(row).click()
    await expect(row.getByTestId('injected-context-box')).toContainText('Claude Code')
    await expect(row.getByTestId('injected-context-box')).toContainText(NOTE)
  })

  // SPEC: chat:added-text-anchor
  test('text opening a turn hangs on the user message; after a hidden tool search, on the block before it', async ({
    page,
  }) => {
    await openSessionWithAPI(page, [
      human('first', 't1'),
      added(FEEDBACK),
      say('one'),
      done('t1'),
      human('second', 't2'),
      say('two'),
      call('ts1', 'ToolSearch', { query: 'select:Read' }),
      result('ts1'),
      added(NOTE),
      say('three'),
      done('t2'),
    ])

    const firstUser = page.getByTestId('message-user').filter({ hasText: 'first' })
    await expect(toggleIn(firstUser)).toHaveAttribute('title', 'Stop hook')
    await expect(toggleIn(page.locator('.turn-text', { hasText: 'two' }))).toHaveAttribute(
      'title',
      'Claude Code',
    )
    await expect(toggleIn(page.locator('.turn-text', { hasText: 'three' }))).toHaveCount(0)
    await expect(toggleIn(page.locator('.turn-text', { hasText: 'one' }))).toHaveCount(0)
  })

  // SPEC: chat:added-text-anchor
  test('a lookup carrying added text marks the folded Lookups row, and its own row once opened', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__cb_lookups_grouping = true
    })
    await openSessionWithAPI(page, [
      human('look', 't1'),
      call('r1', 'Read', { file_path: '/home/user/project/a.py' }),
      result('r1', 'print(1)'),
      call('g1', 'Grep', { pattern: 'print' }),
      result('g1', 'a.py'),
      added(NOTE),
      say('found it'),
      done('t1'),
    ])

    const group = page.getByTestId('lookups-group')
    await expect(toggleIn(group)).toHaveCount(1)
    await group.locator('.tool-header').first().click()
    const grep = group.getByTestId('tool-block').filter({ hasText: 'Grep' })
    await expect(toggleIn(grep)).toHaveCount(1)
    await expect(toggleIn(group)).toHaveCount(1)
  })

  // SPEC: tool:reminder-collapsed
  test('a reminder inside a lookup result marks the folded Lookups row', async ({ page }) => {
    await page.addInitScript(() => {
      window.__cb_lookups_grouping = true
    })
    await openSessionWithAPI(page, [
      human('look', 't1'),
      call('r1', 'Read', { file_path: '/home/user/project/a.py', offset: 40 }),
      result(
        'r1',
        '<system-reminder>The file is shorter than the offset asked for.</system-reminder>',
      ),
      call('g1', 'Grep', { pattern: 'print' }),
      result('g1', 'a.py'),
      say('found it'),
      done('t1'),
    ])

    const group = page.getByTestId('lookups-group')
    await expect(toggleIn(group)).toHaveAttribute('title', 'System reminder')
    await toggleIn(group).click()
    await expect(group.getByTestId('injected-context-box')).toContainText(
      'The file is shorter than the offset asked for.',
    )
  })

  // SPEC: chat:added-text-anchor
  test('a block drawn in the right column carries its triangle there', async ({ page }) => {
    const events = [
      human('run it', 't1'),
      call('b1', 'Bash', { command: 'ls' }),
      result('b1', 'a.py'),
      added(NOTE),
      say('listed'),
      done('t1'),
    ]
    await openSessionWithAPI(page, events, { sessionUiStateDefaults: { rightSlotView: 'work' } })
    await expect(toggleIn(page.getByTestId('work-column'))).toHaveCount(1)
    await expect(toggleIn(page.locator('.chat-messages'))).toHaveCount(0)

    await page.getByTestId('right-slot-view-terminal').click()
    await expect(toggleIn(page.getByTestId('terminal-column'))).toHaveAttribute(
      'title',
      'Claude Code',
    )
  })

  // SPEC: chat:added-text-corner
  test('the triangle never covers the text of a block whose last line runs to its edge', async ({
    page,
  }) => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    await openSessionWithAPI(page, [
      human('say a lot', 't1'),
      say(long),
      added(FEEDBACK),
      done('t1'),
    ])

    const held = page.locator('.turn-text', { hasText: 'word59' })
    const overlap = await held.evaluate(el => {
      const toggle = el
        .querySelector('[data-testid="injected-context-toggle"]')
        .getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(el.querySelector('p'))
      return [...range.getClientRects()].some(
        r =>
          r.width > 0 &&
          r.left < toggle.right &&
          r.right > toggle.left &&
          r.top < toggle.bottom &&
          r.bottom > toggle.top,
      )
    })
    expect(overlap).toBe(false)
  })

  // SPEC: chat:added-text-excluded
  // SPEC: chat:copy-button-turn
  test('copying the turn, its answer or a part leaves added text out', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openSessionWithAPI(page, 'events/stop-hook-feedback.jsonl')
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText())

    await page.locator('.turn-meta').hover()
    await page.locator('.turn-copy-btn').click()
    expect(await clipboard()).toBe('PING\n\nDONE')

    await page.locator('.turn-answer-copy-btn').click()
    expect(await clipboard()).toBe('DONE')

    await page.locator('.turn-text', { hasText: 'PING' }).locator('p').hover()
    await page.getByTestId('block-strip').first().locator('.block-copy-btn').click()
    expect(await clipboard()).toBe('PING')
  })

  // SPEC: chat:added-text-excluded
  test('a selection running from the held message into its open box quotes no added text', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/stop-hook-feedback.jsonl')
    const held = page.locator('.turn-text', { hasText: 'PING' })
    await toggleIn(held).click()
    await expect(page.getByTestId('injected-context-box')).toBeVisible()

    await expect(async () => {
      await page.evaluate(() => {
        const start = [...document.querySelectorAll('.turn-text p')].find(
          p => p.textContent === 'PING',
        ).firstChild
        const end = document.querySelector('.injected-context-text').firstChild
        const range = document.createRange()
        range.setStart(start, 0)
        range.setEnd(end, end.textContent.length)
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
      await page.getByTestId('quote-affordance').click({ timeout: 1500 })
    }).toPass({ timeout: 15000, intervals: [200, 400, 800] })

    const quote = page.locator('.inline-float .inline-thread-quote-text')
    await expect(quote).toContainText('PING')
    await expect(quote).not.toContainText('HOOK-MARKER')
  })

  // SPEC: tool:reminder-scope
  test("a message's own reminder and the hook text after it share one triangle, reminder first", async ({
    page,
  }) => {
    await openSessionWithAPI(page, [
      human('ping', 't1'),
      say('PING<system-reminder>REMINDER-MARKER</system-reminder>'),
      added(FEEDBACK),
      done('t1'),
    ])

    const held = page.locator('.turn-text', { hasText: 'PING' })
    await expect(toggleIn(held)).toHaveAttribute('title', 'System reminder, Stop hook')
    await toggleIn(held).click()
    await expect(page.locator('.injected-context-source')).toHaveText([
      'System reminder',
      'Stop hook',
    ])
  })

  // SPEC: tool:reminder-scope
  test("a subagent's own tool row carries the reminders of its result", async ({ page }) => {
    await openSessionWithAPI(page, [
      human('delegate', 't1'),
      call('task1', 'Task', { description: 'Look around', prompt: 'look' }),
      {
        ...call('sub1', 'Read', { file_path: '/home/user/project/a.py' }),
        parent_tool_use_id: 'task1',
      },
      {
        ...result('sub1', 'print(1)<system-reminder>SUB-REMINDER</system-reminder>'),
        parent_tool_use_id: 'task1',
      },
      result('task1', 'done'),
      say('finished'),
      done('t1'),
    ])

    const task = page.getByTestId('tool-block').first()
    await task.locator('.tool-header').first().click()
    const nested = task.locator('[data-testid="tool-block"]').filter({ hasText: 'Read' })
    await toggleIn(nested).click()
    await expect(nested.getByTestId('injected-context-box')).toContainText('SUB-REMINDER')
  })

  // SPEC: chat:added-text-hidden
  test('a reload draws the same triangles and boxes', async ({ page }) => {
    await openSessionWithAPI(page, 'events/stop-hook-feedback.jsonl')
    await page.reload()
    await waitForAppReady(page)

    await expect(page.getByTestId('message-assistant')).not.toContainText('HOOK-MARKER')
    await expect(page.getByTestId('injected-context-toggle')).toHaveCount(2)
  })
})
