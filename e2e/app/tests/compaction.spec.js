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

    const compactionBlock = page.locator('.compaction-block').first()
    await expect(compactionBlock).toBeVisible()
    await expect(compactionBlock).toContainText('Conversation compacted')
  })

  // SPEC: tool:compaction-bullet
  test('uses static bullet for completed state', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const bullet = page.locator('.compaction-bullet').first()
    await expect(bullet).toBeVisible()
    await expect(bullet).toHaveText('◎')
  })

  // SPEC: tool:compaction-tokens
  // SPEC: tool:compaction-reason
  test('shows tokens and reason on single line', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const compactionBlock = page.locator('.compaction-block').first()
    const result = compactionBlock.locator('.compaction-result')
    await expect(result).toBeVisible()
    const resultText = await result.textContent()
    expect(resultText).toMatch(/\d+K tokens, \w+/)
  })

  test('corner bracket shows in result', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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

    await expect(compactionBlock.locator('.compaction-summary')).not.toBeVisible()

    await compactionBlock.locator('.compaction-header').click()

    await expect(compactionBlock.locator('.compaction-summary')).toBeVisible()
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

    await compactionBlock.locator('.compaction-header').click()
    await expect(compactionBlock.locator('.compaction-summary')).toBeVisible()

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
    // Fixture has compact_start with no paired boundary yet.
    await mockSSE(page, 'events/compaction-in-progress.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const compactionBlock = page.locator('.compaction-block').first()
    await expect(compactionBlock).toBeVisible()
    await expect(compactionBlock).toContainText('Compacting conversation...')

    const spinner = compactionBlock.locator('.compaction-pending .spinner')
    await expect(spinner).toBeVisible()
  })

  // SPEC: chat:compaction-indicator-bounded
  test('compaction indicator clears when next human turn arrives without boundary', async ({
    page,
  }) => {
    // Recovers from a stuck state: compact_start without a paired boundary (interrupt/error/SDK-skip)
    // must still clear isCompacting once the next human turn arrives.
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

    // Boundary deliberately omitted - simulates lost-boundary state.
    await sse.sendEvent({
      type: 'user',
      subtype: 'message',
      is_human: true,
      content: 'next prompt after stuck state',
      id: 'evt_next_human',
      primary: true,
      ts: '2025-01-18T12:00:02Z',
    })

    // isCompacting must go false once the human turn arrives, even without a compact_boundary.
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
