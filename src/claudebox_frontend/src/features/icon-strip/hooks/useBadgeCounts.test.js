/** Tests for useBadgeCounts hook. */

import { act, renderHook } from '@testing-library/react'
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

/** Default mock for useEvents - overrides merge over a sane empty baseline. */
const eventsMock = (overrides = {}) => ({
  events: [],
  todosBySubagent: new Map(),
  taskNotifications: new Map(),
  ...overrides,
})

vi.mock('../../../context/EventsContext', () => ({
  useEvents: vi.fn(),
}))
vi.mock('../../../context/StashContext', () => ({
  useStash: vi.fn(),
}))
vi.mock('../../../context/LogsStreamContext', () => ({
  useLogsStream: vi.fn(),
}))

// Mocked so the hook doesn't need real event shapes; extractTasks/getMcpServers have their own unit tests.
vi.mock('../../../utils/eventProcessing', () => ({
  extractTasks: vi.fn(() => []),
  extractCrons: vi.fn(() => []),
  getMcpServers: vi.fn(() => []),
}))

import { useEvents } from '../../../context/EventsContext'
import { useLogsStream } from '../../../context/LogsStreamContext'
import { useStash } from '../../../context/StashContext'
import { extractCrons, extractTasks, getMcpServers } from '../../../utils/eventProcessing'
import useBadgeCounts from './useBadgeCounts'

function renderBadgeCounts(eventsOverrides = {}, stash = []) {
  useEvents.mockReturnValue(eventsMock(eventsOverrides))
  useStash.mockReturnValue({ stash })

  return renderHook(() => useBadgeCounts()).result
}

describe('useBadgeCounts', () => {
  beforeEach(() => {
    useLogsStream.mockReturnValue({ hasUnreadErrors: false })
    extractTasks.mockReturnValue([])
    extractCrons.mockReturnValue([])
    getMcpServers.mockReturnValue([])
  })

  it('counts active schedules', () => {
    extractCrons.mockReturnValue([{ id: 'a' }, { id: 'b' }])

    const result = renderBadgeCounts()

    expect(result.current.cronCount).toBe(2)
  })

  it('recounts schedules on its own clock, since a firing produces no event', () => {
    vi.useFakeTimers()
    renderBadgeCounts()
    const before = extractCrons.mock.calls.length

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(extractCrons.mock.calls.length).toBeGreaterThan(before)
    vi.useRealTimers()
  })

  it('returns zero counts when empty', () => {
    const result = renderBadgeCounts()

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
    const result = renderBadgeCounts({ todosBySubagent: new Map([['main', todos]]) })

    expect(result.current.todoCount).toBe(2)
  })

  it('counts stash items', () => {
    const stashItems = [
      createStashItem('item 1'),
      createStashItem('item 2'),
      createStashItem('item 3'),
    ]
    const result = renderBadgeCounts({}, stashItems)

    expect(result.current.stashCount).toBe(3)
  })

  it('returns both counts together', () => {
    const todos = [createTodo({ status: 'pending' }), createTodo({ status: 'completed' })]
    const stashItems = [createStashItem('item 1'), createStashItem('item 2')]
    const result = renderBadgeCounts({ todosBySubagent: new Map([['main', todos]]) }, stashItems)

    expect(result.current.todoCount).toBe(1)
    expect(result.current.stashCount).toBe(2)
  })

  it('excludes completed todos from count', () => {
    const todos = [
      createTodo({ status: 'completed' }),
      createTodo({ status: 'completed' }),
      createTodo({ status: 'completed' }),
    ]
    const result = renderBadgeCounts({ todosBySubagent: new Map([['main', todos]]) })

    expect(result.current.todoCount).toBe(0)
  })

  it('sums incomplete todos across all subagents', () => {
    const mainTodos = [createTodo({ status: 'pending' }), createTodo({ status: 'completed' })]
    const subTodos = [createTodo({ status: 'in_progress' }), createTodo({ status: 'pending' })]
    const result = renderBadgeCounts({
      todosBySubagent: new Map([
        ['main', mainTodos],
        ['task_abc', subTodos],
      ]),
    })

    expect(result.current.todoCount).toBe(3) // 1 main + 2 sub
  })

  it('returns logsHasErrors from logs stream context', () => {
    useLogsStream.mockReturnValue({ hasUnreadErrors: true })

    const result = renderBadgeCounts()

    expect(result.current.logsHasErrors).toBe(true)
  })

  it('counts only running tasks', () => {
    extractTasks.mockReturnValue([
      { id: 't1', status: 'running' },
      { id: 't2', status: 'running' },
      { id: 't3', status: 'completed' },
      { id: 't4', status: 'failed' },
    ])
    const result = renderBadgeCounts()

    expect(result.current.taskCount).toBe(2)
  })

  it('hands background launches to the task count, so running commands count', () => {
    const launches = new Map([['b1', { id: 'b1', name: 'Wait', toolUseId: 'tu1', index: 1 }]])
    renderBadgeCounts({ backgroundLaunches: launches })

    expect(extractTasks).toHaveBeenCalledWith([], expect.any(Map), launches)
  })

  it('counts only failed MCP servers', () => {
    getMcpServers.mockReturnValue([
      { name: 'a', status: 'connected' },
      { name: 'b', status: 'disconnected' },
      { name: 'c', status: 'failed' },
      { name: 'd', status: 'failed' },
      { name: 'e', status: 'disabled' },
    ])
    const result = renderBadgeCounts()

    // Only `failed` counts toward the danger badge - `disconnected`/`disabled` don't need user action.
    expect(result.current.mcpFailedCount).toBe(2)
  })
})
