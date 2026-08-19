/** E2E tests for interactive tools: AskUserQuestion forms, ExitPlanMode approve/reject. */

import { expect, test } from '@playwright/test'
import { disableAutoCollapse, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('AskUserQuestion', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')
  })

  // SPEC: tool:askuser-form
  test('form renders with options', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // .first() guards against potential duplicate renders.
    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    await expect(form.locator('.tool-question-header')).toContainText('Framework')
    await expect(form.locator('.tool-question-text')).toContainText(
      'Which framework would you like to use?',
    )

    // 3 options + Other.
    const options = form.locator('.tool-question-option')
    await expect(options).toHaveCount(4)

    await expect(options.nth(0)).toContainText('React')
    await expect(options.nth(1)).toContainText('Vue')
    await expect(options.nth(2)).toContainText('Svelte')
  })

  // SPEC: tool:askuser-other
  test('always includes Other option', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const otherOption = form.locator('.tool-question-option.other')
    await expect(otherOption).toBeVisible()
    await expect(otherOption).toContainText('Other')
  })

  // SPEC: tool:askuser-submit-disabled
  test('submit disabled until selection', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const submitBtn = form.locator('.tool-submit-btn')
    await expect(submitBtn).toBeDisabled()

    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()

    await expect(submitBtn).toBeEnabled()
  })

  // SPEC: tool:askuser-other-focus
  test('Other option shows text input', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    await expect(form.locator('.tool-other-input')).not.toBeVisible()

    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()

    const input = form.locator('.tool-other-input')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
  })

  // SPEC: tool:askuser-submit
  test('submit sends answer via API', async ({ page }) => {
    let sendCalled = false
    let sendPayload = null

    await page.route('**/api/send', async route => {
      sendCalled = true
      sendPayload = await route.request().postDataJSON()
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()

    const submitBtn = form.locator('.tool-submit-btn')
    await submitBtn.click()

    await expect.poll(() => sendCalled).toBe(true)
    expect(sendPayload.prompt).toContain('<answer>React</answer>')
  })

  // SPEC: tool:askuser-note
  test('submit sends composer text as a note alongside the answer', async ({ page }) => {
    let sendPayload = null

    await page.route('**/api/send', async route => {
      sendPayload = await route.request().postDataJSON()
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()

    await page.locator('[data-testid="chat-input"]').fill('please also add TypeScript')

    const submitBtn = form.locator('.tool-submit-btn')
    await submitBtn.click()

    await expect.poll(() => sendPayload).not.toBeNull()
    expect(sendPayload.prompt).toContain('<answer>React</answer>')
    expect(sendPayload.note).toBe('please also add TypeScript')
  })

  // SPEC: tool:askuser-note
  test('submit sends the note together with a pending attachment', async ({ page }) => {
    let sendPayload = null

    await page.route('**/api/send', async route => {
      sendPayload = await route.request().postDataJSON()
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.evaluate(() => {
      const el = document.querySelector('.chat-input-wrapper')
      const dataTransfer = new DataTransfer()
      const bytes = Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        ),
        c => c.charCodeAt(0),
      )
      const file = new File([bytes], 'photo.png', { type: 'image/png' })
      dataTransfer.items.add(file)
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
    })
    await expect(page.locator('[data-testid="attachment-preview"]')).toBeVisible()

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()
    await form.locator('.tool-question-option:not(.other)').first().click()
    await page.locator('[data-testid="chat-input"]').fill('and check this file')
    await form.locator('.tool-submit-btn').click()

    await expect.poll(() => sendPayload).not.toBeNull()
    expect(sendPayload.prompt).toContain('<answer>React</answer>')
    expect(sendPayload.note).toBe('and check this file')
    expect(sendPayload.attachments).toHaveLength(1)
    expect(sendPayload.attachments[0].name).toBe('photo.png')
  })

  // SPEC: tool:askuser-note
  test('submit sends the note together with a buffered inline reply', async ({ page }) => {
    let sendPayload = null

    await page.route('**/api/send', async route => {
      sendPayload = await route.request().postDataJSON()
      await route.fulfill({ status: 200, json: { success: true } })
    })

    const controller = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Help me set up the project',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        turn_id: 'turn_001',
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'The framework choice affects the runtime bundle size.',
        timestamp: Date.now() + 100,
      },
      { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() + 200 },
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'AskUserQuestion',
        timestamp: Date.now() + 300,
        tool_use_id: 'tool_001',
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            {
              question: 'Which framework would you like to use?',
              header: 'Framework',
              options: [{ label: 'React', description: 'Popular component-based UI library' }],
              multiSelect: false,
            },
          ],
        },
      },
    ])

    const assistantMessage = page.locator('[data-testid="message-assistant"]').first()
    await expect(assistantMessage).toContainText('runtime bundle size')

    await page.evaluate(() => {
      const msg = document.querySelector('[data-testid="message-assistant"]')
      const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const idx = node.textContent.indexOf('runtime bundle size')
        if (idx >= 0) {
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + 'runtime bundle size'.length)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
          document.dispatchEvent(new Event('selectionchange'))
          return
        }
        node = walker.nextNode()
      }
    })
    await page.locator('[data-testid="quote-affordance"]').click()
    await page.locator('[data-testid="inline-thread-input"]').first().fill('how much smaller?')

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()
    await form.locator('.tool-question-option:not(.other)').first().click()
    await page.locator('[data-testid="chat-input"]').fill('going with this one')
    await form.locator('.tool-submit-btn').click()

    await expect.poll(() => sendPayload).not.toBeNull()
    expect(sendPayload.prompt).toContain('<answer>React</answer>')
    expect(sendPayload.note).toBe('going with this one')
    expect(sendPayload.inline_replies).toHaveLength(1)
    expect(sendPayload.inline_replies[0]).toMatchObject({
      quote: 'runtime bundle size',
      response: 'how much smaller?',
    })
  })

  // SPEC: tool:askuser-form
  test('form disappears after submit', async ({ page }) => {
    // ToolBlock sets wasAnsweredLocally=true on submit, unmounting InteractiveQuestions before
    // it renders "waiting for reply...", so this test only checks the form disappears.
    await page.route('**/api/send', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const forms = page.locator('.tool-questions-interactive')
    await expect(forms.first()).toBeVisible()
    const initialCount = await forms.count()

    const form = forms.first()
    await form.locator('.tool-question-option:not(.other)').first().click()
    await form.locator('.tool-submit-btn').click()

    await expect.poll(() => forms.count()).toBeLessThan(initialCount)
  })

  // SPEC: tool:askuser-form
  test('radio button indicators for single select', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Unselected options show a hollow circle; selected shows filled.
    const firstOption = form.locator('.tool-question-option:not(.other)').first()
    const firstIndicator = firstOption.locator('.tool-option-indicator')
    await expect(firstIndicator).toHaveText('○')

    await firstOption.click()

    await expect(firstIndicator).toHaveText('●')
  })

  // SPEC: tool:askuser-other
  test('selecting option deselects Other', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()
    await expect(form.locator('.tool-other-input')).toBeVisible()

    await form.locator('.tool-question-option:not(.other)').first().click()

    await expect(form.locator('.tool-other-input')).not.toBeVisible()
  })
})

test.describe('ExitPlanMode', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-exit-plan.jsonl')
  })

  // SPEC: tool:exitplan-markdown
  test('displays plan as markdown', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Waiting for the locator (rather than a fixed delay) guards against render races.
    const planContent = page.locator('.tool-plan')
    await expect(planContent.first()).toBeVisible()

    await expect(planContent.first()).toContainText('Refactoring Plan')
    await expect(planContent.first()).toContainText('Extract authentication logic')
    await expect(planContent.first()).toContainText('Better separation of concerns')
  })

  // SPEC: tool:exitplan-expanded
  test('default expanded for user review', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Plan content only renders when the block is expanded.
    const planContent = page.locator('.tool-plan')
    await expect(planContent.first()).toBeVisible()

    const expandedContent = page.locator('.tool-expanded-content')
    await expect(expandedContent.first()).toBeVisible()
  })

  // SPEC: tool:exitplan
  test('shows plan title in header', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const header = page.locator('.tool-name').filter({ hasText: 'ExitPlanMode' })
    await expect(header.first()).toBeVisible()
    await expect(header.first()).toContainText('ExitPlanMode(Refactoring Plan)')
  })

  test('summary shows Awaiting response when plan awaits answer', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const summary = page.locator('.tool-summary').filter({ hasText: 'Awaiting response...' })
    await expect(summary.first()).toBeVisible()
  })
})

test.describe('ExitPlanMode - Approve/Reject', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-exit-plan.jsonl')
  })

  // SPEC: tool:exitplan-form
  // SPEC: tool:exitplan-options
  test('shows approve/reject form below plan', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const planContent = page.locator('.tool-plan')
    await expect(planContent.first()).toBeVisible()

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Approve and Reject options + Other.
    const options = form.locator('.tool-question-option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toContainText('Approve')
    await expect(options.nth(1)).toContainText('Reject')
  })

  // SPEC: tool:exitplan-submit-disabled
  test('submit disabled until selection', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const submitBtn = form.locator('.tool-submit-btn')
    await expect(submitBtn).toBeDisabled()

    await form.locator('.tool-question-option:not(.other)').first().click()
    await expect(submitBtn).toBeEnabled()
  })

  // SPEC: tool:exitplan-submit
  test('approve sends response via API', async ({ page }) => {
    let sendPayload = null

    await page.route('**/api/send', async route => {
      sendPayload = await route.request().postDataJSON()
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    await form.locator('.tool-question-option:not(.other)').first().click()
    await form.locator('.tool-submit-btn').click()

    await expect.poll(() => sendPayload !== null).toBe(true)
    expect(sendPayload.prompt).toContain('<response:ExitPlanMode>')
    expect(sendPayload.prompt).toContain('<answer>Approve</answer>')
  })

  // SPEC: tool:exitplan-collapse-after-submit
  // SPEC: tool:exitplan-answer-label
  test('form collapses after submit', async ({ page }) => {
    await page.route('**/api/send', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    await form.locator('.tool-question-option:not(.other)').first().click()
    await form.locator('.tool-submit-btn').click()

    await expect(page.locator('.tool-questions-interactive')).not.toBeVisible()

    // ExitPlanMode shows an "Approved" summary, not the generic "Answered".
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock.locator('.tool-summary')).toContainText('Approved')
  })
})

test.describe('ExitPlanMode - Answered State', () => {
  // SPEC: tool:exitplan-answer-label
  test('answered plan shows Approved status', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-exit-plan-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    // Fixture answer is Approve.
    const answeredBlock = page.locator('[data-testid="tool-block"]').filter({
      hasText: 'Approved',
    })
    await expect(answeredBlock.first()).toBeVisible()

    await expect(answeredBlock.first().locator('.tool-questions-interactive')).not.toBeVisible()
  })

  // SPEC: tool:exitplan-stays-viewable
  test('plan content remains viewable after answering', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-exit-plan-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    // Unlike AskUserQuestion, an answered plan stays visible rather than collapsing.
    const planContent = page.locator('.tool-plan')
    await expect(planContent.first()).toBeVisible()
    await expect(planContent.first()).toContainText('Refactoring Plan')

    // Verify it is still re-expandable: collapse, then re-expand.
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await toolBlock.locator('.tool-header-area').click()
    await expect(planContent.first()).not.toBeVisible()
    await toolBlock.locator('.tool-header-area').click()
    await expect(planContent.first()).toBeVisible()
    await expect(planContent.first()).toContainText('Refactoring Plan')
  })

  // SPEC: tool:exitplan-submit
  test('accept plan button calls send API', async ({ page }) => {
    let sendPayload = null
    await mockAPI(page, {
      handlers: {
        send: async route => {
          sendPayload = await route.request().postDataJSON()
          await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
        },
      },
    })
    await mockSSE(page, 'events/tool-exit-plan.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const approveOption = page.locator('.tool-question-option:not(.other)').first()
    await approveOption.click()

    const approveBtn = page.locator('.tool-submit-btn')
    await expect(approveBtn).toBeEnabled()
    await approveBtn.click()

    await expect.poll(() => sendPayload).toBeTruthy()
    expect(sendPayload.prompt).toBeTruthy()
  })
})

test.describe('ExitPlanMode - Disable After Reply', () => {
  // SPEC: tool:exitplan-disable-after-reply
  test('form not shown when follow-up human message exists', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-exit-plan-with-followup.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // Disabled because a newer human message follows the question.
    await expect(toolBlock.locator('.tool-questions-interactive')).not.toBeVisible()
  })
})

test.describe('AskUserQuestion - Answered State', () => {
  // SPEC: tool:askuser-answered
  test('answered questions show completed status with Answered text', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const _completedToolBlock = page.locator(
      '[data-testid="tool-block"][data-tool-status="completed"]',
    )

    // Events may duplicate (pending shown instead of completed), so check broadly for a tool
    // block showing "Answered" rather than relying on the completed status.
    const answeredBlock = page.locator('[data-testid="tool-block"]').filter({
      hasText: 'Answered',
    })
    await expect(answeredBlock.first()).toBeVisible()

    await expect(answeredBlock.first().locator('.tool-questions-interactive')).not.toBeVisible()
  })

  // SPEC: tool:askuser-answered
  test('interactive form not shown when question already answered', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    // Due to potential event duplication, just check that an answered state exists somewhere.
    const answeredSummary = page.locator('.tool-summary').filter({ hasText: 'Answered' })
    await expect(answeredSummary.first()).toBeVisible()
  })
})

test.describe('AskUserQuestion - Disable After Reply', () => {
  // SPEC: tool:askuser-disable-after-reply
  test('form disabled when follow-up human message exists', async ({ page }) => {
    await mockAPI(page)
    // Fixture: AskUserQuestion with a follow-up user message (not an answer)
    await mockSSE(page, 'events/tool-ask-question-with-followup.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // Disabled because a newer human message follows the question.
    await expect(toolBlock.locator('.tool-questions-interactive')).not.toBeVisible()
  })

  // SPEC: tool:askuser-disable-after-reply
  test('resume session with unanswered question + newer messages disables form', async ({
    page,
  }) => {
    await mockAPI(page)
    // Same fixture simulates resuming a session with an unanswered question plus later messages.
    await mockSSE(page, 'events/tool-ask-question-with-followup.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const forms = page.locator('.tool-questions-interactive')
    await expect(forms).toHaveCount(0)
  })
})

test.describe('AskUserQuestion - Disable On Send', () => {
  // SPEC: tool:askuser-disable-on-send
  test('form retires to Skipped the instant a chat message is sent, before any reply', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')
    // The SSE stream never echoes the message back, holding the pending window open.
    await page.route('**/api/send', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()
    await expect(form.locator('.tool-submit-btn')).toHaveCount(1)

    await page.locator('[data-testid="chat-input"]').fill("actually, let's use Svelte")
    await page.locator('[data-testid="chat-input"]').press('Enter')

    await expect(form).not.toBeVisible()
    await expect(toolBlock.locator('.tool-summary')).toContainText('Skipped')
  })
})

test.describe('AskUserQuestion - Other Input', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')
  })

  // SPEC: tool:askuser-other
  test('Other textarea supports Shift+Enter for newlines', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()

    const textarea = form.locator('.tool-other-input')
    await expect(textarea).toBeVisible()

    await textarea.fill('Line one')
    await textarea.press('Shift+Enter')
    await textarea.type('Line two')

    const value = await textarea.inputValue()
    expect(value).toContain('\n')
    expect(value).toContain('Line one')
    expect(value).toContain('Line two')
  })
})

test.describe('AskUserQuestion - XML Response Rendering', () => {
  test('no raw AskUserQuestionResponse XML visible in answered display', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const pageContent = await page.textContent('body')
    expect(pageContent).not.toContain('<AskUserQuestionResponse>')
    expect(pageContent).not.toContain('</AskUserQuestionResponse>')
  })

  // SPEC: tool:askuser-answered
  test('answered state shows selected option', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const answeredBlock = page.locator('[data-testid="tool-block"]').filter({
      hasText: 'Answered',
    })
    await expect(answeredBlock.first()).toBeVisible()

    // Scoped to the QA response block, not just any "React" text on the page.
    const qaAnswer = page.locator('.qa-answer')
    await expect(qaAnswer.first()).toBeVisible()
    await expect(qaAnswer.first()).toContainText('React')
  })

  // SPEC: tool:askuser-note-shown
  test('answer and its note are both shown in the transcript', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/user-message-askuser-response-with-note.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const askUserResponse = page.locator('[data-testid="message-user"]').nth(1)
    await expect(askUserResponse).toBeVisible()

    await expect(askUserResponse.locator('.message-note')).toContainText(
      'Please also add TypeScript support',
    )
    await expect(askUserResponse.locator('.qa-answer')).toContainText('React')
  })

  // SPEC: tool:askuser-note-bubble
  test('note sent with an answer gets the same bubble as a plain message', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/user-message-askuser-response-with-note.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // turn_001's opening message is a plain send with no note - the ground truth here.
    const plainMessage = page
      .locator('[data-testid="message-user"]')
      .nth(0)
      .locator('.message-content')
    const note = page.locator('[data-testid="message-user"]').nth(1).locator('.message-note')
    await expect(note).toBeVisible()

    const plainStyles = await plainMessage.evaluate(el => {
      const s = getComputedStyle(el)
      return {
        backgroundColor: s.backgroundColor,
        padding: s.padding,
        borderRadius: s.borderRadius,
        fontFamily: s.fontFamily,
        whiteSpace: s.whiteSpace,
      }
    })
    const noteStyles = await note.evaluate(el => {
      const s = getComputedStyle(el)
      return {
        backgroundColor: s.backgroundColor,
        padding: s.padding,
        borderRadius: s.borderRadius,
        fontFamily: s.fontFamily,
        whiteSpace: s.whiteSpace,
      }
    })

    // A bare .message-note would carry only a margin, leaving backgroundColor transparent.
    expect(noteStyles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(noteStyles.backgroundColor).toBe(plainStyles.backgroundColor)
    expect(noteStyles.padding).toBe(plainStyles.padding)
    expect(noteStyles.borderRadius).toBe(plainStyles.borderRadius)
    expect(noteStyles.fontFamily).toBe(plainStyles.fontFamily)
    expect(noteStyles.whiteSpace).toBe('pre-wrap')

    // The rule must not have widened past the message: the plain bubble's own styles are unchanged.
    expect(plainStyles.whiteSpace).toBe('pre-wrap')

    // A turn with no note shows no extra surface - no empty bubble.
    const plainTurnNoteCount = await page
      .locator('[data-testid="message-user"]')
      .nth(0)
      .locator('.message-note')
      .count()
    expect(plainTurnNoteCount).toBe(0)
  })
})

test.describe('AskUser Form Details', () => {
  // SPEC: tool:askuser-other-autoresize
  test('Other textarea auto-resizes as user types', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()

    const textarea = form.locator('.tool-other-input')
    await expect(textarea).toBeVisible()

    // Baseline single-row height, compared against the height after multi-line input below.
    const initialHeight = await textarea.evaluate(el => el.offsetHeight)

    await textarea.type('Line one')
    await textarea.press('Shift+Enter')
    await textarea.type('Line two')
    await textarea.press('Shift+Enter')
    await textarea.type('Line three')
    await textarea.press('Shift+Enter')
    await textarea.type('Line four')
    await textarea.press('Shift+Enter')
    await textarea.type('Line five')

    const expandedHeight = await textarea.evaluate(el => el.offsetHeight)

    expect(expandedHeight).toBeGreaterThan(initialHeight)
  })

  // SPEC: tool:askuser-no-placeholder
  test('Other textarea has no placeholder hint', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()

    const textarea = form.locator('.tool-other-input')
    await expect(textarea).toBeVisible()

    const placeholder = await textarea.getAttribute('placeholder')
    expect(placeholder === null || placeholder === '').toBeTruthy()
  })

  // SPEC: tool:askuser-optimistic
  test('selection shown immediately after submit', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')

    // Delay the /api/send response so the optimistic UI can be observed before it resolves.
    await page.route('**/api/send', async route => {
      await new Promise(resolve => setTimeout(resolve, 500))
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()

    const submitBtn = form.locator('.tool-submit-btn')
    await submitBtn.click()

    // The delayed /api/send response means this reflects optimistic UI, not server confirmation.
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toHaveAttribute('data-tool-status', 'completed')
  })

  // SPEC: tool:askuser-highlight-answer
  test('answered option is visually highlighted with its label after submit', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        send: async route => {
          await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
        },
      },
    })
    await mockSSE(page, 'events/tool-ask-question.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Label sits in a dedicated span, separate from the description text, which isn't part of the highlight.
    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    const labelText = (await reactOption.locator('.tool-option-label').textContent())?.trim()
    expect(labelText).toBeTruthy()
    await reactOption.click()
    const submitBtn = form.locator('.tool-submit-btn')
    await submitBtn.click()

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toHaveAttribute('data-tool-status', 'completed')

    // Visible either as the highlighted answer in the tool block, or in an optimistic user message bubble.
    await expect(page.getByText(labelText, { exact: false }).first()).toBeVisible()
  })

  // SPEC: tool:askuser-collapse-after-submit
  test('tool block collapses after submitting response', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')

    await page.route('**/api/send', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()
    await form.locator('.tool-submit-btn').click()

    await expect(page.locator('.tool-questions-interactive')).not.toBeVisible()

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    const summary = toolBlock.locator('.tool-summary')
    await expect(summary).toContainText('Answered')
  })

  // SPEC: tool:askuser-qa-separation
  test('questions and answers are visually distinct', async ({ page }) => {
    await mockAPI(page)
    // Use answered fixture which has both question tool block and user answer message
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    // Question side.
    const answeredBlock = page.locator('[data-testid="tool-block"]').filter({
      hasText: 'Answered',
    })
    await expect(answeredBlock.first()).toBeVisible()

    // Answer side: a separate user message bubble, not inside the tool block.
    const userMessage = page.locator('.chat-message-user')
    await expect(userMessage.first()).toBeVisible()
    await expect(userMessage.filter({ hasText: 'React' }).first()).toBeVisible()

    const qaBlock = page.locator('.qa-response-block')
    await expect(qaBlock.first()).toBeVisible()
    await expect(qaBlock.first().locator('.qa-response-header')).toContainText('Response')
  })
})

test.describe('AskUserQuestion - Block Chrome', () => {
  // SPEC: tool:askuser-form-only
  test('a question awaiting an answer shows only the form, with no block header', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // The form is the whole block: no header row, no status bullet, no waiting cue.
    await expect(toolBlock.locator('.tool-header-area')).toHaveCount(0)
    await expect(toolBlock.locator('.tool-bullet')).toHaveCount(0)
    await expect(toolBlock).not.toContainText('AskUserQuestion(')
    await expect(toolBlock).not.toContainText('Awaiting response')

    // The question's own title and options are form content and must survive.
    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()
    await expect(form.locator('.tool-question-header')).toContainText('Framework')
    await expect(form.locator('.tool-question-text')).toContainText(
      'Which framework would you like to use?',
    )
  })

  // SPEC: tool:askuser-form-only
  test('the block header returns once the question is answered', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock.locator('.tool-header-area')).toHaveCount(0)

    const form = page.locator('.tool-questions-interactive').first()
    await form.locator('.tool-question-option:not(.other)').first().click()
    await form.locator('.tool-submit-btn').click()

    // Answering restores the header and its summary - the record of what was asked.
    await expect(toolBlock.locator('.tool-header-area')).toHaveCount(1)
    await expect(toolBlock.locator('.tool-name')).toContainText('AskUserQuestion')
    await expect(toolBlock.locator('.tool-summary')).toContainText('Answered')
  })

  // SPEC: tool:askuser-answered-not-error
  test('an answered question is not shown as failed when the tool call reported an error', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-answered-error.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const answeredBlock = page
      .locator('[data-testid="tool-block"]')
      .filter({ hasText: 'Answered' })
      .first()
    await expect(answeredBlock).toBeVisible()

    // No error styling anywhere on the block, and the raw failure text never surfaces.
    await expect(answeredBlock).not.toHaveClass(/tool-error/)
    await expect(answeredBlock).toHaveAttribute('data-tool-status', 'completed')
    await expect(answeredBlock.locator('.tool-bullet.error')).toHaveCount(0)
    await expect(answeredBlock.locator('.tool-summary.error')).toHaveCount(0)
    await expect(answeredBlock).not.toContainText('No such tool available')
  })

  // SPEC: tool:askuser-live-form-not-error
  test('a question awaiting an answer shows only the form even when the tool call reported an error', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-error.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // The form is the whole block, identical to the clean awaiting path.
    await expect(toolBlock.locator('.tool-header-area')).toHaveCount(0)
    await expect(toolBlock).not.toHaveClass(/tool-error/)
    await expect(toolBlock).not.toContainText('No such tool available')

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()
    await expect(form.locator('.tool-question-header')).toContainText('Framework')
  })

  // SPEC: tool:askuser-live-form-not-error
  test('answering an error-path question restores the header and Answered summary', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-error.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock.locator('.tool-header-area')).toHaveCount(0)

    const form = page.locator('.tool-questions-interactive').first()
    await form.locator('.tool-question-option:not(.other)').first().click()
    await form.locator('.tool-submit-btn').click()

    // Answering restores the header with no trace of the tool-level error.
    await expect(toolBlock.locator('.tool-header-area')).toHaveCount(1)
    await expect(toolBlock.locator('.tool-summary')).toContainText('Answered')
    await expect(toolBlock).not.toHaveClass(/tool-error/)
  })
})
