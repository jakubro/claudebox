/** Tests for InjectedContext - a block's added-text triangle and the box it opens. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InjectedContext from './InjectedContext'

const reminder = text => ({ source: 'system-reminder', text })

function open(entries) {
  render(<InjectedContext entries={entries} />)
  fireEvent.click(screen.getByTestId('injected-context-toggle'))
}

describe('InjectedContext', () => {
  it('names every source once on its triangle, in arrival order', () => {
    render(
      <InjectedContext
        entries={[reminder('a'), { source: 'stop-hook', text: 'b' }, reminder('c')]}
      />,
    )

    expect(screen.getByTestId('injected-context-toggle')).toHaveAttribute(
      'title',
      'System reminder, Stop hook',
    )
    expect(screen.queryByTestId('injected-context-box')).not.toBeInTheDocument()
  })

  it('lists each piece with its source, in arrival order, once opened', () => {
    open([reminder('Commit each change.'), { source: 'stop-hook', text: 'Ask first.' }])

    expect(
      [...document.querySelectorAll('.injected-context-source')].map(e => e.textContent),
    ).toEqual(['System reminder', 'Stop hook'])
    expect(screen.getByText('Ask first.')).toBeInTheDocument()
  })

  it('shows identical reminders once, with how many times they came', () => {
    open([reminder('Same.'), reminder('Same.'), reminder('Other.')])

    expect(screen.getAllByText('Same.')).toHaveLength(1)
    expect(document.querySelector('.injected-context-count').textContent).toBe('×2')
    expect(screen.getByText('Other.')).toBeInTheDocument()
  })

  it('lists every other piece on its own, repeats included, in arrival order', () => {
    const hook = { source: 'stop-hook', text: 'Ask first.' }
    open([hook, { source: 'claude-code', text: 'No output.' }, hook])

    expect(
      [...document.querySelectorAll('.injected-context-source')].map(e => e.textContent),
    ).toEqual(['Stop hook', 'Claude Code', 'Stop hook'])
    expect(document.querySelector('.injected-context-count')).toBeNull()
  })

  it('draws nothing for a block with no added text', () => {
    render(<InjectedContext entries={[]} />)

    expect(screen.queryByTestId('injected-context-toggle')).not.toBeInTheDocument()
  })
})
