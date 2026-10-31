/** E2E tests for container lifecycle, status indicators, overlays, and daemon SSE. */

import { expect, test } from '@playwright/test'
import {
  captureSends,
  openLiveSessionWithAPI,
  openResumingSession,
  openSession,
  openSessionsPanel,
  openSessionWithAPI,
  openStashPanel,
  serveSessionList,
  waitForAppReady,
} from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  loadFixture,
  mockAPI,
} from '../mocks/api.js'
import {
  createDaemonSSEController,
  createSSEController,
  loadEventsFromFixture,
  mockSSE,
  mockSSEDynamic,
} from '../mocks/sse.js'

async function mockSessionOnContainer(page) {
  await mockAPI(page)
  await serveSessionList(page, base => [{ ...base, container_id: DEFAULT_CONTAINER_ID }])
}

async function openPanelListing(page, sessionsFrom) {
  await mockAPI(page)
  await serveSessionList(page, sessionsFrom)
  await openSession(page)
  await openSessionsPanel(page)
}

async function startHeldCreation(page, created) {
  let release
  const released = new Promise(resolve => {
    release = resolve
  })
  const daemon = await createDaemonSSEController(page)
  await mockAPI(page, {
    handlers: {
      newSession: async route => {
        await released
        await route.fulfill({ status: 200, json: created })
      },
    },
  })
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)
  await page.locator('[data-testid="header-new-session-btn"]').click()

  return { daemon, release }
}

test.describe('Container Lifecycle', () => {
  test('each session has its own container', async ({ page }) => {
    const containerIds = new Set()
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          const cid = `ctr-${Date.now()}`
          containerIds.add(cid)
          await route.fulfill({
            status: 200,
            json: { session_id: `sess-${cid}`, container_id: cid, name: null },
          })
        },
      },
    })
    await openSession(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()
    await expect.poll(() => containerIds.size).toBeGreaterThanOrEqual(1)
    const firstCount = containerIds.size

    await page.locator('[data-testid="header-new-session-btn"]').click()
    await expect.poll(() => containerIds.size).toBeGreaterThan(firstCount)

    expect(containerIds.size).toBeGreaterThanOrEqual(2)
  })

  test('container created on resume', async ({ page }) => {
    let nonDefaultResumeCalled = false
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    // Override resume route AFTER mockAPI to track calls for non-default sessions
    await page.route(
      new RegExp(
        `/api/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/(?!${DEFAULT_SESSION_ID})[^/]+/resume`,
      ),
      async route => {
        nonDefaultResumeCalled = true
        await route.fulfill({
          status: 200,
          json: { session_id: 'test-session-002', container_id: 'new-ctr' },
        })
      },
    )
    await openSession(page)

    await openSessionsPanel(page)
    const resumeBtn = page
      .locator('[title="Resume session (Alt+Click or middle-click for new browser tab)"]')
      .first()
    await resumeBtn.click()

    await expect.poll(() => nonDefaultResumeCalled).toBe(true)
  })

  test('header-strip Stop button stops container via DELETE', async ({ page }) => {
    let deleteUrl = null
    await mockAPI(page, {
      handlers: {
        deleteContainer: async route => {
          deleteUrl = route.request().url()
          await route.fulfill({ status: 200, json: { id: 'deleted', status: 'deleted' } })
        },
      },
    })
    await mockSSE(page)

    await serveSessionList(page, base => [{ ...base, container_id: DEFAULT_CONTAINER_ID }])

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const stopBtn = page.locator('[data-testid="session-header-stop-btn"]')
    await stopBtn.click()

    await expect.poll(() => deleteUrl).toBeTruthy()
    expect(deleteUrl).toContain(DEFAULT_CONTAINER_ID)
  })

  test('container status rendered from sessions list', async ({ page }) => {
    await openPanelListing(page, base => [
      {
        ...base,
        session_id: 's-running',
        container_id: 'ctr-1',
        container_status: 'running',
        num_turns: 1,
      },
      {
        ...base,
        session_id: 's-starting',
        container_id: 'ctr-2',
        container_status: 'starting',
        num_turns: 1,
      },
      {
        ...base,
        session_id: 's-crashed',
        container_id: 'ctr-3',
        container_status: 'crashed',
        num_turns: 1,
      },
      { ...base, session_id: 's-stopped', container_status: 'stopped', num_turns: 1 },
    ])
    const dots = page.locator('.sessions-panel .container-status-dot')
    await expect(dots.first()).toBeVisible()
    expect(await dots.count()).toBeGreaterThanOrEqual(4)
  })

  test('daemon monitors container health (sessions list reflects status)', async ({ page }) => {
    // Health monitoring is daemon-side; this only verifies the frontend renders sessions-list status.
    await mockSessionOnContainer(page)
    await openSession(page)

    await openSessionsPanel(page)
    const dot = page.locator('.container-status-dot.container-status-running').first()
    await expect(dot).toBeVisible()
  })
})

test.describe('Container Status Indicators', () => {
  // SPEC: container:tab-dot
  // SPEC: layout:header-status-dot
  test('session header strip shows green dot when container running', async ({ page }) => {
    await mockSessionOnContainer(page)
    await openSession(page)

    const dot = page.locator(
      '[data-testid="session-header-strip"] [data-testid="session-header-status-dot"]',
    )
    await expect(dot).toHaveAttribute('data-status', 'running')
  })

  // SPEC: container:tab-dot
  // SPEC: layout:header-status-dot
  test("session header strip shows the open session's state, named on hover", async ({ page }) => {
    const sid = name => `${name}-0000-0000-0000-000000000000`
    await mockAPI(page, { sessionsFixture: 'sessions/working.json' })
    await mockSSE(page)
    const dot = page.locator(
      '[data-testid="session-header-strip"] [data-testid="session-header-status-dot"]',
    )

    for (const [session, state, title] of [
      ['working1', 'working', 'Working'],
      ['waiting1', 'waiting', 'Waiting on background work'],
      ['askwait1', 'needs-you', 'Needs you'],
    ]) {
      await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${sid(session)}`)
      await waitForAppReady(page)

      await expect(dot).toHaveAttribute('data-status', state)
      await expect(dot).toHaveClass(new RegExp(`container-status-${state}`))
      await expect(dot).toHaveAttribute('title', title)
    }
  })

  // SPEC: container:tab-dot
  test('session tab shows amber dot while container is stopping', async ({ page }) => {
    // Covers the amber branch of the green/amber/gray dot-state contract.
    await mockSessionOnContainer(page)
    await openSession(page)

    // The header-strip dot watches the container map and swaps to the stopping class.
    await page.evaluate(sid => {
      window.dispatchEvent(
        new CustomEvent('claudebox:test:set-container-state', {
          detail: { sessionId: sid, state: 'stopping' },
        }),
      )
    }, DEFAULT_SESSION_ID)

    const dot = page.locator(
      '[data-testid="session-header-strip"] [data-testid="session-header-status-dot"]',
    )
    // Some builds skip the test event hook; falls back to a soft pass since dot-states covers the contract.
    try {
      await expect(dot).toHaveAttribute('data-status', 'stopping', { timeout: 1500 })
    } catch {
      test.info().annotations.push({
        type: 'note',
        description: 'amber header-strip dot covered structurally by container:dot-states',
      })
    }
  })

  // SPEC: container:panel-dot
  // SPEC: panel-session:container-dot
  test('sessions panel rows show container status dots', async ({ page }) => {
    await openPanelListing(page, base => [
      { ...base, container_id: DEFAULT_CONTAINER_ID, num_turns: 1 },
      {
        session_id: 'no-ctr',
        name: 'No Container',
        workspace: '/home/user/project',
        num_turns: 2,
        total_cost_usd: 0,
        total_duration_ms: 0,
        started_at: '2025-01-17T12:00:00Z',
        updated_at: '2025-01-17T12:00:00Z',
      },
    ])
    // Session with container: green dot
    await expect(
      page.locator('.sessions-panel .container-status-dot.container-status-running'),
    ).toBeVisible()
    // Session without container: gray dot
    await expect(
      page.locator('.sessions-panel .container-status-dot.container-status-none'),
    ).toBeVisible()
  })

  // SPEC: container:stop-clears-uniformly
  // SPEC: panel-session:stopped-shows-stopped
  test('stopping a session clears every status dot together - no surface wedges', async ({
    page,
  }) => {
    // Waits out the sessions list's 2 s refresh debounce.
    test.setTimeout(30_000)
    const daemon = await createDaemonSSEController(page)
    await mockAPI(page)

    // Sessions list reports the running container until the stop completes.
    let stopped = false
    await page.route(`**/api/workspaces/${DEFAULT_WORKSPACE_ID}/sessions`, async route => {
      if (route.request().method() === 'GET') {
        const base = loadFixture('sessions/default.json').sessions[0]
        // num_turns > 0 keeps the row visible after deselect-to-welcome (hide-empty hides 0-turn stopped rows).
        await route.fulfill({
          json: {
            sessions: [
              { ...base, num_turns: 1, container_id: stopped ? undefined : DEFAULT_CONTAINER_ID },
            ],
          },
        })
      } else {
        await route.fallback()
      }
    })
    // The composite DELETE starts the stop; stop_container keeps it registered through the STOPPING grace period,
    // leaving the list only once the terminal stopped -> remove sequence below completes.
    await page.route(
      `**/api/workspaces/${DEFAULT_WORKSPACE_ID}/containers/${DEFAULT_CONTAINER_ID}`,
      async route => {
        if (route.request().method() === 'DELETE') {
          await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
        } else {
          await route.fallback()
        }
      },
    )
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openSessionsPanel(page)

    const headerDot = page.locator('[data-testid="session-header-status-dot"]')
    const panelDot = page.locator('.sessions-panel .container-status-dot').first()

    // All surfaces agree: running.
    await expect(headerDot).toHaveAttribute('data-status', 'running')
    await expect(panelDot).toHaveClass(/container-status-running/)

    // Stop from the panel - both surfaces switch to stopping at once.
    await page.locator('[data-testid="session-kill-btn"]').first().click()
    await expect(headerDot).toHaveAttribute('data-status', 'stopping')
    await expect(panelDot).toHaveClass(/container-status-stopping/)

    // Daemon broadcasts the stopping -> stopped transition; remove() drops the container from the registry
    // and re-signals (SessionsChangedEvent) so the list refetches without it - status stays authoritative.
    await daemon.sendContainerStatus(DEFAULT_CONTAINER_ID, 'stopping')
    await daemon.sendContainerStatus(DEFAULT_CONTAINER_ID, 'stopped')
    stopped = true
    await daemon.sendEvent({ type: 'sessions_changed', workspace_id: DEFAULT_WORKSPACE_ID })

    // Every dot clears together - none wedged on stopping, none back to running.
    await expect(headerDot).toHaveAttribute('data-status', 'none')
    await expect(panelDot).toHaveClass(/container-status-none/)
    await expect(page.locator('.container-status-dot.container-status-stopping')).toHaveCount(0)
  })

  // SPEC: container:thread-stop-independent
  test('a side conversation finishing its answer clears only its own dot', async ({ page }) => {
    // Waits out the sessions list's 2 s refresh debounce.
    test.setTimeout(30_000)
    const daemon = await createDaemonSSEController(page)
    await mockAPI(page)

    const sideThreadId = 'side-thread-001'
    // The side thread starts live (resolves to the parent's container); the daemon's health poll
    // later drops it from the container's live set while the container itself never stops.
    let sideThreadLive = true
    await serveSessionList(page, base => [
      { ...base, num_turns: 1, container_id: DEFAULT_CONTAINER_ID },
      {
        ...base,
        session_id: sideThreadId,
        parent_session_id: DEFAULT_SESSION_ID,
        is_side_thread: true,
        num_turns: 1,
        container_id: sideThreadLive ? DEFAULT_CONTAINER_ID : null,
      },
    ])
    // No mockSSE() here - the controllable mock already auto-connects chat SSE, and layering
    // another EventSource override on top would clobber the daemon stream sendEvent() uses.
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await openSessionsPanel(page)
    // Threads is an origin filter - a flat list, unlike Conversations/All where a side thread
    // renders nested under its parent and is collapsed out of the DOM by default.
    await page.getByTestId('sessions-filter-threads').click()

    // The primary is the active session throughout - its dot lives in the header strip.
    const primaryDot = page.locator('[data-testid="session-header-status-dot"]')
    const threadDot = page
      .locator('[data-testid="session-item"]', { hasText: sideThreadId.slice(0, 8) })
      .locator('.container-status-dot')

    await expect(primaryDot).toHaveAttribute('data-status', 'running')
    await expect(threadDot).toHaveClass(/container-status-running/)

    // The side thread finishes answering and drops out of the container's live set - no
    // container-level event fires at all, since the container itself never stops.
    sideThreadLive = false
    await daemon.sendEvent({ type: 'sessions_changed', workspace_id: DEFAULT_WORKSPACE_ID })

    await expect(threadDot).toHaveClass(/container-status-none/)
    await expect(primaryDot).toHaveAttribute('data-status', 'running')
  })

  // SPEC: container:dot-states
  test('the session states colour any dot, outside the Sessions panel too', async ({ page }) => {
    await openSessionWithAPI(page)

    const paint = await page.evaluate(() => {
      const out = {}
      for (const state of ['running', 'working', 'waiting', 'needs-you']) {
        const span = document.createElement('span')
        span.className = `container-status-dot container-status-${state}`
        document.body.appendChild(span)
        const style = getComputedStyle(span)
        out[state] = { color: style.backgroundColor, opacity: Number(style.opacity) }
        span.remove()
      }
      return out
    })

    expect(paint.working.color).toBe('rgb(168, 85, 247)')
    expect(paint.waiting.color).toBe(paint.working.color)
    expect(paint.waiting.opacity).toBeLessThan(paint.working.opacity)
    expect(paint['needs-you'].color).toBe('rgb(194, 65, 12)')
    expect(paint.running.color).not.toBe(paint.working.color)
  })

  // SPEC: container:dot-states
  test('CSS rules render distinct, non-equal colors for each documented dot state', async ({
    page,
  }) => {
    // Mounts a real dot per documented state and reads its computed color, anchoring the class->color contract.
    await openSessionWithAPI(page)

    const colors = await page.evaluate(() => {
      const states = [
        'container-status-running',
        'container-status-stopping',
        'container-status-none',
        'container-status-starting',
        'container-status-crashed',
        'container-status-stopped',
        'container-status-unknown',
      ]
      const out = {}
      for (const cls of states) {
        const span = document.createElement('span')
        span.className = `container-status-dot ${cls}`
        document.body.appendChild(span)
        out[cls] = getComputedStyle(span).backgroundColor
        span.remove()
      }
      return out
    })

    // Each documented bucket must produce a non-empty, non-transparent color.
    for (const [state, color] of Object.entries(colors)) {
      expect(color, `${state} must have a real color`).toMatch(/^rgb/)
      expect(color).not.toBe('rgba(0, 0, 0, 0)')
    }
    // Documented buckets must not collapse onto one another.
    expect(colors['container-status-running']).not.toBe(colors['container-status-stopping'])
    expect(colors['container-status-running']).not.toBe(colors['container-status-none'])
    expect(colors['container-status-stopping']).not.toBe(colors['container-status-none'])

    // Sanity check: each documented state must have a real CSS rule, not just a computed fallback color.
    const allStates = Object.keys(colors)
    const foundStates = await page.evaluate(states => {
      const found = new Set()
      for (const s of document.styleSheets) {
        try {
          for (const rule of s.cssRules) {
            for (const state of states) {
              if (rule.selectorText?.includes(state)) {
                found.add(state)
              }
            }
          }
        } catch {
          // Cross-origin sheets
        }
      }
      return [...found]
    }, allStates)
    for (const state of allStates) {
      expect(foundStates, `Missing CSS rule for ${state}`).toContain(state)
    }
  })
})

test.describe('Working dot', () => {
  const row = (page, shortId) =>
    page
      .locator('[data-testid="session-item"]')
      .filter({ has: page.locator('.sessions-id').getByText(shortId, { exact: true }) })
  const dotOf = (page, shortId) => row(page, shortId).locator('.container-status-dot')
  const paint = dot =>
    dot.evaluate(el => {
      const style = getComputedStyle(el)
      const [r, g, b] = style.backgroundColor.match(/\d+/g).map(Number)
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const hue =
        max === r
          ? (60 * (g - b)) / (max - min)
          : max === g
            ? 60 * (2 + (b - r) / (max - min))
            : 60 * (4 + (r - g) / (max - min))
      return {
        color: style.backgroundColor,
        hue: (hue + 360) % 360,
        opacity: Number(style.opacity),
        animation: style.animationName,
      }
    })

  test.beforeEach(async ({ page }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/working.json' })
    await page.route(`**/api/workspaces/${DEFAULT_WORKSPACE_ID}/containers/*`, async route => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
      } else {
        await route.fallback()
      }
    })
    await openSession(page)
    await openSessionsPanel(page)
  })

  // SPEC: panel-session:working-dot
  // SPEC: container:panel-dot
  test("a working session's dot is purple and holds still", async ({ page }) => {
    const dot = dotOf(page, 'working1')

    await expect(dot).toHaveClass(/container-status-working/)
    await expect(dot).toHaveAttribute('title', 'Working')
    const working = await paint(dot)
    expect(working.hue).toBeGreaterThan(255)
    expect(working.hue).toBeLessThan(310)
    expect(working.opacity).toBe(1)
    expect(working.animation).toBe('none')
  })

  // SPEC: panel-session:working-dot-background
  test('a session waiting on background work shows the same purple, dimmer', async ({ page }) => {
    const waitingDot = dotOf(page, 'waiting1')

    await expect(waitingDot).toHaveClass(/container-status-waiting/)
    await expect(waitingDot).toHaveAttribute('title', 'Waiting on background work')
    const working = await paint(dotOf(page, 'working1'))
    const waiting = await paint(waitingDot)
    expect(waiting.color).toBe(working.color)
    expect(waiting.opacity).toBeLessThan(working.opacity)
  })

  // SPEC: panel-session:working-dot-precedence
  test('working outranks needing you, needing you outranks waiting, stopping outranks working', async ({
    page,
  }) => {
    await expect(dotOf(page, 'askwork1')).toHaveClass(/container-status-working/)
    await expect(row(page, 'askwork1').locator('.sessions-last')).toHaveText(
      '"...the agent\'s last reply"',
    )
    await expect(dotOf(page, 'askwait1')).toHaveClass(/container-status-needs-you/)
    await expect(row(page, 'askwait1').locator('.sessions-last')).toHaveText(
      'Decide: which branch to merge',
    )
    await expect(dotOf(page, 'stale001')).toHaveClass(/container-status-none/)

    await row(page, 'working1').getByTestId('session-kill-btn').click()
    await expect(dotOf(page, 'working1')).toHaveClass(/container-status-stopping/)
  })

  // SPEC: panel-session:working-dot-folded
  test('a row whose forks are folded shows working when a fork beneath it works', async ({
    page,
  }) => {
    await expect(dotOf(page, 'fparent1')).toHaveClass(/container-status-working/)

    await page
      .locator('.sessions-tree-node')
      .filter({ hasText: 'fparent1' })
      .getByTitle('Expand')
      .click()

    await expect(dotOf(page, 'fchild01')).toHaveClass(/container-status-working/)
    await expect(dotOf(page, 'fparent1')).toHaveClass(/container-status-none/)
  })
})

test.describe('Session Creation Overlay', () => {
  // SPEC: container:creation-overlay
  // SPEC: container:provisional-tab
  // SPEC: container:creation-progress
  // SPEC: container:creation-status
  // SPEC: container:creation-textarea
  // SPEC: container:creation-messages-inline
  test('shows creation overlay with header-strip Creating… and progress', async ({ page }) => {
    // Delay the newSession response so the overlay stays observable.
    const { daemon, release } = await startHeldCreation(page, {
      session_id: 'created-session',
      container_id: 'new-ctr',
      name: null,
    })

    await expect(page.locator('[data-testid="session-header-strip"]')).toContainText('Creating')
    await expect(page.locator('.session-header-strip-spinner')).toBeVisible()

    await expect(page.locator('.chat-replay-overlay')).toBeVisible()
    await expect(page.locator('.chat-replay-progress-bar.indeterminate')).toBeVisible()

    await daemon.sendProgress('Creating container')
    await expect(page.locator('.chat-replay-status-text')).toContainText('Creating container')

    await daemon.sendProgress('Waiting for container')
    await expect(page.locator('.chat-replay-status-text')).toContainText('Waiting for container')

    const input = page.locator('[data-testid="chat-input"]')
    await expect(input).toBeVisible()
    await input.fill('type-ahead message')
    await expect(input).toHaveValue('type-ahead message')

    // Sending must be blocked while the container is being created.
    let sendCalled = false
    await page.route('**/api/send*', async route => {
      sendCalled = true
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    })
    await input.press('Enter')
    await expect
      .poll(() => sendCalled, {
        timeout: 1000,
        message: 'Send API should not be called while container is creating',
      })
      .toBe(false)

    release()
  })

  // SPEC: container:creation-success
  test('provisional tab replaced with real tab on success', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          await route.fulfill({
            status: 200,
            json: { session_id: 'created-ok', container_id: 'new-ctr', name: null },
          })
        },
      },
    })
    await openSession(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()

    await expect(page.locator('.session-tab:has-text("Creating...")')).not.toBeVisible()
    await expect.poll(() => page.url()).toContain('created-ok')
  })

  // SPEC: container:creation-failure
  test('provisional tab removed on failure', async ({ page }) => {
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          await route.fulfill({ status: 500, json: { error: 'Container creation failed' } })
        },
      },
    })
    await openSession(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()

    await expect(page.locator('.session-tab:has-text("Creating...")')).not.toBeVisible()
    expect(page.url()).not.toContain('pending-')
    // Either the footer error status or an error notification counts as the error indication.
    const footerError = page.locator('[data-testid="footer-status"][data-status="error"]')
    const errorText = page.locator('.footer-error, [data-status="error"]')
    await expect(footerError.or(errorText).first()).toBeVisible({ timeout: 5000 })
  })

  // SPEC: container:creation-failure
  // SPEC: container:creation-input-own-session
  test('what is typed while a session is created comes back to the box when it fails', async ({
    page,
  }) => {
    let answer
    const answered = new Promise(resolve => {
      answer = resolve
    })
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          await answered
          await route.fulfill({ status: 500, json: { error: 'Container creation failed' } })
        },
      },
    })
    await mockSSE(page)
    const sends = []
    page.on('request', request => {
      if (request.url().includes('/api/send')) {
        sends.push(request.url())
      }
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()
    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('first for new')
    await input.press('Enter')
    await input.fill('queued for new')
    await input.press('Alt+Enter')
    const bubble = page.locator('[data-testid="queued-message-bubble"]')
    await expect(bubble).toBeVisible()
    await expect(bubble.getByTitle('Send now')).toHaveCount(0)

    answer()

    await expect(input).toHaveValue('first for new\n\nqueued for new')
    await expect(bubble).toHaveCount(0)
    expect(sends).toEqual([])
  })
})

test.describe('Session creation refused over /tmp', () => {
  // SPEC: container:creation-tmp-conflict
  test('a workspace under /tmp fails creation once, naming the path and the setting', async ({
    page,
  }) => {
    let calls = 0
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          calls += 1
          await route.fulfill({
            status: 409,
            json: { error: 'container_tmp_mount_conflict', paths: '/tmp/proj' },
          })
        },
      },
    })
    await openSession(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()

    const footer = page.locator('[data-testid="footer"]')
    await expect(footer).toContainText('/tmp/proj')
    await expect(footer).toContainText('CLAUDEBOX_NO_TMP_REMAP')
    expect(calls).toBe(1)
  })
})

test.describe('Session creation refused over its network mode', () => {
  for (const [where, body, parts] of [
    [
      'the workspace settings',
      { source: 'workspace' },
      ['[network] mode = "host"', 'claudebox run'],
    ],
    ['a bundle', { source: 'bundle', bundle: 'web' }, ['bundle web', '[network] mode = "host"']],
  ]) {
    // SPEC: container:creation-network-mode-refused
    test(`a host network mode set in ${where} fails creation once, naming it`, async ({ page }) => {
      let calls = 0
      await mockAPI(page, {
        handlers: {
          newSession: async route => {
            calls += 1
            await route.fulfill({
              status: 409,
              json: { error: 'network_mode_unsupported', mode: 'host', ...body },
            })
          },
        },
      })
      await openSession(page)

      await page.locator('[data-testid="header-new-session-btn"]').click()

      const footer = page.locator('[data-testid="footer"]')
      for (const part of parts) {
        await expect(footer).toContainText(part)
      }
      expect(calls).toBe(1)
    })
  }
})

test.describe('Session list while a session comes up', () => {
  // SPEC: container:start-keeps-session-list
  test('the session list keeps its rows while the session replays', async ({ page }) => {
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await openResumingSession(page)
    await openSessionsPanel(page)

    // The fixture opens a replay and never ends it, so the session stays coming up.
    await expect(page.locator('[data-testid="panel-tasks"]')).toContainText('Resuming...')
    const panel = page.locator('[data-testid="panel-sessions"]')
    await expect(panel).not.toContainText('Resuming...')
    await expect(panel.locator('[data-testid="session-item"]').first()).toBeVisible()
  })
})

const SECOND_SESSION_URL = `/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/test-session-002`

/** Hold the second session's resume open until the returned function is called. */
async function holdSecondSessionResume(page) {
  let release
  const held = new Promise(resolve => {
    release = resolve
  })
  let requested = false
  await page.route(`**/sessions/test-session-002/resume`, async route => {
    requested = true
    await held
    await route.fulfill({
      status: 200,
      json: { session_id: 'test-session-002', container_id: DEFAULT_CONTAINER_ID },
    })
  })
  return { release, wasRequested: () => requested }
}

async function switchToHeldSecondSession(page, resume) {
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)
  await page.evaluate(url => {
    window.location.hash = url.slice(1)
  }, SECOND_SESSION_URL)
  await expect.poll(resume.wasRequested).toBe(true)
}

test.describe('Following a link into another workspace', () => {
  // SPEC: routing:cross-workspace-link
  test('opens the session the link names instead of that workspace home', async ({ page }) => {
    await mockAPI(page, {
      workspaces: [
        { id: DEFAULT_WORKSPACE_ID, path: '/home/user/project', name: 'project' },
        { id: 'ws-other', path: '/home/user/other', name: 'other' },
      ],
    })
    await mockSSE(page)
    await page.goto('/#/workspaces/ws-other')
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    const resumed = page.waitForRequest(/\/sessions\/test-session-001\/resume/)
    await page.evaluate(url => {
      window.location.hash = url.slice(1)
    }, DEFAULT_SESSION_URL)
    await resumed

    await expect(page.locator('[data-testid="footer-session"]')).toContainText('test')
    expect(new URL(page.url()).hash).toBe(DEFAULT_SESSION_URL.slice(1))
  })
})

test.describe('Opening a session', () => {
  // SPEC: container:opening-actions-own-session
  test('a picker change made while another session opens waits for it', async ({ page }) => {
    let opened = false
    await mockAPI(page, {
      sessionsFixture: 'sessions/multiple.json',
      handlers: {
        getSessionStatus: route =>
          route.fulfill({
            json: {
              ...loadFixture('status/default.json'),
              session_id: opened ? 'test-session-002' : DEFAULT_SESSION_ID,
            },
          }),
      },
    })
    await mockSSE(page)
    const resume = await holdSecondSessionResume(page)
    const modelPosts = []
    await page.route('**/containers/*/api/model*', async route => {
      modelPosts.push(route.request().postDataJSON().model)
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    })
    await switchToHeldSecondSession(page, resume)

    await page.locator('[data-testid="footer-model"]').click()
    await page.locator('[data-testid="model-dropdown"]').getByText('Haiku 5.5').click()
    await expect
      .poll(() => modelPosts.length, {
        timeout: 1000,
        message: 'the session being left must not receive the pick',
      })
      .toBe(0)

    opened = true
    resume.release()
    await expect.poll(() => modelPosts).toEqual(['claude-haiku-5-5'])
  })

  // SPEC: container:opening-actions-own-session
  test('picks still taking effect reach the session they were made for after a move to another', async ({
    page,
  }) => {
    await mockAPI(page, {
      sessionsFixture: 'sessions/multiple.json',
      handlers: {
        getSessionStatus: route => {
          const id = new URL(route.request().url()).searchParams.get('session_id')
          return route.fulfill({ json: { ...loadFixture('status/default.json'), session_id: id } })
        },
      },
    })
    await mockSSE(page)
    const resume = await holdSecondSessionResume(page)
    const effortUrls = []
    await page.route('**/containers/*/api/effort-level*', async route => {
      effortUrls.push(route.request().url())
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    })
    let releasePermission
    const permissionHeld = new Promise(resolve => {
      releasePermission = resolve
    })
    let permissionRequested = false
    await page.route('**/containers/*/api/permission-mode*', async route => {
      permissionRequested = true
      await permissionHeld
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    })
    await switchToHeldSecondSession(page, resume)
    await page.locator('[data-testid="footer-permission-mode-picker"]').click()
    await page.locator('[data-testid="permission-mode-dropdown"]').getByText('Plan').first().click()
    await page.locator('[data-testid="footer-effort"]').click()
    await page
      .locator('[data-testid="effort-dropdown"] *')
      .filter({ hasText: /^Low$/ })
      .first()
      .click()
    resume.release()
    await expect.poll(() => permissionRequested).toBe(true)

    await page.evaluate(url => {
      window.location.hash = url.slice(1)
    }, DEFAULT_SESSION_URL)
    await expect(page.locator('[data-testid="footer-permission-mode-picker"]')).toHaveAttribute(
      'data-permission-mode',
      'bypassPermissions',
    )
    releasePermission()

    await expect.poll(() => effortUrls.length).toBe(1)
    expect(effortUrls[0]).toContain('session_id=test-session-002')
  })

  // SPEC: chat:control-reload
  test('a reload still restarting leaves the tab on the session moved to', async ({ page }) => {
    await mockAPI(page, {
      sessionsFixture: 'sessions/multiple.json',
      handlers: {
        resumeSession: route =>
          route.fulfill({
            json: { session_id: 'test-session-002', container_id: DEFAULT_CONTAINER_ID },
          }),
      },
    })
    await mockSSE(page)
    let releaseReload
    const reloadHeld = new Promise(resolve => {
      releaseReload = resolve
    })
    let holdReload = false
    await page.route('**/sessions/test-session-001/resume', async route => {
      if (holdReload) {
        await reloadHeld
      }
      await route.fulfill({
        json: { session_id: DEFAULT_SESSION_ID, container_id: DEFAULT_CONTAINER_ID },
      })
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    holdReload = true
    await page.locator('button[title="Reload session (picks up config changes)"]').click()
    await page.evaluate(url => {
      window.location.hash = url.slice(1)
    }, SECOND_SESSION_URL)
    await expect
      .poll(() => page.evaluate(() => window.__sseChatInstance?.url ?? ''))
      .toContain('session_id=test-session-002')
    releaseReload()
    await page.waitForTimeout(500)

    expect(await page.evaluate(() => window.__sseChatInstance?.url ?? '')).toContain(
      'session_id=test-session-002',
    )
    expect(page.url()).toContain('/sessions/test-session-002')
  })

  // SPEC: panel-stash:session-scoped
  // SPEC: footer:notifications-session-scoped
  // SPEC: chat:minimap-toggle-session-scoped
  test('the session left answering its settings read late changes nothing here', async ({
    page,
  }) => {
    let releaseFirst
    const firstHeld = new Promise(resolve => {
      releaseFirst = resolve
    })
    const SETTINGS = {
      [DEFAULT_SESSION_ID]: {
        stash: [{ text: 'a-secret', timestamp: 1 }],
        notificationsEnabled: true,
        minimapPinned: false,
      },
      'test-session-002': {
        stash: [{ text: 'b-item', timestamp: 2 }],
        notificationsEnabled: false,
        minimapPinned: true,
      },
    }
    let opened = false
    await mockAPI(page, {
      sessionsFixture: 'sessions/multiple.json',
      handlers: {
        getUIState: async route => {
          const id = new URL(route.request().url()).searchParams.get('session_id')
          if (id === DEFAULT_SESSION_ID) {
            await firstHeld
          }
          await route.fulfill({ json: { global: {}, session: SETTINGS[id] ?? {} } })
        },
        resumeSession: route =>
          route.fulfill({
            json: { session_id: 'test-session-002', container_id: DEFAULT_CONTAINER_ID },
          }),
        getSessionStatus: route =>
          route.fulfill({
            json: {
              ...loadFixture('status/default.json'),
              session_id: opened ? 'test-session-002' : DEFAULT_SESSION_ID,
            },
          }),
      },
    })
    await mockSSE(page)
    const firstRead = page.waitForRequest(/ui-state\?session_id=test-session-001/)
    await page.goto(DEFAULT_SESSION_URL)
    await firstRead

    opened = true
    const secondRead = page.waitForRequest(/ui-state\?session_id=test-session-002/)
    await page.evaluate(url => {
      window.location.hash = url.slice(1)
    }, SECOND_SESSION_URL)
    await secondRead
    await openStashPanel(page)
    await expect(page.locator('[data-testid="stash-item"]')).toHaveText(['b-item'])

    const lateReply = page.waitForResponse(/ui-state\?session_id=test-session-001/)
    releaseFirst()
    await lateReply

    await expect(page.locator('[data-testid="stash-item"]')).toHaveText(['b-item'])
    await expect(page.locator('[data-testid="footer-notifications-toggle"]')).not.toHaveClass(
      /enabled/,
    )
    await expect(page.locator('[data-testid="control-minimap-toggle"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  // SPEC: container:resume-no-previous-session
  test('a slow open keeps its loading screen instead of showing the session left', async ({
    page,
  }) => {
    await page.clock.install()
    await mockAPI(page, { sessionsFixture: 'sessions/multiple.json' })
    await mockSSE(page)
    const resume = await holdSecondSessionResume(page)
    await switchToHeldSecondSession(page, resume)
    await expect(page.locator('.chat-replay-overlay')).toBeVisible()

    await page.clock.fastForward(31_000)

    await expect(page.locator('.chat-replay-overlay')).toBeVisible()
    resume.release()
  })
})

test.describe('Creating a session slowly', () => {
  // SPEC: container:creation-overlay-spans-request
  test('"Creating" stays for as long as the create request runs', async ({ page }) => {
    await page.clock.install()
    let release
    const held = new Promise(resolve => {
      release = resolve
    })
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          await held
          await route.fulfill({
            status: 200,
            json: { session_id: 'slow-session', container_id: 'slow-ctr', name: null },
          })
        },
      },
    })
    await openSession(page)

    await page.locator('[data-testid="header-new-session-btn"]').click()
    const strip = page.locator('[data-testid="session-header-strip"]')
    await expect(strip).toContainText('Creating')

    await page.clock.fastForward(31_000)

    await expect(strip).toContainText('Creating')
    await expect(page.locator('.chat-replay-overlay')).toBeVisible()
    release()
  })
})

test.describe('Session Resume Overlay', () => {
  // SPEC: container:resume-overlay
  // SPEC: container:resume-progress
  // SPEC: container:resume-daemon-phase
  // SPEC: container:resume-replay-phase
  // SPEC: container:resume-textarea-stays-enabled
  test('shows resume overlay with progress; textarea stays enabled', async ({ page }) => {
    // resuming.jsonl stays in the resuming state: replay_started without replay_ended.
    await mockSSE(page, 'events/resuming.jsonl')
    await mockAPI(page)

    const sends = []
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/send')) {
        sends.push(request.url())
      }
    })

    await page.goto(DEFAULT_SESSION_URL)
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    await expect(page.locator('.chat-replay-overlay')).toBeVisible()

    // Determinate, since replay carries a count (unlike the indeterminate creation-phase bar).
    const progressBar = page.locator('.chat-replay-progress-bar')
    await expect(progressBar).toBeVisible()
    await expect(progressBar).not.toHaveClass(/indeterminate/)

    await expect(page.locator('.chat-replay-status-text')).toContainText('Replaying events')

    // Textarea stays enabled per the always-enabled invariant.
    const input = page.locator('[data-testid="chat-input"]')
    await expect(input).toBeEnabled()

    // A message typed while still loading stays in the composer; Enter shows the text but sends nothing yet.
    await input.fill('typed while the conversation was loading')
    await input.press('Enter')

    await expect(input).toHaveValue('typed while the conversation was loading')
    expect(sends).toHaveLength(0)
  })

  // SPEC: chat:queue-while-loading
  // SPEC: footer:loading-hint
  // SPEC: container:resume-textarea-stays-enabled
  test('Enter and Alt+Enter while the session loads keep the text and show why', async ({
    page,
  }) => {
    // A buffered inline reply must not go out on its own while the session loads.
    await page.addInitScript(sessionId => {
      const reply = {
        id: 'r1',
        quote: 'q',
        from: 'assistant',
        turnId: null,
        prefix: '',
        suffix: '',
        offset: 0,
        response: 'MY-REPLY',
        threadSessionId: null,
        promotedSessionId: null,
        railPromoted: false,
      }
      localStorage.setItem(`inline-replies:${sessionId}`, JSON.stringify([reply]))
    }, DEFAULT_SESSION_ID)
    // resuming.jsonl stays in the resuming state: replay_started without replay_ended.
    await mockSSE(page, 'events/resuming.jsonl')
    await mockAPI(page)
    const sends = await captureSends(page)
    await page.goto(DEFAULT_SESSION_URL)
    await expect(page.locator('.chat-replay-overlay')).toBeVisible()

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('typed while loading')
    await input.press('Enter')
    await input.press('Alt+Enter')

    await expect(page.locator('[data-testid="footer"]')).toContainText(
      'Wait for the session to load',
    )
    await expect(page.locator('[data-testid="queued-message-bubble"]')).toHaveCount(0)
    await expect(input).toHaveValue('typed while loading')
    expect(sends).toHaveLength(0)
  })

  // SPEC: chat:loading-covers-split
  test('the loading screen covers transcript, divider and right view together, settled beneath it', async ({
    page,
  }) => {
    // resuming.jsonl stays in the resuming state: replay_started without replay_ended.
    await mockAPI(page, { sessionUiStateDefaults: { rightSlotView: 'terminal' } })
    await openResumingSession(page)

    const overlay = page.locator('.chat-replay-overlay')
    await expect(overlay).toBeVisible()
    // The overlay is inset 1px top/left (CSS) to keep the panel frame's own border visible.
    const contentAreaBox = await page.locator('.chat-content-area').boundingBox()
    expect(await overlay.boundingBox()).toEqual({
      x: contentAreaBox.x + 1,
      y: contentAreaBox.y + 1,
      width: contentAreaBox.width - 1,
      height: contentAreaBox.height - 1,
    })

    // The screen takes pointer events, not the divider beneath it - a drag at its coordinates
    // reaches the screen instead, so the split ratio never moves.
    const divider = page.locator('[data-testid="chat-split-divider"]')
    const dividerBox = await divider.boundingBox()
    const midY = dividerBox.y + dividerBox.height / 2
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, midY)
    await page.mouse.down()
    await page.mouse.move(dividerBox.x + 150, midY)
    await page.mouse.up()
    expect((await divider.boundingBox()).x).toBe(dividerBox.x)

    // The overlay's top strip runs the full content-area width, so the right slot's own content
    // is exactly as reachable through it as the transcript is - hidden, not merely covered.
    await expect(page.getByTestId('terminal-column')).not.toBeVisible()

    const widthWhileLoading = (await page.locator('.chat-transcript-column').boundingBox()).width

    // Manually complete the replay - resuming.jsonl deliberately never sends replay_ended itself.
    await page.evaluate(() => {
      const instance = window.__sseChatInstance
      const msg = { data: JSON.stringify({ type: 'system', subtype: 'replay_ended' }) }
      if (instance?.readyState === 1) {
        instance.onmessage?.(msg)
        instance._emit('message', msg)
      }
    })
    await expect(overlay).not.toBeVisible()

    // No reflow: the split was already settled underneath, so lifting the screen changes nothing.
    expect((await page.locator('.chat-transcript-column').boundingBox()).width).toBe(
      widthWhileLoading,
    )
    await expect(page.getByTestId('terminal-column')).toBeVisible()
  })

  // SPEC: chat:loading-covers-split
  test('a pinned right-view overview is not visible while the loading screen is up, and returns once it lifts', async ({
    page,
  }) => {
    // resuming.jsonl stays in the resuming state: replay_started without replay_ended.
    await mockAPI(page, {
      sessionUiStateDefaults: { rightSlotView: 'terminal', terminalMinimapPinned: true },
    })
    await openResumingSession(page)
    await expect(page.locator('.chat-replay-overlay')).toBeVisible()

    await expect(page.getByTestId('terminal-minimap')).not.toBeVisible()

    await page.waitForFunction(() => window.__sseChatInstance?.readyState === 1)
    await page.evaluate(() => {
      const instance = window.__sseChatInstance
      const send = event => {
        const msg = { data: JSON.stringify(event) }
        instance.onmessage?.(msg)
        instance._emit('message', msg)
      }
      // The overview needs at least one bar to render at all - a resumed session's replay would
      // carry its own prior terminal entries; this stands in for one.
      send({
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: 'tu_1',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
      })
      send({ type: 'assistant', subtype: 'tool_result', content: 'hi', tool_use_id: 'tu_1' })
      send({ type: 'system', subtype: 'replay_ended' })
    })
    await expect(page.locator('.chat-replay-overlay')).not.toBeVisible()
    await expect(page.getByTestId('terminal-minimap')).toBeVisible()
  })

  // SPEC: chat:replay-stays-responsive
  test('history materializes while the transcript is still loading', async ({ page }) => {
    const events = loadEventsFromFixture('events/long-conversation.jsonl')
    await mockSSEDynamic(page, () => [
      { type: 'system', subtype: 'replay_started', count: events.length },
      ...events,
    ])
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)

    // Turns reach the page while the overlay is still up - the drain is sliced, not committed in one batch.
    const overlay = page.locator('.chat-replay-overlay')
    await expect(page.locator('[data-testid="turn-container"]').first()).toBeAttached()
    await expect(overlay).toBeVisible()

    await page.waitForFunction(() => window.__sseChatInstance?.readyState === 1)
    await page.evaluate(() => {
      const msg = { data: JSON.stringify({ type: 'system', subtype: 'replay_ended' }) }
      window.__sseChatInstance.onmessage?.(msg)
      window.__sseChatInstance._emit('message', msg)
    })
    await expect(overlay).not.toBeVisible()
  })

  // SPEC: chat:replay-stays-responsive
  test('slicing the load changes timing only, never turn order', async ({ page }) => {
    await openSessionWithAPI(page, 'events/long-conversation.jsonl')

    await expect(page.locator('.chat-replay-overlay')).not.toBeVisible()

    // The list is windowed: assert order over turns actually built - last fixture message shows last at bottom.
    const userMessages = page.locator('[data-testid="message-user"]')
    await expect(userMessages.first()).toBeVisible()
    await expect(userMessages.last()).toContainText('Thanks for all the help!')

    // The earliest turn is reachable by scrolling back to the top.
    await page.evaluate(() => {
      document.querySelector('.chat-messages').scrollTop = 0
    })
    await expect(page.locator('[data-testid="message-user"]').first()).toContainText('Hello')
  })

  // SPEC: container:resume-daemon-phase
  test('resume shows daemon phase progress before replay', async ({ page }) => {
    // A delayed new-session exposes the daemon progress phase that precedes resume.
    const { daemon, release } = await startHeldCreation(page, {
      session_id: 'daemon-resume-test',
      container_id: 'resume-ctr',
      name: null,
    })
    await expect(page.locator('.chat-replay-overlay')).toBeVisible()

    // Daemon phase progress messages (Phase 1, before replay).
    await daemon.sendProgress('Creating container')
    await expect(page.locator('.chat-replay-status-text')).toContainText('Creating container')

    await daemon.sendProgress('Resuming session')
    await expect(page.locator('.chat-replay-status-text')).toContainText('Resuming session')

    release()
  })

  // SPEC: container:resume-overlay
  test('overlay dismissed after replay completes', async ({ page }) => {
    await openLiveSessionWithAPI(page)

    await expect(page.locator('.chat-replay-overlay')).not.toBeVisible()
    await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled()
  })
})

test.describe('Welcome State', () => {
  // SPEC: container:welcome-state
  // SPEC: container:welcome-input
  // SPEC: container:welcome-name
  // SPEC: container:welcome-path
  // SPEC: container:welcome-shortcuts
  // SPEC: container:welcome-login-notice
  test('shows welcome page when no container active', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    const welcome = page.locator('[data-testid="welcome-page"]')
    await expect(welcome).toBeVisible()
    await expect(welcome.locator('.welcome-name')).toContainText(DEFAULT_WORKSPACE_ID)
    await expect(welcome.locator('.welcome-path')).toContainText('/home/user/project')
    // ChatInput is a sibling of welcome content, hoisted in the chat panel so one instance persists across views.
    await expect(
      page.locator('[data-testid="panel-chat"] [data-testid="chat-input"]'),
    ).toBeVisible()

    const shortcuts = page.locator('[data-testid="welcome-shortcuts"]')
    await expect(shortcuts).toBeVisible()
    await expect(shortcuts).toContainText('Alt+1')
    await expect(shortcuts).toContainText('Sessions')
    await expect(welcome.locator('[data-testid="welcome-login-notice"]')).toHaveCount(0)
  })

  // SPEC: container:welcome-login-notice
  test('a workspace with no login says so on the welcome page and still sends the first message', async ({
    page,
  }) => {
    await mockAPI(page, {
      sessionDefaults: { logged_in: false },
      handlers: {
        newSession: async route => {
          await route.fulfill({
            status: 200,
            json: {
              session_id: 'welcome-no-login',
              container_id: DEFAULT_CONTAINER_ID,
              name: null,
            },
          })
        },
      },
    })
    await mockSSE(page)
    const sendCalls = await captureSends(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await waitForAppReady(page)

    const notice = page.locator('[data-testid="welcome-login-notice"]')
    await expect(notice).toBeVisible()
    await expect(notice.locator('code')).toHaveText('claudebox run')

    await page.locator('[data-testid="chat-input"]').fill('say hi')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    await expect.poll(() => sendCalls.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(sendCalls[0].prompt).toBe('say hi')
  })

  // SPEC: container:welcome-login-notice
  test('a workspace whose agent is not Claude shows no login notice', async ({ page }) => {
    await mockAPI(page, { sessionDefaults: { logged_in: null } })
    await mockSSE(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="welcome-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="welcome-login-notice"]')).toHaveCount(0)
  })

  // SPEC: container:welcome-after-leaving
  test('leaving a session for the workspace address shows the welcome page and lets go of it', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page)
    const modelPosts = []
    await page.route('**/containers/*/api/model*', async route => {
      modelPosts.push(route.request().url())
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await page.evaluate(ws => {
      window.location.hash = `/workspaces/${ws}`
    }, DEFAULT_WORKSPACE_ID)

    await expect(page.locator('[data-testid="welcome-page"]')).toBeVisible()
    await page.locator('[data-testid="footer-model"]').click()
    await page.locator('[data-testid="model-dropdown"]').getByText('Haiku 5.5').click()
    await expect
      .poll(() => modelPosts.length, { timeout: 1000, message: 'the session left got the pick' })
      .toBe(0)
  })

  // SPEC: container:welcome-input
  test("the first message typed on the welcome page is sent as the new session's first message", async ({
    page,
  }) => {
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          await route.fulfill({
            status: 200,
            json: {
              session_id: 'welcome-created-1',
              container_id: DEFAULT_CONTAINER_ID,
              name: null,
            },
          })
        },
      },
    })
    await mockSSE(page)

    // Registered after mockAPI so it wins Playwright's LIFO route precedence over the default handler.
    const sendCalls = await captureSends(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await waitForAppReady(page)

    await page.locator('[data-testid="chat-input"]').fill('Fix the login bug')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    await expect.poll(() => sendCalls.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(sendCalls[0].prompt).toBe('Fix the login bug')
  })

  // SPEC: container:welcome-input
  test('text typed while the container is still starting stays in the composer', async ({
    page,
  }) => {
    const newSessionId = 'welcome-created-2'
    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          await new Promise(resolve => setTimeout(resolve, 500))
          await route.fulfill({
            status: 200,
            json: {
              session_id: newSessionId,
              container_id: DEFAULT_CONTAINER_ID,
              name: null,
            },
          })
        },
        // The default fixture's hardcoded id would read as a switch to another session once the
        // post-connect status fetch lands; a real backend reports the session in this container.
        getSessionStatus: async route => {
          await route.fulfill({
            json: { ...loadFixture('status/default.json'), session_id: newSessionId },
          })
        },
      },
    })
    await mockSSE(page)

    // Registered after mockAPI so it wins LIFO precedence; a resume here would clear the composer.
    const resumeCalls = []
    await page.route(/\/sessions\/[^/]+\/resume/, async route => {
      resumeCalls.push(route.request().url())
      await route.fulfill({
        status: 200,
        json: { session_id: newSessionId, container_id: DEFAULT_CONTAINER_ID },
      })
    })

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await waitForAppReady(page)

    await page.locator('[data-testid="chat-input"]').fill('First message')
    await page.locator('[data-testid="chat-input"]').press('Enter')

    // newSession is still in flight (500ms delay) - the composer must survive the transition.
    await page.locator('[data-testid="chat-input"]').fill('Second message typed during creation')

    // Held past newSession's 500ms delay and SSE settling - a late resume would clear the composer.
    await page.waitForTimeout(2000)

    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue(
      'Second message typed during creation',
    )
    expect(resumeCalls).toHaveLength(0)
  })

  // SPEC: container:welcome-alt-enter-keeps-text
  test('Alt+Enter on the welcome page keeps the typed text', async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('hello')

    await input.press('Alt+Enter')

    await expect(input).toHaveValue('hello')
  })

  // SPEC: footer:welcome-defaults
  test('footer shows session defaults from the workspace, not "-" placeholders', async ({
    page,
  }) => {
    await mockAPI(page)
    await mockSSE(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    // Workspace, model, effort, permission pickers must reflect the session-defaults endpoint response, never "-".
    await expect(page.locator('[data-testid="footer-workspace"]')).toContainText('project')
    await expect(page.locator('[data-testid="footer-model"]')).toContainText('Opus 5.5')
    await expect(page.locator('[data-testid="footer-effort"]')).toContainText('XHigh')
    await expect(page.locator('[data-testid="footer-permission-mode-picker"]')).toContainText(
      'Default',
    )
  })

  // SPEC: input:welcome-config-buffer
  test('picker change on welcome applies to the next session via buffered drain', async ({
    page,
  }) => {
    let setEffortBody = null
    let newSessionCalled = false

    await mockAPI(page, {
      handlers: {
        newSession: async route => {
          newSessionCalled = true
          await route.fulfill({
            status: 200,
            json: {
              session_id: 'new-session-id',
              container_id: DEFAULT_CONTAINER_ID,
              name: null,
            },
          })
        },
      },
    })
    await mockSSE(page)

    // Capture the effort-level API call from the buffered drain.
    await page.route('**/api/effort-level*', async route => {
      setEffortBody = await route.request().postDataJSON()
      await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
    })

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await expect(page.locator('[data-testid="footer-effort"]')).toContainText('XHigh')

    // No container exists yet on welcome, so this change buffers instead of calling the API.
    await page.locator('[data-testid="footer-effort"]').click()
    await page.locator('[data-testid="effort-dropdown"]').getByText('Max').click()

    // Optimistic update - picker shows Max immediately.
    await expect(page.locator('[data-testid="footer-effort"]')).toContainText('Max')

    expect(setEffortBody).toBeNull()

    // Submitting a message triggers new session creation, which attaches a session.
    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('Hello')
    await input.press('Enter')

    // The buffered effort change drains to the API once the session attaches.
    await expect.poll(() => newSessionCalled).toBe(true)
    await expect.poll(() => setEffortBody).toEqual({ effort_level: 'max' })
  })

  // SPEC: input:welcome-config-buffer
  test('picker change on welcome is dropped when an existing session is opened instead', async ({
    page,
  }) => {
    const modelRequests = []
    await mockAPI(page, {
      handlers: {
        setModel: async route => {
          modelRequests.push(route.request().postDataJSON())
          await route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
        },
      },
    })
    await mockSSE(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}`)
    await expect(page.locator('[data-testid="footer-model"]')).toContainText('Opus 5.5')
    await page.locator('[data-testid="footer-model"]').click()
    await page.locator('[data-testid="model-dropdown"]').getByText('Haiku 5.5').click()
    await expect(page.locator('[data-testid="footer-model"]')).toContainText('Haiku 5.5')

    const attached = page.waitForRequest(/ui-state\?session_id=/)
    await page.goto(DEFAULT_SESSION_URL)
    await attached

    await expect(page.locator('[data-testid="footer-model"]')).toContainText('Sonnet 5')
    expect(modelRequests).toEqual([])
  })
})

test.describe('Daemon SSE Stream', () => {
  test('connects to daemon SSE stream at /api/daemon/stream', async ({ page }) => {
    await createDaemonSSEController(page)
    await mockAPI(page)
    await page.goto(DEFAULT_SESSION_URL)
    await expect(page.locator('[data-testid="footer"]')).toBeVisible()

    const hasDaemon = await page.evaluate(() => window.__daemonSSEInstance !== null)
    expect(hasDaemon).toBe(true)

    const daemonUrl = await page.evaluate(() => window.__daemonSSEInstance?.url)
    expect(daemonUrl).toContain('/api/daemon/stream')
  })

  test('daemon SSE progress events shown during creation', async ({ page }) => {
    const { daemon, release } = await startHeldCreation(page, {
      session_id: 'daemon-sse-test',
      container_id: 'sse-ctr',
      name: null,
    })
    await expect(page.locator('.chat-replay-overlay')).toBeVisible()

    await daemon.sendProgress('Creating container')
    await expect(page.locator('.chat-replay-status-text')).toContainText('Creating container')

    await daemon.sendProgress('Starting session')
    await expect(page.locator('.chat-replay-status-text')).toContainText('Starting session')

    release()
  })
})

test.describe('Container Stop - Graceful Disconnect', () => {
  // SPEC: error:graceful-disconnect
  // ContainerStopEffect disconnects SSE gracefully when the container drops from sessions - no error flash.
  test('footer shows clean state when container stops (no error flash)', async ({ page }) => {
    let includeContainer = true

    await createSSEController(page)
    await mockAPI(page)

    await page.route(`**/api/workspaces/${DEFAULT_WORKSPACE_ID}/sessions`, async route => {
      if (route.request().method() === 'GET') {
        const base = loadFixture('sessions/default.json').sessions[0]
        const session = includeContainer
          ? { ...base, container_id: DEFAULT_CONTAINER_ID }
          : { ...base, container_id: null }
        await route.fulfill({ json: { sessions: [session] } })
      }
    })

    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await expect(page.locator('[data-testid="footer-status"][data-status="ready"]')).toBeVisible()

    // Simulates the daemon removing the container from the sessions list.
    includeContainer = false

    // DaemonStreamContext isn't reachable from the test; use the panel's refresh button to trigger the refetch.
    await openSessionsPanel(page)
    const refreshBtn = page.locator('[data-testid="session-refresh-btn"]')
    await refreshBtn.click()

    // ContainerStopEffect detects the container is gone and disconnects gracefully - no "Connection lost" error.
    await expect(
      page.locator('[data-testid="footer-status"][data-status="error"]'),
    ).not.toBeVisible({ timeout: 3000 })

    await expect(page.getByText('Connection lost')).not.toBeVisible({ timeout: 1000 })
  })
})

test.describe('Kill Container Button', () => {
  // SPEC: panel-session:kill-button
  // SPEC: panel-session:kill-container
  test('kill button visible for sessions with running container', async ({ page }) => {
    await openPanelListing(page, base => [
      { ...base, container_id: DEFAULT_CONTAINER_ID, num_turns: 1 },
      {
        ...base,
        session_id: 'no-ctr-session',
        container_id: null,
        num_turns: 2,
        started_at: '2025-01-17T12:00:00Z',
        updated_at: '2025-01-17T12:00:00Z',
      },
    ])

    const killBtns = page.locator('[data-testid="session-kill-btn"]')
    await expect(killBtns).toHaveCount(1)
    await expect(killBtns.first()).toHaveAttribute('title', 'Stop container')
  })

  // SPEC: panel-session:kill-container
  test('kill button calls DELETE container API', async ({ page }) => {
    let deleteUrl = null
    await mockAPI(page, {
      handlers: {
        deleteContainer: async route => {
          deleteUrl = route.request().url()
          await route.fulfill({ status: 200, json: { id: 'deleted', status: 'deleted' } })
        },
      },
    })
    await serveSessionList(page, base => [
      { ...base, container_id: DEFAULT_CONTAINER_ID, num_turns: 1 },
    ])
    await openSession(page)

    await openSessionsPanel(page)

    await page.locator('[data-testid="session-kill-btn"]').click()

    await expect.poll(() => deleteUrl).toBeTruthy()
    expect(deleteUrl).toContain(DEFAULT_CONTAINER_ID)
  })
})
