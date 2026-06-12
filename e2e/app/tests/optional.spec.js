/** Optional E2E tests for advanced features. */

import { expect, test } from '@playwright/test'
import { openHelpPanel, openSessionsPanel, waitForAppReady } from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_URL,
  mockAPI,
} from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Optional Features', () => {
  test.describe('Markdown Rendering', () => {
    // SPEC: chat:markdown
    test('renders markdown code blocks', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/with-code-block.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Code block should render
      await expect(page.locator('pre code').first()).toBeVisible()
    })

    // SPEC: chat:markdown
    test('renders inline code', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/with-inline-code.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Inline code should render
      await expect(page.locator('code').first()).toBeVisible()
    })

    // SPEC: chat:markdown
    test('renders markdown lists and links', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/markdown-features.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Unordered list should render
      await expect(page.locator('ul').first()).toBeVisible()
      await expect(page.locator('li').first()).toBeVisible()

      // Link should render as anchor tag
      const link = page.locator('a[href="https://anthropic.com"]')
      await expect(link).toBeVisible()
      await expect(link).toContainText('Anthropic')
    })

    // SPEC: chat:markdown
    test('renders LaTeX math via KaTeX', async ({ page }) => {
      // Claim names "LaTeX math" as part of the markdown contract. Inject an
      // assistant message containing inline + display math and verify the
      // KaTeX-rendered output appears in the DOM (not the raw $...$ source).
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const ts = Date.now()
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Show me Euler',
          timestamp: ts,
          turn_id: 'turn_latex',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Inline math: $e^{i\\pi}+1=0$ is famous.',
          timestamp: ts + 100,
        },
        { type: 'result', subtype: 'success', turn_id: 'turn_latex', timestamp: ts + 200 },
      ])

      // KaTeX renders into spans with class .katex when math is processed by
      // the markdown pipeline. Presence proves LaTeX is being rendered.
      await expect(page.locator('.katex').first()).toBeVisible()
      // Raw $-delimited source must not survive into the rendered output.
      await expect(page.getByText(/\$e\^/).first()).toHaveCount(0)
    })
  })

  test.describe('Help Panel', () => {
    // SPEC: panel-help:shortcuts-table
    test('help panel shows keyboard shortcuts', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openHelpPanel(page)

      // Help panel should contain multiple keyboard shortcuts tables
      const helpPanel = page.locator('[data-testid="panel-help"]')
      await expect(helpPanel.getByText('Send message')).toBeVisible()

      // SPEC says "tables" (plural) - verify more than one table exists
      const tables = helpPanel.locator('table')
      const tableCount = await tables.count()
      expect(tableCount).toBeGreaterThan(1)
    })
  })

  test.describe('Context Progress', () => {
    // SPEC: footer:context
    test('context bar shows percentage', async ({ page }) => {
      await mockAPI(page, { statusFixture: 'status/with-context.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Context bar should show percentage
      const contextBar = page.locator('[data-testid="footer-context"]')
      await expect(contextBar).toBeVisible()
      await expect(contextBar).not.toBeEmpty()
    })
  })

  test.describe('Session Actions', () => {
    // SPEC: panel-session:rename
    test('session rename updates name', async ({ page }) => {
      let renameCalled = false
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          updateSession: async route => {
            renameCalled = true
            const data = await route.request().postDataJSON()
            await route.fulfill({ status: 200, json: { session_id: 'test-session-001', ...data } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Assert edit/rename button exists and click it
      const renameBtn = page.locator('.sessions-edit-btn').first()
      await expect(renameBtn).toBeVisible()
      await renameBtn.click()

      // Type new name and confirm
      await page.keyboard.type('New Name')
      await page.keyboard.press('Enter')

      // Verify rename API was called
      await expect.poll(() => renameCalled).toBe(true)
    })

    // SPEC: panel-session:rename
    test('rename cancel button discards changes', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      const renameBtn = page.locator('.sessions-edit-btn').first()
      await renameBtn.click()

      // Type a name
      await page.keyboard.type('Should not save')

      // Click cancel button (✕)
      const cancelBtn = page.locator('.sessions-edit-cancel')
      await expect(cancelBtn).toBeVisible()
      await cancelBtn.click()

      // Edit input should disappear
      await expect(page.locator('.sessions-edit-input')).not.toBeVisible()
    })

    // SPEC: panel-session:rename
    test('clicking away from rename input cancels', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      const renameBtn = page.locator('.sessions-edit-btn').first()
      await renameBtn.click()

      await page.keyboard.type('Should not save')

      // Click elsewhere to cancel
      await page.locator('.sessions-panel').click({ position: { x: 10, y: 10 } })

      // Edit input should disappear
      await expect(page.locator('.sessions-edit-input')).not.toBeVisible()
    })

    // SPEC: panel-session:resume
    test('session resume calls API', async ({ page }) => {
      let resumeCalled = false
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          resumeSession: async route => {
            resumeCalled = true
            await route.fulfill({
              json: { session_id: DEFAULT_SESSION_ID, container_id: DEFAULT_CONTAINER_ID },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Click resume on non-current session
      const resumeBtn = page.locator('[data-testid="session-resume-btn"]').first()
      await expect(resumeBtn).toBeVisible()
      await resumeBtn.click()

      // Poll until resume API is called
      await expect.poll(() => resumeCalled).toBe(true)
    })
  })
})
