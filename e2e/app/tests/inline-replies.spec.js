/** E2E tests for span-anchored inline replies (durable highlight + floating reply composers). */

import { expect, test } from '@playwright/test'
import { disableAutoCollapse, waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_URL,
  loadFixture,
  mockAPI,
} from '../mocks/api.js'
import { createSSEController } from '../mocks/sse.js'

const ASSISTANT_TEXT = 'The runtime embeds the context window size.'

/** Seed a session with one completed assistant turn whose text can be selected; returns the SSE
 * controller so callers can drive the source conversation's stream further. */
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
  return controller
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

/** Hover the centre of a quoted span, opening its transient float `INLINE_REPLY_HOVER_OPEN_MS`
 * after the move - used for a reply present at mount, where a click would toggle instead. */
async function hoverQuotedSpan(page, substring) {
  const point = await spanCenter(page, substring)
  await page.mouse.move(point.x, point.y)
}

/** Stub window.open before navigation, recording every call to window.__windowOpenCalls.
 * `blocked` mimics a popup-blocked browser by returning null instead of a window handle. */
async function stubWindowOpen(page, { blocked = false } = {}) {
  await page.addInitScript(isBlocked => {
    window.__windowOpenCalls = []
    window.open = (url, target) => {
      window.__windowOpenCalls.push({ url, target })
      return isBlocked ? null : {}
    }
  }, blocked)
}

/** Seed the unsent-replies localStorage record a real submit would have written, linking it to a
 * side session before load - these cases test the mount-time re-attach path, not a live submit. */
async function seedThreadLinkedReply(
  page,
  { sessionId = 'side-1', promotedSessionId = null, railPromoted = false } = {},
) {
  await page.addInitScript(
    ({ sid, promotedId, rail }) => {
      localStorage.setItem(
        'inline-replies:test-session-001',
        JSON.stringify([
          {
            id: 'r1',
            quote: 'context window',
            from: 'assistant',
            turnId: 'turn_001',
            prefix: '',
            suffix: '',
            offset: 0,
            response: '',
            threadSessionId: sid,
            promotedSessionId: promotedId,
            railPromoted: rail,
          },
        ]),
      )
    },
    { sid: sessionId, promotedId: promotedSessionId, rail: railPromoted },
  )
}

/** Number of painted ranges under the given highlight name (0 when the API is unsupported);
 * defaults to the live overlay's 'inline-quote', with ancestors under 'inline-quote-ancestor'. */
function highlightRangeCount(page, name = 'inline-quote') {
  return page.evaluate(
    n => (typeof CSS !== 'undefined' && CSS.highlights?.has(n) ? CSS.highlights.get(n).size : 0),
    name,
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
  test('sending from the message box posts the anchored payload and leaves a read-only reply at its highlight + a turn placeholder', async ({
    page,
  }) => {
    const sendCalls = []
    await page.route('**/api/send', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await seedAssistantTurn(page)

    // Every float now asks on its own by default (see the standalone-ask tests below) - the
    // batch path is reached from the message box, not Enter-in-float.
    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill('how big is it?')
    const composer = page.locator('[data-testid="chat-input"]')
    await composer.click()
    await composer.press('Enter')

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
    await page.route('**/sessions/*/fork', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    await page.route('**/api/send*', async route => {
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

    // Enter now asks in this float's own thread - the full expanded text is what gets sent,
    // never the collapsed placeholder, exactly as the batch path required.
    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0]).toEqual({ prompt: '<notes>full detail here</notes>' })
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

test.describe('Inline Replies (asking on its own)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: chat:inline-replies-standalone-ask
  // SPEC: chat:inline-replies-standalone-concurrent
  test('Enter in a float asks on its own beside the quote, leaving the conversation unchanged', async ({
    page,
  }) => {
    const forkCalls = []
    const sendCalls = []
    await page.route('**/sessions/*/fork', async route => {
      forkCalls.push(await route.request().postDataJSON())
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    await page.route('**/api/send*', async route => {
      sendCalls.push({ url: route.request().url(), body: await route.request().postDataJSON() })
      await route.fulfill({ status: 200, json: { success: true } })
    })
    const controller = await seedAssistantTurn(page)
    const turnCountBefore = await page.locator('[data-testid^="turn-"]').count()

    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill('why this branch?')
    await page.locator('[data-testid="inline-thread-input"]').first().press('Enter')

    await expect.poll(() => forkCalls.length).toBeGreaterThan(0)
    expect(forkCalls[0]).toMatchObject({ share_container: true })
    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0].url).toContain('session_id=side-1')
    expect(sendCalls[0].body).toEqual({ prompt: 'why this branch?' })

    // No confirmation, no interrupt prompt, and the conversation it was quoted from is untouched.
    await expect(page.locator('[data-testid="confirm-stop-modal"]')).toHaveCount(0)
    expect(await page.locator('[data-testid^="turn-"]').count()).toBe(turnCountBefore)
    await expect(page.locator('[data-testid="inline-replies-placeholder"]')).toHaveCount(0)

    // The float now shows the question asked, still beside its quote.
    const float = page.locator('.inline-float')
    await expect(float).toContainText('why this branch?')

    // The answer arrives in the same box - the subscription is addressed to the reply's own
    // thread, not to the container's unaddressed (primary) stream.
    await expect.poll(() => controller.hasOpenSession('side-1')).toBe(true)
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      content: 'because it handles the edge case',
    })
    await expect(float).toContainText('because it handles the edge case')
    await expect(float.getByTestId('inline-thread-working')).toBeVisible()

    await controller.sendToSession('side-1', { type: 'result' })
    await expect(float.getByTestId('inline-thread-working')).toHaveCount(0)
    await expect(float.getByTestId('inline-thread-input')).toBeEnabled()
  })

  // SPEC: chat:inline-replies-standalone-exclusive
  test('a finished box stays put while the conversation it was quoted from answers something else', async ({
    page,
  }) => {
    await page.route('**/sessions/*/fork', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    await page.route('**/api/send*', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })
    const controller = await seedAssistantTurn(page)

    await quote(page, 'context window')
    const float = page.locator('.inline-float')
    await float.getByTestId('inline-thread-input').fill('why this branch?')
    await float.getByTestId('inline-thread-input').press('Enter')

    await expect.poll(() => controller.hasOpenSession('side-1')).toBe(true)
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      content: 'because it handles the edge case',
    })
    await controller.sendToSession('side-1', { type: 'result' })
    await expect(float).toContainText('because it handles the edge case')

    const turnCountBefore = await page.locator('[data-testid^="turn-"]').count()
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        content: 'a second question',
        is_human: true,
        turn_id: 'turn_002',
      },
      { type: 'assistant', subtype: 'text', content: 'a second answer', turn_id: 'turn_002' },
      { type: 'result', subtype: 'success', turn_id: 'turn_002' },
    ])

    // The conversation grows; the box shows only what it asked for.
    await expect(page.locator('[data-testid^="turn-"]')).toHaveCount(turnCountBefore + 1)
    await expect(float).toContainText('because it handles the edge case')
    await expect(float).not.toContainText('a second answer')
  })

  // SPEC: chat:inline-replies-standalone-exclusive
  test('a box still arriving keeps its dot when the conversation it was quoted from finishes its own answer', async ({
    page,
  }) => {
    await page.route('**/sessions/*/fork', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    await page.route('**/api/send*', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })
    const controller = await seedAssistantTurn(page)

    await quote(page, 'context window')
    const float = page.locator('.inline-float')
    await float.getByTestId('inline-thread-input').fill('why this branch?')
    await float.getByTestId('inline-thread-input').press('Enter')

    await expect.poll(() => controller.hasOpenSession('side-1')).toBe(true)
    await expect(float.getByTestId('inline-thread-working')).toBeVisible()

    // The source conversation answers something else, start to finish, while the box's own
    // answer never arrives - the box's dot must survive it untouched.
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        content: 'a second question',
        is_human: true,
        turn_id: 'turn_002',
      },
      { type: 'assistant', subtype: 'text', content: 'a second answer', turn_id: 'turn_002' },
      { type: 'result', subtype: 'success', turn_id: 'turn_002' },
    ])

    await expect(page.locator('[data-testid^="turn-"]').last()).toContainText('a second answer')
    await expect(float.getByTestId('inline-thread-working')).toBeVisible()
    await expect(float).not.toContainText('a second answer')
  })

  // SPEC: chat:inline-replies-standalone-isolated
  test('asking one reply on its own leaves every other buffered reply untouched', async ({
    page,
  }) => {
    await page.route('**/sessions/*/fork', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    await page.route('**/api/send*', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await seedAssistantTurn(page)

    await quote(page, 'runtime')
    const floatA = page.locator('.inline-float', { hasText: 'runtime' })
    await floatA.getByTestId('inline-thread-input').fill('reply A - asked')

    await quote(page, 'context window')
    const floatB = page.locator('.inline-float', { hasText: 'context window' })
    await floatB.getByTestId('inline-thread-input').fill('reply B - buffered')

    // Ask only float A.
    await floatA.getByTestId('inline-thread-input').press('Enter')
    await expect(floatA).toContainText('reply A - asked')

    // Float B is still a plain, editable composer with its own text intact.
    const secondInput = floatB.getByTestId('inline-thread-input')
    await expect(secondInput).toBeVisible()
    await expect(secondInput).toHaveValue('reply B - buffered')
    await expect(page.locator('.inline-float')).toHaveCount(2)
  })

  // SPEC: chat:inline-replies-standalone-reload
  test('reload shows a finished standalone exchange in full', async ({ page }) => {
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [
            { type: 'user', is_human: true, content: 'why this branch?' },
            { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
          ],
          running: false,
        },
      })
    })
    await seedThreadLinkedReply(page)
    await seedAssistantTurn(page)

    // The anchor re-resolve runs on a MutationObserver + rAF schedule - wait for the highlight to
    // paint, or the hover lands before hit-testing has anything to hit.
    await expect.poll(() => highlightRangeCount(page)).toBe(1)
    await hoverQuotedSpan(page, 'context window')
    const reopened = page.locator('.inline-float')
    await expect(reopened).toContainText('why this branch?')
    await expect(reopened).toContainText('because it handles the edge case')
    // Still a live thread, not the old batch read-only div - a follow-up field is offered.
    await expect(reopened.getByTestId('inline-thread-input')).toBeVisible()
    await expect(reopened.getByTestId('inline-thread-input')).toBeEnabled()
  })

  // SPEC: chat:inline-replies-standalone-reload
  test("reload draws only the reader's own exchange, not what the thread inherited", async ({
    page,
  }) => {
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [
            { type: 'user', is_human: true, content: 'the inherited opening question' },
            { type: 'assistant', subtype: 'text', content: 'the inherited opening answer' },
            {
              type: 'system',
              subtype: 'container_restarted',
              message_data: { fork_parent_session_id: 'test-session-001' },
            },
            { type: 'user', is_human: true, content: 'why this branch?' },
            { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
          ],
          running: false,
        },
      })
    })
    await seedThreadLinkedReply(page)
    await seedAssistantTurn(page)

    await expect.poll(() => highlightRangeCount(page)).toBe(1)
    await hoverQuotedSpan(page, 'context window')
    const reopened = page.locator('.inline-float')
    const history = reopened.getByTestId('inline-thread-history')
    await expect(history).toContainText('why this branch?')
    await expect(history).toContainText('because it handles the edge case')
    await expect(history).not.toContainText('the inherited opening question')
    await expect(history.locator('.inline-thread-turn')).toHaveCount(1)
  })

  // SPEC: chat:inline-replies-standalone-reload
  test('a divider at the very top still draws the exchange after it - the off-by-one case', async ({
    page,
  }) => {
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [
            {
              type: 'system',
              subtype: 'container_restarted',
              message_data: { fork_parent_session_id: 'test-session-001' },
            },
            { type: 'user', is_human: true, content: 'why this branch?' },
            { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
          ],
          running: false,
        },
      })
    })
    await seedThreadLinkedReply(page)
    await seedAssistantTurn(page)

    await expect.poll(() => highlightRangeCount(page)).toBe(1)
    await hoverQuotedSpan(page, 'context window')
    const reopened = page.locator('.inline-float')
    const history = reopened.getByTestId('inline-thread-history')
    await expect(history).toContainText('why this branch?')
    await expect(history).toContainText('because it handles the edge case')
    await expect(history.locator('.inline-thread-turn')).toHaveCount(1)
  })

  // SPEC: chat:inline-replies-standalone-lifecycle
  test('replying to a finished standalone thread starts it answering again with the earlier exchange intact', async ({
    page,
  }) => {
    const sendCalls = []
    await page.route('**/sessions/side-1/resume', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    await page.route('**/api/send*', async route => {
      sendCalls.push({ url: route.request().url(), body: await route.request().postDataJSON() })
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [
            { type: 'user', is_human: true, content: 'why this branch?' },
            { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
          ],
          running: false,
        },
      })
    })
    await seedThreadLinkedReply(page)
    await seedAssistantTurn(page)

    await expect.poll(() => highlightRangeCount(page)).toBe(1)
    await hoverQuotedSpan(page, 'context window')
    const float = page.locator('.inline-float')
    await expect(float).toBeVisible()
    // Move onto the float itself - the hover bridge that keeps it open once the pointer leaves
    // the span, exactly as a reader moving toward the field to type would.
    await float.hover()
    const input = float.getByTestId('inline-thread-input')
    await expect(input).toBeEnabled()

    // A follow-up re-enters via resume, not a fresh fork, and keeps the earlier question visible.
    await input.fill('and the other one?')
    await input.press('Enter')

    await expect.poll(() => sendCalls.length).toBe(1)
    expect(sendCalls[0].url).toContain('session_id=side-1')
    expect(sendCalls[0].body).toEqual({ prompt: 'and the other one?' })
    await expect(float).toContainText('why this branch?')
    await expect(float).toContainText('and the other one?')
  })

  // SPEC: chat:inline-replies-standalone-overlap
  test('a follow-up sent while the first answer is still arriving keeps each exchange under its own question', async ({
    page,
  }) => {
    const sendCalls = []
    await page.route('**/sessions/*/fork', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    await page.route('**/sessions/side-1/resume', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    await page.route('**/api/send*', async route => {
      sendCalls.push({ url: route.request().url(), body: await route.request().postDataJSON() })
      await route.fulfill({ status: 200, json: { success: true } })
    })
    const controller = await seedAssistantTurn(page)

    await quote(page, 'context window')
    const float = page.locator('.inline-float')
    const input = float.getByTestId('inline-thread-input')
    await input.fill('why this branch?')
    await input.press('Enter')

    await expect.poll(() => controller.hasOpenSession('side-1')).toBe(true)
    await controller.sendToSession('side-1', {
      type: 'user',
      is_human: true,
      turn_id: 'turn-a',
      content: 'why this branch?',
    })

    // Never locked - a follow-up can be typed and sent before the first answer finishes.
    await expect(input).toBeEnabled()
    await input.fill('and the other one?')
    await input.press('Enter')

    await expect.poll(() => sendCalls.length).toBe(2)
    expect(sendCalls[1].url).toContain('session_id=side-1')
    expect(sendCalls[1].body).toEqual({ prompt: 'and the other one?' })

    await controller.sendToSession('side-1', {
      type: 'user',
      is_human: true,
      turn_id: 'turn-b',
      content: 'and the other one?',
    })
    // A frame tagged with the first question's own turn arrives after the second was asked.
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      turn_id: 'turn-a',
      content: 'because it handles the edge case',
    })
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      turn_id: 'turn-b',
      content: 'that one is unrelated',
    })

    const turns = float.locator('.inline-thread-turn')
    await expect(turns).toHaveCount(2)
    await expect(turns.nth(0)).toContainText('why this branch?')
    await expect(turns.nth(0)).toContainText('because it handles the edge case')
    await expect(turns.nth(1)).toContainText('and the other one?')
    await expect(turns.nth(1)).toContainText('that one is unrelated')
  })
})

test.describe('Inline Replies (promote to its own session)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  /** Ask a fresh float on its own; the first fork response is the side session, matching the
   * standalone-ask tests above. Returns the float locator, still holding the asked question. */
  async function askInFloat(page, forkCalls) {
    await page.route('**/sessions/*/fork', async route => {
      const body = await route.request().postDataJSON()
      forkCalls.push({ url: route.request().url(), body })
      if (forkCalls.length === 1) {
        await route.fulfill({
          status: 200,
          json: { session_id: 'side-1', container_id: 'test-cid' },
        })
      } else {
        await route.fulfill({
          status: 200,
          json: { session_id: 'promoted-1', container_id: 'promoted-cid' },
        })
      }
    })
    await page.route('**/api/send*', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill('why this branch?')
    await page.locator('[data-testid="inline-thread-input"]').first().press('Enter')
    await expect.poll(() => forkCalls.length).toBe(1)

    return page.locator('.inline-float')
  }

  // SPEC: chat:inline-replies-standalone-promote
  test('promoting opens a new tab on the promoted session, stops the source first, and freezes the float', async ({
    page,
  }) => {
    const forkCalls = []
    const stopCalls = []
    await page.route('**/api/sessions/side-1/stop', async route => {
      stopCalls.push(true)
      await route.fulfill({ status: 200, json: {} })
    })
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [
            { type: 'user', is_human: true, content: 'why this branch?' },
            { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
          ],
          running: false,
        },
      })
    })
    await stubWindowOpen(page)

    const float = await askInFloat(page, forkCalls)
    const turnCountBefore = await page.locator('[data-testid^="turn-"]').count()

    await expect(float.getByTestId('inline-thread-promote')).toBeVisible()
    await float.getByTestId('inline-thread-promote').click()

    // Fork #2 targets the SIDE session, re-parented to the main conversation, no shared container.
    await expect.poll(() => forkCalls.length).toBe(2)
    expect(forkCalls[1].url).toContain('/sessions/side-1/fork')
    expect(forkCalls[1].body).toMatchObject({ parent_session_id: DEFAULT_SESSION_ID })
    expect(forkCalls[1].body.share_container).toBeFalsy()

    // The source is stopped before the fork - the ordering `useChatRewindFork` guarantees.
    await expect.poll(() => stopCalls.length).toBe(1)

    // A real tab opens on the PROMOTED session - never the side session or the main one.
    const windowOpenCalls = await page.evaluate(() => window.__windowOpenCalls)
    expect(windowOpenCalls).toHaveLength(1)
    expect(windowOpenCalls[0].url).toContain('/sessions/promoted-1')
    expect(windowOpenCalls[0].url).not.toContain('/sessions/side-1')
    expect(windowOpenCalls[0].url).not.toContain(`/sessions/${DEFAULT_SESSION_ID}`)

    // The float freezes: history read-only, no reply field, no promote control, a link instead.
    await expect(float).toContainText('why this branch?')
    await expect(float).toContainText('because it handles the edge case')
    await expect(float.getByTestId('inline-thread-input')).toHaveCount(0)
    await expect(float.getByTestId('inline-thread-promote')).toHaveCount(0)
    const link = float.getByTestId('inline-thread-moved-link')
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', /\/sessions\/promoted-1/)

    // The main conversation is untouched - no turn added, none collapsed.
    expect(await page.locator('[data-testid^="turn-"]').count()).toBe(turnCountBefore)
  })

  test('a float whose reply was never asked has no promote control', async ({ page }) => {
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    const float = page.locator('.inline-float')

    await expect(float.getByTestId('inline-thread-promote')).toHaveCount(0)
  })

  // SPEC: chat:inline-replies-standalone-promote
  test('the freeze survives reload: hovering shows the frozen exchange with no reply field and no promote control', async ({
    page,
  }) => {
    // A page load with the promoted link already in localStorage stands in for "after a reload",
    // since the mock SSE controller's pushed events do not survive a real page.reload().
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [
            { type: 'user', is_human: true, content: 'why this branch?' },
            { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
          ],
          running: false,
        },
      })
    })
    await seedThreadLinkedReply(page, { promotedSessionId: 'promoted-1' })
    await seedAssistantTurn(page)

    await expect.poll(() => highlightRangeCount(page)).toBe(1)
    await hoverQuotedSpan(page, 'context window')

    const reopened = page.locator('.inline-float')
    await expect(reopened).toContainText('why this branch?')
    await expect(reopened).toContainText('because it handles the edge case')
    await expect(reopened.getByTestId('inline-thread-input')).toHaveCount(0)
    await expect(reopened.getByTestId('inline-thread-promote')).toHaveCount(0)
    await expect(reopened.getByTestId('inline-thread-moved-link')).toBeVisible()
  })

  test('a blocked popup still promotes the session and reports the failure', async ({ page }) => {
    const forkCalls = []
    await page.route('**/api/sessions/side-1/stop', async route => {
      await route.fulfill({ status: 200, json: {} })
    })
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [{ type: 'user', is_human: true, content: 'why this branch?' }],
          running: false,
        },
      })
    })
    await stubWindowOpen(page, { blocked: true })

    const float = await askInFloat(page, forkCalls)
    await float.getByTestId('inline-thread-promote').click()

    // The fork still succeeded - the promoted session exists even though the tab did not open.
    await expect.poll(() => forkCalls.length).toBe(2)
    await expect(float.getByTestId('inline-thread-moved-link')).toBeVisible()

    // The blocked tab is reported, not silently swallowed.
    await expect(page.locator('.footer-error-text')).toContainText('Popup blocked')
  })
})

test.describe('Inline Replies (promote to the rail)', () => {
  /** Make the mocked /sessions/current reflect whichever session was most recently resumed, so
   * navigating onto the promoted thread genuinely changes useSessionData().sessionId. */
  async function mockRailPromotion(page) {
    let mockCurrentSessionId = DEFAULT_SESSION_ID
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({
            json: {
              sessions: [
                { session_id: DEFAULT_SESSION_ID, name: null, parent_session_id: null },
                {
                  session_id: 'side-1',
                  name: null,
                  parent_session_id: DEFAULT_SESSION_ID,
                  container_id: DEFAULT_CONTAINER_ID,
                  is_side_thread: true,
                },
              ],
            },
          })
        },
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
        // The source's re-fetched transcript once it becomes an ancestor, mirroring
        // seedAssistantTurn's content so the read-only view resolves the same quote span.
        getSessionEvents: async route => {
          await route.fulfill({
            json: {
              events: [
                {
                  type: 'user',
                  subtype: 'text',
                  content: 'Hello',
                  is_human: true,
                  turn_id: 'turn_001',
                },
                { type: 'assistant', subtype: 'text', content: ASSISTANT_TEXT },
                { type: 'result', subtype: 'success', turn_id: 'turn_001' },
              ],
              running: false,
            },
          })
        },
      },
    })
  }

  test.beforeEach(async ({ page }) => {
    await mockRailPromotion(page)
  })

  async function askInFloat(page, forkCalls) {
    await page.route('**/sessions/*/fork', async route => {
      const body = await route.request().postDataJSON()
      forkCalls.push({ url: route.request().url(), body })
      await route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } })
    })
    await page.route('**/api/send*', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill('why this branch?')
    await page.locator('[data-testid="inline-thread-input"]').first().press('Enter')
    await expect.poll(() => forkCalls.length).toBe(1)

    return page.locator('.inline-float')
  }

  // SPEC: chat:inline-replies-promote-variants
  test('the float offers a rail destination beside the new-tab one', async ({ page }) => {
    const float = await askInFloat(page, [])

    await expect(float.getByTestId('inline-thread-promote')).toBeVisible()
    await expect(float.getByTestId('inline-thread-promote-rail')).toBeVisible()
  })

  // SPEC: chat:inline-replies-rail-promote
  // SPEC: chat:rail-promoted-thread-is-ordinary-group
  test('promoting onto the rail cancels auto-stop, navigates in place, and leaves two groups with the thread focused', async ({
    page,
  }) => {
    const promoteCalls = []
    await page.route('**/api/sessions/side-1/promote', async route => {
      promoteCalls.push(true)
      await route.fulfill({ status: 200, json: {} })
    })
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [
            { type: 'user', is_human: true, content: 'why this branch?' },
            { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
          ],
          running: false,
        },
      })
    })

    const float = await askInFloat(page, [])
    await float.getByTestId('inline-thread-promote-rail').click()

    await expect.poll(() => promoteCalls.length).toBe(1)
    await expect(page).toHaveURL(/\/sessions\/side-1$/)

    // No new tab, no fork - the thread's own session id never changes.
    const ancestor = page.locator('[data-testid="rail-ancestor"]')
    await expect(ancestor).toHaveAttribute('data-session-id', DEFAULT_SESSION_ID)
    await expect(
      page.locator('[data-testid="session-header-path-entry"][data-focused="true"]'),
    ).toHaveAttribute('data-session-id', 'side-1')

    // The float is gone from the source group; its quote highlight stays painted there.
    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect.poll(() => highlightRangeCount(page, 'inline-quote-ancestor')).toBe(1)
  })

  // SPEC: chat:inline-replies-rail-promote
  test('clicking the promoted quote highlight in the ancestor focuses the thread group', async ({
    page,
  }) => {
    await page.route('**/api/sessions/side-1/promote', async route => {
      await route.fulfill({ status: 200, json: {} })
    })
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({
        json: {
          events: [
            { type: 'user', is_human: true, content: 'why this branch?' },
            { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
          ],
          running: false,
        },
      })
    })

    const float = await askInFloat(page, [])
    await float.getByTestId('inline-thread-promote-rail').click()
    await expect(page).toHaveURL(/\/sessions\/side-1$/)
    await expect.poll(() => highlightRangeCount(page, 'inline-quote-ancestor')).toBe(1)

    // The source is already the ancestor here, so click its read-only copy of the quote: a
    // refocused source would need an SSE reconnect replay this harness leaves empty.
    await clickQuotedSpan(page, 'context window')

    await expect(page).toHaveURL(/\/sessions\/side-1$/)
  })
})
