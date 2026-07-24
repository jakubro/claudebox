/** E2E tests for chat display including turns, timestamps, collapsible content, and control bar. */

import { expect, test } from '@playwright/test'
import { assertRedColor, disableAutoCollapse, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Chat Display', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Empty State', () => {
    // SPEC: chat:empty-state
    test('shows empty state when no messages', async ({ page }) => {
      await mockSSE(page, 'events/empty.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Should show empty state message
      await expect(page.getByText('Waiting for messages...')).toBeVisible()
    })
  })

  test.describe('Turn Grouping', () => {
    // SPEC: chat:turns
    test('groups messages into turns', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Should have turn container with user + assistant messages
      const turn = page.locator('.turn-container').first()
      await expect(turn).toBeVisible()

      // Turn should contain both user and assistant content
      await expect(page.getByText('Hello Claude').first()).toBeVisible()
      await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()
    })
  })

  test.describe('Lazy Paint', () => {
    // SPEC: chat:lazy-paint
    test('turns use content-visibility for off-screen paint skipping', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turn = page.locator('.turn-container').first()
      await expect(turn).toBeVisible()

      // Browser opts the turn into off-screen paint skipping via the
      // content-visibility property. Verify the computed style is 'auto'
      // (the contract - without it, large sessions stall on initial paint).
      const cv = await turn.evaluate(el => getComputedStyle(el).contentVisibility)
      expect(cv).toBe('auto')

      // contain-intrinsic-size reserves a placeholder height so the
      // scrollbar doesn't jump as off-screen turns materialize. Assert
      // the height token is present (value tracked in CSS, not asserted
      // pixel-exact here - pure presence is the contract).
      const intrinsic = await turn.evaluate(el => getComputedStyle(el).containIntrinsicSize)
      expect(intrinsic).toMatch(/\d+px/)
    })

    // SPEC: chat:lazy-paint
    test('off-screen turn text stays in the DOM so browser find still works', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // The whole point of content-visibility:auto (vs display:none /
      // virtualization) is that off-screen content stays addressable.
      // Verify the assistant text is findable via DOM query regardless
      // of viewport position - same surface Cmd-F uses.
      const text = await page
        .locator('.turn-container')
        .first()
        .locator('text=Hello! How can I help you today?')
        .count()
      expect(text).toBeGreaterThan(0)
    })
  })

  test.describe('Completion Indicators', () => {
    // SPEC: turn:progress-complete
    test('completed turn shows success indicator', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for turn to complete (result event has been received)
      // Should show completion indicator with checkmark
      await expect(page.locator('.turn-progress-complete').first()).toBeVisible()
      // Check it contains checkmark
      await expect(page.locator('.turn-progress-complete').first()).toContainText('✓')
    })

    // SPEC: chat:duration-badge
    test('completed turn shows duration badge', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Duration badge should be visible on completed turn
      await expect(page.locator('.turn-duration').first()).toBeVisible()
    })
  })

  test.describe('Duration Display', () => {
    // SPEC: chat:duration-badge
    test('duration badge ticks live while a turn is responding', async ({ page }) => {
      // Drive the SSE stream so the turn enters the "responding" state with
      // a streaming assistant block but no result event. The duration badge
      // must render and tick over time.
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const baseTs = Date.now() - 2000
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Tell me a story',
          timestamp: baseTs,
          ts: new Date(baseTs).toISOString(),
          turn_id: 'turn_dur',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Once upon a time...',
          timestamp: baseTs + 100,
          ts: new Date(baseTs + 100).toISOString(),
          turn_id: 'turn_dur',
        },
      ])

      // Wait for the assistant block to render - confirms responding state.
      await expect(page.getByText('Once upon a time...').first()).toBeVisible()

      const badge = page.locator('.turn-duration').first()
      await expect(badge).toBeVisible({ timeout: 5000 })

      const t0 = (await badge.textContent())?.trim()
      expect(t0, 'initial badge value').toBeTruthy()
      // Poll for a tick (badge text changes from the initial sample).
      await expect
        .poll(async () => (await badge.textContent())?.trim(), { timeout: 5000 })
        .not.toBe(t0)
    })

    // SPEC: chat:duration-format
    test('duration formatted as seconds', async ({ page }) => {
      await mockSSE(page, 'events/chat-with-duration.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // 5200ms -> "5s"
      const durationText = await page.locator('.turn-duration').first().textContent()
      expect(durationText).toMatch(/^\d+s$/)
    })

    // SPEC: chat:duration-format
    test('duration formatted as minutes and seconds', async ({ page }) => {
      await mockSSE(page, 'events/chat-with-duration-minutes.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // 83000ms -> "1m 23s"
      const durationText = await page.locator('.turn-duration').first().textContent()
      expect(durationText).toBe('1m 23s')
    })

    // SPEC: chat:duration-format
    test('duration formatted as hours, minutes, and seconds', async ({ page }) => {
      await mockSSE(page, 'events/chat-with-duration-hours.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // 3912000ms -> "1h 5m 12s"
      const durationText = await page.locator('.turn-duration').first().textContent()
      expect(durationText).toBe('1h 5m 12s')
    })

    // SPEC: chat:completed-duration
    test('completed turn shows static final duration', async ({ page }) => {
      await mockSSE(page, 'events/chat-with-duration.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for completion
      await expect(page.locator('.turn-progress-complete').first()).toBeVisible()

      // Duration should be static (not ticking) - capture value and verify it stays same
      const duration1 = await page.locator('.turn-duration').first().textContent()

      // Poll to verify duration stays the same after 1+ second
      await expect
        .poll(async () => {
          const duration2 = await page.locator('.turn-duration').first().textContent()
          return duration1 === duration2
        })
        .toBe(true)
    })

    // SPEC: chat:pending-opacity
    test('working turn rendered at reduced opacity', async ({ page }) => {
      await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Submit a message to create an optimistic pending turn
      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeEnabled()
      await input.fill('Test pending message')
      await input.press('Enter')

      // Pending turn should render at reduced opacity per SPEC
      const pendingTurn = page.locator('.turn-container.pending')
      await expect(pendingTurn).toBeVisible()
      const opacity = await pendingTurn.evaluate(el => getComputedStyle(el).opacity)
      expect(parseFloat(opacity)).toBeLessThan(1)
    })
  })

  test.describe('Collapsible Turns', () => {
    // SPEC: turn:collapsible
    test('click chevron collapses turn', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turn = page.locator('.turn-container').first()
      await expect(turn).toBeVisible()

      // Find collapse button (chevron)
      const collapsible = turn.locator('.turn-meta-collapsible')
      await expect(collapsible).toBeVisible()

      // Initially expanded - content should be visible
      const turnContent = turn.locator('.turn-content')
      await expect(turnContent).toBeVisible()

      // Click to collapse
      await collapsible.click()

      // Content should now be hidden
      await expect(turnContent).not.toBeVisible()
    })

    // SPEC: turn:collapsible
    test('click chevron again expands turn', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turn = page.locator('.turn-container').first()
      const collapsible = turn.locator('.turn-meta-collapsible')
      const turnContent = turn.locator('.turn-content')

      // Collapse
      await collapsible.click()
      await expect(turnContent).not.toBeVisible()

      // Expand again
      await collapsible.click()
      await expect(turnContent).toBeVisible()
    })

    // SPEC: turn:collapsed-content
    test('collapsed turn shows preview', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turn = page.locator('.turn-container').first()
      const collapsible = turn.locator('.turn-meta-collapsible')

      // Collapse the turn
      await collapsible.click()

      // Preview should appear
      const preview = turn.locator('.turn-preview')
      await expect(preview).toBeVisible()

      // Preview should show assistant's first text line
      await expect(preview).toContainText('Hello! How can I help you today?')
      const previewText = await preview.textContent()
      expect(previewText.trim().length).toBeGreaterThan(3)
    })

    // SPEC: turn:collapse-css
    test('collapsed content stays in DOM but is visually hidden (preserves Ctrl+F)', async ({
      page,
    }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turn = page.locator('.turn-container').first()
      const collapsible = turn.locator('.turn-meta-collapsible')
      const turnContent = turn.locator('.turn-content')

      // Collapse the turn
      await collapsible.click()

      // Content element should still exist in DOM (not removed)
      const contentExists = await turnContent.count()
      expect(contentExists).toBe(1)

      // Verify it's hidden via visibility:hidden + height:0 (keeps content in DOM for Ctrl+F)
      const styles = await turnContent.evaluate(el => {
        const cs = window.getComputedStyle(el)
        return { visibility: cs.visibility, height: cs.height, overflow: cs.overflow }
      })
      expect(styles.visibility).toBe('hidden')
      expect(styles.height).toBe('0px')
    })

    // SPEC: turn:collapsible
    test('click preview expands turn', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turn = page.locator('.turn-container').first()
      const collapsible = turn.locator('.turn-meta-collapsible')
      const turnContent = turn.locator('.turn-content')

      // Collapse first
      await collapsible.click()
      await expect(turnContent).not.toBeVisible()

      // Click preview to expand
      const preview = turn.locator('.turn-preview')
      await preview.click()

      // Content should be visible again
      await expect(turnContent).toBeVisible()
    })
  })

  test.describe('Message Timestamps', () => {
    // SPEC: chat:timestamp
    test('timestamp visible on turn', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Timestamp element should be visible
      const timestamp = page.locator('.turn-timestamp').first()
      await expect(timestamp).toBeVisible()
    })

    // SPEC: chat:timestamp-format
    test('timestamp shows relative or date format', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Get timestamp text
      const timestamp = page.locator('.turn-timestamp').first()
      const timestampText = await timestamp.textContent()

      // Should match relative format (just now, Xm ago, Xh ago, Xd ago)
      // OR date format for older timestamps (M/D/YYYY or similar)
      const validPattern = /^(just now|\d+[mhd] ago|\d{1,2}\/\d{1,2}\/\d{4})$/
      expect(timestampText.trim()).toMatch(validPattern)
    })

    // SPEC: chat:timestamp
    test('timestamp positioned right of duration', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Duration and timestamp should both be visible in header
      const duration = page.locator('.turn-duration').first()
      const timestamp = page.locator('.turn-timestamp').first()

      await expect(duration).toBeVisible()
      await expect(timestamp).toBeVisible()

      // Verify timestamp is positioned after duration (higher x coordinate)
      const durationBox = await duration.boundingBox()
      const timestampBox = await timestamp.boundingBox()

      expect(timestampBox.x).toBeGreaterThan(durationBox.x)
    })

    // SPEC: chat:timestamp-no-hover
    test('no special hover effects on timestamp', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const timestamp = page.locator('.turn-timestamp').first()
      await expect(timestamp).toBeVisible()

      // Hover over timestamp
      await timestamp.hover()

      // Timestamp should not have its own interactive hover effects:
      // no underline, no background change, no distinct cursor override.
      // Note: cursor:pointer and color changes are inherited from parent
      // .turn-meta-collapsible (the entire row is clickable for collapse).
      const styles = await timestamp.evaluate(el => {
        const s = window.getComputedStyle(el)
        return { textDecoration: s.textDecorationLine || s.textDecoration, bg: s.backgroundColor }
      })

      expect(styles.textDecoration).not.toContain('underline')
      expect(styles.bg).toBe('rgba(0, 0, 0, 0)')
    })
  })

  test.describe('Chat Control Bar', () => {
    // SPEC: chat:control-bar
    test('control bar present at top of chat panel', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Control bar element should be visible
      const controlBar = page.locator('.panel-control-bar')
      await expect(controlBar).toBeVisible()

      // Control bar should be inside the chat panel
      const chatPanel = page.locator('[data-testid="panel-chat"]')
      await expect(chatPanel.locator('.panel-control-bar')).toBeVisible()
    })

    // SPEC: chat:control-bar
    test('control bar contains expected buttons', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')

      // Should have control buttons including: pin, rename, reload, compact, session-prompt, minimap, prev, next, autoscroll
      await expect(controlBar.locator('button[title="Rename session"]')).toBeVisible()
      await expect(
        controlBar.locator('button[title="Reload session (picks up config changes)"]'),
      ).toBeVisible()
      await expect(
        controlBar.locator('button[title="Compact conversation (/compact)"]'),
      ).toBeVisible()
      const buttons = controlBar.locator('.panel-control-btn')
      const count = await buttons.count()
      expect(count).toBeGreaterThanOrEqual(9)
    })

    // SPEC: chat:control-rename
    test('rename button visible in control bar', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')
      const renameBtn = controlBar.locator('button[title="Rename session"]')
      await expect(renameBtn).toBeVisible()
    })

    // SPEC: chat:control-rename
    test('rename button disabled when no session', async ({ page }) => {
      await mockAPI(page, {
        handlers: {
          getSessionStatus: async route => {
            // Return minimal status with null session_id but valid workspace
            await route.fulfill({
              json: {
                session_id: null,
                workspace: '/home/user/project',
              },
            })
          },
        },
      })
      await mockSSE(page, 'events/empty.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')
      const renameBtn = controlBar.locator('button[title="Rename session"]')
      await expect(renameBtn).toBeDisabled()
    })

    // SPEC: chat:control-rename
    test('clicking rename button enters edit mode', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')

      // Click rename button
      await controlBar.locator('button[title="Rename session"]').click()

      // Edit input should appear
      const input = controlBar.locator('.chat-control-edit-input')
      await expect(input).toBeVisible()

      // Save and cancel buttons should appear
      await expect(controlBar.locator('button[title="Save"]')).toBeVisible()
      await expect(controlBar.locator('button[title="Cancel"]')).toBeVisible()
    })

    // SPEC: chat:control-rename
    test('escape cancels edit mode', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')

      // Enter edit mode
      await controlBar.locator('button[title="Rename session"]').click()
      await expect(controlBar.locator('.chat-control-edit-input')).toBeVisible()

      // Press Escape
      await page.keyboard.press('Escape')

      // Should return to normal mode
      await expect(controlBar.locator('button[title="Rename session"]')).toBeVisible()
      await expect(controlBar.locator('.chat-control-edit-input')).not.toBeVisible()
    })

    // SPEC: chat:control-rename
    test('cancel button exits edit mode', async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')

      // Enter edit mode
      await controlBar.locator('button[title="Rename session"]').click()
      await expect(controlBar.locator('.chat-control-edit-input')).toBeVisible()

      // Click cancel
      await controlBar.locator('button[title="Cancel"]').click()

      // Should return to normal mode
      await expect(controlBar.locator('button[title="Rename session"]')).toBeVisible()
      await expect(controlBar.locator('.chat-control-edit-input')).not.toBeVisible()
    })

    // SPEC: chat:control-rename
    test('enter saves new name and calls API', async ({ page }) => {
      let updateCalled = false
      let updatePayload = null
      await mockAPI(page, {
        handlers: {
          updateSession: async route => {
            updateCalled = true
            updatePayload = await route.request().postDataJSON()
            await route.fulfill({ status: 200, json: { success: true } })
          },
        },
      })
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')

      // Enter edit mode
      await controlBar.locator('button[title="Rename session"]').click()
      const input = controlBar.locator('.chat-control-edit-input')
      await expect(input).toBeVisible()

      // Type new name and press Enter
      await input.fill('New Session Name')
      await page.keyboard.press('Enter')

      // API should be called with new name
      await expect.poll(() => updateCalled).toBe(true)
      expect(updatePayload.name).toBe('New Session Name')

      // Should return to normal mode
      await expect(controlBar.locator('button[title="Rename session"]')).toBeVisible()
    })
  })

  test.describe('Chat Control Bar Fork', () => {
    test.beforeEach(async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
    })

    // SPEC: chat:control-fork
    test('fork button visible in control bar', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      const forkBtn = controlBar.locator('.chat-control-fork-split .panel-control-btn').first()
      await expect(forkBtn).toBeVisible()
      await expect(forkBtn).toHaveAttribute(
        'title',
        'Fork session (Alt+Click or middle-click for new browser tab)',
      )
    })

    // SPEC: chat:control-fork
    test('fork chevron opens dropdown with two variants', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      const chevron = controlBar.locator('.chat-control-fork-chevron')
      await expect(chevron).toBeVisible()

      await chevron.click()

      const dropdown = controlBar.locator('.chat-control-fork-dropdown')
      await expect(dropdown).toBeVisible()

      const options = dropdown.locator('.dropdown-option')
      await expect(options).toHaveCount(2)
      await expect(options.nth(0)).toHaveText('Fork here')
      await expect(options.nth(1)).toHaveText('Fork in new browser tab')
    })

    // SPEC: chat:control-fork
    test('fork buttons disable + spinner appears while fork is in flight', async ({ page }) => {
      // Hold the fork API open long enough to observe the in-flight UI:
      // icon swaps to a spinning Loader2 and both buttons disable.
      let releaseFork
      const forkHeld = new Promise(resolve => {
        releaseFork = resolve
      })

      // Match the actual fork URL: /api/workspaces/{ws}/sessions/{id}/fork
      await page.route(/\/sessions\/[^/]+\/fork/, async route => {
        await forkHeld
        await route.fulfill({ status: 200, json: { session_id: 'forked-001' } })
      })

      const controlBar = page.locator('.panel-control-bar')
      const forkBtn = controlBar.locator('.chat-control-fork-split .panel-control-btn').first()
      const chevron = controlBar.locator('.chat-control-fork-chevron')

      await forkBtn.click()

      // While the fork is mid-flight: spin icon present, both buttons disabled.
      // Loader2 renders as <svg class="spin">.
      await expect(controlBar.locator('.chat-control-fork-split svg.spin')).toBeVisible({
        timeout: 3000,
      })
      await expect(forkBtn).toBeDisabled()
      await expect(chevron).toBeDisabled()

      // Release the fork response and verify both re-enable.
      releaseFork()
      await expect(forkBtn).toBeEnabled({ timeout: 5000 })
      await expect(chevron).toBeEnabled()
    })

    // SPEC: chat:control-fork-separator
    test('separator exists after fork button', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      const leftGroup = controlBar.locator('.panel-control-group').first()
      const separators = leftGroup.locator('.panel-control-separator')
      // Left group: pin, rename, [sep], reload, compact, fork-split, [sep], session-prompt
      const count = await separators.count()
      expect(count).toBeGreaterThanOrEqual(2)
    })

    // SPEC: chat:fork-full
    test('control bar fork executes directly when agent idle', async ({ page }) => {
      let forkPayload = null
      await mockAPI(page, {
        handlers: {
          forkSession: async route => {
            forkPayload = await route.request().postDataJSON()
            await route.fulfill({ status: 200, json: { session_id: 'forked-session-001' } })
          },
        },
      })
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')
      await controlBar.locator('.chat-control-fork-split .panel-control-btn').first().click()

      // No modal - fork executes directly
      await expect(page.locator('.rewind-modal')).not.toBeVisible()
      await expect.poll(() => forkPayload !== null).toBe(true)
      expect(forkPayload).not.toHaveProperty('turn_id')
    })
  })

  test.describe('Chat Control Bar Fork (agent responding)', () => {
    // SPEC: chat:fork-full
    test('control bar fork shows modal when agent responding', async ({ page }) => {
      await mockAPI(page)
      await mockSSE(page, 'events/responding.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const controlBar = page.locator('.panel-control-bar')
      await controlBar.locator('.chat-control-fork-split .panel-control-btn').first().click()

      const modal = page.locator('.rewind-modal')
      await expect(modal).toBeVisible()
      await expect(modal.locator('.rewind-modal-title')).toHaveText('Fork here?')
      await expect(modal.locator('.rewind-modal-detail')).toContainText(
        'copy of the complete session',
      )
    })
  })

  test.describe('Timestamp Source', () => {
    // SPEC: chat:timestamp-source
    test('timestamp corresponds to turn start time, not end', async ({ page }) => {
      await mockSSE(page, 'events/chat-with-duration.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // The turn-timestamp element should have a title attribute showing the start time
      // Start time from fixture is 2025-01-18T12:00:00Z (timestamp 1705600000000)
      // End time from fixture is 2025-01-18T12:00:05Z (timestamp 1705600005200)
      const timestamp = page.locator('.turn-timestamp').first()
      await expect(timestamp).toBeVisible()

      // The title attribute is set to new Date(startTime).toLocaleString()
      // startTime is Math.min of assistant turn event timestamps = 12:00:01
      const titleAttr = await timestamp.getAttribute('title')

      // Title should reflect the assistant turn start time (12:00:01), not the end (12:00:05)
      // User message at 12:00:00 is a separate turn, not included in this calculation
      const startDate = new Date(1737201601000).toLocaleString()
      expect(titleAttr).toBe(startDate)
    })

    // SPEC: chat:timestamp-source
    test('duration title also reflects start time', async ({ page }) => {
      await mockSSE(page, 'events/chat-with-duration.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // The turn-duration element title should also match start time
      const duration = page.locator('.turn-duration').first()
      await expect(duration).toBeVisible()

      const titleAttr = await duration.getAttribute('title')
      const startDate = new Date(1737201601000).toLocaleString()
      expect(titleAttr).toBe(startDate)
    })
  })

  test.describe('Collapsed Turn Preview Strips Markdown', () => {
    // SPEC: turn:preview-strip-markdown
    test('collapsed preview shows plain text without markdown syntax', async ({ page }) => {
      await mockSSE(page, 'events/chat-with-markdown.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turn = page.locator('.turn-container').first()
      const collapseBtn = turn.locator('.turn-collapse-btn, .turn-meta-collapsible')

      // Collapse the turn
      await collapseBtn.first().click()

      // Preview should appear
      const preview = turn.locator('.turn-preview')
      await expect(preview).toBeVisible()

      // Preview text should not contain markdown syntax characters
      const previewText = await preview.locator('.turn-preview-text').textContent()
      expect(previewText).not.toContain('**')
      expect(previewText).not.toContain('`')
      expect(previewText).not.toContain('# ')
    })

    // SPEC: turn:preview-strip-markdown
    test('collapsed preview contains readable content from bold text', async ({ page }) => {
      await mockSSE(page, 'events/chat-with-markdown.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const turn = page.locator('.turn-container').first()
      const collapseBtn = turn.locator('.turn-collapse-btn, .turn-meta-collapsible')

      // Collapse the turn
      await collapseBtn.first().click()

      // Preview should contain the plain text version of the markdown content
      const preview = turn.locator('.turn-preview')
      await expect(preview).toBeVisible()

      const previewText = await preview.locator('.turn-preview-text').textContent()
      // Should contain the words without markdown formatting
      expect(previewText).toContain('bold text')
      expect(previewText).toContain('inline code')
    })
  })

  test.describe('Local Command Output', () => {
    // SPEC: tool:localcmd
    // SPEC: tool:localcmd-expanded
    test('stdout renders as collapsible block expanded by default', async ({ page }) => {
      await mockSSE(page, 'events/user-message-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Should show stdout block
      const stdoutBlock = page.locator('.local-command-stdout').first()
      await expect(stdoutBlock).toBeVisible()

      // Should be expanded by default (content visible)
      await expect(stdoutBlock.locator('.local-command-content')).toBeVisible()
      await expect(stdoutBlock.locator('.local-command-content')).toContainText('Hello from stdout')
    })

    // SPEC: tool:localcmd-header
    test('stdout block shows terminal icon and label', async ({ page }) => {
      await mockSSE(page, 'events/user-message-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const stdoutBlock = page.locator('.local-command-stdout').first()
      await expect(stdoutBlock).toBeVisible()

      // Should have stdout label in header
      await expect(stdoutBlock.locator('.local-command-header')).toContainText('stdout')
    })

    // SPEC: tool:localcmd-stderr
    test('stderr renders with red/warning styling', async ({ page }) => {
      await mockSSE(page, 'events/user-message-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Should show stderr block
      const stderrBlock = page.locator('.local-command-stderr').first()
      await expect(stderrBlock).toBeVisible()

      // Should contain error message
      await expect(stderrBlock).toContainText('Error: Something went wrong')

      // Should have stderr label
      await expect(stderrBlock.locator('.local-command-header')).toContainText('stderr')

      // Should have red/warning color on the stderr block or its label
      await assertRedColor(stderrBlock.locator('.local-command-header'), 'color')
    })

    // SPEC: tool:localcmd-strip-tags
    test('no raw XML tags visible', async ({ page }) => {
      await mockSSE(page, 'events/user-message-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Raw XML tags should not be visible
      const pageContent = await page.textContent('body')
      expect(pageContent).not.toContain('<local-command-stdout>')
      expect(pageContent).not.toContain('</local-command-stdout>')
      expect(pageContent).not.toContain('<local-command-stderr>')
      expect(pageContent).not.toContain('</local-command-stderr>')
    })

    // SPEC: tool:localcmd
    test('click header collapses content', async ({ page }) => {
      await mockSSE(page, 'events/user-message-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const stdoutBlock = page.locator('.local-command-stdout').first()
      await expect(stdoutBlock).toBeVisible()

      // Initially expanded
      await expect(stdoutBlock.locator('.local-command-content')).toBeVisible()

      // Click header to collapse
      await stdoutBlock.locator('.local-command-header').click()

      // Content should be hidden
      await expect(stdoutBlock.locator('.local-command-content')).not.toBeVisible()

      // Click again to expand
      await stdoutBlock.locator('.local-command-header').click()
      await expect(stdoutBlock.locator('.local-command-content')).toBeVisible()
    })

    // SPEC: tool:localcmd
    test('multiple command blocks render all segments', async ({ page }) => {
      await mockSSE(page, 'events/user-message-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Third turn has consecutive stdout + stderr blocks
      const turns = page.locator('.turn-container')

      // Should have multiple turns
      await expect(turns).toHaveCount(3)

      // Third turn should have both stdout and stderr blocks
      const thirdTurn = turns.nth(2)
      await expect(thirdTurn.locator('.local-command-stdout')).toBeVisible()
      await expect(thirdTurn.locator('.local-command-stderr')).toBeVisible()

      // Content should be present inside the blocks
      await expect(thirdTurn.locator('.local-command-stdout')).toContainText('stdout content')
      await expect(thirdTurn.locator('.local-command-stderr')).toContainText('stderr content')
    })

    // SPEC: tool:localcmd
    test('non-human text blocks fully wrapped in command tags render as LocalCommandBlock', async ({
      page,
    }) => {
      await mockSSE(page, 'events/nonhuman-text-with-command-output.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      await disableAutoCollapse(page)

      // First turn: non-human user text fully wrapped in stdout tag
      const firstTurn = page.locator('.turn-container').nth(0)
      const stdoutBlock = firstTurn.locator('.local-command-stdout')
      await expect(stdoutBlock).toBeVisible()
      await expect(stdoutBlock.locator('.local-command-header')).toContainText('stdout')
      await expect(stdoutBlock.locator('.local-command-content')).toContainText('Hello from stdout')

      // No raw XML tags visible
      const turnContent = await firstTurn.textContent()
      expect(turnContent).not.toContain('<local-command-stdout>')

      // Second turn: non-human user text fully wrapped in stderr tag
      const secondTurn = page.locator('.turn-container').nth(1)
      const stderrBlock = secondTurn.locator('.local-command-stderr')
      await expect(stderrBlock).toBeVisible()
      await expect(stderrBlock.locator('.local-command-header')).toContainText('stderr')
      await expect(stderrBlock.locator('.local-command-content')).toContainText(
        'Error: something failed',
      )
    })
  })

  test.describe('Attachments', () => {
    // SPEC: input:attachment
    test('renders image attachment as thumbnail and non-image with extension badge', async ({
      page,
    }) => {
      await mockSSE(page, 'events/chat-with-attachments.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // User message text should be visible
      await expect(page.getByText('Check this image')).toBeVisible()

      // Image attachment renders as <img> thumbnail
      const img = page.locator('.message-attachment-thumb')
      await expect(img).toBeVisible()
      await expect(img).toHaveAttribute('alt', 'photo.png')

      // Non-image attachment renders with extension badge
      await expect(page.locator('.message-attachment-ext', { hasText: 'PDF' })).toBeVisible()
      await expect(
        page.locator('.message-attachment-name', { hasText: 'report.pdf' }),
      ).toBeVisible()

      // Assistant response is also visible
      await expect(
        page.getByText('I can see the image and the PDF document.').first(),
      ).toBeVisible()
    })
  })

  test.describe('Chat Control Bar Extras', () => {
    test.beforeEach(async ({ page }) => {
      await mockSSE(page, 'events/simple-chat.jsonl')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
    })

    // SPEC: chat:control-minimap
    test('minimap toggle button exists in control bar', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      await expect(controlBar).toBeVisible()

      // Minimap toggle should be the rightmost button in the right group
      const minimapToggle = controlBar.locator('[data-testid="control-minimap-toggle"]')
      await expect(minimapToggle).toBeVisible()
    })

    // SPEC: chat:control-nav-separator
    test('separator exists between navigation and minimap toggle', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      await expect(controlBar).toBeVisible()

      // Separator element should exist in the right group (second panel-control-group)
      const rightGroup = controlBar.locator('.panel-control-group').last()
      const separators = rightGroup.locator('.panel-control-separator')
      await expect(separators.last()).toBeVisible()
    })

    // SPEC: chat:control-rename-separator
    test('separator exists after rename button', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      await expect(controlBar).toBeVisible()

      // Left group: pin, rename, SEPARATOR, reload, compact, SEPARATOR, session prompt
      const leftGroup = controlBar.locator('.panel-control-group').first()
      const separators = leftGroup.locator('.panel-control-separator')
      await expect(separators.first()).toBeVisible()
    })

    // SPEC: chat:control-jump-separator
    test('separator exists after jump-next button', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      await expect(controlBar).toBeVisible()

      // Right group: prev, next, SEPARATOR, scroll-to-bottom, SEPARATOR, minimap
      const rightGroup = controlBar.locator('.panel-control-group').last()
      const separators = rightGroup.locator('.panel-control-separator')
      await expect(separators.first()).toBeVisible()
    })
  })

  test.describe('Setting Change Dividers', () => {
    // SPEC: turn:setting-change-divider
    test('shows divider when model changes between turns', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // First turn with default model
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Hello',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        { type: 'assistant', subtype: 'text', content: 'Hi there', timestamp: Date.now() + 100 },
        { type: 'result', subtype: 'success', timestamp: Date.now() + 200 },
      ])

      // Model change event (non-init: has previous_model)
      await controller.sendEvent({
        type: 'system',
        subtype: 'model_changed',
        model: 'claude-opus-4-6',
        previous_model: 'claude-sonnet-4-6',
        timestamp: Date.now() + 300,
      })

      // Second turn
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Now in opus',
          is_human: true,
          timestamp: Date.now() + 400,
          turn_id: 'turn_002',
        },
        { type: 'assistant', subtype: 'text', content: 'Indeed', timestamp: Date.now() + 500 },
        { type: 'result', subtype: 'success', timestamp: Date.now() + 600 },
      ])

      // Divider should appear between turns
      await expect(page.locator('[data-testid="setting-change-divider"]')).toBeVisible()
    })

    // SPEC: turn:effort-change-divider
    test('shows divider when effort level changes between turns', async ({ page }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // First turn
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Hello',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        { type: 'assistant', subtype: 'text', content: 'Hi', timestamp: Date.now() + 100 },
        { type: 'result', subtype: 'success', timestamp: Date.now() + 200 },
      ])

      // Effort level change event (non-init: has previous_effort_level)
      await controller.sendEvent({
        type: 'system',
        subtype: 'effort_level_changed',
        content: 'high',
        previous_effort_level: 'medium',
        timestamp: Date.now() + 300,
      })

      // Second turn
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Now with high effort',
          is_human: true,
          timestamp: Date.now() + 400,
          turn_id: 'turn_002',
        },
        { type: 'assistant', subtype: 'text', content: 'Indeed', timestamp: Date.now() + 500 },
        { type: 'result', subtype: 'success', timestamp: Date.now() + 600 },
      ])

      // Effort divider should appear with "Effort" label
      const divider = page.locator('[data-testid="setting-change-divider"]')
      await expect(divider).toBeVisible()
      await expect(divider).toContainText('Effort')
    })

    // SPEC: turn:container-restart-divider
    test('shows "Restarted" divider when container_restarted event arrives mid-stream', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // First turn (makes the session non-pristine)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Hello',
          is_human: true,
          timestamp: Date.now(),
          turn_id: 'turn_001',
        },
        { type: 'assistant', subtype: 'text', content: 'Hi there', timestamp: Date.now() + 100 },
        { type: 'result', subtype: 'success', timestamp: Date.now() + 200 },
      ])

      // Container restart event (no fork payload -> plain "Restarted")
      await controller.sendEvent({
        type: 'system',
        subtype: 'container_restarted',
        message_data: null,
        timestamp: Date.now() + 300,
        turn_id: 'turn_001',
      })

      // Second turn after the restart
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          content: 'Still there?',
          is_human: true,
          timestamp: Date.now() + 400,
          turn_id: 'turn_002',
        },
        { type: 'assistant', subtype: 'text', content: 'Yes', timestamp: Date.now() + 500 },
        { type: 'result', subtype: 'success', timestamp: Date.now() + 600 },
      ])

      const divider = page.locator('[data-testid="setting-change-divider"]')
      await expect(divider).toBeVisible()
      await expect(divider).toContainText('Restarted')
    })
  })
})
