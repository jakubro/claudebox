/** E2E tests for bookmarking one part of an agent message, or one tool call, instead of a whole turn. */

import { expect, test } from '@playwright/test'
import {
  disableAutoCollapse,
  openBookmarksPanel,
  openSession,
  waitForAppReady,
  waitForStableScrollHeight,
} from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_WORKSPACE_ID, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

const PARAGRAPH_ID = 'turn_001:p-evt_002-0-1'
const TOOL_ID = 'turn_001:tool-tu_bash_1'
const SECOND = 'Second paragraph, the one worth keeping for later reading.'

const turnOne = page => page.locator('[data-turn-id="turn_001"]')
const secondParagraph = page =>
  turnOne(page).locator('.turn-text p', { hasText: 'Second paragraph' })
const bashBlock = page => turnOne(page).locator('[data-tool-use-id="tu_bash_1"]')
const scroller = page => page.locator('[data-testid="chat-messages"]')

/** Mock ui-state, recording every global PATCH op; `seed` pre-populates bookmarks. */
async function mockBookmarks(page, seed = null) {
  const ops = []
  const global = seed ?? {}
  await mockAPI(page, {
    handlers: {
      getUIState: route =>
        route.fulfill({ json: { global, session: { rightSlotView: 'everything' } } }),
      patchUIState: async route => {
        const payload = route.request().postDataJSON()
        ops.push(...(payload.global ?? []))
        await route.fulfill({ json: { global, session: {} } })
      },
    },
  })
  return ops
}

async function openBookmarkParts(page, seed) {
  const ops = await mockBookmarks(page, seed)
  await openSession(page, 'events/bookmark-parts.jsonl')
  await openBookmarksPanel(page)

  return ops
}

/** Record the text of every element the app flashes, so a short flash is not missed. */
async function recordFlashes(page) {
  await page.addInitScript(() => {
    window.__flashed = []
    new MutationObserver(records => {
      for (const r of records) {
        if (r.target.classList?.contains('jump-highlight')) {
          window.__flashed.push(r.target.textContent)
        }
      }
    }).observe(document, { attributes: true, attributeFilter: ['class'], subtree: true })
  })
}

const flashed = page => page.evaluate(() => window.__flashed.join('\n'))

/** Scroll the chat to its top so the first turn is mounted and on screen. */
async function showTurnOne(page) {
  await expect(page.locator('[data-turn-id]').first()).toBeAttached()
  await waitForStableScrollHeight(scroller(page))
  await scroller(page).evaluate(el => {
    el.scrollTop = 0
  })
  await expect(turnOne(page)).toBeVisible()
}

async function inView(locator, page) {
  const box = await locator.boundingBox()
  const view = await scroller(page).boundingBox()
  return box && box.y >= view.y - 2 && box.y < view.y + view.height
}

test.describe('Bookmark parts', () => {
  // SPEC: bookmark:part-toggle-btn
  // SPEC: bookmark:part-marker
  // SPEC: panel-bookmarks:part-preview
  // SPEC: bookmark:minimap-segment
  test('bookmarking a paragraph marks it, the minimap and the panel', async ({ page }) => {
    const ops = await openBookmarkParts(page)
    await disableAutoCollapse(page)

    await showTurnOne(page)
    await secondParagraph(page).hover()
    await page.getByTestId('block-strip').first().locator('.block-bookmark-btn').click()

    await expect.poll(() => ops.find(o => o.op === 'add')?.value).toBe(PARAGRAPH_ID)
    const meta = ops.find(o => o.op === 'set')
    expect(meta.path).toContain(`${DEFAULT_SESSION_ID}/${PARAGRAPH_ID}`)
    expect(meta.value.preview).toBe(SECOND.slice(0, 80))
    await expect(secondParagraph(page)).toHaveClass(/md-block-bookmarked/)
    await expect(page.locator('[data-testid="minimap-subbar"]').first()).toHaveCSS(
      'background-color',
      'rgb(232, 185, 49)',
    )
    await expect(page.locator('[data-testid="bookmark-item"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="bookmark-item"]')).toContainText('Second paragraph')
    await expect(turnOne(page).locator('.turn-bookmark-btn')).not.toHaveClass(/active/)
  })

  // SPEC: panel-bookmarks:part-scroll
  test('clicking a paragraph bookmark scrolls to it and flashes it', async ({ page }) => {
    await recordFlashes(page)
    await openBookmarkParts(page, {
      bookmarkedTurns: { [DEFAULT_SESSION_ID]: [PARAGRAPH_ID] },
      bookmarkMeta: { [`${DEFAULT_SESSION_ID}/${PARAGRAPH_ID}`]: { preview: SECOND } },
    })
    await scroller(page).evaluate(el => {
      el.scrollTop = el.scrollHeight
    })

    await page.locator('[data-testid="bookmark-item"]').first().click()

    await expect.poll(() => flashed(page)).toBe(SECOND)
    await expect.poll(() => inView(secondParagraph(page), page)).toBe(true)
  })

  // SPEC: bookmark:part-toggle-btn
  // SPEC: bookmark:part-toggle-visibility
  // SPEC: bookmark:part-scope
  test('a top-level tool call bookmarks from its header; a subagent call has no button', async ({
    page,
  }) => {
    const ops = await openBookmarkParts(page)
    await disableAutoCollapse(page)

    await showTurnOne(page)
    await bashBlock(page).locator('.tool-header').hover()
    await bashBlock(page).locator('.tool-bookmark-btn').click()

    await expect.poll(() => ops.find(o => o.op === 'add')?.value).toBe(TOOL_ID)
    await expect(bashBlock(page)).toHaveClass(/bookmarked/)
    await expect(bashBlock(page).locator('.tool-bookmark-btn')).toHaveClass(/active/)
    await expect(page.locator('[data-testid="bookmark-item"]')).toContainText('Bash(')

    const task = turnOne(page).locator('[data-tool-use-id="tu_task_1"]')
    await task.locator('.tool-header-area').first().click()
    const nestedRead = task.locator('[data-tool-use-id="tu_read_1"]')
    await expect(nestedRead).toBeVisible()
    await expect(nestedRead.locator('.tool-bookmark-btn')).toHaveCount(0)
  })

  // SPEC: panel-bookmarks:part-scroll
  test('a tool-call bookmark opens a collapsed turn and flashes the call', async ({ page }) => {
    await recordFlashes(page)
    await openBookmarkParts(page, {
      bookmarkedTurns: { [DEFAULT_SESSION_ID]: [TOOL_ID] },
      bookmarkMeta: { [`${DEFAULT_SESSION_ID}/${TOOL_ID}`]: { preview: 'Bash(npm test)' } },
    })

    await showTurnOne(page)
    await expect(turnOne(page)).toHaveClass(/turn-collapsed/)
    await scroller(page).evaluate(el => {
      el.scrollTop = el.scrollHeight
    })

    await page.locator('[data-testid="bookmark-item"]').first().click()

    await expect(turnOne(page)).not.toHaveClass(/turn-collapsed/)
    await expect.poll(() => flashed(page)).toContain('npm test')
    await expect.poll(() => inView(bashBlock(page), page)).toBe(true)
  })

  // SPEC: url:session-turn-part
  // SPEC: panel-bookmarks:part-deep-link
  test('a link naming a paragraph lands on it after the session loads', async ({ page }) => {
    await recordFlashes(page)
    await mockBookmarks(page, {
      bookmarkedTurns: { [DEFAULT_SESSION_ID]: [PARAGRAPH_ID] },
      bookmarkMeta: { [`${DEFAULT_SESSION_ID}/${PARAGRAPH_ID}`]: { preview: SECOND } },
    })
    await mockSSE(page, 'events/bookmark-parts.jsonl')
    await page.goto(
      `/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${DEFAULT_SESSION_ID}/turns/a-turn_001/p-evt_002-0-1`,
    )
    await waitForAppReady(page)

    await expect.poll(() => flashed(page)).toBe(SECOND)
    await expect.poll(() => inView(secondParagraph(page), page)).toBe(true)
  })
})
