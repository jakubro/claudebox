/** E2E: a long session keeps rendering across repeated divider drags and right-column switches.
 *  The maximum-update-depth crash itself is proven at the hook level, in useVirtualListGeometry. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Chat Render Stability', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: chat:virtualized-render
  test('a 350-turn session keeps rendering across repeated divider drags and right-column switches', async ({
    page,
  }) => {
    test.setTimeout(60000)

    const consoleErrors = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })
    const pageErrors = []
    page.on('pageerror', err => pageErrors.push(err.message))

    await mockSSE(page, 'events/perf-350.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    // 1050 events chunks across many replay drains; interacting mid-replay races the app's own
    // event handling rather than exercising the virtualizer.
    await expect(page.locator('.chat-replay-overlay')).not.toBeVisible({ timeout: 30000 })

    const messages = page.locator('[data-testid="chat-messages"]')
    // Scrolled away from the top: resizeItem's synchronous scroll-adjust write only runs for
    // rows above the fold, which is the condition the production failure needed.
    await messages.evaluate(el => {
      el.scrollTop = el.scrollHeight / 2
    })
    await page.waitForTimeout(300)

    const divider = page.locator('[data-testid="chat-split-divider"]')
    const terminalToggle = page.getByTestId('right-slot-view-terminal')
    const workToggle = page.getByTestId('right-slot-view-work')

    for (let i = 0; i < 5; i++) {
      // Trigger 1: drag the split divider - invalidates every cached row height at once
      // (useTurnVirtualizer's estimateSize reads scrollEl.clientWidth live).
      await terminalToggle.click()
      await page.waitForTimeout(150)
      const handle = await divider.boundingBox()
      if (handle) {
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
        await page.mouse.down()
        await page.mouse.move(handle.x + 150, handle.y + handle.height / 2)
        await page.mouse.move(handle.x - 150, handle.y + handle.height / 2)
        await page.mouse.up()
      }
      await page.waitForTimeout(150)

      // Trigger 2: cross the terminal / work / off routing edge, calling virtualizer.measure().
      await terminalToggle.click() // off
      await page.waitForTimeout(150)
      await workToggle.click() // on
      await page.waitForTimeout(150)
      await workToggle.click() // off
      await page.waitForTimeout(150)
    }

    await expect(page.locator('.error-boundary-fallback')).toHaveCount(0)
    await expect(page.getByText('This panel stopped responding.')).toHaveCount(0)
    await expect(page.locator('.turn-container').first()).toBeVisible()

    const updateDepthErrors = [...consoleErrors, ...pageErrors].filter(m =>
      /maximum update depth|error #185/i.test(m),
    )
    expect(updateDepthErrors, `render-loop errors:\n${updateDepthErrors.join('\n')}`).toEqual([])
  })
})
