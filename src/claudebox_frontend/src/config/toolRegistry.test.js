/** toolRegistry.js tests - per-tool config lookup and the read-only category axis. */

import { describe, expect, it } from 'vitest'
import { ToolName } from './schema'
import { getToolConfig, TOOL_REGISTRY } from './toolRegistry'

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
