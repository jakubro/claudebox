/** E2E tests for span-anchored inline replies (durable highlight + floating reply composers). */

import { expect, test } from '@playwright/test'
import {
  acceptSends,
  captureSends,
  disableAutoCollapse,
  openLiveSession,
  resumeNamedSession,
  sendFinishedTurn,
  sessionsHandler,
  waitForStableScrollHeight,
} from '../helpers.js'
import { DEFAULT_CONTAINER_ID, DEFAULT_SESSION_ID, mockAPI } from '../mocks/api.js'
import { loadEventsFromFixture } from '../mocks/sse.js'

const ASSISTANT_TEXT = 'The runtime embeds the context window size.'

/** Seed a session with one completed assistant turn whose text can be selected; returns the SSE
 * controller so callers can drive the source conversation's stream further. */
async function seedAssistantTurn(page) {
  const controller = await openLiveSession(page)
  await sendFinishedTurn(controller, ASSISTANT_TEXT)
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

  return point
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

async function routeFork(page) {
  await page.route('**/sessions/*/fork', async route => {
    await route.fulfill({
      status: 200,
      json: { session_id: 'side-1', container_id: 'test-cid' },
    })
  })
}

/** Record every POST to /api/send as { url, body }. */
async function recordSends(page) {
  const sends = []
  await page.route('**/api/send*', async route => {
    sends.push({ url: route.request().url(), body: await route.request().postDataJSON() })
    await route.fulfill({ status: 200, json: { success: true } })
  })
  return sends
}

async function routeForkAndSend(page) {
  await routeFork(page)
  await acceptSends(page)
}

async function routeForkCapturingSends(page) {
  await routeFork(page)

  return captureSends(page)
}

async function routeAnsweredThread(page, question = '> context window\n\nwhy this branch?') {
  await page.route('**/api/sessions/side-1/events', async route => {
    await route.fulfill({
      json: {
        events: [
          { type: 'user', is_human: true, content: question },
          { type: 'assistant', subtype: 'text', content: 'because it handles the edge case' },
        ],
        running: false,
      },
    })
  })
}

/** Serve side-1's log as one exchange whose question is still waiting for an answer. */
async function routeUnansweredThread(page) {
  await page.route('**/api/sessions/side-1/events', async route => {
    await route.fulfill({
      json: { events: loadEventsFromFixture('events/tool-ask-question.jsonl'), running: false },
    })
  })
}

/** Assert a read-only view's question shows disabled and ignores a click on an option. */
async function expectQuestionReadOnly(scope) {
  const form = scope.locator('.tool-questions-interactive')
  await expect(form).toBeVisible()
  await expect(form).toHaveClass(/disabled/)
  await expect(form.locator('.tool-submit-btn')).toHaveCount(0)
  await form.locator('.tool-question-option:not(.other)').first().click({ force: true })
  await expect(form.locator('.tool-question-option.selected')).toHaveCount(0)
}

async function openQuoteFloat(page) {
  await routeForkAndSend(page)
  const controller = await seedAssistantTurn(page)
  await quote(page, 'context window')

  return { controller, float: page.locator('.inline-float') }
}

async function openReplyBox(page) {
  await seedAssistantTurn(page)
  await quote(page, 'context window')

  return page.locator('[data-testid="inline-thread-input"]').first()
}

async function askInSideSession(page, text) {
  const { controller, float } = await openQuoteFloat(page)
  const input = float.getByTestId('inline-thread-input')
  await input.fill(text)
  await input.press('Control+Enter')
  await expect.poll(() => controller.hasOpenSession('side-1')).toBe(true)

  return { controller, float }
}

async function draftReply(page, text) {
  const input = await openReplyBox(page)
  await input.fill(text)
}

async function askWhyThisBranch(page) {
  await quote(page, 'context window')
  const input = page.locator('[data-testid="inline-thread-input"]').first()
  await input.fill('why this branch?')
  await input.press('Control+Enter')
}

async function reopenLinkedThread(page, linkOptions = {}) {
  await seedThreadLinkedReply(page, linkOptions)
  await seedAssistantTurn(page)
  // The anchor re-resolve runs on a MutationObserver + rAF schedule - wait for the highlight to
  // paint, or the hover lands before hit-testing has anything to hit.
  await expect.poll(() => highlightRangeCount(page)).toBe(1)
  await hoverQuotedSpan(page, 'context window')
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

  // SPEC: chat:inline-replies-quote-tab
  test('Tab while the quote button shows opens the reply box exactly as a click does', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    await selectAssistantText(page, 'context window')
    const affordance = page.locator('[data-testid="quote-affordance"]')
    await expect(affordance).toBeVisible()
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Tab')

    const float = page.locator('.inline-float')
    await expect(float).toBeVisible()
    await expect(float.locator('[data-testid="inline-thread"]')).toContainText('context window')
    await expect(float.locator('[data-testid="inline-thread"]')).toContainText('assistant')
    await expect(float.locator('[data-testid="inline-thread-input"]')).toBeFocused()
    await expect(affordance).toHaveCount(0)
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('')
    await expect.poll(() => highlightRangeCount(page)).toBe(1)
  })

  // SPEC: chat:inline-replies-quote-tab
  test('Tab with nothing selected, or Shift+Tab with the quote button showing, opens no reply box', async ({
    page,
  }) => {
    await seedAssistantTurn(page)

    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Tab')
    await expect(page.locator('.inline-float')).toHaveCount(0)

    await selectAssistantText(page, 'context window')
    await expect(page.locator('[data-testid="quote-affordance"]')).toBeVisible()
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('.inline-float')).toHaveCount(0)
  })

  // SPEC: chat:inline-replies-quote-tab
  // SPEC: shortcut:tab
  test('Tab in an open reply box indents its text', async ({ page }) => {
    const input = await openReplyBox(page)
    await input.fill('why')
    await input.press('Home')
    await input.press('Tab')

    await expect(input).toHaveValue('  why')
    await expect(page.locator('.inline-float')).toHaveCount(1)
  })

  // SPEC: chat:inline-replies-tab-close
  test('Tab with the cursor at the end of a reply closes its box, keeping the reply', async ({
    page,
  }) => {
    const input = await openReplyBox(page)
    await input.fill('why')
    await input.press('End')
    await input.press('Tab')

    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect(page.locator('[data-testid="chat-input"]')).toBeFocused()
    await expect.poll(() => highlightRangeCount(page)).toBe(1)
    await clickQuotedSpan(page, 'context window')
    await expect(page.locator('.inline-float [data-testid="inline-thread-input"]')).toHaveValue(
      'why',
    )
  })

  // SPEC: chat:inline-replies-tab-close
  test('Tab in an empty reply closes its box and drops the quote, as the close button does', async ({
    page,
  }) => {
    await seedAssistantTurn(page)
    await quote(page, 'context window')

    await page.locator('[data-testid="inline-thread-input"]').first().press('Tab')

    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect(page.locator('[data-testid="chat-input"]')).toBeFocused()
    await expect.poll(() => highlightRangeCount(page)).toBe(0)
  })

  // SPEC: chat:inline-replies-close-focus
  test('closing a reply box with Tab returns the cursor to its place in the message box draft', async ({
    page,
  }) => {
    await seedAssistantTurn(page)
    const chatInput = page.locator('[data-testid="chat-input"]')
    await chatInput.fill('draft text')
    await chatInput.evaluate(el => el.setSelectionRange(5, 5))
    await quote(page, 'context window')

    await page.locator('[data-testid="inline-thread-input"]').first().press('Tab')

    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect(chatInput).toBeFocused()
    await expect(chatInput).toHaveValue('draft text')
    expect(await chatInput.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([5, 5])
  })

  // SPEC: chat:inline-replies-close-focus
  test('closing a reply box by clicking its highlight leaves the message box unfocused', async ({
    page,
  }) => {
    await draftReply(page, 'kept')

    await clickQuotedSpan(page, 'context window')

    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect(page.locator('[data-testid="chat-input"]')).not.toBeFocused()
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
    const sendCalls = await captureSends(page)
    await draftReply(page, 'how big is it?')
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

  // SPEC: chat:inline-replies-send-once
  test('Enter twice while a reply-only message is on its way sends the reply once', async ({
    page,
  }) => {
    const sendCalls = []
    let release
    const held = new Promise(resolve => (release = resolve))
    await page.route('**/api/send*', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await held
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await draftReply(page, 'only once')
    const composer = page.locator('[data-testid="chat-input"]')
    await composer.click()
    await composer.press('Enter')
    await expect.poll(() => sendCalls.length).toBe(1)
    await composer.press('Enter')
    release()

    await expect(page.locator('[data-testid="inline-replies-placeholder"]')).toHaveCount(1)
    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0].inline_replies.map(r => r.response)).toEqual(['only once'])
  })

  // SPEC: chat:inline-replies-send-once
  test('a reply whose message failed to send goes with the next send, once', async ({ page }) => {
    const sendCalls = []
    await page.route('**/api/send*', async route => {
      sendCalls.push(await route.request().postDataJSON())
      if (sendCalls.length === 1) {
        await route.fulfill({ status: 500, body: 'refused' })
      } else {
        await route.fulfill({ status: 200, json: { success: true } })
      }
    })
    await draftReply(page, 'retry me')
    const composer = page.locator('[data-testid="chat-input"]')
    await composer.click()
    await composer.press('Enter')
    await expect(page.locator('.footer-error-text')).toContainText('Send failed')
    await composer.press('Enter')

    await expect(page.locator('[data-testid="inline-replies-placeholder"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="inline-replies-placeholder"]')).toContainText(
      'Replied inline - 1 comment',
    )
    expect(sendCalls.map(c => c.inline_replies.map(r => r.response))).toEqual([
      ['retry me'],
      ['retry me'],
    ])
  })

  // SPEC: chat:inline-replies-editing-keys
  test('the reply box supports the same text-editing keys as the message box', async ({ page }) => {
    const input = await openReplyBox(page)
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
  // SPEC: input:editing-keys-undo
  test('Ctrl+Z undoes a tag wrap in a reply box', async ({ page }) => {
    const input = await openReplyBox(page)
    await input.pressSequentially('fix the bug')
    await input.evaluate(el => el.setSelectionRange(4, 7))

    await input.press('Control+,')
    await expect(input).toHaveValue('fix <this>the</this> bug')
    await input.press('Control+z')
    await expect(input).toHaveValue('fix the bug')
    await input.press('Control+Shift+z')
    await expect(input).toHaveValue('fix <this>the</this> bug')
  })

  test('history, stash, and slash autocomplete stay with the message box, not the reply', async ({
    page,
  }) => {
    const input = await openReplyBox(page)
    await input.fill('/greet')
    await expect(input).toHaveValue('/greet')
    await expect(page.locator('.command-autocomplete')).toHaveCount(0)

    // Arrow keys move the caret rather than loading composer history.
    await input.press('ArrowUp')
    await expect(input).toHaveValue('/greet')
  })

  // SPEC: chat:inline-replies-collapse-expands-on-send
  test('a collapsed block in a reply is delivered in full, never as a placeholder', async ({
    page,
  }) => {
    const sendCalls = await routeForkCapturingSends(page)
    const input = await openReplyBox(page)
    await input.fill('<notes>full detail here</notes>')
    await input.evaluate(el => el.setSelectionRange(3, 3))
    await input.press("Control+'")
    await expect(input).toHaveValue(/<notes\.\.\.\d+>/)

    await input.press('Control+Enter')

    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0]).toEqual({ prompt: '> context window\n\n<notes>full detail here</notes>' })
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
    await expect(page.locator('[data-testid="chat-input"]')).toBeFocused()
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
    await expect(page.locator('[data-testid="chat-input"]')).toBeFocused()
    await expect.poll(() => highlightRangeCount(page)).toBe(0)
  })

  test('a float hides when its source turn is collapsed by auto-collapse', async ({ page }) => {
    const controller = await openLiveSession(page)
    await sendFinishedTurn(controller, ASSISTANT_TEXT)
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
    const input = await openReplyBox(page)
    await input.pressSequentially('the quick brown fox', { delay: 0 })
    await expect(input).toHaveValue('the quick brown fox')
  })

  // SPEC: chat:inline-replies-send
  test('a char-by-char typed reply is attached when sending via the main composer', async ({
    page,
  }) => {
    const sendCalls = await captureSends(page)
    await seedAssistantTurn(page)

    // Type the reply char-by-char in the float (the path the value-lag corrupted).
    await quote(page, 'context window')
    await page
      .locator('[data-testid="inline-thread-input"]')
      .first()
      .pressSequentially('typed reply', { delay: 0 })

    // Send from the main composer: the buffered reply must ride along.
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
    // Quote, type, then close (with text) -> collapses to just the highlight; the reply is buffered.
    await draftReply(page, 'draft')
    await page.locator('[data-testid="inline-thread-close"]').click()
    await expect(page.locator('.inline-float')).toHaveCount(0)

    // Hovering the highlighted span shows a transient float and a pointer cursor (matching path links).
    const point = await hoverQuotedSpan(page, 'context window')
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
    // Quote and type, so the empty-discard rule cannot be what closes the box.
    await draftReply(page, 'kept draft')
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
    await draftReply(page, 'draft')
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
  // SPEC: chat:inline-replies-float-resize
  test('a float quoted near the transcript edge stays fully inside it, at the same width as a mid-line float', async ({
    page,
  }) => {
    const longLine =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen ' +
      'sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour'
    const controller = await openLiveSession(page)
    await sendFinishedTurn(controller, longLine)
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

/** Drag a float's corner grip by (dx, dy) with the real pointer. */
async function dragGrip(float, page, dx, dy) {
  const box = await float.getByTestId('inline-float-resize').boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

test.describe('Inline Replies (Tab over a highlight)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  /** Buffer `draft` as a reply to 'context window' and close its box. */
  async function bufferClosedReply(page, draft = 'draft') {
    await seedAssistantTurn(page)
    await quote(page, 'context window')
    await page.locator('[data-testid="inline-thread-input"]').first().fill(draft)
    await page.locator('[data-testid="inline-thread-close"]').click()
    await expect(page.locator('.inline-float')).toHaveCount(0)
  }

  /** Assert the one open box is pinned and its field has the cursor at the end of `text`. */
  async function expectOpenedWithCaretAtEnd(page, text) {
    await expect(page.locator('.inline-float')).toHaveCount(1)
    await expect(page.locator('.inline-float [data-testid="inline-thread-close"]')).toBeVisible()
    const input = page.locator('.inline-float [data-testid="inline-thread-input"]')
    await expect(input).toBeFocused()
    expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([
      text.length,
      text.length,
    ])
  }

  // SPEC: chat:inline-replies-hover-tab
  test('Tab with the mouse on a closed reply opens it, keeps it open and focuses its field', async ({
    page,
  }) => {
    await bufferClosedReply(page)
    await page.locator('[data-testid="chat-input"]').evaluate(el => el.blur())
    const point = await hoverQuotedSpan(page, 'context window')
    await expect(page.locator('.inline-float')).toBeVisible()

    await page.keyboard.press('Tab')

    await expectOpenedWithCaretAtEnd(page, 'draft')
    await page.mouse.move(point.x, point.y - 200)
    await page.waitForTimeout(400)
    await expect(page.locator('.inline-float')).toHaveCount(1)
  })

  // SPEC: chat:inline-replies-hover-tab
  test('a box opened by Tab and closed again previews on hover without taking the cursor', async ({
    page,
  }) => {
    await bufferClosedReply(page)
    const point = await hoverQuotedSpan(page, 'context window')
    await page.keyboard.press('Tab')
    await expectOpenedWithCaretAtEnd(page, 'draft')
    await page.locator('.inline-float [data-testid="inline-thread-input"]').press('Tab')
    const chatInput = page.locator('[data-testid="chat-input"]')
    await expect(chatInput).toBeFocused()
    await page.mouse.move(point.x, point.y - 200)
    await expect(page.locator('.inline-float')).toHaveCount(0)

    await page.mouse.move(point.x, point.y)

    await expect(page.locator('.inline-float')).toBeVisible()
    await page.waitForTimeout(300)
    await expect(chatInput).toBeFocused()
    await expect(page.locator('.inline-float [data-testid="inline-thread-close"]')).toHaveCount(0)
  })

  // SPEC: chat:inline-replies-hover-tab
  test('Tab opens the reply at once, before its hover preview shows', async ({ page }) => {
    await bufferClosedReply(page)
    await hoverQuotedSpan(page, 'context window')
    await page.keyboard.press('Tab')

    await expectOpenedWithCaretAtEnd(page, 'draft')
  })

  // SPEC: chat:inline-replies-hover-tab
  test('Tab with the mouse on the preview box opens it', async ({ page }) => {
    await bufferClosedReply(page)
    await hoverQuotedSpan(page, 'context window')
    await expect(page.locator('.inline-float')).toBeVisible()
    await page.locator('.inline-float .inline-thread-quote').hover()

    await page.keyboard.press('Tab')

    await expectOpenedWithCaretAtEnd(page, 'draft')
  })

  // SPEC: chat:inline-replies-hover-tab
  test('Tab from the message box opens the reply instead of indenting', async ({ page }) => {
    await bufferClosedReply(page)
    const chatInput = page.locator('[data-testid="chat-input"]')
    await chatInput.fill('abc')
    await chatInput.focus()
    await hoverQuotedSpan(page, 'context window')

    await page.keyboard.press('Tab')

    await expectOpenedWithCaretAtEnd(page, 'draft')
    await expect(chatInput).toHaveValue('abc')
  })

  // SPEC: chat:inline-replies-hover-tab
  test('Tab with the cursor in another reply box opens the one under the mouse', async ({
    page,
  }) => {
    await bufferClosedReply(page)
    await quote(page, 'runtime')
    const other = page.locator('.inline-float', { hasText: 'runtime' })
    await other.getByTestId('inline-thread-input').fill('other')
    await other.getByTestId('inline-thread-input').focus()
    await hoverQuotedSpan(page, 'context window')

    await page.keyboard.press('Tab')

    const target = page.locator('.inline-float', { hasText: 'context window' })
    await expect(target.getByTestId('inline-thread-input')).toBeFocused()
    await expect(other.getByTestId('inline-thread-input')).toHaveValue('other')
  })

  // SPEC: chat:inline-replies-hover-tab
  test('Tab over a box answered on its own focuses its follow-up field', async ({ page }) => {
    await routeAnsweredThread(page)
    await reopenLinkedThread(page)

    await page.keyboard.press('Tab')

    const followUp = page.locator('.inline-float [data-testid="inline-thread-input"]')
    await expect(followUp).toBeFocused()
    await expect(followUp).toHaveAttribute('placeholder', 'Ask a follow-up...')
  })

  // SPEC: chat:inline-replies-hover-tab
  test('Tab over a reply sent with the batch opens it read-only and keeps it open', async ({
    page,
  }) => {
    await acceptSends(page)
    await draftReply(page, 'how big is it?')
    await page.locator('[data-testid="chat-input"]').press('Enter')
    await expect(page.locator('.inline-float')).toHaveCount(0)
    const point = await hoverQuotedSpan(page, 'context window')

    await page.keyboard.press('Tab')

    await expect(page.locator('.inline-float [data-testid="inline-thread"].sent')).toBeVisible()
    await expect(page.locator('.inline-float [data-testid="inline-thread-close"]')).toBeVisible()
    await expect(page.locator('.inline-float [data-testid="inline-thread-input"]')).toHaveCount(0)
    await page.mouse.move(point.x, point.y - 200)
    await page.waitForTimeout(400)
    await expect(page.locator('.inline-float')).toHaveCount(1)
  })

  // SPEC: chat:inline-replies-hover-tab
  test('a selection showing the quote button keeps Tab for quoting', async ({ page }) => {
    await bufferClosedReply(page)
    await hoverQuotedSpan(page, 'context window')
    await selectAssistantText(page, 'runtime')
    await expect(page.locator('[data-testid="quote-affordance"]')).toBeVisible()
    await page.locator('[data-testid="chat-input"]').evaluate(el => el.blur())

    await page.keyboard.press('Tab')

    await expect.poll(() => highlightRangeCount(page)).toBe(2)
    await expect(
      page.locator('.inline-float', { hasText: 'runtime' }).getByTestId('inline-thread-input'),
    ).toBeFocused()
  })

  // SPEC: chat:inline-replies-hover-tab
  test('away from any highlight Tab indents, and Shift+Tab over one dedents', async ({ page }) => {
    await bufferClosedReply(page)
    const chatInput = page.locator('[data-testid="chat-input"]')
    await chatInput.fill('abc')
    await chatInput.focus()
    await chatInput.press('Home')
    const point = await spanCenter(page, 'context window')
    await page.mouse.move(point.x, point.y - 200)

    await page.keyboard.press('Tab')
    await expect(chatInput).toHaveValue('  abc')

    await page.mouse.move(point.x, point.y)
    await page.keyboard.press('Shift+Tab')
    await expect(chatInput).toHaveValue('abc')
    await expect(page.locator('.inline-float [data-testid="inline-thread-close"]')).toHaveCount(0)
  })

  // SPEC: chat:inline-replies-hover-tab
  test('an open slash-command list keeps Tab for its suggestion', async ({ page }) => {
    await bufferClosedReply(page)
    const chatInput = page.locator('[data-testid="chat-input"]')
    await chatInput.focus()
    await chatInput.pressSequentially('/')
    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
    await hoverQuotedSpan(page, 'context window')

    await page.keyboard.press('Tab')

    await expect(chatInput).toHaveValue(/^\/\S+ $/)
    await expect(page.locator('.inline-float [data-testid="inline-thread-close"]')).toHaveCount(0)
  })
})

test.describe('Inline Replies (resizing a box)', () => {
  // SPEC: chat:inline-replies-float-resize
  test('dragging a box corner resizes that box alone, down to a minimum', async ({ page }) => {
    await mockAPI(page)
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    await quote(page, 'runtime')
    const floats = page.locator('.inline-float')
    await expect(floats).toHaveCount(2)
    const first = floats.first()
    const second = floats.last()
    const firstBefore = await first.boundingBox()
    const secondBefore = await second.boundingBox()

    await dragGrip(first, page, -100, 120)

    await expect
      .poll(async () => (await first.boundingBox()).height)
      .toBeGreaterThan(firstBefore.height + 100)
    expect((await first.boundingBox()).width).toBeCloseTo(firstBefore.width - 100, 0)
    expect((await second.boundingBox()).width).toBeCloseTo(secondBefore.width, 0)
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('')

    await dragGrip(first, page, -2000, -2000)

    await expect.poll(async () => (await first.boundingBox()).width).toBeCloseTo(280, 0)
  })

  // SPEC: chat:inline-replies-float-resize-persist
  test('a box keeps its size when closed and re-opened, and a deleted reply forgets it', async ({
    page,
  }) => {
    const patches = []
    await mockAPI(page)
    page.on('request', request => {
      if (request.method() === 'PATCH' && request.url().includes('/ui-state')) {
        patches.push(request.postDataJSON())
      }
    })
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    const float = page.locator('.inline-float')
    await float.getByTestId('inline-thread-input').fill('keep this')
    const before = await float.boundingBox()
    await dragGrip(float, page, 150, 80)
    await expect
      .poll(async () => (await float.boundingBox()).width)
      .toBeCloseTo(before.width + 150, 0)
    const resized = await float.boundingBox()
    await expect
      .poll(() =>
        patches
          .flatMap(p => p.session || [])
          .some(op => op.op === 'set' && op.path.startsWith('inlineReplySizes.')),
      )
      .toBe(true)

    await float.getByTestId('inline-thread-close').click()
    await expect(float).toHaveCount(0)
    await clickQuotedSpan(page, 'context window')
    await expect(float).toHaveCount(1)
    expect((await float.boundingBox()).width).toBeCloseTo(resized.width, 0)

    await float.getByTestId('inline-thread-delete').click()
    await expect(float).toHaveCount(0)
    expect(
      patches
        .flatMap(p => p.session || [])
        .some(op => op.op === 'unset' && op.path.startsWith('inlineReplySizes.')),
    ).toBe(true)

    await quote(page, 'context window')
    expect((await float.boundingBox()).width).toBeCloseTo(before.width, 0)
  })

  // SPEC: chat:inline-replies-float-resize-persist
  test('a box opens at the size its session stored, whatever browser left it', async ({ page }) => {
    await mockAPI(page, {
      sessionUiStateDefaults: { inlineReplySizes: { r1: { width: 420, height: 150 } } },
    })
    await seedThreadLinkedReply(page)
    await page.route('**/api/sessions/side-1/events', async route => {
      await route.fulfill({ json: { events: [], running: false } })
    })
    await seedAssistantTurn(page)

    await clickQuotedSpan(page, 'context window')

    const float = page.locator('.inline-float')
    await expect(float).toHaveCount(1)
    await expect.poll(async () => (await float.boundingBox()).width).toBeCloseTo(420, 0)
    // The stored height sizes the exchange; the follow-up field below it stays one line tall.
    expect((await float.getByTestId('inline-thread-history').boundingBox()).height).toBeCloseTo(
      150,
      0,
    )
    expect((await float.getByTestId('inline-thread-input').boundingBox()).height).toBeLessThan(80)
  })
})

test.describe('Inline Replies (Enter in a reply box)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: chat:inline-replies-enter-keys
  test('Enter in a reply box sends the message box text with every buffered reply', async ({
    page,
  }) => {
    const sends = await recordSends(page)
    await seedAssistantTurn(page)
    const chatInput = page.locator('[data-testid="chat-input"]')
    await chatInput.fill('see below')

    await quote(page, 'runtime')
    await page
      .locator('.inline-float', { hasText: 'runtime' })
      .getByTestId('inline-thread-input')
      .fill('first')
    await quote(page, 'context window')
    const second = page
      .locator('.inline-float', { hasText: 'context window' })
      .getByTestId('inline-thread-input')
    await second.fill('second')
    await second.press('Enter')

    await expect.poll(() => sends.length).toBe(1)
    expect(sends[0].url).not.toContain('session_id=side')
    expect(sends[0].body.prompt).toBe('see below')
    expect(sends[0].body.inline_replies.map(r => r.response).sort()).toEqual(['first', 'second'])
    await expect(page.locator('[data-testid="inline-replies-placeholder"]')).toContainText(
      'Replied inline - 2 comments',
    )
    await expect(chatInput).toHaveValue('')
    await expect(chatInput).toBeFocused()
  })

  // SPEC: chat:inline-replies-enter-keys
  test('Enter in a reply box with an empty message box sends the reply alone', async ({ page }) => {
    const sends = await recordSends(page)
    const input = await openReplyBox(page)
    await input.fill('how big is it?')
    await input.press('Enter')

    await expect.poll(() => sends.length).toBe(1)
    expect(sends[0].body.prompt).toBe('')
    expect(sends[0].body.inline_replies).toHaveLength(1)
    expect(sends[0].body.inline_replies[0].response).toBe('how big is it?')
  })

  // SPEC: chat:inline-replies-collapse-expands-on-send
  test('Enter in a reply box sends a collapsed block in full', async ({ page }) => {
    const sends = await recordSends(page)
    const input = await openReplyBox(page)
    await input.fill('<notes>full detail here</notes>')
    await input.evaluate(el => el.setSelectionRange(3, 3))
    await input.press("Control+'")
    await expect(input).toHaveValue(/<notes\.\.\.\d+>/)
    await input.press('Enter')

    await expect.poll(() => sends.length).toBe(1)
    expect(sends[0].body.inline_replies[0].response).toBe('<notes>full detail here</notes>')
  })

  // SPEC: chat:inline-replies-enter-keys
  test('Alt+Enter in an unsent reply box sends, queues and asks nothing', async ({ page }) => {
    const sends = await recordSends(page)
    await page.route('**/sessions/*/fork', route => route.fulfill({ status: 500 }))
    const input = await openReplyBox(page)
    await input.fill('still mine')
    await input.press('Alt+Enter')

    await page.waitForTimeout(300)
    expect(sends).toHaveLength(0)
    await expect(page.locator('[data-testid="message-queue"]')).toHaveCount(0)
    await expect(input).toHaveValue('still mine')
    await expect(input).toBeEditable()
  })

  // SPEC: chat:inline-replies-enter-keys
  test('Enter in an answered box asks its follow-up even before its history loads', async ({
    page,
  }) => {
    let releaseHistory
    const historyHeld = new Promise(resolve => {
      releaseHistory = resolve
    })
    await page.route('**/api/sessions/side-1/events', async route => {
      await historyHeld
      await route.fulfill({ json: { events: [], running: false } })
    })
    await page.route('**/sessions/side-1/resume', async route => {
      await route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } })
    })
    const sends = await recordSends(page)
    await seedThreadLinkedReply(page)
    await seedAssistantTurn(page)
    await page.locator('[data-testid="chat-input"]').fill('not this')
    await expect.poll(() => highlightRangeCount(page)).toBe(1)
    await hoverQuotedSpan(page, 'context window')
    const input = page.locator('.inline-float').getByTestId('inline-thread-input')
    await input.click()
    await input.fill('and the other one?')

    await input.press('Enter')

    await expect.poll(() => sends.length).toBe(1)
    expect(sends[0].url).toContain('session_id=side-1')
    expect(sends[0].body).toEqual({ prompt: 'and the other one?' })
    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue('not this')
    releaseHistory()
  })

  // SPEC: chat:inline-replies-enter-keys
  test('Ctrl+Enter in a box answered on its own asks its follow-up there', async ({ page }) => {
    await routeAnsweredThread(page)
    await page.route('**/sessions/side-1/resume', async route => {
      await route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } })
    })
    const sends = await recordSends(page)
    await reopenLinkedThread(page)
    const input = page.locator('.inline-float').getByTestId('inline-thread-input')
    await input.click()
    await input.fill('and the other one?')
    await input.press('Control+Enter')

    await expect.poll(() => sends.length).toBe(1)
    expect(sends[0].url).toContain('session_id=side-1')
    expect(sends[0].body).toEqual({ prompt: 'and the other one?' })
  })
})

test.describe('Inline Replies (asking on its own)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: chat:inline-replies-standalone-switch
  test('a reply asked on its own reaches its thread when another session opens while it starts', async ({
    page,
  }) => {
    const sendUrls = []
    let releaseFork
    const forkHeld = new Promise(resolve => {
      releaseFork = resolve
    })
    await page.route('**/sessions/test-session-002/resume', route =>
      route.fulfill({ json: { session_id: 'test-session-002', container_id: 'cid-2' } }),
    )
    await page.route('**/sessions/*/fork', async route => {
      await forkHeld
      await route.fulfill({ json: { session_id: 'side-1', container_id: DEFAULT_CONTAINER_ID } })
    })
    await page.route('**/api/send*', async route => {
      sendUrls.push(route.request().url())
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await seedAssistantTurn(page)

    await askWhyThisBranch(page)
    await page.evaluate(id => {
      window.location.hash = window.location.hash.replace(/sessions\/[^/]+$/, `sessions/${id}`)
    }, 'test-session-002')
    await expect.poll(() => page.url()).toContain('test-session-002')
    releaseFork()

    await expect.poll(() => sendUrls.length).toBe(1)
    expect(sendUrls[0]).toContain(`/containers/${DEFAULT_CONTAINER_ID}/`)
    expect(sendUrls[0]).toContain('session_id=side-1')
  })

  // SPEC: chat:inline-replies-standalone-ask
  // SPEC: chat:inline-replies-standalone-concurrent
  // SPEC: chat:inline-replies-standalone-quote-sent
  test('Ctrl+Enter in a float asks on its own beside the quote, leaving the conversation unchanged', async ({
    page,
  }) => {
    const forkCalls = []
    await page.route('**/sessions/side-1/resume', async route => {
      await route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } })
    })
    await page.route('**/sessions/*/fork', async route => {
      forkCalls.push(await route.request().postDataJSON())
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    const sendCalls = await recordSends(page)
    const controller = await seedAssistantTurn(page)
    const turnCountBefore = await page.locator('.chat-messages [data-testid^="turn-"]').count()

    await askWhyThisBranch(page)

    await expect.poll(() => forkCalls.length).toBeGreaterThan(0)
    expect(forkCalls[0]).toMatchObject({ share_container: true })
    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0].url).toContain('session_id=side-1')
    expect(sendCalls[0].body).toEqual({ prompt: '> context window\n\nwhy this branch?' })

    // No confirmation, no interrupt prompt, and the conversation it was quoted from is untouched.
    await expect(page.locator('[data-testid="confirm-stop-modal"]')).toHaveCount(0)
    expect(await page.locator('.chat-messages [data-testid^="turn-"]').count()).toBe(
      turnCountBefore,
    )
    await expect(page.locator('[data-testid="inline-replies-placeholder"]')).toHaveCount(0)

    const float = page.locator('.inline-float')
    await expect(float.locator('.inline-thread-quote-text')).toHaveText('context window')
    await expect(float.getByTestId('message-user').first().locator('.message-content')).toHaveText(
      'why this branch?',
    )

    // The answer arrives in the same box - the subscription is addressed to the reply's own
    // thread, not to the container's unaddressed (primary) stream.
    await expect.poll(() => controller.hasOpenSession('side-1')).toBe(true)
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      content: 'because it handles the edge case',
    })
    await expect(float).toContainText('because it handles the edge case')
    await expect(float.getByTestId('turn-progress-working')).toBeVisible()

    await controller.sendToSession('side-1', { type: 'result' })
    await expect(float.getByTestId('turn-progress-working')).toHaveCount(0)
    await expect(float.getByTestId('inline-thread-input')).toBeEnabled()

    await float.getByTestId('inline-thread-input').fill('and the else branch?')
    await float.getByTestId('inline-thread-input').press('Enter')
    await expect.poll(() => sendCalls.length).toBe(2)
    expect(sendCalls[1].url).toContain('session_id=side-1')
    expect(sendCalls[1].body).toEqual({ prompt: 'and the else branch?' })
    expect(forkCalls).toHaveLength(1)
  })

  /** Hold every fork until `release()`; record each fork and each send, side or main. */
  async function holdForks(page) {
    const calls = { forks: 0, sideSends: [], mainSends: [] }
    let release
    const held = new Promise(resolve => {
      release = resolve
    })
    await page.route('**/sessions/side-1/resume', route =>
      route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } }),
    )
    await page.route('**/sessions/*/fork', async route => {
      calls.forks++
      await held
      await route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } })
    })
    await page.route('**/api/send*', async route => {
      const url = route.request().url()
      const body = await route.request().postDataJSON()
      ;(url.includes('session_id=side-1') ? calls.sideSends : calls.mainSends).push(body)
      await route.fulfill({ status: 200, json: { success: true } })
    })
    return { calls, release: () => release() }
  }

  async function quoteWithHeldFork(page) {
    const { calls, release } = await holdForks(page)
    await seedAssistantTurn(page)
    await quote(page, 'context window')

    return {
      calls,
      release,
      input: page.locator('.inline-float').getByTestId('inline-thread-input'),
    }
  }

  // SPEC: chat:inline-replies-standalone-ask-focus
  test('asking on its own leaves the cursor in the box, and a draft typed there stays out of the message box', async ({
    page,
  }) => {
    const { calls, release, input } = await quoteWithHeldFork(page)
    await input.fill('why this branch?')
    await input.press('Control+Enter')

    await expect(input).toBeFocused()
    await expect(input).toHaveValue('')
    await page.keyboard.type('and?')
    await expect(input).toHaveValue('and?')

    const composer = page.locator('[data-testid="chat-input"]')
    await composer.fill('hello')
    await composer.press('Enter')
    await expect.poll(() => calls.mainSends.length).toBe(1)
    expect(calls.mainSends[0].inline_replies ?? null).toBeNull()
    release()
  })

  // SPEC: chat:inline-replies-standalone-ask-focus
  // SPEC: chat:inline-replies-close-focus
  test('Tab straight after asking closes the box and keeps its quote, highlight and exchange', async ({
    page,
  }) => {
    const { release } = await holdForks(page)
    await seedAssistantTurn(page)

    await quote(page, 'context window')
    const input = page.locator('.inline-float').getByTestId('inline-thread-input')
    await input.fill('why this branch?')
    await input.press('Control+Enter')
    await page.keyboard.press('Tab')

    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect(page.locator('[data-testid="chat-input"]')).toBeFocused()
    await expect.poll(() => highlightRangeCount(page)).toBe(1)

    release()
    await clickQuotedSpan(page, 'context window')
    await expect(page.locator('.inline-float').getByTestId('message-user').first()).toContainText(
      'why this branch?',
    )
  })

  // SPEC: chat:inline-replies-standalone-ask-focus
  test('a follow-up asked at once goes to the same thread, after the first question', async ({
    page,
  }) => {
    const { calls, release, input } = await quoteWithHeldFork(page)
    await input.fill('why this branch?')
    await input.press('Control+Enter')
    await page.keyboard.type('and?')
    await page.keyboard.press('Enter')
    release()

    await expect.poll(() => calls.sideSends.length).toBe(2)
    expect(calls.forks).toBe(1)
    expect(calls.sideSends).toEqual([
      { prompt: '> context window\n\nwhy this branch?' },
      { prompt: 'and?' },
    ])
    expect(calls.mainSends).toEqual([])
  })

  // SPEC: chat:inline-replies-enter-keys
  test('Ctrl+Enter in an empty box asks nothing, and the reply typed after it goes with the next send', async ({
    page,
  }) => {
    const { calls, release, input } = await quoteWithHeldFork(page)
    await input.press('Control+Enter')
    await input.fill('why this branch?')
    await input.press('Enter')

    await expect.poll(() => calls.mainSends.length).toBe(1)
    expect(calls.mainSends[0].inline_replies.map(r => r.response)).toEqual(['why this branch?'])
    expect(calls.forks).toBe(0)
    release()
  })

  // SPEC: chat:inline-replies-standalone-quote-sent
  test('a box asks with its own quote and reply only, whatever the message box holds', async ({
    page,
  }) => {
    const sendCalls = await routeForkCapturingSends(page)
    await seedAssistantTurn(page)
    const composer = page.locator('[data-testid="chat-input"]')
    await composer.fill('unrelated')

    await quote(page, 'runtime')
    const buffered = page.locator('.inline-float', { hasText: 'runtime' })
    await buffered.getByTestId('inline-thread-input').fill('still buffered')
    await quote(page, 'context window')
    const asked = page.locator('.inline-float', { hasText: 'context window' })
    await asked.getByTestId('inline-thread-input').fill('why this branch?')
    await asked.getByTestId('inline-thread-input').press('Control+Enter')

    await expect.poll(() => sendCalls.length).toBe(1)
    expect(sendCalls[0]).toEqual({ prompt: '> context window\n\nwhy this branch?' })
    await expect(composer).toHaveValue('unrelated')
    await expect(buffered.getByTestId('inline-thread-input')).toHaveValue('still buffered')
  })

  // SPEC: chat:inline-replies-standalone-quote-sent
  test('a quote spanning several lines goes as one blockquote, every line marked', async ({
    page,
  }) => {
    const sendCalls = await routeForkCapturingSends(page)
    const controller = await openLiveSession(page)
    await controller.sendEvents([
      { type: 'user', subtype: 'text', content: 'Show it', is_human: true, turn_id: 'turn_001' },
      { type: 'assistant', subtype: 'text', content: '```\nfirst line\nsecond line\n```' },
      { type: 'result', subtype: 'success', turn_id: 'turn_001' },
    ])
    await expect(page.locator('[data-testid="message-assistant"]').first()).toContainText(
      'second line',
    )
    await disableAutoCollapse(page)

    // The highlighted block splits each word into its own text node; select first word to last.
    await expect(async () => {
      await page.evaluate(() => {
        const msg = document.querySelector('[data-testid="message-assistant"]')
        const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT)
        const nodes = []
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          nodes.push(n)
        }
        const start = nodes.find(n => n.textContent === 'first')
        const end = nodes.findLast(n => n.textContent === 'line')
        const range = document.createRange()
        range.setStart(start, 0)
        range.setEnd(end, end.textContent.length)
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
      await page.locator('[data-testid="quote-affordance"]').click({ timeout: 1500 })
    }).toPass({ timeout: 15000, intervals: [200, 400, 800] })
    const input = page.locator('.inline-float').getByTestId('inline-thread-input')
    await input.fill('explain')
    await input.press('Control+Enter')

    await expect.poll(() => sendCalls.length).toBe(1)
    expect(sendCalls[0]).toEqual({ prompt: '> first line\n> second line\n\nexplain' })
  })

  // SPEC: chat:inline-replies-standalone-rendering
  test('a box draws its own exchange as the conversation draws a turn - formatted text and tool calls', async ({
    page,
  }) => {
    const { controller, float } = await askInSideSession(page, 'show me')
    await controller.sendToSession('side-1', {
      type: 'user',
      subtype: 'text',
      content: 'show me',
      is_human: true,
      turn_id: 'side_turn_1',
    })
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Bash',
      tool_use_id: 'side_tool_1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      turn_id: 'side_turn_1',
      ts: new Date().toISOString(),
    })
    await controller.sendToSession('side-1', {
      type: 'user',
      subtype: 'tool_result',
      content: 'README.md',
      tool_use_id: 'side_tool_1',
      turn_id: 'side_turn_1',
      ts: new Date().toISOString(),
    })
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      content: '| file | kind |\n|---|---|\n| README.md | doc |\n\n```sh\nls\n```',
      turn_id: 'side_turn_1',
    })
    await controller.sendToSession('side-1', { type: 'result', turn_id: 'side_turn_1' })

    await expect(float.getByTestId('tool-block')).toBeVisible()
    await expect(float.locator('table')).toContainText('README.md')
    await expect(float.locator('pre[data-md-block]')).toContainText('ls')
    await expect(float).not.toContainText('|---|')
    await expect(float).not.toContainText('```')
    await expect(page.locator('.chat-messages [data-testid="tool-block"]')).toHaveCount(0)
  })

  // SPEC: chat:focused-view-hides
  test("in Focused a box's own exchange leaves out a read, as the transcript does", async ({
    page,
  }) => {
    await page.route(/\/ui-state/, route =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { global: {}, session: {} } })
        : route.fulfill({ json: { status: 'ok' } }),
    )
    const { controller, float } = await askInSideSession(page, 'check it')
    const side = event => controller.sendToSession('side-1', { turn_id: 'side_turn_1', ...event })
    await side({ type: 'user', subtype: 'text', content: 'check it', is_human: true })
    for (const [id, name, input] of [
      ['side_read', 'Read', { file_path: '/home/user/project/notes.md' }],
      ['side_bash', 'Bash', { command: 'git status' }],
    ]) {
      await side({
        type: 'assistant',
        subtype: 'tool_use',
        content: name,
        tool_name: name,
        tool_use_id: id,
        tool_input: input,
      })
      await side({ type: 'user', subtype: 'tool_result', content: 'ok', tool_use_id: id })
    }
    await side({ type: 'assistant', subtype: 'text', content: 'Checked.' })
    await side({ type: 'result' })

    await expect(float.locator('[data-tool-use-id="side_bash"]')).toBeVisible()
    await expect(float.locator('[data-tool-use-id="side_read"]')).toHaveCount(0)

    await page.getByTestId('right-slot-view-everything').click()
    await expect(float.locator('[data-tool-use-id="side_read"]')).toBeVisible()
  })

  // SPEC: chat:inline-replies-standalone-exclusive
  test('a finished box stays put while the conversation it was quoted from answers something else', async ({
    page,
  }) => {
    const { controller, float } = await askInSideSession(page, 'why this branch?')
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      content: 'because it handles the edge case',
    })
    await controller.sendToSession('side-1', { type: 'result' })
    await expect(float).toContainText('because it handles the edge case')

    const turnCountBefore = await page.locator('.chat-messages [data-testid^="turn-"]').count()
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
    await expect(page.locator('.chat-messages [data-testid^="turn-"]')).toHaveCount(
      turnCountBefore + 1,
    )
    await expect(float).toContainText('because it handles the edge case')
    await expect(float).not.toContainText('a second answer')
  })

  // SPEC: chat:inline-replies-standalone-exclusive
  test('a box still arriving keeps its working indicator when the conversation it was quoted from finishes its own answer', async ({
    page,
  }) => {
    const { controller, float } = await askInSideSession(page, 'why this branch?')
    await expect(float.getByTestId('turn-progress-working')).toBeVisible()

    // The source conversation answers something else, start to finish, while the box's own
    // answer never arrives - the box's working indicator must survive it untouched.
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

    await expect(page.locator('.chat-messages [data-testid^="turn-"]').last()).toContainText(
      'a second answer',
    )
    await expect(float.getByTestId('turn-progress-working')).toBeVisible()
    await expect(float).not.toContainText('a second answer')
  })

  // SPEC: chat:inline-replies-standalone-isolated
  test('asking one reply on its own leaves every other buffered reply untouched', async ({
    page,
  }) => {
    await routeForkAndSend(page)
    await seedAssistantTurn(page)

    await quote(page, 'runtime')
    const floatA = page.locator('.inline-float', { hasText: 'runtime' })
    await floatA.getByTestId('inline-thread-input').fill('reply A - asked')

    await quote(page, 'context window')
    const floatB = page.locator('.inline-float', { hasText: 'context window' })
    await floatB.getByTestId('inline-thread-input').fill('reply B - buffered')

    // Ask only float A.
    await floatA.getByTestId('inline-thread-input').press('Control+Enter')
    await expect(floatA).toContainText('reply A - asked')

    // Float B is still a plain, editable composer with its own text intact.
    const secondInput = floatB.getByTestId('inline-thread-input')
    await expect(secondInput).toBeVisible()
    await expect(secondInput).toHaveValue('reply B - buffered')
    await expect(page.locator('.inline-float')).toHaveCount(2)
  })

  // SPEC: chat:inline-replies-standalone-reload
  // SPEC: chat:inline-replies-standalone-quote-sent
  test('reload shows a finished standalone exchange in full', async ({ page }) => {
    await routeAnsweredThread(page)
    await reopenLinkedThread(page)
    const reopened = page.locator('.inline-float')
    await expect(reopened.locator('.inline-thread-quote-text')).toHaveText('context window')
    await expect(
      reopened.getByTestId('message-user').first().locator('.message-content'),
    ).toHaveText('why this branch?')
    await expect(reopened).toContainText('because it handles the edge case')
    // Still a live thread, not the old batch read-only div - a follow-up field is offered.
    await expect(reopened.getByTestId('inline-thread-input')).toBeVisible()
    await expect(reopened.getByTestId('inline-thread-input')).toBeEnabled()
  })

  // SPEC: chat:inline-replies-close-focus
  test('Tab at the end of a box answered on its own closes it and focuses the message box', async ({
    page,
  }) => {
    await routeAnsweredThread(page)
    await reopenLinkedThread(page)
    const followUp = page.locator('.inline-float [data-testid="inline-thread-input"]')
    await followUp.click()

    await followUp.press('Tab')

    await expect(page.locator('.inline-float')).toHaveCount(0)
    await expect(page.locator('[data-testid="chat-input"]')).toBeFocused()
  })

  // SPEC: tool:answer-focus
  test("answering a box's own question puts the cursor in its follow-up field", async ({
    page,
  }) => {
    await routeUnansweredThread(page)
    await page.route('**/sessions/side-1/resume', async route => {
      await route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } })
    })
    await acceptSends(page)
    await reopenLinkedThread(page)

    const form = page.locator('.inline-float .tool-questions-interactive')
    await form.locator('.tool-question-option:not(.other)').first().click()
    await form.locator('.tool-submit-btn').click()

    await expect(page.locator('.inline-float [data-testid="inline-thread-input"]')).toBeFocused()
    await expect(page.locator('[data-testid="chat-input"]')).not.toBeFocused()
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
    await reopenLinkedThread(page)
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
    await reopenLinkedThread(page)
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
    await page.route('**/sessions/side-1/resume', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    const sendCalls = await recordSends(page)
    await routeAnsweredThread(page, 'why this branch?')
    await reopenLinkedThread(page)
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
    await routeFork(page)
    await page.route('**/sessions/side-1/resume', async route => {
      await route.fulfill({
        status: 200,
        json: { session_id: 'side-1', container_id: 'test-cid' },
      })
    })
    const sendCalls = await recordSends(page)
    const controller = await seedAssistantTurn(page)

    await quote(page, 'context window')
    const float = page.locator('.inline-float')
    const input = float.getByTestId('inline-thread-input')
    await input.fill('why this branch?')
    await input.press('Control+Enter')

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

  /** Ask `why this branch?` on its own and return the box, its history and the SSE controller. */
  async function askAndOpenThread(page) {
    await page.route('**/sessions/*/fork', route =>
      route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } }),
    )
    await page.route('**/sessions/side-1/resume', route =>
      route.fulfill({ status: 200, json: { session_id: 'side-1', container_id: 'test-cid' } }),
    )
    await acceptSends(page)
    const controller = await seedAssistantTurn(page)
    await quote(page, 'context window')
    const float = page.locator('.inline-float')
    await float.getByTestId('inline-thread-input').fill('why this branch?')
    await float.getByTestId('inline-thread-input').press('Control+Enter')
    await expect.poll(() => controller.hasOpenSession('side-1')).toBe(true)
    await controller.sendToSession('side-1', {
      type: 'user',
      is_human: true,
      turn_id: 'side_turn_1',
      content: 'why this branch?',
    })
    return { controller, float, history: float.getByTestId('inline-thread-history') }
  }

  /** Send `count` numbered lines as one answer chunk, and wait until the box shows the last. */
  async function sendLines(controller, float, label, count = 12) {
    const lines = Array.from({ length: count }, (_, i) => `${label} line ${i + 1}`)
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      turn_id: 'side_turn_1',
      content: lines.join('\n\n'),
    })
    await expect(float).toContainText(lines.at(-1))
  }

  function historyGap(history) {
    return history.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
  }

  async function wheelHistory(page, history, deltaY, deltaX = 0) {
    const box = await history.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(deltaX, deltaY)
  }

  // SPEC: chat:inline-replies-standalone-follows
  test('a box follows its answer while its end is in view, holds still once scrolled up, and follows again back at the end', async ({
    page,
  }) => {
    const { controller, float, history } = await askAndOpenThread(page)

    await sendLines(controller, float, 'first')
    await waitForStableScrollHeight(history)
    expect(await history.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    expect(await historyGap(history)).toBeLessThanOrEqual(50)

    await wheelHistory(page, history, -2000)
    await expect.poll(() => history.evaluate(el => el.scrollTop)).toBe(0)
    await sendLines(controller, float, 'second')
    await waitForStableScrollHeight(history)
    expect(await history.evaluate(el => el.scrollTop)).toBe(0)

    await wheelHistory(page, history, 50000)
    await expect.poll(() => historyGap(history)).toBeLessThanOrEqual(50)
    await sendLines(controller, float, 'third')
    await waitForStableScrollHeight(history)
    expect(await historyGap(history)).toBeLessThanOrEqual(50)
  })

  // SPEC: chat:inline-replies-standalone-follows
  test('scrolling a wide code block in a box keeps it following, and a follow-up asked after scrolling up lands at the end', async ({
    page,
  }) => {
    const { controller, float, history } = await askAndOpenThread(page)
    await sendLines(controller, float, 'first')
    await controller.sendToSession('side-1', {
      type: 'assistant',
      subtype: 'text',
      turn_id: 'side_turn_1',
      content: `\`\`\`\n${'wide_'.repeat(80)}\n\`\`\``,
    })
    const code = float.locator('.code-block-wrapper > div').first()
    await expect(code).toBeVisible()
    await waitForStableScrollHeight(history)
    expect(await historyGap(history)).toBeLessThanOrEqual(50)

    const codeBox = await code.boundingBox()
    await page.mouse.move(codeBox.x + codeBox.width / 2, codeBox.y + codeBox.height / 2)
    await page.mouse.wheel(400, 0)
    await expect.poll(() => code.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    await sendLines(controller, float, 'second')
    await waitForStableScrollHeight(history)
    expect(await historyGap(history)).toBeLessThanOrEqual(50)

    await wheelHistory(page, history, -2000)
    await expect.poll(() => history.evaluate(el => el.scrollTop)).toBe(0)
    await float.getByTestId('inline-thread-input').fill('and the else branch?')
    await float.getByTestId('inline-thread-input').press('Enter')
    await expect(float).toContainText('and the else branch?')
    await waitForStableScrollHeight(history)
    expect(await historyGap(history)).toBeLessThanOrEqual(50)
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
    await acceptSends(page)
    await seedAssistantTurn(page)

    await askWhyThisBranch(page)
    await expect.poll(() => forkCalls.length).toBe(1)

    return page.locator('.inline-float')
  }

  // SPEC: chat:inline-replies-standalone-promote
  test('promoting opens a new tab on the promoted session, stops the source first, and freezes the float', async ({
    page,
  }) => {
    const forkCalls = []
    const calls = []
    await page.route('**/api/sessions/side-1/stop', async route => {
      calls.push('stop')
      await route.fulfill({ status: 200, json: {} })
    })
    await routeAnsweredThread(page, 'why this branch?')
    await stubWindowOpen(page)

    const float = await askInFloat(page, forkCalls)
    await page.route('**/sessions/*/fork', async route => {
      calls.push('fork')
      await route.fallback()
    })
    const turnCountBefore = await page.locator('.chat-messages [data-testid^="turn-"]').count()

    await expect(float.getByTestId('inline-thread-promote')).toBeVisible()
    await float.getByTestId('inline-thread-promote').click()

    // Fork #2 targets the SIDE session, re-parented to the main conversation, no shared container.
    await expect.poll(() => forkCalls.length).toBe(2)
    expect(forkCalls[1].url).toContain('/sessions/side-1/fork')
    expect(forkCalls[1].body).toMatchObject({ parent_session_id: DEFAULT_SESSION_ID })
    expect(forkCalls[1].body.share_container).toBeFalsy()

    // The source is stopped before the fork - the ordering `useChatRewindFork` guarantees.
    expect(calls).toEqual(['stop', 'fork'])

    // A real tab opens on the PROMOTED session - never the side session or the main one.
    await expect.poll(() => page.evaluate(() => window.__windowOpenCalls.length)).toBe(1)
    const windowOpenCalls = await page.evaluate(() => window.__windowOpenCalls)
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
    expect(await page.locator('.chat-messages [data-testid^="turn-"]').count()).toBe(
      turnCountBefore,
    )
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
    await routeAnsweredThread(page, 'why this branch?')
    await reopenLinkedThread(page, { promotedSessionId: 'promoted-1' })

    const reopened = page.locator('.inline-float')
    await expect(reopened).toContainText('why this branch?')
    await expect(reopened).toContainText('because it handles the edge case')
    await expect(reopened.getByTestId('inline-thread-input')).toHaveCount(0)
    await expect(reopened.getByTestId('inline-thread-promote')).toHaveCount(0)
    await expect(reopened.getByTestId('inline-thread-moved-link')).toBeVisible()
  })

  // SPEC: tool:askuser-read-only
  test("a frozen box's unanswered question shows disabled and cannot be answered", async ({
    page,
  }) => {
    await routeUnansweredThread(page)
    await reopenLinkedThread(page, { promotedSessionId: 'promoted-1' })

    await expectQuestionReadOnly(page.locator('.inline-float'))
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
  /** The source and its side thread share one container; resume answers for the session it names,
   * and the container mock answers session data for the session a request names. */
  async function mockRailPromotion(page) {
    await mockAPI(page, {
      handlers: {
        getSessions: sessionsHandler([
          { session_id: DEFAULT_SESSION_ID, name: null, parent_session_id: null },
          {
            session_id: 'side-1',
            name: null,
            parent_session_id: DEFAULT_SESSION_ID,
            container_id: DEFAULT_CONTAINER_ID,
            is_side_thread: true,
          },
        ]),
        resumeSession: resumeNamedSession,
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
    await acceptSends(page)
    await seedAssistantTurn(page)

    await askWhyThisBranch(page)
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
  // SPEC: chat:rail-promote-any-time
  test('promoting onto the rail cancels auto-stop, navigates in place, and leaves two groups with the thread focused', async ({
    page,
  }) => {
    const promoteCalls = []
    await page.route('**/api/sessions/side-1/promote', async route => {
      promoteCalls.push(true)
      await route.fulfill({ status: 200, json: {} })
    })
    await routeAnsweredThread(page, 'why this branch?')

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

  // SPEC: chat:rail-promoted-thread-acts-on-itself
  test('the focused group of a promoted thread reads, sends to and configures the thread', async ({
    page,
  }) => {
    await page.route('**/api/sessions/side-1/promote', async route => {
      await route.fulfill({ status: 200, json: {} })
    })
    const float = await askInFloat(page, [])
    const sends = []
    const models = []
    await page.route('**/api/send*', async route => {
      const { prompt } = route.request().postDataJSON()
      sends.push(`${prompt} -> ${new URL(route.request().url()).searchParams.get('session_id')}`)
      await route.fulfill({ status: 200, json: {} })
    })
    await page.route('**/api/model*', async route => {
      models.push(new URL(route.request().url()).searchParams.get('session_id'))
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    })

    await float.getByTestId('inline-thread-promote-rail').click()
    await expect(page).toHaveURL(/\/sessions\/side-1$/)
    await expect(page.locator('[data-testid="footer-session"]')).toHaveText('side')

    await page.locator('[data-testid="footer-model"]').click()
    await page
      .locator('[data-testid="model-dropdown"]')
      .getByText('Haiku 5.5', { exact: true })
      .click()
    await expect.poll(() => models).toEqual(['side-1'])

    await page.locator('[data-testid="chat-input"]').fill('and the other branch?')
    await page.locator('[data-testid="chat-input"]').press('Enter')
    await expect.poll(() => sends).toContain('and the other branch? -> side-1')
  })

  // SPEC: chat:inline-replies-rail-promote
  test('clicking the promoted quote highlight in the ancestor focuses the thread group', async ({
    page,
  }) => {
    await page.route('**/api/sessions/side-1/promote', async route => {
      await route.fulfill({ status: 200, json: {} })
    })
    await routeAnsweredThread(page, 'why this branch?')

    const float = await askInFloat(page, [])
    await float.getByTestId('inline-thread-promote-rail').click()
    await expect(page).toHaveURL(/\/sessions\/side-1$/)
    await expect.poll(() => highlightRangeCount(page, 'inline-quote-ancestor')).toBe(1)

    // The source is already the ancestor here, so click its read-only copy of the quote: a
    // refocused source would need an SSE reconnect replay this harness leaves empty.
    await clickQuotedSpan(page, 'context window')

    await expect(page).toHaveURL(/\/sessions\/side-1$/)
  })

  // SPEC: chat:inline-replies-hover-tab
  test('Tab over a reply promoted onto the rail focuses its group', async ({ page }) => {
    await routeUnansweredThread(page)
    await reopenLinkedThread(page, { railPromoted: true })

    await page.keyboard.press('Tab')

    await expect(page).toHaveURL(/\/sessions\/side-1$/)
  })

  // SPEC: chat:inline-replies-standalone-quote-sent
  test("a rail-promoted reply's card shows its first question as the reply alone under its quote", async ({
    page,
  }) => {
    await routeAnsweredThread(page)
    await reopenLinkedThread(page, { railPromoted: true })

    const card = page.locator('[data-testid="promoted-thread-card"]')
    await expect(card.locator('.inline-thread-quote-text')).toHaveText('context window')
    await expect(card.getByTestId('message-user').first().locator('.message-content')).toHaveText(
      'why this branch?',
    )
  })

  // SPEC: tool:askuser-read-only
  test("a rail-promoted reply's card shows its unanswered question disabled", async ({ page }) => {
    await routeUnansweredThread(page)
    await reopenLinkedThread(page, { railPromoted: true })

    await expectQuestionReadOnly(page.locator('[data-testid="promoted-thread-card"]'))
  })
})
