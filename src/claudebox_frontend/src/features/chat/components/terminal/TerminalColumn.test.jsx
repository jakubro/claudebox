/** Tests for TerminalColumn - session-wide shell transcript. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TerminalColumn from './TerminalColumn'

function entry(id, overrides = {}) {
  return {
    id,
    turnId: `t-${id}`,
    command: `echo ${id}`,
    description: null,
    result: { content: `output ${id}`, is_error: false },
    ...overrides,
  }
}

describe('TerminalColumn', () => {
  it('shows the empty state when there are no entries', () => {
    render(<TerminalColumn entries={[]} />)

    expect(screen.getByTestId('terminal-empty')).toHaveTextContent('No commands have run yet.')
  })

  it('renders every entry, oldest first', () => {
    const { container } = render(<TerminalColumn entries={[entry('a'), entry('b'), entry('c')]} />)

    const commands = [...container.querySelectorAll('.terminal-entry-command')].map(el =>
      el.textContent.trim(),
    )
    expect(commands).toEqual(['echo a', 'echo b', 'echo c'])
  })

  it('does not show the empty state once entries exist', () => {
    render(<TerminalColumn entries={[entry('a')]} />)

    expect(screen.queryByTestId('terminal-empty')).toBeNull()
  })

  it('forwards a click on the jump button to onEntryClick', async () => {
    const user = userEvent.setup()
    const onEntryClick = vi.fn()
    render(<TerminalColumn entries={[entry('a')]} onEntryClick={onEntryClick} />)

    await user.click(screen.getByTitle('Jump to this turn'))

    expect(onEntryClick).toHaveBeenCalledWith(entry('a'))
  })
})
