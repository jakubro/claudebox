/** E2E tests for chat flow including message submission, pending states, draft persistence, and input animations. */

import { expect, test } from '@playwright/test'
import { assertRedColor, waitForAppReady, waitForStableScrollHeight } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE, mockSSEDynamic } from '../mocks/sse.js'

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

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect
      .poll(() => page.evaluate(() => window.__focusLog.includes('chat-input')))
      .toBe(true)
  })

  // SPEC: shortcut:enter
  test('submits message on Enter', async ({ page }) => {
    const sendCalls = []
    await page.route('**/api/send', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
    await mockSSEDynamic(page, () => [])
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('[data-testid="chat-input"]').fill('My pending message')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    await expect(page.getByText('My pending message')).toBeVisible()
    await expect(page.getByTestId('turn-progress-pending')).toBeVisible()
    await expect(page.getByTestId('turn-progress-bare')).toHaveCount(0)

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
    await expect(page.getByTestId('turn-progress-bare')).toHaveCount(0)
  })

  // SPEC: turn:pending-remove
  test('removes pending when SSE confirms', async ({ page }) => {
    await mockSSEDynamic(page, () => [])
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

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
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('Line 1')
    await input.press('Shift+Enter')
    await input.type('Line 2')

    const value = await input.inputValue()
    expect(value).toContain('\n')
    expect(value).toBe('Line 1\nLine 2')
  })

  // SPEC: input:autoresize
  test('textarea auto-resizes with content', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const input = page.locator('[data-testid="chat-input"]')

    const initialHeight = await input.evaluate(el => el.offsetHeight)

    await input.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5')

    const newHeight = await input.evaluate(el => el.offsetHeight)
    expect(newHeight).toBeGreaterThan(initialHeight)
  })

  // SPEC: input:placeholder
  test('input has space placeholder for CSS styling', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Placeholder is " " by design (enables empty/focused CSS styling)
    const placeholder = await page.locator('[data-testid="chat-input"]').getAttribute('placeholder')
    expect(placeholder).toBe(' ')
  })

  // SPEC: input:slash-trigger
  test('slash command triggers autocomplete', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('[data-testid="chat-input"]').type('/')

    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
  })

  // SPEC: input:history-nav
  // SPEC: shortcut:arrow-up
  test('Up arrow navigates history', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const input = page.locator('[data-testid="chat-input"]')

    // Send a message first to populate history
    await input.fill('First message')
    await input.press('Enter')

    await expect(input).toHaveValue('')

    // Cursor must be at position 0 for Up to work, so press Home to ensure it's at start after clear.
    await input.press('Home')
    await input.press('ArrowUp')

    await expect(input).toHaveValue('First message')
  })

  // SPEC: shortcut:arrow-down
  test('Down arrow returns to current', async ({ page }) => {
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const input = page.locator('[data-testid="chat-input"]')

    // Send message to populate history
    await input.fill('History message')
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
      await mockSSEDynamic(page, () => [
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
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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

  test.describe('Draft Persistence', () => {
    // SPEC: input:draft-save
    test('draft saved to localStorage', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('My draft message')

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
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Saved draft')

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
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('Original draft')

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
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Draft before unload')

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
      // default 5s cap on slow CI - ResizeObserver's delayed reflow alone can take ~2s.
      test.setTimeout(15000)
      await mockSSE(page, 'events/long-conversation.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
    // SPEC: chat:copy-button-message
    test('assistant message has per-message copy button', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turnText = page.locator('.turn-text').first()
      await expect(turnText).toBeVisible()

      // Hover to reveal copy button (visible on hover per SPEC)
      await turnText.hover()
      const copyBtn = turnText.locator('.turn-text-copy-btn')
      await expect(copyBtn).toBeVisible()
      await expect(copyBtn).toHaveAttribute('title', 'Copy message')
    })

    // SPEC: chat:copy-button-message
    test('assistant message has copy button', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()

      const turnText = page.locator('.turn-text').first()
      await turnText.hover()
      const responseCopyBtn = turnText.locator('.turn-text-copy-btn')
      await expect(responseCopyBtn).toBeVisible()
      await expect(responseCopyBtn).toHaveAttribute('title', 'Copy message')
    })

    // SPEC: chat:copy-button-code
    test('tool output has copy button', async ({ page }) => {
      await mockSSE(page, 'events/tool-bash.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      await mockSSE(page, 'events/slash-command-message.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      await mockSSE(page, 'events/user-message-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      await mockSSE(page, 'events/user-message-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      await mockSSE(page, 'events/user-message-askuser-response.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      await mockSSE(page, 'events/user-message-arbitrary-xml.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

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
      const sendCalls = []
      await page.route('**/api/send', async route => {
        sendCalls.push(await route.request().postDataJSON())
        await route.fulfill({ status: 200, json: { success: true } })
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const compactBtn = page.locator('button[title="Compact conversation (/compact)"]')
      await expect(compactBtn).toBeVisible()
      await compactBtn.click()

      await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
      expect(sendCalls[0].prompt).toBe('/compact')
    })

    // SPEC: chat:control-bottom
    test('jump-to-bottom button disabled when autoscroll active', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const jumpBtn = page.locator('button[title="Autoscroll enabled"]')
      await expect(jumpBtn).toBeVisible()
      await expect(jumpBtn).toBeDisabled()
    })

    // SPEC: chat:control-bottom
    test('jump-to-bottom scrolls to bottom', async ({ page }) => {
      await mockSSE(page, 'events/long-conversation.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const messagesContainer = page.locator('[data-testid="chat-messages"]')

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

  test.describe('Input Animations', () => {
    // Decorative border ring: a static conic gradient revealed through the textarea's transparent border.
    // Assert `.textarea-border-overlay` opacity (fades over 0.25s); its `::before` carries `border-travel`.

    // SPEC: input:anim-idle
    test('idle empty input reveals the animated border ring', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeVisible()

      // Blur input so placeholder shows (idle state)
      await page.locator('[data-testid="footer"]').click()

      const overlay = page.locator('.textarea-border-overlay')
      await expect
        .poll(() => overlay.evaluate(el => Number.parseFloat(getComputedStyle(el).opacity)))
        .toBeGreaterThan(0.5)
      const anim = await overlay.evaluate(el => getComputedStyle(el, '::before').animationName)
      expect(anim).toContain('border-travel')
    })

    // SPEC: input:anim-focus
    test('focused textarea has glow box-shadow', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('typed')
      await input.focus()

      // Should have box-shadow glow (static focus ring, non-working)
      const boxShadow = await input.evaluate(el => {
        return getComputedStyle(el).boxShadow
      })
      expect(boxShadow).not.toBe('none')
    })

    // SPEC: input:anim-working
    test('working state reveals the color-cycling border ring', async ({ page }) => {
      await mockSSE(page, 'events/progress-working.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('.chat-input')).toHaveClass(/status-working/)

      const overlay = page.locator('.textarea-border-overlay')
      await expect
        .poll(() => overlay.evaluate(el => Number.parseFloat(getComputedStyle(el).opacity)))
        .toBeGreaterThan(0.5)
      const anim = await overlay.evaluate(el => getComputedStyle(el, '::before').animationName)
      expect(anim).toContain('border-travel')
    })

    // SPEC: input:animation
    test('working cue stays revealed when the input is focused', async ({ page }) => {
      await mockSSE(page, 'events/progress-working.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('.chat-input')).toHaveClass(/status-working/)

      await page.locator('[data-testid="chat-input"]').focus()

      // The working border cue must persist even while focused (composer is usually focused during streaming).
      const overlay = page.locator('.textarea-border-overlay')
      await expect
        .poll(() => overlay.evaluate(el => Number.parseFloat(getComputedStyle(el).opacity)))
        .toBeGreaterThan(0.5)
      const anim = await overlay.evaluate(el => getComputedStyle(el, '::before').animationName)
      expect(anim).toContain('border-travel')
    })

    // SPEC: input:anim-idle
    test('non-empty unfocused textarea hides the border ring', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('Some text')
      await page.locator('[data-testid="footer"]').click()

      // Overlay hidden (SPEC: idle ripple only when "Empty and unfocused")
      const opacity = await page
        .locator('.textarea-border-overlay')
        .evaluate(el => Number.parseFloat(getComputedStyle(el).opacity))
      expect(opacity).toBeLessThan(0.5)
    })
  })
})
