/** E2E tests for block-level timing display. */

import { expect, test } from '@playwright/test'
import { openLiveSession, openSession } from '../helpers.js'
import { mockAPI } from '../mocks/api.js'

test.describe('Block Timings', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: tool:block-timing
  // SPEC: tool:timing-tool
  // SPEC: tool:timing-offset
  test('completed tool blocks show relative offset from turn start', async ({ page }) => {
    // Read + Edit (not Read + Grep): two read-only calls would collapse into one Lookups panel -
    // see Lookups Details in tools-display.spec.js for that behavior.
    await openSession(page, 'events/block-timings-standalone-tools.jsonl')

    const toolBlocks = page.locator('[data-testid="tool-block"]')
    await expect(toolBlocks.first()).toBeVisible()

    // Read - result 68s after first assistant event (startTime)
    const firstTiming = toolBlocks.nth(0).locator('.block-timing')
    await expect(firstTiming).toBeVisible()
    await expect(firstTiming).toHaveText('@ +1m 8s')

    // Edit - result 102s after first assistant event
    const secondTiming = toolBlocks.nth(1).locator('.block-timing')
    await expect(secondTiming).toBeVisible()
    await expect(secondTiming).toHaveText('@ +1m 42s')
  })

  // SPEC: tool:timing-thinking
  test('thinking blocks show relative offset', async ({ page }) => {
    await openSession(page, 'events/block-timings.jsonl')

    // Thinking at T+35s from turn start
    const thinkingTiming = page.locator('.thinking-block .block-timing')
    await expect(thinkingTiming).toBeVisible()
    await expect(thinkingTiming).toHaveText('@ +35s')
  })

  // SPEC: tool:timing-style
  test('timing uses muted styling', async ({ page }) => {
    await openSession(page, 'events/block-timings.jsonl')

    const timing = page.locator('.block-timing').first()
    await expect(timing).toBeVisible()

    const fontSize = await timing.evaluate(el => getComputedStyle(el).fontSize)
    expect(Number.parseInt(fontSize, 10)).toBeLessThanOrEqual(11)

    const color = await timing.evaluate(el => getComputedStyle(el).color)
    const colorMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    expect(colorMatch, 'Expected valid color value').toBeTruthy()
    const [, r, g, b] = colorMatch.map(Number)
    expect(Math.max(r, g, b), 'Expected muted (non-bright) color').toBeLessThan(200)
  })

  // SPEC: tool:timing-async-skip
  test('async background tasks show no timing', async ({ page }) => {
    await openSession(page, 'events/tool-task-background-async.jsonl')

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    await expect(toolBlock.locator('.block-timing')).toHaveCount(0)
  })

  // SPEC: tool:timing-live
  test('pending tool shows live-ticking duration', async ({ page }) => {
    await openSession(page, 'events/tool-pending.jsonl')

    // Pending tool with old timestamp - elapsed well above 30s threshold
    const timing = page.locator('.block-timing')
    await expect(timing).toBeVisible()

    const initialText = await timing.textContent()
    expect(initialText).toBeTruthy()
    await expect.poll(async () => timing.textContent()).not.toBe(initialText)
  })

  // SPEC: tool:timing-live
  test('pending tool shows no timing before 30s threshold', async ({ page }) => {
    const controller = await openLiveSession(page)

    // Send a pending tool with a very recent timestamp (within 30s)
    const now = new Date().toISOString()
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Read file',
        ts: now,
        turn_id: 'turn_fresh',
        id: 'evt_fresh_1',
        primary: true,
      },
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Read',
        ts: now,
        tool_use_id: 'tool_fresh',
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/test.txt' },
        id: 'evt_fresh_2',
        primary: false,
        is_human: false,
      },
    ])

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // Timing should NOT be visible yet (elapsed < 30s)
    await expect(toolBlock.locator('.block-timing')).toHaveCount(0)
  })

  // SPEC: tool:timing-nested
  test('nested blocks show timing relative to parent turn start', async ({ page }) => {
    await openSession(page, 'events/block-timings-nested.jsonl')

    // Expand the Task block to see nested tools
    const taskBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(taskBlock).toBeVisible()
    await taskBlock.locator('.tool-header-area').click()

    // Second nested tool (Read) result at 36s after turn start - above 30s threshold
    const nestedBlocks = taskBlock.locator('[data-testid="tool-block"].nested')
    const readBlock = nestedBlocks.nth(1)
    const nestedTiming = readBlock.locator('.block-timing')
    await expect(nestedTiming).toBeVisible()
    await expect(nestedTiming).toHaveText('@ +36s')
  })

  test.describe('Clock time on hover', () => {
    /** The browser's own locale format of `iso`, as the app writes it. */
    const localTime = (page, iso) => page.evaluate(t => new Date(t).toLocaleString(), iso)

    // SPEC: tool:timing-hover
    // SPEC: turn:progress-complete-hover
    test('a tool offset and "worked for" show the moment they measure to', async ({ page }) => {
      await openSession(page, 'events/block-timings-standalone-tools.jsonl')

      const toolBlocks = page.locator('[data-testid="tool-block"]')
      const read = toolBlocks.nth(0).locator('.block-timing')
      await expect(read).toHaveText('@ +1m 8s')
      await expect(read).toHaveAttribute('title', await localTime(page, '2025-01-18T12:01:09Z'))
      await expect(toolBlocks.nth(1).locator('.block-timing')).toHaveAttribute(
        'title',
        await localTime(page, '2025-01-18T12:01:43Z'),
      )

      const workedFor = page.locator('.turn-progress-complete span', { hasText: 'worked for' })
      await expect(workedFor).toHaveText('worked for 1m 44s')
      await expect(workedFor).toHaveAttribute(
        'title',
        await localTime(page, '2025-01-18T12:01:45Z'),
      )
    })

    // SPEC: tool:timing-hover
    test('a thinking offset shows the time of that thinking', async ({ page }) => {
      await openSession(page, 'events/block-timings.jsonl')

      const timing = page.locator('.thinking-block .block-timing')
      await expect(timing).toHaveText('@ +35s')
      await expect(timing).toHaveAttribute('title', await localTime(page, '2025-01-18T12:00:36Z'))
    })

    // SPEC: tool:timing-hover
    test("a nested tool's offset shows its own result time", async ({ page }) => {
      await openSession(page, 'events/block-timings-nested.jsonl')

      const taskBlock = page.locator('[data-testid="tool-block"]').first()
      await taskBlock.locator('.tool-header-area').click()
      const timing = taskBlock
        .locator('[data-testid="tool-block"].nested')
        .nth(1)
        .locator('.block-timing')
      await expect(timing).toHaveText('@ +36s')
      await expect(timing).toHaveAttribute('title', await localTime(page, '2025-01-18T12:00:37Z'))
    })

    test("a running tool's live duration carries no tooltip", async ({ page }) => {
      await openSession(page, 'events/tool-pending.jsonl')

      const timing = page.locator('.block-timing')
      await expect(timing).toBeVisible()
      await expect(timing).not.toHaveAttribute('title')
    })
  })
})
