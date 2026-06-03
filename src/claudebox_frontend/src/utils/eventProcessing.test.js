/** Tests for eventProcessing helper functions. */

import { describe, expect, it } from 'vitest'
import {
  appendSubagentLabels,
  appendTaskNotifications,
  appendTodoDiffs,
  appendTurnResults,
  appendTurns,
  computeDuplicateAskUserIds,
  computeTimingOffsets,
  extractTasks,
  extractThinkingFromText,
  getAskUserFingerprint,
  INITIAL_TURN_GROUPING_STATE,
  indexEvents,
  isInterruptAck,
  isVisibleEvent,
  processEvents,
  processNestedEvents,
} from './eventProcessing'

describe('computeTimingOffsets', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime()

  it('returns null for all when turnStartTime is null', () => {
    const result = computeTimingOffsets(['2026-01-01T00:00:05Z', '2026-01-01T00:00:10Z'], null)
    expect(result).toEqual([null, null])
  })

  it('shows offset only when delta >= 30s from last shown', () => {
    const timestamps = [
      '2026-01-01T00:00:05Z', // +5s → skip (5 < 30)
      '2026-01-01T00:00:20Z', // +20s → skip (20 < 30)
      '2026-01-01T00:00:35Z', // +35s → show (35 >= 30)
      '2026-01-01T00:00:40Z', // +40s → skip (40-35=5 < 30)
      '2026-01-01T00:01:10Z', // +70s → show (70-35=35 >= 30)
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
  })

  describe('skillContent indexing', () => {
    it('associates user text after Skill tool_use', () => {
      const events = [
        {
          subtype: 'tool_use',
          content: 'Skill',
          tool_use_id: 'skill_1',
        },
        { type: 'user', subtype: 'text', is_human: false, content: '# Skill markdown' },
      ]

      const { skillContent } = indexEvents(events)

      expect(skillContent.get('skill_1')).toBe('# Skill markdown')
    })

    it('ignores user text from human', () => {
      const events = [
        {
          subtype: 'tool_use',
          content: 'Skill',
          tool_use_id: 'skill_1',
        },
        { type: 'user', subtype: 'text', is_human: true, content: 'Human input' },
      ]

      const { skillContent } = indexEvents(events)

      expect(skillContent.has('skill_1')).toBe(false)
    })

    it('clears tracking after non-tool_result event', () => {
      const events = [
        {
          subtype: 'tool_use',
          content: 'Skill',
          tool_use_id: 'skill_1',
        },
        { subtype: 'text', content: 'Some text' }, // clears tracking
        { type: 'user', subtype: 'text', is_human: false, content: 'Should not attach' },
      ]

      const { skillContent } = indexEvents(events)

      expect(skillContent.has('skill_1')).toBe(false)
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
    expect(processEvents([])).toEqual([])
  })

  it('creates text block for text event', () => {
    const events = [{ subtype: 'text', content: 'Hello world' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].event.content).toBe('Hello world')
  })

  it('creates thinking block for thinking event', () => {
    const events = [{ subtype: 'thinking', content: 'Let me think...' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('thinking')
  })

  it('skips thinking event with empty content', () => {
    const events = [{ subtype: 'thinking', content: '' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(0)
  })

  it('skips thinking event with whitespace-only content', () => {
    const events = [{ subtype: 'thinking', content: '   \n  ' }]

    const blocks = processEvents(events)

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

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool')
    expect(blocks[0].toolUse.content).toBe('Bash')
    expect(blocks[0].toolResult.content).toBe('output')
  })

  it('creates tool block with undefined result when result missing', () => {
    const events = [{ subtype: 'tool_use', content: 'Bash', tool_use_id: 'tu_1' }]

    const blocks = processEvents(events)

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

    const blocks = processEvents(events)

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
      { type: 'user', subtype: 'text', is_human: false, content: '# Skill instructions' },
    ]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].skillContent).toBe('# Skill instructions')
  })

  it('attaches skill markdown when a tool_result intervenes between Skill tool_use and skill content', () => {
    // Live SDK sequence: Skill tool_use → user/tool_result echo → user/text body
    // (the actual markdown). The intervening tool_result must NOT clear the
    // skill-tracking state, otherwise the markdown leaks as a standalone bubble
    // inside the assistant turn.
    const events = [
      { subtype: 'tool_use', content: 'Skill', tool_use_id: 'skill_1' },
      {
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: 'skill_1',
        content: 'Launching skill: multi-agent',
        is_human: false,
      },
      { type: 'user', subtype: 'text', is_human: false, content: '# Skill markdown body' },
    ]

    const blocks = processEvents(events)

    // Only the Skill tool block — the user/text body must be folded inside
    // its skillContent, not produce a separate text block.
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool')
    expect(blocks[0].toolUse.content).toBe('Skill')
    expect(blocks[0].skillContent).toBe('# Skill markdown body')
  })

  it('folds skill markdown across the full live turn slice (assistant text → tool_use → tool_result → user/text body → assistant text)', () => {
    // Mirrors the exact event ordering observed in the leak repro session:
    // ~/.claudebox/sessions/20260506-140144--de83121b/events.jsonl L636-L640.
    // The key invariants:
    //   1. The leading assistant/text resets the skill tracker — but L637's
    //      tool_use sets it again immediately.
    //   2. The intervening user/tool_result must NOT reset the tracker.
    //   3. The trailing assistant/text after the user/text body is unaffected
    //      because skill suppression already paired the tracker by then.
    // If any of these break, the user/text body leaks as a standalone bubble.
    const skillBody =
      'Base directory for this skill: /root/.claude/skills/multi-agent\n\n<interpretation>...</interpretation>'
    const events = [
      { type: 'assistant', subtype: 'text', is_human: false, content: 'Invoke /multi-agent…' },
      { type: 'assistant', subtype: 'tool_use', content: 'Skill', tool_use_id: 'skill_live' },
      {
        type: 'user',
        subtype: 'tool_result',
        is_human: false,
        tool_use_id: 'skill_live',
        content: 'Launching skill: multi-agent',
      },
      { type: 'user', subtype: 'text', is_human: false, content: skillBody },
      {
        type: 'assistant',
        subtype: 'text',
        is_human: false,
        content: 'Validated: 6 parameters present.',
      },
    ]

    const blocks = processEvents(events)

    // Three blocks: leading assistant text, Skill tool block (skill body folded
    // inside), trailing assistant text. NO standalone text block for the body.
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].event.content).toBe('Invoke /multi-agent…')
    expect(blocks[1].type).toBe('tool')
    expect(blocks[1].toolUse.content).toBe('Skill')
    expect(blocks[1].skillContent).toBe(skillBody)
    expect(blocks[2].type).toBe('text')
    expect(blocks[2].event.content).toBe('Validated: 6 parameters present.')
    // Defensive: there must NOT be a text block whose content is the skill body.
    const leakedTextBlocks = blocks.filter(b => b.type === 'text' && b.event.content === skillBody)
    expect(leakedTextBlocks).toHaveLength(0)
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

    const blocks = processEvents(events)

    // Only Task block, nested text is inside nestedEvents, not a separate block
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool')
  })

  it('creates compaction block for compact_start when no boundary', () => {
    const events = [{ subtype: 'compact_start' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('compaction')
    expect(blocks[0].isCompacting).toBe(true)
  })

  it('creates compaction block with summary for compact_boundary', () => {
    const events = [
      { id: 'cb_1', subtype: 'compact_boundary' },
      { type: 'user', subtype: 'text', is_human: false, content: 'Summary of compacted content' },
    ]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('compaction')
    expect(blocks[0].isCompacting).toBe(false)
    expect(blocks[0].summary).toEqual(['Summary of compacted content'])
  })

  it('hides compact_start when compact_boundary exists', () => {
    const events = [{ subtype: 'compact_start' }, { subtype: 'compact_boundary' }]

    const blocks = processEvents(events)

    // Only boundary block, start is hidden
    expect(blocks).toHaveLength(1)
    expect(blocks[0].isCompacting).toBe(false)
  })

  it('skips empty text events', () => {
    const events = [{ subtype: 'text', content: '   ' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(0)
  })

  it('filters "(No content)" placeholder from assistant text', () => {
    const events = [{ type: 'assistant', subtype: 'text', content: '(No content)' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(0)
  })

  it('filters "(no content)" case-insensitively', () => {
    const events = [{ type: 'assistant', subtype: 'text', content: '  (NO CONTENT)  ' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(0)
  })

  it('does not filter "(No content)" from user text', () => {
    const events = [{ type: 'user', subtype: 'text', content: '(No content)', is_human: true }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('does not filter "(No content)" as substring in larger text', () => {
    const events = [
      { type: 'assistant', subtype: 'text', content: 'The response was (No content) initially' },
    ]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('does not create blocks for model_changed events (handled via turn.settingChanges)', () => {
    const events = [{ type: 'system', subtype: 'model_changed', model: 'claude-opus-4-6' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(0)
  })

  it('does not create blocks for permission_mode_changed events (handled via turn.settingChanges)', () => {
    const events = [{ type: 'system', subtype: 'permission_mode_changed', permission_mode: 'plan' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(0)
  })

  it('does not suppress non-human user text', () => {
    const events = [{ type: 'user', subtype: 'text', is_human: false, content: 'some user text' }]

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
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

describe('processEvents — embedded thinking extraction', () => {
  it('extracts <thinking> from assistant text into thinking block + text block', () => {
    const events = [
      {
        type: 'assistant',
        subtype: 'text',
        content: '<thinking>Let me analyze this</thinking>\n\nHere is my answer.',
        ts: '2026-01-01T00:00:05Z',
      },
    ]

    const blocks = processEvents(events)

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

    const blocks = processEvents(events)

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

    const blocks = processEvents(events)

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

    const blocks = processEvents(events)

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

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('passes through assistant text without <thinking> unchanged', () => {
    const events = [{ type: 'assistant', subtype: 'text', content: 'Normal response text' }]

    const blocks = processEvents(events)

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

describe('processEvents — interrupt blocks', () => {
  it('suppresses interrupt acknowledgment event entirely', () => {
    const events = [
      {
        type: 'user',
        is_human: false,
        subtype: 'text',
        content: '[interrupt requested]',
      },
    ]

    const blocks = processEvents(events)

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

    const blocks = processEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })
})

describe('processEvents — model-set echo filtering', () => {
  it('filters model-set stdout echo from non-human user text', () => {
    const events = [
      {
        type: 'user',
        is_human: false,
        subtype: 'text',
        content: '<local-command-stdout>Set model to claude-opus-4-6</local-command-stdout>',
      },
    ]

    const blocks = processEvents(events)

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

    const blocks = processEvents(events)

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

  it('passes through system model_changed events', () => {
    expect(
      isVisibleEvent({ type: 'system', subtype: 'model_changed', model: 'claude-opus-4-6' }),
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

  it('appends assistant events to current turn', () => {
    // Batch 1: user message
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
    ])

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
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
    ])

    const { turns: t2 } = appendTurns(t1, s1, [
      {
        type: 'system',
        subtype: 'model_changed',
        model: 'claude-opus-4-6',
        previous_model: 'claude-sonnet-4-5-20250929',
      },
    ])

    expect(t2).toHaveLength(1)
    expect(t2[0].events).toHaveLength(0)
    expect(t2[0].settingChanges).toHaveLength(1)
    expect(t2[0].settingChanges[0].subtype).toBe('model_changed')
  })

  it('stores permission_mode_changed in settingChanges (not events)', () => {
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
    ])

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
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
    ])

    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'system', subtype: 'permission_mode_changed', permission_mode: 'bypassPermissions' },
    ])

    expect(t2[0].settingChanges).toHaveLength(0)
  })

  it('skips init model_changed without previous value', () => {
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
    ])

    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'system', subtype: 'model_changed', model: 'claude-opus-4-6' },
    ])

    expect(t2[0].settingChanges).toHaveLength(0)
  })

  it('stores container_restarted in settingChanges (renders unconditionally)', () => {
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
    ])

    const { turns: t2 } = appendTurns(t1, s1, [
      { type: 'system', subtype: 'container_restarted', message_data: null },
    ])

    expect(t2[0].settingChanges).toHaveLength(1)
    expect(t2[0].settingChanges[0].subtype).toBe('container_restarted')
  })

  it('stores container_restarted with fork payload in settingChanges', () => {
    const { turns: t1, state: s1 } = appendTurns([], INITIAL_TURN_GROUPING_STATE, [
      { type: 'user', is_human: true, turn_id: 'turn-1', content: 'Hello' },
    ])

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
    // Simulates the real SDK event sequence for auto-compaction:
    // previous turn ends, compact_start fires before user message echo
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
      { type: 'system', subtype: 'model_changed', model: 'claude-opus-4-6' },
    ])

    expect(turns).toHaveLength(0)
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
    })
  })

  it('processes XML notification tags from non-human user text', () => {
    const existing = new Map()
    const events = [
      {
        type: 'user',
        subtype: 'text',
        is_human: false,
        content:
          '<task-notification task_id="abc123" status="completed">Agent finished</task-notification>',
      },
    ]

    const result = appendTaskNotifications(existing, events)

    expect(result.size).toBe(1)
    expect(result.get('abc123')).toEqual({
      status: 'completed',
      summary: 'Agent finished',
      content: 'Agent finished',
    })
  })

  it('processes agent-notification XML tags', () => {
    const existing = new Map()
    const events = [
      {
        type: 'user',
        subtype: 'text',
        is_human: false,
        content:
          '<agent-notification task_id="xyz789" status="failed">Agent crashed</agent-notification>',
      },
    ]

    const result = appendTaskNotifications(existing, events)

    expect(result.size).toBe(1)
    expect(result.get('xyz789')).toEqual({
      status: 'failed',
      summary: 'Agent crashed',
      content: 'Agent crashed',
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

    // Subagent B writes different todos — should NOT diff against A's list
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

    // Task completes — tool_result for task_a
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
    expect(p2).toBe(p1) // same reference — no mutation
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
    // Batch 1: async launch — tool_result with isAsync before any TodoWrite
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

  it('removes async subagent todos on XML user message notification', () => {
    // Setup: async launch + subagent writes todos
    const { previousTodosBySubagent: p1, asyncTaskIdMap: a1 } = appendTodoDiffs(
      new Map(),
      new Map(),
      new Map(),
      [
        {
          subtype: 'tool_result',
          tool_use_id: 'task_b',
          content: 'Async agent launched',
          tool_use_result: { isAsync: true, agentId: 'agent_abc' },
        },
        {
          subtype: 'tool_use',
          content: 'TodoWrite',
          tool_use_id: 'tu_sub',
          parent_tool_use_id: 'task_b',
          tool_input: { todos: [{ content: 'Work item', status: 'in_progress' }] },
        },
      ],
    )

    expect(p1.has('task_b')).toBe(true)

    // Completion via XML in user message
    const { previousTodosBySubagent: p2 } = appendTodoDiffs(new Map(), p1, a1, [
      {
        type: 'user',
        is_human: false,
        subtype: 'text',
        content:
          '<task-notification task_id="agent_abc" status="completed">Done</task-notification>',
      },
    ])

    expect(p2.has('task_b')).toBe(false)
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
})
