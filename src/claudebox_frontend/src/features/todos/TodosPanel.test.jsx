/** Tests for TodosPanel component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TodosPanel from './TodosPanel'

// Mock EventsContext
const mockEventsData = {
  isResuming: false,
  isReplaying: false,
  todosBySubagent: new Map(),
  subagentLabels: new Map(),
}
vi.mock('../../context/EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

describe('TodosPanel', () => {
  beforeEach(() => {
    mockEventsData.isResuming = false
    mockEventsData.isReplaying = false
    mockEventsData.todosBySubagent = new Map()
    mockEventsData.subagentLabels = new Map()
  })

  it('renders empty state', () => {
    render(<TodosPanel />)

    expect(screen.getByText('No todos yet')).toBeInTheDocument()
  })

  it('renders main agent todo items with status icons', () => {
    mockEventsData.todosBySubagent = new Map([
      [
        'main',
        [
          { content: 'Pending task', status: 'pending' },
          { content: 'In progress task', status: 'in_progress' },
          { content: 'Completed task', status: 'completed' },
        ],
      ],
    ])

    render(<TodosPanel />)

    expect(screen.getByText('Pending task')).toBeInTheDocument()
    expect(screen.getByText('In progress task')).toBeInTheDocument()
    expect(screen.getByText('Completed task')).toBeInTheDocument()
  })

  it('shows correct icon for pending status', () => {
    mockEventsData.todosBySubagent = new Map([['main', [{ content: 'Task', status: 'pending' }]]])

    render(<TodosPanel />)

    expect(screen.getByText('○')).toBeInTheDocument()
  })

  it('shows correct icon for in_progress status', () => {
    mockEventsData.todosBySubagent = new Map([
      ['main', [{ content: 'Task', status: 'in_progress' }]],
    ])

    render(<TodosPanel />)

    expect(screen.getByText('◐')).toBeInTheDocument()
  })

  it('shows correct icon for completed status', () => {
    mockEventsData.todosBySubagent = new Map([['main', [{ content: 'Task', status: 'completed' }]]])

    render(<TodosPanel />)

    expect(screen.getByText('●')).toBeInTheDocument()
  })

  it('shows empty state when todosBySubagent is empty', () => {
    mockEventsData.todosBySubagent = new Map()

    render(<TodosPanel />)

    expect(screen.getByText('No todos yet')).toBeInTheDocument()
  })

  describe('isReplaying', () => {
    it('shows "Resuming..." overlay when isReplaying is true', () => {
      mockEventsData.isReplaying = true

      render(<TodosPanel />)

      expect(screen.getByTestId('panel-todos')).toHaveTextContent('Resuming...')
    })

    it('does not show todo items when isReplaying is true', () => {
      mockEventsData.isReplaying = true
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Hidden todo', status: 'pending' }]],
      ])

      render(<TodosPanel />)

      expect(screen.queryByTestId('todo-item')).not.toBeInTheDocument()
      expect(screen.getByText('Resuming...')).toBeInTheDocument()
    })

    it('has todos-loading class (not todos-empty) when isReplaying is true', () => {
      mockEventsData.isReplaying = true

      render(<TodosPanel />)

      // Resuming is a loading state (data not yet hydrated), not an empty state.
      const root = screen.getByTestId('panel-todos')
      expect(root).toHaveClass('todos-loading')
      expect(root).not.toHaveClass('todos-empty')
    })

    it('shows "Resuming..." when isResuming is true (before replay starts)', () => {
      mockEventsData.isResuming = true

      render(<TodosPanel />)

      expect(screen.getByTestId('panel-todos')).toHaveTextContent('Resuming...')
    })
  })

  describe('CSS class per status', () => {
    it('applies todo-pending class for pending status', () => {
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Pending task', status: 'pending' }]],
      ])

      render(<TodosPanel />)

      expect(screen.getByTestId('todo-item')).toHaveClass('todo-pending')
    })

    it('applies todo-in_progress class for in_progress status', () => {
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Active task', status: 'in_progress' }]],
      ])

      render(<TodosPanel />)

      expect(screen.getByTestId('todo-item')).toHaveClass('todo-in_progress')
    })

    it('applies todo-completed class for completed status', () => {
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Done task', status: 'completed' }]],
      ])

      render(<TodosPanel />)

      expect(screen.getByTestId('todo-item')).toHaveClass('todo-completed')
    })
  })

  describe('unknown status fallback', () => {
    it('uses fallback icon for unknown status', () => {
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Unknown task', status: 'cancelled' }]],
      ])

      render(<TodosPanel />)

      // Unknown status should fall back to "○" icon
      const statusEl = screen.getByText('○')
      expect(statusEl).toBeInTheDocument()
    })

    it('applies todo-{status} class even for unknown status', () => {
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Unknown task', status: 'cancelled' }]],
      ])

      render(<TodosPanel />)

      expect(screen.getByTestId('todo-item')).toHaveClass('todo-cancelled')
    })
  })

  describe('subagent segmentation', () => {
    it('renders main section without header', () => {
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Main task', status: 'pending' }]],
      ])

      render(<TodosPanel />)

      expect(screen.getByText('Main task')).toBeInTheDocument()
      expect(screen.queryByTestId('todo-section-header')).not.toBeInTheDocument()
    })

    it('renders subagent section with header showing description', () => {
      mockEventsData.todosBySubagent = new Map([
        ['task_abc', [{ content: 'Sub task', status: 'in_progress' }]],
      ])
      mockEventsData.subagentLabels = new Map([['task_abc', 'Run tests']])

      render(<TodosPanel />)

      expect(screen.getByText('Sub task')).toBeInTheDocument()
      const header = screen.getByTestId('todo-section-header')
      expect(header).toBeInTheDocument()
      expect(screen.getByText('Run tests')).toBeInTheDocument()
      expect(header).toHaveAttribute('title', 'Run tests')
    })

    it('falls back to truncated ID when label is missing', () => {
      mockEventsData.todosBySubagent = new Map([
        ['task_long_id_here', [{ content: 'Sub task', status: 'pending' }]],
      ])

      render(<TodosPanel />)

      expect(screen.getByText('task_lon')).toBeInTheDocument()
    })

    it('renders main section before subagent sections', () => {
      mockEventsData.todosBySubagent = new Map([
        ['task_sub', [{ content: 'Sub task', status: 'pending' }]],
        ['main', [{ content: 'Main task', status: 'pending' }]],
      ])
      mockEventsData.subagentLabels = new Map([['task_sub', 'Build']])

      render(<TodosPanel />)

      const sections = screen.getAllByTestId('todo-section')
      expect(sections).toHaveLength(2)
      // Main section first (no header)
      expect(sections[0].querySelector('[data-testid="todo-section-header"]')).toBeNull()
      expect(sections[0]).toHaveTextContent('Main task')
      // Subagent section second (with header)
      expect(sections[1].querySelector('[data-testid="todo-section-header"]')).toBeTruthy()
      expect(sections[1]).toHaveTextContent('Sub task')
    })

    it('renders multiple subagent sections', () => {
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Main', status: 'pending' }]],
        ['task_a', [{ content: 'Task A', status: 'in_progress' }]],
        ['task_b', [{ content: 'Task B', status: 'completed' }]],
      ])
      mockEventsData.subagentLabels = new Map([
        ['task_a', 'Lint code'],
        ['task_b', 'Run tests'],
      ])

      render(<TodosPanel />)

      expect(screen.getByText('Main')).toBeInTheDocument()
      expect(screen.getByText('Task A')).toBeInTheDocument()
      expect(screen.getByText('Task B')).toBeInTheDocument()
      expect(screen.getByText('Lint code')).toBeInTheDocument()
      expect(screen.getByText('Run tests')).toBeInTheDocument()
    })

    it('skips subagent sections with empty todo arrays', () => {
      mockEventsData.todosBySubagent = new Map([
        ['main', [{ content: 'Main', status: 'pending' }]],
        ['task_empty', []],
      ])

      render(<TodosPanel />)

      const sections = screen.getAllByTestId('todo-section')
      expect(sections).toHaveLength(1)
    })
  })
})
