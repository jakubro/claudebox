/** E2E tests for keyboard shortcuts including panel toggles, stash actions, and XML block collapse/expand. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Interrupt (Ctrl+.)', () => {
    // SPEC: shortcut:ctrl-dot
    test('Ctrl+. sends interrupt request', async ({ page }) => {
      const interruptCalls = []
      await page.route('**/api/interrupt', async route => {
        interruptCalls.push(await route.request().method())
        await route.fulfill({ status: 200, json: { success: true } })
      })

      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send user + assistant events without result (makes isResponding true)
      await controller.sendEvent({
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Test message',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
        turn_id: 'turn_test',
      })
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'text',
        content: 'Working on it...',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
      })

      // Wait for the assistant message to appear (confirms isResponding)
      await expect(page.getByText('Working on it...')).toBeVisible()

      await page.locator('[data-testid="chat-input"]').focus()
      await page.keyboard.press('Control+.')

      await expect.poll(() => interruptCalls.length).toBeGreaterThan(0)
    })
  })

  test.describe('Stash (Ctrl+S)', () => {
    // SPEC: shortcut:ctrl-s
    test('Ctrl+S stashes current input', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('Text to stash')
      await input.focus()
      await page.keyboard.press('Control+s')

      await expect(input).toHaveValue('')
      await expect(page.getByText('Text to stash')).toBeVisible()
    })

    // SPEC: panel-stash:reject-empty
    test('Ctrl+S with empty input does nothing', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.focus()
      await input.fill('')

      await page.keyboard.press('Control+s')

      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
    })
  })

  test.describe('Stash Pop (Ctrl+Shift+S)', () => {
    // SPEC: shortcut:ctrl-shift-s
    test('Ctrl+Shift+S pops top item from stash', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('Stashed via shortcut')
      await input.focus()
      await page.keyboard.press('Control+s')
      await expect(input).toHaveValue('')
      await expect(page.getByText('Stashed via shortcut')).toBeVisible()

      await input.focus()
      await page.keyboard.press('Control+Shift+S')

      await expect(input).toHaveValue('Stashed via shortcut')
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
    })

    // SPEC: panel-stash:pop-empty
    test('Ctrl+Shift+S with empty stash does nothing', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Current text')
      await input.focus()

      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()

      await page.keyboard.press('Control+Shift+S')

      await expect(input).toHaveValue('Current text')
    })

    // SPEC: panel-stash:remove-button
    test('pop button inserts stash item into input', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('Stashed text')
      await input.focus()
      await page.keyboard.press('Control+s')

      await expect(input).toHaveValue('')
      await expect(page.getByText('Stashed text')).toBeVisible()

      await page.getByTitle('Insert into input and remove').click()

      // Input should have the stashed value (pendingInsert triggers effect)
      await expect(input).toHaveValue('Stashed text')
    })

    // SPEC: panel-stash:pop-empty
    test('pop with empty stash does nothing', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Current text')

      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()

      // No stash to pop, so the input value is untouched.
      await expect(input).toHaveValue('Current text')
    })
  })

  test.describe('Wrap in Tags (Ctrl+,)', () => {
    // SPEC: shortcut:ctrl-comma
    test('Ctrl+, wraps selected text in <this></this> tags', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('wrap this word please')
      await input.focus()

      // Select "this word" (positions 5-14)
      await input.evaluate(el => {
        el.setSelectionRange(5, 14)
      })

      await page.keyboard.press('Control+,')

      await expect(input).toHaveValue('wrap <this>this word</this> please')
    })

    // SPEC: shortcut:ctrl-comma-empty
    test('Ctrl+, with no selection inserts empty tags', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('text')
      await input.focus()

      // Put cursor at position 2 (between 'te' and 'xt')
      await input.evaluate(el => {
        el.setSelectionRange(2, 2)
      })

      await page.keyboard.press('Control+,')

      await expect(input).toHaveValue('te<this></this>xt')
    })

    // SPEC: input:editing-keys-persist
    test('draft shaped with Ctrl+, survives a reload', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('wrap this word please')
      await input.focus()
      await input.evaluate(el => {
        el.setSelectionRange(5, 14)
      })
      await page.keyboard.press('Control+,')
      await expect(input).toHaveValue('wrap <this>this word</this> please')

      // Poll until the wrapped draft lands in localStorage (key: draft:{sessionId}).
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i)
              if (key?.startsWith('draft:')) {
                return JSON.parse(localStorage.getItem(key))?.current ?? null
              }
            }
            return null
          })
        })
        .toBe('wrap <this>this word</this> please')

      await page.reload()
      await waitForAppReady(page)

      await expect(input).toHaveValue('wrap <this>this word</this> please')
    })
  })

  test.describe('Focus Requirements', () => {
    // SPEC: shortcut:focus-required
    test('shortcuts only work when chat panel has focus', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Test text')

      await page.locator('[data-testid="footer"]').click()

      await page.keyboard.press('Control+s')

      // Stash did not fire since the chat panel isn't focused.
      await expect(input).toHaveValue('Test text')
    })
  })

  test.describe('Shift+Enter', () => {
    // SPEC: shortcut:shift-enter
    test('Shift+Enter inserts newline without submitting', async ({ page }) => {
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

    // SPEC: shortcut:shift-enter
    test('Shift+Enter inherits leading whitespace on the new line', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.evaluate(ta => {
        ta.focus()
        ta.value = '   hello'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(8, 8)
      })
      await input.press('Shift+Enter')
      expect(await input.inputValue()).toBe('   hello\n   ')
      expect(await input.evaluate(ta => ta.selectionStart)).toBe(12)
    })

    // SPEC: shortcut:shift-enter
    test('Shift+Enter continues bullet marker on list lines', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.evaluate(ta => {
        ta.focus()
        ta.value = '- foo'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(5, 5)
      })
      await input.press('Shift+Enter')
      expect(await input.inputValue()).toBe('- foo\n- ')
    })

    // SPEC: shortcut:shift-enter
    test('Shift+Enter auto-increments numbered list', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.evaluate(ta => {
        ta.focus()
        ta.value = '1. foo'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(6, 6)
      })
      await input.press('Shift+Enter')
      expect(await input.inputValue()).toBe('1. foo\n2. ')
    })

    // SPEC: shortcut:shift-enter
    test('Shift+Enter on checked task continues with always-unchecked checkbox', async ({
      page,
    }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.evaluate(ta => {
        ta.focus()
        ta.value = '- [x] foo'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(9, 9)
      })
      await input.press('Shift+Enter')
      expect(await input.inputValue()).toBe('- [x] foo\n- [ ] ')
    })

    // SPEC: shortcut:shift-enter
    test('Shift+Enter on empty marker exits the list', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.evaluate(ta => {
        ta.focus()
        ta.value = '- '
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(2, 2)
      })
      await input.press('Shift+Enter')
      // Marker removed from current line; new line is empty.
      expect(await input.inputValue()).toBe('\n')
    })
  })

  test.describe('Tab', () => {
    // SPEC: shortcut:tab
    test('Tab indents leading whitespace and inserts spaces in content zone', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      // Caret at col 0, unindented line - Tab snaps leading indent 0 to 2; value+selection set
      // atomically (avoids a Playwright parallel-worker race).
      await input.evaluate(ta => {
        ta.focus()
        ta.value = 'hello'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(0, 0)
      })
      await input.press('Tab')
      expect(await input.inputValue()).toBe('  hello')
      expect(await input.evaluate(ta => ta.selectionStart)).toBe(2)

      // Caret in content zone - Tab inserts 2 spaces at the caret position.
      await input.evaluate(ta => {
        ta.focus()
        ta.value = 'hello world'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(5, 5)
      })
      await input.press('Tab')
      expect(await input.inputValue()).toBe('hello   world')
      expect(await input.evaluate(ta => ta.selectionStart)).toBe(7)
    })
  })

  test.describe('Shift+Tab', () => {
    // SPEC: shortcut:shift-tab
    test('Shift+Tab dedents leading whitespace; no-op without leading whitespace', async ({
      page,
    }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      // 4 leading spaces - Shift+Tab snaps to 2. Value+selection are set atomically for timing stability.
      await input.evaluate(ta => {
        ta.focus()
        ta.value = '    hello'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(4, 4)
      })
      await input.press('Shift+Tab')
      expect(await input.inputValue()).toBe('  hello')

      // No leading whitespace - Shift+Tab is a no-op; focus stays on the textarea, not the browser default.
      await input.evaluate(ta => {
        ta.focus()
        ta.value = 'hello'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(0, 0)
      })
      await input.press('Shift+Tab')
      expect(await input.inputValue()).toBe('hello')
      expect(await page.evaluate(() => document.activeElement?.getAttribute?.('data-testid'))).toBe(
        'chat-input',
      )
    })
  })

  test.describe('Enter', () => {
    // SPEC: shortcut:enter
    test('Enter submits message', async ({ page }) => {
      const sendCalls = []
      await page.route('**/api/send', async route => {
        sendCalls.push(await route.request().postDataJSON())
        await route.fulfill({ status: 200, json: { success: true } })
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Submit me')
      await input.press('Enter')

      await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
      expect(sendCalls[0].prompt).toBe('Submit me')
    })
  })

  test.describe('Alt Panel Shortcuts', () => {
    // SPEC: shortcut:altc
    test('Alt+c moves focus into the chat input from elsewhere', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for post-replay auto-focus to settle: ChatInput's overlayMode-clear effect re-focuses
      // it via 2-rAF after replay_ended; without this wait, sessionsIcon.focus() races and flakes ~13%.
      await expect
        .poll(async () =>
          page.evaluate(() => document.activeElement?.getAttribute?.('data-testid')),
        )
        .toBe('chat-input')

      // Move focus away from the chat input first, so Alt+C must observably change something.
      const sessionsIcon = page.locator('[data-testid="icon-sessions"]')
      await sessionsIcon.focus()
      await expect
        .poll(async () =>
          page.evaluate(() => document.activeElement?.getAttribute?.('data-testid')),
        )
        .toBe('icon-sessions')

      // Press Alt+C - focus must land inside the chat input.
      await page.keyboard.press('Alt+c')

      await expect
        .poll(async () =>
          page.evaluate(() => document.activeElement?.getAttribute?.('data-testid')),
        )
        .toBe('chat-input')

      await expect(page.locator('[data-testid="panel-chat"]')).toBeVisible()
    })

    // SPEC: shortcut:alt0
    test('Alt+0 toggles logs panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="panel-logs"]')).not.toBeVisible()

      await page.keyboard.press('Alt+0')
      await expect(page.locator('[data-testid="panel-logs"]')).toBeVisible()

      await page.keyboard.press('Alt+0')
      await expect(page.locator('[data-testid="panel-logs"]')).not.toBeVisible()
    })

    // SPEC: shortcut:alt1
    test('Alt+1 toggles sessions panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Sessions is visible by default
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()

      await page.keyboard.press('Alt+1')
      await expect(page.locator('[data-testid="panel-sessions"]')).not.toBeVisible()

      await page.keyboard.press('Alt+1')
      await expect(page.locator('[data-testid="panel-sessions"]')).toBeVisible()
    })

    // SPEC: shortcut:alt2
    test('Alt+2 toggles todos panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Todos is visible by default
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()

      await page.keyboard.press('Alt+2')
      await expect(page.locator('[data-testid="panel-todos"]')).not.toBeVisible()

      await page.keyboard.press('Alt+2')
      await expect(page.locator('[data-testid="panel-todos"]')).toBeVisible()
    })

    // SPEC: shortcut:alt3
    test('Alt+3 toggles stash panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Stash is visible by default (check for stash empty message)
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()

      await page.keyboard.press('Alt+3')
      await expect(page.locator('[data-testid="stash-empty"]')).not.toBeVisible()

      await page.keyboard.press('Alt+3')
      await expect(page.locator('[data-testid="stash-empty"]')).toBeVisible()
    })

    // SPEC: shortcut:alt4
    test('Alt+4 toggles tasks panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Tasks is visible by default
      await expect(page.locator('[data-testid="panel-tasks"]')).toBeVisible()

      await page.keyboard.press('Alt+4')
      await expect(page.locator('[data-testid="panel-tasks"]')).not.toBeVisible()

      await page.keyboard.press('Alt+4')
      await expect(page.locator('[data-testid="panel-tasks"]')).toBeVisible()
    })

    // SPEC: shortcut:alt5
    test('Alt+5 toggles bookmarks panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Bookmarks is visible by default
      await expect(page.locator('[data-testid="panel-bookmarks"]')).toBeVisible()

      await page.keyboard.press('Alt+5')
      await expect(page.locator('[data-testid="panel-bookmarks"]')).not.toBeVisible()

      await page.keyboard.press('Alt+5')
      await expect(page.locator('[data-testid="panel-bookmarks"]')).toBeVisible()
    })

    // SPEC: shortcut:alt6
    test('Alt+6 toggles boards panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Boards is visible by default
      await expect(page.locator('[data-testid="panel-boards"]')).toBeVisible()

      await page.keyboard.press('Alt+6')
      await expect(page.locator('[data-testid="panel-boards"]')).not.toBeVisible()

      await page.keyboard.press('Alt+6')
      await expect(page.locator('[data-testid="panel-boards"]')).toBeVisible()
    })

    // SPEC: shortcut:alt7
    test('Alt+7 toggles usage panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Usage is hidden by default.
      await expect(page.locator('[data-testid="panel-usage"]')).not.toBeVisible()

      await page.keyboard.press('Alt+7')
      await expect(page.locator('[data-testid="panel-usage"]')).toBeVisible()

      await page.keyboard.press('Alt+7')
      await expect(page.locator('[data-testid="panel-usage"]')).not.toBeVisible()
    })

    // SPEC: shortcut:alt8
    test('Alt+8 toggles MCP panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="panel-mcp"]')).not.toBeVisible()

      await page.keyboard.press('Alt+8')
      await expect(page.locator('[data-testid="panel-mcp"]')).toBeVisible()

      await page.keyboard.press('Alt+8')
      await expect(page.locator('[data-testid="panel-mcp"]')).not.toBeVisible()
    })

    // SPEC: shortcut:alt9
    test('Alt+9 toggles commands panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('[data-testid="panel-skills"]')).not.toBeVisible()

      await page.keyboard.press('Alt+9')
      await expect(page.locator('[data-testid="panel-skills"]')).toBeVisible()

      await page.keyboard.press('Alt+9')
      await expect(page.locator('[data-testid="panel-skills"]')).not.toBeVisible()
    })
  })

  test.describe('Help Overlay (Alt+?)', () => {
    // SPEC: shortcut:alt-question
    test('Alt+? toggles help overlay modal', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.locator('.help-overlay')).not.toBeVisible()

      await page.keyboard.press('Alt+?')
      await expect(page.locator('.help-overlay')).toBeVisible()
      await expect(page.locator('.help-overlay-modal')).toBeVisible()

      await page.keyboard.press('Alt+?')
      await expect(page.locator('.help-overlay')).not.toBeVisible()
    })

    // SPEC: panel-help:overlay
    test('help overlay is centered AND closes via Escape AND backdrop click', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.keyboard.press('Alt+?')
      const overlay = page.locator('.help-overlay')
      const modal = page.locator('.help-overlay-modal')
      await expect(overlay).toBeVisible()
      await expect(modal).toBeVisible()

      // Centered per the spec claim: modal's mid-point within a small tolerance of the viewport's.
      const vw = page.viewportSize().width
      const vh = page.viewportSize().height
      const box = await modal.boundingBox()
      expect(Math.abs(box.x + box.width / 2 - vw / 2)).toBeLessThan(20)
      expect(Math.abs(box.y + box.height / 2 - vh / 2)).toBeLessThan(80)

      await page.keyboard.press('Escape')
      await expect(overlay).not.toBeVisible()

      // Reopen and verify the spec's "Escape OR clicking backdrop" claim for the other path too.
      await page.keyboard.press('Alt+?')
      await expect(overlay).toBeVisible()
      // (5, 5) is outside the modal but within the backdrop.
      await page.mouse.click(5, 5)
      await expect(overlay).not.toBeVisible()
    })
  })

  test.describe('Selection Wrap', () => {
    // SPEC: input:selection-wrap
    test('typing quote with selection wraps text in matching pair', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('wrap this text')
      await input.focus()

      // Select "this" (positions 5-9)
      await input.evaluate(el => {
        el.setSelectionRange(5, 9)
      })

      await page.keyboard.press("'")

      await expect(input).toHaveValue("wrap 'this' text")
    })
  })

  test.describe("Block Collapse (Ctrl+')", () => {
    // SPEC: shortcut:ctrl-quote
    // SPEC: input:collapse-placeholder
    test("Ctrl+' collapses nearest XML block at cursor", async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('<div>hello world</div>')
      await input.focus()

      // Place cursor inside the block (position 7)
      await input.evaluate(el => {
        el.setSelectionRange(7, 7)
      })

      await page.keyboard.press("Control+'")

      await expect(input).toHaveValue('<div...1>')
    })

    // SPEC: shortcut:ctrl-shift-quote
    test("Ctrl+Shift+' collapses all blocks", async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('<foo>bar</foo> <baz>qux</baz>')
      await input.focus()

      await page.keyboard.press('Control+"')

      await expect(input).toHaveValue('<foo...1> <baz...2>')
    })

    // SPEC: input:collapse-nested
    test("Ctrl+' collapses innermost block when nested", async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('<outer><inner>text</inner></outer>')
      await input.focus()

      // Place cursor inside inner block
      await input.evaluate(el => {
        el.setSelectionRange(15, 15)
      })

      await page.keyboard.press("Control+'")

      await expect(input).toHaveValue('<outer><inner...1></outer>')
    })
  })

  test.describe('Block Expand (Ctrl+\\)', () => {
    // SPEC: shortcut:ctrl-backslash
    test('Ctrl+\\ expands collapsed block at cursor', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('<div>hello world</div>')
      await input.focus()

      await input.evaluate(el => {
        el.setSelectionRange(7, 7)
      })
      await page.keyboard.press("Control+'")
      await expect(input).toHaveValue('<div...1>')

      // Cursor moves inside the collapsed placeholder before expanding.
      await input.evaluate(el => {
        el.setSelectionRange(3, 3)
      })
      await page.keyboard.press('Control+\\')

      await expect(input).toHaveValue('<div>hello world</div>')
    })

    // SPEC: shortcut:ctrl-shift-backslash
    test('Ctrl+Shift+\\ expands all collapsed blocks', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('<foo>bar</foo> <baz>qux</baz>')
      await input.focus()

      await page.keyboard.press('Control+"')
      await expect(input).toHaveValue('<foo...1> <baz...2>')

      await page.keyboard.press('Control+|')

      await expect(input).toHaveValue('<foo>bar</foo> <baz>qux</baz>')
    })
  })

  test.describe('Block Collapse Submit', () => {
    // SPEC: input:collapse-auto-expand
    test('collapsed blocks auto-expand before submit', async ({ page }) => {
      const sendCalls = []
      await page.route('**/api/send', async route => {
        sendCalls.push(await route.request().postDataJSON())
        await route.fulfill({ status: 200, json: { success: true } })
      })

      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('<div>full content</div>')
      await input.focus()

      await input.evaluate(el => {
        el.setSelectionRange(7, 7)
      })
      await page.keyboard.press("Control+'")
      await expect(input).toHaveValue('<div...1>')

      await input.press('Enter')

      await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
      expect(sendCalls[0].prompt).toBe('<div>full content</div>')
    })
  })

  test.describe('Help Overlay Alternate Binding', () => {
    // SPEC: shortcut:alt-question
    test('Alt+/ toggles help panel', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.keyboard.press('Alt+/')
      await expect(page.locator('.help-panel')).toBeVisible()

      await page.keyboard.press('Alt+/')
      await expect(page.locator('.help-panel')).not.toBeVisible()
    })
  })

  test.describe('New Session (Alt+N)', () => {
    // SPEC: shortcut:alt-n
    test('Alt+N creates a new session in the current browser tab', async ({ page }) => {
      let resolveNewSession
      const newSessionPromise = new Promise(resolve => {
        resolveNewSession = resolve
      })
      let newSessionCalled = false
      await mockAPI(page, {
        handlers: {
          newSession: async route => {
            newSessionCalled = true
            await newSessionPromise
            await route.fulfill({
              status: 200,
              json: { session_id: 'created-session', name: null },
            })
          },
        },
      })
      const _controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.keyboard.press('Alt+n')

      // Single-session mode swaps the header strip to "Creating..." while the API call is in flight.
      await expect(
        page.locator('[data-testid="session-header-strip"]').getByText('Creating'),
      ).toBeVisible()

      resolveNewSession()

      await expect.poll(() => newSessionCalled).toBe(true)
    })
  })

  test.describe('New Session in New Tab (Alt+Shift+N)', () => {
    // SPEC: shortcut:alt-shift-n
    test('Alt+Shift+N creates a new session in a new browser tab', async ({ page }) => {
      let newSessionCalled = false
      await mockAPI(page, {
        handlers: {
          newSession: async route => {
            newSessionCalled = true
            await route.fulfill({
              status: 200,
              json: { session_id: 'created-session', name: null },
            })
          },
        },
      })
      const _controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await page.keyboard.press('Alt+Shift+N')

      await expect.poll(() => newSessionCalled).toBe(true)
    })
  })

  test.describe('Global Navigation Shortcuts', () => {
    // SPEC: shortcut:focus-required
    test('Alt+Down works outside chat focus (global shortcut)', async ({ page }) => {
      await mockSSE(page, 'events/multi-turn.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const sessionsIcon = page.locator('[data-testid="icon-sessions"]')
      await sessionsIcon.focus()
      await expect(sessionsIcon).toBeFocused()

      await page.keyboard.press('Alt+ArrowDown')

      // A human message near the top proves the viewport navigated despite focus being elsewhere.
      const humanMessages = page.locator('.chat-message-user')
      await expect(humanMessages.first()).toBeVisible()
    })
  })
})
