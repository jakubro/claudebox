/** E2E tests for session prompt editor in the chat control bar. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

test.describe('Session Prompt', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    // Mock PATCH /api/sessions/:id/prompt
    await page.route(/\/api\/sessions\/current\/prompt/, async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, json: {} })
      } else {
        await route.continue()
      }
    })
  })

  // SPEC: chat:control-session-prompt
  test('renders session prompt button in control bar', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const btn = page.locator('.session-prompt-btn')
    await expect(btn).toBeVisible()
    await expect(btn).toHaveAttribute('title', 'Set session prompt')
  })

  // SPEC: chat:session-prompt-dropdown
  test('opens dropdown editor on click', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.session-prompt-btn').click()

    const dropdown = page.locator('.session-prompt-dropdown')
    await expect(dropdown).toBeVisible()
    await expect(dropdown.locator('.session-prompt-label')).toContainText('Session prompt')
    await expect(dropdown.locator('.session-prompt-textarea')).toBeVisible()
  })

  // SPEC: chat:session-prompt-save
  test('closes dropdown on Escape', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.session-prompt-btn').click()
    await expect(page.locator('.session-prompt-dropdown')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.session-prompt-dropdown')).not.toBeVisible()
  })

  // SPEC: chat:session-prompt-save
  test('closes dropdown on click outside', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.session-prompt-btn').click()
    await expect(page.locator('.session-prompt-dropdown')).toBeVisible()

    // Click on chat area (outside dropdown)
    await page.locator('[data-testid="chat-input"]').click()
    await expect(page.locator('.session-prompt-dropdown')).not.toBeVisible()
  })

  // SPEC: chat:session-prompt-save
  test('sends PATCH on close when content changed', async ({ page }) => {
    let patchCalled = false
    let patchBody = null
    await page.route(/\/api\/sessions\/current\/prompt/, async route => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true
        patchBody = await route.request().postDataJSON()
        await route.fulfill({ status: 200, json: {} })
      }
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.session-prompt-btn').click()
    await page.locator('.session-prompt-textarea').fill('Always run tests')
    await page.keyboard.press('Escape')

    await expect.poll(() => patchCalled).toBe(true)
    expect(patchBody).toEqual({ session_prompt: 'Always run tests' })
  })

  // SPEC: chat:session-prompt-badge
  test('shows blue badge when session prompt is set', async ({ page }) => {
    // Override status to include a session prompt
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-session-001',
              name: null,
              workspace: '/home/user/project',
              model: 'claude-sonnet-4-6',
              permission_mode: 'bypassPermissions',
              num_turns: 0,
              total_cost_usd: 0,
              total_duration_ms: 0,
              last_context_tokens: 0,
              context_window: 200000,
              started_at: '2025-01-18T12:00:00Z',
              updated_at: '2025-01-18T12:00:00Z',
              first_message: null,
              last_message: null,
              todos: [],
              commands: { custom: [], mcp: [], builtin: [] },
              session_dir: '/tmp/sessions/test-session-001',
              parent_session_id: null,
              session_prompt: 'Always run tests before committing',
            },
          })
        },
      },
    })
    await mockSSE(page)

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const btn = page.locator('.session-prompt-btn')
    await expect(btn).toHaveClass(/has-content/)
    await expect(btn).toHaveAttribute('title', 'Edit session prompt')
  })

  // SPEC: chat:session-prompt-disabled
  test('button disabled when no session loaded', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: null,
              workspace: '/home/user/project',
            },
          })
        },
      },
    })
    await mockSSE(page)

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('.session-prompt-btn')).toBeDisabled()
  })

  // SPEC: chat:control-fork-separator
  test('separator between fork and session prompt buttons', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Session prompt container should be preceded by a separator within the same group
    const container = page.locator('.session-prompt-container')
    const separator = container.locator(
      'xpath=preceding-sibling::span[@class="panel-control-separator"]',
    )
    await expect(separator.first()).toBeVisible()
  })

  // SPEC: chat:session-prompt-dropdown
  test('textarea is focused when dropdown opens', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.session-prompt-btn').click()

    const textarea = page.locator('.session-prompt-textarea')
    await expect(textarea).toBeFocused()
  })

  // SPEC: chat:session-prompt
  test('editor pre-fills with saved session prompt', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-session-001',
              name: null,
              workspace: '/home/user/project',
              model: 'claude-sonnet-4-6',
              permission_mode: 'bypassPermissions',
              num_turns: 0,
              total_cost_usd: 0,
              total_duration_ms: 0,
              last_context_tokens: 0,
              context_window: 200000,
              started_at: '2025-01-18T12:00:00Z',
              updated_at: '2025-01-18T12:00:00Z',
              first_message: null,
              last_message: null,
              todos: [],
              commands: { custom: [], mcp: [], builtin: [] },
              session_dir: '/tmp/sessions/test-session-001',
              parent_session_id: null,
              session_prompt: 'Always run tests',
            },
          })
        },
      },
    })
    await mockSSE(page)

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.session-prompt-btn').click()
    await expect(page.locator('.session-prompt-textarea')).toHaveValue('Always run tests')
  })

  // SPEC: chat:session-prompt-button
  test('button appears after fork button in left group', async ({ page }) => {
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const leftGroup = page.locator('.panel-control-group').first()
    const children = leftGroup.locator('> *')
    const labels = await children.evaluateAll(els =>
      els.map(el => el.getAttribute('title') || el.className),
    )

    // Order: pin, rename, [sep], reload, compact, fork-split, [sep], session-prompt
    const forkIdx = labels.findIndex(l => l?.includes('chat-control-fork-split'))
    const separatorIdx = labels.findIndex((l, i) => i > forkIdx && l?.includes('separator'))
    const promptIdx = labels.findIndex(l => l?.includes('session-prompt-container'))
    expect(forkIdx).toBeGreaterThanOrEqual(0)
    expect(separatorIdx).toBe(forkIdx + 1)
    expect(promptIdx).toBe(separatorIdx + 1)
  })

  // SPEC: chat:session-prompt-clear
  test('clearing text sends null to clear the prompt', async ({ page }) => {
    let patchBody = null
    await mockAPI(page, {
      handlers: {
        getSessionStatus: async route => {
          await route.fulfill({
            json: {
              session_id: 'test-session-001',
              name: null,
              workspace: '/home/user/project',
              model: 'claude-sonnet-4-6',
              permission_mode: 'bypassPermissions',
              num_turns: 0,
              total_cost_usd: 0,
              total_duration_ms: 0,
              last_context_tokens: 0,
              context_window: 200000,
              started_at: '2025-01-18T12:00:00Z',
              updated_at: '2025-01-18T12:00:00Z',
              first_message: null,
              last_message: null,
              todos: [],
              commands: { custom: [], mcp: [], builtin: [] },
              session_dir: '/tmp/sessions/test-session-001',
              parent_session_id: null,
              session_prompt: 'Old prompt text',
            },
          })
        },
        updateSessionPrompt: async route => {
          patchBody = await route.request().postDataJSON()
          await route.fulfill({ status: 200, json: {} })
        },
      },
    })
    await mockSSE(page)

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('.session-prompt-btn').click()
    await page.locator('.session-prompt-textarea').fill('   ')
    await page.keyboard.press('Escape')

    await expect.poll(() => patchBody).not.toBeNull()
    expect(patchBody).toEqual({ session_prompt: null })
  })

  // SPEC: chat:session-prompt-persist
  test('prompt survives page refresh', async ({ page }) => {
    const statusJson = {
      session_id: 'test-session-001',
      name: null,
      workspace: '/home/user/project',
      model: 'claude-sonnet-4-6',
      permission_mode: 'bypassPermissions',
      num_turns: 0,
      total_cost_usd: 0,
      total_duration_ms: 0,
      last_context_tokens: 0,
      context_window: 200000,
      started_at: '2025-01-18T12:00:00Z',
      updated_at: '2025-01-18T12:00:00Z',
      first_message: null,
      last_message: null,
      todos: [],
      commands: [],
      session_dir: '/tmp/sessions/test-session-001',
      parent_session_id: null,
      session_prompt: 'Persisted prompt',
    }

    await mockAPI(page, {
      handlers: { getSessionStatus: async route => route.fulfill({ json: statusJson }) },
    })
    await mockSSE(page)

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await expect(page.locator('.session-prompt-btn')).toHaveClass(/has-content/)

    // Re-register mocks before reload
    await mockAPI(page, {
      handlers: { getSessionStatus: async route => route.fulfill({ json: statusJson }) },
    })
    await mockSSE(page)
    await page.reload()
    await waitForAppReady(page)

    await expect(page.locator('.session-prompt-btn')).toHaveClass(/has-content/)
  })

  // SPEC: chat:session-prompt-inject
  test('session prompt visible as system-reminder after compaction', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/compaction-with-session-prompt.jsonl')

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Expand compaction block to reveal summary (collapsed by default)
    await page.locator('.compaction-header').click()

    const summary = page.locator('.compaction-summary')
    await expect(summary).toContainText('Always run tests before committing')
    // Session prompt is injected as system-reminder content visible within compaction summary
  })
})
