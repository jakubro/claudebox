/** E2E test for LangGraph workspace MCP resource tools. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('LangGraph MCP', () => {
  // SPEC: langgraph:mcp
  test('renders the list_mcp_resources tool block + completed tool_result', async ({ page }) => {
    await openSessionWithAPI(page, 'events/langgraph-tool-mcp.jsonl')

    // Renders via the generic tool-block pipeline; MCP panel stays hidden while supports_mcp_delegation is False.
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()
    await expect(toolBlock).toHaveAttribute('data-tool-use-id', 'tool_001')

    const completed = page
      .locator('[data-testid="tool-block"][data-tool-status="completed"]')
      .first()
    await expect(completed).toBeVisible()
  })
})
