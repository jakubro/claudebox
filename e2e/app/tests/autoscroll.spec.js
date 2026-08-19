/** E2E tests for chat autoscroll behavior and tab switch preservation. */

import { expect, test } from '@playwright/test'
import {
  openBookmarksPanel,
  openSessionsPanel,
  openTasksPanel,
  waitForAppReady,
  waitForStableScrollHeight,
} from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE, mockSSEDynamic } from '../mocks/sse.js'

test.describe('Autoscroll', () => {
  // SPEC: chat:autoscroll-bottom
  test('auto-scrolls to new content at bottom', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/long-conversation.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // List is windowed and opens at the bottom - assert on the newest turn, not the first.
    await expect(page.locator('[data-testid="turn-container"]').last()).toBeVisible()

    const messagesContainer = page.locator('[data-testid="chat-messages"]')
    await expect(messagesContainer).toBeVisible()

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

    // List is windowed and opens at the bottom - assert on the newest turn, not the first.
    await expect(page.locator('[data-testid="turn-container"]').last()).toBeVisible()

    const messagesContainer = page.locator('[data-testid="chat-messages"]')
    await expect(messagesContainer).toBeVisible()

    await messagesContainer.evaluate(el => {
      el.scrollTop = 0
    })

    // Basic scroll position check; full autoscroll-disable with new content is in Content Growth below.
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

    await messagesContainer.evaluate(el => {
      el.scrollTop = 0
    })

    await expect.poll(() => messagesContainer.evaluate(el => el.scrollTop)).toBe(0)

    await messagesContainer.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })

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

      // List is windowed and opens at the bottom - wait on the newest turn, not the first.
      await expect(page.locator('[data-testid="turn-container"]').last()).toBeVisible()

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      await messagesContainer.evaluate(el => {
        el.scrollTop = 100
      })

      await expect.poll(() => messagesContainer.evaluate(el => el.scrollTop)).toBe(100)
      const initialScroll = 100

      // Opening the panel causes a layout change.
      await openSessionsPanel(page)

      // Small tolerance accounts for layout-shift jitter.
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

      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'Hello', timestamp: Date.now() },
        { type: 'assistant', subtype: 'text', content: 'Response', timestamp: Date.now() },
        { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() },
      ])

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      await messagesContainer.evaluate(el => {
        el.scrollTop = 0
      })
      await expect.poll(() => messagesContainer.evaluate(el => el.scrollTop)).toBe(0)

      await openSessionsPanel(page)

      await controller.sendEvents([
        { type: 'user', subtype: 'text', is_human: true, content: 'More', timestamp: Date.now() },
        { type: 'assistant', subtype: 'text', content: 'More response', timestamp: Date.now() },
        { type: 'result', subtype: 'success', turn_id: 'turn_002', timestamp: Date.now() },
      ])

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
      // The injected nested scrollable needs a turn to attach to, and autoscroll must settle first.
      await waitForStableScrollHeight(messagesContainer)

      // Button title is the observable autoscroll signal ('Autoscroll enabled' / 'Last message (Alt+End)'),
      // see ChatControlBar.jsx:212 - avoids window.__chat_controller__, a dev-only hook stripped from prod.
      const jumpBtn = page.locator(
        'button[title="Autoscroll enabled"], button[title="Last message (Alt+End)"]',
      )
      await expect(jumpBtn).toBeVisible()
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')

      // Injects overflow:auto into the last turn; the predicate treats any such ancestor as wheel-consuming.
      await page.evaluate(() => {
        // Must be the LAST turn (in view) - an off-window turn has no element, so scrollTop=100 won't
        // stick, roomUp reads false, and the wheel misreads as outer intent (the guarded-against flake).
        const turns = document.querySelectorAll('.turn-text')
        const turn = turns[turns.length - 1]
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
        void nested.offsetHeight // force layout so the scrollTop write sticks
        // Position partway down so wheel events have room to scroll either way
        nested.scrollTop = 100
      })

      // Guard: without scroll room, _isNestedScrollableConsuming reads roomUp=false, invalidating the assertion.
      await expect
        .poll(() => page.locator('#__test_nested_scrollable__').evaluate(el => el.scrollTop))
        .toBe(100)

      // Uses Playwright's Locator.dispatchEvent (same CDP path as the Content Growth test's wheel dispatch)
      // rather than page.evaluate + new WheelEvent(), which bubbles inconsistently in chromium - without the fix,
      // .chat-messages treats this as user intent; with it, isNestedScrollableConsuming bails.
      await page
        .locator('#__test_nested_scrollable__')
        .dispatchEvent('wheel', { deltaY: -50, bubbles: true })

      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')
    })
  })

  test.describe('Bookmark Click', () => {
    // SPEC: chat:bookmark-click-respects-autoscroll
    test('bookmark click that lands viewport not-at-bottom disengages auto-scroll', async ({
      page,
    }) => {
      // 60 sequential page.evaluate round-trips push past the default 5s cap once delivery batches at 50ms.
      test.setTimeout(30000)
      // Pre-seeding the bookmark targets the first user message of a long conversation, far above the bottom,
      // so clicking it expresses intent to leave the live tail.
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
      // Synthesizes turn_id on every user event so the bookmark's target (turn_001) has a [data-turn-id]
      // anchor - the long-conversation.jsonl fixture omits turn_id on user events.
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
      // Preloading (vs. a controller's one-shot sendEvents) makes turns replay on every reconnect; a
      // one-shot send is silently dropped if it lands in the ~3-connection reconnect gap while resuming.
      await mockSSEDynamic(page, () => events)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Last turn anchors the bottom (never virtualized away), unlike turn_001 which scrolls off once pinned.
      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      const lastTurnId = `turn_${String(N).padStart(3, '0')}`
      await expect(page.locator(`[data-turn-id="${lastTurnId}"]`)).toBeVisible()

      await expect
        .poll(() =>
          messagesContainer.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50),
        )
        .toBe(true)

      // Same jump-to-bottom-button-title signal used in the nested-scrollable test above.
      const jumpBtn = page.locator(
        'button[title="Autoscroll enabled"], button[title="Last message (Alt+End)"]',
      )
      await expect(jumpBtn).toBeVisible()
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')

      await openBookmarksPanel(page)
      const panel = page.locator('[data-testid="panel-bookmarks"]')
      const bookmarkItem = panel.locator('[data-testid="bookmark-item"]').first()
      await expect(bookmarkItem).toBeVisible()
      await bookmarkItem.click()

      // The bookmarked turn lands at viewport top, far from bottom, so autoscroll disengages.
      await expect(jumpBtn).toHaveAttribute('title', 'Last message (Alt+End)')
    })

    // SPEC: chat:bookmark-click-respects-autoscroll
    test('bookmark click whose target keeps viewport at bottom does not change engagement', async ({
      page,
    }) => {
      // Default session's single turn ("Hello"/"Hi") is within AUTOSCROLL_THRESHOLD of bottom, so
      // willBeAtBottom is true and engagement is unchanged.
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

      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')
    })
  })

  test.describe('Task Click', () => {
    // SPEC: chat:task-click-respects-autoscroll
    test('task click that lands viewport not-at-bottom disengages auto-scroll', async ({
      page,
    }) => {
      // Same round-trip budget as the bookmark equivalent above.
      test.setTimeout(30000)
      await mockAPI(page)

      // A running (result-less) Task far above the bottom, same shape as the Bookmark Click target.
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
        if (i === 1) {
          events.push({
            type: 'assistant',
            subtype: 'tool_use',
            content: 'Task',
            tool_use_id: 'task_click_001',
            tool_name: 'Task',
            tool_input: {
              description: 'Background build',
              prompt: 'run it',
              subagent_type: 'Bash',
            },
            id: 'evt_task_001',
            primary: false,
            is_human: false,
            ts: '2025-01-18T12:00:01Z',
          })
        }
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
      await mockSSEDynamic(page, () => events)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      const lastTurnId = `turn_${String(N).padStart(3, '0')}`
      await expect(page.locator(`[data-turn-id="${lastTurnId}"]`)).toBeVisible()

      await expect
        .poll(() =>
          messagesContainer.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50),
        )
        .toBe(true)

      const jumpBtn = page.locator(
        'button[title="Autoscroll enabled"], button[title="Last message (Alt+End)"]',
      )
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')

      await openTasksPanel(page)
      const taskEntry = page.locator('[data-testid="task-entry"]').first()
      await expect(taskEntry).toBeVisible()
      await taskEntry.click()

      // The task's turn lands at viewport top, far from bottom, so autoscroll disengages.
      await expect(jumpBtn).toHaveAttribute('title', 'Last message (Alt+End)')
    })

    // SPEC: chat:task-click-respects-autoscroll
    test('task click whose target keeps viewport at bottom does not change engagement', async ({
      page,
    }) => {
      // A running task in the default session's single (and therefore at-bottom) turn.
      await mockAPI(page)
      await mockSSEDynamic(page, () => [
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hello',
          turn_id: 'turn_001',
          id: 'evt_001',
          primary: true,
          ts: '2025-01-18T12:00:00Z',
        },
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Task',
          tool_use_id: 'task_click_002',
          tool_name: 'Task',
          tool_input: { description: 'Quick check', prompt: 'run it', subagent_type: 'Bash' },
          id: 'evt_002',
          primary: false,
          is_human: false,
          ts: '2025-01-18T12:00:01Z',
        },
      ])
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      const jumpBtn = page.locator(
        'button[title="Autoscroll enabled"], button[title="Last message (Alt+End)"]',
      )
      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')

      await openTasksPanel(page)
      const taskEntry = page.locator('[data-testid="task-entry"]').first()
      await expect(taskEntry).toBeVisible()
      await taskEntry.click()

      await expect(jumpBtn).toHaveAttribute('title', 'Autoscroll enabled')
    })
  })

  test.describe('Content Growth', () => {
    // SPEC: chat:autoscroll-disable
    // SPEC: chat:autoscroll-streaming-responsive
    test('scroll position stable when new content arrives while scrolled up', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/long-conversation.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // List is windowed and opens at the bottom - wait on the newest turn, not the first.
      await expect(page.locator('[data-testid="turn-container"]').last()).toBeVisible()

      const messagesContainer = page.locator('[data-testid="chat-messages"]')
      await expect(messagesContainer).toBeVisible()

      await expect
        .poll(() =>
          messagesContainer.evaluate(el => {
            const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight
            return scrollBottom < 50
          }),
        )
        .toBe(true)

      // CONTRACT: ChatController infers user-scroll intent only from input events, not height-equality
      // heuristics - a bare `el.scrollTop = ...` no longer disengages autoscroll, only a real event does;
      // this dispatches a wheel event first to exercise that state.
      await messagesContainer.dispatchEvent('wheel', { deltaY: -100 })
      await messagesContainer.evaluate(el => {
        el.scrollTop = 100
      })
      await expect.poll(() => messagesContainer.evaluate(el => el.scrollTop)).toBe(100)

      const beforeScroll = 100

      // Injects new SSE events via the active mock instance while scrolled up.
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

      await expect(page.getByText('New question after scroll')).toBeVisible()

      await expect
        .poll(async () => {
          const currentScroll = await messagesContainer.evaluate(el => el.scrollTop)
          return Math.abs(currentScroll - beforeScroll)
        })
        .toBeLessThan(20)
    })
  })
})
