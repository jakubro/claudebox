/** Tests for SystemReminders component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SystemReminders from './SystemReminders'

describe('SystemReminders', () => {
  it('returns null when reminders is undefined', () => {
    const { container } = render(<SystemReminders />)

    expect(container.innerHTML).toBe('')
  })

  it('returns null when reminders is empty array', () => {
    const { container } = render(<SystemReminders reminders={[]} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders singular label for one reminder', () => {
    render(<SystemReminders reminders={['Do something']} />)

    expect(screen.getByText('System Reminder (1)')).toBeInTheDocument()
  })

  it('renders plural label for multiple distinct reminders', () => {
    render(<SystemReminders reminders={['First', 'Second', 'Third']} />)

    expect(screen.getByText('System Reminders (3)')).toBeInTheDocument()
  })

  it('starts collapsed with no content visible', () => {
    render(<SystemReminders reminders={['Hidden content']} />)

    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument()
  })

  it('expands to show content when header is clicked', () => {
    render(<SystemReminders reminders={['Visible content']} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Visible content')).toBeInTheDocument()
  })

  it('collapses content on second click', () => {
    render(<SystemReminders reminders={['Toggle me']} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Toggle me')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByText('Toggle me')).not.toBeInTheDocument()
  })

  it('replaces backslash-n with real newlines in reminder text', () => {
    render(<SystemReminders reminders={['line1\\nline2']} />)

    fireEvent.click(screen.getByRole('button'))

    const pre = document.querySelector('.system-reminder-item')
    expect(pre.textContent).toBe('line1\nline2')
  })

  it('trims whitespace from reminder text', () => {
    render(<SystemReminders reminders={['  padded  ']} />)

    fireEvent.click(screen.getByRole('button'))

    const pre = document.querySelector('.system-reminder-item')
    expect(pre.textContent).toBe('padded')
  })

  it('renders all distinct reminders when expanded', () => {
    render(<SystemReminders reminders={['First reminder', 'Second reminder']} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('First reminder')).toBeInTheDocument()
    expect(screen.getByText('Second reminder')).toBeInTheDocument()
  })

  it('deduplicates identical reminders and shows count', () => {
    render(<SystemReminders reminders={['Same text', 'Same text', 'Same text']} />)

    // Header shows unique count
    expect(screen.getByText('System Reminder (1)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    // Shows one instance with ×3 count
    expect(screen.getByText('Same text')).toBeInTheDocument()
    expect(screen.getByText('×3')).toBeInTheDocument()

    // Only one pre element rendered
    expect(document.querySelectorAll('.system-reminder-item')).toHaveLength(1)
  })

  it('deduplicates mixed reminders correctly', () => {
    render(<SystemReminders reminders={['Alpha', 'Beta', 'Alpha', 'Alpha', 'Beta']} />)

    // 2 unique reminders
    expect(screen.getByText('System Reminders (2)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('×3')).toBeInTheDocument()
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(document.querySelectorAll('.system-reminder-item')).toHaveLength(2)
  })

  it('does not show count badge for single-occurrence reminders', () => {
    render(<SystemReminders reminders={['Unique']} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.queryByText(/×/)).not.toBeInTheDocument()
  })
})
