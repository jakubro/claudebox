/** E2E tests for the sibling-session tool family and the replies it brings back. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('Sibling sessions', () => {
  // SPEC: runtime:sibling-sessions
  test('renders a tool block for a session_spawn call naming the child session', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/sibling-session-spawn.jsonl')

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

  // SPEC: runtime:sibling-reply-shown
  test('shows a sibling message under its name inside the reply, apart from the user message', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/sibling-reply.jsonl')

    const sibling = page.locator('[data-testid="sibling-message"]').first()
    await expect(sibling).toBeVisible()
    await expect(sibling.locator('.sibling-message-from')).toHaveText('from lint-fix')
    await expect(sibling).toContainText('Done: 40 files reformatted, ruff clean.')
    await expect(page.locator('.turn-content [data-testid="sibling-message"]')).toHaveCount(2)
    await expect(page.locator('.chat-message-user [data-testid="sibling-message"]')).toHaveCount(0)
    await expect(page.locator('.chat-message-user')).toHaveCount(1)

    const order = await page
      .locator('.turn-content')
      .first()
      .evaluate(bubble =>
        [...bubble.querySelectorAll('.turn-text, [data-testid="sibling-message"]')].map(node =>
          node.matches('[data-testid="sibling-message"]') ? 'sibling' : 'text',
        ),
      )
    expect(order.slice(0, 3)).toEqual(['text', 'sibling', 'text'])

    await expect(
      page.locator('[data-testid="sibling-message"]').nth(1).locator('.sibling-message-from'),
    ).toHaveText('from 9b7e44d0')
  })
})
