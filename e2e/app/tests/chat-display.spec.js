/** E2E tests for chat display including turns, timestamps, collapsible content, and control bar. */

import { expect, test } from '@playwright/test'
import {
  assertRedColor,
  disableAutoCollapse,
  openLiveSession,
  openLiveSessionWithAPI,
  openSession,
  openSessionWithAPI,
  openWithNoSession,
  sendFinishedTurn,
  waitForStableScrollHeight,
} from '../helpers.js'
import { mockAPI } from '../mocks/api.js'

async function openFirstTurn(page) {
  await openSession(page, 'events/simple-chat.jsonl')
  const turn = page.locator('.turn-container').first()

  return {
    turn,
    collapsible: turn.locator('.turn-meta-collapsible'),
    turnContent: turn.locator('.turn-content'),
  }
}

async function openFallbackTurns(page) {
  await openSession(page, 'events/chat-collapsed-preview-fallback.jsonl')
  await disableAutoCollapse(page)

  return page.locator('.turn-container')
}

async function openAfterOneTurn(page, reply = 'Hi there') {
  const controller = await openLiveSession(page)
  await sendFinishedTurn(controller, reply)

  return controller
}

async function startRename(page) {
  await openSession(page, 'events/simple-chat.jsonl')
  const controlBar = page.locator('.panel-control-bar')
  await controlBar.locator('button[title="Rename session"]').click()

  return controlBar
}

async function openStdoutBlock(page) {
  await openSession(page, 'events/user-message-with-command-output.jsonl')
  const stdoutBlock = page.locator('.local-command-stdout').first()
  await expect(stdoutBlock).toBeVisible()

  return stdoutBlock
}

async function openCollapsedPreview(page, fixture) {
  await openSession(page, fixture)
  const turn = page.locator('.turn-container').first()
  await turn.locator('.turn-collapse-btn, .turn-meta-collapsible').first().click()
  const preview = turn.locator('.turn-preview')
  await expect(preview).toBeVisible()

  return preview
}

test.describe('Chat Display', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
  })

  test.describe('Empty State', () => {
    // SPEC: chat:empty-state
    test('shows empty state when no messages', async ({ page }) => {
      await openSession(page, 'events/empty.jsonl')

      await expect(page.getByText('Waiting for messages...')).toBeVisible()
    })
  })

  test.describe('Turn Grouping', () => {
    // SPEC: chat:turns
    test('groups messages into turns', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const turn = page.locator('.turn-container').first()
      await expect(turn).toBeVisible()

      await expect(page.getByText('Hello Claude').first()).toBeVisible()
      await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()
    })
  })

  test.describe('Windowed Rendering', () => {
    // SPEC: chat:virtualized-render
    test('only the turns near the viewport are present in the page', async ({ page }) => {
      await openSession(page, 'events/long-conversation.jsonl')
      await expect(page.locator('.turn-container').first()).toBeVisible()

      const counts = await page.evaluate(() => ({
        rendered: document.querySelectorAll('[data-testid="turn-container"]').length,
        userMessages: document.querySelectorAll('[data-testid="message-user"]').length,
      }))

      // The fixture holds 16 turns; only a bounded window of them is built.
      expect(counts.rendered).toBeGreaterThan(0)
      expect(counts.rendered).toBeLessThan(16)
      expect(counts.userMessages).toBeLessThan(16)
    })

    // SPEC: chat:virtualized-render
    test('the list keeps its full scroll height while windowed', async ({ page }) => {
      await openSession(page, 'events/long-conversation.jsonl')
      await expect(page.locator('.turn-container').first()).toBeVisible()

      const { scrollHeight, clientHeight } = await page.evaluate(() => {
        const c = document.querySelector('.chat-messages')
        return { scrollHeight: c.scrollHeight, clientHeight: c.clientHeight }
      })

      // Scrollable well beyond one viewport even though most turns are absent.
      expect(scrollHeight).toBeGreaterThan(clientHeight * 2)
    })

    // SPEC: chat:offscreen-turns-absent
    test('scrolling to the top brings the earliest turn into the page', async ({ page }) => {
      await openSession(page, 'events/long-conversation.jsonl')
      await expect(page.locator('.turn-container').first()).toBeVisible()
      // Wait for streamed turns to finish rendering before scrolling - otherwise the settle
      // loop's own scroll-to-bottom can undo the scrollTop=0 write below under load.
      await waitForStableScrollHeight(page.locator('.chat-messages'))

      // The first turn starts out windowed away.
      await expect(page.getByText('Hello', { exact: true })).toHaveCount(0)

      await page.evaluate(() => {
        document.querySelector('.chat-messages').scrollTop = 0
      })

      await expect(page.getByText('Hello', { exact: true }).first()).toBeVisible()
    })
  })

  test.describe('Completion Indicators', () => {
    // SPEC: turn:progress-complete
    test('completed turn shows success indicator', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      await expect(page.locator('.turn-progress-complete').first()).toBeVisible()
      await expect(page.locator('.turn-progress-complete').first()).toContainText('✓')
    })

    // SPEC: chat:duration-badge
    test('completed turn shows duration badge', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      await expect(page.locator('.turn-duration').first()).toBeVisible()
    })
  })

  test.describe('Duration Display', () => {
    // SPEC: chat:duration-badge
    test('duration badge ticks live while a turn is responding', async ({ page }) => {
      // Drive SSE into the "responding" state (streaming assistant block, no result event);
      // the duration badge must render and tick over time.
      const controller = await openLiveSessionWithAPI(page)

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
      await openSession(page, 'events/chat-with-duration.jsonl')

      // 5200ms -> "5s"
      const durationText = await page.locator('.turn-duration').first().textContent()
      expect(durationText).toMatch(/^\d+s$/)
    })

    // SPEC: chat:duration-format
    test('duration formatted as minutes and seconds', async ({ page }) => {
      await openSession(page, 'events/chat-with-duration-minutes.jsonl')

      // 83000ms -> "1m 23s"
      const durationText = await page.locator('.turn-duration').first().textContent()
      expect(durationText).toBe('1m 23s')
    })

    // SPEC: chat:duration-format
    test('duration formatted as hours, minutes, and seconds', async ({ page }) => {
      await openSession(page, 'events/chat-with-duration-hours.jsonl')

      // 3912000ms -> "1h 5m 12s"
      const durationText = await page.locator('.turn-duration').first().textContent()
      expect(durationText).toBe('1h 5m 12s')
    })

    // SPEC: chat:completed-duration
    test('completed turn shows static final duration', async ({ page }) => {
      await openSession(page, 'events/chat-with-duration.jsonl')

      await expect(page.locator('.turn-progress-complete').first()).toBeVisible()

      const duration1 = await page.locator('.turn-duration').first().textContent()

      await expect
        .poll(async () => {
          const duration2 = await page.locator('.turn-duration').first().textContent()
          return duration1 === duration2
        })
        .toBe(true)
    })

    // SPEC: chat:pending-opacity
    test('working turn rendered at reduced opacity', async ({ page }) => {
      await openLiveSessionWithAPI(page)

      // Submit a message to create an optimistic pending turn
      const input = page.locator('[data-testid="chat-input"]')
      await expect(input).toBeEnabled()
      await input.fill('Test pending message')
      await input.press('Enter')

      const pendingTurn = page.locator('.turn-container.pending')
      await expect(pendingTurn).toBeVisible()
      const opacity = await pendingTurn.evaluate(el => getComputedStyle(el).opacity)
      expect(parseFloat(opacity)).toBeLessThan(1)
    })
  })

  test.describe('Collapsible Turns', () => {
    // SPEC: turn:collapsible
    test('click chevron collapses turn', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const turn = page.locator('.turn-container').first()
      await expect(turn).toBeVisible()

      const collapsible = turn.locator('.turn-meta-collapsible')
      await expect(collapsible).toBeVisible()

      const turnContent = turn.locator('.turn-content')
      await expect(turnContent).toBeVisible()

      await collapsible.click()

      await expect(turnContent).not.toBeVisible()
    })

    // SPEC: turn:collapsible
    test('click chevron again expands turn', async ({ page }) => {
      const { collapsible, turnContent } = await openFirstTurn(page)

      await collapsible.click()
      await expect(turnContent).not.toBeVisible()

      await collapsible.click()
      await expect(turnContent).toBeVisible()
    })

    // SPEC: turn:collapsed-content
    test('collapsed turn shows preview', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const turn = page.locator('.turn-container').first()
      const collapsible = turn.locator('.turn-meta-collapsible')

      await collapsible.click()

      const preview = turn.locator('.turn-preview')
      await expect(preview).toBeVisible()

      await expect(preview).toContainText('Hello! How can I help you today?')
      const previewText = await preview.textContent()
      expect(previewText.trim().length).toBeGreaterThan(3)
    })

    // SPEC: turn:collapse-css
    test('collapsed content stays in DOM but is visually hidden (preserves Ctrl+F)', async ({
      page,
    }) => {
      const { collapsible, turnContent } = await openFirstTurn(page)

      await collapsible.click()

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
      const { turn, collapsible, turnContent } = await openFirstTurn(page)

      await collapsible.click()
      await expect(turnContent).not.toBeVisible()

      const preview = turn.locator('.turn-preview')
      await preview.click()

      await expect(turnContent).toBeVisible()
    })
  })

  test.describe('Message Timestamps', () => {
    // SPEC: chat:timestamp
    test('timestamp visible on turn', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const timestamp = page.locator('.turn-timestamp').first()
      await expect(timestamp).toBeVisible()
    })

    // SPEC: chat:timestamp-format
    test('timestamp shows relative or date format', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const timestamp = page.locator('.turn-timestamp').first()
      const timestampText = await timestamp.textContent()

      // Matches relative format (just now, Xm/Xh/Xd ago) or date format for older timestamps
      // (M/D/YYYY or similar).
      const validPattern = /^(just now|\d+[mhd] ago|\d{1,2}\/\d{1,2}\/\d{4})$/
      expect(timestampText.trim()).toMatch(validPattern)
    })

    // SPEC: chat:timestamp-live
    test('a finished turn and its user message keep their times up', async ({ page }) => {
      await page.clock.install({ time: Date.parse('2025-01-18T12:00:02Z') })
      await openSession(page, 'events/simple-chat.jsonl')

      await page.clock.fastForward('10:00')

      await expect(page.locator('.turn-timestamp').first()).toHaveText('10m ago')
      await expect(page.locator('[data-testid="message-user-timestamp"]').first()).toHaveText(
        '10m ago',
      )
    })

    // SPEC: chat:timestamp
    test('timestamp positioned right of duration', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const duration = page.locator('.turn-duration').first()
      const timestamp = page.locator('.turn-timestamp').first()

      await expect(duration).toBeVisible()
      await expect(timestamp).toBeVisible()

      const durationBox = await duration.boundingBox()
      const timestampBox = await timestamp.boundingBox()

      expect(timestampBox.x).toBeGreaterThan(durationBox.x)
    })

    // SPEC: chat:timestamp-no-hover
    test('no special hover effects on timestamp', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const timestamp = page.locator('.turn-timestamp').first()
      await expect(timestamp).toBeVisible()

      await timestamp.hover()

      // Timestamp has no interactive hover effects of its own: no underline, no background
      // change, no distinct cursor. Those are inherited from the clickable parent row.
      const styles = await timestamp.evaluate(el => {
        const s = window.getComputedStyle(el)
        return { textDecoration: s.textDecorationLine || s.textDecoration, bg: s.backgroundColor }
      })

      expect(styles.textDecoration).not.toContain('underline')
      expect(styles.bg).toBe('rgba(0, 0, 0, 0)')
    })
  })

  test.describe('User message timestamp', () => {
    const userTimestamp = page =>
      page.locator('[data-testid="message-user"] [data-testid="message-user-timestamp"]').first()

    // SPEC: chat:user-timestamp
    test('a sent message shows when it was sent, styled and placed like the turn timestamp', async ({
      page,
    }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const stamp = userTimestamp(page)
      await expect(stamp).toBeVisible()
      expect((await stamp.textContent()).trim()).toMatch(
        /^(just now|\d+[mhd] ago|\d{1,2}\/\d{1,2}\/\d{4})$/,
      )
      const sent = await page.evaluate(() => new Date('2025-01-18T12:00:00Z').toLocaleString())
      await expect(stamp).toHaveAttribute('title', sent)

      const agent = page.locator('.turn-timestamp').first()
      const style = el => {
        const s = getComputedStyle(el)
        return { fontSize: s.fontSize, color: s.color }
      }
      expect(await stamp.evaluate(style)).toEqual(await agent.evaluate(style))
      const offset = (el, bubble) =>
        el.getBoundingClientRect().top - el.closest(bubble).getBoundingClientRect().top
      const userOffset = await stamp.evaluate(offset, '[data-testid="message-user"]')
      const agentOffset = await agent.evaluate(offset, '[data-testid="message-assistant"]')
      expect(Math.abs(userOffset - agentOffset)).toBeLessThanOrEqual(1)
    })

    // SPEC: chat:user-timestamp-layout
    test('hover buttons sit left of the timestamp, in their usual order', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const bubble = page.locator('[data-testid="message-user"]').first()
      await bubble.hover()
      const stampBox = await userTimestamp(page).boundingBox()
      const copyBox = await bubble.locator('.message-copy-btn').boundingBox()
      const bookmarkBox = await bubble.locator('.message-bookmark-btn').boundingBox()
      expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(stampBox.x)
      expect(bookmarkBox.x + bookmarkBox.width).toBeLessThanOrEqual(copyBox.x)
    })

    // SPEC: chat:user-timestamp-layout
    test('a long first line wraps before the timestamp; a short message stays one line', async ({
      page,
    }) => {
      await openSession(page, 'events/user-timestamp-long.jsonl')

      const stampBox = await userTimestamp(page).boundingBox()
      const overlaps = await page
        .locator('[data-testid="message-user"] .message-content')
        .first()
        .evaluate((el, box) => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return [...range.getClientRects()].some(
            r =>
              r.width > 0 &&
              r.left < box.x + box.width &&
              r.right > box.x &&
              r.top < box.y + box.height &&
              r.bottom > box.y,
          )
        }, stampBox)
      expect(overlaps).toBe(false)
    })

    // SPEC: chat:user-timestamp-pending
    test('a message not yet confirmed shows no timestamp', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')
      await expect(userTimestamp(page)).toBeVisible()

      const input = page.locator('[data-testid="chat-input"]')
      await input.fill('A second question')
      await input.press('Enter')

      const pending = page.locator('[data-testid="message-user"]', { hasText: 'A second question' })
      await expect(pending).toBeVisible()
      await expect(pending.locator('[data-testid="message-user-timestamp"]')).toHaveCount(0)
    })
  })

  test.describe('Chat Control Bar', () => {
    // SPEC: chat:control-bar
    test('control bar present at top of chat panel', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const controlBar = page.locator('.panel-control-bar')
      await expect(controlBar).toBeVisible()

      const chatPanel = page.locator('[data-testid="panel-chat"]')
      await expect(chatPanel.locator('.panel-control-bar')).toBeVisible()
    })

    // SPEC: chat:control-bar
    test('control bar contains expected buttons', async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')

      const controlBar = page.locator('.panel-control-bar')

      // Should have control buttons including: pin, rename, reload, compact, session-prompt,
      // minimap, prev, next, autoscroll
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
      await openSession(page, 'events/simple-chat.jsonl')

      const controlBar = page.locator('.panel-control-bar')
      const renameBtn = controlBar.locator('button[title="Rename session"]')
      await expect(renameBtn).toBeVisible()
    })

    // SPEC: chat:control-rename
    test('rename button disabled when no session', async ({ page }) => {
      await openWithNoSession(page, 'events/empty.jsonl')

      const controlBar = page.locator('.panel-control-bar')
      const renameBtn = controlBar.locator('button[title="Rename session"]')
      await expect(renameBtn).toBeDisabled()
    })

    // SPEC: chat:control-rename
    test('clicking rename button enters edit mode', async ({ page }) => {
      const controlBar = await startRename(page)

      const input = controlBar.locator('.chat-control-edit-input')
      await expect(input).toBeVisible()

      await expect(controlBar.locator('button[title="Save"]')).toBeVisible()
      await expect(controlBar.locator('button[title="Cancel"]')).toBeVisible()
    })

    // SPEC: chat:control-rename
    test('escape cancels edit mode', async ({ page }) => {
      const controlBar = await startRename(page)
      await expect(controlBar.locator('.chat-control-edit-input')).toBeVisible()

      await page.keyboard.press('Escape')

      await expect(controlBar.locator('button[title="Rename session"]')).toBeVisible()
      await expect(controlBar.locator('.chat-control-edit-input')).not.toBeVisible()
    })

    // SPEC: chat:control-rename
    test('cancel button exits edit mode', async ({ page }) => {
      const controlBar = await startRename(page)
      await expect(controlBar.locator('.chat-control-edit-input')).toBeVisible()

      await controlBar.locator('button[title="Cancel"]').click()

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
      const controlBar = await startRename(page)
      const input = controlBar.locator('.chat-control-edit-input')
      await expect(input).toBeVisible()

      await input.fill('New Session Name')
      await page.keyboard.press('Enter')

      await expect.poll(() => updateCalled).toBe(true)
      expect(updatePayload.name).toBe('New Session Name')

      await expect(controlBar.locator('button[title="Rename session"]')).toBeVisible()
    })
  })

  test.describe('Chat Control Bar Fork', () => {
    test.beforeEach(async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')
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
      // Hold the fork API open to observe in-flight UI: icon swaps to a spinning Loader2
      // and both buttons disable.
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

      // Mid-flight: spin icon present, both buttons disabled. Loader2 renders as <svg class="spin">.
      await expect(controlBar.locator('.chat-control-fork-split svg.spin')).toBeVisible({
        timeout: 3000,
      })
      await expect(forkBtn).toBeDisabled()
      await expect(chevron).toBeDisabled()

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
      await openSession(page, 'events/simple-chat.jsonl')

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
      await openSessionWithAPI(page, 'events/responding.jsonl')

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
      await openSession(page, 'events/chat-with-duration.jsonl')

      // Fixture start time is 2025-01-18T12:00:00Z (1705600000000); end time is 12:00:05Z
      // (1705600005200).
      const timestamp = page.locator('.turn-timestamp').first()
      await expect(timestamp).toBeVisible()

      // title = new Date(startTime).toLocaleString(), where startTime is Math.min of assistant
      // turn event timestamps (12:00:01).
      const titleAttr = await timestamp.getAttribute('title')

      // Reflects the assistant turn start (12:00:01), not the end (12:00:05); the user message
      // at 12:00:00 is a separate turn, excluded from this calculation.
      const startDate = new Date(1737201601000).toLocaleString()
      expect(titleAttr).toBe(startDate)
    })

    // SPEC: chat:timestamp-source
    test('duration title also reflects start time', async ({ page }) => {
      await openSession(page, 'events/chat-with-duration.jsonl')

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
      const preview = await openCollapsedPreview(page, 'events/chat-with-markdown.jsonl')

      const previewText = await preview.locator('.turn-preview-text').textContent()
      expect(previewText).not.toContain('**')
      expect(previewText).not.toContain('`')
      expect(previewText).not.toContain('# ')
    })

    // SPEC: turn:preview-strip-markdown
    test('collapsed preview contains readable content from bold text', async ({ page }) => {
      const preview = await openCollapsedPreview(page, 'events/chat-with-markdown.jsonl')

      const previewText = await preview.locator('.turn-preview-text').textContent()
      expect(previewText).toContain('bold text')
      expect(previewText).toContain('inline code')
    })

    // SPEC: turn:preview-keeps-angle-brackets
    test('collapsed preview keeps a comparison written with angle brackets', async ({ page }) => {
      const preview = await openCollapsedPreview(page, 'events/chat-preview-angle-brackets.jsonl')

      await expect(preview.locator('.turn-preview-text')).toHaveText('if a < b and c > d then')
    })
  })

  test.describe('Collapsed Turn With No Strippable Text', () => {
    async function collapseAndMeasure(turn) {
      await turn.locator('.turn-meta-collapsible').click()

      const preview = turn.locator('.turn-preview')
      await expect(preview).toBeVisible()
      const previewText = (await preview.locator('.turn-preview-text').textContent()).trim()
      const turnBox = await turn.locator('.turn').boundingBox()
      const metaBox = await turn.locator('.turn-meta').boundingBox()

      return { previewText, turnBox, metaBox }
    }

    // SPEC: turn:collapsed-preview-fallback
    test('a code-only reply stands the same height as a prose reply, preview non-empty', async ({
      page,
    }) => {
      const turns = await openFallbackTurns(page)
      const prose = await collapseAndMeasure(turns.nth(0))
      const codeOnly = await collapseAndMeasure(turns.nth(1))

      expect(codeOnly.previewText.length).toBeGreaterThan(0)
      expect(Math.abs(codeOnly.turnBox.height - prose.turnBox.height)).toBeLessThan(5)
      // The button group's bottom edge stays inside the turn's own bottom edge.
      expect(codeOnly.metaBox.y + codeOnly.metaBox.height).toBeLessThanOrEqual(
        codeOnly.turnBox.y + codeOnly.turnBox.height,
      )
    })

    // SPEC: turn:collapsed-preview-fallback
    test('a table-only reply stands the same height as a prose reply, preview non-empty', async ({
      page,
    }) => {
      const turns = await openFallbackTurns(page)
      const prose = await collapseAndMeasure(turns.nth(0))
      const tableOnly = await collapseAndMeasure(turns.nth(2))

      expect(tableOnly.previewText.length).toBeGreaterThan(0)
      expect(Math.abs(tableOnly.turnBox.height - prose.turnBox.height)).toBeLessThan(5)
      expect(tableOnly.metaBox.y + tableOnly.metaBox.height).toBeLessThanOrEqual(
        tableOnly.turnBox.y + tableOnly.turnBox.height,
      )
    })

    // SPEC: turn:collapsed-preview-fallback
    test('an alt-less image-only reply stands the same height as a prose reply, preview non-empty', async ({
      page,
    }) => {
      const turns = await openFallbackTurns(page)
      const prose = await collapseAndMeasure(turns.nth(0))
      const imageOnly = await collapseAndMeasure(turns.nth(3))

      expect(imageOnly.previewText.length).toBeGreaterThan(0)
      expect(Math.abs(imageOnly.turnBox.height - prose.turnBox.height)).toBeLessThan(5)
      expect(imageOnly.metaBox.y + imageOnly.metaBox.height).toBeLessThanOrEqual(
        imageOnly.turnBox.y + imageOnly.turnBox.height,
      )
    })

    // SPEC: turn:collapsed-preview-fallback
    test('an ordinary prose reply is unaffected by the fallback path', async ({ page }) => {
      const turns = await openFallbackTurns(page)

      const prose = await collapseAndMeasure(turns.nth(0))
      expect(prose.previewText).toBe('Hello! How can I help you today?')
    })
  })

  test.describe('Local Command Output', () => {
    // SPEC: tool:localcmd
    // SPEC: tool:localcmd-expanded
    test('stdout renders as collapsible block expanded by default', async ({ page }) => {
      const stdoutBlock = await openStdoutBlock(page)

      await expect(stdoutBlock.locator('.local-command-content')).toBeVisible()
      await expect(stdoutBlock.locator('.local-command-content')).toContainText('Hello from stdout')
    })

    // SPEC: tool:localcmd-header
    test('stdout block shows terminal icon and label', async ({ page }) => {
      const stdoutBlock = await openStdoutBlock(page)

      await expect(stdoutBlock.locator('.local-command-header')).toContainText('stdout')
    })

    // SPEC: tool:localcmd-stderr
    test('stderr renders with red/warning styling', async ({ page }) => {
      await openSession(page, 'events/user-message-with-command-output.jsonl')

      const stderrBlock = page.locator('.local-command-stderr').first()
      await expect(stderrBlock).toBeVisible()

      await expect(stderrBlock).toContainText('Error: Something went wrong')
      await expect(stderrBlock.locator('.local-command-header')).toContainText('stderr')
      await assertRedColor(stderrBlock.locator('.local-command-header'), 'color')
    })

    // SPEC: tool:localcmd-strip-tags
    test('no raw XML tags visible', async ({ page }) => {
      await openSession(page, 'events/user-message-with-command-output.jsonl')

      const pageContent = await page.textContent('body')
      expect(pageContent).not.toContain('<local-command-stdout>')
      expect(pageContent).not.toContain('</local-command-stdout>')
      expect(pageContent).not.toContain('<local-command-stderr>')
      expect(pageContent).not.toContain('</local-command-stderr>')
    })

    // SPEC: tool:localcmd
    test('click header collapses content', async ({ page }) => {
      const stdoutBlock = await openStdoutBlock(page)

      await expect(stdoutBlock.locator('.local-command-content')).toBeVisible()

      await stdoutBlock.locator('.local-command-header').click()

      await expect(stdoutBlock.locator('.local-command-content')).not.toBeVisible()

      await stdoutBlock.locator('.local-command-header').click()
      await expect(stdoutBlock.locator('.local-command-content')).toBeVisible()
    })

    // SPEC: tool:localcmd
    test('multiple command blocks render all segments', async ({ page }) => {
      await openSession(page, 'events/user-message-with-command-output.jsonl')

      // Third turn has consecutive stdout + stderr blocks
      const turns = page.locator('.turn-container')

      await expect(turns).toHaveCount(3)

      const thirdTurn = turns.nth(2)
      await expect(thirdTurn.locator('.local-command-stdout')).toBeVisible()
      await expect(thirdTurn.locator('.local-command-stderr')).toBeVisible()

      await expect(thirdTurn.locator('.local-command-stdout')).toContainText('stdout content')
      await expect(thirdTurn.locator('.local-command-stderr')).toContainText('stderr content')
    })

    // SPEC: tool:localcmd
    test('non-human text blocks fully wrapped in command tags render as LocalCommandBlock', async ({
      page,
    }) => {
      await openSession(page, 'events/nonhuman-text-with-command-output.jsonl')
      await disableAutoCollapse(page)

      // First turn: non-human user text fully wrapped in stdout tag
      const firstTurn = page.locator('.turn-container').nth(0)
      const stdoutBlock = firstTurn.locator('.local-command-stdout')
      await expect(stdoutBlock).toBeVisible()
      await expect(stdoutBlock.locator('.local-command-header')).toContainText('stdout')
      await expect(stdoutBlock.locator('.local-command-content')).toContainText('Hello from stdout')

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
      await openSession(page, 'events/chat-with-attachments.jsonl')

      await expect(page.getByText('Check this image')).toBeVisible()

      const img = page.locator('.message-attachment-thumb')
      await expect(img).toBeVisible()
      await expect(img).toHaveAttribute('alt', 'photo.png')

      await expect(page.locator('.message-attachment-ext', { hasText: 'PDF' })).toBeVisible()
      await expect(
        page.locator('.message-attachment-name', { hasText: 'report.pdf' }),
      ).toBeVisible()

      await expect(
        page.getByText('I can see the image and the PDF document.').first(),
      ).toBeVisible()
    })
  })

  test.describe('Chat Control Bar Extras', () => {
    test.beforeEach(async ({ page }) => {
      await openSession(page, 'events/simple-chat.jsonl')
    })

    // SPEC: chat:control-minimap
    test('minimap toggle button exists in control bar', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      await expect(controlBar).toBeVisible()

      const minimapToggle = controlBar.locator('[data-testid="control-minimap-toggle"]')
      await expect(minimapToggle).toBeVisible()
    })

    // SPEC: chat:control-nav-separator
    test('separator exists between navigation and minimap toggle', async ({ page }) => {
      const controlBar = page.locator('.panel-control-bar')
      await expect(controlBar).toBeVisible()

      // Separator lives in the right group (second panel-control-group).
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
      // First turn with default model
      const controller = await openAfterOneTurn(page)

      // Model change event (non-init: has previous_model)
      await controller.sendEvent({
        type: 'system',
        subtype: 'model_changed',
        model: 'claude-opus-5',
        previous_model: 'claude-sonnet-5',
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

      await expect(page.locator('[data-testid="setting-change-divider"]')).toBeVisible()
    })

    // SPEC: turn:effort-change-divider
    test('shows divider when effort level changes between turns', async ({ page }) => {
      // First turn
      const controller = await openAfterOneTurn(page, 'Hi')

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

      const divider = page.locator('[data-testid="setting-change-divider"]')
      await expect(divider).toBeVisible()
      await expect(divider).toContainText('Effort')
    })

    // SPEC: turn:container-restart-divider
    test('shows "Restarted" divider when container_restarted event arrives mid-stream', async ({
      page,
    }) => {
      // First turn (makes the session non-pristine)
      const controller = await openAfterOneTurn(page)

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

    // SPEC: turn:runtime-mismatch-divider
    test('shows a runtime-mismatch warning divider when the session was created under a different runtime', async ({
      page,
    }) => {
      const controller = await openAfterOneTurn(page)

      await controller.sendEvent({
        type: 'system',
        subtype: 'container_restarted',
        message_data: { runtime_mismatch: { persisted: 'LangGraph', expected: 'Claude' } },
        timestamp: Date.now() + 300,
        turn_id: 'turn_001',
      })

      const divider = page.locator('[data-testid="setting-change-divider"]')
      await expect(divider).toBeVisible()
      await expect(divider).toContainText('Runtime mismatch')
      await expect(divider).toContainText('Claude')
      await expect(divider).toContainText('LangGraph')
    })

    /** Stream one turn, then `between` as system events, then a second turn. */
    async function streamAround(page, between) {
      const controller = await openLiveSession(page)
      const at = Date.now()
      const turn = (id, text, offset) => [
        {
          type: 'user',
          subtype: 'text',
          content: text,
          is_human: true,
          timestamp: at + offset,
          turn_id: id,
        },
        { type: 'assistant', subtype: 'text', content: `re: ${text}`, timestamp: at + offset + 1 },
        { type: 'result', subtype: 'success', timestamp: at + offset + 2 },
      ]
      await controller.sendEvents(turn('turn_001', 'first ask', 0))
      await controller.sendEvents(
        between.map((e, i) => ({
          type: 'system',
          timestamp: at + 10 + i,
          turn_id: 'turn_001',
          ...e,
        })),
      )
      await controller.sendEvents(turn('turn_002', 'second ask', 100))
      await expect(page.getByText('re: second ask')).toBeVisible()
    }

    // SPEC: turn:divider-run-merged
    test('back-to-back dividers are merged into one line naming each change once', async ({
      page,
    }) => {
      await streamAround(page, [
        { subtype: 'container_restarted' },
        { subtype: 'container_restarted' },
        { subtype: 'model_changed', model: 'model-first-pick', previous_model: 'model-start' },
        { subtype: 'model_changed', model: 'model-final-pick', previous_model: 'model-first-pick' },
        { subtype: 'effort_level_changed', content: 'high', previous_effort_level: 'medium' },
      ])

      const dividers = page.locator('[data-testid="setting-change-divider"]')
      await expect(dividers).toHaveCount(1)
      const text = await dividers.textContent()
      expect(text.match(/Restarted/g)).toHaveLength(1)
      expect(text).toContain('model-final-pick')
      expect(text).not.toContain('model-first-pick')
      expect(text).toMatch(/Effort: high/i)
    })

    // SPEC: turn:divider-run-merged
    test('a fork divider keeps its own line, apart from the change after it', async ({ page }) => {
      await streamAround(page, [
        {
          subtype: 'container_restarted',
          message_data: { fork_parent_session_id: 'parent-session' },
        },
        { subtype: 'model_changed', model: 'model-after-fork', previous_model: 'model-start' },
      ])

      const dividers = page.locator('[data-testid="setting-change-divider"]')
      await expect(dividers).toHaveCount(2)
      await expect(dividers.first()).toContainText('Forked from')
      await expect(dividers.first()).not.toContainText('model-after-fork')
      await expect(dividers.last()).toHaveText('model-after-fork')
    })
  })
})
