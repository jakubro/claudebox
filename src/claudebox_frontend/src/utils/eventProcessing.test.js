/** Tests for eventProcessing helper functions. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendBackgroundLaunches,
  appendSubagentLabels,
  appendTaskNotifications,
  appendTodoDiffs,
  appendTurnResults,
  appendTurns,
  blockRoutesToRightSlot,
  computeDuplicateAskUserIds,
  computeTimingOffsets,
  extractCrons,
  extractTasks,
  extractThinkingFromText,
  getAskUserFingerprint,
  hasUnclaimedCompletion,
  hasVisibleBlock,
  INITIAL_TURN_GROUPING_STATE,
  indexEvents,
  injectedByToolUse,
  isHiddenInFocused,
  isHiddenToolSearch,
  isInterruptAck,
  isToolBlockHidden,
  isToolBlockVisible,
  isTopLevelBashCall,
  isVisibleEvent,
  processEvents,
  processNestedEvents,
  selectRunningBackgroundWork,
  TurnRoutingMode,
} from './eventProcessing'

function helloTurn() {
  return appendTurns([], INITIAL_TURN_GROUPING_STATE, [
    { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
  ])
}

describe('computeTimingOffsets', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime()

  it('returns null for all when turnStartTime is null', () => {
    const result = computeTimingOffsets(['2026-01-01T00:00:05Z', '2026-01-01T00:00:10Z'], null)
    expect(result).toEqual([null, null])
  })

  it('shows offset only when delta >= 30s from last shown', () => {
    const timestamps = [
      '2026-01-01T00:00:05Z', // +5s -> skip (5 < 30)
      '2026-01-01T00:00:20Z', // +20s -> skip (20 < 30)
      '2026-01-01T00:00:35Z', // +35s -> show (35 >= 30)
      '2026-01-01T00:00:40Z', // +40s -> skip (40-35=5 < 30)
      '2026-01-01T00:01:10Z', // +70s -> show (70-35=35 >= 30)
    ]
    const result = computeTimingOffsets(timestamps, base)
    expect(result).toEqual([null, null, 35, null, 70])
  })

  it('handles null timestamps in the list', () => {
    const timestamps = [null, '2026-01-01T00:00:40Z', null]
    const result = computeTimingOffsets(timestamps, base)
    expect(result).toEqual([null, 40, null])
  })

  it('uses custom threshold', () => {
    const timestamps = ['2026-01-01T00:00:10Z', '2026-01-01T00:00:15Z']
    const result = computeTimingOffsets(timestamps, base, 10)
    expect(result).toEqual([10, null])
  })
})

describe('indexEvents', () => {
  describe('toolResults indexing', () => {
    it('indexes tool_result events by tool_use_id', () => {
      const events = [
        {
          subtype: 'tool_result',
          tool_use_id: 'tu_123',
          content: 'result',
        },
      ]

      const { toolResults } = indexEvents(events)

      expect(toolResults.get('tu_123')).toEqual(events[0])
    })

    it('handles multiple tool results', () => {
      const events = [
        { subtype: 'tool_result', tool_use_id: 'tu_1' },
        { subtype: 'tool_result', tool_use_id: 'tu_2' },
      ]

      const { toolResults } = indexEvents(events)

      expect(toolResults.size).toBe(2)
      expect(toolResults.has('tu_1')).toBe(true)
      expect(toolResults.has('tu_2')).toBe(true)
    })

    it('skips tool_result without tool_use_id', () => {
      const events = [{ subtype: 'tool_result' }]

      const { toolResults } = indexEvents(events)

      expect(toolResults.size).toBe(0)
    })
  })

  describe('nestedEvents indexing', () => {
    it('groups events by parent_tool_use_id', () => {
      const events = [
        {
          subtype: 'text',
          parent_tool_use_id: 'parent_1',
          content: 'nested',
        },
        { subtype: 'tool_use', parent_tool_use_id: 'parent_1' },
      ]

      const { nestedEvents } = indexEvents(events)

      expect(nestedEvents.get('parent_1')).toHaveLength(2)
    })

    it('separates events by different parents', () => {
      const events = [
        { subtype: 'text', parent_tool_use_id: 'parent_1' },
        { subtype: 'text', parent_tool_use_id: 'parent_2' },
      ]

      const { nestedEvents } = indexEvents(events)

      expect(nestedEvents.get('parent_1')).toHaveLength(1)
      expect(nestedEvents.get('parent_2')).toHaveLength(1)
    })

    it('drops a tailed copy of a call already delivered live', () => {
      const events = [
        { subtype: 'tool_use', tool_use_id: 'tu_1', parent_tool_use_id: 'task_1' },
        {
          subtype: 'tool_use',
          tool_use_id: 'tu_1',
          parent_tool_use_id: 'task_1',
          source_file: 'agent.jsonl',
        },
      ]

      const { nestedEvents } = indexEvents(events)

      expect(nestedEvents.get('task_1')).toEqual([events[0]])
    })

    it('drops a tailed copy of narration already delivered live, matched on trimmed content', () => {
      const events = [
        { subtype: 'text', content: 'Checking files...', parent_tool_use_id: 'task_1' },
        {
          subtype: 'text',
          content: '  Checking files...  ',
          parent_tool_use_id: 'task_1',
          source_file: 'agent.jsonl',
        },
      ]

      const { nestedEvents } = indexEvents(events)

      expect(nestedEvents.get('task_1')).toEqual([events[0]])
    })

    it('keeps a call and its own result - subtype is part of the key', () => {
      const events = [
        { subtype: 'tool_use', tool_use_id: 'tu_1', parent_tool_use_id: 'task_1' },
        {
          subtype: 'tool_result',
          tool_use_id: 'tu_1',
          parent_tool_use_id: 'task_1',
          source_file: 'agent.jsonl',
        },
      ]

      const { nestedEvents } = indexEvents(events)

      expect(nestedEvents.get('task_1')).toEqual(events)
    })

    it('keeps two genuinely repeated lines from the same source', () => {
      const events = [
        { subtype: 'text', content: 'Checking files...', parent_tool_use_id: 'task_1' },
        { subtype: 'text', content: 'Checking files...', parent_tool_use_id: 'task_1' },
      ]

      const { nestedEvents } = indexEvents(events)

      expect(nestedEvents.get('task_1')).toEqual(events)
    })

    it('does not dedup the same call across different parents', () => {
      const events = [
        { subtype: 'tool_use', tool_use_id: 'tu_1', parent_tool_use_id: 'task_a' },
        {
          subtype: 'tool_use',
          tool_use_id: 'tu_1',
          parent_tool_use_id: 'task_b',
          source_file: 'agent.jsonl',
        },
      ]

      const { nestedEvents } = indexEvents(events)

      expect(nestedEvents.get('task_a')).toEqual([events[0]])
      expect(nestedEvents.get('task_b')).toEqual([events[1]])
    })
  })

  describe('skillContent indexing', () => {
    const skillCall = id => ({
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Skill',
      tool_use_id: id,
    })
    const result = (id, extra = {}) => ({
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: id,
      content: 'Launching skill: notes',
      ...extra,
    })
    const userText = content => ({ type: 'user', subtype: 'text', is_human: false, content })
    const NOTE =
      '(Re-invocation of /notes \u2014 the skill instructions were previously loaded; the arguments or dynamic output below are new.)'

    it('associates the user text after the Skill call result', () => {
      const body = userText('# Skill markdown')
      const { skillContent, skillTexts } = indexEvents([
        skillCall('skill_1'),
        result('skill_1'),
        body,
      ])

      expect(skillContent.get('skill_1')).toBe('# Skill markdown')
      expect([...skillTexts]).toEqual([body])
    })

    it('ignores user text from human', () => {
      const events = [
        skillCall('skill_1'),
        result('skill_1'),
        { type: 'user', subtype: 'text', is_human: true, content: 'Human input' },
      ]

      const { skillContent } = indexEvents(events)

      expect(skillContent.has('skill_1')).toBe(false)
    })

    it('takes no text once an assistant event follows the result', () => {
      const events = [
        skillCall('skill_1'),
        result('skill_1'),
        { type: 'assistant', subtype: 'text', content: 'Some text' },
        userText('Should not attach'),
      ]

      const { skillContent, skillTexts } = indexEvents(events)

      expect(skillContent.has('skill_1')).toBe(false)
      expect(skillTexts.size).toBe(0)
    })

    it('passes over the re-invocation note and takes the text after it', () => {
      const note = userText(NOTE)
      const second = userText('# Notes\nARGUMENTS: second')
      const events = [
        skillCall('skill_1'),
        result('skill_1'),
        userText('# Notes\nARGUMENTS: first'),
        skillCall('skill_2'),
        result('skill_2'),
        note,
        second,
      ]

      const { skillContent, skillTexts } = indexEvents(events)

      expect(skillContent.get('skill_1')).toBe('# Notes\nARGUMENTS: first')
      expect(skillContent.get('skill_2')).toBe('# Notes\nARGUMENTS: second')
      expect(skillTexts.has(note)).toBe(true)
      expect(skillTexts.has(second)).toBe(true)
    })

    it('keeps the pairing across a rate-limit event and another call between call and result', () => {
      const events = [
        skillCall('skill_1'),
        { type: 'assistant', subtype: 'tool_use', content: 'Read', tool_use_id: 'read_1' },
        { type: 'system', subtype: 'rate_limit' },
        { type: 'user', subtype: 'tool_result', tool_use_id: 'read_1', content: 'file text' },
        result('skill_1'),
        userText('# Skill body'),
      ]

      const { skillContent } = indexEvents(events)

      expect(skillContent.get('skill_1')).toBe('# Skill body')
    })

    it('a reload with no new arguments takes the already-loaded line', () => {
      const line = 'Skill /notes is already loaded above; instructions unchanged.'
      const events = [skillCall('skill_1'), result('skill_1'), userText(line)]

      expect(indexEvents(events).skillContent.get('skill_1')).toBe(line)
    })

    it('a failed Skill call takes no text', () => {
      const events = [
        skillCall('skill_1'),
        result('skill_1', { is_error: true }),
        userText('Stop hook feedback: keep going'),
      ]

      expect(indexEvents(events).skillTexts.size).toBe(0)
    })

    it("leaves LangGraph's skill tool, whose result is the text, out of the pairing", () => {
      const events = [
        { type: 'assistant', subtype: 'tool_use', content: 'skill', tool_use_id: 'lg_1' },
        result('lg_1'),
        userText('unrelated'),
      ]

      expect(indexEvents(events).skillTexts.size).toBe(0)
    })
  })

  describe('compactionSummary indexing', () => {
    it('associates user text after compact_boundary', () => {
      const events = [
        { id: 'compact_1', subtype: 'compact_boundary' },
        { type: 'user', subtype: 'text', is_human: false, content: 'Summary text' },
      ]

      const { compactionSummary } = indexEvents(events)

      expect(compactionSummary.get('compact_1')).toEqual(['Summary text'])
    })

    it('collects multiple non-human user messages after compact_boundary', () => {
      const events = [
        { id: 'compact_1', subtype: 'compact_boundary' },
        { type: 'user', subtype: 'text', is_human: false, content: 'Summary text' },
        {
          type: 'user',
          subtype: 'text',
          is_human: false,
          content: '<local-command-stdout>output</local-command-stdout>',
        },
      ]

      const { compactionSummary } = indexEvents(events)

      expect(compactionSummary.get('compact_1')).toEqual([
        'Summary text',
        '<local-command-stdout>output</local-command-stdout>',
      ])
    })

    it('clears compact tracking after skill tool_use', () => {
      const events = [
        { id: 'compact_1', subtype: 'compact_boundary' },
        {
          subtype: 'tool_use',
          content: 'Skill',
          tool_use_id: 'skill_1',
        },
        { type: 'user', subtype: 'tool_result', tool_use_id: 'skill_1', content: 'Launching' },
        { type: 'user', subtype: 'text', is_human: false, content: 'Skill content' },
      ]

      const { compactionSummary, skillContent } = indexEvents(events)

      expect(compactionSummary.has('compact_1')).toBe(false)
      expect(skillContent.get('skill_1')).toBe('Skill content')
    })
  })

  describe('hasCompactBoundary flag', () => {
    it('returns true when compact_boundary exists', () => {
      const events = [{ subtype: 'text', content: 'Hello' }, { subtype: 'compact_boundary' }]

      const { hasCompactBoundary } = indexEvents(events)

      expect(hasCompactBoundary).toBe(true)
    })

    it('returns false when no compact_boundary', () => {
      const events = [{ subtype: 'text', content: 'Hello' }, { subtype: 'compact_start' }]

      const { hasCompactBoundary } = indexEvents(events)

      expect(hasCompactBoundary).toBe(false)
    })

    it('returns false for empty events', () => {
      const { hasCompactBoundary } = indexEvents([])
      expect(hasCompactBoundary).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles empty events array', () => {
      const result = indexEvents([])

      expect(result.toolResults.size).toBe(0)
      expect(result.nestedEvents.size).toBe(0)
      expect(result.skillContent.size).toBe(0)
      expect(result.compactionSummary.size).toBe(0)
      expect(result.hasCompactBoundary).toBe(false)
    })

    it('handles events with minimal properties', () => {
      const events = [{ subtype: 'tool_result' }, { subtype: 'text', content: 'plain' }]

      // Should not throw
      const result = indexEvents(events)
      expect(result.toolResults.size).toBe(0)
    })
  })
})

describe('processEvents', () => {
  it('returns empty array for empty input', () => {
    expect(processEvents([]).blocks).toEqual([])
  })

  it('creates text block for text event', () => {
    const events = [{ subtype: 'text', content: 'Hello world' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].event.content).toBe('Hello world')
  })

  it('creates thinking block for thinking event', () => {
    const events = [{ subtype: 'thinking', content: 'Let me think...' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('thinking')
  })

  it('skips thinking event with empty content', () => {
    const events = [{ subtype: 'thinking', content: '' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('skips thinking event with whitespace-only content', () => {
    const events = [{ subtype: 'thinking', content: '   \n  ' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('creates tool block pairing tool_use with tool_result', () => {
    const events = [
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' },
      {
        subtype: 'tool_result',
        tool_use_id: 'tu_1',
        content: 'output',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool')
    expect(blocks[0].toolUse.content).toBe('Bash')
    expect(blocks[0].toolResult.content).toBe('output')
  })

  it('creates tool block with undefined result when result missing', () => {
    const events = [{ subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].toolResult).toBeUndefined()
  })

  it('attaches nested events to Task tool block', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'task_1',
      },
      { subtype: 'tool_use', content: 'Bash', parent_tool_use_id: 'task_1' },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].nestedEvents).toHaveLength(1)
    expect(blocks[0].nestedEvents[0].content).toBe('Bash')
  })

  it('attaches skill markdown to Skill tool block', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Skill',
        tool_use_id: 'skill_1',
      },
      { type: 'user', subtype: 'tool_result', tool_use_id: 'skill_1', content: 'Launching' },
      { type: 'user', subtype: 'text', is_human: false, content: '# Skill instructions' },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].skillContent).toBe('# Skill instructions')
  })

  it('attaches skill markdown when a tool_result intervenes between Skill tool_use and skill content', () => {
    // Live SDK sequence: Skill tool_use -> tool_result echo -> user/text body. The intervening
    // tool_result must not clear skill-tracking state, or the markdown leaks as a standalone bubble.
    const events = [
      { subtype: 'tool_use', content: 'Skill', tool_use_id: 'skill_1' },
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: 'skill_1',
        content: 'Launching skill: changelog',
        is_human: false,
      },
      { type: 'user', subtype: 'text', is_human: false, content: '# Skill markdown body' },
    ]

    const blocks = processEvents(events).blocks

    // Only the Skill tool block - the user/text body folds into skillContent, not a separate text block.
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool')
    expect(blocks[0].toolUse.content).toBe('Skill')
    expect(blocks[0].skillContent).toBe('# Skill markdown body')
  })

  it('folds skill markdown across the full live turn slice (assistant text -> tool_use -> tool_result -> user/text body -> assistant text)', () => {
    // Mirrors a real SDK event ordering. Key invariants: the leading assistant/text resets the
    // skill tracker but the following tool_use sets it again; the intervening user/tool_result
    // must not reset it. If any invariant breaks, the user/text body leaks as a standalone bubble.
    const skillBody =
      'Base directory for this skill: /root/.claude/skills/changelog\n\n# Changelog\n\n...'
    const events = [
      { type: 'assistant', subtype: 'text', is_human: false, content: 'Invoke /changelog...' },
      { type: 'assistant', subtype: 'tool_use', content: 'Skill', tool_use_id: 'skill_live' },
      {
        type: 'user',
        subtype: 'tool_result',
        is_human: false,
        tool_use_id: 'skill_live',
        content: 'Launching skill: changelog',
      },
      { type: 'user', subtype: 'text', is_human: false, content: skillBody },
      {
        type: 'assistant',
        subtype: 'text',
        is_human: false,
        content: 'Validated: 6 parameters present.',
      },
    ]

    const blocks = processEvents(events).blocks

    // Three blocks: leading assistant text, Skill tool block (body folded inside), trailing assistant text.
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].event.content).toBe('Invoke /changelog...')
    expect(blocks[1].type).toBe('tool')
    expect(blocks[1].toolUse.content).toBe('Skill')
    expect(blocks[1].skillContent).toBe(skillBody)
    expect(blocks[2].type).toBe('text')
    expect(blocks[2].event.content).toBe('Validated: 6 parameters present.')
    // Defensive: there must NOT be a text block whose content is the skill body.
    const leakedTextBlocks = blocks.filter(b => b.type === 'text' && b.event.content === skillBody)
    expect(leakedTextBlocks).toHaveLength(0)
  })

  it('a skill loaded again folds its own text and hides the re-invocation note', () => {
    const body = args =>
      `Base directory for this skill: /skills/notes\n\n# Notes\n\nARGUMENTS: ${args}`
    const note =
      '(Re-invocation of /notes \u2014 the skill instructions were previously loaded; the arguments or dynamic output below are new.)'
    const events = [
      { type: 'assistant', subtype: 'tool_use', content: 'Skill', tool_use_id: 'skill_1' },
      { type: 'system', subtype: 'rate_limit' },
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: 'skill_1',
        content: 'Launching skill: notes',
      },
      { type: 'user', subtype: 'text', is_human: false, content: body('first') },
      { type: 'assistant', subtype: 'tool_use', content: 'Skill', tool_use_id: 'skill_2' },
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: 'skill_2',
        content: 'Launching skill: notes',
      },
      { type: 'user', subtype: 'text', is_human: false, content: note },
      { type: 'user', subtype: 'text', is_human: false, content: body('second') },
      { type: 'assistant', subtype: 'text', content: 'OK' },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks.map(b => b.type)).toEqual(['tool', 'tool', 'text'])
    expect(blocks[0].skillContent).toBe(body('first'))
    expect(blocks[1].skillContent).toBe(body('second'))
    expect(blocks[2].event.content).toBe('OK')
  })

  it('skips nested events from top-level blocks', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'task_1',
      },
      {
        subtype: 'text',
        content: 'Nested text',
        parent_tool_use_id: 'task_1',
      },
    ]

    const blocks = processEvents(events).blocks

    // Only Task block, nested text is inside nestedEvents, not a separate block
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool')
  })

  it('creates compaction block for compact_start when no boundary', () => {
    const events = [{ subtype: 'compact_start' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('compaction')
    expect(blocks[0].isCompacting).toBe(true)
  })

  it('creates compaction block with summary for compact_boundary', () => {
    const events = [
      { id: 'cb_1', subtype: 'compact_boundary' },
      { type: 'user', subtype: 'text', is_human: false, content: 'Summary of compacted content' },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('compaction')
    expect(blocks[0].isCompacting).toBe(false)
    expect(blocks[0].summary).toEqual(['Summary of compacted content'])
  })

  it('hides compact_start when compact_boundary exists', () => {
    const events = [{ subtype: 'compact_start' }, { subtype: 'compact_boundary' }]

    const blocks = processEvents(events).blocks

    // Only boundary block, start is hidden
    expect(blocks).toHaveLength(1)
    expect(blocks[0].isCompacting).toBe(false)
  })

  it('folds summary into one completed compaction block for [compact_start, compact_boundary, summary]', () => {
    const events = [
      { subtype: 'compact_start' },
      {
        id: 'cb_1',
        type: 'system',
        subtype: 'compact_boundary',
        message_data: { compact_metadata: { trigger: 'context_limit', pre_tokens: 128000 } },
      },
      {
        type: 'user',
        subtype: 'text',
        is_human: false,
        content: 'This session is being continued from a previous conversation...',
      },
    ]

    const blocks = processEvents(events).blocks

    // Exactly one block: the completed compaction block; the compact_start spinner is suppressed.
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('compaction')
    expect(blocks[0].isCompacting).toBe(false)
    expect(blocks[0].summary).toEqual([
      'This session is being continued from a previous conversation...',
    ])
    // Summary is folded into the block, never a standalone text bubble.
    expect(blocks.filter(b => b.type === 'text')).toHaveLength(0)
  })

  it('skips empty text events', () => {
    const events = [{ subtype: 'text', content: '   ' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('filters "(No content)" placeholder from assistant text', () => {
    const events = [{ type: 'assistant', subtype: 'text', content: '(No content)' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('filters "(no content)" case-insensitively', () => {
    const events = [{ type: 'assistant', subtype: 'text', content: '  (NO CONTENT)  ' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('does not filter "(No content)" from user text', () => {
    const events = [{ type: 'user', subtype: 'text', content: '(No content)', is_human: true }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('does not filter "(No content)" as substring in larger text', () => {
    const events = [
      { type: 'assistant', subtype: 'text', content: 'The response was (No content) initially' },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('does not create blocks for model_changed events (handled via turn.settingChanges)', () => {
    const events = [{ type: 'system', subtype: 'model_changed', model: 'claude-opus-5' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('does not create blocks for permission_mode_changed events (handled via turn.settingChanges)', () => {
    const events = [{ type: 'system', subtype: 'permission_mode_changed', permission_mode: 'plan' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('does not suppress non-human user text', () => {
    const events = [{ type: 'user', subtype: 'text', is_human: false, content: 'some user text' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('renders a reported failure as a text block, reusing the existing error styling', () => {
    const events = [{ type: 'system', subtype: 'error', content: 'runtime crashed' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].event.content).toBe('runtime crashed')
  })

  it('drops a reported failure with no content', () => {
    const events = [{ type: 'system', subtype: 'error', content: '' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })
})

describe('processEvents - text no one wrote', () => {
  const NOTE =
    '[Your previous response had no visible output. Please continue and produce a user-visible response.]'
  const say = content => ({ type: 'assistant', subtype: 'text', content })
  const added = content => ({ type: 'user', subtype: 'text', is_human: false, content })
  const call = (id, name = 'mcp__claudebox__needs_user') => ({
    type: 'assistant',
    subtype: 'tool_use',
    content: name,
    tool_use_id: id,
  })
  const result = id => ({ type: 'user', subtype: 'tool_result', content: 'ok', tool_use_id: id })
  const feedback = 'Stop hook feedback:\nMARKER. Reply with DONE.'

  it('hangs a Stop hook reason on the text before it, minus its first line', () => {
    const { blocks, injected } = processEvents([say('PING'), added(feedback), say('DONE')])

    expect(blocks.map(b => b.event.content)).toEqual(['PING', 'DONE'])
    expect(blocks[0].injected).toEqual([{ source: 'stop-hook', text: 'MARKER. Reply with DONE.' }])
    expect(blocks[1].injected).toBeUndefined()
    expect(injected).toEqual([])
  })

  it("hangs Claude Code's no-visible-output note on the tool row before it", () => {
    const { blocks } = processEvents([call('t1'), result('t1'), added(NOTE), say('DONE')])

    expect(blocks[0].type).toBe('tool')
    expect(blocks[0].injected).toEqual([{ source: 'claude-code', text: NOTE }])
    expect(blocks).toHaveLength(2)
  })

  it('keeps two pieces after one block on that block, in arrival order', () => {
    const { blocks } = processEvents([say('PING'), added(feedback), added(NOTE)])

    expect(blocks).toHaveLength(1)
    expect(blocks[0].injected.map(e => e.source)).toEqual(['stop-hook', 'claude-code'])
  })

  it("returns text arriving before any block as the turn's own", () => {
    const { blocks, injected } = processEvents([added(feedback), say('DONE')])

    expect(injected).toEqual([{ source: 'stop-hook', text: 'MARKER. Reply with DONE.' }])
    expect(blocks[0].injected).toBeUndefined()
  })

  it('passes over a hidden tool-schema search to the block before it', () => {
    const { blocks } = processEvents([
      say('PING'),
      call('ts1', 'ToolSearch'),
      result('ts1'),
      added(NOTE),
    ])

    expect(blocks[0].injected).toEqual([{ source: 'claude-code', text: NOTE }])
    expect(blocks[1].injected).toBeUndefined()
  })

  it('hangs a message holding only system reminders on the block before it, one entry each', () => {
    const reminders = added(
      '<system-reminder>\nCommit each change.\n</system-reminder>\n<system-reminder>Keep it small.</system-reminder>',
    )
    const { blocks } = processEvents([call('t1'), result('t1'), reminders, say('DONE')])

    expect(blocks).toHaveLength(2)
    expect(blocks[0].injected).toEqual([
      { source: 'system-reminder', text: 'Commit each change.' },
      { source: 'system-reminder', text: 'Keep it small.' },
    ])
  })

  it('draws a message mixing reminders with other text as text', () => {
    const mixed = added('Note this.<system-reminder>a reminder</system-reminder>')
    const { blocks } = processEvents([say('PING'), mixed])

    expect(blocks.map(b => b.type)).toEqual(['text', 'text'])
    expect(blocks[0].injected).toBeUndefined()
  })

  it('leaves other text from the agent CLI drawn as text', () => {
    const { blocks } = processEvents([say('PING'), added('Stop hook feedback is mentioned here')])

    expect(blocks.map(b => b.event.content)).toEqual([
      'PING',
      'Stop hook feedback is mentioned here',
    ])
  })
})

describe('injectedByToolUse', () => {
  const human = content => ({ type: 'user', subtype: 'text', is_human: true, content })
  const bash = id => ({
    type: 'assistant',
    subtype: 'tool_use',
    content: 'Bash',
    tool_use_id: id,
    tool_input: { command: 'ls' },
  })
  const note = {
    type: 'user',
    subtype: 'text',
    is_human: false,
    content:
      '[Your previous response had no visible output. Please continue and produce a user-visible response.]',
  }

  it('keys added text by the call it hangs on, turn by turn', () => {
    const byToolUse = injectedByToolUse([
      human('first'),
      bash('b1'),
      human('second'),
      bash('b2'),
      note,
    ])

    expect([...byToolUse.keys()]).toEqual(['b2'])
    expect(byToolUse.get('b2')[0].source).toBe('claude-code')
  })

  it('never carries text past the message that opens the next turn', () => {
    expect(injectedByToolUse([human('first'), bash('b1'), human('second'), note]).size).toBe(0)
  })
})

describe('extractThinkingFromText', () => {
  it('extracts single thinking block with surrounding text', () => {
    const content = 'Before\n<thinking>Deep thought</thinking>\nAfter'
    const segments = extractThinkingFromText(content)

    expect(segments).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'thinking', content: 'Deep thought' },
      { type: 'text', content: 'After' },
    ])
  })

  it('extracts multiple thinking blocks', () => {
    const content =
      '<thinking>First thought</thinking>\nMiddle text\n<thinking>Second thought</thinking>'
    const segments = extractThinkingFromText(content)

    expect(segments).toEqual([
      { type: 'thinking', content: 'First thought' },
      { type: 'text', content: 'Middle text' },
      { type: 'thinking', content: 'Second thought' },
    ])
  })

  it('returns thinking-only when no surrounding text', () => {
    const content = '<thinking>Just thinking</thinking>'
    const segments = extractThinkingFromText(content)

    expect(segments).toEqual([{ type: 'thinking', content: 'Just thinking' }])
  })

  it('skips empty thinking blocks', () => {
    const content = 'Text<thinking>  </thinking>More text'
    const segments = extractThinkingFromText(content)

    expect(segments).toEqual([
      { type: 'text', content: 'Text' },
      { type: 'text', content: 'More text' },
    ])
  })

  it('handles multiline thinking content', () => {
    const content = '<thinking>\nLine 1\nLine 2\nLine 3\n</thinking>\nResponse'
    const segments = extractThinkingFromText(content)

    expect(segments).toEqual([
      { type: 'thinking', content: 'Line 1\nLine 2\nLine 3' },
      { type: 'text', content: 'Response' },
    ])
  })

  it('returns single text segment when no thinking tags', () => {
    const content = 'Plain text without thinking'
    const segments = extractThinkingFromText(content)

    expect(segments).toEqual([{ type: 'text', content: 'Plain text without thinking' }])
  })
})

describe('processEvents - embedded thinking extraction', () => {
  it('extracts <thinking> from assistant text into thinking block + text block', () => {
    const events = [
      {
        type: 'assistant',
        subtype: 'text',
        content: '<thinking>Let me analyze this</thinking>\n\nHere is my answer.',
        ts: '2026-01-01T00:00:05Z',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('thinking')
    expect(blocks[0].event.content).toBe('Let me analyze this')
    expect(blocks[0].event.subtype).toBe('thinking')
    expect(blocks[0].event.ts).toBe('2026-01-01T00:00:05Z')
    expect(blocks[1].type).toBe('text')
    expect(blocks[1].event.content).toBe('Here is my answer.')
  })

  it('extracts multiple <thinking> blocks from one text event', () => {
    const events = [
      {
        type: 'assistant',
        subtype: 'text',
        content:
          '<thinking>First thought</thinking>\nMiddle\n<thinking>Second thought</thinking>\nEnd',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(4)
    expect(blocks[0]).toMatchObject({ type: 'thinking' })
    expect(blocks[0].event.content).toBe('First thought')
    expect(blocks[1]).toMatchObject({ type: 'text' })
    expect(blocks[1].event.content).toBe('Middle')
    expect(blocks[2]).toMatchObject({ type: 'thinking' })
    expect(blocks[2].event.content).toBe('Second thought')
    expect(blocks[3]).toMatchObject({ type: 'text' })
    expect(blocks[3].event.content).toBe('End')
  })

  it('emits only thinking block when text is entirely <thinking>', () => {
    const events = [
      {
        type: 'assistant',
        subtype: 'text',
        content: '<thinking>Only thinking content here</thinking>',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('thinking')
    expect(blocks[0].event.content).toBe('Only thinking content here')
  })

  it('does not extract <thinking> from non-assistant text events', () => {
    const events = [
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: '<thinking>User typed this</thinking>',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].event.content).toBe('<thinking>User typed this</thinking>')
  })

  it('does not extract <thinking> from non-human user text events', () => {
    const events = [
      {
        type: 'user',
        subtype: 'text',
        is_human: false,
        content: '<thinking>System message</thinking>',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('passes through assistant text without <thinking> unchanged', () => {
    const events = [{ type: 'assistant', subtype: 'text', content: 'Normal response text' }]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].event.content).toBe('Normal response text')
  })
})

describe('processNestedEvents', () => {
  it('returns empty array for null input', () => {
    expect(processNestedEvents(null)).toEqual([])
  })

  it('returns empty array for undefined input', () => {
    expect(processNestedEvents(undefined)).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(processNestedEvents([])).toEqual([])
  })

  it('creates block for tool_use event', () => {
    const events = [{ subtype: 'tool_use', content: 'Read', tool_use_id: 'tu_1' }]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].toolUse.content).toBe('Read')
  })

  it('pairs tool_use with tool_result', () => {
    const events = [
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' },
      {
        subtype: 'tool_result',
        content: 'output',
        tool_use_id: 'tu_1',
      },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].toolUse.content).toBe('Bash')
    expect(blocks[0].toolResult.content).toBe('output')
  })

  it('handles multiple tool calls', () => {
    const events = [
      { subtype: 'tool_use', content: 'Read', tool_use_id: 'tu_1' },
      { subtype: 'tool_result', tool_use_id: 'tu_1' },
      { subtype: 'tool_use', content: 'Edit', tool_use_id: 'tu_2' },
      { subtype: 'tool_result', tool_use_id: 'tu_2' },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].toolUse.content).toBe('Read')
    expect(blocks[1].toolUse.content).toBe('Edit')
  })

  it('skips text and thinking events', () => {
    const events = [
      { subtype: 'text', content: 'Some text' },
      { subtype: 'thinking', content: 'Thinking...' },
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].toolUse.content).toBe('Bash')
  })

  it('handles tool_use without matching result', () => {
    const events = [{ subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' }]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].toolResult).toBeUndefined()
  })

  it('hides a successful nested ToolSearch call', () => {
    const events = [
      { subtype: 'tool_use', content: 'ToolSearch', tool_use_id: 'ts_1' },
      { subtype: 'tool_result', tool_use_id: 'ts_1' },
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].toolUse.content).toBe('Bash')
  })

  it('keeps an errored nested ToolSearch call visible', () => {
    const events = [
      { subtype: 'tool_use', content: 'ToolSearch', tool_use_id: 'ts_1' },
      { subtype: 'tool_result', tool_use_id: 'ts_1', is_error: true },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].toolUse.content).toBe('ToolSearch')
  })

  it("creates a text block for the subagent's own narration", () => {
    const events = [{ type: 'assistant', subtype: 'text', content: "I'll check the tests." }]

    const blocks = processNestedEvents(events)

    expect(blocks).toEqual([{ kind: 'text', event: events[0] }])
  })

  it('interleaves prose and calls in source order', () => {
    const events = [
      { type: 'assistant', subtype: 'text', content: 'Starting with the module layout.' },
      { subtype: 'tool_use', content: 'Glob', tool_use_id: 'tu_1' },
      { subtype: 'tool_result', tool_use_id: 'tu_1' },
      { type: 'assistant', subtype: 'text', content: 'Now reading the entry point.' },
      { subtype: 'tool_use', content: 'Read', tool_use_id: 'tu_2' },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks.map(b => b.kind)).toEqual(['text', 'tool', 'text', 'tool'])
    expect(blocks[0].event.content).toBe('Starting with the module layout.')
    expect(blocks[2].event.content).toBe('Now reading the entry point.')
  })

  it('drops an empty narration event', () => {
    const events = [
      { type: 'assistant', subtype: 'text', content: '' },
      { type: 'assistant', subtype: 'text', content: '   ' },
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('tool')
  })

  it("drops a non-human user text event - a role prompt, not the subagent's output", () => {
    const events = [
      { type: 'user', subtype: 'text', is_human: false, content: 'You are a research agent.' },
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('tool')
  })

  it('drops the human-marked Task prompt - shown separately by TaskPrompt', () => {
    const events = [
      { type: 'user', subtype: 'message', is_human: true, content: 'Find where the parser...' },
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' },
    ]

    const blocks = processNestedEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('tool')
  })
})

describe('isHiddenInFocused', () => {
  const call = (content, extra = {}) => ({ content, tool_use_id: 'tu_1', ...extra })
  const ok = { content: 'fine' }

  it.each([
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
    'TaskList',
    'TaskGet',
    'TaskOutput',
    'MCPSearch',
    'Skill',
    'mcp__claudebox__needs_user',
    'mcp__claudebox__session_read',
    'ListMcpResourcesTool',
    'ReadMcpResourceTool',
    'ReadMcpResourceDirTool',
  ])('hides a %s call, pending or done', name => {
    expect(isHiddenInFocused(call(name), null)).toBe(true)
    expect(isHiddenInFocused(call(name), ok)).toBe(true)
  })

  it.each([
    'read_file',
    'skill',
    'needs_user',
    'session_read',
    'list_mcp_resources',
    'read_mcp_resource',
  ])("hides LangGraph's %s by its alias", name => {
    expect(isHiddenInFocused(call(name), ok)).toBe(true)
  })

  it.each([
    'Write',
    'Edit',
    'Task',
    'AskUserQuestion',
    'ExitPlanMode',
    'TaskCreate',
    'TaskUpdate',
    'mcp__claudebox__session_spawn',
    'mcp__notes__search',
  ])('shows a %s call', name => {
    expect(isHiddenInFocused(call(name), ok)).toBe(false)
  })

  it('hides a Bash call only when its command is marked as changing nothing', () => {
    expect(isHiddenInFocused(call('Bash', { command_read_only: true }), ok)).toBe(true)
    expect(isHiddenInFocused(call('bash', { command_read_only: true }), ok)).toBe(true)
    expect(isHiddenInFocused(call('Bash'), ok)).toBe(false)
  })

  it('hides a Bash call measured as changing nothing, whatever its command was read as', () => {
    const marked = call('Bash', { command_read_only: true })
    expect(isHiddenInFocused(call('Bash'), { ...ok, command_changed: false })).toBe(true)
    expect(isHiddenInFocused(marked, { ...ok, command_changed: true })).toBe(false)
    expect(isHiddenInFocused(marked, { ...ok, command_changed: null })).toBe(true)
  })

  it('shows a Bash call measured as changing nothing that failed or is bookmarked', () => {
    const measured = { ...ok, command_changed: false }
    expect(isHiddenInFocused(call('Bash'), { ...measured, is_error: true })).toBe(false)
    expect(isHiddenInFocused(call('Bash'), measured, new Set(['tool-tu_1']))).toBe(false)
  })

  it('hides an MCP call only when its server declares it read-only', () => {
    expect(isHiddenInFocused(call('mcp__notes__read', { mcp_read_only: true }), ok)).toBe(true)
    expect(isHiddenInFocused(call('mcp__notes__read'), ok)).toBe(false)
  })

  it('shows a hidden kind that failed', () => {
    expect(isHiddenInFocused(call('Read'), { is_error: true })).toBe(false)
  })

  it('shows a bookmarked call of a hidden kind', () => {
    expect(isHiddenInFocused(call('Read'), ok, new Set(['tool-tu_1']))).toBe(false)
    expect(isHiddenInFocused(call('Read'), ok, new Set(['tool-tu_2']))).toBe(true)
  })

  it('hides a call whose tool is marked by hand, unless it failed or is bookmarked', () => {
    const isMarked = name => name === 'mcp__jina__read_url'
    expect(isHiddenInFocused(call('mcp__jina__read_url'), ok, null, isMarked)).toBe(true)
    expect(isHiddenInFocused(call('mcp__jina__search_web'), ok, null, isMarked)).toBe(false)
    expect(isHiddenInFocused(call('mcp__jina__read_url'), { is_error: true }, null, isMarked)).toBe(
      false,
    )
    expect(
      isHiddenInFocused(call('mcp__jina__read_url'), ok, new Set(['tool-tu_1']), isMarked),
    ).toBe(false)
  })
})

describe('isToolBlockHidden and isToolBlockVisible under each mode', () => {
  const read = { content: 'Read', tool_use_id: 'r1' }
  const toolSearch = { content: 'ToolSearch', tool_use_id: 's1' }

  it('hides a Read only under FOCUSED', () => {
    expect(isToolBlockHidden(TurnRoutingMode.FOCUSED, read, null)).toBe(true)
    for (const mode of [
      TurnRoutingMode.OFF,
      TurnRoutingMode.BASH_ONLY,
      TurnRoutingMode.ALL_TOOLS,
    ]) {
      expect(isToolBlockHidden(mode, read, null)).toBe(false)
    }
  })

  it('hides a tool-schema search in every mode', () => {
    for (const mode of Object.values(TurnRoutingMode)) {
      expect(isToolBlockHidden(mode, toolSearch, null)).toBe(true)
    }
  })

  it('keeps FOCUSED out of the right slot: a top-level Bash stays inline', () => {
    const bash = { content: 'Bash', tool_use_id: 'b1' }
    expect(blockRoutesToRightSlot(TurnRoutingMode.FOCUSED, bash)).toBe(false)
    expect(isToolBlockVisible(TurnRoutingMode.FOCUSED, bash, null)).toBe(true)
  })

  it('makes a bookmarked Read visible under FOCUSED', () => {
    expect(isToolBlockVisible(TurnRoutingMode.FOCUSED, read, null, new Set(['tool-r1']))).toBe(true)
  })
})

describe('processNestedEvents under FOCUSED', () => {
  const events = [
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Read',
      tool_use_id: 'n1',
      parent_tool_use_id: 't',
    },
    {
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: 'n1',
      parent_tool_use_id: 't',
      content: 'x',
    },
    { type: 'assistant', subtype: 'text', content: 'Looking at it.', parent_tool_use_id: 't' },
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'Edit',
      tool_use_id: 'n2',
      parent_tool_use_id: 't',
    },
  ]

  it("leaves a subagent's call of a marked tool out", () => {
    const marked = [{ ...events[3], content: 'mcp__jina__read_url', tool_use_id: 'n3' }, events[3]]
    const ids = processNestedEvents(marked, TurnRoutingMode.FOCUSED, name =>
      name.endsWith('read_url'),
    ).map(b => b.toolUse.tool_use_id)
    expect(ids).toEqual(['n2'])
  })

  it("leaves the subagent's reads out and keeps its edit and text", () => {
    const blocks = processNestedEvents(events, TurnRoutingMode.FOCUSED)
    expect(blocks.map(b => (b.kind === 'tool' ? b.toolUse.content : b.kind))).toEqual([
      'text',
      'Edit',
    ])
  })

  it('lists every call with no mode', () => {
    expect(processNestedEvents(events)).toHaveLength(3)
  })
})

describe('isHiddenToolSearch', () => {
  it('hides a successful ToolSearch call', () => {
    const toolUse = { content: 'ToolSearch' }
    const toolResult = { is_error: false }

    expect(isHiddenToolSearch(toolUse, toolResult)).toBe(true)
  })

  it('hides a still-pending ToolSearch call (no result yet)', () => {
    expect(isHiddenToolSearch({ content: 'ToolSearch' }, null)).toBe(true)
  })

  it('keeps an errored ToolSearch call visible', () => {
    const toolUse = { content: 'ToolSearch' }
    const toolResult = { is_error: true }

    expect(isHiddenToolSearch(toolUse, toolResult)).toBe(false)
  })

  it('hides the LangGraph snake_case tool_search alias identically', () => {
    expect(isHiddenToolSearch({ content: 'tool_search' }, null)).toBe(true)
  })

  it('never hides an unrelated tool', () => {
    const toolUse = { content: 'Bash' }

    expect(isHiddenToolSearch(toolUse, null)).toBe(false)
    expect(isHiddenToolSearch(toolUse, { is_error: true })).toBe(false)
  })
})

describe('hasVisibleBlock', () => {
  it('is false when every block is a hidden ToolSearch call', () => {
    const blocks = [
      { type: 'tool', toolUse: { content: 'ToolSearch' }, toolResult: { is_error: false } },
      { type: 'tool', toolUse: { content: 'tool_search' }, toolResult: null },
    ]

    expect(hasVisibleBlock(blocks)).toBe(false)
  })

  it('is true when a non-tool block is present alongside a hidden ToolSearch call', () => {
    const blocks = [
      { type: 'tool', toolUse: { content: 'ToolSearch' }, toolResult: { is_error: false } },
      { type: 'text', event: { content: 'done' } },
    ]

    expect(hasVisibleBlock(blocks)).toBe(true)
  })

  it('is true when a failed ToolSearch call is present', () => {
    const blocks = [
      { type: 'tool', toolUse: { content: 'ToolSearch' }, toolResult: { is_error: true } },
    ]

    expect(hasVisibleBlock(blocks)).toBe(true)
  })

  it('is true when a non-ToolSearch tool block is present', () => {
    const blocks = [{ type: 'tool', toolUse: { content: 'Bash' }, toolResult: null }]

    expect(hasVisibleBlock(blocks)).toBe(true)
  })

  it('is false for an empty block list', () => {
    expect(hasVisibleBlock([])).toBe(false)
  })
})

describe('hasVisibleBlock - hideShellCalls (terminal column routing)', () => {
  it('is true for a top-level Bash call by default (flag omitted)', () => {
    const blocks = [{ type: 'tool', toolUse: { content: 'Bash' }, toolResult: null }]

    expect(hasVisibleBlock(blocks)).toBe(true)
  })

  it('is false when the only block is a top-level Bash call and hideShellCalls is true', () => {
    const blocks = [
      { type: 'tool', toolUse: { content: 'Bash', tool_use_id: 'b-1' }, toolResult: null },
    ]

    expect(hasVisibleBlock(blocks, true)).toBe(false)
  })

  it('is false for a routed Bash call plus a hidden ToolSearch, both excluded', () => {
    const blocks = [
      { type: 'tool', toolUse: { content: 'Bash', tool_use_id: 'b-1' }, toolResult: null },
      { type: 'tool', toolUse: { content: 'ToolSearch' }, toolResult: { is_error: false } },
    ]

    expect(hasVisibleBlock(blocks, true)).toBe(false)
  })

  it('is true when a nested Bash call is present even with hideShellCalls true', () => {
    const blocks = [
      {
        type: 'tool',
        toolUse: { content: 'Bash', tool_use_id: 'b-1', parent_tool_use_id: 'subagent-X' },
        toolResult: null,
      },
    ]

    expect(hasVisibleBlock(blocks, true)).toBe(true)
  })

  it('is true for a routed LangGraph snake_case bash call plus a non-tool block', () => {
    const blocks = [
      { type: 'tool', toolUse: { content: 'bash', tool_use_id: 'b-1' }, toolResult: null },
      { type: 'text', event: { content: 'done' } },
    ]

    expect(hasVisibleBlock(blocks, true)).toBe(true)
  })

  it('is false when the only block is a top-level Bash call and the mode is BASH_ONLY', () => {
    const blocks = [
      { type: 'tool', toolUse: { content: 'Bash', tool_use_id: 'b-1' }, toolResult: null },
    ]

    expect(hasVisibleBlock(blocks, TurnRoutingMode.BASH_ONLY)).toBe(false)
  })

  it('is true for a top-level Bash call when the mode is OFF', () => {
    const blocks = [
      { type: 'tool', toolUse: { content: 'Bash', tool_use_id: 'b-1' }, toolResult: null },
    ]

    expect(hasVisibleBlock(blocks, TurnRoutingMode.OFF)).toBe(true)
  })
})

describe('TurnRoutingMode / blockRoutesToRightSlot', () => {
  it('routes nothing away when the mode is OFF', () => {
    expect(blockRoutesToRightSlot(TurnRoutingMode.OFF, { content: 'Bash' })).toBe(false)
  })

  it('routes a top-level Bash call away when the mode is BASH_ONLY', () => {
    expect(blockRoutesToRightSlot(TurnRoutingMode.BASH_ONLY, { content: 'Bash' })).toBe(true)
  })

  it('leaves a nested Bash call alone even when the mode is BASH_ONLY', () => {
    const toolUse = { content: 'Bash', parent_tool_use_id: 'subagent-X' }
    expect(blockRoutesToRightSlot(TurnRoutingMode.BASH_ONLY, toolUse)).toBe(false)
  })

  it('leaves a non-Bash top-level tool alone when the mode is BASH_ONLY', () => {
    expect(blockRoutesToRightSlot(TurnRoutingMode.BASH_ONLY, { content: 'Read' })).toBe(false)
  })

  it('routes every top-level tool away when the mode is ALL_TOOLS, Bash or not', () => {
    expect(blockRoutesToRightSlot(TurnRoutingMode.ALL_TOOLS, { content: 'Read' })).toBe(true)
    expect(blockRoutesToRightSlot(TurnRoutingMode.ALL_TOOLS, { content: 'Bash' })).toBe(true)
  })

  it('leaves a nested tool alone even when the mode is ALL_TOOLS', () => {
    const toolUse = { content: 'Read', parent_tool_use_id: 'subagent-X' }
    expect(blockRoutesToRightSlot(TurnRoutingMode.ALL_TOOLS, toolUse)).toBe(false)
  })

  it('treats a legacy boolean true as BASH_ONLY, for callers not yet moved', () => {
    expect(blockRoutesToRightSlot(true, { content: 'Bash' })).toBe(true)
    expect(blockRoutesToRightSlot(true, { content: 'Read' })).toBe(false)
  })

  it('treats a legacy boolean false, or an omitted mode, as OFF', () => {
    expect(blockRoutesToRightSlot(false, { content: 'Bash' })).toBe(false)
    expect(blockRoutesToRightSlot(undefined, { content: 'Bash' })).toBe(false)
  })
})

describe('isTopLevelBashCall', () => {
  it('is true for a top-level Bash call', () => {
    expect(isTopLevelBashCall({ content: 'Bash' })).toBe(true)
  })

  it('is true for the LangGraph snake_case alias', () => {
    expect(isTopLevelBashCall({ content: 'bash' })).toBe(true)
  })

  it('is false for a nested Bash call (parent_tool_use_id set)', () => {
    expect(isTopLevelBashCall({ content: 'Bash', parent_tool_use_id: 'subagent-X' })).toBe(false)
  })

  it('is false for a non-Bash tool', () => {
    expect(isTopLevelBashCall({ content: 'Read' })).toBe(false)
  })

  it('is false for a missing toolUse', () => {
    expect(isTopLevelBashCall(undefined)).toBe(false)
  })
})

describe('extractTasks', () => {
  it('returns empty array for empty events', () => {
    const tasks = extractTasks([], new Map())
    expect(tasks).toEqual([])
  })

  it('extracts Task tool_use events', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Test task', prompt: 'Do something' },
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'task_1',
      description: 'Test task',
      prompt: 'Do something',
      status: 'running',
      startTime: 1000,
    })
  })

  it('marks task as completed when result exists', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Test' },
      },
      {
        subtype: 'tool_result',
        timestamp: 2000,
        content: 'Done',
        tool_use_id: 'task_1',
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks[0].status).toBe('completed')
    expect(tasks[0].endTime).toBe(2000)
  })

  it('marks task as failed when result contains error', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Test' },
      },
      {
        subtype: 'tool_result',
        timestamp: 2000,
        content: 'Error: something went wrong',
        tool_use_id: 'task_1',
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks[0].status).toBe('failed')
  })

  it('handles async tasks with notifications', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Async task' },
      },
      {
        subtype: 'tool_result',
        timestamp: 1100,
        tool_use_id: 'task_1',
        tool_use_result: {
          isAsync: true,
          agentId: 'agent_abc',
          outputFile: '/tmp/output.txt',
        },
      },
    ]

    const notifications = new Map([['agent_abc', { status: 'completed', summary: 'Done' }]])

    const tasks = extractTasks(events, notifications)

    expect(tasks[0].isAsync).toBe(true)
    expect(tasks[0].asyncTaskId).toBe('agent_abc')
    expect(tasks[0].status).toBe('completed')
  })

  it('shows async task as running when no notification', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Async task' },
      },
      {
        subtype: 'tool_result',
        timestamp: 1100,
        tool_use_id: 'task_1',
        tool_use_result: {
          isAsync: true,
          agentId: 'agent_abc',
        },
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks[0].status).toBe('running')
  })

  it('ignores non-Task tool_use events', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Read',
        tool_use_id: 'read_1',
        tool_input: { file_path: '/test.js' },
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks).toHaveLength(0)
  })

  it('sets lastEventTime from nested events', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        ts: '2026-01-01T00:00:00Z',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Test' },
      },
      {
        subtype: 'tool_use',
        content: 'Read',
        ts: '2026-01-01T00:00:05Z',
        timestamp: 6000,
        parent_tool_use_id: 'task_1',
      },
      {
        subtype: 'tool_result',
        ts: '2026-01-01T00:00:10Z',
        timestamp: 11000,
        parent_tool_use_id: 'task_1',
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks[0].lastEventTime).toBe(new Date('2026-01-01T00:00:10Z').getTime())
  })

  it('falls back lastEventTime to startTime when no nested events', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        ts: '2026-01-01T00:00:00Z',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Test' },
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks[0].lastEventTime).toBe(new Date('2026-01-01T00:00:00Z').getTime())
  })

  it('uses max ts across multiple nested events for lastEventTime', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Test' },
      },
      {
        subtype: 'text',
        ts: '2026-01-01T00:00:05Z',
        timestamp: 6000,
        parent_tool_use_id: 'task_1',
      },
      {
        subtype: 'text',
        ts: '2026-01-01T00:00:20Z',
        timestamp: 21000,
        parent_tool_use_id: 'task_1',
      },
      {
        subtype: 'text',
        ts: '2026-01-01T00:00:10Z',
        timestamp: 11000,
        parent_tool_use_id: 'task_1',
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks[0].lastEventTime).toBe(new Date('2026-01-01T00:00:20Z').getTime())
  })

  it('attaches the enclosing turn id from the preceding human event', () => {
    const events = [
      { type: 'user', subtype: 'text', is_human: true, content: 'Run it', turn_id: 'turn_001' },
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Test' },
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks[0].turnId).toBe('turn_001')
  })

  it('keeps the parent turn id for a task inside a subagent nested event stream', () => {
    const events = [
      { type: 'user', subtype: 'text', is_human: true, content: 'Run it', turn_id: 'turn_001' },
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_outer',
        tool_input: { description: 'Outer task' },
      },
      // A nested human event must not retarget the turn (same guard as appendTurns).
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Subagent prompt',
        turn_id: 'turn_should_not_apply',
        parent_tool_use_id: 'task_outer',
      },
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 2000,
        tool_use_id: 'task_nested',
        tool_input: { description: 'Nested task' },
        parent_tool_use_id: 'task_outer',
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks.find(t => t.id === 'task_outer').turnId).toBe('turn_001')
    expect(tasks.find(t => t.id === 'task_nested').turnId).toBe('turn_001')
  })

  it('leaves turnId null when the transcript has no turn id', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: 1000,
        tool_use_id: 'task_1',
        tool_input: { description: 'Test' },
      },
    ]

    const tasks = extractTasks(events, new Map())

    expect(tasks[0].turnId).toBeNull()
  })
})

describe('extractTasks - background commands', () => {
  const at = ms => new Date(Date.UTC(2026, 9, 13, 10, 0, 0) + ms).toISOString()

  function rows(events) {
    const notifications = appendTaskNotifications(new Map(), events)
    const { launches } = appendBackgroundLaunches(new Map(), new Map(), events)
    return extractTasks(events, notifications, launches)
  }

  it('lists a running background command named by its description', () => {
    const tasks = rows([
      { type: 'user', subtype: 'text', is_human: true, content: 'go', turn_id: 't1' },
      bashUse('tu1', { command: 'sleep 60', description: 'Wait a minute' }, { ts: at(0) }),
      bashLaunchResult('tu1', 'b1'),
    ])

    expect(tasks).toEqual([
      {
        id: 'tu1',
        kind: 'command',
        turnId: 't1',
        asyncTaskId: 'b1',
        description: 'Wait a minute',
        prompt: undefined,
        status: 'running',
        startTime: Date.UTC(2026, 9, 13, 10, 0, 0),
        endTime: null,
        lastEventTime: null,
        isAsync: true,
      },
    ])
  })

  it('names a command row by the command when the description is missing or empty', () => {
    const tasks = rows([
      bashUse('tu1', { command: 'npm run dev' }),
      bashLaunchResult('tu1', 'b1'),
      bashUse('tu2', { command: 'make watch', description: '' }),
      bashLaunchResult('tu2', 'b2'),
    ])

    expect(tasks.map(t => t.description)).toEqual(['npm run dev', 'make watch'])
  })

  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['killed', 'failed'],
  ])('maps a %s notice to %s and ends the row at the notice', (notified, status) => {
    const tasks = rows([
      bashUse('tu1', { command: 'false' }, { ts: at(0) }),
      bashLaunchResult('tu1', 'b1'),
      { ...notice('b1', notified), ts: at(90_000) },
    ])

    expect(tasks[0].status).toBe(status)
    expect(tasks[0].endTime - tasks[0].startTime).toBe(90_000)
  })

  it('lists a command moved to the background at its time limit', () => {
    const tasks = rows([
      bashUse('tu1', { command: 'just check', description: 'Run the full gate' }),
      bashLaunchResult('tu1', 'b7', {
        tool_use_result: { backgroundTaskId: 'b7', timedOutAfterMs: 600000 },
      }),
    ])

    expect(tasks.map(t => [t.kind, t.description])).toEqual([['command', 'Run the full gate']])
  })

  it('lists no foreground command, no launch without a task id, and no notice on its own', () => {
    const tasks = rows([
      bashUse('tu1', { command: 'ls' }),
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: 'tu1',
        tool_use_result: { stdout: 'a' },
      },
      notice('fg-only'),
    ])

    expect(tasks).toEqual([])
  })

  it('lists no command launched inside a subagent', () => {
    const tasks = rows([
      bashUse('tu2', { command: 'sleep 9' }, { parent_tool_use_id: 'task1' }),
      bashLaunchResult('tu2', 'b2', { parent_tool_use_id: 'task1' }),
    ])

    expect(tasks).toEqual([])
  })

  it('keeps subagent and command rows in launch order, marking each kind', () => {
    const tasks = rows([
      bashUse('tu1', { command: 'sleep 60', description: 'First' }),
      bashLaunchResult('tu1', 'b1'),
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'tu2',
        tool_input: { description: 'Second' },
      },
      agentLaunchResult('tu2', 'a2', 'Second'),
      bashUse('tu3', { command: 'sleep 60', description: 'Third' }),
      bashLaunchResult('tu3', 'b3'),
    ])

    expect(tasks.map(t => [t.kind, t.description])).toEqual([
      ['command', 'First'],
      ['subagent', 'Second'],
      ['command', 'Third'],
    ])
  })

  it('reads a command and a subagent launched before the last restart as failed', () => {
    const tasks = rows([
      bashUse('tu1', { command: 'sleep 900' }),
      bashLaunchResult('tu1', 'b1'),
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'tu2',
        tool_input: {},
      },
      agentLaunchResult('tu2', 'a2', 'Review'),
      { type: 'system', subtype: 'container_restarted' },
      bashUse('tu3', { command: 'sleep 900' }),
      bashLaunchResult('tu3', 'b3'),
    ])

    expect(tasks.map(t => t.status)).toEqual(['failed', 'failed', 'running'])
  })

  it('ends a background subagent row at its completion notice, not at its launch', () => {
    const tasks = rows([
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'tu1',
        tool_input: { description: 'Review' },
        ts: at(0),
      },
      { ...agentLaunchResult('tu1', 'a1', 'Review'), ts: at(1_000) },
      { ...notice('a1'), ts: at(180_000) },
    ])

    expect(tasks[0]).toMatchObject({ kind: 'subagent', status: 'completed' })
    expect(tasks[0].endTime - tasks[0].startTime).toBe(180_000)
  })
})

describe('extractCrons', () => {
  const T0 = Date.UTC(2026, 9, 12, 12, 0, 0)
  const iso = ms => new Date(ms).toISOString()

  function create(toolUseId, id, input, { at = T0, recurring, durable = false, extra = {} } = {}) {
    return [
      {
        type: 'assistant',
        subtype: 'tool_use',
        content: 'CronCreate',
        tool_use_id: toolUseId,
        tool_input: input,
        ts: iso(at),
        ...extra,
      },
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: toolUseId,
        tool_use_result: {
          id,
          humanSchedule: input.cron,
          recurring: recurring ?? input.recurring !== false,
          durable,
        },
        ts: iso(at + 10),
        ...extra,
      },
    ]
  }
  function remove(toolUseId, id) {
    return {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'CronDelete',
      tool_use_id: toolUseId,
      tool_input: { id },
    }
  }

  const oneTime = create('c1', '00000001', {
    cron: '20 12 12 10 *',
    prompt: 'Start the batch\nwith care',
    recurring: false,
  })
  const repeating = create('c2', '00000002', { cron: '*/10 * * * *', prompt: 'Check the deploy' })

  it('lists active schedules soonest first with their prompt, kind and creation', () => {
    const crons = extractCrons(
      [
        { type: 'user', subtype: 'text', is_human: true, content: 'go', turn_id: 't1' },
        ...oneTime,
        ...repeating,
      ],
      T0 + 60_000,
    )

    expect(crons.map(c => [c.id, c.recurring, c.turnId, c.toolUseId])).toEqual([
      ['00000002', true, 't1', 'c2'],
      ['00000001', false, 't1', 'c1'],
    ])
    expect(crons[1]).toMatchObject({
      prompt: 'Start the batch\nwith care',
      createdAt: T0 + 10,
      expiresAt: null,
      nextFireAt: Date.UTC(2026, 9, 12, 12, 20),
    })
    expect(crons[0].expiresAt).toBe(T0 + 10 + 7 * 24 * 60 * 60 * 1000)
  })

  it('drops a deleted schedule', () => {
    expect(
      extractCrons([...oneTime, ...repeating, remove('d1', '00000002')], T0).map(c => c.id),
    ).toEqual(['00000001'])
  })

  it('skips a create whose result is an error or carries no id', () => {
    const errored = create('c3', 'x', { cron: '* * * * *', prompt: 'p' })
    errored[1].is_error = true
    const idless = create('c4', 'x', { cron: '* * * * *', prompt: 'p' })
    idless[1].tool_use_result = { error: 'bad cron' }

    expect(extractCrons([...errored, ...idless], T0)).toEqual([])
  })

  it('drops a one-time schedule once its time has passed', () => {
    expect(extractCrons(oneTime, Date.UTC(2026, 9, 12, 12, 20, 1))).toEqual([])
  })

  it('keeps a one-time schedule that came due during a running turn, marked due', () => {
    const crons = extractCrons(
      oneTime,
      Date.UTC(2026, 9, 12, 12, 21),
      Date.UTC(2026, 9, 12, 12, 19),
    )

    expect(crons).toHaveLength(1)
    expect(crons[0]).toMatchObject({ id: '00000001', due: true })
  })

  it('drops a one-time schedule that came due before the running turn began', () => {
    expect(
      extractCrons(oneTime, Date.UTC(2026, 9, 12, 12, 25), Date.UTC(2026, 9, 12, 12, 22)),
    ).toEqual([])
  })

  it('holds a repeating fire that came due mid-turn instead of moving on to the next one', () => {
    const turnStart = T0 + 15 * 60_000
    const now = T0 + 25 * 60_000

    const [held] = extractCrons(repeating, now, turnStart)
    const [idle] = extractCrons(repeating, now)

    expect(held.due).toBe(true)
    expect(held.nextFireAt).toBeGreaterThanOrEqual(turnStart)
    expect(held.nextFireAt).toBeLessThanOrEqual(now)
    expect(idle.due).toBe(false)
    expect(idle.nextFireAt).toBeGreaterThan(now)
  })

  it('drops a repeating schedule seven days after its creation', () => {
    const week = 7 * 24 * 60 * 60 * 1000

    expect(extractCrons(repeating, T0 + 10 + week - 1)).toHaveLength(1)
    expect(extractCrons(repeating, T0 + 10 + week)).toEqual([])
  })

  it('ignores schedules created inside a subagent', () => {
    const nested = create(
      'c5',
      '00000005',
      { cron: '* * * * *', prompt: 'p' },
      { extra: { parent_tool_use_id: 'task1' } },
    )

    expect(extractCrons(nested, T0)).toEqual([])
  })

  it('counts a five-minute schedule from the restart that re-registered it', () => {
    const five = create('c6', '00000000', { cron: '*/5 * * * *', prompt: 'p' })
    const restartAt = T0 + 60 * 60_000 + 7_000
    const restart = { type: 'system', subtype: 'container_restarted', ts: iso(restartAt) }

    const [cron] = extractCrons([...five, restart], restartAt + 60_000)

    expect(cron.nextFireAt).toBe(restartAt + 285_000)
  })

  it('keeps counting a durable five-minute schedule from its creation across a restart', () => {
    const five = create('c7', '00000000', { cron: '*/5 * * * *', prompt: 'p' }, { durable: true })
    const restartAt = T0 + 60 * 60_000 + 7_000
    const restart = { type: 'system', subtype: 'container_restarted', ts: iso(restartAt) }

    const [cron] = extractCrons([...five, restart], restartAt + 60_000)

    expect((cron.nextFireAt - (T0 + 10)) % 285_000).toBe(0)
  })
})

describe('isInterruptAck', () => {
  it('returns true for SDK interrupt acknowledgment', () => {
    const event = {
      type: 'user',
      is_human: false,
      subtype: 'text',
      content: '[interrupt requested]',
    }

    expect(isInterruptAck(event)).toBe(true)
  })

  it('returns true for interrupt message with surrounding whitespace', () => {
    const event = {
      type: 'user',
      is_human: false,
      subtype: 'text',
      content: '  [interrupt requested]  ',
    }

    expect(isInterruptAck(event)).toBe(true)
  })

  it('returns true regardless of casing', () => {
    const event = {
      type: 'user',
      is_human: false,
      subtype: 'text',
      content: '[Interrupt Sent]',
    }

    expect(isInterruptAck(event)).toBe(true)
  })

  it('returns false for human user messages', () => {
    const event = {
      type: 'user',
      is_human: true,
      subtype: 'text',
      content: '[interrupt requested]',
    }

    expect(isInterruptAck(event)).toBe(false)
  })

  it('returns false for assistant events', () => {
    const event = {
      type: 'assistant',
      is_human: false,
      subtype: 'text',
      content: '[interrupt requested]',
    }

    expect(isInterruptAck(event)).toBe(false)
  })

  it('returns false for non-text subtype', () => {
    const event = {
      type: 'user',
      is_human: false,
      subtype: 'tool_result',
      content: '[interrupt requested]',
    }

    expect(isInterruptAck(event)).toBe(false)
  })

  it('returns false for regular user text', () => {
    const event = {
      type: 'user',
      is_human: false,
      subtype: 'text',
      content: 'Some normal text',
    }

    expect(isInterruptAck(event)).toBe(false)
  })

  it('returns false when content is null', () => {
    const event = {
      type: 'user',
      is_human: false,
      subtype: 'text',
      content: null,
    }

    expect(isInterruptAck(event)).toBe(false)
  })
})

describe('processEvents - interrupt blocks', () => {
  it('suppresses interrupt acknowledgment event entirely', () => {
    const events = [
      {
        type: 'user',
        is_human: false,
        subtype: 'text',
        content: '[interrupt requested]',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('creates text block for non-interrupt non-human user text', () => {
    const events = [
      {
        type: 'user',
        is_human: false,
        subtype: 'text',
        content: 'Regular system message',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })
})

describe('processEvents - model-set echo filtering', () => {
  it('filters model-set stdout echo from non-human user text', () => {
    const events = [
      {
        type: 'user',
        is_human: false,
        subtype: 'text',
        content: '<local-command-stdout>Set model to claude-opus-5</local-command-stdout>',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(0)
  })

  it('preserves other non-human stdout content', () => {
    const events = [
      {
        type: 'user',
        is_human: false,
        subtype: 'text',
        content: '<local-command-stdout>Some other output</local-command-stdout>',
      },
    ]

    const blocks = processEvents(events).blocks

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })
})

describe('isVisibleEvent', () => {
  it('filters system init events', () => {
    expect(isVisibleEvent({ type: 'system', subtype: 'init' })).toBe(false)
  })

  it('filters system hook_response events', () => {
    expect(isVisibleEvent({ type: 'system', subtype: 'hook_response' })).toBe(false)
  })

  it('filters result events', () => {
    expect(isVisibleEvent({ type: 'result', subtype: 'success' })).toBe(false)
  })

  it('passes through assistant text events', () => {
    expect(isVisibleEvent({ type: 'assistant', subtype: 'text', content: 'Hello' })).toBe(true)
  })

  it('passes through user events', () => {
    expect(isVisibleEvent({ type: 'user', subtype: 'text', is_human: true })).toBe(true)
  })

  it('passes through system interrupt_sent events', () => {
    expect(isVisibleEvent({ type: 'system', subtype: 'interrupt_sent' })).toBe(true)
  })

  it('passes through system task_notification events', () => {
    expect(isVisibleEvent({ type: 'system', subtype: 'task_notification' })).toBe(true)
  })

  it('hides the task-notification user echo stored as a human message', () => {
    expect(
      isVisibleEvent({
        type: 'user',
        subtype: 'message',
        is_human: true,
        content:
          '<task-notification>\n<task-id>agent_abc</task-id>\n<status>completed</status>\n</task-notification>',
      }),
    ).toBe(false)
  })

  it('hides the task-notification user echo reclassified as non-human text', () => {
    expect(
      isVisibleEvent({
        type: 'user',
        subtype: 'text',
        is_human: false,
        content: '<task-notification>\n<task-id>agent_abc</task-id>\n</task-notification>',
      }),
    ).toBe(false)
  })

  it('passes through system model_changed events', () => {
    expect(
      isVisibleEvent({ type: 'system', subtype: 'model_changed', model: 'claude-opus-5' }),
    ).toBe(true)
  })

  it('passes through system permission_mode_changed events', () => {
    expect(
      isVisibleEvent({
        type: 'system',
        subtype: 'permission_mode_changed',
        permission_mode: 'plan',
      }),
    ).toBe(true)
  })
})

describe('appendTurns', () => {
  it('returns same turns and state for empty events', () => {
    const prevTurns = [{ turn_id: '1', userMessage: 'Hi', events: [], interrupted: false }]
    const prevState = { ...INITIAL_TURN_GROUPING_STATE, currentTurnIndex: 0 }

    const { turns, state } = appendTurns(prevTurns, prevState, [])

    expect(turns).toBe(prevTurns) // same reference
    expect(state).toBe(prevState)
  })

  it('creates new turn from human user message', () => {
    const { turns, state } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].turn_id).toBe('turn-1')
    expect(turns[0].userMessage).toBe('Hello')
    expect(turns[0].events).toEqual([])
    expect(turns[0].interrupted).toBe(false)
    expect(state.currentTurnIndex).toBe(0)
  })

  it('keeps the send time of the human message that opens a turn', () => {
    const { turns } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      {
        type: 'user',
        is_human: true,
        turn_id: 'turn-1',
        content: 'Hello',
        ts: '2025-01-18T12:00:00Z',
      },
      { type: 'assistant', subtype: 'text', turn_id: 'orphan', content: 'Hi' },
    ])

    expect(turns[0].userMessageTs).toBe('2025-01-18T12:00:00Z')
  })

  it('gives a turn with no human message no send time', () => {
    const { turns } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'assistant', subtype: 'text', turn_id: 'orphan-1', content: 'Orphan response' },
    ])

    expect(turns[0].userMessageTs).toBeNull()
  })

  it('appends assistant events to current turn', () => {
    // Batch 1: user message
    const { turns: t1, state: s1 } = helloTurn()

    // Batch 2: assistant response
    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'assistant', subtype: 'text', content: 'Hi there' },
      { type: 'assistant', subtype: 'text', content: 'How can I help?' },
    ])

    expect(t2).toHaveLength(1)
    expect(t2[0].events).toHaveLength(2)
    expect(t2[0].events[0].content).toBe('Hi there')
    expect(t2[0].events[1].content).toBe('How can I help?')
  })

  it('creates orphan turn for events without prior user message', () => {
    const { turns } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'assistant', subtype: 'text', turn_id: 'orphan-1', content: 'Orphan response' },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage).toBeNull()
    expect(turns[0].events).toHaveLength(1)
    expect(turns[0].events[0].content).toBe('Orphan response')
  })

  it('handles interrupt_sent by setting interrupted flag on current turn', () => {
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
      { type: 'assistant', subtype: 'text', content: 'Responding...' },
    ])

    const { turns: t2 } = appendTurns(t1, s1, [{ type: 'system', subtype: 'interrupt_sent' }])

    expect(t2).toHaveLength(1)
    expect(t2[0].interrupted).toBe(true)
  })

  it('skips interrupt_sent when turn already completed successfully', () => {
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
      { type: 'assistant', subtype: 'text', content: 'Done.' },
    ])

    // The turn_id on interrupt_sent matches a completed result
    const turnResults = { 'assistant-turn-1': 'success' }
    const { turns: t2 } = appendTurns(
      t1,
      s1,
      [{ type: 'system', subtype: 'interrupt_sent', turn_id: 'assistant-turn-1' }],
      turnResults,
    )

    expect(t2).toHaveLength(1)
    expect(t2[0].interrupted).toBe(false)
  })

  it.each([
    ['a stop that reached a running follow-up marks the turn', true, 'success', true],
    ['a stop that reached no running turn leaves it', false, 'success', false],
    ['a stop that reached no running turn leaves a failed one too', false, 'error', false],
    ['a stop that reached a running turn with no result yet marks it', true, undefined, true],
  ])('%s', (_label, turnRunning, result, interrupted) => {
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 't1', content: 'Start the audit' },
      { type: 'assistant', subtype: 'text', turn_id: 't1', content: 'Started.' },
    ])

    const { turns: t2 } = appendTurns(
      t1,
      s1,
      [{ type: 'system', subtype: 'interrupt_sent', turn_id: 't1', turn_running: turnRunning }],
      result ? { t1: result } : {},
    )

    expect(t2[0].interrupted).toBe(interrupted)
  })

  it.each([
    ['with the text it got to', true, 1],
    ['before any text', false, 0],
  ])(
    'a stopped turn replayed in one slice keeps its interrupt mark %s',
    (_label, withText, blocks) => {
      const slice = [
        { type: 'user', subtype: 'message', is_human: true, turn_id: 't1', content: 'Look it up' },
        { type: 'system', subtype: 'interrupt_sent', turn_id: 't1' },
        ...(withText
          ? [{ type: 'assistant', subtype: 'text', turn_id: 't1', content: 'Let me check.' }]
          : []),
        { type: 'result', subtype: 'error_during_execution', turn_id: 't1', content: '' },
      ]
      const turnResults = appendTurnResults({}, slice)

      const { turns } = appendTurns(
        [],
        INITIAL_TURN_GROUPING_STATE,
        slice.filter(isVisibleEvent),
        turnResults,
      )

      expect(turns[0].interrupted).toBe(true)
      expect(turnResults.t1).not.toBe('error')
      expect(turns[0].events.filter(e => e.subtype === 'text')).toHaveLength(blocks)
    },
  )

  it('handles compaction pairing across batches', () => {
    // Batch 1: user message + assistant response + compact_start
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-a', content: 'Message A' },
      { type: 'assistant', subtype: 'text', content: 'Response A' },
      { subtype: 'compact_start' },
    ])

    expect(t1).toHaveLength(1)
    // compact_start flushed at end of batch for in-progress rendering
    expect(t1[0].events).toHaveLength(2)
    expect(t1[0].events[0].content).toBe('Response A')
    expect(t1[0].events[1].subtype).toBe('compact_start')

    // Batch 2: new user message + compact_boundary + assistant response
    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'user', is_human: true, turn_id: 'turn-b', content: 'Message B' },
      { subtype: 'compact_boundary', turn_id: 'turn-b' },
      { type: 'assistant', subtype: 'text', content: 'Response B' },
    ])

    expect(t2).toHaveLength(2)
    // Turn A still has response + compact_start
    expect(t2[0].turn_id).toBe('turn-a')
    expect(t2[0].events).toHaveLength(2)
    expect(t2[0].events[0].content).toBe('Response A')
    expect(t2[0].events[1].subtype).toBe('compact_start')
    // Turn B has compact_boundary + assistant response
    expect(t2[1].turn_id).toBe('turn-b')
    expect(t2[1].events).toHaveLength(2)
    expect(t2[1].events[0].subtype).toBe('compact_boundary')
    expect(t2[1].events[1].content).toBe('Response B')
  })

  it('accumulates correctly across multiple batches', () => {
    // Batch 1
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: '1', content: 'First' },
      { type: 'assistant', subtype: 'text', content: 'Response 1' },
    ])

    // Batch 2
    const { turns: t2, state: s2 } = appendTurns(t1, s1, [
      { type: 'user', is_human: true, turn_id: '2', content: 'Second' },
      { type: 'assistant', subtype: 'text', content: 'Response 2' },
    ])

    // Batch 3
    const { turns: t3 } = appendTurns(t2, s2, [
      { type: 'user', is_human: true, turn_id: '3', content: 'Third' },
    ])

    expect(t3).toHaveLength(3)
    expect(t3[0].userMessage).toBe('First')
    expect(t3[0].events).toHaveLength(1)
    expect(t3[1].userMessage).toBe('Second')
    expect(t3[1].events).toHaveLength(1)
    expect(t3[2].userMessage).toBe('Third')
    expect(t3[2].events).toEqual([])
  })

  it('carries attachments from human user event into turn', () => {
    const attachments = [{ name: 'photo.png', type: 'image/png', data: 'abc123' }]
    const { turns } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      {
        type: 'user',
        is_human: true,
        turn_id: 'turn-att',
        content: 'See image',
        attachments,
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].attachments).toEqual(attachments)
    expect(turns[0].userMessage).toBe('See image')
  })

  it('sets attachments to null when event has no attachments', () => {
    const { turns } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-plain', content: 'No files' },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].attachments).toBeNull()
  })

  it('stores model_changed in settingChanges (not events)', () => {
    const { turns: t1, state: s1 } = helloTurn()

    const { turns: t2 } = appendTurns(t1, s1, [
      {
        type: 'system',
        subtype: 'model_changed',
        model: 'claude-opus-5',
        previous_model: 'claude-sonnet-5',
      },
    ])

    expect(t2).toHaveLength(1)
    expect(t2[0].events).toHaveLength(0)
    expect(t2[0].settingChanges).toHaveLength(1)
    expect(t2[0].settingChanges[0].subtype).toBe('model_changed')
  })

  it('stores permission_mode_changed in settingChanges (not events)', () => {
    const { turns: t1, state: s1 } = helloTurn()

    const { turns: t2 } = appendTurns(t1, s1, [
      {
        type: 'system',
        subtype: 'permission_mode_changed',
        permission_mode: 'plan',
        previous_permission_mode: 'bypassPermissions',
      },
    ])

    expect(t2).toHaveLength(1)
    expect(t2[0].events).toHaveLength(0)
    expect(t2[0].settingChanges).toHaveLength(1)
    expect(t2[0].settingChanges[0].subtype).toBe('permission_mode_changed')
  })

  it('skips init permission_mode_changed without previous value', () => {
    const { turns: t1, state: s1 } = helloTurn()

    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'system', subtype: 'permission_mode_changed', permission_mode: 'bypassPermissions' },
    ])

    expect(t2[0].settingChanges).toHaveLength(0)
  })

  it('skips init model_changed without previous value', () => {
    const { turns: t1, state: s1 } = helloTurn()

    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'system', subtype: 'model_changed', model: 'claude-opus-5' },
    ])

    expect(t2[0].settingChanges).toHaveLength(0)
  })

  it('stores container_restarted in settingChanges (renders unconditionally)', () => {
    const { turns: t1, state: s1 } = helloTurn()

    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'system', subtype: 'container_restarted', message_data: null },
    ])

    expect(t2[0].settingChanges).toHaveLength(1)
    expect(t2[0].settingChanges[0].subtype).toBe('container_restarted')
  })

  it('stores container_restarted with fork payload in settingChanges', () => {
    const { turns: t1, state: s1 } = helloTurn()

    const { turns: t2 } = appendTurns(t1, s1, [
      {
        type: 'system',
        subtype: 'container_restarted',
        message_data: { fork_parent_session_id: 'parent-abc' },
      },
    ])

    expect(t2[0].settingChanges).toHaveLength(1)
    expect(t2[0].settingChanges[0].message_data?.fork_parent_session_id).toBe('parent-abc')
  })

  it('does not reset compaction tracking on setting change', () => {
    // Start with user message + compact_start
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-a', content: 'Msg A' },
      { type: 'assistant', subtype: 'text', content: 'Response' },
      { subtype: 'compact_start' },
    ])

    // Setting change during compaction should not break compaction pairing
    const { turns: t2, state: s2 } = appendTurns(t1, s1, [
      {
        type: 'system',
        subtype: 'permission_mode_changed',
        permission_mode: 'plan',
        previous_permission_mode: 'bypassPermissions',
      },
    ])

    // compact_boundary buffers, then assistant event triggers flush
    const { turns: t3 } = appendTurns(t2, s2, [
      { subtype: 'compact_boundary', turn_id: 'turn-a' },
      { type: 'assistant', subtype: 'text', content: 'Post-compact response' },
    ])

    expect(t3).toHaveLength(1)
    // events: response + compact_start + compact_boundary + post-compact response
    expect(t3[0].events).toHaveLength(4)
    expect(t3[0].events[1].subtype).toBe('compact_start')
    expect(t3[0].events[2].subtype).toBe('compact_boundary')
    expect(t3[0].events[3].content).toBe('Post-compact response')
    expect(t3[0].settingChanges).toHaveLength(1)
    expect(t3[0].settingChanges[0].subtype).toBe('permission_mode_changed')
  })

  it('places auto-compaction events in new assistant turn, not previous', () => {
    // Simulates real SDK auto-compaction: previous turn ends, compact_start fires before the user message echo.
    const { turns: t1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-prev', content: 'Previous message' },
      { type: 'assistant', subtype: 'text', content: 'Previous response' },
      { type: 'result', subtype: 'success', turn_id: 'turn-prev' },
      { subtype: 'compact_start' },
      { type: 'user', is_human: true, turn_id: 'turn-new', content: 'New message' },
      { subtype: 'compact_boundary', turn_id: 'turn-new' },
      { type: 'assistant', subtype: 'text', content: 'New response' },
    ])

    expect(t1).toHaveLength(2)
    // Previous turn: assistant response only (no compaction events)
    expect(t1[0].turn_id).toBe('turn-prev')
    expect(t1[0].events).toHaveLength(1)
    expect(t1[0].events[0].content).toBe('Previous response')
    // New turn: compact_start + compact_boundary + assistant response
    expect(t1[1].turn_id).toBe('turn-new')
    expect(t1[1].events).toHaveLength(3)
    expect(t1[1].events[0].subtype).toBe('compact_start')
    expect(t1[1].events[1].subtype).toBe('compact_boundary')
    expect(t1[1].events[2].content).toBe('New response')
  })

  it('flushes compaction events at end of batch for immediate rendering', () => {
    // Batch 1: compact_start fires, flushed at end of batch for in-progress display
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-a', content: 'Message' },
      { type: 'assistant', subtype: 'text', content: 'Response' },
      { subtype: 'compact_start' },
    ])

    // compact_start flushed to turn events (renders in-progress compaction block)
    expect(t1[0].events).toHaveLength(2)
    expect(t1[0].events[1].subtype).toBe('compact_start')
    expect(s1.pendingCompactionEvents).toBeNull()

    // Batch 2: compact_boundary arrives, flushed at end of batch
    const { turns: t2, state: s2 } = appendTurns(t1, s1, [
      { type: 'user', is_human: true, turn_id: 'turn-b', content: 'New message' },
      { subtype: 'compact_boundary' },
    ])

    // compact_boundary flushed to new turn
    expect(t2).toHaveLength(2)
    expect(t2[1].events).toHaveLength(1)
    expect(t2[1].events[0].subtype).toBe('compact_boundary')
    expect(s2.pendingCompactionEvents).toBeNull()

    // Batch 3: assistant event added normally
    const { turns: t3, state: s3 } = appendTurns(t2, s2, [
      { type: 'assistant', subtype: 'text', content: 'Post-compaction response' },
    ])

    expect(t3[1].events).toHaveLength(2)
    expect(t3[1].events[0].subtype).toBe('compact_boundary')
    expect(t3[1].events[1].content).toBe('Post-compaction response')
    expect(s3.pendingCompactionEvents).toBeNull()
  })

  it('drops setting change when no current turn exists', () => {
    const { turns } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'system', subtype: 'model_changed', model: 'claude-opus-5' },
    ])

    expect(turns).toHaveLength(0)
  })

  it('attaches a reported failure to the current turn, with no result event', () => {
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
      { type: 'assistant', subtype: 'text', content: 'Working on it' },
    ])

    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'system', subtype: 'error', turn_id: 'turn-1', content: 'runtime crashed' },
    ])

    expect(t2[0].events).toHaveLength(2)
    expect(t2[0].events[1].subtype).toBe('error')
    expect(t2[0].events[1].content).toBe('runtime crashed')
  })

  it('renders a reported failure through the orphan-turn fall-through when nothing is open', () => {
    const { turns } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'system', subtype: 'error', content: 'runtime crashed before any turn' },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage).toBeNull()
    expect(turns[0].events).toHaveLength(1)
    expect(turns[0].events[0].subtype).toBe('error')
  })
})

describe('appendTurnResults', () => {
  it('returns original reference when no result events exist', () => {
    const existing = { 'turn-1': 'success' }
    const events = [{ type: 'assistant', subtype: 'text', content: 'Hello' }]

    const result = appendTurnResults(existing, events)

    expect(result).toBe(existing) // same reference
  })

  it('accumulates result events by turn_id', () => {
    const existing = {}
    const events = [
      { type: 'result', subtype: 'success', turn_id: 'turn-1' },
      { type: 'assistant', subtype: 'text', content: 'Hello' },
      { type: 'result', subtype: 'error', turn_id: 'turn-2' },
    ]

    const result = appendTurnResults(existing, events)

    expect(result).not.toBe(existing)
    expect(result['turn-1']).toBe('success')
    expect(result['turn-2']).toBe('error')
  })

  it('skips result events without turn_id', () => {
    const existing = {}
    const events = [{ type: 'result', subtype: 'success' }]

    const result = appendTurnResults(existing, events)

    expect(result).toBe(existing)
  })

  it('records a reported failure as an error result, same as a result-reported one', () => {
    const existing = {}
    const events = [{ type: 'system', subtype: 'error', turn_id: 'turn-1', content: 'boom' }]

    const result = appendTurnResults(existing, events)

    expect(result['turn-1']).toBe('error')
  })

  it('skips a reported failure without turn_id', () => {
    const existing = {}
    const events = [{ type: 'system', subtype: 'error', content: 'boom' }]

    const result = appendTurnResults(existing, events)

    expect(result).toBe(existing)
  })

  it('keeps a reported failure when a success result for the same turn follows in the batch', () => {
    const events = [
      { type: 'system', subtype: 'error', turn_id: 'turn-1', content: 'Not logged in.' },
      { type: 'result', subtype: 'success', turn_id: 'turn-1' },
    ]

    expect(appendTurnResults({}, events)['turn-1']).toBe('error')
  })

  it('keeps a failure recorded by an earlier batch when its success result arrives later', () => {
    const existing = { 'turn-1': 'error' }
    const events = [{ type: 'result', subtype: 'success', turn_id: 'turn-1' }]

    expect(appendTurnResults(existing, events)['turn-1']).toBe('error')
  })
})

describe('appendTaskNotifications', () => {
  it('returns original reference when no notifications exist', () => {
    const existing = new Map()
    const events = [{ type: 'assistant', subtype: 'text', content: 'Hello' }]

    const result = appendTaskNotifications(existing, events)

    expect(result).toBe(existing) // same reference
  })

  it('processes system task_notification with content field', () => {
    const existing = new Map()
    const events = [
      {
        type: 'system',
        subtype: 'task_notification',
        message_data: {
          task_id: 'task-1',
          status: 'completed',
          summary: 'Task done',
          content: 'Full task output\nwith multiple lines',
        },
      },
    ]

    const result = appendTaskNotifications(existing, events)

    expect(result).not.toBe(existing)
    expect(result.size).toBe(1)
    expect(result.get('task-1')).toEqual({
      status: 'completed',
      summary: 'Full task output',
      content: 'Full task output\nwith multiple lines',
      index: 0,
    })
  })

  it('falls back to summary when content absent', () => {
    const existing = new Map()
    const events = [
      {
        type: 'system',
        subtype: 'task_notification',
        message_data: { task_id: 'task-1', status: 'completed', summary: 'Task done' },
      },
    ]

    const result = appendTaskNotifications(existing, events)

    expect(result.get('task-1')).toEqual({
      status: 'completed',
      summary: 'Task done',
      content: 'Task done',
      index: 0,
    })
  })

  it('preserves existing notifications when adding new ones', () => {
    const existing = new Map([
      ['task-old', { status: 'completed', summary: 'Old task', content: 'Old task' }],
    ])
    const events = [
      {
        type: 'system',
        subtype: 'task_notification',
        message_data: { task_id: 'task-new', status: 'completed', summary: 'New task' },
      },
    ]

    const result = appendTaskNotifications(existing, events)

    expect(result.size).toBe(2)
    expect(result.get('task-old').summary).toBe('Old task')
    expect(result.get('task-new').summary).toBe('New task')
  })
  it('records the notice time and its position in the event log', () => {
    const events = [
      { type: 'assistant', subtype: 'text', content: 'x' },
      {
        type: 'system',
        subtype: 'task_notification',
        ts: '2026-10-13T10:50:12.000Z',
        message_data: { task_id: 'b1', status: 'killed', summary: 'Wait' },
      },
    ]

    const result = appendTaskNotifications(new Map(), events, 40)

    expect(result.get('b1')).toMatchObject({
      status: 'killed',
      ts: Date.UTC(2026, 9, 13, 10, 50, 12),
      index: 41,
    })
  })
})

function bashUse(id, input, extra = {}) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content: 'Bash',
    tool_use_id: id,
    tool_input: input,
    ...extra,
  }
}

function bashLaunchResult(id, taskId, extra = {}) {
  return {
    type: 'user',
    subtype: 'tool_result',
    tool_use_id: id,
    tool_input: null,
    tool_use_result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: taskId },
    ...extra,
  }
}

function agentLaunchResult(id, agentId, description) {
  return {
    type: 'user',
    subtype: 'tool_result',
    tool_use_id: id,
    tool_use_result: { isAsync: true, status: 'async_launched', agentId, description },
  }
}

function notice(taskId, status = 'completed') {
  return { type: 'system', subtype: 'task_notification', message_data: { task_id: taskId, status } }
}

function launchesOf(events) {
  return appendBackgroundLaunches(new Map(), new Map(), events).launches
}

describe('appendBackgroundLaunches', () => {
  it('names a background command by its description', () => {
    const launches = launchesOf([
      bashUse('tu1', {
        command: 'sleep 120',
        description: 'Wait two minutes',
        run_in_background: true,
      }),
      bashLaunchResult('tu1', 'b1'),
    ])

    expect(launches.get('b1')).toEqual({
      id: 'b1',
      name: 'Wait two minutes',
      toolUseId: 'tu1',
      index: 1,
    })
  })

  it('names a background command by the command when the description is missing or empty', () => {
    const launches = launchesOf([
      bashUse('tu1', { command: 'npm run dev', run_in_background: true }),
      bashLaunchResult('tu1', 'b1'),
      bashUse('tu2', { command: 'make watch', description: '', run_in_background: true }),
      bashLaunchResult('tu2', 'b2'),
    ])

    expect(launches.get('b1').name).toBe('npm run dev')
    expect(launches.get('b2').name).toBe('make watch')
  })

  it('names a background subagent from its launch result', () => {
    const launches = launchesOf([agentLaunchResult('tu9', 'a1', 'Verify the release notes')])

    expect(launches.get('a1')).toEqual({
      id: 'a1',
      name: 'Verify the release notes',
      toolUseId: 'tu9',
      index: 0,
    })
  })

  it('counts a command moved to the background after its time limit', () => {
    const launches = launchesOf([
      bashUse('tu1', { command: 'just check', description: 'Run the full gate' }),
      bashLaunchResult('tu1', 'b7', {
        tool_use_result: { stdout: '', backgroundTaskId: 'b7', timedOutAfterMs: 600000 },
      }),
    ])

    expect(launches.get('b7').name).toBe('Run the full gate')
  })

  it('ignores a foreground command and work launched inside a subagent', () => {
    const launches = launchesOf([
      bashUse('tu1', { command: 'ls' }),
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: 'tu1',
        tool_use_result: { stdout: 'a' },
      },
      bashUse(
        'tu2',
        { command: 'sleep 9', run_in_background: true },
        { parent_tool_use_id: 'task1' },
      ),
      bashLaunchResult('tu2', 'b2', { parent_tool_use_id: 'task1' }),
    ])

    expect(launches.size).toBe(0)
  })

  it('positions launches after the events already in the log', () => {
    const { launches } = appendBackgroundLaunches(
      new Map(),
      new Map(),
      [bashUse('tu1', { command: 'sleep 1' }), bashLaunchResult('tu1', 'b1')],
      10,
    )

    expect(launches.get('b1').index).toBe(11)
  })

  it('pairs a result with the input remembered from an earlier batch', () => {
    const first = appendBackgroundLaunches(new Map(), new Map(), [
      bashUse('tu1', { command: 'sleep 5', description: 'Nap' }),
    ])

    const second = appendBackgroundLaunches(first.launches, first.bashInputs, [
      bashLaunchResult('tu1', 'b1'),
    ])

    expect(second.launches.get('b1').name).toBe('Nap')
    expect(second.bashInputs.size).toBe(0)
  })

  it('keeps both references when nothing new arrives', () => {
    const launches = new Map()
    const inputs = new Map()

    const result = appendBackgroundLaunches(launches, inputs, [
      { type: 'assistant', subtype: 'text', content: 'hi' },
    ])

    expect(result.launches).toBe(launches)
    expect(result.bashInputs).toBe(inputs)
  })
})

describe('selectRunningBackgroundWork', () => {
  const launches = launchesOf([
    bashUse('tu1', { command: 'sleep 1', description: 'One' }),
    bashLaunchResult('tu1', 'b1'),
    bashUse('tu2', { command: 'sleep 2', description: 'Two' }),
    bashLaunchResult('tu2', 'b2'),
    agentLaunchResult('tu3', 'a3', 'Three'),
  ])

  it('lists every launch without a completion notice, in launch order', () => {
    const running = selectRunningBackgroundWork(launches, new Map(), -1)

    expect(running.map(w => w.name)).toEqual(['One', 'Two', 'Three'])
  })

  it.each(['completed', 'failed', 'killed'])('drops a launch whose notice says %s', status => {
    const notifications = appendTaskNotifications(new Map(), [notice('b2', status)])

    const running = selectRunningBackgroundWork(launches, notifications, -1)

    expect(running.map(w => w.id)).toEqual(['b1', 'a3'])
  })

  it('drops a launch whose notice arrived before its launch result', () => {
    const events = [
      bashUse('tu1', { command: 'true' }),
      notice('b1'),
      bashLaunchResult('tu1', 'b1'),
    ]
    const notifications = appendTaskNotifications(new Map(), events)

    expect(selectRunningBackgroundWork(launchesOf(events), notifications, -1)).toEqual([])
  })

  it('drops launches made before the last container restart and keeps later ones', () => {
    const events = [
      bashUse('tu1', { command: 'sleep 99', description: 'Before' }),
      bashLaunchResult('tu1', 'b1'),
      { type: 'system', subtype: 'container_restarted' },
      bashUse('tu2', { command: 'sleep 99', description: 'After' }),
      bashLaunchResult('tu2', 'b2'),
    ]

    const running = selectRunningBackgroundWork(launchesOf(events), new Map(), 2)

    expect(running.map(w => w.name)).toEqual(['After'])
  })
})

describe('hasUnclaimedCompletion', () => {
  const events = [
    bashUse('tu1', { command: 'sleep 1' }),
    bashLaunchResult('tu1', 'b1'),
    { type: 'result', subtype: 'success' },
    notice('b1'),
  ]
  const launches = launchesOf(events)
  const notifications = appendTaskNotifications(new Map(), events)

  it('is true for a tracked launch finishing after the last turn ended', () => {
    expect(hasUnclaimedCompletion(launches, notifications, 2, -1)).toBe(true)
  })

  it('is false once a later result or message settles it', () => {
    expect(hasUnclaimedCompletion(launches, notifications, 4, -1)).toBe(false)
  })

  it('ignores a kill notice for work launched before the last restart', () => {
    expect(hasUnclaimedCompletion(launches, notifications, 2, 2)).toBe(false)
  })

  it('ignores a notice for a task no tracked launch started', () => {
    const foreign = appendTaskNotifications(new Map(), [{ ...notice('fg1') }], 3)

    expect(hasUnclaimedCompletion(launches, foreign, 2, -1)).toBe(false)
  })
})

describe('appendTodoDiffs', () => {
  it('returns original reference when no TodoWrite events exist', () => {
    const existing = new Map()
    const prevMap = new Map()
    const events = [{ subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' }]

    const { diffs, previousTodosBySubagent } = appendTodoDiffs(existing, prevMap, new Map(), events)

    expect(diffs).toBe(existing) // same reference
    expect(previousTodosBySubagent).toBe(prevMap)
  })

  it('computes diff for first TodoWrite (all items added)', () => {
    const existing = new Map()
    const events = [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_1',
        tool_input: {
          todos: [
            { content: 'Task 1', status: 'pending' },
            { content: 'Task 2', status: 'pending' },
          ],
        },
      },
    ]

    const { diffs, previousTodosBySubagent } = appendTodoDiffs(
      existing,
      new Map(),
      new Map(),
      events,
    )

    expect(diffs.size).toBe(1)
    const diff = diffs.get('tu_1')
    expect(diff.added).toHaveLength(2)
    expect(diff.completed).toHaveLength(0)
    expect(diff.started).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    // previousTodosBySubagent should track main agent
    expect(previousTodosBySubagent.get('main')).toHaveLength(2)
    expect(previousTodosBySubagent.get('main')[0].content).toBe('Task 1')
  })

  it('computes diffs across batches preserving previousTodosBySubagent', () => {
    const existing = new Map()

    // Batch 1: first TodoWrite
    const batch1Events = [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_1',
        tool_input: {
          todos: [{ content: 'Task 1', status: 'pending' }],
        },
      },
    ]

    const { diffs: diffs1, previousTodosBySubagent: prev1 } = appendTodoDiffs(
      existing,
      new Map(),
      new Map(),
      batch1Events,
    )

    expect(diffs1.size).toBe(1)
    expect(prev1.get('main')).toHaveLength(1)

    // Batch 2: second TodoWrite completes the task
    const batch2Events = [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_2',
        tool_input: {
          todos: [{ content: 'Task 1', status: 'completed' }],
        },
      },
    ]

    const { diffs: diffs2, previousTodosBySubagent: prev2 } = appendTodoDiffs(
      diffs1,
      prev1,
      new Map(),
      batch2Events,
    )

    expect(diffs2.size).toBe(2)
    const diff = diffs2.get('tu_2')
    expect(diff.completed).toHaveLength(1)
    expect(diff.completed[0].content).toBe('Task 1')
    expect(diff.added).toHaveLength(0)
    expect(prev2.get('main')).toHaveLength(1)
    expect(prev2.get('main')[0].status).toBe('completed')
  })

  it('preserves existing diffs when adding new ones', () => {
    const existing = new Map([
      [
        'tu_old',
        { completed: [], started: [], added: [{ content: 'Old', status: 'pending' }], removed: [] },
      ],
    ])
    const events = [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_new',
        tool_input: {
          todos: [{ content: 'New Task', status: 'pending' }],
        },
      },
    ]

    const { diffs } = appendTodoDiffs(existing, new Map(), new Map(), events)

    expect(diffs.size).toBe(2)
    expect(diffs.get('tu_old').added[0].content).toBe('Old')
    expect(diffs.get('tu_new').added[0].content).toBe('New Task')
  })

  it('scopes diffs per subagent using parent_tool_use_id', () => {
    const prevMap = new Map()

    // Subagent A writes its todos
    const batch1 = [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_a1',
        parent_tool_use_id: 'task_a',
        tool_input: {
          todos: [
            { content: 'A-1', status: 'pending' },
            { content: 'A-2', status: 'pending' },
          ],
        },
      },
    ]

    const { diffs: d1, previousTodosBySubagent: p1 } = appendTodoDiffs(
      new Map(),
      prevMap,
      new Map(),
      batch1,
    )

    expect(d1.get('tu_a1').added).toHaveLength(2)
    expect(p1.get('task_a')).toHaveLength(2)

    // Subagent B writes different todos - should NOT diff against A's list
    const batch2 = [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_b1',
        parent_tool_use_id: 'task_b',
        tool_input: {
          todos: [{ content: 'B-1', status: 'in_progress' }],
        },
      },
    ]

    const { diffs: d2, previousTodosBySubagent: p2 } = appendTodoDiffs(d1, p1, new Map(), batch2)

    // B's diff should show 1 started (new item with in_progress), NOT removal of A's items
    const diffB = d2.get('tu_b1')
    expect(diffB.started).toHaveLength(1)
    expect(diffB.started[0].content).toBe('B-1')
    expect(diffB.removed).toHaveLength(0)
    // Both subagent states preserved
    expect(p2.get('task_a')).toHaveLength(2)
    expect(p2.get('task_b')).toHaveLength(1)
  })

  it('diffs subagent updates against own previous state', () => {
    // Subagent A: initial write
    const { diffs: d1, previousTodosBySubagent: p1 } = appendTodoDiffs(
      new Map(),
      new Map(),
      new Map(),
      [
        {
          subtype: 'tool_use',
          content: 'TodoWrite',
          tool_use_id: 'tu_a1',
          parent_tool_use_id: 'task_a',
          tool_input: { todos: [{ content: 'Step 1', status: 'pending' }] },
        },
      ],
    )

    // Subagent A: second write completes Step 1
    const { diffs: d2 } = appendTodoDiffs(d1, p1, new Map(), [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_a2',
        parent_tool_use_id: 'task_a',
        tool_input: { todos: [{ content: 'Step 1', status: 'completed' }] },
      },
    ])

    const diff = d2.get('tu_a2')
    expect(diff.completed).toHaveLength(1)
    expect(diff.completed[0].content).toBe('Step 1')
    expect(diff.added).toHaveLength(0)
  })

  it('handles main agent and subagent interleaved', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_main',
        tool_input: { todos: [{ content: 'Main task', status: 'pending' }] },
      },
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_sub',
        parent_tool_use_id: 'task_1',
        tool_input: { todos: [{ content: 'Sub task', status: 'in_progress' }] },
      },
    ]

    const { diffs, previousTodosBySubagent } = appendTodoDiffs(
      new Map(),
      new Map(),
      new Map(),
      events,
    )

    expect(diffs.size).toBe(2)
    expect(diffs.get('tu_main').added).toHaveLength(1)
    expect(diffs.get('tu_sub').started).toHaveLength(1)
    expect(previousTodosBySubagent.get('main')).toHaveLength(1)
    expect(previousTodosBySubagent.get('task_1')).toHaveLength(1)
  })

  it('removes subagent todos when tool_result arrives for that subagent', () => {
    // Subagent writes todos
    const { previousTodosBySubagent: p1 } = appendTodoDiffs(new Map(), new Map(), new Map(), [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_a1',
        parent_tool_use_id: 'task_a',
        tool_input: { todos: [{ content: 'Step 1', status: 'completed' }] },
      },
    ])

    expect(p1.has('task_a')).toBe(true)

    // Task completes - tool_result for task_a
    const { previousTodosBySubagent: p2 } = appendTodoDiffs(new Map(), p1, new Map(), [
      { subtype: 'tool_result', tool_use_id: 'task_a', content: 'Done' },
    ])

    expect(p2.has('task_a')).toBe(false)
  })

  it('does not remove main agent todos on unrelated tool_result', () => {
    const { previousTodosBySubagent: p1 } = appendTodoDiffs(new Map(), new Map(), new Map(), [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_1',
        tool_input: { todos: [{ content: 'Main task', status: 'pending' }] },
      },
    ])

    expect(p1.has('main')).toBe(true)

    // Unrelated tool_result
    const { previousTodosBySubagent: p2 } = appendTodoDiffs(new Map(), p1, new Map(), [
      { subtype: 'tool_result', tool_use_id: 'tu_unrelated', content: 'ok' },
    ])

    expect(p2.has('main')).toBe(true)
    expect(p2).toBe(p1) // same reference - no mutation
  })

  it('preserves other subagent todos when one completes', () => {
    // Two subagents write todos
    const { previousTodosBySubagent: p1 } = appendTodoDiffs(new Map(), new Map(), new Map(), [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_a',
        parent_tool_use_id: 'task_a',
        tool_input: { todos: [{ content: 'A task', status: 'pending' }] },
      },
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_b',
        parent_tool_use_id: 'task_b',
        tool_input: { todos: [{ content: 'B task', status: 'in_progress' }] },
      },
    ])

    expect(p1.has('task_a')).toBe(true)
    expect(p1.has('task_b')).toBe(true)

    // Only task_a completes
    const { previousTodosBySubagent: p2 } = appendTodoDiffs(new Map(), p1, new Map(), [
      { subtype: 'tool_result', tool_use_id: 'task_a', content: 'Done' },
    ])

    expect(p2.has('task_a')).toBe(false)
    expect(p2.has('task_b')).toBe(true)
    expect(p2.get('task_b')).toHaveLength(1)
  })

  it('removes async subagent todos on system task_notification', () => {
    // Batch 1: async launch - tool_result with isAsync before any TodoWrite
    const { previousTodosBySubagent: p1, asyncTaskIdMap: a1 } = appendTodoDiffs(
      new Map(),
      new Map(),
      new Map(),
      [
        {
          subtype: 'tool_result',
          tool_use_id: 'task_a',
          content: 'Async agent launched',
          tool_use_result: { isAsync: true, agentId: 'agent_xyz' },
        },
      ],
    )

    expect(a1.get('agent_xyz')).toBe('task_a')

    // Batch 2: subagent writes todos
    const { previousTodosBySubagent: p2, asyncTaskIdMap: a2 } = appendTodoDiffs(new Map(), p1, a1, [
      {
        subtype: 'tool_use',
        content: 'TodoWrite',
        tool_use_id: 'tu_sub',
        parent_tool_use_id: 'task_a',
        tool_input: { todos: [{ content: 'Async step', status: 'pending' }] },
      },
    ])

    expect(p2.has('task_a')).toBe(true)

    // Batch 3: task completes via system notification
    const { previousTodosBySubagent: p3 } = appendTodoDiffs(new Map(), p2, a2, [
      {
        type: 'system',
        subtype: 'task_notification',
        message_data: { task_id: 'agent_xyz', status: 'completed' },
      },
    ])

    expect(p3.has('task_a')).toBe(false)
  })

  it('cleans up multiple async tasks independently', () => {
    // Launch two async tasks
    const { asyncTaskIdMap: a1 } = appendTodoDiffs(new Map(), new Map(), new Map(), [
      {
        subtype: 'tool_result',
        tool_use_id: 'task_x',
        content: 'launched',
        tool_use_result: { isAsync: true, agentId: 'ax' },
      },
      {
        subtype: 'tool_result',
        tool_use_id: 'task_y',
        content: 'launched',
        tool_use_result: { isAsync: true, agentId: 'ay' },
      },
    ])

    // Both subagents write todos
    const { previousTodosBySubagent: p1, asyncTaskIdMap: a2 } = appendTodoDiffs(
      new Map(),
      new Map(),
      a1,
      [
        {
          subtype: 'tool_use',
          content: 'TodoWrite',
          tool_use_id: 'tu_x',
          parent_tool_use_id: 'task_x',
          tool_input: { todos: [{ content: 'X work', status: 'pending' }] },
        },
        {
          subtype: 'tool_use',
          content: 'TodoWrite',
          tool_use_id: 'tu_y',
          parent_tool_use_id: 'task_y',
          tool_input: { todos: [{ content: 'Y work', status: 'pending' }] },
        },
      ],
    )

    expect(p1.has('task_x')).toBe(true)
    expect(p1.has('task_y')).toBe(true)

    // Only task_x completes
    const { previousTodosBySubagent: p2 } = appendTodoDiffs(new Map(), p1, a2, [
      {
        type: 'system',
        subtype: 'task_notification',
        message_data: { task_id: 'ax', status: 'completed' },
      },
    ])

    expect(p2.has('task_x')).toBe(false)
    expect(p2.has('task_y')).toBe(true)
  })

  it('preserves asyncTaskIdMap reference when no async events', () => {
    const asyncMap = new Map()
    const { asyncTaskIdMap } = appendTodoDiffs(new Map(), new Map(), asyncMap, [
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' },
    ])

    expect(asyncTaskIdMap).toBe(asyncMap)
  })
})

describe('appendSubagentLabels', () => {
  it('returns original reference when no Task events exist', () => {
    const existing = new Map()
    const events = [{ subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' }]

    const result = appendSubagentLabels(existing, events)

    expect(result).toBe(existing)
  })

  it('extracts description from Task tool_use events', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'task_1',
        tool_input: { description: 'Run tests', prompt: 'Run all unit tests' },
      },
    ]

    const result = appendSubagentLabels(new Map(), events)

    expect(result.size).toBe(1)
    expect(result.get('task_1')).toBe('Run tests')
  })

  it('tracks multiple Task events', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'task_1',
        tool_input: { description: 'Build project' },
      },
      {
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'task_2',
        tool_input: { description: 'Run linter' },
      },
    ]

    const result = appendSubagentLabels(new Map(), events)

    expect(result.size).toBe(2)
    expect(result.get('task_1')).toBe('Build project')
    expect(result.get('task_2')).toBe('Run linter')
  })

  it('skips Task events without description', () => {
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'task_1',
        tool_input: { prompt: 'Do something' },
      },
    ]

    const result = appendSubagentLabels(new Map(), events)

    expect(result.size).toBe(0)
  })

  it('preserves existing labels', () => {
    const existing = new Map([['task_old', 'Old task']])
    const events = [
      {
        subtype: 'tool_use',
        content: 'Task',
        tool_use_id: 'task_new',
        tool_input: { description: 'New task' },
      },
    ]

    const result = appendSubagentLabels(existing, events)

    expect(result.size).toBe(2)
    expect(result.get('task_old')).toBe('Old task')
    expect(result.get('task_new')).toBe('New task')
  })
})

describe('getAskUserFingerprint', () => {
  it('generates fingerprint from sorted lowercase headers', () => {
    const questions = [
      { header: 'Approach', question: 'Which approach?' },
      { header: 'Library', question: 'Which library?' },
    ]

    expect(getAskUserFingerprint(questions)).toBe('approach|library')
  })

  it('sorts headers for order-independent matching', () => {
    const q1 = [
      { header: 'Library', question: 'Q1' },
      { header: 'Approach', question: 'Q2' },
    ]
    const q2 = [
      { header: 'Approach', question: 'Q2' },
      { header: 'Library', question: 'Q1' },
    ]

    expect(getAskUserFingerprint(q1)).toBe(getAskUserFingerprint(q2))
  })

  it('returns empty string for null/undefined/empty questions', () => {
    expect(getAskUserFingerprint(null)).toBe('')
    expect(getAskUserFingerprint(undefined)).toBe('')
    expect(getAskUserFingerprint([])).toBe('')
  })

  it('handles missing header fields gracefully', () => {
    const questions = [{ question: 'No header?' }]

    expect(getAskUserFingerprint(questions)).toBe('')
  })

  it('trims and lowercases headers', () => {
    const questions = [{ header: '  Auth Method  ' }]

    expect(getAskUserFingerprint(questions)).toBe('auth method')
  })

  describe('malformed payloads', () => {
    let warnSpy
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('returns empty string for a JSON-encoded string (no crash)', () => {
      // Canonical malformed shape: persisted as a string instead of an array.
      const stringified = '[{"header":"Approach","question":"Which?"}]'

      expect(getAskUserFingerprint(stringified)).toBe('')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('returns empty string for an empty stringified array', () => {
      expect(getAskUserFingerprint('[]')).toBe('')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('returns empty string for a plain object', () => {
      expect(getAskUserFingerprint({ header: 'x' })).toBe('')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('returns empty string for a number', () => {
      expect(getAskUserFingerprint(42)).toBe('')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('returns empty string for true (boolean)', () => {
      expect(getAskUserFingerprint(true)).toBe('')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('does not warn on null/undefined/empty array', () => {
      expect(getAskUserFingerprint(null)).toBe('')
      expect(getAskUserFingerprint(undefined)).toBe('')
      expect(getAskUserFingerprint([])).toBe('')
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})

describe('computeDuplicateAskUserIds', () => {
  // Helper: build a turn with events
  const makeTurn = events => ({ turn_id: 'turn', userMessage: null, events, settingChanges: [] })

  const askEvent = (id, questions) => ({
    subtype: 'tool_use',
    content: 'AskUserQuestion',
    tool_use_id: id,
    tool_input: { questions },
  })

  const errorResult = id => ({
    subtype: 'tool_result',
    tool_use_id: id,
    content: 'Answer questions?',
    is_error: true,
  })

  const successResult = id => ({
    subtype: 'tool_result',
    tool_use_id: id,
    content: '{"answers": {}}',
    is_error: null,
  })

  const questions = [{ header: 'Approach', question: 'Which approach?' }]

  it('hides errored AskUserQuestion when later same-fingerprint sibling exists', () => {
    const turns = [
      makeTurn([askEvent('tu-1', questions), errorResult('tu-1')]),
      makeTurn([askEvent('tu-2', questions)]),
    ]

    const ids = computeDuplicateAskUserIds(turns)

    expect(ids.has('tu-1')).toBe(true)
    expect(ids.has('tu-2')).toBe(false)
  })

  it('does not hide successfully answered questions', () => {
    const turns = [
      makeTurn([askEvent('tu-1', questions), successResult('tu-1')]),
      makeTurn([askEvent('tu-2', questions)]),
    ]

    const ids = computeDuplicateAskUserIds(turns)

    expect(ids.has('tu-1')).toBe(false)
    expect(ids.has('tu-2')).toBe(false)
  })

  it('hides multiple errored retries, keeps last', () => {
    const turns = [
      makeTurn([askEvent('tu-1', questions), errorResult('tu-1')]),
      makeTurn([askEvent('tu-2', questions), errorResult('tu-2')]),
      makeTurn([askEvent('tu-3', questions)]),
    ]

    const ids = computeDuplicateAskUserIds(turns)

    expect(ids.has('tu-1')).toBe(true)
    expect(ids.has('tu-2')).toBe(true)
    expect(ids.has('tu-3')).toBe(false)
  })

  it('keeps questions with different headers as separate groups', () => {
    const q1 = [{ header: 'Approach', question: 'Which approach?' }]
    const q2 = [{ header: 'Library', question: 'Which library?' }]

    const turns = [
      makeTurn([askEvent('tu-1', q1), errorResult('tu-1')]),
      makeTurn([askEvent('tu-2', q2), errorResult('tu-2')]),
    ]

    const ids = computeDuplicateAskUserIds(turns)

    expect(ids.size).toBe(0)
  })

  it('returns empty set when no AskUserQuestion events exist', () => {
    const turns = [makeTurn([{ subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu-1' }])]

    const ids = computeDuplicateAskUserIds(turns)

    expect(ids.size).toBe(0)
  })

  it('returns empty set for single AskUserQuestion (no dedup needed)', () => {
    const turns = [makeTurn([askEvent('tu-1', questions), errorResult('tu-1')])]

    const ids = computeDuplicateAskUserIds(turns)

    expect(ids.size).toBe(0)
  })

  it('handles empty turns array', () => {
    expect(computeDuplicateAskUserIds([]).size).toBe(0)
  })

  describe('with malformed payloads', () => {
    let warnSpy
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('does not throw on a stringified questions payload', () => {
      const stringified = '[{"header":"Approach","question":"Which?"}]'
      const turns = [makeTurn([askEvent('tu-1', stringified)])]

      expect(() => computeDuplicateAskUserIds(turns)).not.toThrow()
    })

    it('treats stringified questions like an empty fingerprint (groups with other empties)', () => {
      const stringified = '[{"header":"Approach"}]'
      // Two malformed events both fingerprint to '' and are errored - the first becomes a duplicate of the second.
      const turns = [
        makeTurn([askEvent('tu-1', stringified), errorResult('tu-1')]),
        makeTurn([askEvent('tu-2', stringified)]),
      ]

      const ids = computeDuplicateAskUserIds(turns)

      // Both share the empty fingerprint; tu-1 errored, tu-2 follows, so tu-1 is hidden as a duplicate.
      expect(ids.has('tu-1')).toBe(true)
      expect(ids.has('tu-2')).toBe(false)
    })

    it('does not throw when the malformed event has no later sibling', () => {
      const turns = [makeTurn([askEvent('tu-1', { not: 'array' }), errorResult('tu-1')])]

      expect(() => computeDuplicateAskUserIds(turns)).not.toThrow()
      expect(computeDuplicateAskUserIds(turns).size).toBe(0)
    })
  })
})
