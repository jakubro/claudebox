/** E2E tests for the colour swatch inline code shows after a colour value. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

test.describe('Colour swatches', () => {
  test.beforeEach(async ({ page }) => {
    await openSessionWithAPI(page, 'events/color-swatch.jsonl')
  })

  // SPEC: chat:color-swatch
  test('the three GitHub colour forms show a swatch of their colour, nothing else does', async ({
    page,
  }) => {
    const text = page.locator('.turn-text').first()
    await expect(text.locator('code').first()).toBeVisible()

    const swatches = await text
      .locator('code')
      .evaluateAll(codes =>
        codes
          .filter(c => c.querySelector('.color-swatch'))
          .map(c => [
            c.textContent,
            getComputedStyle(c.querySelector('.color-swatch')).backgroundColor,
          ]),
      )
    const hsl = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'hsl(212, 92%, 45%)'
      document.body.append(probe)
      const rgb = getComputedStyle(probe).color
      probe.remove()
      return rgb
    })
    expect(swatches).toEqual([
      ['#0969DA', 'rgb(9, 105, 218)'],
      ['rgb(9, 105, 218)', 'rgb(9, 105, 218)'],
      ['rgb(9,105,218)', 'rgb(9, 105, 218)'],
      ['hsl(212, 92%, 45%)', hsl],
      ['#0969da', 'rgb(9, 105, 218)'],
    ])
    expect(await text.locator('code').allTextContents()).toEqual([
      '#0969DA',
      'rgb(9, 105, 218)',
      'rgb(9,105,218)',
      'hsl(212, 92%, 45%)',
      '#0969da',
      '#fff',
      '#0969DA80',
      'rgba(9, 105, 218, 0.5)',
      'red',
      'color: #0969DA',
      '#0969DAX',
      'rgb(300, 0, 0)',
      'hsl(400, 50%, 50%)',
      'a { color: #0969DA; }',
    ])
    await expect(text.locator('pre .color-swatch')).toHaveCount(0)
    await expect(text.locator('p > .color-swatch')).toHaveCount(0)
  })
})
