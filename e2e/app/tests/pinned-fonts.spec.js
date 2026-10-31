/** E2E tests that text draws from the app's own webfonts, never from the machine's fonts. */

import { expect, test } from '@playwright/test'
import { openSession } from '../helpers.js'
import { mockAPI } from '../mocks/api.js'

/** Fonts the text was drawn with - computed font-family names the stack, not the face picked. */
async function drawnFonts(page, locator) {
  const client = await page.context().newCDPSession(page)
  await client.send('DOM.enable')
  await client.send('CSS.enable')
  await locator.evaluate(el => el.setAttribute('data-font-probe', ''))
  const { root } = await client.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await client.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-font-probe]',
  })
  const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId })
  await locator.evaluate(el => el.removeAttribute('data-font-probe'))
  return fonts
}

async function expectShippedFonts(page, locator) {
  await page.evaluate(() => document.fonts.ready)
  const fonts = await drawnFonts(page, locator)
  expect(fonts.length).toBeGreaterThan(0)
  for (const font of fonts) {
    expect(font.isCustomFont, `${font.familyName} is a machine font`).toBe(true)
  }
}

test.describe('Pinned fonts', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test('symbols and tool output draw from shipped fonts', async ({ page }) => {
    await openSession(page, 'events/tool-bash-truncated.jsonl')

    const block = page.locator('[data-testid="tool-block"]').first()
    await expect(block).toBeVisible()

    await expectShippedFonts(page, page.locator('.turn-progress span', { hasText: '✓' }).first())
    await expectShippedFonts(page, block.locator(':text-is("└")').first())
    await expectShippedFonts(page, block.locator('pre.tool-details').first())
  })

  test('a JSON tree draws from the shipped mono face', async ({ page }) => {
    await openSession(page, 'events/tool-mcp-content-blocks-json.jsonl')

    const block = page.locator('[data-testid="tool-block"]').first()
    await block.locator('.tool-header').click()
    const tree = block.locator('.tool-output-section .tool-json')
    await expect(tree).toContainText('distances')

    await expectShippedFonts(page, tree.getByText('distances').first())
  })

  test('diagram labels draw from the shipped sans face', async ({ page }) => {
    await openSession(page, 'events/mermaid-diagram.jsonl')

    const label = page.locator('.mermaid-diagram svg .nodeLabel').first()
    await expect(label).toBeVisible()

    await expectShippedFonts(page, label)
  })

  test('sequence step numbers draw from the sans face the diagram text uses', async ({ page }) => {
    // SPEC: chat:mermaid-font
    await openSession(page, 'events/mermaid-diagram-types.jsonl')

    const number = page.locator('.mermaid-diagram > svg').first().locator('.sequenceNumber').first()
    await expect(number).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    const families = (await drawnFonts(page, number)).map(font => font.familyName)
    expect(families.length).toBeGreaterThan(0)
    for (const family of families) {
      expect(family).toMatch(/^Inter/)
    }
  })

  const DIAGRAM_TYPES = [
    'sequence',
    'gantt',
    'class',
    'state',
    'er',
    'pie',
    'journey',
    'mindmap',
    'timeline',
    'c4',
    'usecase',
  ]

  for (const [index, type] of DIAGRAM_TYPES.entries()) {
    test(`every text element of a ${type} diagram draws from the shipped sans face`, async ({
      page,
    }) => {
      // SPEC: chat:mermaid-font
      test.setTimeout(20000)
      await openSession(page, 'events/mermaid-diagram-types.jsonl')

      const svg = page.locator('.mermaid-diagram > svg').nth(index)
      await expect(svg).toBeVisible()
      await page.evaluate(() => document.fonts.ready)

      const owners = await svg.evaluate(root => {
        const drawn = [...root.querySelectorAll('*')].filter(
          el =>
            el.tagName.toLowerCase() !== 'style' &&
            [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()),
        )
        for (const el of drawn) {
          el.setAttribute('data-font-probe', '')
        }
        return drawn.length
      })
      expect(owners).toBeGreaterThan(0)

      const client = await page.context().newCDPSession(page)
      await client.send('DOM.enable')
      await client.send('CSS.enable')
      const { root } = await client.send('DOM.getDocument', { depth: -1 })
      const { nodeIds } = await client.send('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: '[data-font-probe]',
      })
      expect(nodeIds).toHaveLength(owners)
      for (const nodeId of nodeIds) {
        const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId })
        for (const font of fonts) {
          expect(font.isCustomFont, `${font.familyName} is a machine font`).toBe(true)
        }
      }
    })
  }
})
