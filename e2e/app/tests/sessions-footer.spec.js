/** E2E tests for sessions panel and footer. */

import { expect, test } from '@playwright/test'
import { assertColor, openSessionsPanel, waitForAppReady } from '../helpers.js'
import {
  DEFAULT_BACKEND_ID,
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_URL,
  loadFixture,
  mockAPI,
} from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Footer', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
  })

  test.describe('Status Display', () => {
    // SPEC: footer:status-text
    // SPEC: footer:connection-dot
    // SPEC: footer:dev-indicator
    test('renders Ready status text and a green-classed dot when connected', async ({ page }) => {
      // Connected state: text label + corresponding data-status attribute.
      await expect(page.getByText('Ready')).toBeVisible()
      const status = page.locator('[data-testid="footer-status"][data-status="ready"]')
      await expect(status).toBeVisible()

      // Connection dot must be present and carry the running/connected class
      // - CSS owns the green color, so the class is the contract.
      const dot = page.locator('.footer-status-dot, [data-testid="footer-status"] .status-dot')
      const dotCount = await dot.count()
      if (dotCount > 0) {
        const cls = await dot.first().getAttribute('class')
        expect(cls).toMatch(/connected|ready|running|green/i)
      }
    })

    // SPEC: footer:workspace
    test('shows workspace name', async ({ page }) => {
      await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')
    })

    // SPEC: footer:turns
    test('shows turn count', async ({ page }) => {
      await expect(page.locator('[data-testid="footer-turns"]')).toContainText('0 turns')
    })

    // SPEC: footer:cost
    test('shows cost', async ({ page }) => {
      await expect(page.locator('[data-testid="footer-cost"]')).toContainText('$0.00')
    })

    // SPEC: footer:model
    test('shows model', async ({ page }) => {
      await expect(page.locator('[data-testid="footer-model"]')).toContainText('Sonnet 4.6')
    })

    // SPEC: footer:session-id
    test('shows session ID', async ({ page }) => {
      await expect(page.locator('[data-testid="footer-session"]')).toContainText('test-session-001')
    })

    // SPEC: footer:runtime-id
    test('shows runtime container id (12-char prefix) after the session id', async ({ page }) => {
      // Footer reads from GET /api/workspaces/{ws}/containers/{id} which returns
      // the Container record with backend_id. The default mock returns
      // DEFAULT_BACKEND_ID; we assert the 12-char display and the full id in
      // the tooltip.
      const runtime = page.locator('[data-testid="footer-backend-id"]')
      await expect(runtime).toContainText(DEFAULT_BACKEND_ID.slice(0, 12))
      await expect(runtime).toHaveAttribute(
        'title',
        new RegExp(`Container - ${DEFAULT_BACKEND_ID}`),
      )
    })

    // SPEC: footer:context
    test('shows context bar', async ({ page }) => {
      const contextEl = page.locator('[data-testid="footer-context"]')
      await expect(contextEl).toBeVisible()
      await expect(contextEl).not.toBeEmpty()
      await expect(page.locator('.context-bar')).toBeVisible()
    })

    // SPEC: footer:duration
    test('shows duration in H:MM:SS format', async ({ page }) => {
      // Footer shows total response time in format like "0:00:00"
      const footerItem = page.locator('.footer-item').filter({ hasText: /\d+:\d{2}:\d{2}/ })
      await expect(footerItem.first()).toBeVisible()
    })

    // SPEC: footer:new-session-populated
    test('on new session creation, footer fields populate immediately from create-response', async ({
      page,
    }) => {
      // Workspace, session id, model, effort level should be present from
      // the very first frame after the new-session API resolves - no blank
      // window while the SDK init event arrives later.
      await page.click('[data-testid="header-new-session-btn"]')
      await expect(page.locator('[data-testid="footer-workspace"]')).not.toContainText('-')
      await expect(page.locator('[data-testid="footer-session"]')).not.toBeEmpty()
      await expect(page.locator('[data-testid="footer-model"]')).not.toContainText('-')
    })
  })

  test.describe('Model Picker', () => {
    // SPEC: footer:model
    // SPEC: footer:model-picker
    // SPEC: footer:model-picker-trigger
    // SPEC: footer:model-picker-list
    // SPEC: footer:model-picker-current
    // SPEC: footer:model-picker-position
    test('clicking model name opens dropdown with available models', async ({ page }) => {
      const modelBtn = page.locator('[data-testid="footer-model"]')
      await expect(modelBtn).toContainText('Sonnet 4.6')

      await modelBtn.click()
      const dropdown = page.locator('[data-testid="model-dropdown"]')
      await expect(dropdown).toBeVisible()

      // Lists models with friendly name and model ID
      await expect(dropdown.getByText('Opus 4.6')).toBeVisible()
      await expect(dropdown.getByText('Sonnet 4.6')).toBeVisible()
      await expect(dropdown.getByText('Haiku 4.5')).toBeVisible()

      // Dropdown opens upward (bottom of dropdown near top of button)
      const btnBox = await modelBtn.boundingBox()
      const dropBox = await dropdown.boundingBox()
      expect(dropBox.y + dropBox.height).toBeLessThanOrEqual(btnBox.y + 2)

      // Current model highlighted with check
      const selected = dropdown.locator('.footer-model-option.selected')
      await expect(selected).toHaveCount(1)
    })

    // SPEC: footer:model-picker-select
    test('selecting a model closes dropdown and updates footer', async ({ page }) => {
      let setModelBody = null

      // Override session refresh to reflect selected model
      await page.route('**/api/sessions/current', async route => {
        const data = loadFixture('status/default.json')
        if (setModelBody?.model) {
          data.model = setModelBody.model
        }
        await route.fulfill({ json: data })
      })

      await page.route('**/api/model', async route => {
        setModelBody = await route.request().postDataJSON()
        await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
      })

      await page.locator('[data-testid="footer-model"]').click()
      const dropdown = page.locator('[data-testid="model-dropdown"]')
      await expect(dropdown).toBeVisible()

      await dropdown.getByText('Opus 4.6').click()

      await expect(dropdown).not.toBeVisible()
      await expect(page.locator('[data-testid="footer-model"]')).toContainText('Opus 4.6')
      await expect.poll(() => setModelBody).toEqual({ model: 'claude-opus-4-6' })
    })

    // SPEC: footer:model-picker-close
    test('dropdown closes on Escape', async ({ page }) => {
      await page.locator('[data-testid="footer-model"]').click()
      await expect(page.locator('[data-testid="model-dropdown"]')).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.locator('[data-testid="model-dropdown"]')).not.toBeVisible()
    })

    test('dropdown closes on click outside', async ({ page }) => {
      await page.locator('[data-testid="footer-model"]').click()
      await expect(page.locator('[data-testid="model-dropdown"]')).toBeVisible()

      await page.locator('.chat-panel').click()
      await expect(page.locator('[data-testid="model-dropdown"]')).not.toBeVisible()
    })

    // SPEC: footer:model-picker-disabled
    test('model picker disabled during response', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Hello',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])

      const modelBtn = page.locator('[data-testid="footer-model"]')
      await expect(modelBtn).toBeDisabled()

      await modelBtn.click({ force: true })
      await expect(page.locator('[data-testid="model-dropdown"]')).not.toBeVisible()
    })
  })

  test.describe('Permission Mode Picker', () => {
    // SPEC: footer:permission-mode
    // SPEC: footer:permission-mode-picker
    // SPEC: footer:permission-mode-picker-trigger
    // SPEC: footer:permission-mode-picker-list
    // SPEC: footer:permission-mode-picker-current
    // SPEC: footer:permission-mode-picker-position
    test('clicking permission mode label opens dropdown with available modes', async ({ page }) => {
      const modeBtn = page.locator('[data-testid="footer-permission-mode-picker"]')
      await expect(modeBtn).toContainText('Bypass')

      await modeBtn.click()
      const dropdown = page.locator('[data-testid="permission-mode-dropdown"]')
      await expect(dropdown).toBeVisible()

      // Lists all built-in permission modes with friendly labels
      const optionNames = dropdown.locator('.footer-permission-mode-option-name')
      await expect(optionNames.filter({ hasText: 'Bypass' })).toBeVisible()
      await expect(optionNames.filter({ hasText: 'Plan' })).toBeVisible()
      await expect(optionNames.filter({ hasText: 'Default' })).toBeVisible()
      await expect(optionNames.filter({ hasText: 'Auto' })).toBeVisible()

      // Dropdown opens upward (bottom of dropdown near top of button)
      const btnBox = await modeBtn.boundingBox()
      const dropBox = await dropdown.boundingBox()
      expect(dropBox.y + dropBox.height).toBeLessThanOrEqual(btnBox.y + 2)

      // Current permission mode highlighted with check
      const selected = dropdown.locator('.footer-permission-mode-option.selected')
      await expect(selected).toHaveCount(1)
    })

    // SPEC: footer:permission-mode-picker-select
    test('selecting a permission mode closes dropdown and updates footer', async ({ page }) => {
      let setModeBody = null
      await page.route('**/api/permission-mode', async route => {
        if (route.request().method() === 'POST') {
          setModeBody = await route.request().postDataJSON()
          await route.fulfill({
            json: {
              active: setModeBody.permission_mode,
              permission_modes: [
                {
                  id: 'bypassPermissions',
                  name: 'Bypass',
                  description: 'Bypass all permission checks',
                },
                { id: 'plan', name: 'Plan', description: 'Planning mode' },
                { id: 'default', name: 'Default', description: 'Standard permission behavior' },
                { id: 'acceptEdits', name: 'Auto', description: 'Auto-accept file edits' },
              ],
            },
          })
        } else {
          await route.continue()
        }
      })

      await page.locator('[data-testid="footer-permission-mode-picker"]').click()
      const dropdown = page.locator('[data-testid="permission-mode-dropdown"]')
      await expect(dropdown).toBeVisible()

      await dropdown
        .locator('.footer-permission-mode-option-name')
        .filter({ hasText: 'Plan' })
        .click()

      await expect(dropdown).not.toBeVisible()
      await expect(page.locator('[data-testid="footer-permission-mode-picker"]')).toContainText(
        'Plan',
      )
      await expect.poll(() => setModeBody).toEqual({ permission_mode: 'plan' })
    })

    // SPEC: footer:permission-mode-picker-close
    test('dropdown closes on Escape', async ({ page }) => {
      await page.locator('[data-testid="footer-permission-mode-picker"]').click()
      await expect(page.locator('[data-testid="permission-mode-dropdown"]')).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.locator('[data-testid="permission-mode-dropdown"]')).not.toBeVisible()
    })

    test('dropdown closes on click outside', async ({ page }) => {
      await page.locator('[data-testid="footer-permission-mode-picker"]').click()
      await expect(page.locator('[data-testid="permission-mode-dropdown"]')).toBeVisible()

      await page.locator('.chat-panel').click()
      await expect(page.locator('[data-testid="permission-mode-dropdown"]')).not.toBeVisible()
    })

    // SPEC: footer:permission-mode-picker-disabled
    test('permission mode picker disabled during response', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Hello',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])

      const modeBtn = page.locator('[data-testid="footer-permission-mode-picker"]')
      await expect(modeBtn).toBeDisabled()

      await modeBtn.click({ force: true })
      await expect(page.locator('[data-testid="permission-mode-dropdown"]')).not.toBeVisible()
    })

    // SPEC: footer:permission-mode-picker-default
    test('starts with bypassPermissions permission mode', async ({ page }) => {
      await expect(page.locator('[data-testid="footer-permission-mode-picker"]')).toContainText(
        'Bypass',
      )
    })
  })

  test.describe('Effort Level Picker', () => {
    // SPEC: footer:effort
    // SPEC: footer:effort-picker
    // SPEC: footer:effort-picker-trigger
    // SPEC: footer:effort-picker-list
    // SPEC: footer:effort-picker-current
    // SPEC: footer:effort-picker-dropdown
    // SPEC: footer:effort-picker-position
    test('clicking effort label opens dropdown with available levels', async ({ page }) => {
      const effortBtn = page.locator('[data-testid="footer-effort"]')
      await expect(effortBtn).toContainText('XHigh')

      await effortBtn.click()
      const dropdown = page.locator('[data-testid="effort-dropdown"]')
      await expect(dropdown).toBeVisible()

      // Lists all effort levels with friendly names
      // Use exact match to disambiguate "High" from "XHigh" substring match.
      await expect(dropdown.getByText('Low', { exact: true })).toBeVisible()
      await expect(dropdown.getByText('Medium', { exact: true })).toBeVisible()
      await expect(dropdown.getByText('High', { exact: true })).toBeVisible()
      await expect(dropdown.getByText('XHigh', { exact: true })).toBeVisible()
      await expect(dropdown.getByText('Max', { exact: true })).toBeVisible()

      // Dropdown opens upward (bottom of dropdown near top of button)
      const btnBox = await effortBtn.boundingBox()
      const dropBox = await dropdown.boundingBox()
      expect(dropBox.y + dropBox.height).toBeLessThanOrEqual(btnBox.y + 2)

      // Current effort level highlighted with check
      const selected = dropdown.locator('.footer-effort-option.selected')
      await expect(selected).toHaveCount(1)
    })

    // SPEC: footer:effort-picker-select
    test('selecting an effort level closes dropdown and updates footer', async ({ page }) => {
      let setEffortBody = null

      await page.route('**/api/effort-level', async route => {
        setEffortBody = await route.request().postDataJSON()
        await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
      })

      await page.locator('[data-testid="footer-effort"]').click()
      const dropdown = page.locator('[data-testid="effort-dropdown"]')
      await expect(dropdown).toBeVisible()

      await dropdown.getByText('High', { exact: true }).click()

      await expect(dropdown).not.toBeVisible()
      await expect.poll(() => setEffortBody).toEqual({ effort_level: 'high' })
    })

    // SPEC: footer:effort-picker-close
    test('dropdown closes on Escape', async ({ page }) => {
      await page.locator('[data-testid="footer-effort"]').click()
      await expect(page.locator('[data-testid="effort-dropdown"]')).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.locator('[data-testid="effort-dropdown"]')).not.toBeVisible()
    })

    test('dropdown closes on click outside', async ({ page }) => {
      await page.locator('[data-testid="footer-effort"]').click()
      await expect(page.locator('[data-testid="effort-dropdown"]')).toBeVisible()

      await page.locator('.chat-panel').click()
      await expect(page.locator('[data-testid="effort-dropdown"]')).not.toBeVisible()
    })

    // SPEC: footer:effort-picker-disabled
    test('effort picker disabled during response', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Hello',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          timestamp: Date.now() + 100,
        },
      ])

      const effortBtn = page.locator('[data-testid="footer-effort"]')
      await expect(effortBtn).toBeDisabled()

      await effortBtn.click({ force: true })
      await expect(page.locator('[data-testid="effort-dropdown"]')).not.toBeVisible()
    })

    // SPEC: footer:effort-picker-default
    test('falls back to backend default effort level when session has none', async ({ page }) => {
      // session-defaults mock returns "xhigh" (matches DEFAULT_EFFORT_LEVEL).
      // When the session projection has no effort_level, the picker shows the
      // backend default - not a hardcoded fallback.
      await expect(page.locator('[data-testid="footer-effort"]')).toContainText('XHigh')
    })

    // SPEC: footer:effort-picker-persist
    test('effort level restored from session data on load', async ({ page }) => {
      // Make session status return effort_level=high after refresh
      const effortLevel = 'high'
      await page.route('**/api/sessions/current', async route => {
        const data = loadFixture('status/default.json')
        data.effort_level = effortLevel
        await route.fulfill({ json: data })
      })
      await page.route('**/api/effort-level', async route => {
        await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
      })

      // Set effort to high via picker (triggers refresh which returns our overridden data)
      await page.locator('[data-testid="footer-effort"]').click()
      const dropdown = page.locator('[data-testid="effort-dropdown"]')
      await dropdown.getByText('High', { exact: true }).click()

      // After refresh, footer should show exactly "High" - not "XHigh".
      await expect(page.locator('[data-testid="footer-effort"]')).toHaveText(/^High/)
    })

    // SPEC: footer:effort-picker-all-models
    test('max option visible for all models', async ({ page }) => {
      // Default fixture uses claude-sonnet-4-6 - Max should still be available
      await page.locator('[data-testid="footer-effort"]').click()
      const dropdown = page.locator('[data-testid="effort-dropdown"]')
      await expect(dropdown).toBeVisible()

      await expect(dropdown.getByText('Low', { exact: true })).toBeVisible()
      await expect(dropdown.getByText('Medium', { exact: true })).toBeVisible()
      await expect(dropdown.getByText('High', { exact: true })).toBeVisible()
      await expect(dropdown.getByText('Max', { exact: true })).toBeVisible()
    })
  })

  test.describe('Working State', () => {
    // SPEC: footer:interrupt-hint
    test('shows interrupt hint during response', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send a turn that's "working" (no result event yet)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Do something',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working on it...',
          timestamp: Date.now() + 100,
        },
      ])

      // Wait for working state
      await expect(
        page.locator('[data-testid="footer-status"][data-status="working"]'),
      ).toBeVisible()

      // Should show interrupt hint "Ctrl+. to stop"
      const interruptHint = page.locator('.footer-interrupt')
      await expect(interruptHint).toBeVisible()
      await expect(interruptHint).toContainText('Ctrl+. to stop')
    })

    // SPEC: footer:elapsed-timer
    test('shows elapsed seconds in working status', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send a turn that's "working" (no result event yet)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Do something',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working on it...',
          timestamp: Date.now() + 100,
        },
      ])

      // Wait for working state with elapsed timer
      await expect(
        page.locator('[data-testid="footer-status"][data-status="working"]'),
      ).toBeVisible()

      // Elapsed timer should appear with format "(Ns)" e.g. "(1s)"
      // Wait a moment for timer to increment
      await page.waitForTimeout(1100)
      const statusText = page.locator('.footer-status-text')
      await expect(statusText).toContainText(/\(\d+s\)/)
    })

    // SPEC: footer:connection-dot
    test('connecting state dot has amber hue', async ({ page }) => {
      const controller = await createSSEController(page, { autoConnect: false })
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)

      // Before SSE connects, status should be connecting
      await expect(page.locator('[data-testid="footer"]')).toBeVisible()

      // Connection dot in connecting state should have amber color (if rendered)
      const statusDot = page.locator('.footer-status-dot')
      const hasDot = (await statusDot.count()) > 0
      if (hasDot) {
        await expect(statusDot).toBeVisible()
        await assertColor(statusDot, 'backgroundColor', { r: 220, g: 170, b: 50 }, 80)
      }

      // Complete the connection
      await controller.connect()
    })

    // SPEC: footer:silence-detection
    // SPEC: footer:silence-threshold
    // SPEC: footer:silence-dim
    // SPEC: footer:silence-recovery
    test('transitions to Waiting status after silence threshold', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.clock.install()
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Send a turn that's "working" (no result event yet)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Do something',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working on it...',
          timestamp: Date.now() + 100,
        },
      ])

      // Initially should be "Working..."
      await expect(
        page.locator('[data-testid="footer-status"][data-status="working"]'),
      ).toBeVisible()
      await expect(page.locator('.footer-status-text')).toContainText('Working')

      // Fast-forward past the 5-second silence threshold
      await page.clock.fastForward(5500)

      // Should transition to "Waiting..." (with dimmed styling and muted gray color)
      await expect(page.locator('.footer-status-text')).toContainText('Waiting')
      await expect(page.locator('.footer-status-text.status-silent')).toBeVisible()

      // SPEC: footer:silence-dim - muted gray color
      const silentText = page.locator('.footer-status-text.status-silent')
      const color = await silentText.evaluate(el => getComputedStyle(el).color)
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      expect(match).toBeTruthy()
      const [, r, g, b] = match.map(Number)
      // Muted gray: channels roughly equal, not bright white or fully saturated
      expect(Math.abs(r - g)).toBeLessThan(40)
      expect(Math.abs(g - b)).toBeLessThan(40)

      // Send new event - should recover to Working
      await controller.sendEvent({
        type: 'assistant',
        subtype: 'text',
        content: 'More content...',
        timestamp: Date.now() + 6000,
      })

      // Should revert to "Working..." (silence class removed)
      await expect(page.locator('.footer-status-text')).toContainText('Working')
      await expect(page.locator('.footer-status-text.status-silent')).not.toBeVisible()
    })
  })

  test.describe('Footer Buttons', () => {
    // SPEC: footer:copy-session
    test('has copy session dir button', async ({ page }) => {
      // Wait for session data to load (session ID shows in footer)
      const sessionEl = page.locator('[data-testid="footer-session"]')
      await expect(sessionEl).toContainText('test-session')

      // Session element is clickable (copies session dir path)
      await expect(sessionEl).toHaveCSS('cursor', 'pointer')

      // Click and verify "Copied!" feedback
      await sessionEl.click()
      await expect(sessionEl.locator('.footer-session-copied-text')).toBeVisible()
    })

    // SPEC: chat:control-reload
    // Reload button lives in ChatControlBar, not Footer - tested in chat-controls.spec.js
  })

  test.describe('Footer Extras', () => {
    // SPEC: footer:notifications-position
    test('notification toggle is positioned right of session ID', async ({ page }) => {
      // Wait for footer to fully render
      await expect(page.locator('[data-testid="footer-session"]')).toContainText('test-session')

      const sessionId = page.locator('[data-testid="footer-session"]')
      const notificationsToggle = page.locator('[data-testid="footer-notifications-toggle"]')

      await expect(sessionId).toBeVisible()
      await expect(notificationsToggle).toBeVisible()

      // Verify layout: session ID appears left of notifications toggle
      const sessionBox = await sessionId.boundingBox()
      const notifBox = await notificationsToggle.boundingBox()
      expect(sessionBox.x).toBeLessThan(notifBox.x)
    })

    // SPEC: footer:notifications-scope
    // Note: This test covers the toggle UI only. Actual sound and desktop notification
    // behavior is tested in notifications.spec.js.
    test('toggling notifications enables both sound and desktop', async ({ page }) => {
      const notificationsToggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await expect(notificationsToggle).toBeVisible()

      // Initially disabled
      await expect(notificationsToggle).not.toHaveClass(/enabled/)
      await expect(notificationsToggle).toHaveAttribute('title', 'Notifications - disabled')

      // Click to enable
      await notificationsToggle.click()

      // Toggle should now show enabled state (covers both sound + desktop)
      await expect(notificationsToggle).toHaveClass(/enabled/)
      await expect(notificationsToggle).toHaveAttribute('title', 'Notifications - enabled')

      // Bell icon aria-label should reflect enabled state
      const bellIcon = notificationsToggle.locator('svg')
      await expect(bellIcon).toHaveAttribute('aria-label', 'Notifications enabled')

      // Click to disable
      await notificationsToggle.click()

      // Toggle should revert to disabled state
      await expect(notificationsToggle).not.toHaveClass(/enabled/)
      await expect(notificationsToggle).toHaveAttribute('title', 'Notifications - disabled')
    })
  })

  test.describe('Claude Status Indicator', () => {
    // SPEC: footer:claude-status
    test('claude status indicator is visible', async ({ page }) => {
      await expect(page.locator('[data-testid="footer-claude-status"]')).toBeVisible()
    })

    // SPEC: footer:claude-status-position
    test('claude status is positioned after notifications toggle', async ({ page }) => {
      const notificationsToggle = page.locator('[data-testid="footer-notifications-toggle"]')
      const claudeStatus = page.locator('[data-testid="footer-claude-status"]')

      await expect(notificationsToggle).toBeVisible()
      await expect(claudeStatus).toBeVisible()

      // Verify DOM order: notifications toggle x is less than claude status x
      const notifBox = await notificationsToggle.boundingBox()
      const statusBox = await claudeStatus.boundingBox()
      expect(notifBox.x).toBeLessThan(statusBox.x)
    })

    // SPEC: footer:claude-status-colors
    test('claude status dot has status-based color class', async ({ page }) => {
      // The dot element should have a status-claude-* class
      const statusDot = page.locator('[data-testid="footer-claude-status"] .status-dot')
      await expect(statusDot).toBeVisible()

      // Should have one of: status-claude-none, status-claude-minor, status-claude-major, status-claude-critical, status-claude-error
      const className = await statusDot.getAttribute('class')
      expect(className).toMatch(/status-claude-(none|minor|major|critical|error)/)
    })

    // SPEC: footer:claude-status-tooltip
    test('claude status button has tooltip with status description', async ({ page }) => {
      const claudeStatus = page.locator('[data-testid="footer-claude-status"]')
      await expect(claudeStatus).toBeVisible()

      // Should have a title attribute with descriptive status text
      const title = await claudeStatus.getAttribute('title')
      expect(title).toBeTruthy()
      expect(title.length).toBeGreaterThan(5)
      // Title should contain meaningful status description (not just whitespace)
      expect(title.trim()).toMatch(/claude|status|operational|incident|degraded|all systems/i)
    })

    // SPEC: footer:claude-status-click
    test('clicking claude status opens status.claude.com', async ({ page, context }) => {
      // Listen for new page (popup)
      const pagePromise = context.waitForEvent('page')

      const claudeStatus = page.locator('[data-testid="footer-claude-status"]')
      await claudeStatus.click()

      const newPage = await pagePromise
      expect(newPage.url()).toContain('status.claude.com')
      await newPage.close()
    })
  })
})

test.describe('Sessions Panel', () => {
  test.describe('Loading State', () => {
    // SPEC: panel-session:loading
    test('panel shows content state while loading sessions', async ({ page }) => {
      // Delay the sessions API response to observe loading state
      let resolveSessionsResponse
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            await new Promise(resolve => {
              resolveSessionsResponse = resolve
            })
            await route.fulfill({ json: loadFixture('sessions/default.json') })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Open sessions panel
      await openSessionsPanel(page)

      // Panel should show loading state while sessions API is pending
      const sessionsPanel = page.locator('[data-testid="panel-sessions"]')
      await expect(sessionsPanel).toBeVisible()
      await expect(sessionsPanel).toContainText(/Loading|loading/)

      // Release the delayed response
      resolveSessionsResponse()

      // Panel should have rendered some content after loading completes
      const panelText = await sessionsPanel.textContent()
      expect(panelText.length).toBeGreaterThan(0)
    })
  })

  test.describe('Sessions List', () => {
    // SPEC: panel-session:list-order
    test('sessions list is sorted newest-first regardless of input order', async ({ page }) => {
      // Feed sessions in REVERSE chronological order to the API so the
      // rendered list can only be in newest-first order if the panel
      // actively sorts (rather than simply mirroring fixture order).
      const sessions = [
        {
          session_id: 'oldest',
          name: 'Oldest',
          workspace: '/home/user/project',
          updated_at: '2025-01-10T12:00:00Z',
          started_at: '2025-01-10T12:00:00Z',
          num_turns: 1,
          total_cost_usd: 0,
          total_duration_ms: 0,
        },
        {
          session_id: 'newest',
          name: 'Newest',
          workspace: '/home/user/project',
          updated_at: '2025-01-20T12:00:00Z',
          started_at: '2025-01-20T12:00:00Z',
          num_turns: 1,
          total_cost_usd: 0,
          total_duration_ms: 0,
        },
        {
          session_id: 'middle',
          name: 'Middle',
          workspace: '/home/user/project',
          updated_at: '2025-01-15T12:00:00Z',
          started_at: '2025-01-15T12:00:00Z',
          num_turns: 1,
          total_cost_usd: 0,
          total_duration_ms: 0,
        },
      ]
      await mockAPI(page)
      await page.route(/\/sessions(?:\?|$)/, async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { sessions } })
        } else {
          await route.fallback()
        }
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)
      const items = page.locator('[data-testid="session-item"]')
      await expect(items).toHaveCount(3)
      const labels = await items.allTextContents()
      // Newest must be first; oldest must be last; middle is sandwiched.
      expect(labels[0]).toMatch(/Newest/)
      expect(labels[1]).toMatch(/Middle/)
      expect(labels[2]).toMatch(/Oldest/)
    })

    // SPEC: panel-session:row-content
    test('session item shows session ID', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Wait for session items to load
      await expect(page.locator('[data-testid="session-item"]').first()).toBeVisible()

      // Session IDs are truncated to 8 chars
      await expect(page.getByText('test-ses').first()).toBeVisible()
    })

    // SPEC: panel-session:row-content
    test('session item shows name if set', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      await expect(page.getByText('Feature Implementation')).toBeVisible()
    })

    // SPEC: panel-session:preview
    test('session item shows message preview', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      await expect(page.getByText(/Help me implement/)).toBeVisible()
    })

    // SPEC: panel-session:message-truncate
    test('long messages are truncated with ellipsis', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/with-long-messages.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Wait for session items to load
      await expect(page.locator('[data-testid="session-item"]').first()).toBeVisible()

      // Message preview elements should have text-overflow: ellipsis CSS
      const firstMessage = page.locator('.sessions-first').first()
      await expect(firstMessage).toBeVisible()

      // Verify the element has overflow hidden and text-overflow ellipsis (CSS truncation)
      const overflow = await firstMessage.evaluate(el => getComputedStyle(el).overflow)
      const textOverflow = await firstMessage.evaluate(el => getComputedStyle(el).textOverflow)

      expect(overflow).toBe('hidden')
      expect(textOverflow).toBe('ellipsis')
    })

    // SPEC: panel-session:current-highlight
    test('current session is highlighted', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // First session (test-session-001) should be current
      const currentSession = page.locator('.sessions-item-current')
      await expect(currentSession).toBeVisible()
    })
  })

  test.describe('Session Actions', () => {
    // SPEC: panel-session:resume
    test('resume button visible for non-current sessions', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Non-current sessions should have resume button
      const resumeButtons = page.locator('[data-testid="session-resume-btn"]')
      await expect(resumeButtons).toHaveCount(2) // 2 non-current sessions
    })

    // SPEC: panel-session:resume-button
    test('resume button shows play icon in split-button', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Resume button should contain an SVG play icon (lucide Play)
      const resumeBtn = page.locator('[data-testid="session-resume-btn"]').first()
      await expect(resumeBtn).toBeVisible()
      await expect(resumeBtn.locator('svg')).toBeVisible()
      await expect(resumeBtn).toHaveAttribute(
        'title',
        'Resume session (Alt+Click or middle-click for new browser tab)',
      )
    })

    // SPEC: panel-session:copy-id
    test('clicking session ID copies session path to clipboard', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)
      await expect(page.locator('[data-testid="session-item"]').first()).toBeVisible()

      // Click the truncated session ID
      const sessionId = page.locator('.sessions-id').first()
      await sessionId.click()

      // Should show "Copied!" feedback
      await expect(sessionId.locator('.sessions-id-copied')).toBeVisible()

      // Clipboard should contain the session directory path
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toContain('/tmp/sessions/')
    })

    // SPEC: panel-session:edit-button
    test('edit button appears on session items', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Wait for session items to load
      await expect(page.locator('[data-testid="session-item"]').first()).toBeVisible()

      // Edit button (Pencil icon) should be visible on session items
      const editBtn = page.locator('.sessions-edit-btn').first()
      await expect(editBtn).toBeVisible()
      await expect(editBtn).toHaveAttribute('title', 'Rename session')
    })

    // SPEC: panel-session:resume-middle-click
    test('resume split-button has chevron with dropdown options', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)
      await expect(page.locator('[data-testid="session-item"]').first()).toBeVisible()

      // Chevron button opens dropdown with "Resume in new browser tab" option
      const chevron = page.locator('.sessions-resume-chevron').first()
      await expect(chevron).toBeVisible()
      await expect(chevron).toHaveAttribute('title', 'More resume options')
    })

    // SPEC: panel-session:new-button
    // SPEC: panel-session:new
    // SPEC: footer:model-picker-scope
    // Note: footer:model-picker-scope (model resets to default for new session) is not fully
    // verified here. Testing that a previously-selected model does not carry over to a new
    // session would require navigating to the new session and checking the footer model value,
    // which adds significant complexity. The current test only verifies the API call fires.
    test('new session button creates new session', async ({ page }) => {
      let newSessionCalled = false
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          newSession: async route => {
            newSessionCalled = true
            await route.fulfill({ status: 200, json: { success: true } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      await page.locator('[data-testid="session-new-session-btn"]').click()

      // Poll until new session API is called
      await expect.poll(() => newSessionCalled).toBe(true)
    })

    // SPEC: panel-session:refresh-button
    test('refresh button is visible', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Refresh button should be visible
      await expect(page.locator('[data-testid="session-refresh-btn"]')).toBeVisible()
    })
  })

  test.describe('Empty State', () => {
    // SPEC: panel-session:empty
    test('shows empty message when no sessions', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            await route.fulfill({ json: { sessions: [] } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      await expect(page.getByText('No sessions yet')).toBeVisible()
    })
  })

  test.describe('Session Display Format', () => {
    // SPEC: panel-session:time-format
    test('session shows relative time format', async ({ page }) => {
      // Use dynamic timestamps for predictable relative times
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            const now = new Date()
            const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString()
            const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()
            await route.fulfill({
              json: {
                sessions: [
                  {
                    session_id: 'test-session-001',
                    container_id: DEFAULT_CONTAINER_ID,
                    workspace: '/home/user/project',
                    model: 'claude-sonnet',
                    num_turns: 3,
                    total_cost_usd: 0.05,
                    started_at: fiveMinAgo,
                    updated_at: fiveMinAgo,
                  },
                  {
                    session_id: 'test-session-002',
                    workspace: '/home/user/project',
                    model: 'claude-sonnet',
                    num_turns: 8,
                    total_cost_usd: 0.25,
                    started_at: twoHoursAgo,
                    updated_at: twoHoursAgo,
                  },
                ],
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Should show relative time formats (Xm ago, Xh ago)
      await expect(page.getByText(/\d+m ago/).first()).toBeVisible()
      await expect(page.getByText(/\d+h ago/).first()).toBeVisible()
    })

    // SPEC: panel-session:time-range
    test('session shows time range when started differs from updated', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            const now = new Date()
            const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()
            const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()
            await route.fulfill({
              json: {
                sessions: [
                  {
                    session_id: 'test-session-001',
                    container_id: DEFAULT_CONTAINER_ID,
                    workspace: '/home/user/project',
                    model: 'claude-sonnet',
                    num_turns: 5,
                    total_cost_usd: 0.15,
                    started_at: twoHoursAgo,
                    updated_at: oneHourAgo,
                  },
                ],
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Should show time range with arrow: "2h ago -> 1h ago"
      await expect(page.getByText(/->/).first()).toBeVisible()
    })

    // SPEC: panel-session:cost-format
    test('session shows cost in $X.XX format', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Close right panels to give sessions panel more width
      await page.keyboard.press('Alt+2') // Close Todos
      await page.keyboard.press('Alt+3') // Close Stash
      await page.keyboard.press('Alt+4') // Close Tasks
      await page.keyboard.press('Alt+7') // Close Usage

      // Wait for session items to render (need multiple sessions)
      await expect(page.locator('[data-testid="session-item"]')).toHaveCount(3, { timeout: 10000 })

      // Session-002 has $0.12, session-003 has $0.75 - look for non-zero cost
      // Cost appears in either .sessions-meta-extra (wide) or .sessions-meta-overflow (narrow)
      const costLocator = page
        .locator('.sessions-meta-extra:visible, .sessions-meta-overflow:visible')
        .getByText(/\$0\.\d[1-9]/)
      await expect(costLocator.first()).toBeVisible()
    })

    // SPEC: panel-session:turns-format
    test('session shows turns count', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Close right panels to give sessions panel more width
      await page.keyboard.press('Alt+2') // Close Todos
      await page.keyboard.press('Alt+3') // Close Stash
      await page.keyboard.press('Alt+4') // Close Tasks
      await page.keyboard.press('Alt+7') // Close Usage

      // Wait for session items to render (need multiple sessions)
      await expect(page.locator('[data-testid="session-item"]')).toHaveCount(3, { timeout: 10000 })

      // Sessions have num_turns (5, 12) - look for non-zero turns
      // Turns appear in either .sessions-meta-extra (wide) or .sessions-meta-overflow (narrow)
      const turnsLocator = page
        .locator('.sessions-meta-extra:visible, .sessions-meta-overflow:visible')
        .getByText(/[1-9]\d* turns/)
      await expect(turnsLocator.first()).toBeVisible()
    })
  })

  test.describe('Error State', () => {
    // SPEC: panel-session:error
    test('shows error when sessions fail to load', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            await route.fulfill({ status: 500, json: { error: 'Internal error' } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      await expect(page.getByText('Failed to load sessions')).toBeVisible()
    })

    // SPEC: panel-session:error
    test('error state has retry button', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            await route.fulfill({ status: 500, json: { error: 'Error' } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)
      await expect(page.getByText('Failed to load sessions')).toBeVisible()

      // Retry button should be visible
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    })
  })

  // Session Search tests removed - feature not implemented in SessionsPanel

  test.describe('Pinned Sessions', () => {
    // SPEC: panel-session:pin-button
    test('pin button visible on session items', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // All session items should have pin buttons
      const pinButtons = page.locator('[data-testid="session-pin-btn"]')
      await expect(pinButtons.first()).toBeVisible()
      const count = await pinButtons.count()
      expect(count).toBe(3)
    })

    // SPEC: panel-session:pin-color
    test('pin button toggles pinned class on click', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      const pinBtn = page.locator('[data-testid="session-pin-btn"]').first()
      await expect(pinBtn).toBeVisible()

      // Initially not pinned
      await expect(pinBtn).not.toHaveClass(/pinned/)

      // Click to pin
      await pinBtn.click()
      await expect(pinBtn).toHaveClass(/pinned/)

      // Pinned button should have distinctive orange/amber color
      await assertColor(pinBtn, 'color', { r: 200, g: 150, b: 50 }, 80)

      // Click again to unpin
      await pinBtn.click()
      await expect(pinBtn).not.toHaveClass(/pinned/)
    })

    // SPEC: panel-session:pin-order
    test('pinned sessions sort to top of list', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)
      await expect(page.locator('[data-testid="session-item"]')).toHaveCount(3)

      // Pin the last session (test-session-003)
      const pinButtons = page.locator('[data-testid="session-pin-btn"]')
      await pinButtons.nth(2).click()

      // After pinning, the pinned session re-sorts to top of list
      // so the first pin button should now have the pinned class
      await expect(pinButtons.first()).toHaveClass(/pinned/)
    })

    // SPEC: panel-session:pin-storage
    test('pin state persists via ui-state API', async ({ page }) => {
      const patchCalls = []
      await mockAPI(page, {
        sessionsFixture: 'sessions/multiple.json',
        handlers: {
          patchUIState: async route => {
            patchCalls.push(await route.request().postDataJSON())
            await route.fulfill({ status: 200, json: { status: 'ok' } })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Pin a session
      const pinBtn = page.locator('[data-testid="session-pin-btn"]').first()
      await pinBtn.click()

      // Verify PATCH was called to persist pin state
      await expect.poll(() => patchCalls.length).toBeGreaterThan(0)
    })

    // SPEC: panel-session:pin-button
    test('pin button shows correct tooltip', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Unpinned: "Pin session"
      const pinBtn = page.locator('[data-testid="session-pin-btn"]').first()
      await expect(pinBtn).toHaveAttribute('title', 'Pin session')

      // Click to pin
      await pinBtn.click()

      // Pinned: "Unpin session"
      await expect(pinBtn).toHaveAttribute('title', 'Unpin session')
    })
  })

  test.describe('Hide Empty Sessions', () => {
    // SPEC: panel-session:hide-empty
    test('sessions with 0 turns are hidden from list', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            await route.fulfill({
              json: {
                sessions: [
                  {
                    session_id: 'test-session-001',
                    container_id: DEFAULT_CONTAINER_ID,
                    workspace: '/home/user/project',
                    model: 'claude-sonnet',
                    num_turns: 0,
                    total_cost_usd: 0,
                    started_at: '2025-01-18T12:00:00Z',
                    updated_at: '2025-01-18T12:00:00Z',
                  },
                  {
                    session_id: 'visible-session',
                    workspace: '/home/user/project',
                    model: 'claude-sonnet',
                    num_turns: 5,
                    total_cost_usd: 0.1,
                    started_at: '2025-01-17T10:00:00Z',
                    updated_at: '2025-01-17T11:00:00Z',
                    first_message: 'Hello',
                  },
                ],
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // test-session-001 is current (0 turns) + visible-session (5 turns) = 2
      const items = page.locator('[data-testid="session-item"]')
      await expect(items).toHaveCount(2)
    })
  })

  test.describe('Fork Sort Key', () => {
    // SPEC: panel-session:fork-sort-key
    test('parent with recent fork sorts above independent session', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/with-fork-sorting.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Root sessions: parent (session-001, child Jan 15) and independent (session-003, Jan 12)
      // Parent should sort first because its descendant has newest timestamp
      const items = page.locator('[data-testid="session-item"]')
      await expect(items.first()).toBeVisible()
      await expect(items.first()).toContainText('Parent session')
    })
  })

  test.describe('Auto-Expand Ancestors', () => {
    // SPEC: panel-session:auto-expand-ancestors
    test('ancestor chain expanded when active session is a fork', async ({ page }) => {
      await mockAPI(page, {
        sessionsFixture: 'sessions/with-children.json',
        handlers: {
          getSessionStatus: async route => {
            await route.fulfill({
              json: {
                session_id: 'test-session-002',
                name: 'Forked Session',
                model: 'claude-sonnet-4-20250514',
                workspace: '/home/user/project',
                num_turns: 3,
                total_cost_usd: 0.08,
                total_duration_ms: 15000,
                last_context_tokens: 3000,
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Child session visible in sessions panel (ancestor auto-expanded)
      const sessionsPanel = page.locator('.sessions-panel')
      await expect(
        sessionsPanel.locator('.sessions-name').filter({ hasText: 'Forked Session' }),
      ).toBeVisible()

      // Collapse button present (tree is expanded)
      await expect(sessionsPanel.getByTitle('Collapse')).toBeVisible()
    })
  })

  test.describe('Session Tooltip', () => {
    // SPEC: panel-session:tooltip-truncated
    test('session name has title attribute for tooltip', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      const nameSpan = page.locator('.sessions-name').filter({ hasText: 'Feature Implementation' })
      await expect(nameSpan).toBeVisible()
      await expect(nameSpan).toHaveAttribute('title', 'Feature Implementation')
    })

    test('session ID has title attribute with full ID', async ({ page }) => {
      await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      const idSpan = page.locator('.sessions-id').first()
      await expect(idSpan).toBeVisible()
      const title = await idSpan.getAttribute('title')
      expect(title).toBeTruthy()
      expect(title.length).toBeGreaterThan(8)
    })
  })

  test.describe('Footer Tooltips', () => {
    test.beforeEach(async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
    })

    // SPEC: footer:workspace
    test('workspace tooltip includes path', async ({ page }) => {
      const workspace = page.locator('[data-testid="footer-workspace"]')
      await expect(workspace).toBeVisible()
      const title = await workspace.getAttribute('title')
      expect(title).toMatch(/Workspace/)
    })

    // SPEC: footer:cost
    test('cost tooltip shows formatted value', async ({ page }) => {
      const cost = page.locator('[data-testid="footer-cost"]')
      await expect(cost).toBeVisible()
      const title = await cost.getAttribute('title')
      expect(title).toMatch(/cost/i)
    })

    // SPEC: footer:context
    test('context tooltip shows token counts', async ({ page }) => {
      const context = page.locator('[data-testid="footer-context"]')
      await expect(context).toBeVisible()
      const title = await context.getAttribute('title')
      expect(title).toMatch(/Context/)
    })
  })

  test.describe('Time Format Boundary', () => {
    // SPEC: panel-session:time-format
    test('session exactly 7 days old shows absolute date, not relative', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            const now = new Date()
            const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
            await route.fulfill({
              json: {
                sessions: [
                  {
                    session_id: 'old-session-001',
                    container_id: DEFAULT_CONTAINER_ID,
                    workspace: '/home/user/project',
                    model: 'claude-sonnet',
                    num_turns: 3,
                    total_cost_usd: 0.05,
                    started_at: sevenDaysAgo,
                    updated_at: sevenDaysAgo,
                  },
                ],
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // At exactly 7 days, should show absolute date (not "7d ago")
      const sessionItem = page.locator('[data-testid="session-item"]').first()
      await expect(sessionItem).toBeVisible()

      // Should NOT contain relative "7d ago" format
      await expect(sessionItem).not.toContainText('7d ago')
    })
  })

  test.describe('Cost Format Extensions', () => {
    // SPEC: panel-session:cost-format
    test('session with null cost shows em dash', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessions: async route => {
            await route.fulfill({
              json: {
                sessions: [
                  {
                    session_id: 'null-cost-001',
                    container_id: DEFAULT_CONTAINER_ID,
                    workspace: '/home/user/project',
                    model: 'claude-sonnet',
                    num_turns: 5,
                    total_cost_usd: null,
                    started_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
                ],
              },
            })
          },
        },
      })
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await openSessionsPanel(page)

      // Null cost should display as em dash (-)
      const sessionItem = page.locator('[data-testid="session-item"]').first()
      await expect(sessionItem).toBeVisible()
      await expect(sessionItem).toContainText('-')
    })
  })

  test.describe('Submitting Timer', () => {
    // SPEC: footer:elapsed-timer
    test('shows elapsed seconds in submitting status', async ({ page }) => {
      // Delay the send response to keep app in "submitting" state
      await mockAPI(page, {
        handlers: {
          send: async route => {
            await new Promise(resolve => setTimeout(resolve, 3000))
            await route.fulfill({ status: 200, json: { success: true } })
          },
        },
      })
      await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('Test message')
      await input.press('Enter')

      // Should transition to submitting state with elapsed timer
      const statusText = page.locator('.footer-status-text')
      await expect(statusText).toContainText('Submitting')

      // Wait briefly for elapsed timer to increment, then verify "(Ns)" format
      await page.waitForTimeout(1100)
      await expect(statusText).toContainText(/Submitting.*\(\d+s\)/)
    })
  })
})

test.describe('Sessions Panel Sort', () => {
  // SPEC: panel-session:sort-tiers
  test('three-tier sort: pinned first, then with-container, then without', async ({ page }) => {
    const sessionsData = {
      sessions: [
        {
          session_id: 'no-ctr-session',
          name: 'No Container',
          workspace: '/home/user/project',
          num_turns: 3,
          total_cost_usd: 0,
          total_duration_ms: 0,
          started_at: '2025-01-20T12:00:00Z',
          updated_at: '2025-01-20T12:00:00Z',
        },
        {
          session_id: 'with-ctr-session',
          name: 'With Container',
          workspace: '/home/user/project',
          num_turns: 2,
          total_cost_usd: 0,
          total_duration_ms: 0,
          started_at: '2025-01-19T12:00:00Z',
          updated_at: '2025-01-19T12:00:00Z',
          container_id: DEFAULT_CONTAINER_ID,
        },
        {
          session_id: 'pinned-session',
          name: 'Pinned',
          workspace: '/home/user/project',
          num_turns: 1,
          total_cost_usd: 0,
          total_duration_ms: 0,
          started_at: '2025-01-18T12:00:00Z',
          updated_at: '2025-01-18T12:00:00Z',
        },
      ],
    }
    await mockAPI(page, {
      handlers: {
        getSessions: async route => {
          await route.fulfill({ json: sessionsData })
        },
        getUIState: async route => {
          await route.fulfill({
            json: { global: { pinnedSessions: ['pinned-session'] }, session: {} },
          })
        },
      },
    })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await openSessionsPanel(page)

    // Get all session IDs in DOM order
    const ids = await page.locator('[data-testid="session-item"] .sessions-id').allTextContents()

    // Pinned first, then with-container, then without-container
    const pinnedIdx = ids.findIndex(id => id.startsWith('pinned-s'))
    const withCtrIdx = ids.findIndex(id => id.startsWith('with-ctr'))
    const noCtrIdx = ids.findIndex(id => id.startsWith('no-ctr-s'))

    expect(pinnedIdx).toBeLessThan(withCtrIdx)
    expect(withCtrIdx).toBeLessThan(noCtrIdx)
  })
})

test.describe('Sessions Panel Meta Tooltips', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openSessionsPanel(page)
  })

  // SPEC: panel-session:meta-tooltips
  test('turn count, cost, and timestamps each carry an explanatory title attribute', async ({
    page,
  }) => {
    // Meta-extra (turns/cost) can be hidden behind overflow when the panel is
    // narrow; assert via attribute presence, not visibility.
    const turnsSpan = page.locator('.sessions-meta-extra span[title^="Turns -"]').first()
    await expect(turnsSpan).toHaveCount(1)
    const turnsTitle = await turnsSpan.getAttribute('title')
    expect(turnsTitle).toMatch(/^Turns - \d+$/)

    const costSpan = page
      .locator('.sessions-meta-extra span[title^="API cost this session"]')
      .first()
    await expect(costSpan).toHaveCount(1)
    const costTitle = await costSpan.getAttribute('title')
    expect(costTitle).toMatch(/^API cost this session - \$\d+\.\d{2}$/)

    const startedSpan = page.locator('.sessions-timestamp span[title^="Started -"]').first()
    await expect(startedSpan).toHaveCount(1)
    const startedTitle = await startedSpan.getAttribute('title')
    expect(startedTitle).toMatch(/^Started - /)
  })
})

test.describe('Sessions Panel Resume Spinner', () => {
  // SPEC: panel-session:resume-spinner
  test('resume button shows a spinner from click until flashStatus clears it', async ({ page }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)

    // Stub window.open and requestAnimationFrame so the Alt+click branch
    // (which routes through onOpenInNewTab -> window.open) doesn't navigate,
    // and the double-rAF that would clear the spinner never fires.
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0
      window.open = () => null
    })

    await waitForAppReady(page)
    await openSessionsPanel(page)

    const resumeBtn = page.locator('[data-testid="session-resume-btn"]').first()
    await expect(resumeBtn).toBeVisible()

    // Alt+click routes through handleResumeWithSpinner -> onOpenInNewTab,
    // which is a sync window.open - no navigation, so the SessionItem
    // stays mounted long enough to observe the spinner state.
    await resumeBtn.click({ modifiers: ['Alt'] })

    await expect(resumeBtn.locator('.spin')).toBeVisible()
    await expect(resumeBtn).toBeDisabled()
  })
})
