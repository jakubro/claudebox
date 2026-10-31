/** E2E test for LangGraph workspace tool_search self-discovery meta-tool. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('LangGraph ToolSearch', () => {
  // SPEC: langgraph:tool-search
  test('a successful tool_search call renders no block', async ({ page }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-tool-search.jsonl')

    // TOOL_NAME_ALIASES resolves tool_search to the hide predicate's canonical name, so it's hidden
    // identically to Claude's ToolSearch.
    await expect(page.locator('[data-testid="tool-block"]')).toHaveCount(0)
  })

  // SPEC: langgraph:tool-search
  test('a failed tool_search call still renders its block', async ({ page }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-tool-search-error.jsonl')

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()
    await expect(toolBlock).toHaveAttribute('data-tool-use-id', 'tool_001')
    await expect(toolBlock).toHaveAttribute('data-tool-status', 'completed')
  })
})
