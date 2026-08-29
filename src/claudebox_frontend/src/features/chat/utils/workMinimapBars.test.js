/** Tests for buildWorkMinimapBars - one overview bar per working turn. */

import { describe, expect, it } from 'vitest'
import { MINIMAP_MIN_WIDTH } from '../../../config/dimensions'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import { buildWorkMinimapBars } from './workMinimapBars'

function toolUseEvent(id, ts, input = {}) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content: 'Bash',
    tool_use_id: id,
    tool_input: input,
    ts,
  }
}

function toolResultEvent(id, ts, overrides = {}) {
  return {
    type: 'assistant',
    subtype: 'tool_result',
    tool_use_id: id,
    content: 'ok',
    ts,
    ...overrides,
  }
}

function turn(turnId, events) {
  return { turn_id: turnId, events }
}

function cache() {
  return { current: new Map() }
}

describe('buildWorkMinimapBars', () => {
  it('returns one bar per turn that routed something away, skipping prose-only turns', () => {
    const turns = [
      turn('t1', [
        toolUseEvent('e1', '2024-01-01T00:00:00.000Z'),
        toolResultEvent('e1', '2024-01-01T00:00:01.000Z'),
      ]),
      turn('t2', [{ type: 'assistant', subtype: 'text', content: 'hi' }]),
      turn('t3', [
        toolUseEvent('e3', '2024-01-01T00:00:00.000Z'),
        toolResultEvent('e3', '2024-01-01T00:00:01.000Z'),
      ]),
    ]

    const bars = buildWorkMinimapBars(turns, 400, TurnRoutingMode.ALL_TOOLS, cache())

    expect(bars.map(b => b.id)).toEqual(['t1', 't3'])
  })

  it('marks a turn whose call succeeded as passed', () => {
    const turns = [
      turn('t1', [
        toolUseEvent('e1', '2024-01-01T00:00:00.000Z'),
        toolResultEvent('e1', '2024-01-01T00:00:01.000Z'),
      ]),
    ]
    const [bar] = buildWorkMinimapBars(turns, 400, TurnRoutingMode.ALL_TOOLS, cache())
    expect(bar.status).toBe('passed')
  })

  it('marks a turn with a failed call as failed - read through extractToolResult, the same path the block renders from', () => {
    const turns = [
      turn('t1', [
        toolUseEvent('e1', '2024-01-01T00:00:00.000Z'),
        toolResultEvent('e1', '2024-01-01T00:00:01.000Z', {
          content: '<tool_use_error>boom</tool_use_error>',
        }),
      ]),
    ]
    const [bar] = buildWorkMinimapBars(turns, 400, TurnRoutingMode.ALL_TOOLS, cache())
    expect(bar.status).toBe('failed')
  })

  it('marks a turn with an unresolved call as running, not failed or passed', () => {
    const turns = [turn('t1', [toolUseEvent('e1', '2024-01-01T00:00:00.000Z')])]
    const [bar] = buildWorkMinimapBars(turns, 400, TurnRoutingMode.ALL_TOOLS, cache())
    expect(bar.status).toBe('running')
  })

  it('computes duration as the turn events span, prices height, and normalizes width', () => {
    const turns = [
      turn('t1', [
        toolUseEvent('e1', '2024-01-01T00:00:00.000Z'),
        toolResultEvent('e1', '2024-01-01T00:00:00.000Z'),
      ]),
      turn('t2', [
        toolUseEvent('e2', '2024-01-01T00:00:00.000Z'),
        toolResultEvent('e2', '2024-01-01T00:01:00.000Z'),
      ]),
    ]
    const bars = buildWorkMinimapBars(turns, 400, TurnRoutingMode.ALL_TOOLS, cache())
    expect(bars[0].duration).toBe(0)
    expect(bars[1].duration).toBe(60000)
    expect(bars[0].width).toBe(MINIMAP_MIN_WIDTH)
    expect(bars[1].width).toBeGreaterThan(bars[0].width)
    expect(bars[0].height).toBeGreaterThan(0)
  })

  it('leaves duration absent (not zero) for a turn with no timestamped events', () => {
    const turns = [
      turn('t1', [{ type: 'assistant', subtype: 'tool_use', content: 'Bash', tool_use_id: 'e1' }]),
    ]
    const [bar] = buildWorkMinimapBars(turns, 400, TurnRoutingMode.ALL_TOOLS, cache())
    expect(bar.duration).toBeNull()
  })

  it('withholds the trailing turn from the shared cache, so it re-prices on the next call', () => {
    const shared = cache()
    const growing = turn('t1', [toolUseEvent('e1', '2024-01-01T00:00:00.000Z')])
    buildWorkMinimapBars([growing], 400, TurnRoutingMode.ALL_TOOLS, shared)
    expect(shared.current.has('t1')).toBe(false)
  })

  it('caches a settled non-trailing turn, keyed by turn_id', () => {
    const shared = cache()
    const settled = turn('t1', [
      toolUseEvent('e1', '2024-01-01T00:00:00.000Z'),
      toolResultEvent('e1', '2024-01-01T00:00:01.000Z'),
    ])
    const trailing = turn('t2', [toolUseEvent('e2', '2024-01-01T00:00:00.000Z')])
    buildWorkMinimapBars([settled, trailing], 400, TurnRoutingMode.ALL_TOOLS, shared)
    expect(shared.current.has('t1')).toBe(true)
    expect(shared.current.has('t2')).toBe(false)
  })
})
