/** Tests for the Crons panel's "All sessions" merge. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeSessionCrons } from './sessionCrons'

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0)

function scheduled(toolUseId, id, cron, prompt, at = NOW - 60_000) {
  return [
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'CronCreate',
      tool_use_id: toolUseId,
      tool_input: { cron, prompt, recurring: false },
      ts: new Date(at).toISOString(),
    },
    {
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: toolUseId,
      tool_use_result: { id, recurring: false },
      ts: new Date(at).toISOString(),
    },
  ]
}

const sessionOf = sid => ({ sessionName: `name-${sid}`, sessionNameIsAuto: false })

describe('mergeSessionCrons', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('orders every running session by next fire, each row naming its session', () => {
    const sources = [
      {
        sessionId: 's1',
        events: scheduled('a', '00000001', '30 12 12 10 *', 'Later'),
        respondingSince: null,
      },
      {
        sessionId: 's2',
        events: scheduled('b', '00000002', '10 12 12 10 *', 'Sooner'),
        respondingSince: null,
      },
    ]

    const rows = mergeSessionCrons({
      own: null,
      sources,
      now: NOW,
      isRunning: () => true,
      sessionOf,
    })

    expect(rows.map(r => [r.prompt, r.sessionId, r.sessionName])).toEqual([
      ['Sooner', 's2', 'name-s2'],
      ['Later', 's1', 'name-s1'],
    ])
  })

  it('drops a session whose schedules cannot fire', () => {
    const sources = [
      {
        sessionId: 's1',
        events: scheduled('a', '00000001', '30 12 12 10 *', 'Kept'),
        respondingSince: null,
      },
      {
        sessionId: 's2',
        events: scheduled('b', '00000002', '10 12 12 10 *', 'Stopping'),
        respondingSince: null,
      },
    ]

    const rows = mergeSessionCrons({
      own: null,
      sources,
      now: NOW,
      isRunning: sid => sid === 's1',
      sessionOf,
    })

    expect(rows.map(r => r.prompt)).toEqual(['Kept'])
  })

  it("takes the open session's live rows once loaded and its copy from the route while it loads", () => {
    const sources = [
      {
        sessionId: 's1',
        events: scheduled('a', '00000001', '30 12 12 10 *', 'Route copy'),
        respondingSince: null,
      },
    ]
    const live = [{ prompt: 'Live row', toolUseId: 'a', nextFireAt: NOW + 1 }]
    const merge = loading =>
      mergeSessionCrons({
        own: { sessionId: 's1', crons: live, loading },
        sources,
        now: NOW,
        isRunning: () => true,
        sessionOf,
      }).map(r => r.prompt)

    expect(merge(false)).toEqual(['Live row'])
    expect(merge(true)).toEqual(['Route copy'])
  })

  it("keeps another session's row due while that session is answering", () => {
    const sources = [
      {
        sessionId: 's2',
        events: scheduled('b', '00000002', '59 11 12 10 *', 'Held', NOW - 600_000),
        respondingSince: NOW - 120_000,
      },
    ]

    const [row] = mergeSessionCrons({
      own: null,
      sources,
      now: NOW,
      isRunning: () => true,
      sessionOf,
    })

    expect(row.due).toBe(true)
  })
})
