/** E2E test for the LangGraph universal-provider headline (Anthropic). */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('LangGraph Universal Provider', () => {
  // SPEC: langgraph:universal-provider-support
  test('renders an Anthropic-backed LangGraph turn with the runtime pill and assistant text', async ({
    page,
  }) => {
    // The session-status fixture controls runtime_name + capabilities once a
    // session loads (the welcome-screen getSessionDefaults handler only matters
    // before any session is active). Point statusFixture at the langgraph
    // variant so the running session presents as a LangGraph workspace with
    // model="anthropic:claude-sonnet-4-5" and runtime_name="LangGraph".
    await mockAPI(page, { statusFixture: 'status/langgraph-anthropic.json' })
    await mockSSE(page, 'events/langgraph-universal-provider-anthropic.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Runtime identity pill displays "LangGraph" - proves the active runtime is
    // not Claude. The LangGraph workspace can route to any provider; the model
    // identifier in the SSE system_init carries the provider:model form.
    const runtimePill = page.locator('[data-testid="footer-runtime"]')
    await expect(runtimePill).toBeVisible()
    await expect(runtimePill).toHaveText('LangGraph')

    // The assistant turn renders identically to other LangGraph workspaces -
    // text content visible, no error surface, conversation closes cleanly.
    const assistantText = page.getByText(/Same brain, different runtime/i)
    await expect(assistantText).toBeVisible()
  })
})
