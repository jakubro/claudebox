/** Tests for useHideInFocused - which calls offer the Focused hide mark, and what it toggles. */

import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGGRAPH_RUNTIME_NAME } from '../../../../../../../config/schema'
import { FocusedMarksContext } from '../../../FocusedMarksContext'

let mockMarks = null

vi.mock('../../../../../../../context/FocusedHiddenToolsContext', () => ({
  useOptionalFocusedHiddenTools: () => mockMarks,
}))

import useHideInFocused from './useHideInFocused'

function renderFor(toolUse, { runtimeName = 'Claude', canMark = true } = {}) {
  const wrapper = ({ children }) =>
    createElement(
      FocusedMarksContext.Provider,
      { value: { isMarked: () => false, runtimeName, canMark } },
      children,
    )
  return renderHook(() => useHideInFocused(toolUse), { wrapper }).result.current
}

describe('useHideInFocused', () => {
  beforeEach(() => {
    mockMarks = { hiddenTools: new Set(), markTool: vi.fn(), unmarkTools: vi.fn() }
  })

  it.each([
    ['a Claude MCP tool', { content: 'mcp__jina__read_url' }, 'Claude'],
    ["claudebox's spawn tool", { content: 'mcp__claudebox__session_spawn' }, 'Claude'],
    [
      "a subagent's MCP call",
      { content: 'mcp__jina__read_url', parent_tool_use_id: 't' },
      'Claude',
    ],
    ['a LangGraph server tool', { content: 'read_url' }, LANGGRAPH_RUNTIME_NAME],
  ])('offers the mark on %s', (_label, toolUse, runtimeName) => {
    expect(renderFor(toolUse, { runtimeName })).toEqual({
      active: false,
      onToggle: expect.any(Function),
    })
  })

  it.each([
    ['a built-in tool', { content: 'Bash' }],
    ['a read-only MCP call', { content: 'mcp__notes__read', mcp_read_only: true }],
    ['session_read', { content: 'mcp__claudebox__session_read' }],
    ['needs_user', { content: 'mcp__claudebox__needs_user' }],
    ['a resource listing', { content: 'ListMcpResourcesTool' }],
  ])('offers none on %s', (_label, toolUse) => {
    expect(renderFor(toolUse)).toBeNull()
  })

  it('offers none on a phone or outside the marks provider', () => {
    expect(renderFor({ content: 'mcp__jina__read_url' }, { canMark: false })).toBeNull()
    mockMarks = null
    expect(renderFor({ content: 'mcp__jina__read_url' })).toBeNull()
  })

  it('a tool marked from the other runtime shows pressed and unmarks that mark; a new mark stores the normalised name', () => {
    mockMarks.hiddenTools = new Set(['mcp__jina__read_url'])
    const control = renderFor({ content: 'read_url' }, { runtimeName: LANGGRAPH_RUNTIME_NAME })
    expect(control.active).toBe(true)

    control.onToggle()
    expect(mockMarks.unmarkTools).toHaveBeenCalledWith(['mcp__jina__read_url'])

    renderFor({ content: 'session_ask' }, { runtimeName: LANGGRAPH_RUNTIME_NAME }).onToggle()
    expect(mockMarks.markTool).toHaveBeenCalledWith('mcp__claudebox__session_ask')
  })
})
