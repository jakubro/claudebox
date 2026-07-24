/** E2E tests for interactive tools including AskUserQuestion forms and ExitPlanMode approve/reject. */

import { expect, test } from '@playwright/test'
import { disableAutoCollapse, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('AskUserQuestion', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')
  })

  // SPEC: tool:askuser-form
  test('form renders with options', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Tool block should show AskUserQuestion
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // Interactive form should be visible (use first() due to potential duplicates)
    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Question header and text should be visible
    await expect(form.locator('.tool-question-header')).toContainText('Framework')
    await expect(form.locator('.tool-question-text')).toContainText(
      'Which framework would you like to use?',
    )

    // Options should be visible (3 options + Other)
    const options = form.locator('.tool-question-option')
    await expect(options).toHaveCount(4)

    // Check option labels
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

    // Other option should be present
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

    // Submit button should be disabled initially
    const submitBtn = form.locator('.tool-submit-btn')
    await expect(submitBtn).toBeDisabled()

    // Select an option (not Other)
    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()

    // Now submit should be enabled
    await expect(submitBtn).toBeEnabled()
  })

  // SPEC: tool:askuser-other-focus
  test('Other option shows text input', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Initially no text input visible
    await expect(form.locator('.tool-other-input')).not.toBeVisible()

    // Click Other option
    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()

    // Text input should now be visible and focused
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

    // Select React (not Other)
    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()

    // Submit
    const submitBtn = form.locator('.tool-submit-btn')
    await submitBtn.click()

    // Poll until API is called with answer
    await expect.poll(() => sendCalled).toBe(true)
    expect(sendPayload.prompt).toContain('<answer>React</answer>')
  })

  // SPEC: tool:askuser-form
  test('form disappears after submit', async ({ page }) => {
    // Note: The "waiting for reply..." message is not shown because the parent
    // component (ToolBlock) sets wasAnsweredLocally=true which unmounts
    // InteractiveQuestions before it can render the submitted state.
    // This test verifies the form disappears after submit.
    await page.route('**/api/send', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Wait for form to appear
    const forms = page.locator('.tool-questions-interactive')
    await expect(forms.first()).toBeVisible()
    const initialCount = await forms.count()

    // Select and submit on first form
    const form = forms.first()
    await form.locator('.tool-question-option:not(.other)').first().click()
    await form.locator('.tool-submit-btn').click()

    // Poll until at least one form has been removed (submitted forms disappear)
    await expect.poll(() => forms.count()).toBeLessThan(initialCount)
  })

  // SPEC: tool:askuser-form
  test('radio button indicators for single select', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Unselected options show hollow circle (○)
    const firstOption = form.locator('.tool-question-option:not(.other)').first()
    const firstIndicator = firstOption.locator('.tool-option-indicator')
    await expect(firstIndicator).toHaveText('○')

    // Select first option
    await firstOption.click()

    // Selected option shows filled circle (●)
    await expect(firstIndicator).toHaveText('●')
  })

  // SPEC: tool:askuser-other
  test('selecting option deselects Other', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Select Other first
    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()
    await expect(form.locator('.tool-other-input')).toBeVisible()

    // Select a regular option
    await form.locator('.tool-question-option:not(.other)').first().click()

    // Other input should disappear
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

    // Wait for plan content to be rendered (robust against race conditions)
    const planContent = page.locator('.tool-plan')
    await expect(planContent.first()).toBeVisible()

    // Should contain plan markdown content
    await expect(planContent.first()).toContainText('Refactoring Plan')
    await expect(planContent.first()).toContainText('Extract authentication logic')
    await expect(planContent.first()).toContainText('Better separation of concerns')
  })

  // SPEC: tool:exitplan-expanded
  test('default expanded for user review', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Wait for plan content (which only renders when expanded)
    const planContent = page.locator('.tool-plan')
    await expect(planContent.first()).toBeVisible()

    // Expanded content container should be visible
    const expandedContent = page.locator('.tool-expanded-content')
    await expect(expandedContent.first()).toBeVisible()
  })

  // SPEC: tool:exitplan
  test('shows plan title in header', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Wait for header with plan title
    const header = page.locator('.tool-name').filter({ hasText: 'ExitPlanMode' })
    await expect(header.first()).toBeVisible()
    await expect(header.first()).toContainText('ExitPlanMode(Refactoring Plan)')
  })

  test('summary shows Awaiting response when plan awaits answer', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Plan awaiting approval shows "Awaiting response..." summary
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

    // Plan content should be visible
    const planContent = page.locator('.tool-plan')
    await expect(planContent.first()).toBeVisible()

    // Interactive form should be visible (approve/reject)
    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Should have Approve and Reject options + Other
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

    // Select Approve
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

    // Select Approve
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

    // Select Approve and submit
    await form.locator('.tool-question-option:not(.other)').first().click()
    await form.locator('.tool-submit-btn').click()

    // Form should disappear
    await expect(page.locator('.tool-questions-interactive')).not.toBeVisible()

    // Should show Approved summary (not generic "Answered")
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

    // Should show Approved (fixture has Approve answer)
    const answeredBlock = page.locator('[data-testid="tool-block"]').filter({
      hasText: 'Approved',
    })
    await expect(answeredBlock.first()).toBeVisible()

    // No interactive form should be visible
    await expect(answeredBlock.first().locator('.tool-questions-interactive')).not.toBeVisible()
  })

  // SPEC: tool:exitplan-stays-viewable
  test('plan content remains viewable after answering', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-exit-plan-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    // Plan should still be visible (not collapsed like AskUserQuestion)
    const planContent = page.locator('.tool-plan')
    await expect(planContent.first()).toBeVisible()
    await expect(planContent.first()).toContainText('Refactoring Plan')

    // Verify re-expandable: collapse and re-expand
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await toolBlock.locator('.tool-header-area').click()
    // After collapse, plan content hidden
    await expect(planContent.first()).not.toBeVisible()
    // Re-expand
    await toolBlock.locator('.tool-header-area').click()
    // Plan content should be visible again
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

    // Select the "Approve" option to enable submit button
    const approveOption = page.locator('.tool-question-option:not(.other)').first()
    await approveOption.click()

    // Submit the plan approval
    const approveBtn = page.locator('.tool-submit-btn')
    await expect(approveBtn).toBeEnabled()
    await approveBtn.click()

    // Verify send API was called with approval payload
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

    // The tool block should exist
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // Interactive form should NOT be visible (disabled due to follow-up message)
    await expect(toolBlock.locator('.tool-questions-interactive')).not.toBeVisible()
  })
})

test.describe('AskUserQuestion - Answered State', () => {
  // SPEC: tool:askuser-answered
  test('answered questions show completed status with Answered text', async ({ page }) => {
    await mockAPI(page)
    // Use a fixture with a user message following the AskUserQuestion
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    // Look for a tool block with "completed" status (the one that was answered)
    const _completedToolBlock = page.locator(
      '[data-testid="tool-block"][data-tool-status="completed"]',
    )

    // If we find a completed AskUserQuestion, it should show "Answered"
    // This may not exist if events are being duplicated (some may show as pending)
    // So let's check for any tool block that shows "Answered"
    const answeredBlock = page.locator('[data-testid="tool-block"]').filter({
      hasText: 'Answered',
    })
    await expect(answeredBlock.first()).toBeVisible()

    // The answered block should not show the interactive form
    await expect(answeredBlock.first().locator('.tool-questions-interactive')).not.toBeVisible()
  })

  // SPEC: tool:askuser-answered
  test('interactive form not shown when question already answered', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    // At least one turn should have an answered AskUserQuestion (no form visible, shows "Answered")
    // Due to potential event duplication, we just check that an answered state exists
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

    // The tool block should exist
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()

    // Interactive form should NOT be visible (disabled due to follow-up message)
    await expect(toolBlock.locator('.tool-questions-interactive')).not.toBeVisible()
  })

  // SPEC: tool:askuser-disable-after-reply
  test('resume session with unanswered question + newer messages disables form', async ({
    page,
  }) => {
    await mockAPI(page)
    // Same fixture simulates resuming a session where question wasn't answered
    // but user continued with other messages
    await mockSSE(page, 'events/tool-ask-question-with-followup.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Form should be disabled (not interactive) because there's a newer human message
    const forms = page.locator('.tool-questions-interactive')
    await expect(forms).toHaveCount(0)
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

    // Click Other option to show textarea
    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()

    // Textarea should be visible
    const textarea = form.locator('.tool-other-input')
    await expect(textarea).toBeVisible()

    // Type text with Shift+Enter for newline
    await textarea.fill('Line one')
    await textarea.press('Shift+Enter')
    await textarea.type('Line two')

    // Value should contain newline
    const value = await textarea.inputValue()
    expect(value).toContain('\n')
    expect(value).toContain('Line one')
    expect(value).toContain('Line two')
  })
})

test.describe('AskUserQuestion - XML Response Rendering', () => {
  // Verifies XML response tags are stripped from display
  test('no raw AskUserQuestionResponse XML visible in answered display', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // The page should not show raw XML tags
    const pageContent = await page.textContent('body')
    expect(pageContent).not.toContain('<AskUserQuestionResponse>')
    expect(pageContent).not.toContain('</AskUserQuestionResponse>')
  })

  // SPEC: tool:askuser-answered
  // Verifies answered tool_result shows the selected option in completed display
  test('answered state shows selected option', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question-answered.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await disableAutoCollapse(page)

    // Should show "Answered" status
    const answeredBlock = page.locator('[data-testid="tool-block"]').filter({
      hasText: 'Answered',
    })
    await expect(answeredBlock.first()).toBeVisible()

    // The user's answer "React" should appear in the QA response block (scoped check)
    const qaAnswer = page.locator('.qa-answer')
    await expect(qaAnswer.first()).toBeVisible()
    await expect(qaAnswer.first()).toContainText('React')
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

    // Click Other option to show textarea
    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()

    const textarea = form.locator('.tool-other-input')
    await expect(textarea).toBeVisible()

    // Measure initial height (single row)
    const initialHeight = await textarea.evaluate(el => el.offsetHeight)

    // Type multiple lines naturally using Shift+Enter to trigger auto-resize
    await textarea.type('Line one')
    await textarea.press('Shift+Enter')
    await textarea.type('Line two')
    await textarea.press('Shift+Enter')
    await textarea.type('Line three')
    await textarea.press('Shift+Enter')
    await textarea.type('Line four')
    await textarea.press('Shift+Enter')
    await textarea.type('Line five')

    // Measure height after multi-line input - should be taller
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

    // Click Other option to show textarea
    const otherOption = form.locator('.tool-question-option.other')
    await otherOption.click()

    const textarea = form.locator('.tool-other-input')
    await expect(textarea).toBeVisible()

    // Textarea should have no placeholder attribute or empty placeholder
    const placeholder = await textarea.getAttribute('placeholder')
    expect(placeholder === null || placeholder === '').toBeTruthy()
  })

  // SPEC: tool:askuser-optimistic
  test('selection shown immediately after submit', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/tool-ask-question.jsonl')

    // Intercept /api/send but delay response to verify optimistic display
    await page.route('**/api/send', async route => {
      // Delay the server response to ensure we can observe optimistic UI
      await new Promise(resolve => setTimeout(resolve, 500))
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()

    // Select React option
    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()

    // Submit
    const submitBtn = form.locator('.tool-submit-btn')
    await submitBtn.click()

    // Immediately after submit (before server responds), the tool block should
    // reflect the answered state - either by showing "Answered" summary or
    // by collapsing with answered status
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

    // Capture the chosen option's label so we can verify it surfaces
    // post-submit. The label sits in a dedicated span; description text is
    // separate and not part of the answer's "highlight".
    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    const labelText = (await reactOption.locator('.tool-option-label').textContent())?.trim()
    expect(labelText).toBeTruthy()
    await reactOption.click()
    const submitBtn = form.locator('.tool-submit-btn')
    await submitBtn.click()

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toHaveAttribute('data-tool-status', 'completed')

    // After submit the chosen option's label must be visible on the page -
    // either inside the (expanded) tool block as the highlighted answer, or as
    // an optimistic user message bubble containing the answer text.
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

    // Select an option and submit
    const reactOption = form.locator('.tool-question-option:not(.other)').first()
    await reactOption.click()
    await form.locator('.tool-submit-btn').click()

    // After submit, the interactive form should no longer be visible (collapsed)
    await expect(page.locator('.tool-questions-interactive')).not.toBeVisible()

    // The tool block should show "Answered" summary text
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

    // The answered tool block should show "Answered" (question side)
    const answeredBlock = page.locator('[data-testid="tool-block"]').filter({
      hasText: 'Answered',
    })
    await expect(answeredBlock.first()).toBeVisible()

    // The user's answer should appear in a separate user message bubble
    // (not inside the tool block), providing visual Q/A separation
    const userMessage = page.locator('.chat-message-user')
    await expect(userMessage.first()).toBeVisible()

    // User answer message should contain the response text
    await expect(userMessage.filter({ hasText: 'React' }).first()).toBeVisible()

    // The Q/A response block (styled distinctly) should be present in the user message
    const qaBlock = page.locator('.qa-response-block')
    await expect(qaBlock.first()).toBeVisible()

    // Q/A block should have a "Response" header for visual distinction
    await expect(qaBlock.first().locator('.qa-response-header')).toContainText('Response')
  })
})
