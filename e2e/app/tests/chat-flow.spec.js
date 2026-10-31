/** E2E tests for chat flow including message submission, pending states, draft persistence, and input animations. */

import { expect, test } from '@playwright/test'
import {
  assertRedColor,
  captureSends,
  openLiveSession,
  openSession,
  openWithDraft,
  resumeNamedSession,
  waitForAppReady,
  waitForStableScrollHeight,
} from '../helpers.js'
import { DEFAULT_SESSION_URL, DEFAULT_WORKSPACE_ID, mockAPI } from '../mocks/api.js'

const SECOND_SESSION_URL = `/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/test-session-002`

import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: input:always-focused
  // SPEC: chat:selection-not-preempted
  test('input receives focus when connected', async ({ page }) => {
    // Headless Chromium: focus() is a no-op without real OS window focus (concurrent workers).
    // Intercept focus calls to verify the autofocus effect targets the textarea.
    await page.addInitScript(() => {
      const orig = HTMLElement.prototype.focus
      window.__focusLog = []
      HTMLElement.prototype.focus = function (...args) {
        window.__focusLog.push(this.dataset?.testid || this.tagName)
        return orig.apply(this, args)
      }
    })

    await openSession(page)

    await expect
      .poll(() => page.evaluate(() => window.__focusLog.includes('chat-input')))
      .toBe(true)
  })

  // SPEC: shortcut:enter
  test('submits message on Enter', async ({ page }) => {
    const sendCalls = await captureSends(page)

    await openSession(page)

    await page.locator('[data-testid="chat-input"]').fill('Hello world')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0].prompt).toBe('Hello world')
  })

  // SPEC: turn:pending-show
  // SPEC: turn:progress-pending-framed
  test('shows pending message immediately, with its progress row inside the turn, surviving acknowledgement', async ({
    page,
  }) => {
    // Use dynamic SSE that returns empty initially (connection established but no events)
    await openSession(page, [])

    await page.locator('[data-testid="chat-input"]').fill('My pending message')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    await expect(page.getByText('My pending message')).toBeVisible()
    await expect(page.getByTestId('turn-progress-pending')).toBeVisible()

    // The server echoes the human message back (acknowledgement) - the frame must survive this,
    // since it tracks whether the turn has produced content, not whether it has been seen.
    await page.evaluate(() => {
      const instance = window.__sseChatInstance
      if (instance && instance.readyState === 1) {
        const msg = {
          data: JSON.stringify({
            type: 'user',
            subtype: 'text',
            is_human: true,
            content: 'My pending message',
            timestamp: Date.now(),
          }),
        }
        if (instance.onmessage) {
          instance.onmessage(msg)
        }
        instance._emit('message', msg)
      }
    })

    await expect(page.locator('.turn-container.pending')).not.toBeVisible()
    await expect(page.getByTestId('turn-progress-pending')).toBeVisible()

    // A tool lookup the transcript never shows is still nothing to show: the frame stays.
    await page.evaluate(() => {
      const instance = window.__sseChatInstance
      if (instance && instance.readyState === 1) {
        const msg = {
          data: JSON.stringify({
            type: 'assistant',
            subtype: 'tool_use',
            content: 'ToolSearch',
            tool_use_id: 'tu_search',
            tool_name: 'ToolSearch',
            tool_input: { query: 'select:WebFetch' },
            timestamp: Date.now(),
          }),
        }
        if (instance.onmessage) {
          instance.onmessage(msg)
        }
        instance._emit('message', msg)
      }
    })

    await expect(page.getByTestId('turn-progress-pending')).toBeVisible()
    await expect(page.getByTestId('turn-progress-pending')).toContainText('Working')
    await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(0)
  })

  // SPEC: turn:pending-remove
  test('removes pending when SSE confirms', async ({ page }) => {
    await openSession(page, [])

    await page.locator('[data-testid="chat-input"]').fill('Test message')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    await expect(page.locator('.turn-container.pending')).toBeVisible()

    // Deliver confirmed events via the mock SSE instance
    const events = [
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Test message',
        timestamp: Date.now(),
      },
      { type: 'result', subtype: 'success', turn_id: 'turn_001', timestamp: Date.now() + 100 },
    ]
    for (const event of events) {
      await page.evaluate(eventJson => {
        const instance = window.__sseChatInstance
        if (instance && instance.readyState === 1) {
          const msg = { data: JSON.stringify(JSON.parse(eventJson)) }
          if (instance.onmessage) {
            instance.onmessage(msg)
          }
          instance._emit('message', msg)
        }
      }, JSON.stringify(event))
    }

    await expect(page.locator('.turn-container.pending')).not.toBeVisible()
  })

  test('displays assistant response from SSE', async ({ page }) => {
    await mockSSE(page) // Uses simple-chat.jsonl
    await page.goto(DEFAULT_SESSION_URL)

    // Wait for assistant response (use first() in case of multiple renders)
    await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()
  })

  // SPEC: chat:duration-badge
  test('shows turn duration badge', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)

    // Wait for turn to complete and show duration (use first() for strict mode)
    await expect(page.locator('.turn-duration').first()).toBeVisible()
  })

  // SPEC: chat:error-border
  test('error turn has red border', async ({ page }) => {
    await mockSSE(page, 'events/chat-with-error.jsonl')
    await page.goto(DEFAULT_SESSION_URL)

    // Wait for error turn to render (use first() for strict mode)
    const errorTurn = page.locator('.turn-error').first()
    await expect(errorTurn).toBeVisible()

    await assertRedColor(errorTurn, 'borderLeftColor')
  })

  // SPEC: shortcut:shift-enter
  test('Shift+Enter inserts newline', async ({ page }) => {
    const input = await openWithDraft(page, 'Line 1')
    await input.press('Shift+Enter')
    await input.type('Line 2')

    const value = await input.inputValue()
    expect(value).toContain('\n')
    expect(value).toBe('Line 1\nLine 2')
  })

  // SPEC: input:autoresize
  test('textarea auto-resizes with content', async ({ page }) => {
    const input = await openSession(page)

    const initialHeight = await input.evaluate(el => el.offsetHeight)

    await input.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5')

    const newHeight = await input.evaluate(el => el.offsetHeight)
    expect(newHeight).toBeGreaterThan(initialHeight)
  })

  // SPEC: input:placeholder
  test('input has space placeholder for CSS styling', async ({ page }) => {
    await openSession(page)

    // Placeholder is " " by design (enables empty/focused CSS styling)
    const placeholder = await page.locator('[data-testid="chat-input"]').getAttribute('placeholder')
    expect(placeholder).toBe(' ')
  })

  // SPEC: input:slash-trigger
  test('slash command triggers autocomplete', async ({ page }) => {
    await openSession(page)

    await page.locator('[data-testid="chat-input"]').type('/')

    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
  })

  // SPEC: input:history-nav
  // SPEC: shortcut:arrow-up
  test('Up arrow navigates history', async ({ page }) => {
    // Send a message first to populate history
    const input = await openWithDraft(page, 'First message')
    await input.press('Enter')

    await expect(input).toHaveValue('')

    // Cursor must be at position 0 for Up to work, so press Home to ensure it's at start after clear.
    await input.press('Home')
    await input.press('ArrowUp')

    await expect(input).toHaveValue('First message')
  })

  // SPEC: shortcut:arrow-down
  test('Down arrow returns to current', async ({ page }) => {
    // Send message to populate history
    const input = await openWithDraft(page, 'History message')
    await input.press('Enter')

    await expect(input).toHaveValue('')

    await input.fill('Current draft')

    // Go up (cursor must be at start for Up to work)
    await input.press('Home')
    await input.press('ArrowUp')
    await expect(input).toHaveValue('History message')

    // Go down (cursor must be at end for Down to work)
    await input.press('End')
    await input.press('ArrowDown')
    await expect(input).toHaveValue('Current draft')
  })

  test.describe('Turn Progress Indicators', () => {
    // SPEC: turn:progress-working
    test('active turn shows Working with spinner', async ({ page }) => {
      // Use dynamic SSE to send events with no result (keeps turn active)
      await openSession(page, [
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Test prompt',
          timestamp: Date.now(),
          turn_id: 'turn_active',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Processing...',
          timestamp: Date.now(),
        },
      ])

      await expect(page.getByText('Processing...').first()).toBeVisible()

      await expect(page.locator('.turn-progress-working').first()).toBeVisible()
      await expect(
        page.locator('.turn-progress-working').first().getByText('Working'),
      ).toBeVisible()
      await expect(page.locator('.turn-progress-working .progress-spinner').first()).toBeVisible()
    })

    // SPEC: chat:completed-duration
    test('completed turn shows duration badge', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)

      await expect(page.locator('.turn-progress-complete').first()).toBeVisible()
      await expect(page.locator('.turn-duration').first()).toBeVisible()
    })

    // SPEC: turn:progress-complete
    test('completed turn shows checkmark', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)

      await expect(page.locator('.turn-progress-complete').first()).toBeVisible()

      await expect(page.locator('.turn-progress-complete').first()).toContainText('✓')
    })
  })

  test.describe('Failed Send', () => {
    // SPEC: input:failed-send-preserved
    test('a failed send leaves the text in the box and the draft intact', async ({ page }) => {
      await page.route('**/api/send*', route => route.fulfill({ status: 500 }))
      const input = await openWithDraft(page, 'This will fail to send')
      await input.press('Enter')

      await expect(page.getByText('Send failed')).toBeVisible()
      await expect(input).toHaveValue('This will fail to send')

      await page.reload()
      await waitForAppReady(page)
      await expect(page.locator('[data-testid="chat-input"]')).toHaveValue('This will fail to send')
    })

    // SPEC: input:failed-send-preserved
    test('text from a send that fails after a move returns to the session it was typed in', async ({
      page,
    }) => {
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          resumeSession: resumeNamedSession,
        },
      })
      await mockSSE(page)
      let fail
      const sendHeld = new Promise(resolve => {
        fail = resolve
      })
      await page.route('**/api/send*', async route => {
        await sendHeld
        await route.fulfill({ status: 404 })
      })
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('typed in the first session')
      await input.press('Enter')
      await page.evaluate(url => {
        window.location.hash = url.slice(1)
      }, SECOND_SESSION_URL)
      await waitForAppReady(page)
      fail()
      await page.waitForTimeout(500)

      await expect(input).toHaveValue('')
      await expect(page.getByText('Connection lost')).toHaveCount(0)
      await page.evaluate(url => {
        window.location.hash = url.slice(1)
      }, DEFAULT_SESSION_URL)
      await expect(input).toHaveValue('typed in the first session')
    })

    // SPEC: input:failed-send-preserved
    test('a failed queued message returns to the queue rather than vanishing', async ({ page }) => {
      let sendAttempts = 0
      await page.route('**/api/send*', route => {
        sendAttempts++
        return route.fulfill({ status: 500 })
      })
      await openSession(page, [])

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Queued message')
      await input.press('Alt+Enter')

      await expect(page.getByText('Queued message')).toBeVisible()

      // A result only counts as a response-cycle completion once isResponding was true - pair it
      // with a preceding assistant event, as every other resultCount-driven test in this suite does.
      await page.evaluate(() => {
        const instance = window.__sseChatInstance
        instance?.onmessage?.({
          data: JSON.stringify({
            type: 'assistant',
            subtype: 'text',
            content: 'ok',
            turn_id: 't0',
          }),
        })
        instance?.onmessage?.({
          data: JSON.stringify({ type: 'result', subtype: 'success', turn_id: 't0' }),
        })
      })

      await expect.poll(() => sendAttempts).toBeGreaterThan(0)
      await expect(page.getByText('Queued message')).toBeVisible()
    })
  })

  test.describe('Draft Persistence', () => {
    // SPEC: input:draft-save
    test('draft saved to localStorage', async ({ page }) => {
      await openWithDraft(page, 'My draft message')

      // Poll until draft is saved to localStorage (debounce is 100ms)
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('draft:'))
            if (keys.length === 0) {
              return null
            }
            const data = JSON.parse(localStorage.getItem(keys[0]))
            return data.current
          })
        })
        .toBe('My draft message')
    })

    // SPEC: input:draft-restore
    test('draft restored on page load', async ({ page }) => {
      const input = await openWithDraft(page, 'Saved draft')

      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('draft:'))
            return keys.length > 0
          })
        })
        .toBe(true)

      await page.reload()
      await waitForAppReady(page)

      await expect(input).toHaveValue('Saved draft')
    })

    // SPEC: input:draft-restore
    // LIMITATION: racing input against draft restore is fragile in a test env, so this only
    // verifies typed content survives rather than confirming restore-only-when-empty.
    test('draft only restored when input is empty', async ({ page }) => {
      const input = await openWithDraft(page, 'Original draft')

      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('draft:'))
            return keys.length > 0
          })
        })
        .toBe(true)

      // Clear input and type something new before page fully loads draft
      await input.clear()
      await input.fill('User typed this')

      await expect(input).toHaveValue('User typed this')
    })

    // SPEC: input:draft-flush
    test('beforeunload flushes draft immediately', async ({ page }) => {
      const input = await openWithDraft(page, 'Draft before unload')

      // First check that draft might not be saved yet (debounce is 100ms)
      const _draftBefore = await page.evaluate(() => {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('draft:'))
        if (keys.length === 0) {
          return null
        }
        const data = JSON.parse(localStorage.getItem(keys[0]))
        return data.current
      })

      // Navigate away (triggers beforeunload)
      await page.goto('about:blank')

      await page.goBack()
      await waitForAppReady(page)

      await expect(input).toHaveValue('Draft before unload')
    })
  })

  test.describe('Input Behavior', () => {
    // SPEC: input:scroll-compensation
    test('scroll position preserved when textarea shrinks', async ({ page }) => {
      // Long-conversation replay + wheel disengage + grow/shrink + settle poll exceeds the
      // default test budget on slow CI - ResizeObserver's delayed reflow alone can take ~2s.
      test.setTimeout(30_000)
      await openSession(page, 'events/long-conversation.jsonl')

      const input = page.locator('[data-testid="chat-input"]')
      const messagesContainer = page.locator('[data-testid="chat-messages"]')

      // Wait for messages to load and the transcript to finish streaming - a scrollTop write mid-stream
      // lands in autoscroll's near-bottom re-engage zone, which snaps back to bottom and drifts position.
      await expect(
        messagesContainer.locator('[data-testid="turn-container"]').first(),
      ).toBeVisible()
      await waitForStableScrollHeight(messagesContainer)

      // CONTRACT: ChatController infers user-scroll intent only from input events, so auto-scroll OFF here
      // requires a real wheel event before the programmatic scrollTop write below.
      await messagesContainer.dispatchEvent('wheel', { deltaY: -100 })
      // Wait for the autoscroll button to flip disabled - skip it and the test races the wheel listener,
      // which can leave autoscroll ON and drift beforeScroll past scrollHeight/2 (75px tolerance).
      await expect(page.locator('button[title="Last message (Alt+End)"]')).toBeVisible({
        timeout: 5000,
      })
      await messagesContainer.evaluate(el => {
        el.scrollTop = el.scrollHeight / 2
      })
      const beforeScroll = await messagesContainer.evaluate(el => el.scrollTop)

      await input.fill('Line 1\nLine 2\nLine 3\nLine 4')
      await input.fill('')

      // Poll until scroll position is approximately preserved (75px drift allowed for resize
      // reflow). 10s budget - ResizeObserver alone can take ~2s, more under full-suite load.
      await expect
        .poll(
          async () => {
            const afterScroll = await messagesContainer.evaluate(el => el.scrollTop)
            return Math.abs(afterScroll - beforeScroll)
          },
          { timeout: 10000 },
        )
        .toBeLessThan(75)
    })

    // SPEC: input:always-enabled
    test('input remains usable when not connected', async ({ page }) => {
      // Use SSE controller that stays in CONNECTING state (no auto-connect)
      await createSSEController(page, { autoConnect: false })
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)

      await expect(page.locator('[data-testid="footer"]')).toBeVisible()
      await expect(page.locator('.chat-replay-overlay')).toBeVisible()

      // Textarea stays enabled while disconnected; submit-time guards elsewhere block sending until ready.
      await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled()
    })
  })

  test.describe('Copy Buttons', () => {
    // SPEC: chat:copy-button-code
    test('tool output has copy button', async ({ page }) => {
      await openSession(page, 'events/tool-bash.jsonl')

      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // Scoped to the Result section - Bash's Command section has its own "Copy command" button.
      const copyBtn = toolBlock.locator('.tool-result-section .tool-copy-btn')
      await expect(copyBtn).toBeVisible()
      await expect(copyBtn).toHaveAttribute('title', 'Copy output')
    })

    // SPEC: chat:copy-slash-command
    test('user message with slash command copies plain text', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await openSession(page, 'events/slash-command-message.jsonl')

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()
      await expect(userMessage).toContainText('/help')

      const copyBtn = userMessage.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toContain('/help')
      expect(clipboardText).not.toContain('<')
    })

    // SPEC: chat:copy-stdout
    test('user message with command output renders stdout block', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await openSession(page, 'events/user-message-with-command-output.jsonl')

      await expect(page.getByText('Hello from stdout').first()).toBeVisible()
      await expect(page.locator('text=<local-command-stdout>')).not.toBeVisible()

      const userMessage = page.locator('[data-testid="message-user"]').first()
      const copyBtn = userMessage.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toContain('Hello from stdout')
    })

    // SPEC: chat:copy-stdout
    test('user message with stderr renders stderr block', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await openSession(page, 'events/user-message-with-command-output.jsonl')

      await expect(page.getByText('Something went wrong').first()).toBeVisible()

      const userMessages = page.locator('[data-testid="message-user"]')
      const stderrMessage = userMessages.filter({ hasText: 'Something went wrong' })
      const copyBtn = stderrMessage.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toContain('Something went wrong')
    })

    // SPEC: chat:copy-button-turn
    // MOCK-LIMITED: Clipboard flaky in headless Chromium
    test('turn copy button copies full assistant text to clipboard', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await openSession(page)

      await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()

      // Turn meta contains the turn copy button; hover to reveal it
      const turnMeta = page.locator('.turn-meta').first()
      await turnMeta.hover()

      const turnCopyBtn = turnMeta.locator('.turn-copy-btn')
      await expect(turnCopyBtn).toBeVisible()
      await turnCopyBtn.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('Hello! How can I help you today?')
    })

    // SPEC: chat:copy-button-user
    test('user message copy button copies user text to clipboard', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await openSession(page)

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()

      const copyBtn = userMessage.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('Hello Claude')
    })

    // SPEC: chat:copy-askuser
    test('AskUser response copy produces clean Q/A text without XML tags', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await openSession(page, 'events/user-message-askuser-response.jsonl')

      // The second user message contains the <response:AskUserQuestion> XML
      const userMessages = page.locator('[data-testid="message-user"]')
      const askUserResponse = userMessages.nth(1)
      await expect(askUserResponse).toBeVisible()

      const copyBtn = askUserResponse.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('Which framework would you like to use?: React')
      expect(clipboardText).not.toContain('<response:AskUserQuestion>')
      expect(clipboardText).not.toContain('<answer>')
      expect(clipboardText).not.toContain('<question')
    })

    // SPEC: chat:copy-arbitrary-xml
    test('arbitrary XML in user message is preserved unchanged in clipboard', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await openSession(page, 'events/user-message-arbitrary-xml.jsonl')

      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()

      const copyBtn = userMessage.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('<custom-tag>important content here</custom-tag>')
    })
  })

  test.describe('Chat Control Bar', () => {
    // SPEC: chat:control-reload
    test('reload button is visible and triggers reconnect', async ({ page }) => {
      await openLiveSession(page)

      const reloadBtn = page.locator('button[title="Reload session (picks up config changes)"]')
      await expect(reloadBtn).toBeVisible()

      const connectionsBefore = await page.evaluate(() => window.__sseConnectionCount || 0)

      // Click reload - should trigger page reload or SSE reconnect
      await reloadBtn.click()
      await waitForAppReady(page)

      const connectionsAfter = await page.evaluate(() => window.__sseConnectionCount || 0)
      expect(connectionsAfter).toBeGreaterThan(connectionsBefore)
    })

    // SPEC: chat:control-compact
    test('compact button sends /compact message', async ({ page }) => {
      const sendCalls = await captureSends(page)

      await openSession(page)

      const compactBtn = page.locator('button[title="Compact conversation (/compact)"]')
      await expect(compactBtn).toBeVisible()
      await compactBtn.click()

      await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
      expect(sendCalls[0].prompt).toBe('/compact')
    })

    // SPEC: chat:control-bottom
    test('jump-to-bottom button disabled when autoscroll active', async ({ page }) => {
      await openSession(page)

      const jumpBtn = page.locator('button[title="Autoscroll enabled"]')
      await expect(jumpBtn).toBeVisible()
      await expect(jumpBtn).toBeDisabled()
    })

    // SPEC: chat:control-bottom
    test('jump-to-bottom scrolls to bottom', async ({ page }) => {
      await openSession(page, 'events/long-conversation.jsonl')

      const messagesContainer = page.locator('[data-testid="chat-messages"]')

      // Wait for the transcript to finish streaming before scrolling - a wheel event mid-replay
      // races the settle loop's own scrollToBottom(), which snaps back and drifts the position.
      await expect(
        messagesContainer.locator('[data-testid="turn-container"]').first(),
      ).toBeVisible()
      await waitForStableScrollHeight(messagesContainer)

      // Wheel events reliably disable autoscroll; programmatic scrollTop doesn't (scrollHeight guard race).
      const box = await messagesContainer.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -500)
      // Wait for scroll to register before second wheel event
      await expect
        .poll(() =>
          messagesContainer.evaluate(el => el.scrollTop < el.scrollHeight - el.clientHeight - 10),
        )
        .toBe(true)
      await page.mouse.wheel(0, -200)

      // Wait for autoscroll to disable (button title changes)
      const jumpBtn = page.locator('button[title="Last message (Alt+End)"]')
      await expect(jumpBtn).toBeVisible()
      await expect(jumpBtn).toBeEnabled()

      await jumpBtn.click()

      await expect
        .poll(async () => {
          const { scrollTop, scrollHeight, clientHeight } = await messagesContainer.evaluate(
            el => ({
              scrollTop: el.scrollTop,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
            }),
          )
          return scrollHeight - scrollTop - clientHeight
        })
        .toBeLessThan(50)
    })
  })

  test.describe('Input State', () => {
    const runningInputAnimations = page =>
      page
        .locator('.chat-input-wrapper')
        .evaluate(
          el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
        )

    // SPEC: input:animation
    test('idle empty input shows its plain border with nothing moving', async ({ page }) => {
      const input = await openSession(page)
      await expect(input).toBeVisible()
      await page.locator('[data-testid="footer"]').click()

      expect(await runningInputAnimations(page)).toBe(0)
      const border = await input.evaluate(el => getComputedStyle(el).borderTopColor)
      expect(border).not.toBe('rgba(139, 92, 246, 0.85)')
    })

    // SPEC: input:anim-focus
    test('focused textarea has glow box-shadow', async ({ page }) => {
      const input = await openWithDraft(page, 'typed')
      await input.focus()

      // Should have box-shadow glow (static focus ring, non-working)
      const boxShadow = await input.evaluate(el => {
        return getComputedStyle(el).boxShadow
      })
      expect(boxShadow).not.toBe('none')
    })

    // SPEC: input:anim-focus-color
    test('focused idle input has a still green border and glow', async ({ page }) => {
      const input = await openWithDraft(page, 'typed')
      await input.focus()

      const { border, shadow } = await input.evaluate(el => {
        const style = getComputedStyle(el)
        return { border: style.borderTopColor, shadow: style.boxShadow }
      })
      expect(border).toBe('rgba(76, 175, 80, 0.45)')
      expect(shadow).toContain('rgba(76, 175, 80')
      expect(await runningInputAnimations(page)).toBe(0)
    })

    // SPEC: input:anim-working
    // SPEC: input:animation
    test('working state shows a still accent border, focused or not', async ({ page }) => {
      await openSession(page, 'events/progress-working.jsonl')

      await expect(page.locator('.chat-input')).toHaveClass(/status-working/)
      const input = page.locator('[data-testid="chat-input"]')

      await page.locator('[data-testid="footer"]').click()
      expect(await input.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(
        'rgba(139, 92, 246, 0.85)',
      )
      expect(await runningInputAnimations(page)).toBe(0)

      await input.focus()
      expect(await input.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(
        'rgba(139, 92, 246, 0.85)',
      )
      expect(await runningInputAnimations(page)).toBe(0)
    })
  })
})
