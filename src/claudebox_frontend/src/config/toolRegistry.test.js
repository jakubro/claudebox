/** toolRegistry.js tests - per-tool config lookup and the read-only category axis. */

import { describe, expect, it } from 'vitest'
import { ToolName } from './schema'
import { getToolConfig, isReadOnlyCall, isReadOnlyCommand, TOOL_REGISTRY } from './toolRegistry'

const READ_ONLY_TOOLS = [
  ToolName.READ,
  ToolName.GREP,
  ToolName.GLOB,
  ToolName.TASK_LIST,
  ToolName.TASK_GET,
  ToolName.WEB_FETCH,
  ToolName.WEB_SEARCH,
  ToolName.MCP_SEARCH,
  ToolName.TASK_OUTPUT,
]

describe('getToolConfig category', () => {
  it('classifies every read-only tool as read-only', () => {
    for (const name of READ_ONLY_TOOLS) {
      expect(getToolConfig(name).category).toBe('read-only')
    }
  })

  it('classifies every other registered tool as default', () => {
    const nonReadOnly = Object.keys(TOOL_REGISTRY).filter(name => !READ_ONLY_TOOLS.includes(name))
    expect(nonReadOnly.length).toBeGreaterThan(0)
    for (const name of nonReadOnly) {
      expect(getToolConfig(name).category).toBe('default')
    }
  })

  it('classifies an unknown tool as default, not read-only', () => {
    expect(getToolConfig('NoSuchTool').category).toBe('default')
  })

  it('classifies snake_case aliases the same as their PascalCase equivalents', () => {
    expect(getToolConfig('read_file').category).toBe('read-only')
    expect(getToolConfig('task_list').category).toBe('read-only')
    expect(getToolConfig('bash').category).toBe('default')
  })
})

describe('isReadOnlyCall', () => {
  it('holds for a tool whose category is read-only', () => {
    expect(isReadOnlyCall({ content: 'Read' })).toBe(true)
    expect(isReadOnlyCall({ content: 'read_file' })).toBe(true)
  })

  it('holds for a Bash call marked command_read_only, in either runtime', () => {
    expect(isReadOnlyCall({ content: 'Bash', command_read_only: true })).toBe(true)
    expect(isReadOnlyCall({ content: 'bash', command_read_only: true })).toBe(true)
  })

  it('holds for a Bash call measured as changing nothing, whatever its command was read as', () => {
    expect(isReadOnlyCall({ content: 'Bash' }, { command_changed: false })).toBe(true)
    expect(isReadOnlyCall({ content: 'bash' }, { command_changed: false })).toBe(true)
  })

  it('does not hold for a Bash call measured as changing something, even one read as read-only', () => {
    const marked = { content: 'Bash', command_read_only: true }
    expect(isReadOnlyCall(marked, { command_changed: true })).toBe(false)
  })

  it('takes what the command was read as while there is no measurement', () => {
    const marked = { content: 'Bash', command_read_only: true }
    expect(isReadOnlyCall(marked, null)).toBe(true)
    expect(isReadOnlyCall(marked, { command_changed: null })).toBe(true)
    expect(isReadOnlyCall({ content: 'Bash' }, {})).toBe(false)
  })

  it('does not hold for an unmarked Bash call or another tool', () => {
    expect(isReadOnlyCall({ content: 'Bash' })).toBe(false)
    expect(isReadOnlyCall({ content: 'Bash', command_read_only: null })).toBe(false)
    expect(isReadOnlyCall({ content: 'Edit' })).toBe(false)
  })
})

describe('isReadOnlyCommand', () => {
  it('answers for a Bash call only, never for a read-only tool', () => {
    expect(isReadOnlyCommand({ content: 'Read' }, null)).toBe(false)
    expect(isReadOnlyCommand({ content: 'Bash' }, { command_changed: false })).toBe(true)
  })
})
