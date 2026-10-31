/** E2E tests for a session waiting on background work it started. */

import { expect, test } from '@playwright/test'
import {
  captureSends,
  openLiveSessionWithAPI,
  serveSessionList,
  waitForAppReady,
} from '../helpers.js'
import {
  DEFAULT_CONTAINER_ID,
  DEFAULT_SESSION_URL,
  DEFAULT_WORKSPACE_ID,
  mockAPI,
} from '../mocks/api.js'
import { createDaemonSSEController, createSSEController } from '../mocks/sse.js'

let clock = Date.now()

function at() {
  clock += 100
  return { timestamp: clock, ts: new Date(clock).toISOString() }
}

function human(content, turnId) {
  return { type: 'user', subtype: 'text', is_human: true, content, turn_id: turnId, ...at() }
}

function say(content) {
  return { type: 'assistant', subtype: 'text', content, ...at() }
}

function backgroundCommand(toolUseId, taskId, input) {
  return [
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Bash',
      tool_name: 'Bash',
      tool_use_id: toolUseId,
      tool_input: { run_in_background: true, ...input },
      ...at(),
    },
    {
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: toolUseId,
      content: `Command running in background with ID: ${taskId}.`,
      tool_use_result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: taskId },
      ...at(),
    },
  ]
}

function backgroundSubagent(toolUseId, agentId, description) {
  return [
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Task',
      tool_name: 'Task',
      tool_use_id: toolUseId,
      tool_input: { description, prompt: 'Go', run_in_background: true },
      ...at(),
    },
    {
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: toolUseId,
      content: 'Async agent launched.',
      tool_use_result: { isAsync: true, status: 'async_launched', agentId, description },
      ...at(),
    },
  ]
}

function result(turnId) {
  return { type: 'result', subtype: 'success', turn_id: turnId, ...at() }
}

function notice(taskId, status = 'completed') {
  return {
    type: 'system',
    subtype: 'task_notification',
    message_data: { task_id: taskId, status, summary: 'done' },
    ...at(),
  }
}

async function startWaiting(page, controller, command, description) {
  await controller.sendEvents([
    human('Start it', 't1'),
    ...backgroundCommand('tu1', 'b1', { command, description }),
    result('t1'),
  ])
  await expect(page.getByTestId('turn-progress-waiting')).toBeVisible()
}

async function hideTab(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, writable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function faviconHref(page) {
  return page.evaluate(() => document.querySelector('link[rel="icon"]')?.href)
}

async function distinctFavicons(page, samples = 8, gapMs = 120) {
  const seen = new Set()
  for (let i = 0; i < samples; i++) {
    seen.add(await faviconHref(page))
    await page.waitForTimeout(gapMs)
  }
  return seen.size
}

test.describe('Waiting on background work', () => {
  test.beforeEach(() => {
    clock = Date.now()
  })

  // SPEC: chat:waiting-on-background
  // SPEC: chat:completed-duration
  // SPEC: turn:progress-waiting-ring
  test('a turn ending with a background command running names it until the agent finishes', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    const spinDuration = el => {
      const running = el.getAnimations().filter(a => a.playState === 'running')
      return running.length ? running[0].effect.getTiming().duration : null
    }

    await controller.sendEvents([human('Start the wait', 't1'), say('Starting it.')])
    const working = page.locator('.turn-progress-working .progress-spinner')
    await expect(working).toBeVisible()
    const workingDuration = await working.evaluate(spinDuration)
    expect(workingDuration).toBeGreaterThan(0)

    await controller.sendEvents([
      ...backgroundCommand('tu1', 'b1', { command: 'sleep 120', description: 'Wait two minutes' }),
      say('Started.'),
      result('t1'),
    ])

    const waiting = page.getByTestId('turn-progress-waiting')
    await expect(waiting).toHaveText('Waiting on Wait two minutes...')

    const ring = waiting.locator('.progress-spinner')
    const { tag, opacity } = await ring.evaluate(el => ({
      tag: el.tagName.toLowerCase(),
      opacity: Number(getComputedStyle(el).opacity),
    }))
    expect(tag).toBe('svg')
    expect(await ring.evaluate(spinDuration)).toBe(2 * workingDuration)
    expect(opacity).toBeLessThan(1)
    const ringBox = await ring.boundingBox()
    const labelBox = await waiting.locator('.turn-progress-label').boundingBox()
    expect(
      Math.abs(ringBox.y + ringBox.height / 2 - (labelBox.y + labelBox.height / 2)),
    ).toBeLessThanOrEqual(0.5)
    await expect(page.getByText(/worked for/)).toHaveCount(0)

    await controller.sendEvents([notice('b1'), say('The wait is over.'), result('t1')])

    await expect(page.getByText('The wait is over.')).toBeVisible()
    await expect(waiting).toHaveCount(0)
    await expect(page.getByText(/worked for/)).toBeVisible()
  })

  // SPEC: chat:waiting-on-background
  test('several tasks are counted, and a command with no description is named by its command', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    await controller.sendEvents([
      human('Start three', 't1'),
      ...backgroundCommand('tu1', 'b1', { command: 'npm run dev' }),
      ...backgroundCommand('tu2', 'b2', { command: 'sleep 60', description: 'Wait' }),
      ...backgroundSubagent('tu3', 'a3', 'Review the diff'),
      result('t1'),
    ])

    const waiting = page.getByTestId('turn-progress-waiting')
    await expect(waiting).toContainText('Waiting on 3 background tasks')

    await controller.sendEvents([
      notice('b2'),
      notice('a3', 'failed'),
      say('Two done.'),
      result('t1'),
    ])

    await expect(waiting).toContainText('Waiting on npm run dev')
  })

  // SPEC: chat:waiting-on-background
  test('a background subagent working after the turn ended keeps the session waiting, not working', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    await controller.sendEvents([
      human('Review it in the background', 't1'),
      ...backgroundSubagent('tu1', 'a1', 'Review the diff'),
      say('Launched.'),
      result('t1'),
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: 'nested1',
        tool_input: { command: 'git diff' },
        parent_tool_use_id: 'tu1',
        ...at(),
      },
    ])

    await expect(page.getByTestId('turn-progress-waiting')).toContainText(
      'Waiting on Review the diff',
    )
    await expect(page.getByTestId('footer-status')).toHaveAttribute('data-status', 'waiting')
  })

  // SPEC: chat:waiting-pickup-working
  test('between a task finishing and the agent picking up, the session shows working', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    await startWaiting(page, controller, 'sleep 5', 'Nap')

    await controller.sendEvents([notice('b1')])

    await expect(page.getByTestId('turn-progress-working')).toBeVisible()
    await expect(page.getByTestId('turn-progress-waiting')).toHaveCount(0)
    await expect(page.getByTestId('footer-status')).toHaveAttribute('data-status', 'working')
  })

  // SPEC: footer:status-waiting-background
  test('the footer reads Waiting, without a timer, while work runs', async ({ page }) => {
    const controller = await openLiveSessionWithAPI(page)

    await controller.sendEvents([
      human('Start it', 't1'),
      ...backgroundCommand('tu1', 'b1', { command: 'sleep 90', description: 'Wait' }),
      result('t1'),
    ])

    const status = page.getByTestId('footer-status')
    await expect(status).toHaveAttribute('data-status', 'waiting')
    await expect(page.locator('.footer-status-text')).toHaveText('Waiting...')
    await expect(page.locator('.footer-elapsed')).toHaveCount(0)

    await controller.sendEvents([notice('b1'), say('Done.'), result('t1')])

    await expect(status).toHaveAttribute('data-status', 'ready')
  })

  // SPEC: notify:favicon-waiting
  // SPEC: notify:favicon-processing
  test('the favicon shows a still arc while the session waits, and settles once it finishes', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)
    const normal = await faviconHref(page)

    await startWaiting(page, controller, 'sleep 90', 'Wait')

    await expect.poll(() => faviconHref(page)).not.toBe(normal)
    expect(await distinctFavicons(page)).toBe(1)

    await controller.sendEvents([notice('b1'), say('Done.'), result('t1')])
    await expect(page.getByText(/worked for/)).toBeVisible()

    await expect.poll(() => faviconHref(page)).toBe(normal)
  })

  // SPEC: notify:tab-indicator-prefix
  // SPEC: notify:favicon-change
  test('a hidden tab is marked done only once the session finishes', async ({ page }) => {
    const controller = await openLiveSessionWithAPI(page)
    await hideTab(page)

    await startWaiting(page, controller, 'sleep 90', 'Wait')
    await page.waitForTimeout(300)
    expect(await page.title()).not.toMatch(/^\* /)

    await controller.sendEvents([notice('b1'), say('All finished.'), result('t1')])

    await expect.poll(() => page.title()).toMatch(/^\* /)
    await expect.poll(() => distinctFavicons(page, 4)).toBe(1)
  })

  // SPEC: chat:waiting-accepts-messages
  test('a message sent while waiting starts a turn, and waiting returns after it if work remains', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)
    const sent = await captureSends(page)

    await startWaiting(page, controller, 'sleep 90', 'Long wait')

    const input = page.locator('[data-testid="chat-input"]')
    await input.fill('How is it going?')
    await input.press('Enter')

    await expect.poll(() => sent.length).toBe(1)
    await expect(page.getByTestId('turn-progress-waiting')).toHaveCount(0)

    await controller.sendEvents([
      human('How is it going?', 't2'),
      say('Still running.'),
      result('t2'),
    ])

    await expect(page.getByText('Still running.')).toBeVisible()
    const turns = page.getByTestId('turn-container')
    await expect(turns.last().getByTestId('turn-progress-waiting')).toContainText('Long wait')
    await expect(page.getByTestId('turn-progress-waiting')).toHaveCount(1)
  })

  // SPEC: chat:waiting-ends-on-stop
  test('a session stops waiting once its container stops', async ({ page }) => {
    test.setTimeout(20_000)
    // The daemon mock is injected last: the later EventSource mock wins, and only it tracks both streams.
    const controller = await createSSEController(page)
    const daemon = await createDaemonSSEController(page)
    await mockAPI(page)
    let stopped = false
    await serveSessionList(page, base => [
      { ...base, num_turns: 1, container_id: stopped ? undefined : DEFAULT_CONTAINER_ID },
    ])
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    await startWaiting(page, controller, 'sleep 900', 'Long wait')
    // The sessions list ignores a change signal arriving within 2 s of its last fetch.
    await page.waitForTimeout(2500)

    await daemon.sendContainerStatus(DEFAULT_CONTAINER_ID, 'stopping')
    await daemon.sendContainerStatus(DEFAULT_CONTAINER_ID, 'stopped')
    stopped = true
    await daemon.sendEvent({ type: 'sessions_changed', workspace_id: DEFAULT_WORKSPACE_ID })

    await expect(page.getByTestId('turn-progress-waiting')).toHaveCount(0)
    await expect(page.getByTestId('footer-status')).not.toHaveAttribute('data-status', 'waiting')
  })

  // SPEC: chat:waiting-ends-on-stop
  test('work still running when the session stopped is not waited on after resume', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    await controller.sendEvents([
      human('Start it', 't1'),
      ...backgroundCommand('tu1', 'b1', { command: 'sleep 900', description: 'Long wait' }),
      result('t1'),
      { type: 'system', subtype: 'container_restarted', ...at() },
      notice('b1', 'killed'),
      result('t1'),
    ])

    await expect(page.getByText(/worked for/)).toBeVisible()
    await expect(page.getByTestId('turn-progress-waiting')).toHaveCount(0)
    await expect(page.getByTestId('footer-status')).toHaveAttribute('data-status', 'ready')
  })

  // SPEC: chat:waiting-ends-on-stop
  test('work cut off by a restart is not waited on even without a kill notice', async ({
    page,
  }) => {
    const controller = await openLiveSessionWithAPI(page)

    await controller.sendEvents([
      human('Start it', 't1'),
      ...backgroundCommand('tu1', 'b1', { command: 'sleep 900', description: 'Long wait' }),
      result('t1'),
      { type: 'system', subtype: 'container_restarted', ...at() },
    ])

    await expect(page.getByText(/worked for/)).toBeVisible()
    await expect(page.getByTestId('turn-progress-waiting')).toHaveCount(0)
  })
})
