/** E2E tests for span-anchored inline replies (durable highlight + floating reply composers). */

import { expect, test } from '@playwright/test'
import { disableAutoCollapse, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController } from '../mocks/sse.js'

const ASSISTANT_TEXT = 'The runtime embeds the context window size.'

/** Seed a session with one completed assistant turn whose text can be selected. */
async function seedAssistantTurn(page) {
  const controller = await createSSEController(page)
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)
  await controller.sendEvents([
    {
      type: 'user',
      subtype: 'text',
      content: 'Hello',
      is_human: true,
      timestamp: Date.now(),
      turn_id: 'turn_001',
    },
    { type: 'assistant', subtype: 'text', content: ASSISTANT_TEXT, timestamp: Date.now() + 100 },
    { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() + 200 },
  ])
  await expect(page.locator('[data-testid="message-assistant"]').first()).toContainText(
    'context window',
  )
  await disableAutoCollapse(page)
}

/** Select a substring inside the first assistant message and fire a real selectionchange. */
async function selectAssistantText(page, substring) {
  await page.evaluate(sub => {
    const msg = document.querySelector('[data-testid="message-assistant"]')
    const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const idx = node.textContent.indexOf(sub)
      if (idx >= 0) {
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + sub.length)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        return
      }
      node = walker.nextNode()
    }
  }, substring)
}

/** Quote a substring: select assistant text, then click the quote affordance. Retries as a unit since a concurrently-settling layout can transiently clear the affordance. */
async function quote(page, substring) {
  const affordance = page.locator('[data-testid="quote-affordance"]')
  await expect(async () => {
    await selectAssistantText(page, substring)
    await affordance.click({ timeout: 1500 })
  }).toPass({ timeout: 15000, intervals: [200, 400, 800] })
}

/** Viewport centre point of a quoted span in the transcript (the CSS highlight has no element). */
async function spanCenter(page, substring) {
  return page.evaluate(sub => {
    const msg = document.querySelector('[data-testid="message-assistant"]')
    const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const idx = node.textContent.indexOf(sub)
      if (idx >= 0) {
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + sub.length)
        const r = range.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }
      node = walker.nextNode()
    }
    return null
  }, substring)
}

/** Click the centre of a quoted span in the transcript. */
async function clickQuotedSpan(page, substring) {
  const point = await spanCenter(page, substring)
  await page.mouse.click(point.x, point.y)
}

/** Number of painted inline-quote highlight ranges (0 when the API is unsupported). */
function highlightRangeCount(page) {
  return page.evaluate(() =>
    typeof CSS !== 'undefined' && CSS.highlights?.has('inline-quote')
      ? CSS.highlights.get('inline-quote').size
      : 0,
  )
}

test.describe('Inline Replies (floating composer)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: chat:inline-replies-quote
  // SPEC: chat:inline-replies-highlight
  // SPEC: chat:selection-not-preempted
  test('quoting paints a durable highlight and opens a floating reply composer', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    await selectAssistantText(page, 'context window')
    const affordance = page.locator('[data-testid="quote-affordance"]')
    await expect(affordance).toBeVisible()
    await affordance.click()

    // A floating composer opens (portaled to <body>), pre-filled with the quote + source, editable.
    const float = page.locator('.inline-float')
    await expect(float).toBeVisible()
    await expect(float.locator('[data-testid="inline-thread"]')).toContainText('context window')
    await expect(float.locator('[data-testid="inline-thread"]')).toContainText('assistant')
    await expect(float.locator('[data-testid="inline-thread-input"]')).toBeVisible()

    // No in-transcript dock, no right-hand side bar.
    await expect(page.locator('.chat-messages [data-testid="inline-thread"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="inline-replies-bar"]')).toHaveCount(0)

    await expect.poll(() => highlightRangeCount(page)).toBe(1)
  })

  // SPEC: chat:inline-replies-buffer
  test('replies accumulate as floats; unsent are editable and deletable (clearing the highlight)', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    await quote(page, 'runtime')
    await quote(page, 'context window')
    // Both freshly-quoted floats stay pinned open.
    await expect(page.locator('.inline-float')).toHaveCount(2)
    await expect.poll(() => highlightRangeCount(page)).toBe(2)

    const firstInput = page.locator('[data-testid="inline-thread-input"]').first()
    await firstInput.fill('my first reply')
    await expect(firstInput).toHaveValue('my first reply')

    await page.locator('[data-testid="inline-thread-delete"]').first().click()
    await expect(page.locator('.inline-float')).toHaveCount(1)
    await expect.poll(() => highlightRangeCount(page)).toBe(1)
  })

  // SPEC: chat:inline-replies-send
  // SPEC: chat:inline-replies-placeholder-only
  test('sending posts the anchored payload and leaves a read-only reply at its highlight + a turn placeholder', async ({
    page,
  }) => {
    const sendCalls = []
    await page.route('**/api/send', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill('how big is it?')
    await page.locator('[data-testid="inline-thread-input"]').first().press('Enter')

    // POST carries the anchored pair; backend strips anchors from the Claude wire, never the placeholder.
    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    const reply = sendCalls[0].inline_replies[0]
    expect(reply).toMatchObject({
      quote: 'context window',
      from: 'assistant',
      response: 'how big is it?',
      turnId: 'turn_001',
    })
    expect(reply).toHaveProperty('offset')
    expect(JSON.stringify(sendCalls[0])).not.toContain('Replied inline')

    // The send-turn shows the compact placeholder, expandable in place.
    const placeholderBtn = page.locator('[data-testid="inline-replies-placeholder"]')
    await expect(placeholderBtn).toContainText('Replied inline - 1 comment')
    await placeholderBtn.click()
    await expect(page.locator('.inline-reply-response')).toContainText('how big is it?')

    // The editing float closed on send; the sent reply's highlight persists and shows read-only when clicked.
    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect.poll(() => highlightRangeCount(page)).toBe(1)
    await clickQuotedSpan(page, 'context window')
    const sentThread = page.locator('.inline-float [data-testid="inline-thread"].sent')
    await expect(sentThread).toContainText('how big is it?')
    await expect(page.locator('.inline-float [data-testid="inline-thread-input"]')).toHaveCount(0)
  })

  // SPEC: chat:inline-replies-editing-keys
  test('the reply box supports the same text-editing keys as the message box', async ({ page }) => {
    await seedAssistantTurn(page)
    await quote(page, 'context window')

    const input = page.locator('[data-testid="inline-thread-input"]').first()
    await input.fill('hello world')
    await input.evaluate(el => el.setSelectionRange(6, 11)) // "world"
    await input.press('Control+,')
    await expect(input).toHaveValue('hello <this>world</this>')

    await input.fill('- item one')
    await input.evaluate(el => el.setSelectionRange(10, 10))
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('- item one\n- ')
  })

  // SPEC: chat:inline-replies-editing-excluded
  test('history, stash, and slash autocomplete stay with the message box, not the reply', async ({
    page,
  }) => {
    await seedAssistantTurn(page)
    await quote(page, 'context window')

    const input = page.locator('[data-testid="inline-thread-input"]').first()
    await input.fill('/implement')
    await expect(input).toHaveValue('/implement')
    await expect(page.locator('.command-autocomplete')).toHaveCount(0)

    // Arrow keys move the caret rather than loading composer history.
    await input.press('ArrowUp')
    await expect(input).toHaveValue('/implement')
  })

  // SPEC: chat:inline-replies-collapse-expands-on-send
  test('a collapsed block in a reply is delivered in full, never as a placeholder', async ({
    page,
  }) => {
    const sendCalls = []
    await page.route('**/api/send', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await seedAssistantTurn(page)
    await quote(page, 'context window')

    const input = page.locator('[data-testid="inline-thread-input"]').first()
    await input.fill('<notes>full detail here</notes>')
    await input.evaluate(el => el.setSelectionRange(3, 3))
    await input.press("Control+'")
    await expect(input).toHaveValue(/<notes\.\.\.\d+>/)

    await input.press('Enter')

    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0].inline_replies[0].response).toBe('<notes>full detail here</notes>')
  })

  // SPEC: chat:inline-replies-float
  test('the reply lives in a floating composer: close collapses to the highlight, click re-opens it', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    // Quoting opens a pinned, editable float.
    await quote(page, 'context window')
    const float = page.locator('.inline-float')
    await expect(float).toBeVisible()
    await float.locator('[data-testid="inline-thread-input"]').fill('draft reply')

    // Closing a float that has text collapses it to just the highlight (reply stays buffered).
    await float.locator('[data-testid="inline-thread-close"]').click()
    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect.poll(() => highlightRangeCount(page)).toBe(1)

    // Clicking the highlight re-opens the float with the buffered reply.
    await clickQuotedSpan(page, 'context window')
    await expect(page.locator('.inline-float [data-testid="inline-thread-input"]')).toHaveValue(
      'draft reply',
    )

    // Closing an empty float discards the quote and its highlight.
    await page.locator('[data-testid="inline-thread-input"]').fill('')
    await page.locator('[data-testid="inline-thread-close"]').click()
    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect.poll(() => highlightRangeCount(page)).toBe(0)
  })

  test('a float hides when its source turn is collapsed by auto-collapse', async ({ page }) => {
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        content: 'Hello',
        is_human: true,
        timestamp: Date.now(),
        turn_id: 'turn_001',
      },
      { type: 'assistant', subtype: 'text', content: ASSISTANT_TEXT, timestamp: Date.now() + 100 },
      { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() + 200 },
    ])
    await expect(page.locator('[data-testid="message-assistant"]').first()).toContainText(
      'context window',
    )
    // Auto-collapse stays ON: the assistant turn is last, so it is expanded and quotable.

    await quote(page, 'context window')
    await expect(page.locator('.inline-float')).toBeInViewport()

    // A new turn arrives -> auto-collapse collapses the now-non-last source turn (not exempted).
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        content: 'Another',
        is_human: true,
        timestamp: Date.now() + 300,
        turn_id: 'turn_002',
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'A second answer.',
        timestamp: Date.now() + 400,
      },
      { type: 'result', subtype: 'success', turn_id: 'turn_002', timestamp: Date.now() + 500 },
    ])

    // The source span is hidden by the collapse, so its float leaves the screen.
    await expect(page.locator('.inline-float')).not.toBeInViewport()
  })

  test('typing quickly into a float preserves the text (controlled, live value - no lag)', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    const input = page.locator('[data-testid="inline-thread-input"]').first()
    await input.pressSequentially('the quick brown fox', { delay: 0 })
    await expect(input).toHaveValue('the quick brown fox')
  })

  // SPEC: chat:inline-replies-send
  test('a char-by-char typed reply is attached when sending via the main composer', async ({
    page,
  }) => {
    const sendCalls = []
    await page.route('**/api/send', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await seedAssistantTurn(page)

    // Type the reply char-by-char in the float (the path the value-lag corrupted).
    await quote(page, 'context window')
    await page
      .locator('[data-testid="inline-thread-input"]')
      .first()
      .pressSequentially('typed reply', { delay: 0 })

    // Send from the MAIN composer (not Enter-in-float): the buffered reply must ride along.
    const composer = page.locator('[data-testid="chat-input"]')
    await composer.click()
    await composer.pressSequentially('main message', { delay: 0 })
    await composer.press('Enter')

    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0]).toMatchObject({ prompt: 'main message' })
    expect(sendCalls[0].inline_replies?.[0]).toMatchObject({
      quote: 'context window',
      response: 'typed reply',
    })
  })

  // SPEC: chat:inline-replies-float
  test('hovering a highlight shows a transient float with a pointer cursor and dismisses on leave', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    // Quote, type, then close (with text) -> collapses to just the highlight; the reply is buffered.
    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill('draft')
    await page.locator('[data-testid="inline-thread-close"]').click()
    await expect(page.locator('.inline-float')).toHaveCount(0)

    // Hovering the highlighted span shows a transient float and a pointer cursor (matching path links).
    const point = await spanCenter(page, 'context window')
    await page.mouse.move(point.x, point.y)
    await expect(page.locator('.inline-float')).toBeVisible()
    await expect
      .poll(() => page.locator('.chat-messages').evaluate(el => getComputedStyle(el).cursor))
      .toBe('pointer')

    // The transient float was never pinned (no stolen focus), so it dismisses when the pointer leaves.
    await page.mouse.move(point.x, point.y - 200)
    await expect(page.locator('.inline-float')).toHaveCount(0)
  })

  // SPEC: chat:inline-replies-float
  // SPEC: chat:inline-replies-highlight
  test('clicking a highlight toggles its reply box shut, and hover does not reopen it under the pointer', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    // Quote and type, so the empty-discard rule cannot be what closes the box.
    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill('kept draft')
    await expect(page.locator('.inline-float')).toHaveCount(1)

    // The freshly-quoted float is already pinned, so the first click is the closing one.
    await clickQuotedSpan(page, 'context window')
    await expect(page.locator('.inline-float')).toHaveCount(0)

    // The pointer is still resting on the highlight: it must stay shut, not pop back.
    await page.waitForTimeout(1000)
    await expect(page.locator('.inline-float')).toHaveCount(0)

    // The quote survives a close that had text - only the box went away.
    await expect.poll(() => highlightRangeCount(page)).toBe(1)

    // Leaving and returning re-arms hover.
    const point = await spanCenter(page, 'context window')
    await page.mouse.move(point.x, point.y - 200)
    await page.mouse.move(point.x, point.y)
    await expect(page.locator('.inline-float')).toBeVisible()
    await expect(page.locator('[data-testid="inline-thread-input"]').first()).toHaveValue(
      'kept draft',
    )
  })

  // SPEC: chat:inline-replies-float
  test('clicking a highlight re-opens a closed box, and clicking again closes it', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill('draft')
    await page.locator('[data-testid="inline-thread-close"]').click()
    await expect(page.locator('.inline-float')).toHaveCount(0)

    await clickQuotedSpan(page, 'context window')
    await expect(page.locator('.inline-float')).toHaveCount(1)

    await clickQuotedSpan(page, 'context window')
    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect.poll(() => highlightRangeCount(page)).toBe(1)
  })

  test('the right-hand comments bar and its control-bar toggle no longer exist', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    await expect(page.locator('[data-testid="inline-replies-bar"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="inline-replies-toggle"]')).toHaveCount(0)
  })

  // SPEC: chat:inline-replies-float-clamped
  // SPEC: chat:inline-replies-float-uniform-width
  test('a float quoted near the transcript edge stays fully inside it, at the same width as a mid-line float', async ({
    page,
  }) => {
    const longLine =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen ' +
      'sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour'
    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        content: 'Hello',
        is_human: true,
        timestamp: Date.now(),
        turn_id: 'turn_001',
      },
      { type: 'assistant', subtype: 'text', content: longLine, timestamp: Date.now() + 100 },
      { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() + 200 },
    ])
    await expect(page.locator('[data-testid="message-assistant"]').first()).toContainText('one')
    await disableAutoCollapse(page)

    // Mid-line control float, for the width comparison.
    await quote(page, 'five six seven')
    const midFloat = page.locator('.inline-float')
    const midBox = await midFloat.boundingBox()
    await page.locator('[data-testid="inline-thread-close"]').click()
    await expect(page.locator('.inline-float')).toHaveCount(0)

    // Quote through the last word so the selection ends at the rightmost rendered text, wherever the line wraps.
    await quote(page, 'twentythree twentyfour')
    const edgeFloat = page.locator('.inline-float')
    const edgeBox = await edgeFloat.boundingBox()
    const containerBox = await page.locator('.chat-messages').boundingBox()

    expect(edgeBox.width).toBeCloseTo(midBox.width, 0)
    expect(edgeBox.x + edgeBox.width).toBeLessThanOrEqual(containerBox.x + containerBox.width + 1)
    expect(edgeBox.x).toBeGreaterThanOrEqual(containerBox.x - 1)
  })
})
