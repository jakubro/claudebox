/** Tests for useBadgeCounts hook. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createTodo = (overrides = {}) => ({
  content: 'Do something',
  status: 'pending',
  activeForm: 'Doing something',
  ...overrides,
})

const createStashItem = text => ({
  text,
  timestamp: Date.now(),
})

/** Default mock for useEvents — overrides merge over a sane empty baseline. */
const eventsMock = (overrides = {}) => ({
  events: [],
  todosBySubagent: new Map(),
  taskNotifications: new Map(),
  ...overrides,
})

// Mock the context hooks
vi.mock('../../../context/EventsContext', () => ({
  useEvents: vi.fn(),
}))
vi.mock('../../../context/StashContext', () => ({
  useStash: vi.fn(),
}))
vi.mock('../../../context/LogsStreamContext', () => ({
  useLogsStream: vi.fn(),
}))

// Mock event-processing helpers so the hook can be unit-tested without
// reproducing event-shape conventions in every test case. extractTasks and
// getMcpServers are exercised end-to-end via their own unit tests.
vi.mock('../../../utils/eventProcessing', () => ({
  extractTasks: vi.fn(() => []),
  getMcpServers: vi.fn(() => []),
}))

import { useEvents } from '../../../context/EventsContext'
import { useLogsStream } from '../../../context/LogsStreamContext'
import { useStash } from '../../../context/StashContext'
import { extractTasks, getMcpServers } from '../../../utils/eventProcessing'
import useBadgeCounts from './useBadgeCounts'

describe('useBadgeCounts', () => {
  beforeEach(() => {
    useLogsStream.mockReturnValue({ hasUnreadErrors: false })
    extractTasks.mockReturnValue([])
    getMcpServers.mockReturnValue([])
  })

  it('returns zero counts when empty', () => {
    useEvents.mockReturnValue(eventsMock())
    useStash.mockReturnValue({ stash: [] })

    const { result } = renderHook(() => useBadgeCounts())

    expect(result.current.todoCount).toBe(0)
    expect(result.current.stashCount).toBe(0)
    expect(result.current.taskCount).toBe(0)
    expect(result.current.mcpFailedCount).toBe(0)
  })

  it('counts non-completed todos from main agent', () => {
    const todos = [
      createTodo({ status: 'pending' }),
      createTodo({ status: 'in_progress' }),
      createTodo({ status: 'completed' }),
    ]
    useEvents.mockReturnValue(eventsMock({ todosBySubagent: new Map([['main', todos]]) }))
    useStash.mockReturnValue({ stash: [] })

    const { result } = renderHook(() => useBadgeCounts())

    expect(result.current.todoCount).toBe(2)
  })

  it('counts stash items', () => {
    const stashItems = [
      createStashItem('item 1'),
      createStashItem('item 2'),
      createStashItem('item 3'),
    ]
    useEvents.mockReturnValue(eventsMock())
    useStash.mockReturnValue({ stash: stashItems })

    const { result } = renderHook(() => useBadgeCounts())

    expect(result.current.stashCount).toBe(3)
  })

  it('returns both counts together', () => {
    const todos = [createTodo({ status: 'pending' }), createTodo({ status: 'completed' })]
    const stashItems = [createStashItem('item 1'), createStashItem('item 2')]
    useEvents.mockReturnValue(eventsMock({ todosBySubagent: new Map([['main', todos]]) }))
    useStash.mockReturnValue({ stash: stashItems })

    const { result } = renderHook(() => useBadgeCounts())

    expect(result.current.todoCount).toBe(1)
    expect(result.current.stashCount).toBe(2)
  })

  it('excludes completed todos from count', () => {
    const todos = [
      createTodo({ status: 'completed' }),
      createTodo({ status: 'completed' }),
      createTodo({ status: 'completed' }),
    ]
    useEvents.mockReturnValue(eventsMock({ todosBySubagent: new Map([['main', todos]]) }))
    useStash.mockReturnValue({ stash: [] })

    const { result } = renderHook(() => useBadgeCounts())

    expect(result.current.todoCount).toBe(0)
  })

  it('sums incomplete todos across all subagents', () => {
    const mainTodos = [createTodo({ status: 'pending' }), createTodo({ status: 'completed' })]
    const subTodos = [createTodo({ status: 'in_progress' }), createTodo({ status: 'pending' })]
    useEvents.mockReturnValue(
      eventsMock({
        todosBySubagent: new Map([
          ['main', mainTodos],
          ['task_abc', subTodos],
        ]),
      }),
    )
    useStash.mockReturnValue({ stash: [] })

    const { result } = renderHook(() => useBadgeCounts())

    expect(result.current.todoCount).toBe(3) // 1 main + 2 sub
  })

  it('returns logsHasErrors from logs stream context', () => {
    useEvents.mockReturnValue(eventsMock())
    useStash.mockReturnValue({ stash: [] })
    useLogsStream.mockReturnValue({ hasUnreadErrors: true })

    const { result } = renderHook(() => useBadgeCounts())

    expect(result.current.logsHasErrors).toBe(true)
  })

  it('counts only running tasks', () => {
    extractTasks.mockReturnValue([
      { id: 't1', status: 'running' },
      { id: 't2', status: 'running' },
      { id: 't3', status: 'completed' },
      { id: 't4', status: 'failed' },
    ])
    useEvents.mockReturnValue(eventsMock())
    useStash.mockReturnValue({ stash: [] })

    const { result } = renderHook(() => useBadgeCounts())

    expect(result.current.taskCount).toBe(2)
  })

  it('counts only failed MCP servers', () => {
    getMcpServers.mockReturnValue([
      { name: 'a', status: 'connected' },
      { name: 'b', status: 'disconnected' },
      { name: 'c', status: 'failed' },
      { name: 'd', status: 'failed' },
      { name: 'e', status: 'disabled' },
    ])
    useEvents.mockReturnValue(eventsMock())
    useStash.mockReturnValue({ stash: [] })

    const { result } = renderHook(() => useBadgeCounts())

    // Only `failed` counts — `disconnected` and `disabled` are not "failed
    // to connect" in the strict sense; the danger badge represents a
    // server that the user must take action on.
    expect(result.current.mcpFailedCount).toBe(2)
  })
})
