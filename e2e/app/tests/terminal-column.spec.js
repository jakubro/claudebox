/** E2E tests for the chat terminal column: shell-call routing, entries, divider, and the toggle. */

import { expect, test } from '@playwright/test'
import { assertRedColor, resolveOpsPayload, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE, mockSSEDynamic } from '../mocks/sse.js'

test.describe('Terminal Column', () => {
  test.beforeEach(async ({ page }) => {
    // The suite-wide default is off (see mocks/api.js) - this file exercises the split on.
    await mockAPI(page, { sessionUiStateDefaults: { terminalSplitEnabled: true } })
  })

  /**
   * Wait until scrollTop holds across two reads a beat apart - content keeps growing as estimated
   * heights resolve, so an early "before" measurement attributes that growth to the test's action.
   */
  async function waitForStableScrollTop(terminal) {
    let last = null
    await expect
      .poll(async () => {
        const current = await terminal.evaluate(el => el.scrollTop)
        const stable = current === last
        last = current
        return stable
      })
      .toBe(true)
    return last
  }

  // SPEC: chat:terminal-column
  test('the chat content area shows two equal-width columns with a divider between them', async ({
    page,
  }) => {
    await mockSSE(page, 'events/terminal-column-mixed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const transcript = page.locator('.chat-transcript-column')
    const divider = page.locator('[data-testid="chat-split-divider"]')
    const terminal = page.locator('[data-testid="terminal-column"]')
    await expect(transcript).toBeVisible()
    await expect(divider).toBeVisible()
    await expect(terminal).toBeVisible()

    const transcriptBox = await transcript.boundingBox()
    const terminalBox = await terminal.boundingBox()
    expect(Math.abs(transcriptBox.width - terminalBox.width)).toBeLessThan(10)
  })

  test.describe('Routing', () => {
    // SPEC: chat:terminal-column-routing
    test('a shell command appears in the terminal, every other tool call stays in its turn', async ({
      page,
    }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="tool-block"]:has-text("Bash")')).toHaveCount(0)
      await expect(page.locator('[data-testid="tool-block"]:has-text("Read")')).toBeVisible()
      await expect(page.locator('[data-testid="tool-block"]:has-text("Task")')).toBeVisible()
      await expect(page.locator('[data-testid="terminal-entry"]')).toHaveCount(2)
    })

    // SPEC: chat:terminal-column-subagent
    test("a subagent's shell command stays nested in its activity section, absent from the terminal", async ({
      page,
    }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const terminalText = await page.locator('[data-testid="terminal-column"]').innerText()
      expect(terminalText).not.toContain('grep -rn config')

      // A completed Task with nested children auto-collapses - expand it to reach the nested call.
      const taskBlock = page.locator('[data-testid="tool-block"]:has-text("Task")')
      await taskBlock.locator('.tool-header-area').click()
      await expect(taskBlock).toContainText('Grep for config')
    })
  })

  test.describe('Entry shape', () => {
    // SPEC: chat:terminal-entry-shape
    test('an entry shows the description as a comment, then the command, then its output', async ({
      page,
    }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entry = page.locator('[data-testid="terminal-entry"]').first()
      await expect(entry.locator('.terminal-entry-comment')).toHaveText('# Run frontend tests')
      await expect(entry.locator('.terminal-entry-command-line')).toContainText('just test-fe')
      await expect(entry.locator('.terminal-entry-output')).toContainText('2922 passed')
    })

    // SPEC: chat:terminal-entry-shape
    test('an entry with no description starts directly at the command', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entry = page.locator('[data-testid="terminal-entry"]').first()
      await expect(entry).toBeVisible()
      await expect(entry.locator('.terminal-entry-comment')).toHaveCount(0)
    })
  })

  test.describe('Output highlighting', () => {
    // SPEC: chat:terminal-entry-output-highlighting
    test('recognisable output is coloured, the same way an inline block would be', async ({
      page,
    }) => {
      await mockSSE(page, 'events/terminal-column-json-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entry = page.locator('[data-testid="terminal-entry"]').first()
      await expect(entry.locator('.terminal-entry-output code[class*="language-"]')).toBeVisible()
    })

    // SPEC: chat:terminal-entry-output-highlighting
    test('prose output stays plain', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entry = page.locator('[data-testid="terminal-entry"]').filter({
        hasText: 'just test-fe',
      })
      await expect(entry.locator('.terminal-entry-output pre.codeblock-plain')).toBeVisible()
      await expect(entry.locator('.terminal-entry-output code[class*="language-"]')).toHaveCount(0)
    })

    // SPEC: chat:terminal-entry-output-highlighting
    test('markdown-looking output (headings, bullets, a link) stays plain, never formatted', async ({
      page,
    }) => {
      await mockSSE(page, 'events/terminal-column-markdown-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entry = page.locator('[data-testid="terminal-entry"]').first()
      await expect(entry.locator('.terminal-entry-output pre.codeblock-plain')).toBeVisible()
      await expect(entry.locator('.terminal-entry-output code[class*="language-"]')).toHaveCount(0)
      await expect(entry.locator('.terminal-entry-output h2')).toHaveCount(0)
      await expect(entry.locator('.terminal-entry-output a')).toHaveCount(0)
    })
  })

  test.describe('No wrap', () => {
    // SPEC: chat:terminal-entry-no-wrap
    test('a line wider than the column stays one line and scrolls sideways, across highlighted, plain and persisted output', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const wideLine = 'x'.repeat(400)
      const wideJson = JSON.stringify({
        name: 'test',
        count: 42,
        active: true,
        tags: ['a', 'b'],
        nested: { ok: true },
        note: 'x'.repeat(400),
      })
      const persistedBody =
        '<persisted-output>\n' +
        'Output too large (50.0KB). Full output saved to: /tmp/wide-output.txt\n' +
        `Preview (first 2KB):\n${wideLine}\n` +
        '</persisted-output>'

      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'wide output', turn_id: 't1' },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_wide_plain',
          tool_name: 'Bash',
          tool_input: { command: 'echo-wide-plain' },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: wideLine,
          tool_use_id: 'tu_wide_plain',
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_wide_json',
          tool_name: 'Bash',
          tool_input: { command: 'cat-wide-json' },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: wideJson,
          tool_use_id: 'tu_wide_json',
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_wide_persisted',
          tool_name: 'Bash',
          tool_input: { command: 'cat-wide-persisted' },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: persistedBody,
          tool_use_id: 'tu_wide_persisted',
        },
      ])

      const entries = page.locator('[data-testid="terminal-entry"]')
      await expect(entries).toHaveCount(3)

      // The block-level <pre> is what scrolls; overflow-x on the inline <code> is a no-op.
      const plainOutput = entries
        .filter({ hasText: 'echo-wide-plain' })
        .locator('.terminal-entry-output pre')
      const jsonEntry = entries.filter({ hasText: 'cat-wide-json' })
      const jsonOutput = jsonEntry.locator('.terminal-entry-output pre')
      const persistedOutput = entries
        .filter({ hasText: 'cat-wide-persisted' })
        .locator('.tool-details')

      await expect(
        jsonEntry.locator('.terminal-entry-output code[class*="language-"]'),
      ).toBeVisible()

      for (const output of [plainOutput, jsonOutput, persistedOutput]) {
        const box = await output.evaluate(el => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
        }))
        // Wider than visible and one line tall (generous bound covers .tool-details' own
        // padding) - wrapped, a 400-char line would run past 150px at this column width instead.
        expect(box.scrollWidth).toBeGreaterThan(box.clientWidth)
        expect(box.clientHeight).toBeLessThan(50)
      }

      const plainHeightBefore = await plainOutput.evaluate(el => el.clientHeight)

      const divider = page.locator('[data-testid="chat-split-divider"]')
      const handle = await divider.boundingBox()
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + 200, handle.y + handle.height / 2)
      await page.mouse.up()

      const plainHeightAfter = await plainOutput.evaluate(el => el.clientHeight)
      expect(plainHeightAfter).toBe(plainHeightBefore)
    })
  })

  // SPEC: chat:terminal-entry-failure
  test('a failed command is marked on its command line; its output still shows', async ({
    page,
  }) => {
    await mockSSE(page, 'events/terminal-column-mixed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const entries = page.locator('[data-testid="terminal-entry"]')
    const failed = entries.filter({ hasText: 'just build' })
    await expect(failed.locator('.terminal-entry-command-line')).toHaveClass(
      /terminal-entry-failed/,
    )
    await expect(failed.locator('.terminal-entry-output')).toContainText('build failed')
    await assertRedColor(failed.locator('.terminal-entry-command'), 'color')

    const ok = entries.filter({ hasText: 'just test-fe' })
    await expect(ok.locator('.terminal-entry-command-line')).not.toHaveClass(
      /terminal-entry-failed/,
    )
  })

  // SPEC: chat:terminal-entry-shape
  test('the command reads bolder and brighter than its output', async ({ page }) => {
    await mockSSE(page, 'events/terminal-column-mixed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const entry = page.locator('[data-testid="terminal-entry"]').first()
    const command = entry.locator('.terminal-entry-command')
    const output = entry.locator('.terminal-entry-output')

    const [commandWeight, outputWeight, commandColor, outputColor] = await Promise.all([
      command.evaluate(el => Number(getComputedStyle(el).fontWeight)),
      output.evaluate(el => Number(getComputedStyle(el).fontWeight)),
      command.evaluate(el => getComputedStyle(el).color),
      output.evaluate(el => getComputedStyle(el).color),
    ])

    expect(commandWeight).toBeGreaterThan(outputWeight)
    expect(commandColor).not.toBe(outputColor)
  })

  // SPEC: chat:terminal-entry-copy
  // SPEC: chat:terminal-entry-jump
  // SPEC: chat:terminal-entry-controls-position
  test('the jump and copy buttons sit level with the description line when one is present', async ({
    page,
  }) => {
    await mockSSE(page, 'events/terminal-column-mixed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const entry = page.locator('[data-testid="terminal-entry"]').first()
    await entry.hover()

    const [entryBox, firstLineBox, jumpBox, copyBox] = await Promise.all([
      entry.boundingBox(),
      entry.locator('.terminal-entry-comment').boundingBox(),
      entry.locator('.terminal-jump-btn').boundingBox(),
      entry.locator('.terminal-copy-btn').boundingBox(),
    ])

    const firstLineCenter = firstLineBox.y + firstLineBox.height / 2
    expect(Math.abs(jumpBox.y + jumpBox.height / 2 - firstLineCenter)).toBeLessThan(6)
    expect(Math.abs(copyBox.y + copyBox.height / 2 - firstLineCenter)).toBeLessThan(6)
    // No reserved band above the entry - the first line starts at (or right after) the top.
    expect(firstLineBox.y - entryBox.y).toBeLessThan(4)
  })

  // SPEC: chat:terminal-entry-controls-position
  test('the buttons sit level with the command line when there is no description', async ({
    page,
  }) => {
    await mockSSE(page, 'events/tool-bash.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const entry = page.locator('[data-testid="terminal-entry"]').first()
    await entry.hover()

    const [firstLineBox, jumpBox, copyBox] = await Promise.all([
      entry.locator('.terminal-entry-command-line').boundingBox(),
      entry.locator('.terminal-jump-btn').boundingBox(),
      entry.locator('.terminal-copy-btn').boundingBox(),
    ])

    const firstLineCenter = firstLineBox.y + firstLineBox.height / 2
    expect(Math.abs(jumpBox.y + jumpBox.height / 2 - firstLineCenter)).toBeLessThan(6)
    expect(Math.abs(copyBox.y + copyBox.height / 2 - firstLineCenter)).toBeLessThan(6)
  })

  // SPEC: chat:terminal-entry-copy
  test('hovering an entry reveals a copy affordance that copies that command alone', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockSSE(page, 'events/terminal-column-mixed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const entry = page.locator('[data-testid="terminal-entry"]').first()
    await entry.hover()
    const copyBtn = entry.locator('.terminal-copy-btn')
    await expect(copyBtn).toBeVisible()
    await copyBtn.click()

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toBe('just test-fe')
  })

  // SPEC: chat:terminal-entry-running
  test('an entry appears as soon as its command arrives; output fills in once the call lands', async ({
    page,
  }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await controller.sendEvents([
      { type: 'user', subtype: 'text', is_human: true, content: 'run it', turn_id: 't1' },
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: 'tu_run',
        tool_name: 'Bash',
        tool_input: { command: 'sleep 5', description: 'Wait' },
      },
    ])

    const entry = page.locator('[data-testid="terminal-entry"]').first()
    await expect(entry).toBeVisible()
    await expect(entry.locator('.terminal-entry-command-line')).toContainText('sleep 5')
    await expect(page.getByTestId('terminal-entry-pending')).toBeVisible()

    await controller.sendEvents([
      { type: 'assistant', subtype: 'tool_result', content: 'done', tool_use_id: 'tu_run' },
    ])

    await expect(page.getByTestId('terminal-entry-pending')).toHaveCount(0)
    await expect(entry.locator('.terminal-entry-output')).toContainText('done')
  })

  // SPEC: chat:terminal-column-autoscroll
  test('follows new entries at the bottom, stays put once scrolled up', async ({ page }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Enough tall entries to overflow the column, so scroll position is meaningful.
    const fill = Array.from({ length: 15 }, (_, i) => [
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: `tu_fill_${i}`,
        tool_name: 'Bash',
        tool_input: { command: `echo fill-${i}` },
      },
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'line\n'.repeat(10),
        tool_use_id: `tu_fill_${i}`,
      },
    ]).flat()
    await controller.sendEvents([
      { type: 'user', subtype: 'text', is_human: true, content: 'fill it up', turn_id: 't1' },
      ...fill,
    ])

    const terminal = page.locator('[data-testid="terminal-column"]')
    const entries = page.locator('[data-testid="terminal-entry"]')
    // Windowed: the newest fill entry is reachable, but far fewer than 15 are mounted.
    await expect(entries.last()).toContainText('fill-14')
    await expect.poll(() => entries.count()).toBeGreaterThan(0)
    expect(await entries.count()).toBeLessThan(15)
    await expect
      .poll(() => terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
      .toBe(true)

    await controller.sendEvents([
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: 'tu_bottom_follow',
        tool_name: 'Bash',
        tool_input: { command: 'echo bottom-follow' },
      },
    ])
    await expect(entries.last()).toContainText('bottom-follow')
    await expect
      .poll(() => terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
      .toBe(true)

    await terminal.evaluate(el => {
      el.scrollTop = 0
    })
    await terminal.dispatchEvent('scroll')
    await expect.poll(() => terminal.evaluate(el => el.scrollTop)).toBe(0)

    await controller.sendEvents([
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: 'tu_stay_put',
        tool_name: 'Bash',
        tool_input: { command: 'echo stay-put' },
      },
    ])
    // Scrolled away from the bottom: the new entry lands without pulling the view back down.
    await expect.poll(() => terminal.evaluate(el => el.scrollTop)).toBe(0)
  })

  // SPEC: chat:terminal-column-lands-at-end
  test('lands at its newest entry when opening a session that already ran commands', async ({
    page,
  }) => {
    const fill = Array.from({ length: 15 }, (_, i) => [
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: `tu_load_${i}`,
        tool_name: 'Bash',
        tool_input: { command: `echo load-${i}` },
      },
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'line\n'.repeat(10),
        tool_use_id: `tu_load_${i}`,
      },
    ]).flat()
    const events = [
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'run a bunch of commands',
        turn_id: 't1',
      },
      ...fill,
    ]
    await mockSSEDynamic(page, () => events)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const terminal = page.locator('[data-testid="terminal-column"]')
    const entries = page.locator('[data-testid="terminal-entry"]')
    await expect(entries.last()).toContainText('load-14')
    await expect
      .poll(() => terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
      .toBe(true)
  })

  // SPEC: chat:terminal-column-lands-at-end
  test('lands at its newest entry when the view is turned on mid-session, not wherever it was left', async ({
    page,
  }) => {
    await mockAPI(page, { sessionUiStateDefaults: { terminalSplitEnabled: false } })
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const fill = Array.from({ length: 15 }, (_, i) => [
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: `tu_toggle_${i}`,
        tool_name: 'Bash',
        tool_input: { command: `echo toggle-${i}` },
      },
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'line\n'.repeat(10),
        tool_use_id: `tu_toggle_${i}`,
      },
    ]).flat()
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'run a bunch of commands',
        turn_id: 't1',
      },
      ...fill,
    ])
    await expect(page.getByTestId('terminal-column')).toHaveCount(0)

    await page.getByTestId('right-slot-view-terminal').click()

    const terminal = page.locator('[data-testid="terminal-column"]')
    const entries = page.locator('[data-testid="terminal-entry"]')
    await expect(terminal).toBeVisible()
    await expect(entries.last()).toContainText('toggle-14')
    await expect
      .poll(() => terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
      .toBe(true)
  })

  // SPEC: chat:terminal-column-follows-running-output
  test("a running command's output growing in place keeps the view pinned to the bottom", async ({
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
        content: 'run a long command',
        turn_id: 't1',
      },
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: 'tu_growing',
        tool_name: 'Bash',
        tool_input: { command: 'stream output' },
      },
    ])

    const terminal = page.locator('[data-testid="terminal-column"]')
    // Each chunk carries strictly more lines than the last, so the trailing entry's own height -
    // not just its content - grows on every step; a same-height rewrite would not exercise it.
    for (const lineCount of [5, 20, 40]) {
      await controller.sendEvents([
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'line\n'.repeat(lineCount),
          tool_use_id: 'tu_growing',
        },
      ])
      await expect
        .poll(() => terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)
    }
  })

  // SPEC: chat:terminal-column-autoscroll
  test('scrolling up mid-stream latches the view in place; scrolling back down resumes following', async ({
    page,
  }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Enough completed entries to overflow the column before the still-running one arrives -
    // otherwise there is nothing to scroll up from.
    const fill = Array.from({ length: 15 }, (_, i) => [
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: `tu_pad_${i}`,
        tool_name: 'Bash',
        tool_input: { command: `echo pad-${i}` },
      },
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'line\n'.repeat(10),
        tool_use_id: `tu_pad_${i}`,
      },
    ]).flat()
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'run a long command',
        turn_id: 't1',
      },
      ...fill,
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: 'tu_latch',
        tool_name: 'Bash',
        tool_input: { command: 'stream output' },
      },
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'line\n'.repeat(5),
        tool_use_id: 'tu_latch',
      },
    ])

    const terminal = page.locator('[data-testid="terminal-column"]')
    const distanceFromBottom = () =>
      terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    await expect.poll(distanceFromBottom).toBeLessThan(50)

    await terminal.hover()
    await page.mouse.wheel(0, -500)
    await expect.poll(distanceFromBottom).toBeGreaterThan(50)
    const offsetAfterScrollUp = await terminal.evaluate(el => el.scrollTop)

    await controller.sendEvents([
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'line\n'.repeat(40),
        tool_use_id: 'tu_latch',
      },
    ])
    // More output arrives beneath the fold - the latched view does not move to chase it.
    await expect(terminal.evaluate(el => el.scrollTop)).resolves.toBe(offsetAfterScrollUp)

    // Scroll back to the bottom by hand: land the position directly and let the native scroll
    // event carry the re-engagement, the same event handleScroll always reacts to.
    await terminal.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })
    await terminal.dispatchEvent('scroll')
    await expect.poll(distanceFromBottom).toBeLessThan(50)

    await controller.sendEvents([
      {
        type: 'assistant',
        subtype: 'tool_result',
        content: 'line\n'.repeat(60),
        tool_use_id: 'tu_latch',
      },
    ])
    // Following resumed - a further growth step keeps the view pinned again.
    await expect.poll(distanceFromBottom).toBeLessThan(50)
  })

  // SPEC: chat:terminal-column-scope
  test('the terminal shows every shell command since the session started, oldest first', async ({
    page,
  }) => {
    await mockSSE(page, 'events/terminal-column-mixed.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const entries = page.locator('[data-testid="terminal-entry"]')
    await expect(entries).toHaveCount(2)
    const commands = await entries.evaluateAll(nodes =>
      nodes.map(n => n.querySelector('.terminal-entry-command')?.textContent?.trim()),
    )
    expect(commands).toEqual(['just test-fe', 'just build'])
  })

  test.describe('Windowed Rendering', () => {
    // SPEC: chat:terminal-column-offscreen-absent
    test('only entries near the viewport are present in the page', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const fill = Array.from({ length: 20 }, (_, i) => [
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
      ]).flat()
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'fill it up', turn_id: 't1' },
        ...fill,
      ])

      const entries = page.locator('[data-testid="terminal-entry"]')
      await expect(entries.last()).toContainText('win-19')

      await expect.poll(() => entries.count()).toBeGreaterThan(0)
      expect(await entries.count()).toBeLessThan(20)
    })

    // SPEC: chat:terminal-column-offscreen-absent
    test('the column keeps its full scroll height while windowed', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const fill = Array.from({ length: 20 }, (_, i) => [
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: `tu_scroll_${i}`,
          tool_name: 'Bash',
          tool_input: { command: `echo scroll-${i}` },
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'line\n'.repeat(10),
          tool_use_id: `tu_scroll_${i}`,
        },
      ]).flat()
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'fill it up', turn_id: 't1' },
        ...fill,
      ])

      const terminal = page.locator('[data-testid="terminal-column"]')
      await expect(page.locator('[data-testid="terminal-entry"]').last()).toContainText('scroll-19')

      const { scrollHeight, clientHeight } = await terminal.evaluate(el => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }))
      expect(scrollHeight).toBeGreaterThan(clientHeight * 2)
    })
  })

  // SPEC: chat:terminal-column-empty
  test('a session with no shell commands shows the terminal with an empty-state message', async ({
    page,
  }) => {
    await mockSSE(page, 'events/simple-chat.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.getByTestId('terminal-empty')).toHaveText('No commands have run yet.')
  })

  test.describe('Click-to-jump', () => {
    // SPEC: chat:terminal-entry-jump
    test('clicking the jump button scrolls the transcript to the turn that ran it and highlights it', async ({
      page,
    }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const entry = page.locator('[data-testid="terminal-entry"]').first()
      await entry.locator('.terminal-jump-btn').click()

      await expect(page.locator('[data-testid="message-assistant"].jump-highlight')).toBeVisible()
    })

    // SPEC: chat:terminal-entry-jump
    test('selecting text in an entry does not navigate the transcript', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const terminal = page.locator('[data-testid="terminal-column"]')
      const scrollBefore = await terminal.evaluate(el => el.scrollTop)

      const output = page.locator('.terminal-entry-output').first()
      const box = await output.boundingBox()
      await page.mouse.move(box.x + 2, box.y + 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2)
      await page.mouse.up()

      const selectedText = await page.evaluate(() => window.getSelection().toString())
      expect(selectedText.length).toBeGreaterThan(0)
      await expect(page.locator('[data-testid="message-assistant"].jump-highlight')).toHaveCount(0)
      expect(await terminal.evaluate(el => el.scrollTop)).toBe(scrollBefore)
    })
  })

  test.describe('Divider', () => {
    // SPEC: chat:terminal-split-divider
    test('dragging the boundary resizes both columns live', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const divider = page.locator('[data-testid="chat-split-divider"]')
      const before = await page.locator('[data-testid="terminal-column"]').boundingBox()
      const handle = await divider.boundingBox()

      // Ratio = transcript share: dragging left grows the terminal, clamped below the 200px moved.
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x - 200, handle.y + handle.height / 2)
      await page.mouse.up()

      const after = await page.locator('[data-testid="terminal-column"]').boundingBox()
      expect(after.width).toBeGreaterThan(before.width + 80)
    })

    // SPEC: chat:terminal-split-divider-persist
    test('the boundary position is restored after a reload', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const patchedRatios = []
      page.on('request', request => {
        if (request.url().includes('/ui-state') && request.method() === 'PATCH') {
          const resolved = resolveOpsPayload(JSON.parse(request.postData() || '{}'))
          if (resolved.session?.terminalSplitRatio !== undefined) {
            patchedRatios.push(resolved.session.terminalSplitRatio)
          }
        }
      })

      const divider = page.locator('[data-testid="chat-split-divider"]')
      const handle = await divider.boundingBox()
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x - 150, handle.y + handle.height / 2)
      await page.mouse.up()

      const draggedWidth = (await page.locator('[data-testid="terminal-column"]').boundingBox())
        .width

      // The ratio save is debounced - wait for it to actually land before reloading.
      await expect.poll(() => patchedRatios.length).toBeGreaterThan(0)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForAppReady(page)

      const reloadedWidth = (await page.locator('[data-testid="terminal-column"]').boundingBox())
        .width
      expect(Math.abs(reloadedWidth - draggedWidth)).toBeLessThan(5)
    })
  })

  test.describe('Toggle', () => {
    // SPEC: chat:control-terminal-split
    test('the toggle sits in the control bar, pressed when the split is on', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toggle = page.getByTestId('right-slot-view-terminal')
      await expect(toggle).toHaveClass(/pressed/)
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    })

    // SPEC: chat:terminal-split-toggle-off
    // SPEC: tool:bash-terminal-routing
    test('toggling off restores every shell command inline, and the choice survives a reload', async ({
      page,
    }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.getByTestId('right-slot-view-terminal').click()

      await expect(page.locator('[data-testid="terminal-column"]')).toHaveCount(0)
      const bashBlocks = page.locator('[data-testid="tool-block"]:has-text("Bash")')
      await expect(bashBlocks).toHaveCount(2)
      await expect(bashBlocks.first()).toContainText('2922 passed')

      // A single-line result matching the summary starts collapsed - expand for the command.
      await bashBlocks.first().locator('.tool-header-area').click()
      await expect(bashBlocks.first().locator('.tool-command-section')).toBeVisible()

      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForAppReady(page)
      await expect(page.locator('[data-testid="terminal-column"]')).toHaveCount(0)
      await expect(page.getByTestId('right-slot-view-terminal')).not.toHaveClass(/pressed/)
    })

    // SPEC: chat:control-terminal-split
    test('a session that has never had the toggle touched opens unsplit', async ({ page }) => {
      // Overrides this file's beforeEach so a plain mockAPI() reaches the app's real default -
      // Playwright matches routes in reverse registration order.
      await mockAPI(page)
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="terminal-column"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="tool-block"]:has-text("Bash")')).toHaveCount(2)
      const toggle = page.getByTestId('right-slot-view-terminal')
      await expect(toggle).not.toHaveClass(/pressed/)
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    })
  })

  test.describe('Control Bar Division', () => {
    // SPEC: chat:control-bar-divides-with-terminal
    // SPEC: chat:terminal-split-divider-bar
    test('the bar divides at the same x as the column divider', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
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
    test('the division tracks a dragged ratio near a clamped extreme', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const divider = page.locator('[data-testid="chat-split-divider"]')
      const handle = await divider.boundingBox()
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      // Far past either floor - clamped by clampSplitRatio, same as the columns underneath.
      await page.mouse.move(handle.x - 600, handle.y + handle.height / 2)
      await page.mouse.up()

      const left = page.locator('.panel-control-bar-left')
      const newDividerBox = await divider.boundingBox()
      const leftBox = await left.boundingBox()
      expect(Math.abs(leftBox.x + leftBox.width - newDividerBox.x)).toBeLessThan(2)
    })

    // SPEC: chat:terminal-split-divider-bar
    test('the division moves with the divider during a drag, before release', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const divider = page.locator('[data-testid="chat-split-divider"]')
      const left = page.locator('.panel-control-bar-left')
      const handle = await divider.boundingBox()
      const before = (await left.boundingBox()).width

      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x - 150, handle.y + handle.height / 2)
      // Mid-drag, before pointerup - this catches a bar that updates only on release.
      const midDrag = (await left.boundingBox()).width
      await page.mouse.up()

      expect(midDrag).not.toBe(before)
    })

    test.describe('Collapse', () => {
      // SPEC: chat:terminal-split-divider-bar
      test('narrowing below the fit threshold undivides the bar; the toggle stays pressed', async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
        await mockSSE(page, 'events/terminal-column-mixed.jsonl')
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        await expect(page.locator('.panel-control-bar-left')).toBeVisible()

        await page.setViewportSize({ width: 500, height: 800 })

        await expect(page.locator('.panel-control-bar-left')).toHaveCount(0)
        await expect(page.locator('.panel-control-bar')).toHaveCount(1)
        await expect(page.getByTestId('right-slot-view-terminal')).toHaveClass(/pressed/)
      })

      // SPEC: chat:terminal-split-divider-bar
      test('widening restores the division at the persisted ratio, not the default', async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
        await mockSSE(page, 'events/terminal-column-mixed.jsonl')
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)

        const divider = page.locator('[data-testid="chat-split-divider"]')
        const handle = await divider.boundingBox()
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
        await page.mouse.down()
        await page.mouse.move(handle.x - 150, handle.y + handle.height / 2)
        await page.mouse.up()

        const bar = page.locator('.panel-control-bar')
        const left = page.locator('.panel-control-bar-left')
        const draggedRatio = (await left.boundingBox()).width / (await bar.boundingBox()).width

        await page.setViewportSize({ width: 500, height: 800 })
        await expect(page.locator('.panel-control-bar-left')).toHaveCount(0)

        // Same width as before the drag - a fair comparison of ratio, not absolute pixels.
        await page.setViewportSize({ width: 1280, height: 800 })
        await expect(left).toBeVisible()
        const restoredRatio = (await left.boundingBox()).width / (await bar.boundingBox()).width

        expect(Math.abs(restoredRatio - draggedRatio)).toBeLessThan(0.03)
        expect(Math.abs(restoredRatio - 0.5)).toBeGreaterThan(0.05)
      })
    })

    test.describe('Terminal Autoscroll Control', () => {
      const fillCommands = (prefix, count) =>
        Array.from({ length: count }, (_, i) => [
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
            content: 'line\n'.repeat(10),
            tool_use_id: `tu_${prefix}_${i}`,
          },
        ]).flat()

      // SPEC: chat:control-terminal-bottom
      test('scrolling the terminal up disengages only the terminal indicator', async ({ page }) => {
        const controller = await createSSEController(page)
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        await controller.sendEvents([
          { type: 'user', subtype: 'text', is_human: true, content: 'fill it up', turn_id: 't1' },
          ...fillCommands('indep', 15),
        ])

        const terminal = page.locator('[data-testid="terminal-column"]')
        const chatIndicator = page.getByTestId('autoscroll-indicator')
        const terminalIndicator = page.getByTestId('terminal-autoscroll-indicator')
        const distanceFromBottom = () =>
          terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
        // Settled at the bottom first - a wheel event mid-settle races the settle loop's scrolls.
        await expect.poll(distanceFromBottom).toBeLessThan(50)
        await expect(terminalIndicator).toHaveAttribute('aria-pressed', 'true')
        const chatPressedBefore = await chatIndicator.getAttribute('aria-pressed')

        await terminal.hover()
        await page.mouse.wheel(0, -500)

        await expect.poll(() => terminalIndicator.getAttribute('aria-pressed')).toBe('false')
        await expect(chatIndicator).toHaveAttribute('aria-pressed', chatPressedBefore)
      })

      // SPEC: chat:control-terminal-bottom
      test('clicking the terminal control jumps to the newest entry and resumes following', async ({
        page,
      }) => {
        const controller = await createSSEController(page)
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        await controller.sendEvents([
          { type: 'user', subtype: 'text', is_human: true, content: 'fill it up', turn_id: 't1' },
          ...fillCommands('jump', 15),
        ])

        const terminal = page.locator('[data-testid="terminal-column"]')
        const terminalIndicator = page.getByTestId('terminal-autoscroll-indicator')
        const distanceFromBottom = () =>
          terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
        await expect.poll(distanceFromBottom).toBeLessThan(50)

        await terminal.hover()
        await page.mouse.wheel(0, -500)
        await expect.poll(() => terminalIndicator.getAttribute('aria-pressed')).toBe('false')
        await expect.poll(distanceFromBottom).toBeGreaterThan(50)

        await terminalIndicator.click()

        await expect.poll(() => terminalIndicator.getAttribute('aria-pressed')).toBe('true')
        await expect.poll(distanceFromBottom).toBeLessThan(50)
      })

      // SPEC: chat:control-bottom
      test('scrolling the transcript up disengages only the transcript indicator', async ({
        page,
      }) => {
        await mockSSE(page, 'events/long-conversation.jsonl')
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)

        await expect(page.locator('[data-testid="turn-container"]').last()).toBeVisible()
        const messagesContainer = page.locator('[data-testid="chat-messages"]')
        await expect
          .poll(() =>
            messagesContainer.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50),
          )
          .toBe(true)

        const chatIndicator = page.getByTestId('autoscroll-indicator')
        const terminalIndicator = page.getByTestId('terminal-autoscroll-indicator')
        await expect(chatIndicator).toHaveAttribute('aria-pressed', 'true')
        const terminalPressedBefore = await terminalIndicator.getAttribute('aria-pressed')

        await messagesContainer.dispatchEvent('wheel', { deltaY: -500 })

        await expect.poll(() => chatIndicator.getAttribute('aria-pressed')).toBe('false')
        await expect(terminalIndicator).toHaveAttribute('aria-pressed', terminalPressedBefore)
      })
    })

    // SPEC: chat:terminal-split-divider-bar-no-flash
    test('the bar never appears undivided before dividing, on a cold load with the split on', async ({
      page,
    }) => {
      await mockAPI(page, {
        sessionUiStateDefaults: { terminalSplitEnabled: true },
        handlers: {
          getUIState: async route => {
            // Widens the null-hydration window so a same-commit race can't hide the defect.
            await new Promise(resolve => setTimeout(resolve, 200))
            const url = new URL(route.request().url())
            const sessionId = url.searchParams.get('session_id')
            const session = sessionId ? { terminalSplitEnabled: true, terminalSplitRatio: 0.5 } : {}
            await route.fulfill({ json: { global: {}, session } })
          },
        },
      })
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')

      await page.addInitScript(() => {
        window.__bar_samples__ = []
        const observer = new MutationObserver(() => {
          const bar = document.querySelector('.panel-control-bar')
          window.__bar_samples__.push({
            present: !!bar,
            divided: !!bar?.querySelector('.panel-control-bar-left'),
          })
        })
        observer.observe(document.documentElement, { childList: true, subtree: true })
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await expect(page.locator('.panel-control-bar-left')).toBeVisible()

      const samples = await page.evaluate(() => window.__bar_samples__)
      const presentButUndivided = samples.filter(s => s.present && !s.divided)
      expect(presentButUndivided).toEqual([])
    })
  })

  test.describe('Step Navigation', () => {
    /** Fill the terminal with `count` commands, well past what the column shows in one viewport. */
    async function fillTerminal(page, controller, prefix, count) {
      const fill = Array.from({ length: count }, (_, i) => [
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
      ]).flat()
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'fill it up', turn_id: 't1' },
        ...fill,
      ])

      // Autoscroll re-pins on every growth tick, so wait the settle out before driving scroll.
      // The distance check catches the bulk; `waitForStableScrollTop` catches the trailing ticks.
      const terminal = page.locator('[data-testid="terminal-column"]')
      await expect
        .poll(() => terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)
      await waitForStableScrollTop(terminal)
    }

    /**
     * Force the terminal to the very top, retrying the write rather than only the read - a
     * still-engaged autoscroll can silently re-pin a raw `scrollTop = 0` on a short column.
     */
    async function forceScrollToTop(terminal) {
      await expect
        .poll(async () => {
          await terminal.evaluate(el => {
            el.scrollTop = 0
          })
          await terminal.dispatchEvent('scroll')
          return terminal.evaluate(el => el.scrollTop)
        })
        .toBe(0)
    }

    /** The command text of the entry currently at the top of the visible terminal. */
    function topEntryCommand(page) {
      return page.evaluate(() => {
        const terminal = document.querySelector('[data-testid="terminal-column"]')
        const rect = terminal.getBoundingClientRect()
        const entries = [...terminal.querySelectorAll('[data-testid="terminal-entry"]')]
        const visible = entries
          .map(el => ({ el, top: el.getBoundingClientRect().top }))
          .filter(({ top }) => top >= rect.top - 5)
          .sort((a, b) => a.top - b.top)
        return visible[0]?.el.querySelector('.terminal-entry-command')?.textContent ?? null
      })
    }

    // SPEC: chat:control-terminal-prev
    // SPEC: chat:control-terminal-next
    test('up and down controls sit left of the autoscroll control, in the transcript group order', async ({
      page,
    }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const prev = page.getByTestId('terminal-jump-prev')
      const next = page.getByTestId('terminal-jump-next')
      const indicator = page.getByTestId('terminal-autoscroll-indicator')
      await expect(prev).toBeVisible()
      await expect(next).toBeVisible()
      const prevBox = await prev.boundingBox()
      const nextBox = await next.boundingBox()
      const indicatorBox = await indicator.boundingBox()
      expect(prevBox.x).toBeLessThan(nextBox.x)
      expect(nextBox.x).toBeLessThan(indicatorBox.x)
    })

    // SPEC: chat:terminal-column-step
    test('clicking down, then up, steps the terminal one entry at a time', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillTerminal(page, controller, 'btn', 25)

      const terminal = page.locator('[data-testid="terminal-column"]')
      await expect.poll(() => topEntryCommand(page)).not.toBeNull()

      await forceScrollToTop(terminal)
      await expect.poll(() => topEntryCommand(page)).toBe('echo btn-0')

      await page.getByTestId('terminal-jump-next').click()
      await expect.poll(() => topEntryCommand(page)).toBe('echo btn-1')

      await page.getByTestId('terminal-jump-next').click()
      await expect.poll(() => topEntryCommand(page)).toBe('echo btn-2')

      await page.getByTestId('terminal-jump-prev').click()
      await expect.poll(() => topEntryCommand(page)).toBe('echo btn-1')
    })

    // SPEC: shortcut:alt-pageup
    // SPEC: shortcut:alt-pagedown
    test('Alt+PageDown and Alt+PageUp do the same as the buttons, from anywhere in the app', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillTerminal(page, controller, 'key', 25)

      const terminal = page.locator('[data-testid="terminal-column"]')
      await expect.poll(() => topEntryCommand(page)).not.toBeNull()
      await forceScrollToTop(terminal)
      await expect.poll(() => topEntryCommand(page)).toBe('echo key-0')

      await page.keyboard.press('Alt+PageDown')
      await expect.poll(() => topEntryCommand(page)).toBe('echo key-1')

      await page.keyboard.press('Alt+PageUp')
      await expect.poll(() => topEntryCommand(page)).toBe('echo key-0')
    })

    // SPEC: shortcut:jump-viewport
    test('reaches an entry that was never on screen, stepping down repeatedly from the top', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillTerminal(page, controller, 'reach', 30)

      const terminal = page.locator('[data-testid="terminal-column"]')
      await expect.poll(() => topEntryCommand(page)).not.toBeNull()
      await forceScrollToTop(terminal)
      await expect.poll(() => topEntryCommand(page)).toBe('echo reach-0')

      for (let i = 0; i < 15; i++) {
        await page.getByTestId('terminal-jump-next').click()
        await expect.poll(() => topEntryCommand(page)).toBe(`echo reach-${i + 1}`)
      }
    })

    // SPEC: chat:terminal-column-step
    test('stepping to an entry flashes it', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillTerminal(page, controller, 'flash', 20)

      await page.getByTestId('terminal-jump-prev').click()

      await expect
        .poll(() => page.evaluate(() => document.querySelectorAll('.jump-highlight').length))
        .toBeGreaterThan(0)
    })

    // SPEC: chat:terminal-column-step
    test('stepping past the last entry settles at the end; past the first stays at the top', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      // Enough entries that the trailing one has room to be top-aligned - on a short column that
      // destination is unreachable, so the fallback this test targets never fires.
      await fillTerminal(page, controller, 'end', 20)

      const terminal = page.locator('[data-testid="terminal-column"]')
      const distanceFromBottom = () =>
        terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
      await expect.poll(distanceFromBottom).toBeLessThan(50)

      // "Past the last entry" means landing on the trailing entry while it is already at the top -
      // reach it by stepping down, not by a raw scrollTop=scrollHeight write.
      await forceScrollToTop(terminal)
      // More steps than there are entries - guarantees reaching the true end regardless of exact
      // count, since every step past it is a no-op fallback (settle + re-engage), not a failure.
      for (let i = 0; i < 22; i++) {
        await page.getByTestId('terminal-jump-next').click()
      }
      await expect.poll(distanceFromBottom).toBeLessThan(50)
      await expect(page.getByTestId('terminal-autoscroll-indicator')).toHaveAttribute(
        'aria-pressed',
        'true',
      )

      await forceScrollToTop(terminal)

      // Already at the top - one more up stays there.
      await page.getByTestId('terminal-jump-prev').click()
      await expect.poll(() => terminal.evaluate(el => el.scrollTop)).toBe(0)
    })

    // SPEC: shortcut:right-column-no-ends
    test('the terminal group has no jump-to-top or jump-to-end control', async ({ page }) => {
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // prev, next, autoscroll indicator, overview toggle - no jump-to-top/jump-to-end pair.
      const right = page.locator('.panel-control-bar-right')
      await expect(right.locator('button')).toHaveCount(4)
    })

    test.describe('Isolation', () => {
      // SPEC: chat:autoscroll-disable
      test('Alt+Up/Down move the transcript and leave the terminal untouched', async ({ page }) => {
        const controller = await createSSEController(page)
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        await fillTerminal(page, controller, 'iso1', 20)

        const terminal = page.locator('[data-testid="terminal-column"]')
        const terminalOffset = await waitForStableScrollTop(terminal)
        const terminalIndicator = page.getByTestId('terminal-autoscroll-indicator')
        const terminalPressedBefore = await terminalIndicator.getAttribute('aria-pressed')

        await page.keyboard.press('Alt+ArrowUp')
        await page.keyboard.press('Alt+ArrowDown')

        expect(await terminal.evaluate(el => el.scrollTop)).toBe(terminalOffset)
        await expect(terminalIndicator).toHaveAttribute('aria-pressed', terminalPressedBefore)
      })

      // SPEC: shortcut:alt-pageup
      test('Alt+PageUp/PageDown move the terminal and leave the transcript untouched', async ({
        page,
      }) => {
        const controller = await createSSEController(page)
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        await fillTerminal(page, controller, 'iso2', 20)

        const messagesContainer = page.locator('[data-testid="chat-messages"]')
        const chatOffsetBefore = await messagesContainer.evaluate(el => el.scrollTop)
        const chatIndicator = page.getByTestId('autoscroll-indicator')
        const chatPressedBefore = await chatIndicator.getAttribute('aria-pressed')

        await page.keyboard.press('Alt+PageUp')
        await page.keyboard.press('Alt+PageDown')

        expect(await messagesContainer.evaluate(el => el.scrollTop)).toBe(chatOffsetBefore)
        await expect(chatIndicator).toHaveAttribute('aria-pressed', chatPressedBefore)
      })

      // SPEC: chat:autoscroll-disable
      test('Alt+PageUp from inside the transcript steps the terminal and leaves the transcript following', async ({
        page,
      }) => {
        const controller = await createSSEController(page)
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        await fillTerminal(page, controller, 'iso3', 20)

        // Focus lands inside .chat-messages, the exact path the Alt gate exists for: the keydown
        // would otherwise bubble through the scroll-intent listener first.
        const chatIndicator = page.getByTestId('autoscroll-indicator')
        await expect(chatIndicator).toHaveAttribute('aria-pressed', 'true')
        const turn = page.locator('[data-testid="turn-container"]').last()
        await turn.click()

        const messagesContainer = page.locator('[data-testid="chat-messages"]')
        const chatOffsetBefore = await messagesContainer.evaluate(el => el.scrollTop)
        const terminal = page.locator('[data-testid="terminal-column"]')
        const terminalOffsetBefore = await terminal.evaluate(el => el.scrollTop)

        await page.keyboard.press('Alt+PageUp')

        expect(await messagesContainer.evaluate(el => el.scrollTop)).toBe(chatOffsetBefore)
        await expect(chatIndicator).toHaveAttribute('aria-pressed', 'true')
        await expect
          .poll(() => terminal.evaluate(el => el.scrollTop))
          .not.toBe(terminalOffsetBefore)

        // The transcript is still genuinely following - a further token still lands in view.
        await controller.sendEvents([
          {
            type: 'user',
            subtype: 'text',
            is_human: true,
            content: 'still following?',
            turn_id: 't2',
          },
          { type: 'assistant', subtype: 'text', content: 'yes', turn_id: 't2' },
        ])
        await expect
          .poll(() =>
            messagesContainer.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50),
          )
          .toBe(true)
      })
    })

    // SPEC: shortcut:alt-pagedown
    test('the composer keeps focus and its caret position across Alt+PageDown', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillTerminal(page, controller, 'composer', 10)

      const textarea = page.locator('.chat-input textarea')
      await textarea.click()
      await textarea.fill('hello world')
      await textarea.evaluate(el => el.setSelectionRange(5, 5))

      await page.keyboard.press('Alt+PageDown')

      await expect(textarea).toBeFocused()
      const selection = await textarea.evaluate(el => [el.selectionStart, el.selectionEnd])
      expect(selection).toEqual([5, 5])
    })

    test.describe('No navigable column', () => {
      // SPEC: shortcut:alt-pageup
      test('split off - Alt+PageUp/PageDown do nothing and the transcript does not move', async ({
        page,
      }) => {
        await mockAPI(page, { sessionUiStateDefaults: { terminalSplitEnabled: false } })
        await mockSSE(page, 'events/long-conversation.jsonl')
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)

        const messagesContainer = page.locator('[data-testid="chat-messages"]')
        // Autoscroll keeps re-pinning while turn heights settle - wait it out before measuring, or
        // that ongoing settle (not a keypress leak) would explain any observed scrollTop change.
        const before = await waitForStableScrollTop(messagesContainer)

        await page.keyboard.press('Alt+PageUp')
        await page.keyboard.press('Alt+PageDown')

        expect(await messagesContainer.evaluate(el => el.scrollTop)).toBe(before)
      })

      // SPEC: shortcut:alt-pageup
      test('a session with no shell commands - Alt+PageUp/PageDown do nothing', async ({
        page,
      }) => {
        await mockSSE(page, 'events/simple-chat.jsonl')
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)

        await expect(page.getByTestId('terminal-empty')).toBeVisible()

        // A throw here fails the test on its own - no separate assertion needed.
        await page.keyboard.press('Alt+PageUp')
        await page.keyboard.press('Alt+PageDown')
        await expect(page.getByTestId('terminal-empty')).toBeVisible()
      })
    })
  })

  test.describe('Overview', () => {
    const BASE_TS = Date.parse('2024-01-01T00:00:00.000Z')
    const iso = ms => new Date(BASE_TS + ms).toISOString()

    /** Four entries covering every bar state: fast/short, slow/tall, failed, still running. */
    async function seedOverviewEntries(page, controller) {
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'seed', turn_id: 't1' },
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
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'tu_slow',
          tool_name: 'Bash',
          tool_input: { command: 'echo slow' },
          ts: iso(1000),
        },
        {
          type: 'assistant',
          subtype: 'tool_result',
          content: 'line1\nline2\nline3\nline4\nline5',
          tool_use_id: 'tu_slow',
          ts: iso(61000),
        },
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
          type: 'assistant',
          subtype: 'tool_result',
          content: 'boom',
          tool_use_id: 'tu_fail',
          is_error: true,
          ts: iso(62500),
        },
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
      await expect(page.locator('[data-testid="terminal-entry"]')).toHaveCount(4)
    }

    /** Enough entries that the column has genuine scroll room, for click/drag/viewport tests. */
    async function fillOverviewColumn(page, controller, count) {
      const fill = Array.from({ length: count }, (_, i) => [
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
      ]).flat()
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'fill it up', turn_id: 't1' },
        ...fill,
      ])
      const terminal = page.locator('[data-testid="terminal-column"]')
      await expect
        .poll(() => terminal.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50))
        .toBe(true)
      await waitForStableScrollTop(terminal)
    }

    // SPEC: chat:control-terminal-minimap
    test('a map toggle sits rightmost in the terminal group', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewEntries(page, controller)

      const toggle = page.getByTestId('terminal-minimap-toggle')
      const indicator = page.getByTestId('terminal-autoscroll-indicator')
      await expect(toggle).toBeVisible()
      const toggleBox = await toggle.boundingBox()
      const indicatorBox = await indicator.boundingBox()
      expect(toggleBox.x).toBeGreaterThan(indicatorBox.x)
    })

    // SPEC: chat:terminal-minimap
    test('one bar per command, oldest at the top, in column order', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewEntries(page, controller)

      await expect(page.locator('[data-testid="terminal-minimap-bar"]')).toHaveCount(4)
    })

    // SPEC: chat:terminal-minimap-no-segments
    test('has no segments or human-message lines - those are transcript-only concepts', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewEntries(page, controller)

      const overview = page.getByTestId('terminal-minimap')
      await expect(overview.locator('[data-testid="minimap-segment"]')).toHaveCount(0)
      await expect(overview.locator('[data-testid="minimap-human-line"]')).toHaveCount(0)
    })

    // SPEC: chat:terminal-minimap-bar-height
    test('a bar with more output is taller than one with less', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewEntries(page, controller)

      const bars = page.locator('[data-testid="terminal-minimap-bar"]')
      const heights = await bars.evaluateAll(els => els.map(el => Number.parseFloat(el.style.flex)))
      expect(heights[1]).toBeGreaterThan(heights[0])
    })

    // SPEC: chat:terminal-minimap-bar-width
    test('a slower command is visibly wider, within the shared 8-20px range', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewEntries(page, controller)

      const bars = page.locator('[data-testid="terminal-minimap-bar"]')
      const widths = await bars.evaluateAll(els => els.map(el => Number.parseFloat(el.style.width)))
      expect(widths[1]).toBeGreaterThan(widths[0])
      for (const width of widths) {
        expect(width).toBeGreaterThanOrEqual(8)
        expect(width).toBeLessThanOrEqual(20)
      }
    })

    // SPEC: chat:terminal-minimap-bar-status
    // SPEC: chat:terminal-column-failure-visible-in-overview
    test('a failed command is coloured apart from passing and still-running ones', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewEntries(page, controller)

      const bars = page.locator('[data-testid="terminal-minimap-bar"]')
      await expect(bars.nth(0)).toHaveClass(/terminal-minimap-bar-passed/)
      await expect(bars.nth(2)).toHaveClass(/terminal-minimap-bar-failed/)
      await expect(bars.nth(3)).toHaveClass(/terminal-minimap-bar-running/)

      const [passedColor, failedColor, runningColor] = await Promise.all(
        [0, 2, 3].map(i => bars.nth(i).evaluate(el => getComputedStyle(el).backgroundColor)),
      )
      expect(failedColor).not.toBe(passedColor)
      expect(runningColor).not.toBe(passedColor)
      expect(runningColor).not.toBe(failedColor)
    })

    // SPEC: chat:terminal-minimap-shared-behavior
    test('clicking the overview jumps the terminal to that position', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillOverviewColumn(page, controller, 25)

      const terminal = page.locator('[data-testid="terminal-column"]')
      await terminal.evaluate(el => {
        el.scrollTop = 0
      })
      await expect.poll(() => terminal.evaluate(el => el.scrollTop)).toBe(0)

      const overview = page.getByTestId('terminal-minimap')
      const box = await overview.boundingBox()
      await overview.click({ position: { x: box.width / 2, y: box.height - 10 } })

      await expect.poll(() => terminal.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    })

    // SPEC: chat:terminal-minimap-shared-behavior
    test('dragging the overview scrolls the terminal continuously', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillOverviewColumn(page, controller, 25)

      const terminal = page.locator('[data-testid="terminal-column"]')
      await terminal.evaluate(el => {
        el.scrollTop = 0
      })
      await expect.poll(() => terminal.evaluate(el => el.scrollTop)).toBe(0)

      const overview = page.getByTestId('terminal-minimap')
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

      await expect.poll(() => terminal.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    })

    // SPEC: chat:terminal-minimap-shared-behavior
    test('the viewport marker is present and slides as the terminal scrolls', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await fillOverviewColumn(page, controller, 25)

      const terminal = page.locator('[data-testid="terminal-column"]')
      const thumb = page.getByTestId('terminal-minimap-viewport')
      await expect(thumb).toBeAttached()

      // Retries the WRITE, not just the read - still-engaged autoscroll can silently re-pin a
      // one-shot scrollTop=0 while content is settling. See forceScrollToTop above.
      await expect
        .poll(async () => {
          await terminal.evaluate(el => {
            el.scrollTop = 0
          })
          return terminal.evaluate(el => el.scrollTop)
        })
        .toBe(0)
      // The thumb's own style updates a beat after the scroll write lands (native scroll event ->
      // controller -> React state -> DOM) - wait for it to stop moving before trusting its value.
      let topBefore = null
      await expect
        .poll(async () => {
          const current = await thumb.evaluate(el => Number.parseFloat(getComputedStyle(el).top))
          const stable = current === topBefore
          topBefore = current
          return stable
        })
        .toBe(true)

      await terminal.evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      await expect
        .poll(() => thumb.evaluate(el => Number.parseFloat(getComputedStyle(el).top)))
        .toBeGreaterThan(topBefore)
    })

    // SPEC: chat:terminal-minimap-independent
    test('toggling the terminal overview leaves the transcript overview untouched', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewEntries(page, controller)

      const transcriptOverview = page.locator('.minimap-overlay')
      await expect(transcriptOverview).toHaveClass(/visible/)

      await page.getByTestId('terminal-minimap-toggle').click()

      await expect(page.getByTestId('terminal-minimap-toggle')).not.toHaveClass(/pressed/)
      await expect(transcriptOverview).toHaveClass(/visible/)
      await expect(page.getByTestId('control-minimap-toggle')).toHaveClass(/pressed/)
    })

    // SPEC: chat:terminal-minimap-independent
    test('each overview persists its own pin state across a reload', async ({ page }) => {
      await mockAPI(page, {
        sessionUiStateDefaults: { terminalSplitEnabled: true, terminalMinimapPinned: false },
      })
      await mockSSE(page, 'events/terminal-column-mixed.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByTestId('terminal-minimap-toggle')).not.toHaveClass(/pressed/)
      await expect(page.getByTestId('control-minimap-toggle')).toHaveClass(/pressed/)
    })

    // SPEC: chat:terminal-minimap
    test('turning the split off removes the terminal overview; the transcript keeps its own', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await seedOverviewEntries(page, controller)

      await expect(page.getByTestId('terminal-minimap')).toBeVisible()

      await page.getByTestId('right-slot-view-terminal').click()

      await expect(page.getByTestId('terminal-minimap')).not.toBeAttached()
      await expect(page.locator('.minimap-overlay')).toHaveClass(/visible/)
    })

    // SPEC: chat:terminal-minimap
    test('a session with no shell commands shows no terminal overview', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByTestId('terminal-empty')).toBeVisible()
      await expect(page.getByTestId('terminal-minimap')).not.toBeAttached()
    })
  })
})
