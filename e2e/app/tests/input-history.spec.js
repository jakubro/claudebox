/** E2E tests for input history navigation, draft preservation, cursor position, and persistence. */

import { expect, test } from '@playwright/test'
import { MAX_INPUT_HISTORY_ENTRIES } from '../../../src/claudebox_frontend/src/config/thresholds.js'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
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

      await input.fill('First message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('Second message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Second message')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('First message')
    })

    // SPEC: shortcut:arrow-up
    test('Up arrow mid-text does not navigate', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('Current text')

      // Unlike the position-0 case above, the cursor stays mid-text, so Up must not navigate.
      await input.press('ArrowUp')

      await expect(input).toHaveValue('Current text')
    })

    // SPEC: shortcut:arrow-down
    // SPEC: input:history-nav
    test('Down arrow at end navigates to next message', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('Old message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('New message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.press('Home')
      await input.press('ArrowUp')
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Old message')

      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('New message')
    })

    // SPEC: shortcut:arrow-down
    test('Down arrow mid-text does not navigate', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')

      // Approximates a mid-text cursor by simply not being at the end; Down should decline to navigate.
      await input.press('Home')
      await input.press('ArrowDown')

      await expect(input).toHaveValue('History item')
    })
  })

  test.describe('Draft Preservation', () => {
    // SPEC: input:draft-save
    // SPEC: input:draft-restore
    test('current draft preserved on Up navigation', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('My draft text')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')

      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('My draft text')
    })

    // SPEC: input:draft-save
    test('draft saved to localStorage', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('Draft to save')

      // Navigating into history triggers a draft save.
      await input.press('Home')
      await input.press('ArrowUp')

      // handleInput persists drafts.current under key draft:${sessionId} on every keystroke.
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

      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')

      const cursorPos = await input.evaluate(el => el.selectionStart)
      expect(cursorPos).toBe(0)
    })

    // SPEC: shortcut:arrow-down
    test('cursor at end after Down navigation', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('First')
      await input.press('Enter')
      await input.fill('Second')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.press('ArrowUp')
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('First')

      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('Second')

      // setCursorToEnd in navigateDown places the cursor at the end.
      const cursorPos = await input.evaluate(el => el.selectionStart)
      expect(cursorPos).toBe('Second'.length)
    })

    // SPEC: input:history-nav
    test('Up arrow at END of text also navigates', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // After fill(''), End leaves the cursor at position 0 (empty string).
      await input.fill('')
      await input.press('End')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')
    })

    // SPEC: input:history-nav
    test('Down arrow at END of text also navigates', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('First')
      await input.press('Enter')
      await input.fill('Second')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.press('ArrowUp')
      await expect(input).toHaveValue('Second')

      await input.press('End')
      await input.press('ArrowDown')

      // Entered history with an empty draft, so Down goes back to that empty draft.
      await expect(input).toHaveValue('')
    })
  })

  test.describe('Draft Stack', () => {
    // SPEC: input:draft-stack
    test('Down from non-empty pushes to draft stack', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      // No history entries needed for this path.
      await input.fill('My draft')

      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('')

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

      await input.fill('Draft A')
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('')

      await input.fill('Draft B')
      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('')

      await input.press('ArrowUp')
      await expect(input).toHaveValue('Draft B')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Draft A')
    })

    // SPEC: input:draft-stack
    test('draft preserved through Up into history then Down', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('History item')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('My preserved draft')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('History item')

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

      await input.fill('Original message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('Second message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Second message')

      await input.fill('Edited message')

      await input.press('End')
      await input.press('ArrowDown')
      await expect(input).toHaveValue('')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Edited message')
    })
  })

  test.describe('Persistence', () => {
    // SPEC: input:history-nav
    test('history persists across page reload', async ({ page }) => {
      const input = page.locator('[data-testid="chat-input"]')

      await input.fill('Persisted message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // Message is saved to localStorage under key inputHistory:{sessionId}.
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

      await page.reload()
      await waitForAppReady(page)

      // Polls because history loads from localStorage asynchronously after the reload.
      await expect
        .poll(async () => {
          await input.focus()
          await input.press('Home')
          await input.press('ArrowUp')
          const value = await input.inputValue()
          // Not yet loaded: press Down to return to the draft and retry.
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

      await input.fill('Session A message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('Session A message')

      // Clearing localStorage simulates a session switch.
      await page.evaluate(() => {
        localStorage.clear()
      })

      // Empty fixture keeps event-bootstrap from reintroducing user messages.
      await mockSSE(page, 'events/empty.jsonl')
      await page.reload()
      await waitForAppReady(page)

      await input.press('Home')
      await input.press('ArrowUp')

      await expect(input).toHaveValue('')
    })

    // SPEC: input:history-retention-bound
    test('history retains only the most recent entries once the cap is exceeded', async ({
      page,
    }) => {
      const storageKey = `inputHistory:${DEFAULT_SESSION_ID}`

      // Seed localStorage at the retention cap before the app loads.
      await page.evaluate(
        ({ key, count }) => {
          const seeded = Array.from({ length: count }, (_, i) => `entry-${i}`)
          localStorage.setItem(key, JSON.stringify(seeded))
        },
        { key: storageKey, count: MAX_INPUT_HISTORY_ENTRIES },
      )
      await page.reload()
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')

      // Push one more entry past the cap.
      await input.fill('newest message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      // The write evicts the oldest entry and keeps the count at the cap.
      await expect
        .poll(() =>
          page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]').length, storageKey),
        )
        .toBe(MAX_INPUT_HISTORY_ENTRIES)
      const persisted = await page.evaluate(
        key => JSON.parse(localStorage.getItem(key)),
        storageKey,
      )
      expect(persisted).not.toContain('entry-0')
      expect(persisted.at(-1)).toBe('newest message')

      // Reachable via Up arrow - the newest entry is what the user sees first.
      await input.press('Home')
      await input.press('ArrowUp')
      await expect(input).toHaveValue('newest message')
    })
  })

  test.describe('Selection Guard', () => {
    // SPEC: shortcut:arrow-up
    test('ArrowUp does not activate history when text is selected', async ({ page }) => {
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      const input = await waitForAppReady(page)

      await input.fill('First message')
      await input.press('Enter')
      await expect(input).toHaveValue('')

      await input.fill('new text')
      await page.keyboard.press('Control+a')

      // History must not activate because text is selected.
      await input.press('ArrowUp')

      await expect(input).toHaveValue('new text')
    })
  })
})
