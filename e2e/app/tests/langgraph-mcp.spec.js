/** E2E test for LangGraph workspace MCP resource tools. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('LangGraph MCP', () => {
  // SPEC: langgraph:mcp
  test('renders the list_mcp_resources tool block + completed tool_result', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/langgraph-tool-mcp.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
