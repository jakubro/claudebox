/** Tests for CommandAutocomplete component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../utils/categorize', () => ({
  CATEGORY_COLORS: { builtin: '#aaa', custom: '#bbb' },
}))

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

import CommandAutocomplete from './CommandAutocomplete'

const makeItem = (overrides = {}) => ({
  name: 'help',
  category: 'builtin',
  description: 'Show help',
  ...overrides,
})

describe('CommandAutocomplete', () => {
  it('returns null for empty items', () => {
    const { container } = render(
      <CommandAutocomplete items={[]} selectedIndex={0} onSelect={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders items with names prefixed by /', () => {
    render(
      <CommandAutocomplete
        items={[makeItem({ name: 'help' }), makeItem({ name: 'clear' })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
  })

  it('highlights selected item with active class', () => {
    render(
      <CommandAutocomplete
        items={[makeItem({ name: 'a' }), makeItem({ name: 'b' })]}
        selectedIndex={1}
        onSelect={vi.fn()}
      />,
    )
    const items = screen.getByTestId('command-autocomplete').querySelectorAll('.autocomplete-item')
    expect(items[0]).not.toHaveClass('autocomplete-item-active')
    expect(items[1]).toHaveClass('autocomplete-item-active')
  })

  it('shows detail panel for highlighted item', () => {
    render(
      <CommandAutocomplete
        items={[makeItem({ description: 'Full description here' })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    )
    const detail = screen
      .getByTestId('command-autocomplete')
      .querySelector('.autocomplete-detail-desc')
    expect(detail).toHaveTextContent('Full description here')
  })

  it('shows usage in detail panel when present', () => {
    render(
      <CommandAutocomplete
        items={[makeItem({ usage: '/help [topic]' })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    )
    const usage = screen
      .getByTestId('command-autocomplete')
      .querySelector('.autocomplete-detail-usage')
    expect(usage).toHaveTextContent('/help [topic]')
  })

  it('shows meta in detail panel when model/effort/context present', () => {
    render(
      <CommandAutocomplete
        items={[makeItem({ model: 'claude-3', effort: 'high', context: 'full' })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    )
    const meta = screen
      .getByTestId('command-autocomplete')
      .querySelector('.autocomplete-detail-meta')
    expect(meta).toHaveTextContent('model: claude-3')
    expect(meta).toHaveTextContent('effort: high')
    expect(meta).toHaveTextContent('full')
  })

  it('calls onSelect on mouseDown', async () => {
    const onSelect = vi.fn()
    const item = makeItem()
    render(<CommandAutocomplete items={[item]} selectedIndex={0} onSelect={onSelect} />)
    const user = userEvent.setup()
    const el = screen.getByText('/help').closest('.autocomplete-item')
    await user.pointer({ keys: '[MouseLeft>]', target: el })
    expect(onSelect).toHaveBeenCalledWith(item)
  })
})
