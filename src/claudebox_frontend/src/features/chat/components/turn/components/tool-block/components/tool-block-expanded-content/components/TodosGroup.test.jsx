/** Tests for TodosGroup component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TurnContext } from '../../../../../TurnContext'
import TodosGroup from './TodosGroup'

function withDiffs(todoDiffs) {
  return ({ children }) => (
    <TurnContext.Provider value={{ todoDiffs }}>{children}</TurnContext.Provider>
  )
}

describe('TodosGroup', () => {
  it('mounts inside the shared ToolBlock chrome with the static "Todos" header', () => {
    const diffs = new Map([
      [
        't1',
        {
          added: [{ content: 'A', _taskId: '1', status: 'pending' }],
          started: [],
          completed: [],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    // Chrome host carries the same .tool-block class as every other tool block.
    const host = screen.getByTestId('todos-group')
    expect(host).toHaveClass('tool-block')
    // Header label sits in the chrome's .tool-name slot.
    expect(host.querySelector('.tool-name').textContent).toBe('Todos')
  })

  it('renders per-state counts in the chrome subtitle (.tool-summary), non-zero only', () => {
    const diffs = new Map([
      [
        't1',
        {
          completed: [{ content: 'C', _taskId: '1', status: 'completed' }],
          started: [{ content: 'S', _taskId: '2', status: 'in_progress' }],
          added: [],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    const summary = document.querySelector('.tool-summary').textContent
    expect(summary).toMatch(/●1/)
    expect(summary).toMatch(/◐1/)
    expect(summary).not.toMatch(/○/)
    expect(summary).not.toMatch(/✕/)
  })

  it('opens expanded by default — row body visible without clicking', () => {
    const diffs = new Map([
      [
        't1',
        {
          added: [{ content: 'A', _taskId: '1', status: 'pending' }],
          started: [],
          completed: [],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    expect(screen.getByTestId('todos-group-rows')).toBeInTheDocument()
  })

  it('toggles the row body when the chrome header is clicked', () => {
    const diffs = new Map([
      [
        't1',
        {
          added: [{ content: 'A', _taskId: '1', status: 'pending' }],
          started: [],
          completed: [],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    expect(screen.queryByTestId('todos-group-rows')).toBeInTheDocument()

    fireEvent.click(document.querySelector('.tool-header-area'))
    expect(screen.queryByTestId('todos-group-rows')).not.toBeInTheDocument()

    fireEvent.click(document.querySelector('.tool-header-area'))
    expect(screen.queryByTestId('todos-group-rows')).toBeInTheDocument()
  })

  it('renders each row as three grid children (icon · title · description) under .todos-group-rows', () => {
    const diffs = new Map([
      [
        't1',
        {
          added: [{ content: 'Task A', _taskId: '1', status: 'pending', subtitle: 'desc A' }],
          started: [],
          completed: [{ content: 'Task B', _taskId: '2', status: 'completed' }],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    const rows = document.querySelectorAll('.todos-group-rows .todo-item')
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.querySelectorAll(':scope > .todo-icon').length).toBe(1)
      expect(row.querySelectorAll(':scope > .todo-content').length).toBe(1)
      expect(row.querySelectorAll(':scope > .todo-description').length).toBe(1)
      // Exactly 3 immediate children — no .todo-row flex wrapper, no .todo-subtitle div.
      expect(row.children.length).toBe(3)
    }
  })

  it('sets title= on the description cell when subtitle is present; omits it otherwise', () => {
    const diffs = new Map([
      [
        't1',
        {
          added: [
            { content: 'A', _taskId: '1', status: 'pending', subtitle: 'has desc' },
            { content: 'B', _taskId: '2', status: 'pending' }, // no subtitle
          ],
          started: [],
          completed: [],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    const cells = document.querySelectorAll('.todos-group-rows .todo-description')
    expect(cells[0].getAttribute('title')).toBe('has desc')
    expect(cells[1].hasAttribute('title')).toBe(false)
  })

  it('dedups across the run — latest item per _taskId wins', () => {
    const diffs = new Map([
      [
        'create',
        {
          added: [{ content: 'Task one', _taskId: '1', status: 'pending' }],
          started: [],
          completed: [],
          removed: [],
        },
      ],
      [
        'update',
        {
          added: [],
          started: [],
          completed: [{ content: 'Task one', _taskId: '1', status: 'completed' }],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 'create' }, { toolUseId: 'update' }]} />, {
      wrapper: withDiffs(diffs),
    })

    const rows = document.querySelectorAll('.todo-item')
    expect(rows.length).toBe(1)
    expect(rows[0]).toHaveClass('todo-completed')
    expect(rows[0].textContent).toContain('Task one')
  })

  it('renders rows in bucket order: completed → in_progress → pending → removed', () => {
    const diffs = new Map([
      [
        't1',
        {
          added: [{ content: 'P', _taskId: '3', status: 'pending' }],
          started: [{ content: 'S', _taskId: '2', status: 'in_progress' }],
          completed: [{ content: 'C', _taskId: '1', status: 'completed' }],
          removed: [{ content: 'R', _taskId: '4', status: 'removed' }],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    const rows = document.querySelectorAll('.todo-item .todo-content')
    expect([...rows].map(r => r.textContent)).toEqual(['C', 'S', 'P', 'R'])
  })

  it('renders blocked rows with the ⊘ icon swap', () => {
    const diffs = new Map([
      [
        't1',
        {
          started: [{ content: 'Blocker', _taskId: '1', status: 'in_progress' }],
          added: [{ content: 'Blocked', _taskId: '2', status: 'pending', blockedBy: ['1'] }],
          completed: [],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    const icons = [...document.querySelectorAll('.todo-icon')].map(i => i.textContent)
    expect(icons).toEqual(['◐', '⊘'])
    expect(document.querySelector('.tool-summary').textContent).toMatch(/⊘1/)
  })

  it('treats cross-run blockers (taskIds not in the merged set) as resolved', () => {
    const diffs = new Map([
      [
        't1',
        {
          added: [{ content: 'X', _taskId: '2', status: 'pending', blockedBy: ['99'] }],
          started: [],
          completed: [],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }]} />, { wrapper: withDiffs(diffs) })

    const icon = document.querySelector('.todo-icon').textContent
    expect(icon).toBe('○')
  })

  it('renders chrome (but empty row body) for an empty run', () => {
    render(<TodosGroup taskBlocks={[]} />, { wrapper: withDiffs(new Map()) })

    expect(screen.getByTestId('todos-group')).toBeInTheDocument()
    expect(document.querySelectorAll('.todo-item').length).toBe(0)
    expect(document.querySelector('.tool-name').textContent).toBe('Todos')
    // Empty counts → empty summary string (no per-state icons).
    expect(document.querySelector('.tool-summary').textContent).toBe('')
  })

  it('falls back to content-equality merging for items lacking _taskId', () => {
    const diffs = new Map([
      [
        't1',
        {
          added: [{ content: 'Identical', status: 'pending' }],
          started: [],
          completed: [],
          removed: [],
        },
      ],
      [
        't2',
        {
          added: [{ content: 'Identical', status: 'pending' }],
          started: [],
          completed: [],
          removed: [],
        },
      ],
    ])
    render(<TodosGroup taskBlocks={[{ toolUseId: 't1' }, { toolUseId: 't2' }]} />, {
      wrapper: withDiffs(diffs),
    })

    expect(document.querySelectorAll('.todo-item').length).toBe(1)
  })
})
