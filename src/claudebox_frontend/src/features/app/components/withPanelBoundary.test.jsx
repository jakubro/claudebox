/** Tests for withPanelBoundary. */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import withPanelBoundary from './withPanelBoundary'

const mockUseSessionRouting = vi.fn()

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => mockUseSessionRouting(),
}))
vi.mock('../../../utils/errorReporting', () => ({ reportRenderError: vi.fn() }))

function Panel() {
  return <p>todos content</p>
}

describe('withPanelBoundary', () => {
  beforeEach(() => {
    mockUseSessionRouting.mockReturnValue({ activeSessionId: 'session-1' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    console.error.mockRestore()
  })

  it('renders the wrapped panel normally', () => {
    const Wrapped = withPanelBoundary(Panel, 'todos')
    render(<Wrapped />)

    expect(screen.getByText('todos content')).toBeInTheDocument()
  })

  it('shows the boundary fallback labelled with the panel id when it throws', () => {
    function Bomb() {
      throw new Error('boom')
    }
    const Wrapped = withPanelBoundary(Bomb, 'stash')
    render(<Wrapped />)

    expect(screen.getByTestId('error-boundary-stash')).toBeInTheDocument()
  })
})
