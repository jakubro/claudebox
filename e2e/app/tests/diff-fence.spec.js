/** E2E tests for ```diff code blocks: bands span the longest line, in the Edit diff's tints. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI, waitForStableScrollHeight } from '../helpers.js'

// Class names are not relied on: the highlighter drops them when it styles inline.
function readFences(wrappers) {
  return wrappers.map(wrapper => {
    const box = wrapper.querySelector(':scope > div')
    box.scrollLeft = box.scrollWidth
    const style = getComputedStyle(box)
    const boxLeft = box.getBoundingClientRect().left
    const bands = [...box.querySelectorAll('*')]
      .filter(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)')
      .filter(el => /^[-+]/.test(el.textContent))
      .map(el => ({
        text: el.textContent,
        left: el.getBoundingClientRect().left - boxLeft + box.scrollLeft,
        right: el.getBoundingClientRect().right - boxLeft + box.scrollLeft,
        background: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el).color,
      }))

    return {
      clientWidth: box.clientWidth,
      scrollWidth: box.scrollWidth,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      color: style.color,
      bands,
    }
  })
}

test.describe('Diff code blocks', () => {
  test.beforeEach(async ({ page }) => {
    await openSessionWithAPI(page, 'events/diff-fence.jsonl')
    await expect(page.locator('.turn-text .code-block-wrapper')).toHaveCount(2)
    await waitForStableScrollHeight(page.getByTestId('chat-messages'))
  })

  // SPEC: chat:diff-fence-full-width
  test("every removed and added band reaches the end of the block's longest line", async ({
    page,
  }) => {
    const [wide, narrow] = await page
      .locator('.turn-text .code-block-wrapper')
      .evaluateAll(readFences)

    expect(wide.scrollWidth, 'the wide block must overflow').toBeGreaterThan(wide.clientWidth + 100)
    expect(wide.bands.map(b => b.text.split(' ')[0])).toEqual([
      '-remove',
      '+add',
      '-short',
      '+short',
      '-',
      '+',
    ])
    for (const band of wide.bands) {
      expect(band.right, band.text.slice(0, 20)).toBeGreaterThanOrEqual(
        wide.scrollWidth - wide.paddingRight - 1,
      )
    }

    expect(narrow.scrollWidth).toBe(narrow.clientWidth)
    expect(narrow.bands).toHaveLength(2)
    for (const band of narrow.bands) {
      expect(band.right - band.left).toBeCloseTo(
        narrow.clientWidth - narrow.paddingLeft - narrow.paddingRight,
        0,
      )
    }
  })

  // SPEC: chat:diff-fence-tints
  test('removed and added bands take the Edit diff tints, with the text in its usual colour', async ({
    page,
  }) => {
    const edit = page.locator('[data-testid="tool-block"]').first()
    const editRemoved = await edit
      .locator('.code-block-type-diff-remove')
      .first()
      .evaluate(el => getComputedStyle(el).backgroundColor)
    const editAdded = await edit
      .locator('.code-block-type-diff-add')
      .first()
      .evaluate(el => getComputedStyle(el).backgroundColor)
    expect(editRemoved).not.toBe(editAdded)

    const fences = await page.locator('.turn-text .code-block-wrapper').evaluateAll(readFences)
    for (const fence of fences) {
      for (const band of fence.bands) {
        expect(band.background, band.text.slice(0, 20)).toBe(
          band.text.startsWith('-') ? editRemoved : editAdded,
        )
        expect(band.color, band.text.slice(0, 20)).toBe(fence.color)
      }
    }
  })
})
