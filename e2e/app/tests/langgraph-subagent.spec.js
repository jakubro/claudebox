/** E2E test for LangGraph workspace sub-agent (task) tool. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('LangGraph Sub-agent', () => {
  // SPEC: langgraph:subagent
  test('renders a tool block for a LangGraph task tool_use and its sub-agent report', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-subagent.jsonl')

    // The task tool_use renders identically to any other tool_use block - conversion path is runtime-agnostic.
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()
    await expect(toolBlock).toHaveAttribute('data-tool-use-id', 'tool_001')

    // The sub-agent's report comes back as the tool_result, and the block reaches completed state.
    const completed = page
      .locator('[data-testid="tool-block"][data-tool-status="completed"]')
      .first()
    await expect(completed).toBeVisible()
  })
})
