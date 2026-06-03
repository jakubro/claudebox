/** E2E tests for bookmarks panel and bookmark toggle. */

import { expect, test } from '@playwright/test'
import { openBookmarksPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Bookmarks Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: panel-bookmarks:shortcut
  test('Alt+5 toggles bookmarks panel', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmarks panel is open by default.
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await expect(panel).toBeVisible()

    await page.keyboard.press('Alt+5')
    await expect(panel).not.toBeVisible()

    await page.keyboard.press('Alt+5')
    await expect(panel).toBeVisible()
  })

  // SPEC: panel-bookmarks:loading
  test('renders panel-level loading placeholder during cold load — no tabs, no false-empty', async ({
    page,
  }) => {
    // Hold the /ui-state response so the bookmarks loading state stays visible
    // for assertions. The bookmarks hook gates `loading=true` until the first
    // ui-state fetch settles.
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

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmarks panel is open by default — no toggle needed.
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
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmarks panel is open by default — no toggle needed.
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('No bookmarks')
  })

  // SPEC: panel-bookmarks:tab-auto-switch
  test('tab auto-switches with session presence; manual click holds until next session change', async ({
    page,
  }) => {
    await mockSSE(page)
    // Start at a session so the app fully boots (panels mount), then we
    // navigate home to enter the no-session welcome state.
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const panel = page.locator('[data-testid="panel-bookmarks"]')
    if (!(await panel.isVisible())) {
      // Move focus off the chat input so Alt+5 triggers the panel shortcut.
      await page.locator('body').click()
      await page.keyboard.press('Alt+5')
    }
    await expect(panel).toBeVisible({ timeout: 5000 })

    const sessionTab = panel.locator('button', { hasText: 'This session' })
    const allTab = panel.locator('button', { hasText: 'All sessions' })

    // Session is active on initial load → "This session" active.
    await expect(sessionTab).toHaveClass(/active/)

    // Navigate home (clear session) → auto-switch to "All sessions".
    await page.evaluate(() => {
      history.pushState(null, '', window.location.pathname + window.location.search)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await expect(allTab).toHaveClass(/active/, { timeout: 5000 })
    await expect(sessionTab).not.toHaveClass(/active/)

    // Re-open session → auto-switch back to "This session".
    await page.evaluate(() => {
      window.location.hash = '#/workspaces/test-ws/sessions/test-session-001'
    })
    await expect(sessionTab).toHaveClass(/active/, { timeout: 5000 })
    await expect(allTab).not.toHaveClass(/active/)

    // Manually click "All sessions" → tab stays even though session is active.
    await allTab.click()
    await expect(allTab).toHaveClass(/active/)
    await expect(sessionTab).not.toHaveClass(/active/)
    // Hold a moment to confirm no spurious re-assert.
    await page.waitForTimeout(300)
    await expect(allTab).toHaveClass(/active/)

    // Now change session presence — auto-switch should win again.
    // Navigate home, then back to session.
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
    // Seed bookmarks via the ui-state GET response so the badges have non-zero
    // counts to render. 2 in current session + 1 elsewhere → This=2, All=3.
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
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBookmarksPanel(page)

    const panel = page.locator('[data-testid="panel-bookmarks"]')
    const thisTab = panel.locator('button', { hasText: 'This session' })
    const allTab = panel.locator('button', { hasText: 'All sessions' })
    await expect(thisTab).toBeVisible()
    await expect(allTab).toBeVisible()

    // Each tab must surface a numeric badge — the claim names "with count
    // badges". Non-zero seeded state proves the badge actually renders.
    await expect(thisTab).toContainText('2')
    await expect(allTab).toContainText('3')
  })

  // SPEC: panel-bookmarks:tabs
  test('All sessions tab shows empty state', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openBookmarksPanel(page)

    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await panel.locator('button', { hasText: 'All sessions' }).click()
    await expect(panel).toContainText('No bookmarks')
  })

  // SPEC: panel-bookmarks:shortcut
  test('bookmarks icon is in right icon strip', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
    await mockSSE(page) // default fixture includes a user message
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Find user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await expect(userMsg).toBeVisible()

    // Bookmark button should be hidden initially
    const bookmarkBtn = userMsg.locator('.message-bookmark-btn')
    await expect(bookmarkBtn).toHaveCSS('opacity', '0')

    // Hover to reveal
    await userMsg.hover()
    await expect(bookmarkBtn).toHaveCSS('opacity', '1')
  })

  // SPEC: bookmark:toggle-visibility
  test('clicking bookmark button toggles bookmark state', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()

    const bookmarkBtn = userMsg.locator('.message-bookmark-btn')
    await expect(bookmarkBtn).toBeVisible()

    // Should not be active initially
    await expect(bookmarkBtn).not.toHaveClass(/active/)

    // Click to bookmark (force: rewind split button overlaps in hover state)
    await bookmarkBtn.dispatchEvent('click')
    await expect(bookmarkBtn).toHaveClass(/active/)

    // Click again to unbookmark
    await bookmarkBtn.dispatchEvent('click')
    await expect(bookmarkBtn).not.toHaveClass(/active/)
  })

  // SPEC: bookmark:persistence
  test('bookmark state survives page reload', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark the first user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    const bookmarkBtn = userMsg.locator('.message-bookmark-btn')
    await bookmarkBtn.dispatchEvent('click')
    await expect(bookmarkBtn).toHaveClass(/active/)

    // Reload the page (ui-state mock retains state in-memory)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark should still be active after reload
    const userMsgAfter = page.locator('[data-testid="message-user"]').first()
    await userMsgAfter.hover()
    const bookmarkBtnAfter = userMsgAfter.locator('.message-bookmark-btn')
    await expect(bookmarkBtnAfter).toHaveClass(/active/)
  })

  // SPEC: bookmark:minimap-segment
  test('bookmarked turn shows yellow indicator in minimap', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // No bookmark-highlighted sub-bars initially
    const subbars = page.locator('[data-testid="minimap-subbar"]')
    const firstSubbar = subbars.first()
    await expect(firstSubbar).not.toHaveCSS('background-color', 'rgb(232, 185, 49)')

    // Bookmark the first user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    // Minimap sub-bar should now have bookmark yellow background
    await expect(firstSubbar).toHaveCSS('background-color', 'rgb(232, 185, 49)')
  })

  // SPEC: bookmark:cross-tab
  test('bookmark changes write localStorage signal for cross-tab sync', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Clear any existing signal
    await page.evaluate(() => localStorage.removeItem('claudebox-bookmarks-changed'))

    // Bookmark the first user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    // localStorage signal should have been written
    const signal = await page.evaluate(() => localStorage.getItem('claudebox-bookmarks-changed'))
    expect(signal).not.toBeNull()
  })
})

test.describe('Bookmark Toggle on Assistant Turns', () => {
  // SPEC: bookmark:toggle-btn
  test('bookmark button appears on assistant turn hover', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const assistantMsg = page.locator('[data-testid="message-assistant"]').first()
    await expect(assistantMsg).toBeVisible()

    // Bookmark button is inline in turn-meta (always visible when turn-meta is visible)
    const bookmarkBtn = assistantMsg.locator('.turn-bookmark-btn')
    await expect(bookmarkBtn).toBeVisible()
  })

  // SPEC: bookmark:toggle-visibility
  test('user and assistant bookmarks are independent', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    const userBtn = userMsg.locator('.message-bookmark-btn')
    await userBtn.dispatchEvent('click')
    await expect(userBtn).toHaveClass(/active/)

    // Bookmark assistant message in same turn
    const assistantMsg = page.locator('[data-testid="message-assistant"]').first()
    await assistantMsg.hover()
    const assistantBtn = assistantMsg.locator('.turn-bookmark-btn')
    await assistantBtn.dispatchEvent('click')
    await expect(assistantBtn).toHaveClass(/active/)

    // Both should be active independently
    await userMsg.hover()
    await expect(userMsg.locator('.message-bookmark-btn')).toHaveClass(/active/)
  })

  // SPEC: bookmark:toggle-visibility
  test('bookmarked user message shows corner triangle', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await expect(userMsg).not.toHaveClass(/bookmarked/)

    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    await expect(userMsg).toHaveClass(/bookmarked/)
  })

  // SPEC: bookmark:toggle-visibility
  test('bookmarked assistant turn shows corner triangle', async ({ page }) => {
    await mockSSE(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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

  // SPEC: panel-bookmarks:preview
  test('bookmark entry shows preview text and relative timestamp', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark the first user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    // Open bookmarks panel
    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await expect(panel).toBeVisible()

    // Bookmark item should show preview and timestamp
    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem).toBeVisible()
    await expect(bookmarkItem.locator('.bookmark-preview')).toBeVisible()
    await expect(bookmarkItem.locator('.bookmark-time')).toBeVisible()
  })

  // SPEC: panel-bookmarks:session-scroll
  test('clicking session bookmark scrolls to the bookmarked turn', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark the first user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    // Open bookmarks panel
    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')

    // Click the bookmark entry
    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await bookmarkItem.click()

    // The bookmarked turn should be in viewport (scrolled to)
    await expect(userMsg).toBeInViewport()
  })

  // SPEC: panel-bookmarks:remove
  test('remove button visible on hover removes bookmark', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark the first user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    // Open bookmarks panel
    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')

    // Bookmark item should be present
    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem).toBeVisible()

    // Hover to reveal remove button
    await bookmarkItem.hover()
    const removeBtn = bookmarkItem.locator('.bookmark-remove')
    await expect(removeBtn).toBeVisible()

    // Click remove
    await removeBtn.click()

    // Bookmark should be gone — empty state shown
    await expect(panel).toContainText('No bookmarks')
  })

  // SPEC: panel-bookmarks:preview
  test('bookmark entry has no type label and shows preview first', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark a user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    // Open bookmarks panel
    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')

    // Bookmark item should NOT have a type label
    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem.locator('.bookmark-type')).toHaveCount(0)

    // Preview should be present — the remove button is the first child;
    // the preview lives inside .bookmark-row alongside the status dot.
    const preview = bookmarkItem.locator('.bookmark-preview')
    await expect(preview).toBeVisible()
  })

  // SPEC: panel-bookmarks:session-scroll
  test('clicking session bookmark triggers highlight animation', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark the first user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    // Open bookmarks panel and click the entry
    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await panel.locator('[data-testid="bookmark-item"]').first().click()

    // The user message should get the jump-highlight class
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
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Open bookmarks panel, switch to All sessions
    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    await panel.locator('button', { hasText: 'All sessions' }).click()

    // Bookmark item should exist
    const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(bookmarkItem).toBeVisible()

    // Hover to reveal remove button
    await bookmarkItem.hover()
    const removeBtn = bookmarkItem.locator('.bookmark-remove')
    await expect(removeBtn).toBeVisible()

    // Click remove
    await removeBtn.click()

    // Bookmark should be gone — empty state shown
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
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Open bookmarks panel
    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')

    // Switch to "All sessions" tab
    await panel.locator('button', { hasText: 'All sessions' }).click()

    // Should show bookmark from the other session with session name and preview
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
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Bookmark a user message
    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')

    // The status dot is a sibling of the preview inside .bookmark-row
    const dot = panel
      .locator('[data-testid="bookmark-item"]')
      .first()
      .locator('.bookmark-row .container-status-dot')
    await expect(dot).toBeVisible()
  })

  // SPEC: panel-bookmarks:tooltip
  test('bookmark preview carries a title attribute with the full text', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')

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
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')
    const item = panel.locator('[data-testid="bookmark-item"]').first()
    await expect(item).toBeVisible()

    // Capture window.open invocation — the page does it synchronously.
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
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const userMsg = page.locator('[data-testid="message-user"]').first()
    await userMsg.hover()
    await userMsg.locator('.message-bookmark-btn').dispatchEvent('click')

    await openBookmarksPanel(page)
    const panel = page.locator('[data-testid="panel-bookmarks"]')
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
