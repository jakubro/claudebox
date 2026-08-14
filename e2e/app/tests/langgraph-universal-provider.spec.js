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
    // statusFixture drives runtime_name/capabilities once active; getSessionDefaults only matters before that.
    await mockAPI(page, { statusFixture: 'status/langgraph-anthropic.json' })
    await mockSSE(page, 'events/langgraph-universal-provider-anthropic.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Runtime pill reflects the workspace, not the provider - LangGraph can route to any provider.
    const runtimePill = page.locator('[data-testid="footer-runtime"]')
    await expect(runtimePill).toBeVisible()
    await expect(runtimePill).toHaveText('LangGraph')

    const assistantText = page.getByText(/Same brain, different runtime/i)
    await expect(assistantText).toBeVisible()
  })
})
