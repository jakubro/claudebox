/** E2E test for LangGraph workspace task-management tools. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('LangGraph Task Management', () => {
  // SPEC: langgraph:task-management
  test('renders LangGraph task_create / task_update tool blocks and the tasks panel', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-task-management.jsonl')

    // normalizeToolName maps snake_case task_create/task_update to PascalCase, so the run collapses
    // into one Todos group, not three tool blocks.
    const group = page.locator('[data-testid="todos-group"]')
    await expect(group).toBeVisible()
    await expect(group.locator('.todo-item')).toHaveCount(2)

    await expect(
      page.locator('[data-testid="tool-block"][data-tool-use-id="tool_001"]'),
    ).toHaveCount(0)
  })
})
