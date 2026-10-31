/** Tests for the events reducer's request lifetimes and creation record. */

import { describe, expect, it } from 'vitest'
import { eventsReducer, initialState } from './eventsReducer'

function run(...actions) {
  return actions.reduce(eventsReducer, initialState)
}

describe('resume request lifetime', () => {
  it('keeps "Resuming" when the previous stream ends its replay while the open is pending', () => {
    const state = run(
      { type: 'REPLAY_STARTED', count: 0 },
      { type: 'RESUME_STARTED', token: 1 },
      { type: 'REPLAY_ENDED' },
    )

    expect(state.isResuming).toBe(true)
  })

  it('lets the replay end "Resuming" once the open has settled', () => {
    const state = run(
      { type: 'RESUME_STARTED', token: 1 },
      { type: 'RESUME_REQUEST_SETTLED', token: 1 },
      { type: 'REPLAY_STARTED', count: 0 },
      { type: 'REPLAY_ENDED' },
    )

    expect(state.isResuming).toBe(false)
  })

  it('ignores a settle carrying a superseded token', () => {
    const state = run(
      { type: 'RESUME_STARTED', token: 1 },
      { type: 'RESUME_STARTED', token: 2 },
      { type: 'RESUME_REQUEST_SETTLED', token: 1 },
      { type: 'REPLAY_ENDED' },
    )

    expect(state.isResuming).toBe(true)
  })

  it('aborts outright', () => {
    const state = run({ type: 'RESUME_STARTED', token: 1 }, { type: 'RESUME_CLEARED' })

    expect(state.isResuming).toBe(false)
    expect(state.resumeRequest).toBe(null)
  })
})

describe('create request lifetime', () => {
  it('ignores the soft end while the create is pending', () => {
    const state = run({ type: 'CREATING_STARTED', seq: 1 }, { type: 'CREATING_ENDED' })

    expect(state.isCreating).toBe(true)
  })

  it('applies the soft end once the create has settled, recording its session', () => {
    const settled = run(
      { type: 'CREATING_STARTED', seq: 1 },
      { type: 'CREATE_REQUEST_SETTLED', seq: 1, sessionId: 'sess-c' },
    )
    expect(settled.creations.bySeq[1]).toEqual({
      status: 'created',
      sessionId: 'sess-c',
      fromRoute: null,
    })

    expect(eventsReducer(settled, { type: 'CREATING_ENDED' }).isCreating).toBe(false)
  })

  it('ignores a settle for an earlier sequence', () => {
    const state = run(
      { type: 'CREATING_STARTED', seq: 1 },
      { type: 'CREATING_STARTED', seq: 2 },
      { type: 'CREATE_REQUEST_SETTLED', seq: 1, sessionId: 'sess-old' },
      { type: 'CREATING_ENDED' },
    )

    expect(state.isCreating).toBe(true)
    expect(state.createRequest).toBe(2)
  })

  it('records a failed creation and clears "Creating"', () => {
    const state = run({ type: 'CREATING_STARTED', seq: 1 }, { type: 'CREATING_FAILED', seq: 1 })

    expect(state.isCreating).toBe(false)
    expect(state.creations.bySeq[1].status).toBe('failed')
  })

  it('marks a created session routed only once it is created', () => {
    const pending = run({ type: 'CREATING_STARTED', seq: 1 }, { type: 'CREATION_ROUTED', seq: 1 })
    expect(pending.creations.bySeq[1].status).toBe('pending')

    const routed = run(
      { type: 'CREATING_STARTED', seq: 1 },
      { type: 'CREATE_REQUEST_SETTLED', seq: 1, sessionId: 'sess-c' },
      { type: 'CREATION_ROUTED', seq: 1 },
    )
    expect(routed.creations.bySeq[1].status).toBe('routed')
  })
})

describe('resets keep the request markers and the creation record', () => {
  const started = run(
    { type: 'RESUME_STARTED', token: 3 },
    { type: 'CREATING_STARTED', seq: 1, fromRoute: 'A' },
  )

  it.each([
    ['CLEAR_EVENTS', { type: 'CLEAR_EVENTS' }],
    ['REPLAY_ABANDONED', { type: 'REPLAY_ABANDONED' }],
  ])('%s', (_name, action) => {
    const state = eventsReducer(started, action)

    expect(state.resumeRequest).toBe(3)
    expect(state.createRequest).toBe(1)
    expect(state.creations.bySeq[1]).toEqual({ status: 'pending', sessionId: null, fromRoute: 'A' })
  })

  it('the first replay slice', () => {
    const armed = eventsReducer(started, { type: 'REPLAY_STARTED', count: 1 })
    const state = eventsReducer(armed, {
      type: 'REPLAY_SLICE',
      batchEvents: [{ type: 'user', subtype: 'message', content: 'hi' }],
    })

    expect(state.resumeRequest).toBe(3)
    expect(state.createRequest).toBe(1)
  })
})

describe('background work state', () => {
  const launchEvents = [
    { type: 'user', subtype: 'text', is_human: true, content: 'go', turn_id: 't1' },
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Bash',
      tool_use_id: 'tu1',
      tool_input: { command: 'sleep 90', description: 'Wait ninety seconds' },
    },
    {
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: 'tu1',
      tool_use_result: { backgroundTaskId: 'b1' },
    },
    { type: 'result', subtype: 'success', turn_id: 't1' },
  ]

  it('folds launches and the last turn end across flushes', () => {
    const state = run(
      { type: 'FLUSH_BATCH', batchEvents: launchEvents.slice(0, 2) },
      { type: 'FLUSH_BATCH', batchEvents: launchEvents.slice(2) },
    )

    expect(state.backgroundLaunches.get('b1')).toMatchObject({
      name: 'Wait ninety seconds',
      index: 2,
    })
    expect(state.lastSettledIndex).toBe(3)
  })

  it('places a completion notice after the turn end in log order', () => {
    const state = run(
      { type: 'FLUSH_BATCH', batchEvents: launchEvents },
      {
        type: 'FLUSH_BATCH',
        batchEvents: [
          {
            type: 'system',
            subtype: 'task_notification',
            message_data: { task_id: 'b1', status: 'completed' },
          },
        ],
      },
    )

    expect(state.taskNotifications.get('b1').index).toBeGreaterThan(state.lastSettledIndex)
  })

  it('moves the settled position on a human message and the restart position on a restart', () => {
    const state = run(
      { type: 'FLUSH_BATCH', batchEvents: launchEvents },
      {
        type: 'FLUSH_BATCH',
        batchEvents: [
          { type: 'system', subtype: 'container_restarted' },
          { type: 'user', subtype: 'text', is_human: true, content: 'next', turn_id: 't2' },
        ],
      },
    )

    expect(state.lastRestartIndex).toBe(4)
    expect(state.lastSettledIndex).toBe(5)
  })

  it('does not settle on a message nested inside a subagent', () => {
    const state = run({
      type: 'FLUSH_BATCH',
      batchEvents: [{ type: 'user', subtype: 'text', is_human: true, parent_tool_use_id: 'task1' }],
    })

    expect(state.lastSettledIndex).toBe(-1)
  })

  it('clears launches when a replay replaces the transcript', () => {
    const state = run(
      { type: 'FLUSH_BATCH', batchEvents: launchEvents },
      { type: 'REPLAY_STARTED', count: 1 },
      { type: 'REPLAY_SLICE', batchEvents: [{ type: 'assistant', subtype: 'text', content: 'x' }] },
    )

    expect(state.backgroundLaunches.size).toBe(0)
    expect(state.lastSettledIndex).toBe(-1)
  })

  it('clears launches when events are cleared', () => {
    const state = run({ type: 'FLUSH_BATCH', batchEvents: launchEvents }, { type: 'CLEAR_EVENTS' })

    expect(state.backgroundLaunches.size).toBe(0)
    expect(state.lastRestartIndex).toBe(-1)
  })
})

describe('responding fold', () => {
  const at = iso => new Date(iso).getTime()
  const fold = events =>
    events.reduce(
      (state, event) => eventsReducer(state, { type: 'STREAMING_FLAGS', event }),
      initialState,
    )

  it.each([
    [
      'starts',
      [{ type: 'assistant', subtype: 'text', ts: '2026-10-20T10:00:01Z' }],
      at('2026-10-20T10:00:01Z'),
    ],
    [
      'holds',
      [
        { type: 'assistant', subtype: 'text', ts: '2026-10-20T10:00:01Z' },
        { type: 'assistant', subtype: 'tool_use', ts: '2026-10-20T10:00:02Z' },
      ],
      at('2026-10-20T10:00:01Z'),
    ],
    [
      'result-ends',
      [
        { type: 'assistant', subtype: 'text', ts: '2026-10-20T10:00:01Z' },
        { type: 'result', subtype: 'success', ts: '2026-10-20T10:00:02Z' },
      ],
      null,
    ],
    [
      'error-ends',
      [
        { type: 'assistant', subtype: 'text', ts: '2026-10-20T10:00:01Z' },
        { type: 'system', subtype: 'error', ts: '2026-10-20T10:00:02Z' },
      ],
      null,
    ],
    [
      'nested-leaves-it',
      [{ type: 'assistant', subtype: 'text', ts: '2026-10-20T10:00:01Z', parent_tool_use_id: 'x' }],
      null,
    ],
    [
      'human-leaves-it',
      [{ type: 'user', subtype: 'text', is_human: true, ts: '2026-10-20T10:00:01Z' }],
      null,
    ],
  ])('%s', (_name, events, since) => {
    expect(fold(events).respondingSince).toBe(since)
  })
})
