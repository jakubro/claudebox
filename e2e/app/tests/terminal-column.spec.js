/** E2E tests for the chat terminal column: shell-call routing, entries, divider, and the toggle. */

import { expect, test } from '@playwright/test'
import { assertRedColor, resolveOpsPayload, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Terminal Column', () => {
  test.beforeEach(async ({ page }) => {
    // The suite-wide default is off (see mocks/api.js) - this file exercises the split on.
    await mockAPI(page, { sessionUiStateDefaults: { terminalSplitEnabled: true } })
  })

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

      const toggle = page.getByTestId('terminal-split-toggle')
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

      await page.getByTestId('terminal-split-toggle').click()

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
      await expect(page.getByTestId('terminal-split-toggle')).not.toHaveClass(/pressed/)
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
      const toggle = page.getByTestId('terminal-split-toggle')
      await expect(toggle).not.toHaveClass(/pressed/)
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    })
  })
})
