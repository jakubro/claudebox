/** E2E test for LangGraph workspace simple-port tools. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('LangGraph Tools', () => {
  // SPEC: langgraph:file-tools
  test('renders a tool block for a LangGraph read_file tool_use', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/langgraph-tool-read-file.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Tool block visible - the frontend renders LangGraph tool_use blocks
    // identically to Claude tool_use blocks (same conversion -> projection path).
    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()
    await expect(toolBlock).toHaveAttribute('data-tool-use-id', 'tool_001')

    // The tool result is delivered and the block reaches the completed state.
    const completed = page
      .locator('[data-testid="tool-block"][data-tool-status="completed"]')
      .first()
    await expect(completed).toBeVisible()
  })
})
