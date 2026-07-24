/** E2E tests for the auto-collapse control-bar toggle and its collapse behavior. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

// multi-turn.jsonl carries three completed turns (turn_001, turn_002, turn_003).
test.describe('Auto-collapse turns', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/multi-turn.jsonl')
  })

  // SPEC: chat:turn-autocollapse-toggle
  test('is on by default and keeps only the last turn expanded', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const toggle = page.locator('[data-testid="autocollapse-toggle"]')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle).toHaveClass(/pressed/)

    const turns = page.locator('.turn-container')
    await expect(turns).toHaveCount(3)
    await expect(turns.nth(0)).toHaveClass(/turn-collapsed/)
    await expect(turns.nth(1)).toHaveClass(/turn-collapsed/)
    await expect(turns.nth(2)).not.toHaveClass(/turn-collapsed/)
  })

  // SPEC: chat:turn-autocollapse-behavior
  test('toggling off expands all turns, toggling on re-collapses all but the last', async ({
    page,
  }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const toggle = page.locator('[data-testid="autocollapse-toggle"]')
    const turns = page.locator('.turn-container')
    await expect(turns.nth(0)).toHaveClass(/turn-collapsed/)

    // Off -> every turn expands (including the collapsed earlier ones).
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(turns.nth(0)).not.toHaveClass(/turn-collapsed/)
    await expect(turns.nth(1)).not.toHaveClass(/turn-collapsed/)
    await expect(turns.nth(2)).not.toHaveClass(/turn-collapsed/)

    // On -> only the last turn stays expanded.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(turns.nth(0)).toHaveClass(/turn-collapsed/)
    await expect(turns.nth(1)).toHaveClass(/turn-collapsed/)
    await expect(turns.nth(2)).not.toHaveClass(/turn-collapsed/)
  })

  // SPEC: chat:turn-autocollapse-behavior
  test('a hand-expanded earlier turn stays open while auto-collapse is on', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const turns = page.locator('.turn-container')
    await expect(turns.nth(0)).toHaveClass(/turn-collapsed/)

    // Expand the first (auto-collapsed) turn by clicking its meta row.
    await turns.nth(0).locator('.turn-meta-collapsible').click()

    // It stays open (no immediate re-collapse) and so does the last turn.
    await expect(turns.nth(0)).not.toHaveClass(/turn-collapsed/)
    await expect(turns.nth(2)).not.toHaveClass(/turn-collapsed/)
    // The other earlier turn remains collapsed.
    await expect(turns.nth(1)).toHaveClass(/turn-collapsed/)
  })

  // SPEC: chat:turn-autocollapse-behavior
  test('a hand-expanded earlier turn stays open when a new turn arrives', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const turns = page.locator('.turn-container')
    await expect(turns.nth(0)).toHaveClass(/turn-collapsed/)

    // Expand the first (auto-collapsed) turn by hand.
    await turns.nth(0).locator('.turn-meta-collapsible').click()
    await expect(turns.nth(0)).not.toHaveClass(/turn-collapsed/)

    // A new turn arrives over the live stream.
    await page.evaluate(
      events => {
        const inst = window.__sseChatInstance
        if (!inst || inst.readyState !== 1) {
          return
        }
        for (const ev of events) {
          const msg = { data: JSON.stringify(ev) }
          if (inst.onmessage) {
            inst.onmessage(msg)
          }
          inst._emit('message', msg)
        }
      },
      [
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'One more',
          ts: '2025-01-18T12:00:30Z',
          turn_id: 'turn_004',
          id: 'evt_010',
          primary: true,
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Done.',
          ts: '2025-01-18T12:00:31Z',
          id: 'evt_011',
          primary: true,
          is_human: false,
        },
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_004',
          ts: '2025-01-18T12:00:32Z',
          id: 'evt_012',
          primary: false,
          is_human: false,
        },
      ],
    )

    await expect(turns).toHaveCount(4)
    // The hand-expanded turn stays open across the new turn; the previously-last
    // turn collapses; the new turn is the only other one expanded.
    await expect(turns.nth(0)).not.toHaveClass(/turn-collapsed/)
    await expect(turns.nth(2)).toHaveClass(/turn-collapsed/)
    await expect(turns.nth(3)).not.toHaveClass(/turn-collapsed/)
  })
})
