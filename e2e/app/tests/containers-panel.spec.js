/** E2E tests for the workspace-scoped Containers panel. */

import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, DEFAULT_WORKSPACE_ID, mockAPI } from '../mocks/api.js'
import { createDaemonSSEController, mockSSE } from '../mocks/sse.js'

const SAMPLE_CONTAINERS = [
  {
    id: 'c11111111111-aaaa',
    status: 'running',
    backend_id: 'bk1111111111-aaaa',
    port: 8000,
    created_at: '2025-05-15T08:00:00Z',
    failure_count: 0,
    labels: { kind: 'session' },
    session_id: 's-foo-1',
  },
  {
    id: 'c22222222222-bbbb',
    status: 'stopped',
    backend_id: 'bk2222222222-bbbb',
    port: 8001,
    created_at: '2025-05-15T07:00:00Z',
    failure_count: 0,
    labels: { kind: 'session' },
    session_id: 's-bar-1',
  },
]

/** Mock the current workspace's `/containers` endpoint with the given fixture. */
function mockWorkspaceContainers(page, containers = SAMPLE_CONTAINERS) {
  return page.route('**/api/workspaces/*/containers', async route => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({ status: 200, json: { containers } })
  })
}

async function openContainersPanel(page) {
  await mockWorkspaceContainers(page)
  await showContainersPanel(page)
}

async function showContainersPanel(page) {
  await page.goto(DEFAULT_SESSION_URL)
  await waitForAppReady(page)
  await page.locator('[data-testid="icon-containers"]').click()
}

test.describe('Containers Panel', () => {
  test.beforeEach(async ({ page }) => {
    // s-foo-1 / s-bar-1 need `session_dir` populated for the click-to-copy tests' tooltip/clipboard assertions.
    await mockAPI(page, { sessionsFixture: 'sessions/containers-test.json' })
    await mockSSE(page)
  })

  // SPEC: panel-containers:age-live
  test("a container's age keeps up while the panel stays open", async ({ page }) => {
    const installedAt = Date.parse('2026-03-01T12:00:00Z')
    await page.clock.install({ time: installedAt })
    await mockWorkspaceContainers(page, [
      {
        id: 'c-age-1111-aaaa',
        backend_id: 'bkage1111-aa',
        status: 'running',
        port: 8100,
        created_at: new Date(installedAt - 2 * 60_000).toISOString(),
        failure_count: 0,
        labels: { kind: 'session' },
        session_id: 's-foo-1',
      },
    ])
    await showContainersPanel(page)
    const age = page.locator('[data-testid="panel-containers"] .containers-age')
    await expect(age).toHaveText('2m ago')

    await page.clock.fastForward('01:00:00')

    await expect(age).toHaveText('1h ago')
  })

  // SPEC: panel-containers:list
  // SPEC: panel-containers:columns
  // SPEC: panel-containers:sort
  // SPEC: layout:panel-row-card
  test('lists current-workspace containers with columns sorted by state group', async ({
    page,
  }) => {
    await openContainersPanel(page)

    const panel = page.locator('[data-testid="panel-containers"]')
    await expect(panel).toBeVisible()

    const rows = panel.locator('.containers-row')
    await expect(rows).toHaveCount(2)

    await expect(panel.locator('.containers-status-dot')).toHaveCount(2)
    const cells = await rows
      .first()
      .evaluate(row => [...row.children].slice(0, 4).map(cell => cell.className.split(' ')[0]))
    expect(cells).toEqual([
      'containers-status-dot',
      'containers-session-id',
      'containers-id',
      'containers-session-name',
    ])
    await expect(panel.locator('.containers-id')).toContainText(['bk111111', 'bk222222'])
    await expect(panel.locator('.containers-session-id')).toContainText(['s-foo-1', 's-bar-1'])
    await expect(panel.locator('.containers-state')).toContainText(['Running', 'Stopped'])
    await expect(panel.locator('.containers-kind')).toContainText(['Session', 'Session'])

    const states = await panel.locator('.containers-state').allTextContents()
    expect(states[0]).toBe('Running')
    expect(states[1]).toBe('Stopped')
  })

  // SPEC: panel-containers:empty
  test('shows "No containers" placeholder when the endpoint returns empty', async ({ page }) => {
    await mockWorkspaceContainers(page, [])
    await showContainersPanel(page)

    const panel = page.locator('[data-testid="panel-containers"]')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('No containers')
  })

  // SPEC: panel-containers:stop
  test('Stop button hits the composite DELETE endpoint', async ({ page }) => {
    await mockWorkspaceContainers(page)
    let deleteHit = false
    await page.route('**/api/workspaces/*/containers/c11111111111-aaaa', async route => {
      if (route.request().method() === 'DELETE') {
        deleteHit = true
        await route.fulfill({ status: 200, json: { id: 'c11111111111-aaaa', status: 'deleted' } })
        return
      }
      await route.fallback()
    })

    await showContainersPanel(page)
    await expect(page.locator('[data-testid="panel-containers"]')).toBeVisible()

    await page.locator('[data-testid="container-stop-c11111111111-aaaa"]').click()
    await expect.poll(() => deleteHit).toBe(true)
  })

  // SPEC: panel-containers:open-session
  test("Resume button navigates to the container's session", async ({ page }) => {
    await openContainersPanel(page)
    await expect(page.locator('[data-testid="panel-containers"]')).toBeVisible()

    const row = page.locator('[data-testid="container-row-c11111111111-aaaa"]')
    await row.locator('[data-testid="session-resume-btn"]').click()
    await expect.poll(() => page.url(), { timeout: 4000 }).toContain('s-foo-1')
  })

  // SPEC: panel-containers:row-grid
  // SPEC: panel-containers:row-baseline
  // SPEC: panel-containers:id-typography
  test('row uses grid layout with baseline alignment + 11px monospace ids', async ({ page }) => {
    await openContainersPanel(page)
    await expect(page.locator('[data-testid="panel-containers"]')).toBeVisible()

    const row = page.locator('.containers-row').first()
    const rowStyles = await row.evaluate(el => {
      const s = getComputedStyle(el)
      return { display: s.display, alignItems: s.alignItems, borderLeftWidth: s.borderLeftWidth }
    })
    expect(rowStyles.display).toBe('grid')
    expect(rowStyles.alignItems).toBe('baseline')
    expect(rowStyles.borderLeftWidth).toBe('3px')

    const childLineHeight = await row
      .locator(':scope > *')
      .first()
      .evaluate(el => getComputedStyle(el).lineHeight)
    expect(childLineHeight).toBe('28px')

    for (const cls of ['.containers-id', '.containers-session-id']) {
      const cell = row.locator(cls)
      const cellStyles = await cell.evaluate(el => {
        const s = getComputedStyle(el)
        return { fontSize: s.fontSize, fontFamily: s.fontFamily }
      })
      expect(cellStyles.fontSize).toBe('11px')
      expect(cellStyles.fontFamily).toMatch(/mono/i)
    }
  })

  // SPEC: panel-containers:dot-gap
  test("a row's dot sits clear of its session id, as far from it as the columns sit apart", async ({
    page,
  }) => {
    await mockWorkspaceContainers(page)
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/s-foo-1`)
    await waitForAppReady(page)
    await page.locator('[data-testid="icon-containers"]').click()

    const rows = page.locator('[data-testid="panel-containers"] .containers-row')
    await expect(rows).toHaveCount(2)
    await expect(page.locator('.containers-row-current')).toHaveCount(1)

    for (const row of await rows.all()) {
      const edges = selector =>
        row.locator(selector).evaluate(el => {
          const box = el.getBoundingClientRect()
          return { left: box.left, right: box.right }
        })
      const dot = await edges('.containers-status-dot')
      const sessionId = await edges('.containers-session-id')
      const containerId = await edges('.containers-id')

      const dotGap = sessionId.left - dot.right
      const idGap = containerId.left - sessionId.right
      expect(dotGap).toBeGreaterThan(0)
      expect(Math.abs(dotGap - idGap)).toBeLessThanOrEqual(0.5)
    }
  })

  // SPEC: panel-containers:session-state-dot
  test("a running container's dot shows its own session's state; other states keep theirs", async ({
    page,
  }) => {
    const sid = name => `${name}-0000-0000-0000-000000000000`
    const container = (id, session, status) => ({
      id,
      backend_id: `bk-${id}`,
      status,
      port: 8000,
      created_at: '2025-05-15T08:00:00Z',
      failure_count: 0,
      labels: { kind: 'session' },
      session_id: session,
    })
    await mockAPI(page, { sessionsFixture: 'sessions/working.json' })
    await mockWorkspaceContainers(page, [
      container('c-working', sid('working1'), 'running'),
      container('c-waiting', sid('waiting1'), 'running'),
      container('c-asking', sid('askwait1'), 'running'),
      container('c-crashed', sid('askwork1'), 'crashed'),
    ])
    await showContainersPanel(page)

    const dotOf = id => page.locator(`[data-testid="container-row-${id}"] .containers-status-dot`)
    await expect(dotOf('c-working')).toHaveClass(/container-status-working/)
    await expect(dotOf('c-working')).toHaveAttribute('title', 'Working')
    await expect(dotOf('c-waiting')).toHaveClass(/container-status-waiting/)
    await expect(dotOf('c-waiting')).toHaveAttribute('title', 'Waiting on background work')
    await expect(dotOf('c-asking')).toHaveClass(/container-status-needs-you/)
    await expect(dotOf('c-asking')).toHaveAttribute('title', 'Needs you')
    await expect(
      page.locator('[data-testid="container-row-c-asking"] .containers-state'),
    ).toHaveText('Running')
    const working = await dotOf('c-working').evaluate(el => getComputedStyle(el).backgroundColor)
    expect(working).toBe('rgb(168, 85, 247)')
    expect(await dotOf('c-crashed').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(239, 68, 68)',
    )
    await expect(dotOf('c-crashed')).toHaveAttribute('title', 'Status: crashed')
  })

  // SPEC: panel-containers:actions-level
  test("a row's Play and chevron sit level with its Stop button and its text", async ({ page }) => {
    await openContainersPanel(page)

    const row = page.locator('[data-testid="container-row-c11111111111-aaaa"]')
    await expect(row.locator('[data-testid="session-resume-btn"]')).toBeVisible()
    const centres = await row.evaluate(el => {
      const centre = node => {
        const box = node.getBoundingClientRect()
        return box.top + box.height / 2
      }
      const icon = selector => centre(el.querySelector(`${selector} svg`))
      return {
        stop: icon('.containers-action-btn'),
        play: icon('.sessions-resume-btn'),
        chevron: icon('.sessions-resume-chevron'),
        text: centre(el.querySelector('.containers-state')),
      }
    })

    expect(Math.abs(centres.play - centres.stop)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(centres.chevron - centres.stop)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(centres.stop - centres.text)).toBeLessThanOrEqual(1)
  })

  // SPEC: panel-containers:id-source
  test('id column shows runtime backend_id, not the internal container.id', async ({ page }) => {
    await openContainersPanel(page)

    const panel = page.locator('[data-testid="panel-containers"]')
    await expect(panel).toBeVisible()

    // Display source is backend_id (8-char prefix), NOT the internal record id.
    await expect(panel.locator('.containers-id')).toContainText(['bk111111', 'bk222222'])
  })

  // SPEC: panel-containers:session-name-empty
  test('session name cell is empty when the attached session has no custom name', async ({
    page,
  }) => {
    await openContainersPanel(page)

    await expect(page.locator('[data-testid="panel-containers"]')).not.toContainText('(unnamed)')
  })

  // SPEC: panel-containers:current-highlight
  // SPEC: panel-containers:current-no-resume
  test("current container's row carries highlight class and hides Resume", async ({ page }) => {
    await mockWorkspaceContainers(page)
    // Navigate to the session attached to the first container so it becomes the active row.
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/s-foo-1`)
    await waitForAppReady(page)
    await page.locator('[data-testid="icon-containers"]').click()
    await expect(page.locator('[data-testid="panel-containers"]')).toBeVisible()

    const currentRow = page.locator('[data-testid="container-row-c11111111111-aaaa"]')
    await expect(currentRow).toHaveClass(/containers-row-current/)
    await expect(currentRow.locator('[data-testid="session-resume-btn"]')).toHaveCount(0)

    // Sibling (non-current) row still shows Resume.
    const otherRow = page.locator('[data-testid="container-row-c22222222222-bbbb"]')
    await expect(otherRow.locator('[data-testid="session-resume-btn"]')).toHaveCount(1)
  })

  // SPEC: panel-containers:id-tooltip-format
  // SPEC: panel-containers:id-copy-on-click
  test('container id cell exposes Container — <full id> tooltip and copies the full id on click', async ({
    page,
    context,
  }) => {
    await mockWorkspaceContainers(page)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await showContainersPanel(page)
    await expect(page.locator('[data-testid="panel-containers"]')).toBeVisible()

    const firstId = page.locator('[data-testid="panel-containers"] .containers-id').first()
    await expect(firstId).toHaveAttribute('title', 'Container — bk1111111111-aaaa')

    await firstId.click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe('bk1111111111-aaaa')

    // Brief "Copied!" overlay appears in the same slot.
    await expect(page.locator('.containers-id-copied').first()).toHaveText('Copied!')
  })

  // SPEC: panel-containers:session-id-tooltip-format
  // SPEC: panel-containers:session-id-copy-on-click
  test('session id cell exposes Session directory — <full path> tooltip and copies the path on click', async ({
    page,
    context,
  }) => {
    await mockWorkspaceContainers(page)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await showContainersPanel(page)
    await expect(page.locator('[data-testid="panel-containers"]')).toBeVisible()

    const firstSessionId = page
      .locator('[data-testid="panel-containers"] .containers-session-id')
      .first()
    await expect(firstSessionId).toHaveAttribute(
      'title',
      'Session directory — /home/u/.claudebox/sessions/s-foo-1',
    )

    await firstSessionId.click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe('/home/u/.claudebox/sessions/s-foo-1')

    await expect(page.locator('.containers-session-id-copied').first()).toHaveText('Copied!')
  })

  // SPEC: panel-containers:columns (8-char session id matching the Sessions panel)
  test('session id cell renders the 8-character prefix only', async ({ page }) => {
    // Longer id than the standard fixture's `s-foo-1` (7 chars) so slice(0, 8) is observable.
    const longContainers = [
      {
        ...SAMPLE_CONTAINERS[0],
        session_id: 'sess-abcdef-12345-xyz',
      },
    ]
    await mockWorkspaceContainers(page, longContainers)
    await showContainersPanel(page)

    const sessionIdText = await page
      .locator('[data-testid="panel-containers"] .containers-session-id')
      .first()
      .textContent()
    expect(sessionIdText).toBe('sess-abc')
  })

  // SPEC: panel-containers:row-grid
  test('columns align across rows regardless of per-row content width or current-row state', async ({
    page,
  }) => {
    // Four ages (18h/23h/1d/2d) make relative-time strings render at different widths; s-foo-1
    // becomes current via URL nav (no Resume), exercising the actions-column reservation case.
    const now = Date.now()
    const hours = h => new Date(now - h * 3600 * 1000).toISOString()
    const alignmentContainers = [
      {
        id: 'c-align-1111-aaaa',
        backend_id: 'bkalign1111-aa',
        status: 'running',
        port: 8100,
        created_at: hours(18),
        failure_count: 0,
        labels: { kind: 'session' },
        session_id: 's-foo-1',
      },
      {
        id: 'c-align-2222-bbbb',
        backend_id: 'bkalign2222-bb',
        status: 'running',
        port: 8101,
        created_at: hours(23),
        failure_count: 0,
        labels: { kind: 'session' },
        session_id: 's-bar-1',
      },
      {
        id: 'c-align-3333-cccc',
        backend_id: 'bkalign3333-cc',
        status: 'running',
        port: 8102,
        created_at: hours(36),
        failure_count: 0,
        labels: { kind: 'session' },
        session_id: 's-baz-1',
      },
      {
        id: 'c-align-4444-dddd',
        backend_id: 'bkalign4444-dd',
        status: 'running',
        port: 8103,
        created_at: hours(60),
        failure_count: 0,
        labels: { kind: 'session' },
        session_id: 's-qux-1',
      },
    ]

    await mockWorkspaceContainers(page, alignmentContainers)
    // s-foo-1's row becomes current, suppressing its ResumeControl.
    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/s-foo-1`)
    await waitForAppReady(page)
    await page.locator('[data-testid="icon-containers"]').click()

    const panel = page.locator('[data-testid="panel-containers"]')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.containers-row')).toHaveCount(4)

    // Confirm the age column renders varying widths, or the alignment check below is vacuous.
    const ageTexts = await panel.locator('.containers-age').allTextContents()
    const unique = new Set(ageTexts)
    expect(unique.size).toBeGreaterThanOrEqual(3)

    // Parent grid: display: grid drives the shared column track.
    const listDisplay = await panel
      .locator('.containers-list')
      .evaluate(el => getComputedStyle(el).display)
    expect(listDisplay).toBe('grid')

    // Row-level x-coordinate identity across the four rows, with +/-0.5px for sub-pixel rounding.
    async function columnXs(selector) {
      return panel
        .locator(selector)
        .evaluateAll(elements => elements.map(el => el.getBoundingClientRect().x))
    }
    for (const sel of [
      '.containers-state',
      '.containers-kind',
      '.containers-age',
      '.containers-actions',
    ]) {
      const xs = await columnXs(sel)
      expect(xs.length).toBe(4)
      const min = Math.min(...xs)
      const max = Math.max(...xs)
      expect(max - min).toBeLessThanOrEqual(0.5)
    }

    // Stop button x matches between the current row (Stop only) and a non-current row (+Resume).
    const currentStopX = await panel
      .locator('[data-testid="container-stop-c-align-1111-aaaa"]')
      .evaluate(el => el.getBoundingClientRect().x)
    const otherStopX = await panel
      .locator('[data-testid="container-stop-c-align-2222-bbbb"]')
      .evaluate(el => el.getBoundingClientRect().x)
    expect(Math.abs(currentStopX - otherStopX)).toBeLessThanOrEqual(0.5)

    // Current row's Resume control is suppressed; non-current row still has it.
    const currentRow = page.locator('[data-testid="container-row-c-align-1111-aaaa"]')
    await expect(currentRow.locator('[data-testid="session-resume-btn"]')).toHaveCount(0)
    const otherRow = page.locator('[data-testid="container-row-c-align-2222-bbbb"]')
    await expect(otherRow.locator('[data-testid="session-resume-btn"]')).toHaveCount(1)

    // Probe/screenshot artifacts support the per-ticket commit gate; opt-in via env var so the
    // side-effect doesn't surprise other runs.
    if (process.env.PROBE_OUT_DIR) {
      const dir = process.env.PROBE_OUT_DIR
      const probe = await panel.evaluate(el => {
        const list = el.querySelector('.containers-list')
        const listStyle = getComputedStyle(list)
        const xs = sel => [...el.querySelectorAll(sel)].map(n => n.getBoundingClientRect().x)
        return {
          list_display: listStyle.display,
          list_grid_template_columns: listStyle.gridTemplateColumns,
          list_column_gap: listStyle.columnGap,
          list_grid_auto_rows: listStyle.gridAutoRows,
          row_count: el.querySelectorAll('.containers-row').length,
          ages: [...el.querySelectorAll('.containers-age')].map(n => n.textContent),
          x_state: xs('.containers-state'),
          x_kind: xs('.containers-kind'),
          x_age: xs('.containers-age'),
          x_actions: xs('.containers-actions'),
          x_stop_current:
            el
              .querySelector('[data-testid="container-stop-c-align-1111-aaaa"]')
              ?.getBoundingClientRect().x ?? null,
          x_stop_noncurrent:
            el
              .querySelector('[data-testid="container-stop-c-align-2222-bbbb"]')
              ?.getBoundingClientRect().x ?? null,
        }
      })
      const maxDelta = arr => Math.max(...arr) - Math.min(...arr)
      probe.max_delta_state = maxDelta(probe.x_state)
      probe.max_delta_kind = maxDelta(probe.x_kind)
      probe.max_delta_age = maxDelta(probe.x_age)
      probe.max_delta_actions = maxDelta(probe.x_actions)
      probe.stop_x_delta = Math.abs(probe.x_stop_current - probe.x_stop_noncurrent)
      fs.writeFileSync(`${dir}/containers-panel-probe.json`, JSON.stringify(probe, null, 2))
      await page.screenshot({ path: `${dir}/containers-panel.png`, fullPage: false })
    }
  })

  // SPEC: panel-containers:live-updates
  test('row updates in place when a container_status event arrives', async ({ page }) => {
    await mockWorkspaceContainers(page)
    const daemon = await createDaemonSSEController(page)
    await showContainersPanel(page)

    const panel = page.locator('[data-testid="panel-containers"]')
    await expect(panel).toBeVisible()

    const row = page.locator('[data-testid="container-row-c11111111111-aaaa"]')
    await expect(row.locator('.containers-state')).toContainText('Running')

    await daemon.sendContainerStatus('c11111111111-aaaa', 'stopping')

    await expect(row.locator('.containers-state')).toContainText('Stopping')
  })
})
