/** E2E tests for chat autoscroll behavior and tab switch preservation. */

import { expect, test } from '@playwright/test'
import { openBookmarksPanel, openSessionsPanel, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Autoscroll', () => {
  // SPEC: chat:autoscroll-bottom
  test('auto-scrolls to new content at bottom', async ({ page }) => {
    // Use long conversation to ensure scrollable content
    await mockAPI(page)
    await mockSSE(page, 'events/long-conversation.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Wait for messages to load
    await expect(page.getByText('Hello').first()).toBeVisible()

    // Get the chat messages container
    const messagesContainer = page.locator('[data-testid="chat-messages"]')
    await expect(messagesContainer).toBeVisible()

    // Poll until scrolled near bottom (within threshold of 100px)
    await expect
      .poll(async () => {
        return await messagesContainer.evaluate(el => {
          const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          return scrollBottom < 100
        })
      })
      .toBe(true)
  })

  // SPEC: chat:autoscroll-disable
  test('disables auto-scroll when user scrolls up', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/long-conversation.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Wait for messages to load
    await expect(page.getByText('Hello').first()).toBeVisible()

    const messagesContainer = page.locator('[data-testid="chat-messages"]')
    await expect(messagesContainer).toBeVisible()

    // Scroll up manually
    await messagesContainer.evaluate(el => {
      el.scrollTop = 0
    })

    // Basic scroll position check; full autoscroll-disable with new content verified in Content Growth section below
    await expect
      .poll(async () => {
        return await messagesContainer.evaluate(el => el.scrollTop)
      })
      .toBe(0)
  })

  // SPEC: chat:autoscroll-reenable
  test('re-enables auto-scroll when user scrolls to bottom', async ({ page }) => {
    const controller = await createSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Send initial events
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'First message',
        timestamp: 1705600000000,
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Response 1',
        timestamp: 1705600001000,
      },
      { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: 1705600002000 },
    ])

    const messagesContainer = page.locator('[data-testid="chat-messages"]')
    await expect(messagesContainer).toBeVisible()

    // Scroll to top (disables autoscroll)
    await messagesContainer.evaluate(el => {
      el.scrollTop = 0
    })

    // Verify scroll to top
    await expect.poll(() => messagesContainer.evaluate(el => el.scrollTop)).toBe(0)

    // Scroll back to bottom (re-enables autoscroll)
    await messagesContainer.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })

    // Send more events
    await controller.sendEvents([
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Second message',
        timestamp: 1705600010000,
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Response 2 with more content to trigger scroll',
        timestamp: 1705600011000,
      },
      { type: 'result', subtype: 'success', turn_id: 'turn_002', timestamp: 1705600012000 },
    ])

    // Poll until near bottom again
    await expect
      .poll(async () => {
        return await messagesContainer.evaluate(el => {
          const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          return scrollBottom < 100
        })
      })
      .toBe(true)
  })

  test.describe('Tab Switch Preservation', () => {
    // SPEC: chat:autoscroll-tab-switch
    test('scroll position preserved when opening side panel', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/long-conversation.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for messages to load
      await expect(page.getByText('Hello').first()).toBeVisible()

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      // Scroll up to a specific position
      await messagesContainer.evaluate(el => {
        el.scrollTop = 100
      })

      // Verify scroll position
      await expect.poll(() => messagesContainer.evaluate(el => el.scrollTop)).toBe(100)
      const initialScroll = 100

      // Open sessions panel (causes layout change)
      await openSessionsPanel(page)

      // Poll until scroll position is preserved (may vary slightly due to layout shift)
      await expect
        .poll(async () => {
          const afterPanelScroll = await messagesContainer.evaluate(el => el.scrollTop)
          return Math.abs(afterPanelScroll - initialScroll)
        })
        .toBeLessThan(50)
    })

    // SPEC: chat:autoscroll-tab-switch
    test('autoscroll state preserved when opening side panel', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send initial events
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'Hello', timestamp: Date.now() },
        { type: 'assistant', subtype: 'text', content: 'Response', timestamp: Date.now() },
        { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() },
      ])

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      // Scroll up to disable autoscroll
      await messagesContainer.evaluate(el => {
        el.scrollTop = 0
      })
      await expect.poll(() => messagesContainer.evaluate(el => el.scrollTop)).toBe(0)

      // Open sessions panel
      await openSessionsPanel(page)

      // Send more events
      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'More', timestamp: Date.now() },
        { type: 'assistant', subtype: 'text', content: 'More response', timestamp: Date.now() },
        { type: 'result', subtype: 'success', turn_id: 'turn_002', timestamp: Date.now() },
      ])

      // Poll to verify still near top (autoscroll still disabled)
      await expect
        .poll(async () => {
          return await messagesContainer.evaluate(el => el.scrollTop)
        })
        .toBeLessThan(50)
    })
  })

  test.describe('Nested Scrollables', () => {
    // SPEC: chat:auto-scroll-ignores-nested-scroll
    test('wheel inside nested scrollable does not disengage auto-scroll', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/long-conversation.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      // Observable autoscroll-state signal: the jump-to-bottom button's title.
      // - "Autoscroll enabled" -> autoscroll on (button is the disabled-pressed state)
      // - "Last message (Alt+End)" -> autoscroll off
      // (See ChatControlBar.jsx line 212.) Avoids depending on the dev-only
      // window.__chat_controller__ hook which is stripped from the prod build
      // the playwright webServer serves.
      const jumpBtn = page.locator(
        'button[title="Autoscroll enabled"], button[title="Last message (Alt+End)"]',
      )
      await expect(jumpBtn).toBeVisible()
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')

      // Inject a synthetic nested scrollable (an overflow:auto div with room
      // to scroll) into the last visible turn - the predicate is purely
      // structural, so any inner overflow:auto ancestor consumes the wheel.
      await page.evaluate(() => {
        const turn = document.querySelector('.turn-text')
        if (!turn) {
          throw new Error('no turn found to inject scrollable')
        }
        const nested = document.createElement('div')
        nested.id = '__test_nested_scrollable__'
        nested.style.cssText = 'overflow-y: auto; height: 80px; max-height: 80px;'
        const inner = document.createElement('div')
        inner.style.cssText = 'height: 400px;'
        nested.appendChild(inner)
        turn.appendChild(nested)
        // Position partway down so wheel events have room to scroll either way
        nested.scrollTop = 100
      })

      // Dispatch a real wheel on the nested scrollable via Playwright's
      // Locator.dispatchEvent - this routes through the same CDP path the
      // existing Content Growth test uses (line 295). page.evaluate +
      // new WheelEvent() bubbles inconsistently in chromium under playwright,
      // so use the framework path. Without the fix the outer .chat-messages
      // listener treats this as user intent. With the fix
      // isNestedScrollableConsuming bails.
      await page
        .locator('#__test_nested_scrollable__')
        .dispatchEvent('wheel', { deltaY: -50, bubbles: true })

      // Title must remain "Autoscroll enabled" - autoscroll engagement preserved.
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')
    })
  })

  test.describe('Bookmark Click', () => {
    // SPEC: chat:bookmark-click-respects-autoscroll
    test('bookmark click that lands viewport not-at-bottom disengages auto-scroll', async ({
      page,
    }) => {
      // 60 sequential page.evaluate round-trips for the synthesized
      // conversation plus the at-bottom settle poll plus the bookmark
      // interaction and assertion. The default 5 s test cap is too tight
      // once event delivery is batched (events commit on the 50 ms flush
      // cadence rather than per dispatch), so cumulative ~600 ms of
      // sendEvents + render + settle leaves no slack.
      test.setTimeout(30000)
      // Pre-seed the bookmark via ui-state - the first user message of a long
      // conversation sits far above the bottom, so clicking the bookmark
      // expresses intent to leave the live tail.
      await mockAPI(page, {
        handlers: {
          getUIState: async route => {
            await route.fulfill({
              json: {
                global: {
                  bookmarkedTurns: {
                    [DEFAULT_SESSION_ID]: ['turn_001:user'],
                  },
                  bookmarkMeta: {
                    [`${DEFAULT_SESSION_ID}/turn_001:user`]: {
                      preview: 'First message',
                      ts: '2025-01-18T12:00:00Z',
                    },
                  },
                },
                session: {},
              },
            })
          },
        },
      })
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Synthesize a long conversation with explicit turn_id on every user
      // event so the bookmark's target (turn_001) has a [data-turn-id] anchor.
      // The fixture file `long-conversation.jsonl` omits turn_id on user
      // events, which would leave turn.turn_id undefined and the data-turn-id
      // attribute absent.
      const events = []
      const N = 20
      for (let i = 1; i <= N; i++) {
        const id = String(i).padStart(3, '0')
        events.push({
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: i === 1 ? 'First message' : `Message ${i}`,
          turn_id: `turn_${id}`,
          id: `evt_u_${id}`,
          primary: true,
          ts: `2025-01-18T12:00:${id}Z`,
        })
        events.push({
          type: 'assistant',
          subtype: 'text',
          content: `Reply ${i}: ${'lorem ipsum '.repeat(20)}`,
          id: `evt_a_${id}`,
          primary: true,
          is_human: false,
          ts: `2025-01-18T12:00:${id}Z`,
        })
        events.push({
          type: 'result',
          subtype: 'success',
          turn_id: `turn_${id}`,
          id: `evt_r_${id}`,
          primary: false,
          is_human: false,
          ts: `2025-01-18T12:00:${id}Z`,
        })
      }
      await controller.sendEvents(events)

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      // Wait for the initial autoscroll to settle at bottom.
      await expect
        .poll(() =>
          messagesContainer.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50),
        )
        .toBe(true)

      // Observable autoscroll-state signal: jump-to-bottom button title
      // (matches the convention used by claim:chat:auto-scroll-ignores-nested-scroll).
      const jumpBtn = page.locator(
        'button[title="Autoscroll enabled"], button[title="Last message (Alt+End)"]',
      )
      await expect(jumpBtn).toBeVisible()
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')

      // Click the pre-seeded bookmark for the first turn.
      await openBookmarksPanel(page)
      const panel = page.locator('[data-testid="panel-bookmarks"]')
      const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
      await expect(bookmarkItem).toBeVisible()
      await bookmarkItem.click()

      // After the click the bookmarked turn is at viewport top (far from
      // bottom) -> autoscroll must have disengaged.
      await expect(jumpBtn).toHaveAttribute('title', 'Last message (Alt+End)')
    })

    // SPEC: chat:bookmark-click-respects-autoscroll
    test('bookmark click whose target keeps viewport at bottom does not change engagement', async ({
      page,
    }) => {
      // Default session has a single turn ("Hello" / "Hi") whose user message
      // is within AUTOSCROLL_THRESHOLD of bottom -> willBeAtBottom predicate
      // true -> autoscroll engagement unchanged.
      await mockAPI(page, {
        handlers: {
          getUIState: async route => {
            await route.fulfill({
              json: {
                global: {
                  bookmarkedTurns: {
                    [DEFAULT_SESSION_ID]: ['turn_001:user'],
                  },
                  bookmarkMeta: {
                    [`${DEFAULT_SESSION_ID}/turn_001:user`]: {
                      preview: 'Hello',
                      ts: '2025-01-18T12:00:00Z',
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

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      const jumpBtn = page.locator(
        'button[title="Autoscroll enabled"], button[title="Last message (Alt+End)"]',
      )
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')

      await openBookmarksPanel(page)
      const panel = page.locator('[data-testid="panel-bookmarks"]')
      const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
      await expect(bookmarkItem).toBeVisible()
      await bookmarkItem.click()

      // Engagement state unchanged - still on.
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')
    })
  })

  test.describe('Content Growth', () => {
    // SPEC: chat:autoscroll-disable
    // SPEC: chat:autoscroll-streaming-responsive
    test('scroll position stable when new content arrives while scrolled up', async ({ page }) => {
      // Use long-conversation fixture for initial scrollable content
      await mockAPI(page)
      await mockSSE(page, 'events/long-conversation.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for messages to load
      await expect(page.getByText('Hello').first()).toBeVisible()

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      // Wait for autoscroll to settle at bottom
      await expect
        .poll(() =>
          messagesContainer.evaluate(el => {
            const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight
            return scrollBottom < 50
          }),
        )
        .toBe(true)

      // CONTRACT: ChatController classifies user-scroll intent from
      // input events (wheel/touch/keyboard), not from height-equality
      // heuristics. A bare programmatic `el.scrollTop = ...` write therefore
      // no longer disengages auto-scroll - only a real wheel/touch/key event
      // does. This test dispatches a wheel event before positioning so the
      // assertion-under-test (scroll position holds while content streams)
      // exercises the disengaged state.
      await messagesContainer.dispatchEvent('wheel', { deltaY: -100 })
      await messagesContainer.evaluate(el => {
        el.scrollTop = 100
      })
      await expect.poll(() => messagesContainer.evaluate(el => el.scrollTop)).toBe(100)

      const beforeScroll = 100

      // Send new SSE events while scrolled up (injected via the active mock instance)
      await page.evaluate(() => {
        const instance = window.__sseActiveChatInstance || window.__sseChatInstance
        if (!instance || instance.readyState !== 1) {
          throw new Error('No active SSE instance')
        }
        const events = [
          {
            type: 'user',
            subtype: 'text',
            is_human: true,
            content: 'New question after scroll',
            turn_id: 'turn_new',
          },
          {
            type: 'assistant',
            subtype: 'text',
            content: 'New answer with significant content to push scroll height further down.',
          },
          { type: 'result', subtype: 'success', turn_id: 'turn_new' },
        ]
        for (const event of events) {
          const msgEvent = { data: JSON.stringify(event) }
          if (instance.onmessage) {
            instance.onmessage(msgEvent)
          }
          instance._emit('message', msgEvent)
        }
      })

      // Wait for the new content to render
      await expect(page.getByText('New question after scroll')).toBeVisible()

      // Scroll position should be unchanged (autoscroll disabled) - allow small variance
      await expect
        .poll(async () => {
          const currentScroll = await messagesContainer.evaluate(el => el.scrollTop)
          return Math.abs(currentScroll - beforeScroll)
        })
        .toBeLessThan(20)
    })
  })
})
