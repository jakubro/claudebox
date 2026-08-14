/** E2E tests for slash command autocomplete. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, DEFAULT_WORKSPACE_ID, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Slash Commands', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
  })

  // SPEC: input:slash-trigger
  test('/ at position 0 shows autocomplete', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]')
    await input.click()
    await page.keyboard.type('/')

    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
  })

  // SPEC: input:slash-trigger
  test('/ at non-zero position does not show autocomplete', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('some text /')

    // Trigger only fires at position 0.
    await expect(page.locator('[data-testid="command-autocomplete"]')).not.toBeVisible()
  })

  // SPEC: input:slash-trigger
  test('shows commands from session data', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]')
    await input.click()
    await page.keyboard.type('/')

    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()

    // Commands come from the status fixture (/help, /clear, /compact).
    await expect(page.locator('[data-testid="command-autocomplete"]')).toContainText('/help')
    await expect(page.locator('[data-testid="command-autocomplete"]')).toContainText('/clear')
  })

  // SPEC: input:slash-autocomplete-on-welcome
  test('welcome screen picker is populated from the workspace catalog', async ({ page }) => {
    // Bare workspace URL = welcome mode (no session segment)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await waitForAppReady(page)

    const input = page.locator('[data-testid="chat-input"]')
    await input.click()
    await page.keyboard.type('/')

    // Entries come from the workspace catalog mock.
    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
    await expect(page.locator('[data-testid="command-autocomplete"]')).toContainText('/help')
  })

  // SPEC: input:slash-fuzzy
  test('fuzzy matches commands', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]')
    await input.click()
    await page.keyboard.type('/hel')

    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
    await expect(page.locator('[data-testid="command-autocomplete"]')).toContainText('/help')

    // Case-insensitive: clear and type uppercase
    await input.fill('')
    await input.click()
    await page.keyboard.type('/HEL')

    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
    await expect(page.locator('[data-testid="command-autocomplete"]')).toContainText('/help')
  })

  // SPEC: input:slash-insert
  // SPEC: input:slash-tab-cursor
  test('selecting command inserts it', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]')
    await input.click()
    await page.keyboard.type('/')

    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
    await page.keyboard.press('Enter')

    await expect(input).toHaveValue(/^\/\w+/)

    // Caret sits immediately after the inserted command + trailing space.
    const value = await input.inputValue()
    const expected = value.indexOf(' ') + 1
    const caret = await input.evaluate(el => el.selectionStart)
    expect(caret).toBe(expected)

    await expect(page.locator('[data-testid="command-autocomplete"]')).not.toBeVisible()
  })

  // SPEC: input:slash-insert
  test('clicking command inserts it', async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]')
    await input.click()
    await page.keyboard.type('/')

    await expect(page.locator('[data-testid="command-autocomplete"]')).toBeVisible()
    await page.locator('[data-testid="command-autocomplete"] .autocomplete-item').first().click()

    await expect(input).toHaveValue(/^\/\w+/)
  })
})

test.describe('Slash Commands - Message Styling', () => {
  // SPEC: chat:user-message-slash-command-styling
  test('slash command in message renders bold', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/slash-command-message.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const turn = page.locator('.turn-container').first()
    await expect(turn).toBeVisible()

    const helpToken = page.locator('.slash-command').first()
    await expect(helpToken).toBeVisible()
    await expect(helpToken).toHaveText('/help')

    // Bold weight regardless of resolved/unresolved
    const fontWeight = await helpToken.evaluate(el => getComputedStyle(el).fontWeight)
    expect(Number(fontWeight)).toBeGreaterThanOrEqual(700)
    await expect(helpToken).toHaveClass(/slash-command\s+(resolved|unresolved)/)
  })

  // SPEC: chat:user-message-slash-command-styling
  test('slash command token is not wrapped in an anchor', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/slash-command-message.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const helpToken = page.locator('.slash-command').first()
    await expect(helpToken).toBeVisible()

    const isInsideAnchor = await helpToken.evaluate(el => {
      return el.closest('a') !== null || el.tagName === 'A'
    })
    expect(isInsideAnchor, '/help token should not be inside an <a> element').toBe(false)
  })
})
