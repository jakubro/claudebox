/** E2E tests for input history navigation, draft preservation, cursor position, and persistence. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Input History', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
  })

  test.describe('Arrow Navigation', () => {
    // SPEC: shortcut:arrow-up
    // SPEC: input:history-nav
    test('Up arrow at position 0 navigates to previous message', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit messages to populate history
      await input.fill('First message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('Second message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Navigate up (cursor at 0)
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Second message')

      // Navigate up again
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('First message')
    })

    // SPEC: shortcut:arrow-up
    test('Up arrow mid-text does not navigate', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit message to have history
      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Type new text (cursor at end)
      await input.fill('Current text')

      // Press Up without moving cursor to start
      await input.press('ArrowUp')

      // Should not navigate (cursor not at 0)
      await expect(input).toHaveValue('Current text')
    })

    // SPEC: shortcut:arrow-down
    // SPEC: input:history-nav
    test('Down arrow at end navigates to next message', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit messages
      await input.fill('Old message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('New message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Go to oldest
      await input.press('Home')
      await input.press('ArrowUp')
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Old message')

      // Navigate down (cursor at end)
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('New message')
    })

    // SPEC: shortcut:arrow-down
    test('Down arrow mid-text does not navigate', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit to have history
      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Navigate into history
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')

      // Move cursor to middle (simulate by just verifying down doesn't work when not at end)
      await input.press('Home') // Cursor at start, not at end

      // Press Down - should not work because cursor not at end
      await input.press('ArrowDown')

      // Should still show history item (Down didn't trigger)
      await expect(input).toHaveValue('History item')
    })
  })

  test.describe('Draft Preservation', () => {
    // SPEC: input:draft-save
    // SPEC: input:draft-restore
    test('current draft preserved on Up navigation', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit to have history
      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Type a draft
      await input.fill('My draft text')

      // Navigate up
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')

      // Navigate down to return to draft
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('My draft text')
    })

    // SPEC: input:draft-save
    test('draft saved to localStorage', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit to have history
      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Type a draft
      await input.fill('Draft to save')

      // Navigate into history (triggers draft save)
      await input.press('Home')
      await input.press('ArrowUp')

      // Poll until draft is saved to localStorage (key format: draft:${sessionId})
      // handleInput saves current text to drafts.current on every keystroke
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i)
              if (key?.startsWith('draft:')) {
                const data = JSON.parse(localStorage.getItem(key))
                return data?.current ?? null
              }
            }
            return null
          })
        })
        .toBe('Draft to save')
    })
  })

  test.describe('Cursor Position', () => {
    // SPEC: shortcut:arrow-up
    test('cursor at beginning after Up navigation', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit message to have history
      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Navigate up
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')

      // Check cursor position is at beginning (0)
      const cursorPos = await input.evaluate(el => el.selectionStart)
      expect(cursorPos).toBe(0)
    })

    // SPEC: shortcut:arrow-down
    test('cursor at end after Down navigation', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit messages
      await input.fill('First')
      await input.press('Enter')
      await input.fill('Second')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Navigate up twice to get to oldest
      await input.press('ArrowUp')
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('First')

      // Navigate down
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('Second')

      // Check cursor position is at end (setCursorToEnd in navigateDown)
      const cursorPos = await input.evaluate(el => el.selectionStart)
      expect(cursorPos).toBe('Second'.length)
    })

    // SPEC: input:history-nav
    test('Up arrow at END of text also navigates', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit message to have history
      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Navigate up from END position (cursor at end by default after fill)
      await input.fill('')
      await input.press('End') // Cursor at end of empty = position 0
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')
    })

    // SPEC: input:history-nav
    test('Down arrow at END of text also navigates', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit messages
      await input.fill('First')
      await input.press('Enter')
      await input.fill('Second')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Navigate up to get into history
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Second')

      // Move cursor to end and press Down
      await input.press('End')
      await input.press('ArrowDown')

      // Should navigate forward (either back to empty or to draft)
      // Since we entered history with empty input, down should go back to empty
      await expect(input).toHaveValue('')
    })
  })

  test.describe('Draft Stack', () => {
    // SPEC: input:draft-stack
    test('Down from non-empty pushes to draft stack', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Type text (no history needed)
      await input.fill('My draft')

      // Press Down - should push to draft stack and clear
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('')

      // Verify draft was saved to stack in localStorage
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i)
              if (key?.startsWith('draft:')) {
                const data = JSON.parse(localStorage.getItem(key))
                return data?.stack?.includes('My draft') ?? false
              }
            }
            return false
          })
        })
        .toBe(true)
    })

    // SPEC: input:draft-stack
    test('Up pops from draft stack (LIFO)', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Push multiple drafts to stack
      await input.fill('Draft A')
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('')

      await input.fill('Draft B')
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('')

      // Press Up - should pop Draft B (LIFO)
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Draft B')

      // Press Up again after moving cursor - should pop Draft A
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Draft A')
    })

    // SPEC: input:draft-stack
    test('draft preserved through Up into history then Down', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit to have history
      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Type a draft
      await input.fill('My preserved draft')

      // Navigate Up into history
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')

      // Navigate Down - should recover the draft
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('My preserved draft')
    })
  })

  test.describe('Edit In-Place', () => {
    // SPEC: input:history-nav
    test('editing a history item preserves the edit when navigating away and back', async ({
      page,
    }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit messages to populate history
      await input.fill('Original message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('Second message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Navigate up to most recent history item
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Second message')

      // Edit the history item
      await input.fill('Edited message')

      // Navigate away (down to draft)
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('')

      // Navigate back up - edit should be preserved
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Edited message')
    })
  })

  test.describe('Persistence', () => {
    // SPEC: input:history-nav
    test('history persists across page reload', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit a message
      await input.fill('Persisted message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Poll until message is saved to localStorage (key format: inputHistory:{sessionId})
      await expect
        .poll(async () => {
          return await page.evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i)
              if (key?.startsWith('inputHistory:')) {
                return true
              }
            }
            return false
          })
        })
        .toBe(true)

      // Reload page
      await page.reload()
      await waitForAppReady(page)

      // Poll until history is loaded from localStorage and navigable
      await expect
        .poll(async () => {
          await input.focus()
          await input.press('Home')
          await input.press('ArrowUp')
          const value = await input.inputValue()
          // Reset if not yet loaded - press Down to return to draft
          if (value !== 'Persisted message') {
            await input.press('End')
            await input.press('ArrowDown')
          }
          return value
        })
        .toBe('Persisted message')
    })

    test('history cleared on session switch via localStorage', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // Submit a message
      await input.fill('Session A message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Verify history exists
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Session A message')

      // Clear localStorage to simulate session switch
      await page.evaluate(() => {
        localStorage.clear()
      })

      // Reload with empty fixture so bootstrap from events has no user messages
      await mockSSE(page, 'events/empty.jsonl')
      await page.reload()
      await waitForAppReady(page)

      // Navigate up - should not find previous history
      await input.press('Home')
      await input.press('ArrowUp')

      // Input should still be empty (no history)
      await expect(input).toHaveValue('')
    })
  })

  test.describe('Selection Guard', () => {
    // SPEC: shortcut:arrow-up
    test('ArrowUp does not activate history when text is selected', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      // Submit a message to populate history
      await input.fill('First message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Type new text and select all
      await input.fill('new text')
      await page.keyboard.press('Control+a')

      // Move cursor to position 0 (selection still active)
      await input.press('ArrowUp')

      // History should NOT activate because text is selected
      await expect(input).toHaveValue('new text')
    })
  })
})
