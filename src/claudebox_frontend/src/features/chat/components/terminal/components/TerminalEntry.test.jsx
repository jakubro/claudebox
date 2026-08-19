/** Tests for TerminalEntry - one shell-call transcript row. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TerminalEntry from './TerminalEntry'

/** A terminal entry as deriveTerminalEntries would produce it. */
function entry(overrides = {}) {
  return {
    id: 'tu_1',
    turnId: 't-1',
    command: 'ls -la',
    description: null,
    result: { content: 'a.txt\nb.txt', is_error: false },
    ...overrides,
  }
}

describe('TerminalEntry', () => {
  it('renders the command', () => {
    render(<TerminalEntry entry={entry()} />)

    expect(screen.getByText('ls -la')).toBeInTheDocument()
  })

  it('renders the description as a comment line when present', () => {
    render(<TerminalEntry entry={entry({ description: 'List files' })} />)

    expect(screen.getByText('# List files')).toBeInTheDocument()
  })

  it('renders no comment line when there is no description', () => {
    const { container } = render(<TerminalEntry entry={entry({ description: null })} />)

    expect(container.querySelector('.terminal-entry-comment')).toBeNull()
  })

  it('renders the output beneath the command', () => {
    const { container } = render(<TerminalEntry entry={entry()} />)

    expect(container.querySelector('.terminal-entry-output')).toHaveTextContent('a.txt b.txt')
  })

  it('shows a pending state with no output while the call has no result yet', () => {
    render(<TerminalEntry entry={entry({ result: null })} />)

    expect(screen.getByTestId('terminal-entry-pending')).toHaveTextContent('Running...')
  })

  it('marks the command line as failed when the result reports is_error', () => {
    const { container } = render(
      <TerminalEntry entry={entry({ result: { content: 'boom', is_error: true } })} />,
    )

    expect(container.querySelector('.terminal-entry-command-line')).toHaveClass(
      'terminal-entry-failed',
    )
  })

  it('does not mark the command line as failed for a successful result', () => {
    const { container } = render(<TerminalEntry entry={entry()} />)

    expect(container.querySelector('.terminal-entry-command-line')).not.toHaveClass(
      'terminal-entry-failed',
    )
  })

  it('still shows output for a failed command', () => {
    render(<TerminalEntry entry={entry({ result: { content: 'boom', is_error: true } })} />)

    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('colours recognisable output the same way an inline block would', () => {
    const content = JSON.stringify(
      { name: 'test', count: 42, active: true, tags: ['a', 'b'], nested: { ok: true } },
      null,
      2,
    )
    const { container } = render(
      <TerminalEntry entry={entry({ result: { content, is_error: false } })} />,
    )

    expect(
      container.querySelector('.terminal-entry-output code[class*="language-"]'),
    ).toBeInTheDocument()
  })

  it('renders unrecognisable output as plain text', () => {
    const { container } = render(
      <TerminalEntry
        entry={entry({
          result: { content: 'a plain sentence about nothing in particular', is_error: false },
        })}
      />,
    )

    expect(
      container.querySelector('.terminal-entry-output pre.codeblock-plain'),
    ).toBeInTheDocument()
    expect(container.querySelector('.terminal-entry-output code[class*="language-"]')).toBeNull()
  })

  it('renders markdown-looking output as plain text, never as coloured or formatted markdown', () => {
    const content =
      '## Release Notes\n\n- Fixed a bug\n- Added a feature\n\nSee [changelog](http://example.com).'
    const { container } = render(
      <TerminalEntry entry={entry({ result: { content, is_error: false } })} />,
    )

    expect(
      container.querySelector('.terminal-entry-output pre.codeblock-plain'),
    ).toBeInTheDocument()
    expect(container.querySelector('.terminal-entry-output code[class*="language-"]')).toBeNull()
    expect(container.querySelector('.terminal-entry-output h2')).toBeNull()
    expect(container.querySelector('.terminal-entry-output a')).toBeNull()
  })

  it('calls onClick with the entry when the jump button is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<TerminalEntry entry={entry()} onClick={onClick} />)

    await user.click(screen.getByTitle('Jump to this turn'))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(entry())
  })

  it('renders no jump button for an orphan entry (no turnId), but copy still renders', () => {
    render(<TerminalEntry entry={entry({ turnId: null })} onClick={vi.fn()} />)

    expect(screen.queryByTitle('Jump to this turn')).toBeNull()
    expect(screen.getByTitle('Copy command')).toBeInTheDocument()
  })

  it('copying the command never fires the jump onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<TerminalEntry entry={entry()} onClick={onClick} />)

    await user.click(screen.getByTitle('Copy command'))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders both jump and copy buttons whether or not the entry has a description', () => {
    const { rerender } = render(<TerminalEntry entry={entry({ description: null })} />)
    expect(screen.getByTitle('Jump to this turn')).toBeInTheDocument()
    expect(screen.getByTitle('Copy command')).toBeInTheDocument()

    rerender(<TerminalEntry entry={entry({ description: 'List files' })} />)
    expect(screen.getByTitle('Jump to this turn')).toBeInTheDocument()
    expect(screen.getByTitle('Copy command')).toBeInTheDocument()
  })
})
