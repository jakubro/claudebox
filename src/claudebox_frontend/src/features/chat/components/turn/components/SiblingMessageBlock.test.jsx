/** Tests for SiblingMessageBlock. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SiblingMessageBlock from './SiblingMessageBlock'

describe('SiblingMessageBlock', () => {
  it('shows the text under the sibling session name', () => {
    render(
      <SiblingMessageBlock
        content="Done: **40** files."
        fromSessionId="abcdef1234567890"
        fromName="lint-fix"
      />,
    )

    const block = screen.getByTestId('sibling-message')
    expect(block).toHaveAttribute('data-from-session-id', 'abcdef1234567890')
    expect(block.querySelector('.sibling-message-from')).toHaveTextContent('from lint-fix')
    expect(block.querySelector('strong')).toHaveTextContent('40')
  })

  it('names a nameless sibling by the first eight characters of its id', () => {
    render(<SiblingMessageBlock content="x" fromSessionId="abcdef1234567890" fromName={null} />)

    expect(screen.getByText('from abcdef12')).toBeInTheDocument()
  })

  it('offers a copy of its text', () => {
    render(<SiblingMessageBlock content="copy me" fromSessionId="s" fromName="n" />)

    expect(screen.getByTitle('Copy message')).toBeInTheDocument()
  })
})
