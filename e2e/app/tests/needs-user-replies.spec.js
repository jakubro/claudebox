/** E2E tests for the one-click replies an agent's ask offers at the end of its message. */

import { expect, test } from '@playwright/test'
import { acceptSends, captureLastSend, captureSends, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, loadFixture, mockAPI } from '../mocks/api.js'
import { createSSEController, loadEventsFromFixture, mockSSE } from '../mocks/sse.js'

const REPLIES = ['Go', 'Hold']
const EDIT = 'Edit in message box'

/** Serve the open session as needing the user with `replies`, until the test changes them. */
async function mockNeedsUser(page, state) {
  await page.route('**/api/sessions/current**', async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback()
    }
    await route.fulfill({
      json: {
        ...loadFixture('status/default.json'),
        needs_user: state.replies ? 'Approve: file the ticket' : null,
        needs_user_replies: state.replies,
      },
    })
  })
}

test.describe('Needs-you replies', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: notify:needs-you-replies
  // SPEC: notify:needs-you-replies-last
  test('the offered replies show as the last thing in the agent message, the first highlighted', async ({
    page,
  }) => {
    await loadReplies(page)

    const message = page.locator('[data-testid="message-assistant"]').last()
    const row = message.getByTestId('needs-user-replies')
    await expect(row).toBeVisible()
    const labels = row.locator('button:not(.needs-user-reply-edit)')
    await expect(labels).toHaveText(REPLIES)
    await expect(labels.first()).toHaveClass(/needs-user-reply-primary/)
    expect(await row.evaluate(el => el === el.closest('.turn-content').lastElementChild)).toBe(true)
    const textBottom = await message
      .getByText('file the ticket')
      .last()
      .evaluate(el => el.getBoundingClientRect().bottom)
    const rowTop = await row.evaluate(el => el.getBoundingClientRect().top)
    expect(rowTop).toBeGreaterThan(textBottom)
  })

  // SPEC: notify:needs-you-replies-send
  // SPEC: tool:answer-focus
  test('a click sends the reply at once with the composer text, and the buttons leave', async ({
    page,
  }) => {
    const sent = await captureLastSend(page)
    await loadReplies(page)

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('but skip the docs')
    await page.getByRole('button', { name: 'Go', exact: true }).click()

    await expect.poll(() => sent.payload).not.toBeNull()
    expect(sent.payload.prompt).toBe('Go')
    expect(sent.payload.note).toBe('but skip the docs')
    await expect(input).toHaveValue('')
    await expect(page.getByTestId('needs-user-replies')).toHaveCount(0)
    await expect(input).toBeFocused()
  })

  // SPEC: notify:needs-you-replies-bubble
  test('a reply sent with composer text shows the reply, a rule, then the text', async ({
    page,
  }) => {
    await acceptSends(page)
    const controller = await createSSEController(page)
    await mockNeedsUser(page, { replies: REPLIES })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await controller.sendEvents(loadEventsFromFixture('events/needs-user-replies.jsonl'))

    const note = 'but skip the docs\n\nand the tests'
    await page.locator('[data-testid="chat-input"]').fill(note)
    await page.getByRole('button', { name: 'Go', exact: true }).click()

    const pending = page.locator('[data-testid="message-user"]').last()
    await expectReplyThenRuleThenNote(pending, 'Go', note)

    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        primary: true,
        content: 'Go',
        note,
        turn_id: 'turn_002',
        ts: '2025-01-18T12:01:00Z',
        id: 'evt_100',
      },
    ])
    await expect(page.locator('[data-testid="message-user"]')).toHaveCount(2)
    await expectReplyThenRuleThenNote(
      page.locator('[data-testid="message-user"]').last(),
      'Go',
      note,
    )
  })

  test('a reply sent from an empty composer shows no rule', async ({ page }) => {
    await acceptSends(page)
    await loadReplies(page)

    await page.getByRole('button', { name: 'Go', exact: true }).click()

    const bubble = page.locator('[data-testid="message-user"]').last()
    await expect(bubble.locator('.message-content')).toHaveText('Go')
    await expect(bubble.locator('.message-note-rule')).toHaveCount(0)
  })

  // SPEC: tool:answer-focus
  test('a field clicked while the reply is sending keeps the cursor', async ({ page }) => {
    let releaseSend
    const sendHeld = new Promise(resolve => {
      releaseSend = resolve
    })
    let sent = false
    await page.route('**/api/send*', async route => {
      await sendHeld
      sent = true
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await loadReplies(page)

    await page.getByRole('button', { name: 'Go', exact: true }).click()
    await quoteAssistantText(page, 'file it now')
    const replyBox = page.locator('.inline-float [data-testid="inline-thread-input"]')
    await expect(replyBox).toBeFocused()
    releaseSend()

    await expect.poll(() => sent).toBe(true)
    await page.waitForTimeout(300)
    await expect(replyBox).toBeFocused()
  })

  // SPEC: chat:inline-replies-send-once
  test('Enter right after a one-click reply carrying a buffered reply sends nothing more', async ({
    page,
  }) => {
    const sendCalls = []
    let releaseSend
    const sendHeld = new Promise(resolve => {
      releaseSend = resolve
    })
    await page.route('**/api/send*', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await sendHeld
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await loadReplies(page)

    await quoteAssistantText(page, 'file it now')
    await page.locator('.inline-float [data-testid="inline-thread-input"]').fill('MY-REPLY')
    await page.getByRole('button', { name: 'Go', exact: true }).click()
    await expect.poll(() => sendCalls.length).toBe(1)
    await page.locator('[data-testid="chat-input"]').press('Enter')
    releaseSend()

    await page.waitForTimeout(300)
    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0].prompt).toBe('Go')
    expect(sendCalls[0].inline_replies.map(r => r.response)).toEqual(['MY-REPLY'])
  })

  test('a failed send gives the composer its text back and keeps the buttons', async ({ page }) => {
    await page.route('**/api/send*', route => route.fulfill({ status: 500 }))
    await loadReplies(page)

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('but skip the docs')
    await page.getByRole('button', { name: 'Go', exact: true }).click()

    await expect(page.getByText('Send failed')).toBeVisible()
    await expect(input).toHaveValue('but skip the docs')
    await expect(input).toBeFocused()
    await expect(page.getByRole('button', { name: 'Go', exact: true })).toBeEnabled()
  })

  test('Enter on an empty composer sends nothing', async ({ page }) => {
    let sent = false
    await page.route('**/api/send*', async route => {
      sent = true
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await openWithReplies(page)

    await page.locator('[data-testid="chat-input"]').press('Enter')

    await page.waitForTimeout(300)
    expect(sent).toBe(false)
    await expect(page.getByTestId('needs-user-replies')).toBeVisible()
  })

  // SPEC: notify:needs-you-replies-edit
  test("a reply's arrow puts its text in the message box with the cursor at the end and sends nothing", async ({
    page,
  }) => {
    let sent = false
    await page.route('**/api/send*', async route => {
      sent = true
      await route.fulfill({ status: 200, json: { success: true } })
    })
    await openWithReplies(page)

    const arrows = page.getByTestId('needs-user-replies').getByTitle(EDIT)
    await expect(arrows).toHaveCount(2)
    await arrows.nth(1).click()

    expect(await composerState(page)).toEqual({ value: 'Hold', focused: true, caretAtEnd: true })
    await page.waitForTimeout(300)
    expect(sent).toBe(false)
    await expect(arrows).toHaveCount(2)
  })

  // SPEC: notify:needs-you-replies-edit
  test('a reply put in the box closes an open command picker, so Enter sends the reply', async ({
    page,
  }) => {
    const sendCalls = await captureSends(page)
    await openWithReplies(page)
    const input = page.locator('[data-testid="chat-input"]')
    await input.pressSequentially('/')
    await expect(page.getByTestId('command-autocomplete')).toBeVisible()

    await page.getByTestId('needs-user-replies').getByTitle(EDIT).nth(0).click()
    await expect(page.getByTestId('command-autocomplete')).toHaveCount(0)
    await input.press('Enter')

    await expect.poll(() => sendCalls.length).toBe(1)
    expect(sendCalls[0].prompt).toBe('Go')
  })

  // SPEC: notify:needs-you-replies-edit-keeps-draft
  test('text typed in the message box moves onto the draft stack, and the same reply twice keeps one copy', async ({
    page,
  }) => {
    await openWithReplies(page)
    const input = page.locator('[data-testid="chat-input"]')
    const arrows = page.getByTestId('needs-user-replies').getByTitle(EDIT)

    await input.fill('also check the logs')
    await arrows.nth(0).click()
    await expect(input).toHaveValue('Go')
    await arrows.nth(0).click()
    await expect(input).toHaveValue('Go')

    expect(await walkUp(page)).toEqual(['also check the logs', 'File the ticket?'])
  })

  // SPEC: notify:needs-you-replies-edit-keeps-draft
  test('a reply put in the box while history shows leaves the history item in place', async ({
    page,
  }) => {
    await openWithReplies(page)
    const input = page.locator('[data-testid="chat-input"]')

    await input.fill('fresh words')
    await input.press('Control+Home')
    await input.press('ArrowUp')
    await expect(input).toHaveValue('File the ticket?')
    await page.getByTestId('needs-user-replies').getByTitle(EDIT).nth(1).click()
    await expect(input).toHaveValue('Hold')

    expect(await walkUp(page)).toEqual(['fresh words', 'File the ticket?'])
  })

  // SPEC: notify:needs-you-replies-edit-keeps-draft
  test('a reply put in the box keeps the attachments and the buffered replies', async ({
    page,
  }) => {
    const sendCalls = await captureSends(page)
    await openWithReplies(page)
    await page.evaluate(() => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['kept'], 'notes.txt', { type: 'text/plain' }))
      document
        .querySelector('.chat-input-wrapper')
        .dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
    })
    await expect(page.getByTestId('attachment-preview')).toBeVisible()
    await quoteAssistantText(page, 'file it now')
    await page.locator('.inline-float [data-testid="inline-thread-input"]').fill('MY-REPLY')

    await page.getByTestId('needs-user-replies').getByTitle(EDIT).nth(0).click()
    await expect(page.getByTestId('attachment-preview')).toBeVisible()
    await page.locator('[data-testid="chat-input"]').press('Enter')

    await expect.poll(() => sendCalls.length).toBe(1)
    expect(sendCalls[0].prompt).toBe('Go')
    expect(sendCalls[0].attachments.map(a => a.name)).toEqual(['notes.txt'])
    expect(sendCalls[0].inline_replies.map(r => r.response)).toEqual(['MY-REPLY'])
  })

  // SPEC: notify:needs-you-replies-edit-sends-plain
  test('a reply edited in the message box sends as an ordinary message and the buttons leave', async ({
    page,
  }) => {
    const sendCalls = await captureSends(page)
    await openWithReplies(page)

    await page.getByTestId('needs-user-replies').getByTitle(EDIT).nth(1).click()
    await page.keyboard.type(' please')
    await page.keyboard.press('Enter')

    await expect.poll(() => sendCalls.length).toBe(1)
    expect(sendCalls[0].prompt).toBe('Hold please')
    expect(sendCalls[0].note ?? '').toBe('')
    const bubble = page.locator('[data-testid="message-user"]').last()
    await expect(bubble.locator('.message-content')).toHaveText('Hold please')
    await expect(bubble.locator('.message-note-rule')).toHaveCount(0)
    await expect(page.getByTestId('needs-user-replies')).toHaveCount(0)
  })

  // SPEC: notify:needs-you-replies-replaced
  test('a question asked after the replies removes them, and an earlier turn never shows them', async ({
    page,
  }) => {
    const controller = await createSSEController(page)
    await mockNeedsUser(page, { replies: REPLIES })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const events = loadEventsFromFixture('events/needs-user-replies.jsonl')
    await controller.sendEvents(events)
    await expect(page.getByTestId('needs-user-replies')).toBeVisible()

    await controller.sendEvents([
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'AskUserQuestion',
        tool_use_id: 'tu_ask_1',
        tool_input: {
          questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }] }],
        },
        ts: '2025-01-18T12:00:05Z',
        id: 'evt_007',
      },
    ])
    await expect(page.getByTestId('needs-user-replies')).toHaveCount(0)

    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'A',
        turn_id: 'turn_002',
        ts: '2025-01-18T12:01:00Z',
        id: 'evt_008',
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Done.',
        turn_id: 'turn_002',
        ts: '2025-01-18T12:01:01Z',
        id: 'evt_009',
      },
    ])
    await expect(page.getByText('Done.')).toBeVisible()
    await expect(page.getByTestId('needs-user-replies')).toHaveCount(0)
  })
})

async function loadReplies(page) {
  await mockSSE(page, 'events/needs-user-replies.jsonl')
  await mockNeedsUser(page, { replies: REPLIES })
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)
}

async function openWithReplies(page) {
  await loadReplies(page)
  await expect(page.getByTestId('needs-user-replies')).toBeVisible()
}

function composerState(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-input"]')
    return {
      value: el.value,
      focused: document.activeElement === el,
      caretAtEnd: el.selectionStart === el.value.length && el.selectionEnd === el.value.length,
    }
  })
}

async function walkUp(page) {
  const input = page.locator('[data-testid="chat-input"]')
  await input.press('Control+Home')
  const seen = []
  for (let i = 0; i < 8; i++) {
    await input.press('ArrowUp')
    const value = await input.inputValue()
    if (value === seen.at(-1)) {
      break
    }
    seen.push(value)
  }
  return seen
}

/** Assert `bubble` draws the reply, then a rule, then the note, in document order. */
async function expectReplyThenRuleThenNote(bubble, reply, note) {
  await expect(bubble.locator('.message-content')).toHaveText(reply)
  await expect(bubble.locator('.message-note-rule')).toHaveCount(1)
  expect(await bubble.locator('.message-note').evaluate(el => el.textContent)).toBe(note)
  const ordered = await bubble.evaluate(el => {
    const [content, rule, noteEl] = ['.message-content', '.message-note-rule', '.message-note'].map(
      sel => el.querySelector(sel),
    )
    const follows = (a, b) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    return follows(content, rule) && follows(rule, noteEl)
  })
  expect(ordered).toBe(true)
}

/** Select `substring` in the first assistant message and click the quote button. */
async function quoteAssistantText(page, substring) {
  await expect(async () => {
    await page.evaluate(sub => {
      const msg = document.querySelector('[data-testid="message-assistant"]')
      const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const idx = node.textContent.indexOf(sub)
        if (idx >= 0) {
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + sub.length)
          window.getSelection().removeAllRanges()
          window.getSelection().addRange(range)
          document.dispatchEvent(new Event('selectionchange'))
          return
        }
      }
    }, substring)
    await page.locator('[data-testid="quote-affordance"]').click({ timeout: 1500 })
  }).toPass({ timeout: 10000 })
}
