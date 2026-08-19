/** Tests for TasksPanel component. */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TasksPanel from './TasksPanel'

const mockEvents = []
const mockFocusChatTab = vi.fn()
const mockEventsData = { isResuming: false, isReplaying: false }
// Stable ref identity across renders (mirrors the real useRef-backed context), so a click handler
// reading `.current` at call time sees whatever the test set, not a fresh mock each render.
const mockScrollToTurnRef = { current: null }
const mockExpandTurnRef = { current: null }
const mockMarkUserIntentRef = { current: null }
const mockMarkProgrammaticScrollRef = { current: null }

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => ({
    events: mockEvents,
    ...mockEventsData,
  }),
}))

vi.mock('../../context/AppActionsContext', () => ({
  useAppActions: () => ({
    focusChatTab: mockFocusChatTab,
    scrollToTurnRef: mockScrollToTurnRef,
    expandTurnRef: mockExpandTurnRef,
    markUserIntentRef: mockMarkUserIntentRef,
    markProgrammaticScrollRef: mockMarkProgrammaticScrollRef,
  }),
}))

describe('TasksPanel', () => {
  beforeEach(() => {
    mockEvents.length = 0
    mockFocusChatTab.mockClear()
    mockEventsData.isResuming = false
    mockEventsData.isReplaying = false
    mockScrollToTurnRef.current = null
    mockExpandTurnRef.current = null
    mockMarkUserIntentRef.current = null
    mockMarkProgrammaticScrollRef.current = null
  })

  it('renders empty state when no tasks', () => {
    render(<TasksPanel />)

    expect(screen.getByText('No tasks')).toBeInTheDocument()
  })

  it('renders filter buttons in order: Active, All', () => {
    // Need at least one task to show filters
    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: Date.now(),
      tool_use_id: 'task_1',
      tool_input: { description: 'Test' },
    })

    render(<TasksPanel />)

    const buttons = screen.getAllByRole('button').filter(b => /Active|All/.test(b.textContent))
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveTextContent(/Active/)
    expect(buttons[1]).toHaveTextContent(/All/)
  })

  it('renders task entry with description', () => {
    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: Date.now(),
      tool_use_id: 'task_1',
      tool_input: { description: 'Test task' },
    })

    render(<TasksPanel />)

    expect(screen.getByText('Test task')).toBeInTheDocument()
  })

  it('shows completed task with green border when filtered to All', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    mockEvents.push(
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: now,
        tool_use_id: 'task_1',
        tool_input: { description: 'Done task' },
      },
      {
        subtype: 'tool_result',
        timestamp: now + 1000,
        content: 'Success',
        tool_use_id: 'task_1',
      },
    )

    render(<TasksPanel />)

    await user.click(screen.getByRole('button', { name: /All/ }))

    const entry = screen.getByTestId('task-entry')
    expect(entry).toHaveClass('task-completed')
  })

  it('shows failed task with red border in All filter', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    mockEvents.push(
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: now,
        tool_use_id: 'task_1',
        tool_input: { description: 'Failed task' },
      },
      {
        subtype: 'tool_result',
        timestamp: now + 1000,
        content: 'Error: something went wrong',
        tool_use_id: 'task_1',
      },
    )

    render(<TasksPanel />)

    await user.click(screen.getByRole('button', { name: /All/ }))

    const entry = screen.getByTestId('task-entry')
    expect(entry).toHaveClass('task-failed')
  })

  it('filters tasks by status when filter clicked', async () => {
    const user = userEvent.setup()
    const now = Date.now()

    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: now,
      tool_use_id: 'task_1',
      tool_input: { description: 'Running task' },
    })

    mockEvents.push(
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: now,
        tool_use_id: 'task_2',
        tool_input: { description: 'Completed task' },
      },
      {
        subtype: 'tool_result',
        timestamp: now + 1000,
        content: 'Done',
        tool_use_id: 'task_2',
      },
    )

    render(<TasksPanel />)

    // Default filter is Active - only running task visible
    expect(screen.getByText('Running task')).toBeInTheDocument()
    expect(screen.queryByText('Completed task')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /All/ }))

    expect(screen.getByText('Running task')).toBeInTheDocument()
    expect(screen.getByText('Completed task')).toBeInTheDocument()
  })

  it('shows filter counts', () => {
    const now = Date.now()

    mockEvents.push(
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: now,
        tool_use_id: 'task_1',
        tool_input: { description: 'Task 1' },
      },
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: now,
        tool_use_id: 'task_2',
        tool_input: { description: 'Task 2' },
      },
    )

    render(<TasksPanel />)

    expect(screen.getByRole('button', { name: /All.*2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Active.*2/ })).toBeInTheDocument()
  })

  it('calls focusChatTab when task clicked', async () => {
    const user = userEvent.setup()
    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: Date.now(),
      tool_use_id: 'task_1',
      tool_input: { description: 'Clickable task' },
    })

    render(<TasksPanel />)

    await user.click(screen.getByText('Clickable task'))

    expect(mockFocusChatTab).toHaveBeenCalled()
  })

  it('expands the task turn and brackets the scroll when the tool block is already mounted', async () => {
    const user = userEvent.setup()
    // The common fast path: a task in the active turn, never windowed or collapsed.
    mockEvents.push(
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'do it',
        turn_id: 'turn_mounted',
        timestamp: Date.now(),
      },
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now(),
        tool_use_id: 'task_mounted',
        tool_input: { description: 'Mounted task' },
      },
    )
    mockExpandTurnRef.current = vi.fn()
    mockMarkProgrammaticScrollRef.current = vi.fn()

    // Bare stand-ins for what the chat tree renders - isolates TasksPanel's own click handling.
    const chatMessages = document.createElement('div')
    chatMessages.setAttribute('data-testid', 'chat-messages')
    const block = document.createElement('div')
    block.setAttribute('data-tool-use-id', 'task_mounted')
    document.body.append(chatMessages, block)

    render(<TasksPanel />)
    await user.click(screen.getByText('Mounted task'))

    await waitFor(() => expect(mockMarkProgrammaticScrollRef.current).toHaveBeenCalled())
    // Expansion runs on the fast path too - a completed task in an earlier, now-collapsed turn.
    expect(mockExpandTurnRef.current).toHaveBeenCalledWith('turn_mounted')

    document.body.removeChild(chatMessages)
    document.body.removeChild(block)
  })

  it('resolves the turn via scrollToTurnRef when the tool block is windowed out, then expands it', async () => {
    const user = userEvent.setup()
    mockEvents.push(
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'do it',
        turn_id: 'turn_windowed',
        timestamp: Date.now(),
      },
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now(),
        tool_use_id: 'task_windowed',
        tool_input: { description: 'Windowed task' },
      },
    )
    const chatMessages = document.createElement('div')
    chatMessages.setAttribute('data-testid', 'chat-messages')
    document.body.appendChild(chatMessages)
    const block = document.createElement('div')
    block.setAttribute('data-tool-use-id', 'task_windowed')
    mockExpandTurnRef.current = vi.fn()
    mockMarkProgrammaticScrollRef.current = vi.fn()
    mockScrollToTurnRef.current = vi.fn((_turnId, onResolved) => {
      // Simulates ChatPanel mounting the turn on request, then handing back its element.
      document.body.appendChild(block)
      onResolved(block)
    })

    render(<TasksPanel />)
    await user.click(screen.getByText('Windowed task'))

    await waitFor(() =>
      expect(mockScrollToTurnRef.current).toHaveBeenCalledWith(
        'turn_windowed',
        expect.any(Function),
      ),
    )
    await waitFor(() => expect(mockExpandTurnRef.current).toHaveBeenCalledWith('turn_windowed'))
    expect(mockMarkProgrammaticScrollRef.current).toHaveBeenCalled()

    document.body.removeChild(chatMessages)
    document.body.removeChild(block)
  })

  it('does not throw when a task has no turn id and the tool block is not mounted (no crash, no jump)', async () => {
    const user = userEvent.setup()
    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: Date.now(),
      tool_use_id: 'task_unresolvable',
      tool_input: { description: 'Unresolvable task' },
    })
    mockScrollToTurnRef.current = null

    render(<TasksPanel />)
    await user.click(screen.getByText('Unresolvable task'))

    expect(mockFocusChatTab).toHaveBeenCalled()
  })

  it('shows tasks in chronological order (oldest first)', async () => {
    const now = Date.now()

    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: now,
      tool_use_id: 'task_1',
      tool_input: { description: 'Older task' },
    })

    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: now + 1000,
      tool_use_id: 'task_2',
      tool_input: { description: 'Newer task' },
    })

    render(<TasksPanel />)

    const entries = screen.getAllByTestId('task-entry')
    expect(entries[0]).toHaveTextContent('Older task')
    expect(entries[1]).toHaveTextContent('Newer task')
  })

  describe('isReplaying', () => {
    it('shows "Resuming..." overlay when isReplaying is true', () => {
      mockEventsData.isReplaying = true

      render(<TasksPanel />)

      expect(screen.getByTestId('panel-tasks')).toHaveTextContent('Resuming...')
    })

    it('does not show task entries when isReplaying is true', () => {
      mockEventsData.isReplaying = true
      mockEvents.push({
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now(),
        tool_use_id: 'task_1',
        tool_input: { description: 'Hidden task' },
      })

      render(<TasksPanel />)

      expect(screen.queryByTestId('task-entry')).not.toBeInTheDocument()
      expect(screen.getByText('Resuming...')).toBeInTheDocument()
    })

    it('has tasks-loading class (not tasks-empty) when isReplaying is true', () => {
      mockEventsData.isReplaying = true

      render(<TasksPanel />)

      // Resuming is a loading state (data not yet hydrated), not an empty state.
      const root = screen.getByTestId('panel-tasks')
      expect(root).toHaveClass('tasks-loading')
      expect(root).not.toHaveClass('tasks-empty')
    })

    it('shows "Resuming..." when isResuming is true (before replay starts)', () => {
      mockEventsData.isResuming = true

      render(<TasksPanel />)

      expect(screen.getByTestId('panel-tasks')).toHaveTextContent('Resuming...')
    })
  })

  describe('staleness coloring', () => {
    it('applies inline border color to running task', () => {
      mockEvents.push({
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now(),
        tool_use_id: 'task_1',
        tool_input: { description: 'Active task' },
      })

      render(<TasksPanel />)

      const entry = screen.getByTestId('task-entry')
      expect(entry.style.borderLeftColor).toBeTruthy()
    })

    it('does not apply inline border color to completed task', async () => {
      const user = userEvent.setup()
      const now = Date.now()
      mockEvents.push(
        {
          subtype: 'tool_use',
          content: 'Task',
          timestamp: now,
          tool_use_id: 'task_1',
          tool_input: { description: 'Done task' },
        },
        {
          subtype: 'tool_result',
          timestamp: now + 1000,
          content: 'Done',
          tool_use_id: 'task_1',
        },
      )

      render(<TasksPanel />)

      await user.click(screen.getByRole('button', { name: /All/ }))

      const entry = screen.getByTestId('task-entry')
      expect(entry.style.borderLeftColor).toBeFalsy()
    })
  })

  describe('duration display', () => {
    it('shows formatted duration for a completed task', async () => {
      const user = userEvent.setup()
      const now = Date.now()
      // Task that ran for 65 seconds (1m 5s)
      mockEvents.push(
        {
          subtype: 'tool_use',
          content: 'Task',
          timestamp: now - 65000,
          tool_use_id: 'task_1',
          tool_input: { description: 'Timed task' },
        },
        {
          subtype: 'tool_result',
          timestamp: now,
          content: 'Done',
          tool_use_id: 'task_1',
        },
      )

      render(<TasksPanel />)

      await user.click(screen.getByRole('button', { name: /All/ }))

      expect(screen.getByText('1m 5s')).toBeInTheDocument()
    })

    it('shows "0s" for a task with zero duration', async () => {
      const user = userEvent.setup()
      const now = Date.now()
      mockEvents.push(
        {
          subtype: 'tool_use',
          content: 'Task',
          timestamp: now,
          tool_use_id: 'task_1',
          tool_input: { description: 'Instant task' },
        },
        {
          subtype: 'tool_result',
          timestamp: now,
          content: 'Done',
          tool_use_id: 'task_1',
        },
      )

      render(<TasksPanel />)

      await user.click(screen.getByRole('button', { name: /All/ }))

      expect(screen.getByText('0s')).toBeInTheDocument()
    })

    it('shows hours for long-running tasks', async () => {
      const user = userEvent.setup()
      const now = Date.now()
      // Task that ran for 3661 seconds (1h 1m 1s)
      mockEvents.push(
        {
          subtype: 'tool_use',
          content: 'Task',
          timestamp: now - 3661000,
          tool_use_id: 'task_1',
          tool_input: { description: 'Long task' },
        },
        {
          subtype: 'tool_result',
          timestamp: now,
          content: 'Done',
          tool_use_id: 'task_1',
        },
      )

      render(<TasksPanel />)

      await user.click(screen.getByRole('button', { name: /All/ }))

      expect(screen.getByText('1h 1m 1s')).toBeInTheDocument()
    })
  })
})
