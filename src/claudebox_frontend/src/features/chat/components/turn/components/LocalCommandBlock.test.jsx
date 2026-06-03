/** Tests for LocalCommandBlock component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import LocalCommandBlock from './LocalCommandBlock'

describe('LocalCommandBlock', () => {
  it('renders stdout label for stdout type', () => {
    render(<LocalCommandBlock type="stdout" content="hello world" />)

    expect(screen.getByText('stdout')).toBeInTheDocument()
    expect(screen.queryByText('stderr')).not.toBeInTheDocument()
  })

  it('renders stderr label for stderr type', () => {
    render(<LocalCommandBlock type="stderr" content="error output" />)

    expect(screen.getByText('stderr')).toBeInTheDocument()
    expect(screen.queryByText('stdout')).not.toBeInTheDocument()
  })

  it('renders content when expanded', () => {
    render(<LocalCommandBlock type="stdout" content="some output" />)

    expect(screen.getByText('some output')).toBeInTheDocument()
  })

  it('collapses content when header is clicked', async () => {
    const user = userEvent.setup()
    render(<LocalCommandBlock type="stdout" content="some output" />)

    // Initially expanded
    expect(screen.getByText('some output')).toBeInTheDocument()

    // Click header button to collapse
    await user.click(screen.getByRole('button'))

    expect(screen.queryByText('some output')).not.toBeInTheDocument()
  })

  it('expands content again when header is clicked twice', async () => {
    const user = userEvent.setup()
    render(<LocalCommandBlock type="stdout" content="some output" />)

    const header = screen.getByRole('button')

    // Collapse
    await user.click(header)
    expect(screen.queryByText('some output')).not.toBeInTheDocument()

    // Expand again
    await user.click(header)
    expect(screen.getByText('some output')).toBeInTheDocument()
  })
})
