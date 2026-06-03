/** Tests for TasksPanel component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TasksPanel from './TasksPanel'

// Mock contexts
const mockEvents = []
const mockFocusChatTab = vi.fn()
const mockEventsData = { isResuming: false, isReplaying: false }

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => ({
    events: mockEvents,
    ...mockEventsData,
  }),
}))

vi.mock('../../context/AppActionsContext', () => ({
  useAppActions: () => ({
    focusChatTab: mockFocusChatTab,
  }),
}))

describe('TasksPanel', () => {
  beforeEach(() => {
    mockEvents.length = 0
    mockFocusChatTab.mockClear()
    mockEventsData.isResuming = false
    mockEventsData.isReplaying = false
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

    // Switch to All filter to see completed task
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

    // Switch to All filter to see failed task
    await user.click(screen.getByRole('button', { name: /All/ }))

    const entry = screen.getByTestId('task-entry')
    expect(entry).toHaveClass('task-failed')
  })

  it('filters tasks by status when filter clicked', async () => {
    const user = userEvent.setup()
    const now = Date.now()

    // Add running task
    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: now,
      tool_use_id: 'task_1',
      tool_input: { description: 'Running task' },
    })

    // Add completed task
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

    // Click "All" filter to see both
    await user.click(screen.getByRole('button', { name: /All/ }))

    // Both visible with All filter
    expect(screen.getByText('Running task')).toBeInTheDocument()
    expect(screen.getByText('Completed task')).toBeInTheDocument()
  })

  it('shows filter counts', () => {
    const now = Date.now()

    // Add 2 running tasks
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

    // Check counts in filter buttons
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

  it('shows tasks in chronological order (oldest first)', async () => {
    const now = Date.now()

    // Add older task
    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: now,
      tool_use_id: 'task_1',
      tool_input: { description: 'Older task' },
    })

    // Add newer task
    mockEvents.push({
      subtype: 'tool_use',
      content: 'Task',
      timestamp: now + 1000,
      tool_use_id: 'task_2',
      tool_input: { description: 'Newer task' },
    })

    render(<TasksPanel />)

    const entries = screen.getAllByTestId('task-entry')
    // Older task should appear first (chronological order)
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
      // Running task should have inline border-left-color style
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

      // Switch to All to see completed task
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
