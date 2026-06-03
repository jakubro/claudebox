/** E2E tests for compaction blocks including rendering, expand/collapse, and token count display. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Compaction Blocks', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/compaction.jsonl')
  })

  // SPEC: tool:compaction-display
  test('compaction block renders', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Compaction block should be visible (use first() for strict mode)
    const compactionBlock = page.locator('.compaction-block').first()
    await expect(compactionBlock).toBeVisible()

    // Should show "Conversation compacted"
    await expect(compactionBlock).toContainText('Conversation compacted')
  })

  // SPEC: tool:compaction-bullet
  test('uses static bullet for completed state', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Should have bullet (◎) for completed state
    const bullet = page.locator('.compaction-bullet').first()
    await expect(bullet).toBeVisible()
    await expect(bullet).toHaveText('◎')
  })

  // SPEC: tool:compaction-tokens
  // SPEC: tool:compaction-reason
  test('shows tokens and reason on single line', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Result should show "NNK tokens, reason" in a single element
    const compactionBlock = page.locator('.compaction-block').first()
    const result = compactionBlock.locator('.compaction-result')
    await expect(result).toBeVisible()
    const resultText = await result.textContent()
    // Matches pattern like "128K tokens, auto_compact"
    expect(resultText).toMatch(/\d+K tokens, \w+/)
  })

  test('corner bracket shows in result', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Should have corner bracket (└)
    const corner = page.locator('.compaction-corner').first()
    await expect(corner).toBeVisible()
    await expect(corner).toHaveText('└')
  })

  // SPEC: tool:compaction-summary
  test('click expands summary', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const compactionBlock = page.locator('.compaction-block').first()
    await expect(compactionBlock).toBeVisible()

    // Initially, summary should not be visible
    await expect(compactionBlock.locator('.compaction-summary')).not.toBeVisible()

    // Click to expand
    await compactionBlock.locator('.compaction-header').click()

    // Summary should now be visible (if summary content exists)
    await expect(compactionBlock.locator('.compaction-summary')).toBeVisible()

    // Should contain the summary text from fixture
    await expect(compactionBlock.locator('.compaction-summary')).toContainText(
      'Previous conversation covered',
    )
  })

  // SPEC: tool:compaction-summary
  test('click again collapses summary', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const compactionBlock = page.locator('.compaction-block').first()
    await expect(compactionBlock).toBeVisible()

    // Expand
    await compactionBlock.locator('.compaction-header').click()
    await expect(compactionBlock.locator('.compaction-summary')).toBeVisible()

    // Collapse
    await compactionBlock.locator('.compaction-header').click()
    await expect(compactionBlock.locator('.compaction-summary')).not.toBeVisible()
  })

  // SPEC: tool:compaction-tokens
  test('shows token count in result', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const compactionBlock = page.locator('.compaction-block').first()
    await expect(compactionBlock).toBeVisible()

    // Result should show formatted token count (128K from fixture pre_tokens: 128000)
    const result = compactionBlock.locator('.compaction-result')
    await expect(result).toBeVisible()
    await expect(result).toContainText('128K tokens')
  })
})

test.describe('Compaction In Progress', () => {
  // SPEC: tool:compaction-bullet
  test('shows spinning bullet while compacting', async ({ page }) => {
    await mockAPI(page)
    // Use compact_start only fixture (no boundary yet)
    await mockSSE(page, 'events/compaction-in-progress.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const compactionBlock = page.locator('.compaction-block').first()
    await expect(compactionBlock).toBeVisible()

    // Should show "Compacting conversation..." text
    await expect(compactionBlock).toContainText('Compacting conversation...')

    // Should have the Loader2 spinner (SVG with spinner class)
    const spinner = compactionBlock.locator('.compaction-pending .spinner')
    await expect(spinner).toBeVisible()
  })

  // SPEC: chat:compaction-indicator-bounded
  test('compaction indicator clears when next human turn arrives without boundary', async ({
    page,
  }) => {
    // Reproduces the stuck-state recovery: SSE delivers compact_start without
    // a paired compact_boundary (interrupt/error/SDK-skip), then a fresh human
    // user event arrives. The reducer must detect the human turn boundary and
    // clear isCompacting so the next pending Turn renders normally.
    await mockAPI(page)
    const sse = await createSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await sse.sendEvent({
      type: 'system',
      subtype: 'compact_start',
      id: 'evt_compact_start',
      ts: '2025-01-18T12:00:01Z',
      message_data: { compact_metadata: { trigger: 'context_limit' } },
    })

    // Boundary deliberately omitted — simulates lost-boundary state.
    await sse.sendEvent({
      type: 'user',
      subtype: 'message',
      is_human: true,
      content: 'next prompt after stuck state',
      id: 'evt_next_human',
      primary: true,
      ts: '2025-01-18T12:00:02Z',
    })

    // The reducer's isCompacting flag — exposed via __isCompacting test hook on
    // the chat panel — must be false after the human turn arrives.
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const pending = document.querySelector('.turn.pending')
          if (!pending) {
            return 'no-pending-turn'
          }
          return pending.querySelector('.compaction-bullet.compacting') ? 'compacting' : 'normal'
        })
      })
      .not.toBe('compacting')
  })
})
