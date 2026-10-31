/** schema.js tests - tool-name normalisation between Claude PascalCase and LangGraph snake_case. */

import { describe, expect, it } from 'vitest'
import {
  isHiddenTool,
  LANGGRAPH_RUNTIME_NAME,
  mcpToolOf,
  normalizeToolName,
  TOOL_NAME_ALIASES,
  ToolName,
} from './schema'

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

  it('maps LangGraph sibling-session names to their mcp__claudebox__ equivalents', () => {
    expect(normalizeToolName('session_spawn')).toBe(ToolName.SESSION_SPAWN)
    expect(normalizeToolName('session_ask')).toBe(ToolName.SESSION_ASK)
    expect(normalizeToolName('session_read')).toBe(ToolName.SESSION_READ)
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

describe('mcpToolOf', () => {
  it.each([
    ['mcp__jina__read_url', 'Claude', { server: 'jina', tool: 'read_url' }],
    ['mcp__claude_ai_Docs__query', 'Claude', { server: 'claude_ai_Docs', tool: 'query' }],
    ['mcp__claudebox__session_spawn', 'Claude', { server: 'claudebox', tool: 'session_spawn' }],
    ['session_spawn', LANGGRAPH_RUNTIME_NAME, { server: 'claudebox', tool: 'session_spawn' }],
    ['read_url', LANGGRAPH_RUNTIME_NAME, { server: null, tool: 'read_url' }],
  ])('%s in a %s session names %j', (name, runtime, expected) => {
    expect(mcpToolOf(name, runtime)).toEqual(expected)
  })

  it.each([
    ['Read', 'Claude'],
    ['read_url', 'Claude'],
    ['read_file', LANGGRAPH_RUNTIME_NAME],
    ['notebook_edit', LANGGRAPH_RUNTIME_NAME],
    ['task_stop', LANGGRAPH_RUNTIME_NAME],
    ['list_mcp_resources', LANGGRAPH_RUNTIME_NAME],
    ['ListMcpResourcesTool', 'Claude'],
    ['mcp__broken', 'Claude'],
    ['', 'Claude'],
  ])("%s in a %s session is the agent's own tool", (name, runtime) => {
    expect(mcpToolOf(name, runtime)).toBeNull()
  })
})

describe('isHiddenTool', () => {
  const marks = (...names) => new Set(names)

  it('matches the same name', () => {
    expect(isHiddenTool('mcp__jina__read_url', 'Claude', marks('mcp__jina__read_url'))).toBe(true)
  })

  it("leaves the same server's other tool and another server's same tool alone", () => {
    const marked = marks('mcp__jina__read_url')
    expect(isHiddenTool('mcp__jina__search_web', 'Claude', marked)).toBe(false)
    expect(isHiddenTool('mcp__other__read_url', 'Claude', marked)).toBe(false)
  })

  it('matches across runtimes where one side names no server', () => {
    expect(isHiddenTool('read_url', LANGGRAPH_RUNTIME_NAME, marks('mcp__jina__read_url'))).toBe(
      true,
    )
    expect(isHiddenTool('mcp__jina__read_url', 'Claude', marks('read_url'))).toBe(true)
  })

  it('matches a LangGraph alias of a claudebox tool marked in a Claude session', () => {
    expect(isHiddenTool('session_ask', LANGGRAPH_RUNTIME_NAME, marks(ToolName.SESSION_ASK))).toBe(
      true,
    )
  })

  it("never matches an agent's own tool", () => {
    expect(isHiddenTool('read_file', LANGGRAPH_RUNTIME_NAME, marks('read_file'))).toBe(false)
    expect(isHiddenTool('Read', 'Claude', marks('Read'))).toBe(false)
  })

  it('matches nothing with no marks', () => {
    expect(isHiddenTool('mcp__jina__read_url', 'Claude', new Set())).toBe(false)
    expect(isHiddenTool('mcp__jina__read_url', 'Claude', null)).toBe(false)
  })
})
