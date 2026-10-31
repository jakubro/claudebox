/** E2E tests for the Crons panel - the open session's scheduled prompts. */

import { expect, test } from '@playwright/test'
import { openLiveSession, openLiveSessionWithAPI, waitForAppReady } from '../helpers.js'
import {
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  loadFixture,
  mockAPI,
} from '../mocks/api.js'
import { createDaemonSSEController, createSSEController } from '../mocks/sse.js'

test.use({ timezoneId: 'UTC' })

const HOUR = 3_600_000

function human(content, turnId, at) {
  return {
    type: 'user',
    subtype: 'text',
    is_human: true,
    content,
    turn_id: turnId,
    timestamp: at,
    ts: new Date(at).toISOString(),
  }
}

function schedule(toolUseId, id, input, at, { durable = false } = {}) {
  return [
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'CronCreate',
      tool_name: 'CronCreate',
      tool_use_id: toolUseId,
      tool_input: input,
      timestamp: at,
      ts: new Date(at).toISOString(),
    },
    {
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: toolUseId,
      content: `Scheduled job ${id}.`,
      tool_use_result: {
        id,
        humanSchedule: input.cron,
        recurring: input.recurring !== false,
        durable,
      },
      timestamp: at + 10,
      ts: new Date(at + 10).toISOString(),
    },
  ]
}

function unschedule(toolUseId, id, at) {
  return [
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'CronDelete',
      tool_name: 'CronDelete',
      tool_use_id: toolUseId,
      tool_input: { id },
      timestamp: at,
      ts: new Date(at).toISOString(),
    },
    {
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: toolUseId,
      content: `Cancelled job ${id}.`,
      tool_use_result: { id },
      timestamp: at + 10,
      ts: new Date(at + 10).toISOString(),
    },
  ]
}

function oneTimeCronMinutesAhead(now, minutesAhead) {
  const at = new Date(Math.floor(now / 60_000) * 60_000 + minutesAhead * 60_000)
  return `${at.getUTCMinutes()} ${at.getUTCHours()} ${at.getUTCDate()} ${at.getUTCMonth() + 1} *`
}

function dailyCronHoursAhead(now, hours) {
  return `0 ${new Date(now + hours * HOUR).getUTCHours()} * * *`
}

function turnEnd(at) {
  return { type: 'result', subtype: 'success', timestamp: at, ts: new Date(at).toISOString() }
}

const rows = page => page.locator('[data-testid="cron-entry"]')

test.describe('Crons Panel', () => {
  // SPEC: panel-cron:panel
  // SPEC: panel-cron:default-open
  // SPEC: panel-cron:empty
  test('opens below Tasks by default, empty for a session without schedules', async ({ page }) => {
    await mockAPI(page)
    await openLiveSession(page)

    const crons = page.locator('[data-testid="panel-crons"]')
    await expect(crons).toContainText('No scheduled prompts')
    const tasksBox = await page.locator('[data-testid="panel-tasks"]').boundingBox()
    const cronsBox = await crons.boundingBox()
    expect(cronsBox.y).toBeGreaterThan(tasksBox.y)
  })

  // SPEC: layout:panel-tab-icon
  test('every side panel tab shows its icon before its title, Crons its calendar clock', async ({
    page,
  }) => {
    await mockAPI(page)
    await openLiveSession(page)

    const cronsTab = page.locator('.icon-tab', { hasText: 'Crons' })
    await expect(cronsTab.locator(':scope > svg.lucide-calendar-clock')).toHaveCount(1)
    const leading = await page
      .locator('.icon-tab')
      .evaluateAll(tabs => tabs.map(t => [t.textContent, t.firstElementChild?.tagName]))
    expect(leading.length).toBeGreaterThan(5)
    for (const [title, first] of leading) {
      expect(first, title).toBe('svg')
    }
  })

  // SPEC: panel-cron:active-sorted
  // SPEC: panel-cron:row
  // SPEC: panel-cron:row-layout
  // SPEC: panel-cron:tooltip
  // SPEC: panel-cron:badge
  // SPEC: panel-cron:read-only
  test('lists schedules soonest first with countdown, words, expiry and prompt, and counts them', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    const now = Date.now()
    await controller.sendEvents([
      human('Schedule things', 't1', now - 1000),
      ...schedule(
        'c1',
        '00000001',
        {
          cron: oneTimeCronMinutesAhead(now, 41),
          prompt: 'Start the batch\nthen report',
          recurring: false,
        },
        now - 900,
      ),
      ...schedule(
        'c2',
        '00000002',
        { cron: oneTimeCronMinutesAhead(now, 21), prompt: 'Look at the deploy', recurring: false },
        now - 800,
      ),
      ...schedule(
        'c3',
        '00000003',
        { cron: dailyCronHoursAhead(now, 3), prompt: 'Morning summary' },
        now - 700,
      ),
    ])

    await expect(rows(page)).toHaveCount(3)
    await expect(rows(page).locator('.cron-prompt')).toHaveText([
      'Look at the deploy',
      'Start the batch',
      'Morning summary',
    ])
    await expect(rows(page).nth(0).locator('.cron-when')).toHaveText('in 21m')
    await expect(rows(page).nth(0).locator('.cron-schedule')).toHaveText(
      /^once, [A-Z][a-z]{2} \d+ \d\d:\d\d$/,
    )
    await expect(rows(page).nth(2).locator('.cron-schedule')).toHaveText(
      new RegExp(
        `^daily at ${String(new Date(now + 3 * HOUR).getUTCHours()).padStart(2, '0')}:00 · expires [A-Z][a-z]{2} ${new Date(now - 690 + 7 * 24 * HOUR).getUTCDate()}$`,
      ),
    )
    await expect(rows(page).locator('button, input, select')).toHaveCount(0)
    await expect(page.locator('[data-testid="icon-crons"] .icon-badge')).toHaveText('3')
    await expect(rows(page).nth(1).locator('.cron-prompt')).toHaveAttribute(
      'title',
      'Start the batch\nthen report',
    )
    await expect(rows(page).nth(1).locator('.cron-when')).not.toHaveAttribute('title')
    await expect(rows(page).nth(1).locator('.cron-schedule')).not.toHaveAttribute('title')

    const first = rows(page).nth(0)
    const whenBox = await first.locator('.cron-when').boundingBox()
    const scheduleBox = await first.locator('.cron-schedule').boundingBox()
    const promptBox = await first.locator('.cron-prompt').boundingBox()
    expect(Math.abs(promptBox.x - whenBox.x)).toBeLessThanOrEqual(1)
    expect(
      Math.abs(promptBox.x + promptBox.width - (scheduleBox.x + scheduleBox.width)),
    ).toBeLessThanOrEqual(1)
  })

  // SPEC: panel-cron:actual-fire-time
  test('a repeating row counts down to the time it will actually fire, past its nominal time', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    const now = Date.now()
    const nominal = new Date(Math.floor(now / HOUR) * HOUR + 2 * HOUR)
    const cron = `0 ${nominal.getUTCHours()} * * *`
    await controller.sendEvents([
      ...schedule('c1', 'ffffffff', { cron, prompt: 'Daily' }, now - 500),
    ])

    // An id at the top of the jitter range delays a daily schedule by the 30-minute cap.
    const expectedMinutes = Math.ceil((nominal.getTime() + 30 * 60_000 - now) / 60_000)
    const words = `in ${Math.floor(expectedMinutes / 60)}h ${expectedMinutes % 60}m`
    await expect(rows(page).locator('.cron-when')).toHaveText(
      new RegExp(
        `^(${words}|in ${Math.floor((expectedMinutes - 1) / 60)}h ${(expectedMinutes - 1) % 60}m)$`,
      ),
    )
  })

  // SPEC: panel-cron:removal
  test('a schedule leaves when deleted, and a one-time schedule is gone once its time has passed', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    const now = Date.now()
    await controller.sendEvents([
      ...schedule(
        'c1',
        '00000001',
        { cron: oneTimeCronMinutesAhead(now, -2), prompt: 'Fired', recurring: false },
        now - 300_000,
      ),
      ...schedule(
        'c2',
        '00000002',
        { cron: oneTimeCronMinutesAhead(now, 30), prompt: 'Later', recurring: false },
        now - 200_000,
      ),
      ...schedule(
        'c3',
        '00000003',
        { cron: dailyCronHoursAhead(now, 3), prompt: 'Daily' },
        now - 100_000,
      ),
      turnEnd(now - 90_000),
    ])
    await expect(rows(page).locator('.cron-prompt')).toHaveText(['Later', 'Daily'])

    await controller.sendEvents(unschedule('d1', '00000003', now))
    await expect(rows(page).locator('.cron-prompt')).toHaveText(['Later'])
  })

  // SPEC: panel-cron:removal
  test('a repeating schedule leaves seven days after it was created', async ({ page }) => {
    const controller = await openLiveSessionWithAPI(page)

    const now = Date.now()
    await controller.sendEvents([
      ...schedule(
        'c1',
        '00000001',
        { cron: '*/5 * * * *', prompt: 'Expired' },
        now - 7 * 24 * HOUR - 60_000,
      ),
      ...schedule('c2', '00000002', { cron: '*/5 * * * *', prompt: 'Fresh' }, now - 60_000),
      turnEnd(now - 50_000),
    ])

    await expect(rows(page).locator('.cron-prompt')).toHaveText(['Fresh'])
  })

  // SPEC: panel-cron:due
  test('a schedule that comes due mid-turn stays listed as due until the turn ends', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    const now = Date.now()
    await controller.sendEvents([
      human('Schedule it', 't1', now - 600_000),
      ...schedule(
        'c1',
        '00000001',
        { cron: oneTimeCronMinutesAhead(now, -1), prompt: 'Held back', recurring: false },
        now - 590_000,
      ),
      {
        type: 'result',
        subtype: 'success',
        turn_id: 't1',
        timestamp: now - 580_000,
        ts: new Date(now - 580_000).toISOString(),
      },
      human('Keep working', 't2', now - 240_000),
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Working on it',
        timestamp: now - 230_000,
        ts: new Date(now - 230_000).toISOString(),
      },
    ])

    const row = rows(page)
    await expect(row.locator('.cron-when')).toHaveText('due')
    await expect(row).toHaveClass(/cron-due/)

    await controller.sendEvents([
      {
        type: 'result',
        subtype: 'success',
        turn_id: 't2',
        timestamp: Date.now(),
        ts: new Date().toISOString(),
      },
    ])
    await expect(page.locator('[data-testid="panel-crons"]')).toContainText('No scheduled prompts')
  })

  // SPEC: panel-cron:click
  test('clicking a row scrolls the chat to the call that scheduled it', async ({ page }) => {
    await mockAPI(page, { sessionUiStateDefaults: { terminalSplitEnabled: false } })
    const controller = await openLiveSession(page)

    const now = Date.now()
    await controller.sendEvents([
      human('Schedule it', 't1', now - 1000),
      ...schedule(
        'c1',
        '00000001',
        { cron: dailyCronHoursAhead(now, 3), prompt: 'Morning summary' },
        now - 900,
      ),
      {
        type: 'result',
        subtype: 'success',
        turn_id: 't1',
        timestamp: now - 800,
        ts: new Date(now - 800).toISOString(),
      },
    ])

    await rows(page).click()
    await expect(page.locator('[data-tool-use-id="c1"].task-highlight')).toBeVisible()
  })
})

function listedSession(id, name, running) {
  return {
    ...loadFixture('sessions/default.json').sessions[0],
    session_id: id,
    name,
    container_id: running ? `c-${id}` : null,
  }
}

async function mockWorkspace(page, state) {
  await mockAPI(page, {
    handlers: {
      getSessions: async route => {
        const own = loadFixture('sessions/default.json').sessions
        await route.fulfill({ json: { sessions: [...own, ...state.others] } })
      },
      getSessionSchedules: async route => {
        if (state.failSchedules) {
          await route.fulfill({ status: 500, json: { error: 'boom' } })
        } else {
          await route.fulfill({ json: { sessions: state.schedules } })
        }
      },
    },
  })
}

function scheduled(sessionId, toolUseId, id, input, at, { respondingSince = null } = {}) {
  return {
    session_id: sessionId,
    responding_since: respondingSince,
    events: [
      human('Schedule it', `t-${toolUseId}`, at - 10),
      ...schedule(toolUseId, id, input, at),
    ],
  }
}

const allTab = page =>
  page.locator('[data-testid="panel-crons"] button', { hasText: 'All sessions' })
const sessionTab = page =>
  page.locator('[data-testid="panel-crons"] button', { hasText: 'This session' })

test.describe('Crons Panel - all sessions', () => {
  // SPEC: panel-cron:tabs
  // SPEC: panel-cron:all-sessions
  test('All sessions lists every running session soonest first, each naming its session', async ({
    page,
  }) => {
    const now = Date.now()
    const state = {
      others: [
        listedSession('s-docs', 'docs sweep', true),
        listedSession('s-off', 'stopped one', false),
      ],
      schedules: [
        scheduled(
          's-docs',
          'c2',
          '00000002',
          { cron: oneTimeCronMinutesAhead(now, 15), prompt: 'Nightly export', recurring: false },
          now - 900,
        ),
        scheduled(
          's-off',
          'c3',
          '00000003',
          { cron: oneTimeCronMinutesAhead(now, 5), prompt: 'Cannot fire', recurring: false },
          now - 800,
        ),
      ],
    }
    await mockWorkspace(page, state)
    const controller = await openLiveSession(page)
    await controller.sendEvents([
      human('Schedule mine', 't1', now - 1000),
      ...schedule(
        'c1',
        '00000001',
        { cron: oneTimeCronMinutesAhead(now, 40), prompt: 'Mine later', recurring: false },
        now - 950,
      ),
    ])

    await expect(sessionTab(page)).toHaveClass(/active/)
    await expect(sessionTab(page)).toContainText('1')
    await expect(allTab(page)).toContainText('2')
    await allTab(page).click()

    await expect(rows(page).locator('.cron-prompt')).toHaveText(['Nightly export', 'Mine later'])
    await expect(rows(page).locator('.cron-session-name')).toHaveText(['docs sweep', /.+/])
  })

  // SPEC: panel-cron:all-sessions
  test("another session's rows leave when it stops, return when it resumes, and follow its changes", async ({
    page,
  }) => {
    const now = Date.now()
    const docs = scheduled(
      's-docs',
      'c2',
      '00000002',
      { cron: oneTimeCronMinutesAhead(now, 15), prompt: 'Nightly export', recurring: false },
      now - 900,
    )
    const state = { others: [listedSession('s-docs', 'docs sweep', true)], schedules: [docs] }
    await mockWorkspace(page, state)
    await createSSEController(page)
    const daemon = await createDaemonSSEController(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
    await allTab(page).click()
    await expect(rows(page).locator('.cron-prompt')).toHaveText(['Nightly export'])
    const changed = () =>
      daemon.sendEvent({ type: 'sessions_changed', workspace_id: DEFAULT_WORKSPACE_ID })

    state.others = [listedSession('s-docs', 'docs sweep', false)]
    state.schedules = []
    await changed()
    await expect(page.locator('[data-testid="panel-crons"]')).toContainText('No scheduled prompts')

    state.others = [listedSession('s-docs', 'docs sweep', true)]
    state.schedules = [docs]
    await changed()
    await expect(rows(page).locator('.cron-prompt')).toHaveText(['Nightly export'])

    state.schedules = [
      {
        ...docs,
        events: [
          ...docs.events,
          ...schedule(
            'c4',
            '00000004',
            { cron: oneTimeCronMinutesAhead(now, 25), prompt: 'Added elsewhere', recurring: false },
            now - 100,
          ),
          ...unschedule('d1', '00000002', now - 50),
        ],
      },
    ]
    await changed()
    await expect(rows(page).locator('.cron-prompt')).toHaveText(['Added elsewhere'])
  })

  // SPEC: panel-cron:all-sessions
  test("another session's schedule shows as due while that session's agent works", async ({
    page,
  }) => {
    const now = Date.now()
    const state = {
      others: [listedSession('s-docs', 'docs sweep', true)],
      schedules: [
        scheduled(
          's-docs',
          'c2',
          '00000002',
          { cron: oneTimeCronMinutesAhead(now, -1), prompt: 'Held back', recurring: false },
          now - 600_000,
          { respondingSince: new Date(now - 240_000).toISOString() },
        ),
      ],
    }
    await mockWorkspace(page, state)
    await openLiveSession(page)
    await allTab(page).click()

    await expect(rows(page).locator('.cron-when')).toHaveText('due')
  })

  // SPEC: panel-cron:all-sessions-click
  test('clicking another session opens it at the scheduling call, Alt and middle-click open a new tab', async ({
    page,
  }) => {
    const now = Date.now()
    const state = {
      others: [listedSession('s-docs', 'docs sweep', true)],
      schedules: [
        scheduled(
          's-docs',
          'c9',
          '00000009',
          { cron: oneTimeCronMinutesAhead(now, 15), prompt: 'Nightly export', recurring: false },
          now - 900,
        ),
      ],
    }
    await mockWorkspace(page, state)
    const controller = await openLiveSession(page)
    await controller.sendEvents([
      human('Keep working', 't1', now - 1000),
      {
        type: 'assistant',
        subtype: 'text',
        content: 'Working on it',
        timestamp: now - 900,
        ts: new Date(now - 900).toISOString(),
      },
    ])
    await allTab(page).click()
    const row = rows(page).filter({ hasText: 'Nightly export' })
    await page.evaluate(() => {
      window.__opened = []
      window.open = url => {
        window.__opened.push(url)
        return null
      }
    })

    await row.click({ modifiers: ['Alt'] })
    await row.click({ button: 'middle' })
    const opened = await page.evaluate(() => window.__opened)
    expect(opened).toHaveLength(2)
    for (const url of opened) {
      expect(url).toContain('/sessions/s-docs/turns/a-t-c9/tool-c9')
    }

    await row.click()
    await expect(page).toHaveURL(/\/sessions\/s-docs\/turns\/a-t-c9\/tool-c9/)
    await expect(page.locator('[data-testid="still-running-toast"]')).toBeVisible()
  })

  // SPEC: panel-cron:all-sessions-click
  test("on This session, Alt+click opens the open session's row in a new tab", async ({ page }) => {
    await mockWorkspace(page, { others: [], schedules: [] })
    const controller = await openLiveSession(page)
    const now = Date.now()
    await controller.sendEvents([
      human('Schedule it', 't1', now - 1000),
      ...schedule(
        'c1',
        '00000001',
        { cron: dailyCronHoursAhead(now, 3), prompt: 'Morning summary' },
        now - 900,
      ),
    ])
    await page.evaluate(() => {
      window.__opened = []
      window.open = url => {
        window.__opened.push(url)
        return null
      }
    })

    await rows(page).click({ modifiers: ['Alt'] })

    const opened = await page.evaluate(() => window.__opened)
    expect(opened).toEqual([
      expect.stringContaining(`/sessions/${DEFAULT_SESSION_ID}/turns/a-t1/tool-c1`),
    ])
  })

  // SPEC: panel-cron:tab-auto-switch
  test('the tab follows session presence; a tab picked by hand holds until the next change', async ({
    page,
  }) => {
    await mockWorkspace(page, { others: [], schedules: [] })
    await openLiveSession(page)
    await expect(sessionTab(page)).toHaveClass(/active/)

    await page.evaluate(() => {
      history.pushState(null, '', window.location.pathname + window.location.search)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await expect(allTab(page)).toHaveClass(/active/, { timeout: 5000 })

    await page.evaluate(id => {
      window.location.hash = `#/workspaces/test-ws/sessions/${id}`
    }, DEFAULT_SESSION_ID)
    await expect(sessionTab(page)).toHaveClass(/active/, { timeout: 5000 })

    await allTab(page).click()
    await page.waitForTimeout(300)
    await expect(allTab(page)).toHaveClass(/active/)
  })

  // SPEC: panel-cron:all-sessions-error
  test('All sessions names a failed load instead of showing an empty list', async ({ page }) => {
    await mockWorkspace(page, { others: [], schedules: [], failSchedules: true })
    await openLiveSession(page)

    await allTab(page).click()

    const panel = page.locator('[data-testid="panel-crons"]')
    await expect(panel).toContainText("Could not load other sessions' schedules")
    await expect(panel).not.toContainText('No scheduled prompts')
  })
})
