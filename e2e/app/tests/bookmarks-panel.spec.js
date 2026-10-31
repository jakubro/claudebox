/** E2E tests for bookmarks panel and bookmark toggle. */

import { expect, test } from '@playwright/test'
import {
  delayUiStateSaves,
  openBookmarksPanel,
  openSession,
  openSessionWithAPI,
  serveSessionList,
  waitForAppReady,
} from '../helpers.js'
import { DEFAULT_CONTAINER_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'

async function bookmarkFirstUserMessage(page) {
  const userMsg = page.locator('[data-testid="message-user"]').first()
  await userMsg.hover()
  await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

  return userMsg
}

async function openBookmarks(page) {
  await openSession(page)
  await openBookmarksPanel(page)

  return page.locator('[data-testid="panel-bookmarks"]')
}

async function openBookmarkedPanel(page) {
  await openSession(page)
  await bookmarkFirstUserMessage(page)
  await openBookmarksPanel(page)

  return page.locator('[data-testid="panel-bookmarks"]')
}

test.describe('Bookmarks Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: panel-bookmarks:shortcut
  test('Alt+5 toggles bookmarks panel', async ({ page }) => {
    await openSession(page)

    // Bookmarks panel is open by default.
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await expect(panel).toBeVisible()

    await page.keyboard.press('Alt+5')
    await expect(panel).not.toBeVisible()

    await page.keyboard.press('Alt+5')
    await expect(panel).toBeVisible()
  })

  // SPEC: panel-bookmarks:loading
  test('renders panel-level loading placeholder during cold load - no tabs, no false-empty', async ({
    page,
  }) => {
    // Holds /ui-state so loading stays visible; the hook gates loading=true until the first fetch settles.
    let resolveUiState
    const uiStateGate = new Promise(r => {
      resolveUiState = r
    })
    await page.route(/\/api\/workspaces\/[^/]+\/ui-state/, async route => {
      if (route.request().method() === 'GET') {
        await uiStateGate
        await route.fulfill({ json: {} })
      } else {
        await route.fulfill({ json: {} })
      }
    })

    await openSession(page)

    // Bookmarks panel is open by default - no toggle needed.
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await expect(panel).toHaveClass(/bookmarks-loading/)
    await expect(panel).toContainText('Loading...')
    await expect(panel).not.toContainText('No bookmarks')
    await expect(panel).not.toContainText('This session')
    await expect(panel).not.toContainText('All sessions')

    // Release the gate so the test exits cleanly.
    resolveUiState()
  })

  // SPEC: panel-bookmarks:empty
  test('shows empty state when no bookmarks', async ({ page }) => {
    await openSession(page)

    // Bookmarks panel is open by default - no toggle needed.
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('No bookmarks')
  })

  // SPEC: panel-bookmarks:tab-auto-switch
  test('tab auto-switches with session presence; manual click holds until next session change', async ({
    page,
  }) => {
    // Starts at a session so the app fully boots (panels mount), then navigates home to the no-session state.
    await openSession(page)

    const panel = page.locator('[data-testid="panel-bookmarks"]')
    if (!(await panel.isVisible())) {
      // Move focus off the chat input so Alt+5 triggers the panel shortcut.
      await page.locator('body').click()
      await page.keyboard.press('Alt+5')
    }
    await expect(panel).toBeVisible({ timeout: 5000 })

    const sessionTab = panel.locator('button', { hasText: 'This session' })
    const allTab = panel.locator('button', { hasText: 'All sessions' })

    // Session is active on initial load -> "This session" active.
    await expect(sessionTab).toHaveClass(/active/)

    // Navigate home (clear session) -> auto-switch to "All sessions".
    await page.evaluate(() => {
      history.pushState(null, '', window.location.pathname + window.location.search)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await expect(allTab).toHaveClass(/active/, { timeout: 5000 })
    await expect(sessionTab).not.toHaveClass(/active/)

    // Re-open session -> auto-switch back to "This session".
    await page.evaluate(() => {
      window.location.hash = '#/workspaces/test-ws/sessions/test-session-001'
    })
    await expect(sessionTab).toHaveClass(/active/, { timeout: 5000 })
    await expect(allTab).not.toHaveClass(/active/)

    // Manually click "All sessions" -> tab stays even though session is active.
    await allTab.click()
    await expect(allTab).toHaveClass(/active/)
    await expect(sessionTab).not.toHaveClass(/active/)
    // Hold a moment to confirm no spurious re-assert.
    await page.waitForTimeout(300)
    await expect(allTab).toHaveClass(/active/)

    // Changing session presence again: auto-switch should win, navigating home then back to session.
    await page.evaluate(() => {
      history.pushState(null, '', window.location.pathname + window.location.search)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await expect(allTab).toHaveClass(/active/, { timeout: 5000 })
    await page.evaluate(() => {
      window.location.hash = '#/workspaces/test-ws/sessions/test-session-001'
    })
    await expect(sessionTab).toHaveClass(/active/, { timeout: 5000 })
  })

  // SPEC: panel-bookmarks:tabs
  // SPEC: panel-bookmarks:tab-auto-switch
  test('tabs render with count badges for this/all sessions', async ({ page }) => {
    // Seeds bookmarks via ui-state GET for non-zero badges: 2 in this session + 1 elsewhere -> This=2, All=3.
    await page.route(/\/ui-state(?:\?|$)/, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            global: {
              bookmarkedTurns: {
                'test-session-001': ['turn-a:user', 'turn-b:assistant'],
                'other-session': ['turn-c:user'],
              },
              bookmarkMeta: {
                'test-session-001/turn-a:user': { preview: 'A', ts: '2026-01-01' },
                'test-session-001/turn-b:assistant': { preview: 'B', ts: '2026-01-01' },
                'other-session/turn-c:user': { preview: 'C', ts: '2026-01-01' },
              },
            },
            session: {},
          },
        })
      } else {
        await route.fulfill({ status: 200, json: { status: 'ok' } })
      }
    })
    const panel = await openBookmarks(page)
    const thisTab = panel.locator('button', { hasText: 'This session' })
    const allTab = panel.locator('button', { hasText: 'All sessions' })
    await expect(thisTab).toBeVisible()
    await expect(allTab).toBeVisible()

    // Non-zero seeded counts prove the numeric badges actually render, not just exist.
    await expect(thisTab).toContainText('2')
    await expect(allTab).toContainText('3')
  })

  // SPEC: panel-bookmarks:tabs
  test('All sessions tab shows empty state', async ({ page }) => {
    const panel = await openBookmarks(page)
    await panel.locator('button', { hasText: 'All sessions' }).click()
    await expect(panel).toContainText('No bookmarks')
  })

  // SPEC: panel-bookmarks:shortcut
  test('bookmarks icon is in right icon strip', async ({ page }) => {
    await openSession(page)

    const rightStrip = page.locator('.icon-strip-right')
    const bookmarkBtn = rightStrip.locator('[data-testid="icon-bookmarks"]')
    await expect(bookmarkBtn).toBeVisible()

    const title = await bookmarkBtn.getAttribute('title')
    expect(title).toBe('Bookmarks (Alt+5)')
  })
})

test.describe('Bookmark Toggle on Turns', () => {
  // SPEC: bookmark:toggle-btn
  test('bookmark button appears on user message hover', async ({ page }) => {
    // default fixture includes a user message
    await openSessionWithAPI(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await expect(userMsg).toBeVisible()

    const bookmarkBtn = userMsg.locator('.message-bookmark-btn')
    await expect(bookmarkBtn).toHaveCSS('opacity', '0')

    await userMsg.hover()
    await expect(bookmarkBtn).toHaveCSS('opacity', '1')
  })

  // SPEC: bookmark:toggle-visibility
  test('clicking bookmark button toggles bookmark state', async ({ page }) => {
    await openSessionWithAPI(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()

    const bookmarkBtn = userMsg.locator('.message-bookmark-btn')
    await expect(bookmarkBtn).toBeVisible()

    await expect(bookmarkBtn).not.toHaveClass(/active/)

    // dispatchEvent bypasses the rewind split button that overlaps this element in hover state.
    await bookmarkBtn.dispatchEvent('click')
    await expect(bookmarkBtn).toHaveClass(/active/)

    await bookmarkBtn.dispatchEvent('click')
    await expect(bookmarkBtn).not.toHaveClass(/active/)
  })

  // SPEC: bookmark:persistence
  test('bookmark state survives page reload', async ({ page }) => {
    await openSessionWithAPI(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    const bookmarkBtn = userMsg.locator('.message-bookmark-btn')
    await bookmarkBtn.dispatchEvent('click')
    await expect(bookmarkBtn).toHaveClass(/active/)

    // ui-state mock retains state in-memory across reload.
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const userMsgAfter = page.locator('[data-testid="message-user"]').first()
    await userMsgAfter.hover()
    const bookmarkBtnAfter = userMsgAfter.locator('.message-bookmark-btn')
    await expect(bookmarkBtnAfter).toHaveClass(/active/)
  })

  // SPEC: bookmark:minimap-segment
  test('bookmarked turn shows yellow indicator in minimap', async ({ page }) => {
    await openSessionWithAPI(page)

    const subbars = page.locator('[data-testid="minimap-subbar"]')
    const firstSubbar = subbars.first()
    await expect(firstSubbar).not.toHaveCSS('background-color', 'rgb(232, 185, 49)')

    await bookmarkFirstUserMessage(page)

    await expect(firstSubbar).toHaveCSS('background-color', 'rgb(232, 185, 49)')
  })

  // SPEC: bookmark:cross-tab
  test('a bookmark added or removed in one tab shows in another tab of the same browser', async ({
    page,
  }) => {
    const uiState = { global: {}, sessions: {} }
    await openTab(page, uiState)
    await delayUiStateSaves(page, 500)
    const other = await page.context().newPage()
    await openTab(other, uiState)
    await openBookmarksPanel(page)
    await openBookmarksPanel(other)
    const otherItems = other.locator('[data-testid="bookmark-item"]')
    const otherButton = other
      .locator('[data-testid="message-user"]')
      .first()
      .locator('.message-bookmark-btn')

    await bookmarkFirstMessage(page)
    await expect(otherItems).toHaveCount(1)
    await expect(otherButton).toHaveClass(/active/)

    await page.locator('[data-testid="bookmark-item"]').first().hover()
    await page.locator('.bookmark-remove').first().click()
    await expect(otherItems).toHaveCount(0)
    await expect(otherButton).not.toHaveClass(/active/)

    await bookmarkFirstMessage(page)
    await expect(otherItems).toHaveCount(1)
    await bookmarkFirstMessage(page)
    await expect(otherItems).toHaveCount(0)
  })

  // SPEC: bookmark:cross-tab
  test('a bookmark whose save fails leaves another tab showing what is saved', async ({ page }) => {
    const uiState = { global: {}, sessions: {} }
    await openTab(page, uiState)
    await page.route(/\/ui-state/, route =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 400 }) : route.fallback(),
    )
    const other = await page.context().newPage()
    await openTab(other, uiState)
    await openBookmarksPanel(other)
    const reread = other.waitForRequest(req => {
      const url = new URL(req.url())
      return url.pathname.endsWith('/ui-state') && !url.searchParams.has('session_id')
    })

    await bookmarkFirstMessage(page)
    await reread

    await expect(page.locator('.message-bookmark-btn.active')).toHaveCount(1)
    await expect(other.locator('[data-testid="bookmark-item"]')).toHaveCount(0)
  })
})

test.describe('Bookmark Toggle on Assistant Turns', () => {
  // SPEC: bookmark:toggle-btn
  test('bookmark button appears on assistant turn hover', async ({ page }) => {
    await openSessionWithAPI(page)

    const assistantMsg = page.locator('[data-testid="message-assistant"]').first()
    await expect(assistantMsg).toBeVisible()

    // Bookmark button is inline in turn-meta (always visible when turn-meta is visible)
    const bookmarkBtn = assistantMsg.locator('.turn-bookmark-btn')
    await expect(bookmarkBtn).toBeVisible()
  })

  // SPEC: bookmark:toggle-visibility
  test('user and assistant bookmarks are independent', async ({ page }) => {
    await openSessionWithAPI(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    const userBtn = userMsg.locator('.message-bookmark-btn')
    await userBtn.dispatchEvent('click')
    await expect(userBtn).toHaveClass(/active/)

    const assistantMsg = page.locator('[data-testid="message-assistant"]').first()
    await assistantMsg.hover()
    const assistantBtn = assistantMsg.locator('.turn-bookmark-btn')
    await assistantBtn.dispatchEvent('click')
    await expect(assistantBtn).toHaveClass(/active/)

    await userMsg.hover()
    await expect(userMsg.locator('.message-bookmark-btn')).toHaveClass(/active/)
  })

  // SPEC: bookmark:toggle-visibility
  test('bookmarked user message shows corner triangle', async ({ page }) => {
    await openSessionWithAPI(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await expect(userMsg).not.toHaveClass(/bookmarked/)

    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    await expect(userMsg).toHaveClass(/bookmarked/)
  })

  // SPEC: bookmark:toggle-visibility
  test('bookmarked assistant turn shows corner triangle', async ({ page }) => {
    await openSessionWithAPI(page)

    const assistantMsg = page.locator('[data-testid="message-assistant"]').first()
    await expect(assistantMsg).not.toHaveClass(/bookmarked/)

    await assistantMsg.hover()
    await assistantMsg.locator('.turn-bookmark-btn').dispatchEvent('click')

    await expect(assistantMsg).toHaveClass(/bookmarked/)
  })
})

test.describe('Bookmarks Panel Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: panel-bookmarks:time-live
  test("a bookmark's relative time keeps up while the panel stays open", async ({ page }) => {
    await page.clock.install({ time: Date.parse('2026-03-01T12:00:00Z') })
    await openBookmarkedPanel(page)
    const time = page.locator('[data-testid="panel-bookmarks"] .bookmark-time').first()
    await expect(time).toHaveText('just now')

    await page.clock.fastForward('05:00')

    await expect(time).toHaveText('5m ago')
  })

  // SPEC: panel-bookmarks:preview
  test('bookmark entry shows preview text and relative timestamp', async ({ page }) => {
    const panel = await openBookmarkedPanel(page)
    await expect(panel).toBeVisible()

    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem).toBeVisible()
    await expect(bookmarkItem.locator('.bookmark-preview')).toBeVisible()
    await expect(bookmarkItem.locator('.bookmark-time')).toBeVisible()
  })

  // SPEC: panel-bookmarks:session-scroll
  test('clicking session bookmark scrolls to the bookmarked turn', async ({ page }) => {
    await openSession(page)

    const userMsg = await bookmarkFirstUserMessage(page)

    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')

    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await bookmarkItem.click()

    await expect(userMsg).toBeInViewport()
  })

  // SPEC: panel-bookmarks:remove
  test('remove button visible on hover removes bookmark', async ({ page }) => {
    const panel = await openBookmarkedPanel(page)

    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem).toBeVisible()

    await bookmarkItem.hover()
    const removeBtn = bookmarkItem.locator('.bookmark-remove')
    await expect(removeBtn).toBeVisible()

    await removeBtn.click()

    await expect(panel).toContainText('No bookmarks')
  })

  // SPEC: panel-bookmarks:preview
  test('bookmark entry has no type label and shows preview first', async ({ page }) => {
    const panel = await openBookmarkedPanel(page)

    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem.locator('.bookmark-type')).toHaveCount(0)

    // The remove button is the first child; the preview lives inside .bookmark-row alongside the status dot.
    const preview = bookmarkItem.locator('.bookmark-preview')
    await expect(preview).toBeVisible()
  })

  // SPEC: panel-bookmarks:session-scroll
  test('clicking session bookmark triggers highlight animation', async ({ page }) => {
    await openSession(page)

    const userMsg = await bookmarkFirstUserMessage(page)

    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await panel.locator('[data-testid="bookmark-item"]').first().click()

    await expect(userMsg).toHaveClass(/jump-highlight/)
  })

  // SPEC: panel-bookmarks:remove
  test('remove button works on All sessions tab entries', async ({ page }) => {
    // Pre-seed ui-state with bookmarks from another session
    await mockAPI(page, {
      handlers: {
        getUIState: async route => {
          await route.fulfill({
            json: {
              global: {
                bookmarkedTurns: {
                  'other-session-001': ['turn_other_1:user'],
                },
                bookmarkMeta: {
                  'other-session-001/turn_other_1:user': {
                    preview: 'Remove me',
                    ts: '2025-01-15T10:00:00Z',
                  },
                },
              },
              session: {},
            },
          })
        },
      },
    })
    const panel = await openBookmarks(page)
    await panel.locator('button', { hasText: 'All sessions' }).click()

    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem).toBeVisible()

    await bookmarkItem.hover()
    const removeBtn = bookmarkItem.locator('.bookmark-remove')
    await expect(removeBtn).toBeVisible()

    await removeBtn.click()

    await expect(panel).toContainText('No bookmarks')
  })

  // SPEC: panel-bookmarks:all-sessions
  test('All sessions tab shows bookmarks from other sessions', async ({ page }) => {
    // Pre-seed ui-state with bookmarks from another session
    await mockAPI(page, {
      handlers: {
        getUIState: async route => {
          await route.fulfill({
            json: {
              global: {
                bookmarkedTurns: {
                  'other-session-001': ['turn_other_1'],
                },
                bookmarkMeta: {
                  'other-session-001/turn_other_1': {
                    preview: 'A message from another session',
                    ts: '2025-01-15T10:00:00Z',
                  },
                },
              },
              session: {},
            },
          })
        },
      },
    })
    const panel = await openBookmarks(page)

    await panel.locator('button', { hasText: 'All sessions' }).click()

    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem).toBeVisible()
    await expect(bookmarkItem.locator('.bookmark-preview')).toContainText(
      'A message from another session',
    )
    await expect(bookmarkItem.locator('.bookmark-session-name')).toBeVisible()
  })

  // SPEC: panel-bookmarks:status-dot
  test('bookmark item shows a container-status dot reflecting the source session', async ({
    page,
  }) => {
    const panel = await openBookmarkedPanel(page)

    // The status dot is a sibling of the preview inside .bookmark-row.
    const dot = panel
      .locator('[data-testid="bookmark-item"]')
      .first()
      .locator('.bookmark-row .container-status-dot')
    await expect(dot).toBeVisible()
  })

  // SPEC: panel-bookmarks:status-dot
  test("a bookmark's dot shows its session's state, in both tabs", async ({ page }) => {
    await serveSessionList(
      page,
      base => [{ ...base, container_id: DEFAULT_CONTAINER_ID, needs_user: 'Decide: which' }],
      '*',
    )
    const panel = await openBookmarkedPanel(page)
    const dot = () =>
      panel.locator('[data-testid="bookmark-item"]').first().locator('.container-status-dot')

    await expect(dot()).toHaveClass(/container-status-needs-you/)
    await panel.locator('button', { hasText: 'All sessions' }).click()
    await expect(dot()).toHaveClass(/container-status-needs-you/)
  })

  // SPEC: panel-bookmarks:tooltip
  test('bookmark preview carries a title attribute with the full text', async ({ page }) => {
    const panel = await openBookmarkedPanel(page)

    const preview = panel
      .locator('[data-testid="bookmark-item"]')
      .first()
      .locator('.bookmark-preview')
    const title = await preview.getAttribute('title')
    expect(title).toBeTruthy()
    expect(title.length).toBeGreaterThan(0)
    // Tooltip text matches the visible preview (or a fallback derived from turnId).
    await expect(preview).toContainText(title.slice(0, 20))
  })

  // SPEC: panel-bookmarks:new-tab
  test('Alt+click on a bookmark opens the source session in a new browser tab', async ({
    page,
  }) => {
    const panel = await openBookmarkedPanel(page)
    const item = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(item).toBeVisible()

    // Capture window.open invocation - the page does it synchronously.
    await page.evaluate(() => {
      window.__opened = []
      window.open = url => {
        window.__opened.push(url)
        return null
      }
    })

    await item.click({ modifiers: ['Alt'] })

    const opened = await page.evaluate(() => window.__opened)
    expect(opened.length).toBe(1)
    expect(opened[0]).toContain('/sessions/')
  })

  // SPEC: panel-bookmarks:new-tab
  test('middle-click on a bookmark opens the source session in a new browser tab', async ({
    page,
  }) => {
    const panel = await openBookmarkedPanel(page)
    const item = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(item).toBeVisible()

    await page.evaluate(() => {
      window.__opened = []
      window.open = url => {
        window.__opened.push(url)
        return null
      }
    })

    await item.click({ button: 'middle' })

    const opened = await page.evaluate(() => window.__opened)
    expect(opened.length).toBe(1)
    expect(opened[0]).toContain('/sessions/')
  })
})

async function openTab(page, uiState) {
  await openSessionWithAPI(page, 'events/simple-chat.jsonl', { uiState })
}

async function bookmarkFirstMessage(page) {
  const message = page.locator('[data-testid="message-user"]').first()
  await message.hover()
  await message.locator('.message-bookmark-btn').dispatchEvent('click')
}
