/** E2E tests for GitHub alerts, quotes opening with [!NOTE] and its siblings, drawn as callouts. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI, waitForStableScrollHeight } from '../helpers.js'

const KINDS = [
  ['note', 'Note', 'Useful'],
  ['tip', 'Tip', 'A tip.'],
  ['important', 'Important', 'Important thing.'],
  ['warning', 'Warning', 'Careful'],
  ['caution', 'Caution', 'Dangerous.'],
]

test.describe('Markdown alerts', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openSessionWithAPI(page, 'events/markdown-alerts.jsonl')
    await expect(page.locator('.turn-text blockquote').first()).toBeVisible()
    await waitForStableScrollHeight(page.getByTestId('chat-messages'))
  })

  // SPEC: chat:markdown-alerts
  test('each kind draws a callout with its icon, name and colour', async ({ page }) => {
    const text = page.locator('.turn-text')
    const plainEdge = await text
      .locator('blockquote', { hasText: 'plain quote' })
      .evaluate(el => getComputedStyle(el).borderLeftColor)
    const edges = new Set()
    for (const [kind, title, body] of KINDS) {
      const callout = text.locator(`blockquote.markdown-alert-${kind}`, { hasText: body })
      await expect(callout).toHaveCount(1)
      await expect(callout.locator('.markdown-alert-title')).toHaveText(title)
      await expect(callout.locator('.markdown-alert-title svg')).toHaveCount(1)
      const edge = await callout.evaluate(el => getComputedStyle(el).borderLeftColor)
      expect(edge).not.toBe(plainEdge)
      edges.add(edge)
    }
    expect(edges.size).toBe(KINDS.length)
  })

  // SPEC: chat:markdown-alerts
  test('the marker text is hidden, a lowercase marker counts, and the rest stay plain quotes', async ({
    page,
  }) => {
    const text = page.locator('.turn-text')
    await expect(
      text.locator('blockquote.markdown-alert-note', { hasText: 'lower case' }),
    ).toHaveCount(1)
    await expect(text.locator('blockquote.markdown-alert-warning').last()).toHaveText('Warning')

    const markerTexts = await text
      .locator('blockquote')
      .evaluateAll(qs =>
        qs.map(q => q.textContent.trim()).filter(t => /\[!(note|warning)\]/i.test(t)),
      )
    expect(markerTexts).toEqual(['[!NOTE] inline marker', '[!NOTE]\nnested body'])
    for (const plain of ['[!TODO]', 'inline marker', 'nested body', 'plain quote']) {
      await expect(text.locator('blockquote', { hasText: plain }).last()).not.toHaveClass(
        /markdown-alert/,
      )
    }
  })

  // SPEC: chat:copy-button-alert
  test('copying a callout copies the body without the marker', async ({ page }) => {
    const note = page.locator('.turn-text blockquote.markdown-alert-note', { hasText: 'Useful' })
    await note.hover({ position: { x: 20, y: 8 } })
    await page.getByTestId('block-strip').first().locator('.block-copy-btn').click()

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Useful **info**.\n- item',
    )
  })
})
