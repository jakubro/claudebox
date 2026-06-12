/** schema.js tests - tool-name normalisation between Claude PascalCase and LangGraph snake_case. */

import { describe, expect, it } from 'vitest'
import { normalizeToolName, TOOL_NAME_ALIASES, ToolName } from './schema'

describe('normalizeToolName', () => {
  it('maps LangGraph snake_case task names to Claude canonical names', () => {
    expect(normalizeToolName('task_create')).toBe(ToolName.TASK_CREATE)
    expect(normalizeToolName('task_update')).toBe(ToolName.TASK_UPDATE)
    expect(normalizeToolName('task_get')).toBe(ToolName.TASK_GET)
    expect(normalizeToolName('task_list')).toBe(ToolName.TASK_LIST)
    expect(normalizeToolName('task_output')).toBe(ToolName.TASK_OUTPUT)
  })

  it('maps LangGraph simple-port names to Claude canonical names', () => {
    expect(normalizeToolName('read_file')).toBe(ToolName.READ)
    expect(normalizeToolName('write_file')).toBe(ToolName.WRITE)
    expect(normalizeToolName('edit_file')).toBe(ToolName.EDIT)
    expect(normalizeToolName('bash')).toBe(ToolName.BASH)
    expect(normalizeToolName('web_search')).toBe(ToolName.WEB_SEARCH)
  })

  it('maps the LangGraph sub-agent task tool to Claude Task', () => {
    expect(normalizeToolName('task')).toBe(ToolName.TASK)
  })

  it('returns Claude canonical names unchanged', () => {
    expect(normalizeToolName('TaskCreate')).toBe('TaskCreate')
    expect(normalizeToolName('Read')).toBe('Read')
    expect(normalizeToolName('Bash')).toBe('Bash')
  })

  it('returns unknown names unchanged', () => {
    expect(normalizeToolName('NoSuchTool')).toBe('NoSuchTool')
    expect(normalizeToolName('')).toBe('')
  })

  it('handles null / undefined gracefully via ?? fallback', () => {
    expect(normalizeToolName(undefined)).toBe(undefined)
    expect(normalizeToolName(null)).toBe(null)
  })

  it('TOOL_NAME_ALIASES is frozen', () => {
    expect(Object.isFrozen(TOOL_NAME_ALIASES)).toBe(true)
  })
})
