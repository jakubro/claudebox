/** E2E test for LangGraph workspace task-management tools. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('LangGraph Task Management', () => {
  // SPEC: langgraph:task-management
  test('renders LangGraph task_create / task_update tool blocks and the tasks panel', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/langgraph-tool-task-management.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Each task_create renders a tool block - same conversion path as Claude's
    // TaskCreate. The first tool_use_id matches the JSONL fixture's first block.
    const firstToolBlock = page
      .locator('[data-testid="tool-block"][data-tool-use-id="tool_001"]')
      .first()
    await expect(firstToolBlock).toBeVisible()

    const secondToolBlock = page
      .locator('[data-testid="tool-block"][data-tool-use-id="tool_002"]')
      .first()
    await expect(secondToolBlock).toBeVisible()

    // The task_update block (tool_003) also renders to completed state - the
    // frontend's appendTaskDiffs gate now recognises both Claude and LangGraph
    // names via the schema.js normalizeToolName helper.
    const updateBlock = page
      .locator(
        '[data-testid="tool-block"][data-tool-use-id="tool_003"][data-tool-status="completed"]',
      )
      .first()
    await expect(updateBlock).toBeVisible()
  })
})
