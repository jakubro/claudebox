/** Tests for the terminal column's session-wide Bash call/result deriver. */

import { describe, expect, it } from 'vitest'
import { deriveTerminalEntries } from './terminalEvents'

/** A Bash (or LangGraph `bash`) tool_use event. */
function bashCall(id, { parentId = null, description, command = 'ls' } = {}) {
  return {
    subtype: 'tool_use',
    content: 'Bash',
    tool_use_id: id,
    parent_tool_use_id: parentId,
    tool_input: { command, description },
  }
}

function toolResult(id, content = 'ok') {
  return { subtype: 'tool_result', tool_use_id: id, content }
}

describe('deriveTerminalEntries', () => {
  it('returns entries in arrival order across turns', () => {
    // tool_use carries no turn_id, so each turn needs a human opener for entries to inherit it.
    const entries = deriveTerminalEntries([
      { subtype: 'text', type: 'user', is_human: true, content: 'first', turn_id: 't-1' },
      bashCall('b-1'),
      toolResult('b-1'),
      { subtype: 'text', type: 'user', is_human: true, content: 'next', turn_id: 't-2' },
      bashCall('b-2'),
      toolResult('b-2'),
    ])

    expect(entries.map(e => e.id)).toEqual(['b-1', 'b-2'])
    expect(entries.map(e => e.turnId)).toEqual(['t-1', 't-2'])
  })

  it('pairs a call with its result', () => {
    const entries = deriveTerminalEntries([bashCall('b-1'), toolResult('b-1', 'a.txt\nb.txt')])

    expect(entries).toHaveLength(1)
    expect(entries[0].result).toEqual(toolResult('b-1', 'a.txt\nb.txt'))
  })

  it('leaves result null for a call with no result yet', () => {
    const entries = deriveTerminalEntries([bashCall('b-1')])

    expect(entries).toHaveLength(1)
    expect(entries[0].result).toBeNull()
  })

  it('excludes a nested (subagent) Bash call', () => {
    const entries = deriveTerminalEntries([
      bashCall('b-1', { parentId: 'task-1' }),
      toolResult('b-1'),
    ])

    expect(entries).toEqual([])
  })

  it('excludes a non-Bash tool call', () => {
    const entries = deriveTerminalEntries([
      { subtype: 'tool_use', content: 'Read', tool_use_id: 'r-1', tool_input: {} },
    ])

    expect(entries).toEqual([])
  })

  it('includes a LangGraph snake_case bash call the same as Bash', () => {
    const entries = deriveTerminalEntries([
      { ...bashCall('b-1'), content: 'bash' },
      toolResult('b-1'),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('b-1')
  })

  it('carries the command and description from tool_input', () => {
    const entries = deriveTerminalEntries([
      bashCall('b-1', { command: 'npm test', description: 'Run the suite' }),
    ])

    expect(entries[0].command).toBe('npm test')
    expect(entries[0].description).toBe('Run the suite')
  })

  it('treats an empty-string description (LangGraph) as no description', () => {
    const entries = deriveTerminalEntries([bashCall('b-1', { description: '' })])

    expect(entries[0].description).toBeNull()
  })

  it('defaults command to an empty string when tool_input carries none', () => {
    const entries = deriveTerminalEntries([
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'b-1', tool_input: {} },
    ])

    expect(entries[0].command).toBe('')
  })

  it('defaults turnId to null when the event carries none', () => {
    const entries = deriveTerminalEntries([
      { subtype: 'tool_use', content: 'Bash', tool_use_id: 'b-1', tool_input: { command: 'ls' } },
    ])

    expect(entries[0].turnId).toBeNull()
  })

  it('returns an empty array for no events', () => {
    expect(deriveTerminalEntries([])).toEqual([])
  })
})
