/** Tests for TodoRow component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TodoRow from './TodoRow'

describe('TodoRow', () => {
  it('renders icon + content + nothing else', () => {
    render(<TodoRow todo={{ content: 'Task one', status: 'pending' }} icon="○" />)

    const row = screen.getByTestId('todo-item')
    // Exactly two children: status span + content span.
    expect(row.children.length).toBe(2)
    expect(row.querySelector('.todo-status').textContent).toBe('○')
    expect(row.querySelector('.todo-content').textContent).toBe('Task one')
  })

  it('applies title attribute when subtitle is present', () => {
    render(<TodoRow todo={{ content: 'A', status: 'pending', subtitle: 'Detail line' }} icon="○" />)

    const row = screen.getByTestId('todo-item')
    expect(row).toHaveAttribute('title', 'Detail line')
  })

  it('omits the title attribute when subtitle is missing', () => {
    render(<TodoRow todo={{ content: 'A', status: 'pending' }} icon="○" />)

    const row = screen.getByTestId('todo-item')
    expect(row).not.toHaveAttribute('title')
  })

  it('omits the title attribute when subtitle is empty string', () => {
    render(<TodoRow todo={{ content: 'A', status: 'pending', subtitle: '' }} icon="○" />)

    const row = screen.getByTestId('todo-item')
    expect(row).not.toHaveAttribute('title')
  })

  it('renders no .todo-subtitle or .todo-blocked-by-badge element under any condition', () => {
    render(
      <TodoRow
        todo={{
          content: 'A',
          status: 'pending',
          subtitle: 'Some detail',
          blockedBy: ['1', '2'],
        }}
        icon="⊘"
      />,
    )

    expect(document.querySelector('.todo-subtitle')).toBeNull()
    expect(document.querySelector('.todo-blocked-by-badge')).toBeNull()
    expect(document.querySelector('[data-testid="todo-subtitle"]')).toBeNull()
    expect(document.querySelector('[data-testid="todo-blocked-by-badge"]')).toBeNull()
  })

  it('renders whatever icon the caller passes (blocked ⊘ swap is computed upstream)', () => {
    render(<TodoRow todo={{ content: 'X', status: 'pending' }} icon="⊘" />)

    expect(screen.getByTestId('todo-item').querySelector('.todo-status').textContent).toBe('⊘')
  })

  it('applies todo-{status} class from the item', () => {
    const { rerender } = render(<TodoRow todo={{ content: 'A', status: 'completed' }} icon="●" />)
    expect(screen.getByTestId('todo-item')).toHaveClass('todo-completed')

    rerender(<TodoRow todo={{ content: 'A', status: 'in_progress' }} icon="◐" />)
    expect(screen.getByTestId('todo-item')).toHaveClass('todo-in_progress')
  })
})
