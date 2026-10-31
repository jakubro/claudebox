/** E2E test for LangGraph workspace skill tool invocation. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('LangGraph Skill', () => {
  // SPEC: langgraph:skill
  test('renders the skill tool block + completed tool_result for a LangGraph skill invocation', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-skill.jsonl')

    // LangGraph skill blocks render identically to Claude's (TOOL_NAME_ALIASES normalises snake_case).
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()
    await expect(toolBlock).toHaveAttribute('data-tool-use-id', 'tool_001')

    // The tool result lands and the block reaches the completed state.
    const completed = page
      .locator('[data-testid="tool-block"][data-tool-status="completed"]')
      .first()
    await expect(completed).toBeVisible()
  })

  // SPEC: langgraph:skill-routing
  test('a user-typed /<skill> command runs the skill directly, without a tool block', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/langgraph-skill-slash-command.jsonl')

    // The typed command renders with the same slash-command styling Claude workspaces use.
    const slashToken = page.locator('.slash-command').first()
    await expect(slashToken).toBeVisible()
    await expect(slashToken).toHaveText('/greet')
    await expect(page.getByText('break down this idea')).toBeVisible()

    // No tool block for this turn - the skill's instructions became the model's own turn text.
    await expect(page.locator('[data-testid="tool-block"]')).toHaveCount(0)
    await expect(
      page.getByText("Here's the idea broken down per the greet skill's structure."),
    ).toBeVisible()
  })
})
