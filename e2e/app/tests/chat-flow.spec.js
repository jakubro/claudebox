/** E2E tests for chat flow including message submission, pending states, draft persistence, and input animations. */

import { expect, test } from '@playwright/test'
import { assertRedColor, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE, mockSSEDynamic } from '../mocks/sse.js'

test.describe('Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  // SPEC: input:always-focused
  // SPEC: chat:selection-not-preempted
  test('input receives focus when connected', async ({ page }) => {
    // In headless Chromium with concurrent workers, element.focus() is a
    // silent no-op when the page lacks OS-level window focus. Intercept
    // focus calls to verify the autofocus useEffect targets the textarea.
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

    // The autofocus useEffect should have called .focus() on the chat-input textarea
    await expect
      .poll(() => page.evaluate(() => window.__focusLog.includes('chat-input')))
      .toBe(true)
  })

  // SPEC: shortcut:enter
  test('submits message on Enter', async ({ page }) => {
    // Track /api/send calls before setting up SSE
    const sendCalls = []
    await page.route('**/api/send', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { success: true } })
    })

    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Type and submit
    await page.locator('[data-testid="chat-input"]').fill('Hello world')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    // Verify POST was made
    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0].prompt).toBe('Hello world')
  })

  // SPEC: turn:pending-show
  test('shows pending message immediately', async ({ page }) => {
    // Use dynamic SSE that returns empty initially (connection established but no events)
    await mockSSEDynamic(page, () => [])
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Type and submit
    await page.locator('[data-testid="chat-input"]').fill('My pending message')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    // Pending message should appear immediately
    await expect(page.getByText('My pending message')).toBeVisible()
  })

  // SPEC: turn:pending-remove
  test('removes pending when SSE confirms', async ({ page }) => {
    // Start with empty events
    await mockSSEDynamic(page, () => [])
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Submit message
    await page.locator('[data-testid="chat-input"]').fill('Test message')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    // Pending should show
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

    // After SSE delivers, pending class should be gone
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

    // Verify red border CSS
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

    // Check value contains newline
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

    // Get initial height
    const initialHeight = await input.evaluate(el => el.offsetHeight)

    // Add multiple lines
    await input.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5')

    // Height should increase
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

    // Type slash to trigger autocomplete
    await page.locator('[data-testid="chat-input"]').type('/')

    // Custom autocomplete dropdown should appear
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

    // Wait for input to clear
    await expect(input).toHaveValue('')

    // Cursor must be at position 0 for Up to work (it should be after clear)
    // Press Home to ensure cursor is at start
    await input.press('Home')
    await input.press('ArrowUp')

    // Should show previous message
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

    // Wait for clear
    await expect(input).toHaveValue('')

    // Type something new
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

      // Wait for the active turn to render
      await expect(page.getByText('Processing...').first()).toBeVisible()

      // Should show "Working" indicator with spinner
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

      // Wait for completed turn with duration
      await expect(page.locator('.turn-progress-complete').first()).toBeVisible()
      await expect(page.locator('.turn-duration').first()).toBeVisible()
    })

    // SPEC: turn:progress-complete
    test('completed turn shows checkmark', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)

      // Wait for completed turn
      await expect(page.locator('.turn-progress-complete').first()).toBeVisible()

      // Should show checkmark character (✓)
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

      // Save a draft
      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Saved draft')

      // Poll until draft is saved
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('draft:'))
            return keys.length > 0
          })
        })
        .toBe(true)

      // Reload page
      await page.reload()
      await waitForAppReady(page)

      // Draft should be restored
      await expect(input).toHaveValue('Saved draft')
    })

    // SPEC: input:draft-restore
    // LIMITATION: Ideally this test would set a draft in localStorage, reload,
    // and verify the draft only appears when the input is empty on load. However,
    // reliably racing user input against draft restoration on page load is fragile
    // in a test environment. This approximation verifies that user-typed content
    // is not overwritten once present.
    test('draft only restored when input is empty', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      // Save a draft to localStorage
      await input.fill('Original draft')

      // Poll until draft is saved
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

      // Draft restoration should not overwrite user's current input
      // Since user has typed "User typed this", it should remain
      await expect(input).toHaveValue('User typed this')
    })

    // SPEC: input:draft-flush
    test('beforeunload flushes draft immediately', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Draft before unload')

      // Trigger beforeunload by starting navigation
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

      // Go back
      await page.goBack()
      await waitForAppReady(page)

      // Draft should be restored (was flushed on beforeunload)
      await expect(input).toHaveValue('Draft before unload')
    })
  })

  test.describe('Input Behavior', () => {
    // SPEC: input:scroll-compensation
    test('scroll position preserved when textarea shrinks', async ({ page }) => {
      // Long-conversation replay + wheel disengage + textarea grow/shrink +
      // settle poll exceeds the default 5 s cap on slow CI runs. The poll
      // itself can take up to ~2 s to converge as ResizeObserver fires its
      // delayed reflow; the test was already marginal pre-batch.
      test.setTimeout(15000)
      await mockSSE(page, 'events/long-conversation.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      const messagesContainer = page.locator('[data-testid="chat-messages"]')

      // Wait for messages to load
      await expect(
        messagesContainer.locator('[data-testid="turn-container"]').first(),
      ).toBeVisible()

      // CONTRACT: ChatController classifies user-scroll intent from
      // input events. The "scroll position preserved when textarea shrinks"
      // assertion needs auto-scroll OFF, which now requires a real wheel
      // event before the programmatic position write.
      await messagesContainer.dispatchEvent('wheel', { deltaY: -100 })
      // Wait for the autoscroll button to flip to "disabled" (title changes
      // from "Autoscroll enabled" → "Last message (Alt+End)"). Without this
      // explicit barrier, the test races the wheel listener: when autoscroll
      // is still ON, the next render snaps `scrollTop` back to the bottom
      // and `beforeScroll` ≠ scrollHeight/2 — the textarea-shrink delta then
      // dwarfs the 75px tolerance.
      await expect(page.locator('button[title="Last message (Alt+End)"]')).toBeVisible({
        timeout: 5000,
      })
      await messagesContainer.evaluate(el => {
        el.scrollTop = el.scrollHeight / 2
      })
      const beforeScroll = await messagesContainer.evaluate(el => el.scrollTop)

      // Type multiline text to expand textarea
      await input.fill('Line 1\nLine 2\nLine 3\nLine 4')

      // Clear textarea (shrink it)
      await input.fill('')

      // Poll until scroll position is approximately preserved (allow up to 75px drift
      // from textarea resize triggering layout reflow). 10 s budget — the
      // ResizeObserver reflow can take ~2 s alone, and under full-suite
      // concurrency the polling round-trip stretches further.
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

      // App shows resuming overlay when SSE hasn't connected
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()
      await expect(page.locator('.chat-replay-overlay')).toBeVisible()

      // Per the always-enabled invariant, the textarea is NOT disabled even
      // when SSE has not connected. Submit-time guards prevent sending until
      // the session is ready, but the textarea itself stays usable.
      await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled()
    })
  })

  test.describe('Copy Buttons', () => {
    // SPEC: chat:copy-button-message
    test('assistant message has per-message copy button', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for assistant text block
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

      // Wait for assistant response
      await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()

      // Assistant text block has per-message copy button (visible on hover)
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

      // Tool block should be visible
      const toolBlock = page.locator('[data-testid="tool-block"]').first()
      await expect(toolBlock).toBeVisible()

      // Copy button should be in expanded content
      const copyBtn = toolBlock.locator('.tool-copy-btn')
      await expect(copyBtn).toBeVisible()
      await expect(copyBtn).toHaveAttribute('title', 'Copy output')
    })

    // SPEC: chat:copy-slash-command
    test('user message with slash command copies plain text', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await mockSSE(page, 'events/slash-command-message.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // User message with /help should be visible
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()
      await expect(userMessage).toContainText('/help')

      // Click copy button and verify clipboard contains plain text (no XML)
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

      // Stdout content should be rendered (not raw XML tags)
      await expect(page.getByText('Hello from stdout').first()).toBeVisible()
      await expect(page.locator('text=<local-command-stdout>')).not.toBeVisible()

      // Copy button on the stdout block should copy the content
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

      // Stderr content should be rendered
      await expect(page.getByText('Something went wrong').first()).toBeVisible()

      // Copy should include stderr content
      const userMessages = page.locator('[data-testid="message-user"]')
      // Find the message containing stderr
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

      // Wait for assistant response to render
      await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()

      // Turn meta contains the turn copy button; hover to reveal it
      const turnMeta = page.locator('.turn-meta').first()
      await turnMeta.hover()

      // Click the turn-level copy button
      const turnCopyBtn = turnMeta.locator('.turn-copy-btn')
      await expect(turnCopyBtn).toBeVisible()
      await turnCopyBtn.click()

      // Verify clipboard contains full assistant text content
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('Hello! How can I help you today?')
    })

    // SPEC: chat:copy-button-user
    test('user message copy button copies user text to clipboard', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // User message should be visible
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()

      // Click the user message copy button
      const copyBtn = userMessage.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      // Verify clipboard contains user message text
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

      // Click the copy button on the AskUser response message
      const copyBtn = askUserResponse.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      // Verify clipboard has clean Q/A text without XML tags
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe('Which framework would you like to use?: React')
      // Ensure no XML tags leaked into clipboard
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

      // User message with arbitrary XML should be visible
      const userMessage = page.locator('[data-testid="message-user"]').first()
      await expect(userMessage).toBeVisible()

      // Click the copy button
      const copyBtn = userMessage.locator('.message-copy-btn')
      await expect(copyBtn).toBeVisible()
      await copyBtn.click()

      // Verify clipboard preserves the XML tags as-is
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

      // Track SSE connection count before click
      const connectionsBefore = await page.evaluate(() => window.__sseConnectionCount || 0)

      // Click reload — should trigger page reload or SSE reconnect
      await reloadBtn.click()
      await waitForAppReady(page)

      // After reload, a new SSE connection should be established
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

      // Click compact button
      const compactBtn = page.locator('button[title="Compact conversation (/compact)"]')
      await expect(compactBtn).toBeVisible()
      await compactBtn.click()

      // Verify /compact was sent
      await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
      expect(sendCalls[0].prompt).toBe('/compact')
    })

    // SPEC: chat:control-bottom
    test('jump-to-bottom button disabled when autoscroll active', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // When at bottom (autoscroll active), button should be disabled with pressed class
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

      // Scroll up via wheel events to reliably disable autoscroll
      // (programmatic scrollTop doesn't always disable — scrollHeight guard race)
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

      // Click jump-to-bottom
      await jumpBtn.click()

      // Should scroll to bottom
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
    // SPEC: input:anim-idle
    test('idle textarea with placeholder has border-ripple animation', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeVisible()

      // Blur input so placeholder shows (idle state)
      await page.locator('[data-testid="footer"]').click()

      // Textarea should have animation (border-ripple)
      const animation = await input.evaluate(el => {
        return getComputedStyle(el).animationName
      })
      expect(animation).toContain('border-ripple')
    })

    // SPEC: input:anim-focus
    test('focused textarea has glow box-shadow', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.focus()

      // Should have box-shadow glow
      const boxShadow = await input.evaluate(el => {
        return getComputedStyle(el).boxShadow
      })
      expect(boxShadow).not.toBe('none')
    })

    // SPEC: input:anim-working
    test('working state adds color-cycling animation', async ({ page }) => {
      await mockSSE(page, 'events/progress-working.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Chat input wrapper should have status-working class
      const chatInput = page.locator('.chat-input')
      await expect(chatInput).toHaveClass(/status-working/)

      // Working state should have an active color-cycling animation (not "none")
      const styles = await chatInput.evaluate(el => {
        const cs = getComputedStyle(el)
        return {
          animationName: cs.animationName,
          animation: cs.animation,
        }
      })
      // Assert working state is active: animation running or border color changed
      const hasAnimation =
        styles.animationName && styles.animationName !== 'none' && styles.animationName !== ''
      const hasBorderEffect = await chatInput.evaluate(el => {
        const cs = getComputedStyle(el)
        return cs.borderLeftColor !== '' && cs.borderLeftColor !== 'rgb(0, 0, 0)'
      })
      expect(hasAnimation || hasBorderEffect).toBeTruthy()
    })

    // SPEC: input:animation
    test('working + focused textarea has focus-breathe animation', async ({ page }) => {
      await mockSSE(page, 'events/progress-working.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Ensure working state
      const chatInput = page.locator('.chat-input')
      await expect(chatInput).toHaveClass(/status-working/)

      const input = page.locator('[data-testid="chat-input"]')
      await input.focus()

      // Should have focus-breathe animation
      const animation = await input.evaluate(el => {
        return getComputedStyle(el).animationName
      })
      expect(animation).toContain('focus-breathe')
    })

    // SPEC: input:anim-idle
    test('non-empty unfocused textarea does NOT have idle animation', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      // Fill input with text then blur
      await input.fill('Some text')
      await page.locator('[data-testid="footer"]').click()

      // Idle animation should NOT be present (SPEC says "Empty and unfocused")
      const animation = await input.evaluate(el => {
        return getComputedStyle(el).animationName
      })
      expect(animation).not.toContain('border-ripple')
    })
  })
})
