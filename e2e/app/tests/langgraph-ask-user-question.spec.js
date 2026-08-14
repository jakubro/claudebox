/** E2E test for LangGraph workspace ask_user_question (HITL via interrupt). */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('LangGraph AskUserQuestion', () => {
  // SPEC: langgraph:ask-user-question
  test('renders the interactive Q&A form for a LangGraph ask_user_question tool_use', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/langgraph-tool-ask-user-question.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // ask_user_question normalises to Claude's AskUserQuestion via the TOOL_NAME_ALIASES map.
    const toolBlock = page
      .locator('[data-testid="tool-block"][data-tool-use-id="tool_001"]')
      .first()
    await expect(toolBlock).toBeVisible()

    const form = page.locator('.tool-questions-interactive').first()
    await expect(form).toBeVisible()
  })
})
