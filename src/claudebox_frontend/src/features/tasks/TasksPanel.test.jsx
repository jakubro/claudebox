/** Tests for TasksPanel component. */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendBackgroundLaunches, appendTaskNotifications } from '../../utils/eventProcessing'
import TasksPanel from './TasksPanel'

const mockEvents = []
const mockFocusChatTab = vi.fn()
const mockEventsData = { isResuming: false, isReplaying: false }
// Stable ref identity across renders (mirrors the real useRef-backed context), so a click handler
// reading `.current` at call time sees whatever the test set, not a fresh mock each render.
const mockJumpToTaskRef = { current: null }

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => ({
    events: mockEvents,
    taskNotifications: appendTaskNotifications(new Map(), mockEvents),
    backgroundLaunches: appendBackgroundLaunches(new Map(), new Map(), mockEvents).launches,
    ...mockEventsData,
  }),
}))

vi.mock('../../context/AppActionsContext', () => ({
  useAppActions: () => ({
    focusChatTab: mockFocusChatTab,
    jumpToTaskRef: mockJumpToTaskRef,
  }),
}))

async function renderAllTasks(user) {
  render(<TasksPanel />)
  await user.click(screen.getByRole('button', { name: /All/ }))
}

async function renderFinishedTask({ description, result = 'Done', ranForMs = 1000 }) {
  const user = userEvent.setup()
  const now = Date.now()
  mockEvents.push(
    {
      subtype: 'tool_use',
      content: 'Task',
      timestamp: now - ranForMs,
      tool_use_id: 'task_1',
      tool_input: { description },
    },
    {
      subtype: 'tool_result',
      timestamp: now,
      content: result,
      tool_use_id: 'task_1',
    },
  )
  await renderAllTasks(user)
}

describe('TasksPanel', () => {
  beforeEach(() => {
    mockEvents.length = 0
    mockFocusChatTab.mockClear()
    mockEventsData.isResuming = false
    mockEventsData.isReplaying = false
    mockJumpToTaskRef.current = null
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
    await renderFinishedTask({ description: 'Done task', result: 'Success' })

    const entry = screen.getByTestId('task-entry')
    expect(entry).toHaveClass('task-completed')
  })

  it('shows failed task with red border in All filter', async () => {
    await renderFinishedTask({ description: 'Failed task', result: 'Error: something went wrong' })

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

  it('hands the clicked task to jumpToTaskRef - the chat area picks the landing column', async () => {
    const user = userEvent.setup()
    mockEvents.push(
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'do it',
        turn_id: 'turn_1',
        timestamp: Date.now(),
      },
      {
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now(),
        tool_use_id: 'task_1',
        tool_input: { description: 'Some task' },
      },
    )
    mockJumpToTaskRef.current = vi.fn()

    render(<TasksPanel />)
    await user.click(screen.getByText('Some task'))

    await waitFor(() =>
      expect(mockJumpToTaskRef.current).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'task_1', turnId: 'turn_1' }),
      ),
    )
  })

  it('does not throw when jumpToTaskRef is not yet registered', async () => {
    const user = userEvent.setup()
    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: Date.now(),
      tool_use_id: 'task_unresolvable',
      tool_input: { description: 'Unresolvable task' },
    })
    mockJumpToTaskRef.current = null

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

  describe('background commands', () => {
    function pushCommand(toolUseId, taskId, description, startedAt = Date.now()) {
      mockEvents.push(
        {
          type: 'assistant',
          subtype: 'tool_use',
          content: 'Bash',
          timestamp: startedAt,
          tool_use_id: toolUseId,
          tool_input: { command: 'sleep 60', description, run_in_background: true },
        },
        {
          type: 'user',
          subtype: 'tool_result',
          timestamp: startedAt + 10,
          tool_use_id: toolUseId,
          tool_use_result: { backgroundTaskId: taskId },
        },
      )
    }

    function pushSubagent(toolUseId, description) {
      mockEvents.push({
        subtype: 'tool_use',
        content: 'Task',
        timestamp: Date.now(),
        tool_use_id: toolUseId,
        tool_input: { description },
      })
    }

    it('marks command rows, and only command rows, with a terminal icon', () => {
      pushSubagent('task_1', 'Review the diff')
      pushCommand('tu1', 'b1', 'Wait a minute')

      render(<TasksPanel />)

      const entries = screen.getAllByTestId('task-entry')
      expect(entries.map(e => e.textContent)).toEqual([
        expect.stringContaining('Review the diff'),
        expect.stringContaining('Wait a minute'),
      ])
      expect(entries[0].querySelector('[data-testid="task-kind-icon"]')).toBeNull()
      expect(entries[1].querySelector('[data-testid="task-kind-icon"]')).not.toBeNull()
    })

    it('keeps a quiet running command in the plain running colour', () => {
      pushCommand('tu1', 'b1', 'Wait', Date.now() - 180_000)

      render(<TasksPanel />)

      const entry = screen.getByTestId('task-entry')
      expect(entry.style.borderLeftColor).toBe('')
      expect(entry).toHaveClass('task-running')
    })

    it('counts command rows in the Active and All filters', () => {
      pushSubagent('task_1', 'Review')
      pushCommand('tu1', 'b1', 'One')
      pushCommand('tu2', 'b2', 'Two')
      mockEvents.push({
        type: 'system',
        subtype: 'task_notification',
        message_data: { task_id: 'b2', status: 'completed' },
      })

      render(<TasksPanel />)

      expect(screen.getByRole('button', { name: /Active/ })).toHaveTextContent('2')
      expect(screen.getByRole('button', { name: /All/ })).toHaveTextContent('3')
    })

    it('hands a clicked command row to the jump handler with its id and turn', async () => {
      const user = userEvent.setup()
      const jump = vi.fn()
      mockJumpToTaskRef.current = jump
      mockEvents.push({
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'go',
        turn_id: 't1',
      })
      pushCommand('tu1', 'b1', 'Wait')

      render(<TasksPanel />)
      await user.click(screen.getByTestId('task-entry'))

      await waitFor(() =>
        expect(jump).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'tu1', turnId: 't1', kind: 'command' }),
        ),
      )
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
      await renderFinishedTask({ description: 'Done task' })

      const entry = screen.getByTestId('task-entry')
      expect(entry.style.borderLeftColor).toBeFalsy()
    })
  })

  describe('duration display', () => {
    it('shows formatted duration for a completed task', async () => {
      // Task that ran for 65 seconds (1m 5s)
      await renderFinishedTask({ description: 'Timed task', ranForMs: 65000 })

      expect(screen.getByText('1m 5s')).toBeInTheDocument()
    })

    it('shows "0s" for a task with zero duration', async () => {
      await renderFinishedTask({ description: 'Instant task', ranForMs: 0 })

      expect(screen.getByText('0s')).toBeInTheDocument()
    })

    it('shows hours for long-running tasks', async () => {
      // Task that ran for 3661 seconds (1h 1m 1s)
      await renderFinishedTask({ description: 'Long task', ranForMs: 3661000 })

      expect(screen.getByText('1h 1m 1s')).toBeInTheDocument()
    })
  })
})
