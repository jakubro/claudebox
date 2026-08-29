/** Tests for buildTerminalMinimapBars - one overview bar per command. */

import { describe, expect, it } from 'vitest'
import { MINIMAP_MIN_WIDTH } from '../../../config/dimensions'
import { buildTerminalMinimapBars } from './terminalMinimapBars'

function entry(id, overrides = {}) {
  return {
    id,
    turnId: `t-${id}`,
    command: `echo ${id}`,
    description: null,
    callTs: '2024-01-01T00:00:00.000Z',
    result: { content: 'ok', is_error: false, ts: '2024-01-01T00:00:01.000Z' },
    ...overrides,
  }
}

function cache() {
  return { current: new Map() }
}

describe('buildTerminalMinimapBars', () => {
  it('returns one bar per entry, in order', () => {
    const bars = buildTerminalMinimapBars([entry('a'), entry('b'), entry('c')], cache())

    expect(bars.map(b => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('marks a passing entry as passed', () => {
    const [bar] = buildTerminalMinimapBars([entry('a')], cache())
    expect(bar.status).toBe('passed')
  })

  it('marks a failing entry as failed - the same predicate the command line uses', () => {
    const [bar] = buildTerminalMinimapBars(
      [entry('a', { result: { content: 'boom', is_error: true, ts: '2024-01-01T00:00:01.000Z' } })],
      cache(),
    )
    expect(bar.status).toBe('failed')
  })

  it('marks an entry with no result yet as running, not failed or passed', () => {
    const [bar] = buildTerminalMinimapBars([entry('a', { result: null })], cache())
    expect(bar.status).toBe('running')
  })

  it('computes duration as result.ts minus callTs', () => {
    const [bar] = buildTerminalMinimapBars(
      [
        entry('a', {
          callTs: '2024-01-01T00:00:00.000Z',
          result: { content: 'ok', is_error: false, ts: '2024-01-01T00:00:05.000Z' },
        }),
      ],
      cache(),
    )
    expect(bar.duration).toBe(5000)
  })

  it('leaves duration absent (not zero) for a still-running entry, distinct from an instant one', () => {
    const [running, instant] = buildTerminalMinimapBars(
      [
        entry('a', { result: null }),
        entry('b', {
          callTs: '2024-01-01T00:00:00.000Z',
          result: { content: 'ok', is_error: false, ts: '2024-01-01T00:00:00.000Z' },
        }),
      ],
      cache(),
    )
    expect(running.duration).toBeNull()
    expect(instant.duration).toBe(0)
    // Both render at the same minimum width - the distinction lives in `duration`, not `width`.
    expect(running.width).toBe(instant.width)
  })

  it('leaves duration absent when the call carries no callTs', () => {
    const [bar] = buildTerminalMinimapBars([entry('a', { callTs: null })], cache())
    expect(bar.duration).toBeNull()
  })

  it('normalizes width across every entry, min for the fastest, max-bound for the slowest', () => {
    const bars = buildTerminalMinimapBars(
      [
        entry('a', {
          callTs: '2024-01-01T00:00:00.000Z',
          result: { content: 'ok', is_error: false, ts: '2024-01-01T00:00:00.000Z' },
        }),
        entry('b', {
          callTs: '2024-01-01T00:00:00.000Z',
          result: { content: 'ok', is_error: false, ts: '2024-01-01T00:01:00.000Z' },
        }),
      ],
      cache(),
    )
    expect(bars[0].width).toBe(MINIMAP_MIN_WIDTH)
    expect(bars[1].width).toBeGreaterThan(bars[0].width)
  })

  it('prices height from the same content prediction the virtualizer estimates from', () => {
    const bars = buildTerminalMinimapBars(
      [
        entry('a', {
          result: { content: 'one line', is_error: false, ts: '2024-01-01T00:00:01.000Z' },
        }),
        entry('b', {
          result: {
            content: 'line one\nline two\nline three\nline four',
            is_error: false,
            ts: '2024-01-01T00:00:01.000Z',
          },
        }),
      ],
      cache(),
    )
    expect(bars[1].height).toBeGreaterThan(bars[0].height)
  })

  it('shares the metrics cache with a second caller, keyed by entry id', () => {
    const shared = cache()
    buildTerminalMinimapBars([entry('a')], shared)

    expect(shared.current.has('a')).toBe(true)
  })
})
