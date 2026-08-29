/** E2E test for the sibling-session tool family (session_spawn/session_ask/session_read). */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Sibling sessions', () => {
  // SPEC: runtime:sibling-sessions
  test('renders a tool block for a session_spawn call naming the child session', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/sibling-session-spawn.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const toolBlock = page.locator('[data-testid="tool-block"]').first()
    await expect(toolBlock).toBeVisible()
    await expect(toolBlock).toHaveAttribute('data-tool-use-id', 'tool_001')

    // Claude reaches this tool through an in-process MCP server, so the wire name carries the
    // mcp__{server}__{tool} prefix that normalizeToolName resolves to the plain header.
    await expect(toolBlock).toContainText('mcp__claudebox__session_spawn')

    const completed = page
      .locator('[data-testid="tool-block"][data-tool-status="completed"]')
      .first()
    await expect(completed).toBeVisible()
  })
})
