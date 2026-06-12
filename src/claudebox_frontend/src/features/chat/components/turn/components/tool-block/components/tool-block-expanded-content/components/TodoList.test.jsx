/** Tests for TodoList component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TodoList from './TodoList'

describe('TodoList', () => {
  it('shows "No changes" when no todos and no diff', () => {
    render(<TodoList />)

    expect(screen.getByText('No changes')).toBeInTheDocument()
  })

  it('shows "No changes" when todoDiff has all empty arrays', () => {
    render(<TodoList todoDiff={{ completed: [], started: [], added: [], removed: [] }} />)

    expect(screen.getByText('No changes')).toBeInTheDocument()
  })

  it('renders completed items with correct icon', () => {
    render(<TodoList todoDiff={{ completed: [{ content: 'Done task' }] }} />)

    const icons = document.querySelectorAll('.todo-icon')
    expect(icons[0].textContent).toBe('●')
    expect(screen.getByText('Done task')).toBeInTheDocument()
  })

  it('renders in_progress items with correct icon', () => {
    render(<TodoList todoDiff={{ started: [{ content: 'Working on it' }] }} />)

    const icons = document.querySelectorAll('.todo-icon')
    expect(icons[0].textContent).toBe('◐')
    expect(screen.getByText('Working on it')).toBeInTheDocument()
  })

  it('renders pending items with correct icon', () => {
    render(<TodoList todoDiff={{ added: [{ content: 'New task' }] }} />)

    const icons = document.querySelectorAll('.todo-icon')
    expect(icons[0].textContent).toBe('○')
    expect(screen.getByText('New task')).toBeInTheDocument()
  })

  it('renders removed items with correct icon', () => {
    render(<TodoList todoDiff={{ removed: [{ content: 'Dropped task' }] }} />)

    const icons = document.querySelectorAll('.todo-icon')
    expect(icons[0].textContent).toBe('✕')
    expect(screen.getByText('Dropped task')).toBeInTheDocument()
  })

  it('applies correct CSS class per status', () => {
    render(
      <TodoList
        todoDiff={{
          completed: [{ content: 'A' }],
          started: [{ content: 'B' }],
          added: [{ content: 'C' }],
          removed: [{ content: 'D' }],
        }}
      />,
    )

    const items = document.querySelectorAll('.todo-item')
    expect(items[0]).toHaveClass('todo-completed')
    expect(items[1]).toHaveClass('todo-in-progress')
    expect(items[2]).toHaveClass('todo-pending')
    expect(items[3]).toHaveClass('todo-removed')
  })

  it('orders items: completed, in_progress, pending, removed', () => {
    render(
      <TodoList
        todoDiff={{
          removed: [{ content: 'Removed' }],
          added: [{ content: 'Added' }],
          started: [{ content: 'Started' }],
          completed: [{ content: 'Completed' }],
        }}
      />,
    )

    const contents = document.querySelectorAll('.todo-content')
    expect(contents[0].textContent).toBe('Completed')
    expect(contents[1].textContent).toBe('Started')
    expect(contents[2].textContent).toBe('Added')
    expect(contents[3].textContent).toBe('Removed')
  })

  it('falls back to todos as pending when no diff provided', () => {
    render(<TodoList todos={[{ content: 'Task A' }, { content: 'Task B' }]} />)

    const icons = document.querySelectorAll('.todo-icon')
    expect(icons[0].textContent).toBe('○')
    expect(icons[1].textContent).toBe('○')
    expect(screen.getByText('Task A')).toBeInTheDocument()
    expect(screen.getByText('Task B')).toBeInTheDocument()
  })

  it('shows "No changes" for empty todos array without diff', () => {
    render(<TodoList todos={[]} />)

    expect(screen.getByText('No changes')).toBeInTheDocument()
  })

  it('applies todo-list-empty class on empty state', () => {
    render(<TodoList />)

    expect(document.querySelector('.todo-list-empty')).toBeInTheDocument()
  })

  it('renders blocked icon ⊘ when a pending item is blocked by an in-progress sibling', () => {
    render(
      <TodoList
        todoDiff={{
          started: [{ content: 'Blocker', status: 'in_progress', _taskId: '1' }],
          added: [{ content: 'Blocked', status: 'pending', _taskId: '2', blockedBy: ['1'] }],
        }}
      />,
    )

    const icons = document.querySelectorAll('.todo-icon')
    // Order: completed -> started -> added; blocker first (◐), then blocked (⊘ not ○).
    expect(icons[0].textContent).toBe('◐')
    expect(icons[1].textContent).toBe('⊘')
  })

  it('reverts to ○ when the only blocker is already completed', () => {
    render(
      <TodoList
        todoDiff={{
          completed: [{ content: 'Resolved blocker', status: 'completed', _taskId: '1' }],
          added: [{ content: 'Was blocked', status: 'pending', _taskId: '2', blockedBy: ['1'] }],
        }}
      />,
    )

    const icons = document.querySelectorAll('.todo-icon')
    expect(icons[0].textContent).toBe('●')
    // Blocker is in terminal state -> pending row renders with ○, not ⊘.
    expect(icons[1].textContent).toBe('○')
  })

  it('does not render the legacy .todo-blocked-by chip', () => {
    render(
      <TodoList
        todoDiff={{
          added: [{ content: 'X', status: 'pending', _taskId: '2', blockedBy: ['1'] }],
        }}
      />,
    )

    expect(document.querySelector('.todo-blocked-by')).not.toBeInTheDocument()
    expect(document.querySelector('[data-testid="todo-blocked-by"]')).not.toBeInTheDocument()
  })
})
