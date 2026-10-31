/** E2E tests for the hover strip that copies one top-level part of an agent message. */

import { devices, expect, test } from '@playwright/test'
import {
  openSessionWithAPI,
  waitForAppReady,
  waitForMobileReady,
  waitForStableScrollHeight,
} from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

const PARTS = [
  [
    'p',
    'First paragraph',
    'First paragraph with **bold**, a [link](https://example.com) and a `code span`.',
  ],
  ['h2', 'Setup', '## Setup'],
  ['ul', 'nested', '- one\n  - nested\n- two'],
  ['table', 'b', '| a | b |\n|---|---|\n| 1 | 2 |'],
  ['blockquote', 'quoted line', 'quoted line\n- quoted bullet'],
  ['.katex-display', '', '$$\nx^2 + y^2\n$$'],
  ['details', 'More', '<details>\n<summary>More</summary>\n\nHidden **text**.\n\n</details>'],
]

const BOXED = new Set(['table', 'blockquote'])

// PIXEL_5 drops `defaultBrowserType`, which Playwright refuses in a describe-scoped `test.use()`.
const { defaultBrowserType: _ignored, ...PIXEL_5 } = devices['Pixel 5']

const firstMessage = page => page.locator('.turn-text').first()
const strip = page => page.getByTestId('block-strip').first()

/** Every copy or bookmark button in the first message that is on screen, left to right. */
function shownButtons(page) {
  return firstMessage(page).evaluate(message =>
    [...message.querySelectorAll('.copy-btn')]
      .filter(b => {
        const style = getComputedStyle(b)
        return style.display !== 'none' && Number(style.opacity) > 0 && b.offsetParent
      })
      .map(b => {
        const box = b.getBoundingClientRect()
        return {
          inStrip: !!b.closest('[data-testid="block-strip"]'),
          bookmark: b.classList.contains('block-bookmark-btn'),
          left: box.left,
          right: box.right,
        }
      })
      .sort((a, b) => a.left - b.left),
  )
}

/** The strip sits inside `box`: at least 4px below its top and 4px left of its right edge. */
async function expectInsideBox(page, box) {
  const stripBox = await strip(page).boundingBox()
  expect(stripBox.y - box.y).toBeGreaterThanOrEqual(4)
  expect(box.x + box.width - (stripBox.x + stripBox.width)).toBeGreaterThanOrEqual(4)
}

/** The top-level part of the first message matching `tag` (and `text`, when given). */
function part(page, tag, text) {
  const all = firstMessage(page).locator(`:scope > ${tag}`)
  return text ? all.filter({ hasText: text }) : all
}

test.describe('Block copy', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openSessionWithAPI(page, 'events/block-copy.jsonl')
    await expect(firstMessage(page).locator(':scope > details')).toBeVisible()
  })

  for (const [tag, text, source] of PARTS) {
    // SPEC: chat:copy-button-block
    test(`hovering a ${tag} shows the strip at its top-right and copies it as written`, async ({
      page,
    }) => {
      const target = part(page, tag, text)
      await showStrip(page, target)

      const targetBox = await target.boundingBox()
      if (BOXED.has(tag)) {
        await expectInsideBox(page, targetBox)
      } else {
        const stripBox = await strip(page).boundingBox()
        const messageBox = await firstMessage(page).boundingBox()
        expect(Math.abs(stripBox.y - targetBox.y)).toBeLessThanOrEqual(4)
        expect(messageBox.x + messageBox.width - (stripBox.x + stripBox.width)).toBeLessThanOrEqual(
          4,
        )
      }

      await strip(page).locator('.block-copy-btn').click()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source)
    })
  }

  // SPEC: chat:copy-button-block-quote
  test('a top-level quote shows no quote button of its own', async ({ page }) => {
    const quote = part(page, 'blockquote')
    await quote.hover({ position: { x: 10, y: 5 } })

    await expect(quote.locator('.blockquote-copy-btn')).toHaveCount(0)
  })

  // SPEC: chat:copy-button-block-exclusions
  test('code blocks and dividers get no strip', async ({ page }) => {
    for (const tag of ['pre', 'hr']) {
      await part(page, tag).hover({ force: true })
      await expect(strip(page)).toBeHidden()
    }
  })

  for (const [tag, text] of [
    ['p', 'First paragraph'],
    ['h2', 'Setup'],
    ['ul', 'nested'],
  ]) {
    // SPEC: chat:copy-button-block
    // SPEC: bookmark:part-toggle-btn
    test(`hovering a ${tag} shows exactly bookmark then copy, copy at the message's right edge`, async ({
      page,
    }) => {
      await showStrip(page, part(page, tag, text))

      const buttons = await shownButtons(page)
      const messageBox = await firstMessage(page).boundingBox()
      expect(buttons).toHaveLength(2)
      expect(buttons.every(b => b.inStrip)).toBe(true)
      expect(buttons.map(b => b.bookmark)).toEqual([true, false])
      expect(Math.abs(messageBox.x + messageBox.width - buttons[1].right)).toBeLessThanOrEqual(4)
    })
  }

  test('leaving the message hides the strip', async ({ page }) => {
    await part(page, 'h2').hover()
    await expect(strip(page)).toBeVisible()
    await page.mouse.move(2, 2)

    await expect(strip(page)).toBeHidden()
  })
})

test.describe('Block copy on a callout', () => {
  test.beforeEach(async ({ page }) => {
    await openSessionWithAPI(page, 'events/markdown-alerts.jsonl')
  })

  // SPEC: chat:copy-button-block
  // SPEC: chat:part-buttons-clear
  test('the strip sits inside the callout, clear of its edges and its text', async ({ page }) => {
    const note = page.locator('.turn-text > blockquote.markdown-alert-note', { hasText: 'Useful' })
    await note.hover({ position: { x: 20, y: 8 } })
    await expect(strip(page)).toBeVisible()

    await expectInsideBox(page, await note.boundingBox())
    expect(await textUnderStrip(note)).toEqual([])
  })
})

const CORNER_PARTS = [
  ['paragraph', 'p', 'The parser reads'],
  ['heading', 'h2', 'A heading long enough'],
  ['list', 'ul', 'an item whose text'],
  ['quote', 'blockquote', 'A quoted passage'],
  ['quote opening with a list', 'blockquote', 'opens with a list item'],
  ['callout', 'blockquote.markdown-alert', 'A callout whose body'],
  ['table', 'table', 'Key'],
  ['header-less table', 'table', 'first'],
  ['formula', '.katex-display', ''],
  ['details', 'details', 'A summary long enough'],
  ['html block', 'div', 'A raw block of text'],
]

const cornerPart = (page, selector, text, message = 0) => {
  const all = page.locator('.turn-text').nth(message).locator(`:scope > ${selector}`)
  return text ? all.filter({ hasText: text }) : all
}

function textUnderStrip(part) {
  return part.evaluate(element => {
    const box = element.parentElement
      .querySelector(':scope > [data-testid="block-strip"]')
      .getBoundingClientRect()
    if (box.width === 0) {
      throw new Error('the strip is not shown')
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node =>
        node.parentElement.closest('.katex-mathml')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    })
    const hits = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) {
        const x = Math.min(r.right, box.right) - Math.max(r.left, box.left)
        const y = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top)
        if (x > 1 && y > 1 && node.textContent.trim()) {
          hits.push(node.textContent.trim().slice(0, 40))
        }
      }
    }
    return hits
  })
}

function textLines(part) {
  return part.evaluate(element => {
    const lines = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) {
        if (r.width === 0) {
          continue
        }
        const line = lines.find(l => Math.abs(l.top - r.top) < 2)
        if (line) {
          line.left = Math.min(line.left, r.left)
          line.right = Math.max(line.right, r.right)
        } else {
          lines.push({ top: r.top, left: r.left, right: r.right })
        }
      }
    }
    return lines.sort((a, b) => a.top - b.top)
  })
}

async function openCornerFixture(page, ready) {
  await mockAPI(page)
  await mockSSE(page, 'events/part-corner.jsonl')
  await page.goto(DEFAULT_SESSION_URL)
  await ready(page)
  await expect(cornerPart(page, 'div', 'A raw block of text')).toBeVisible()
  await waitForStableScrollHeight(page.getByTestId('chat-messages'))
}

async function expectFirstLineLinksClickable(page) {
  const paragraph = cornerPart(page, 'p', 'aaa')
  await showStrip(page, paragraph)

  const { targets, misses } = await paragraph.evaluate(element => {
    const links = [...element.querySelectorAll('a')]
    const firstTop = links[0].getBoundingClientRect().top
    const firstLine = links.filter(a => Math.abs(a.getBoundingClientRect().top - firstTop) < 2)
    const points = firstLine.flatMap(a => {
      const r = a.getBoundingClientRect()
      const y = (r.top + r.bottom) / 2
      return [
        [a, (r.left + r.right) / 2, y],
        [a, r.right - 2, y],
      ]
    })
    return {
      targets: firstLine.length,
      misses: points
        .filter(([a, x, y]) => document.elementFromPoint(x, y)?.closest('a') !== a)
        .map(([a]) => a.textContent),
    }
  })
  expect(targets).toBeGreaterThan(5)
  expect(misses).toEqual([])

  const last = await paragraph.evaluate(element => {
    const links = [...element.querySelectorAll('a')]
    const firstTop = links[0].getBoundingClientRect().top
    const lastOnLine = links
      .filter(a => Math.abs(a.getBoundingClientRect().top - firstTop) < 2)
      .at(-1)
    const r = lastOnLine.getBoundingClientRect()
    window.__cornerClicks = []
    window.addEventListener(
      'click',
      event => {
        window.__cornerClicks.push(event.target.closest?.('a')?.textContent ?? event.target.tagName)
        event.preventDefault()
      },
      { capture: true, once: true },
    )
    return { text: lastOnLine.textContent, x: r.right - 2, y: (r.top + r.bottom) / 2 }
  })
  await page.mouse.click(last.x, last.y)
  expect(await page.evaluate(() => window.__cornerClicks)).toEqual([last.text])
}

async function expectPartClear(page, selector, text) {
  const target = cornerPart(page, selector, text)
  await showStrip(page, target)

  expect(await textUnderStrip(target)).toEqual([])
}

test.describe('Part corner', () => {
  test.beforeEach(async ({ page }) => {
    await openCornerFixture(page, waitForAppReady)
  })

  // SPEC: chat:part-buttons-clear
  test('every link on the first line of a part can be clicked while the part is hovered', async ({
    page,
  }) => {
    await expectFirstLineLinksClickable(page)
  })

  for (const [name, selector, text] of CORNER_PARTS) {
    // SPEC: chat:part-buttons-clear
    test(`no text of a ${name} lies under its buttons`, async ({ page }) => {
      await expectPartClear(page, selector, text)
    })
  }

  // SPEC: chat:part-buttons-clear
  test('the buttons are one line of text tall', async ({ page }) => {
    const paragraph = cornerPart(page, 'p', 'The parser reads')
    await showStrip(page, paragraph)

    const [, secondLine] = await textLines(paragraph)
    const firstLineTop = (await paragraph.boundingBox()).y
    const heights = await strip(page)
      .locator('.copy-btn')
      .evaluateAll(buttons => buttons.map(b => b.getBoundingClientRect().height))
    expect(heights).toHaveLength(2)
    for (const height of heights) {
      expect(height).toBeLessThanOrEqual(secondLine.top - firstLineTop)
    }
  })

  // SPEC: chat:part-buttons-clear
  test('hovering a part moves none of its text', async ({ page }) => {
    const paragraph = cornerPart(page, 'p', 'The parser reads')
    await paragraph.scrollIntoViewIfNeeded()
    await page.mouse.move(2, 2)
    const before = await textLines(paragraph)
    await showStrip(page, paragraph)

    expect(await textLines(paragraph)).toEqual(before)
  })

  // SPEC: chat:part-buttons-clear
  test('only the first line of a part stops short of the corner', async ({ page }) => {
    const paragraph = cornerPart(page, 'p', 'The parser reads')
    await showStrip(page, paragraph)

    const stripLeft = (await strip(page).boundingBox()).x
    const lines = await textLines(paragraph)
    expect(lines.length).toBeGreaterThan(3)
    expect(lines[0].right).toBeLessThanOrEqual(stripLeft)
    for (const line of lines.slice(1, -1)) {
      expect(line.right).toBeGreaterThan(stripLeft)
    }
  })

  // SPEC: chat:part-buttons-clear
  test('a part that cannot be bookmarked shows copy alone over empty space', async ({ page }) => {
    const paragraph = cornerPart(page, 'p', 'A second message', 1)
    await paragraph.hover({ position: { x: 10, y: 5 } })
    const secondStrip = page.locator('.turn-text').nth(1).getByTestId('block-strip')
    await expect(secondStrip).toBeVisible()

    await expect(secondStrip.locator('.copy-btn')).toHaveCount(1)
    expect(await textUnderStrip(paragraph)).toEqual([])
  })
})

test.describe('Part corner on a phone', () => {
  test.use({ ...PIXEL_5, hasTouch: true })

  test.beforeEach(async ({ page }) => {
    await openCornerFixture(page, waitForMobileReady)
  })

  // SPEC: chat:part-buttons-clear
  test('every link on the first line of a part can be clicked while the part is hovered', async ({
    page,
  }) => {
    await expectFirstLineLinksClickable(page)
  })

  for (const [name, selector, text] of CORNER_PARTS) {
    // SPEC: chat:part-buttons-clear
    test(`no text of a ${name} lies under its buttons`, async ({ page }) => {
      await expectPartClear(page, selector, text)
    })
  }
})

async function showStrip(page, target) {
  await target.hover({ position: { x: 10, y: 5 } })
  await expect(strip(page)).toBeVisible()
}
