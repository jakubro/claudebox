/** Tests for predictWorkEntryHeight. */

import { describe, expect, it } from 'vitest'
import {
  WORK_ENTRY_MIN_PREDICTED_HEIGHT_PX,
  WORK_ENTRY_SEPARATOR_HEIGHT_PX,
} from '../../../config/dimensions'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import {
  hasAnyWorkPanelContent,
  predictWorkEntryHeight,
  turnHasWorkPanelContent,
} from './predictWorkEntryHeight'

const EFFECTIVE_WIDTH = 400

function toolUseEvent(content, id, input = {}) {
  return { type: 'assistant', subtype: 'tool_use', content, tool_use_id: id, tool_input: input }
}

function toolResultEvent(id, opts = {}) {
  return { type: 'user', subtype: 'tool_result', tool_use_id: id, ...opts }
}

describe('predictWorkEntryHeight', () => {
  it('returns 0 for a null turn', () => {
    expect(predictWorkEntryHeight(null, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)).toBe(0)
  })

  it('returns 0 for a turn with only text/thinking - nothing routes to the panel', () => {
    const turn = {
      events: [
        { type: 'assistant', subtype: 'text', content: 'hello' },
        { type: 'assistant', subtype: 'thinking', content: 'thinking...' },
      ],
    }
    expect(predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)).toBe(0)
  })

  it('returns 0 under OFF even when the turn has top-level tool calls - nothing routes away', () => {
    const turn = { events: [toolUseEvent('Bash', 'b-1', { command: 'ls' })] }
    expect(predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.OFF)).toBe(0)
  })

  it('prices a routed-away tool call at least the minimum', () => {
    const turn = { events: [toolUseEvent('Edit', 'e-1', { file_path: 'a.js' })] }
    const predicted = predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)
    expect(predicted).toBeGreaterThanOrEqual(WORK_ENTRY_MIN_PREDICTED_HEIGHT_PX)
  })

  it('prices a routed-away Bash call higher than a routed-away Edit call', () => {
    const bashTurn = { events: [toolUseEvent('Bash', 'b-1', { command: 'ls' })] }
    const editTurn = { events: [toolUseEvent('Edit', 'e-1', { file_path: 'a.js' })] }
    const bashHeight = predictWorkEntryHeight(bashTurn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)
    const editHeight = predictWorkEntryHeight(editTurn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)
    expect(bashHeight).toBeGreaterThan(editHeight)
  })

  it('under BASH_ONLY, prices only the Bash call - a non-Bash tool call stays out of the panel', () => {
    const turn = {
      events: [
        toolUseEvent('Bash', 'b-1', { command: 'ls' }),
        toolUseEvent('Edit', 'e-1', { file_path: 'a.js' }),
      ],
    }
    const bashOnly = predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.BASH_ONLY)
    const bashSolo = predictWorkEntryHeight(
      { events: [toolUseEvent('Bash', 'b-1', { command: 'ls' })] },
      EFFECTIVE_WIDTH,
      TurnRoutingMode.BASH_ONLY,
    )
    expect(bashOnly).toBe(bashSolo)
  })

  it('grows with a wider header, narrower effective width widening the estimate', () => {
    const turn = {
      events: [toolUseEvent('Bash', 'b-1', { command: 'x'.repeat(400) })],
    }
    const wide = predictWorkEntryHeight(turn, 800, TurnRoutingMode.ALL_TOOLS)
    const narrow = predictWorkEntryHeight(turn, 100, TurnRoutingMode.ALL_TOOLS)
    expect(narrow).toBeGreaterThan(wide)
  })

  it('does not price a routed-away call whose only tool_use is a hidden ToolSearch', () => {
    const turn = {
      events: [toolUseEvent('ToolSearch', 'ts-1', { query: 'find' }), toolResultEvent('ts-1')],
    }
    expect(predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)).toBe(0)
  })

  it('does not route a nested (subagent) call to the panel', () => {
    const turn = {
      events: [
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'b-1',
          tool_input: { command: 'ls' },
          parent_tool_use_id: 'task-1',
        },
      ],
    }
    expect(predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)).toBe(0)
  })

  it('prices a turn with only a compaction event at the minimum', () => {
    const turn = { events: [{ type: 'system', subtype: 'compact_boundary', id: 'cb-1' }] }
    const predicted = predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)
    expect(predicted).toBeGreaterThanOrEqual(WORK_ENTRY_MIN_PREDICTED_HEIGHT_PX)
  })

  it('never prices below the separator height plus a single block', () => {
    const turn = { events: [toolUseEvent('Edit', 'e-1', { file_path: 'a.js' })] }
    const predicted = predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)
    expect(predicted).toBeGreaterThanOrEqual(WORK_ENTRY_SEPARATOR_HEIGHT_PX)
  })

  describe('cacheRef', () => {
    it('caches by turn_id, so a second call with the same id skips recomputation', () => {
      const turn = { turn_id: 't1', events: [toolUseEvent('Edit', 'e-1', { file_path: 'a.js' })] }
      const cacheRef = { current: new Map() }
      const first = predictWorkEntryHeight(
        turn,
        EFFECTIVE_WIDTH,
        TurnRoutingMode.ALL_TOOLS,
        cacheRef,
      )

      // A width change would normally reprice - a cache hit proves the second call never re-read.
      const second = predictWorkEntryHeight(turn, 1, TurnRoutingMode.ALL_TOOLS, cacheRef)

      expect(second).toBe(first)
      expect(cacheRef.current.get('t1')).toBe(first)
    })

    it('does not cache a turn with no turn_id', () => {
      const turn = { events: [toolUseEvent('Edit', 'e-1', { file_path: 'a.js' })] }
      const cacheRef = { current: new Map() }
      predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS, cacheRef)
      expect(cacheRef.current.size).toBe(0)
    })

    it('behaves identically to an uncached call when no cacheRef is supplied', () => {
      const turn = { turn_id: 't1', events: [toolUseEvent('Edit', 'e-1', { file_path: 'a.js' })] }
      const uncached = predictWorkEntryHeight(turn, EFFECTIVE_WIDTH, TurnRoutingMode.ALL_TOOLS)
      const cacheRef = { current: new Map() }
      const cached = predictWorkEntryHeight(
        turn,
        EFFECTIVE_WIDTH,
        TurnRoutingMode.ALL_TOOLS,
        cacheRef,
      )
      expect(cached).toBe(uncached)
    })
  })
})

describe('turnHasWorkPanelContent / hasAnyWorkPanelContent', () => {
  it('is false for a turn with only text', () => {
    const turn = { events: [{ type: 'assistant', subtype: 'text', content: 'hi' }] }
    expect(turnHasWorkPanelContent(turn, TurnRoutingMode.ALL_TOOLS)).toBe(false)
  })

  it('is true for a turn with a routed-away tool call', () => {
    const turn = { events: [toolUseEvent('Edit', 'e-1')] }
    expect(turnHasWorkPanelContent(turn, TurnRoutingMode.ALL_TOOLS)).toBe(true)
  })

  it('is false when the only tool call is a hidden ToolSearch', () => {
    const turn = {
      events: [toolUseEvent('ToolSearch', 'ts-1'), toolResultEvent('ts-1')],
    }
    expect(turnHasWorkPanelContent(turn, TurnRoutingMode.ALL_TOOLS)).toBe(false)
  })

  it('is true for a turn holding only a compaction event', () => {
    const turn = { events: [{ type: 'system', subtype: 'compact_boundary', id: 'cb-1' }] }
    expect(turnHasWorkPanelContent(turn, TurnRoutingMode.ALL_TOOLS)).toBe(true)
  })

  it('hasAnyWorkPanelContent is false when no turn in the session has any', () => {
    const turns = [
      { events: [{ type: 'assistant', subtype: 'text', content: 'hi' }] },
      { events: [] },
    ]
    expect(hasAnyWorkPanelContent(turns, TurnRoutingMode.ALL_TOOLS)).toBe(false)
  })

  it('hasAnyWorkPanelContent is true when one turn among many qualifies', () => {
    const turns = [
      { events: [{ type: 'assistant', subtype: 'text', content: 'hi' }] },
      { events: [toolUseEvent('Edit', 'e-1')] },
    ]
    expect(hasAnyWorkPanelContent(turns, TurnRoutingMode.ALL_TOOLS)).toBe(true)
  })
})
