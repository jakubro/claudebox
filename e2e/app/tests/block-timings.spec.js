/** E2E tests for block-level timing display. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Block Timings', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: tool:block-timing
  // SPEC: tool:timing-tool
  // SPEC: tool:timing-offset
  test('completed tool blocks show relative offset from turn start', async ({ page }) => {
    await mockSSE(page, 'events/block-timings.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const toolBlocks = page.locator('[data-testid="tool-block"]')
    await expect(toolBlocks.first()).toBeVisible()

    // Read — result 68s after first assistant event (startTime)
    const firstTiming = toolBlocks.nth(0).locator('.block-timing')
    await expect(firstTiming).toBeVisible()
    await expect(firstTiming).toHaveText('@ +1m 8s')

    // Grep — result 102s after first assistant event
    const secondTiming = toolBlocks.nth(1).locator('.block-timing')
    await expect(secondTiming).toBeVisible()
    await expect(secondTiming).toHaveText('@ +1m 42s')
  })

  // SPEC: tool:timing-thinking
  test('thinking blocks show relative offset', async ({ page }) => {
    await mockSSE(page, 'events/block-timings.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Thinking at T+35s from turn start
    const thinkingTiming = page.locator('.thinking-block .block-timing')
    await expect(thinkingTiming).toBeVisible()
    await expect(thinkingTiming).toHaveText('@ +35s')
  })

  // SPEC: tool:timing-style
  test('timing uses muted styling', async ({ page }) => {
    await mockSSE(page, 'events/block-timings.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const timing = page.locator('.block-timing').first()
    await expect(timing).toBeVisible()

    const fontSize = await timing.evaluate(el => getComputedStyle(el).fontSize)
    expect(Number.parseInt(fontSize, 10)).toBeLessThanOrEqual(11)

    // Muted color: dim/gray text (not full white or bright)
    const color = await timing.evaluate(el => getComputedStyle(el).color)
    const colorMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    expect(colorMatch, 'Expected valid color value').toBeTruthy()
    const [, r, g, b] = colorMatch.map(Number)
    // Muted means not fully bright — all channels should be below 200 (dimmed text)
    expect(Math.max(r, g, b), 'Expected muted (non-bright) color').toBeLessThan(200)
  })

  // SPEC: tool:timing-async-skip
  test('async background tasks show no timing', async ({ page }) => {
    await mockSSE(page, 'events/tool-task-background-async.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // Background async task should have no block-timing element
    await expect(toolBlock.locator('.block-timing')).toHaveCount(0)
  })

  // SPEC: tool:timing-live
  test('pending tool shows live-ticking duration', async ({ page }) => {
    await mockSSE(page, 'events/tool-pending.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Pending tool with old timestamp — elapsed well above 30s threshold
    const timing = page.locator('.block-timing')
    await expect(timing).toBeVisible()

    // Capture initial duration text and verify it ticks
    const initialText = await timing.textContent()
    expect(initialText).toBeTruthy()
    await expect.poll(async () => timing.textContent()).not.toBe(initialText)
  })

  // SPEC: tool:timing-live
  test('pending tool shows no timing before 30s threshold', async ({ page }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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

    // Pending tool should be visible
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // Timing should NOT be visible yet (elapsed < 30s)
    await expect(toolBlock.locator('.block-timing')).toHaveCount(0)
  })

  // SPEC: tool:timing-nested
  test('nested blocks show timing relative to parent turn start', async ({ page }) => {
    await mockSSE(page, 'events/block-timings-nested.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Expand the Task block to see nested tools
    const taskBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(taskBlock).toBeVisible()
    await taskBlock.locator('.tool-header-area').click()

    // Second nested tool (Read) result at 36s after turn start — above 30s threshold
    const nestedBlocks = taskBlock.locator('[data-testid="tool-block"].nested')
    const readBlock = nestedBlocks.nth(1)
    const nestedTiming = readBlock.locator('.block-timing')
    await expect(nestedTiming).toBeVisible()
    await expect(nestedTiming).toHaveText('@ +36s')
  })
})
