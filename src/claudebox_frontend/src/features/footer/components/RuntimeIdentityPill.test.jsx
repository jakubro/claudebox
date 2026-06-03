/** Tests for RuntimeIdentityPill. */

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RuntimeIdentityPill from './RuntimeIdentityPill'

vi.mock('../../../hooks/useCapabilities', () => ({
  default: vi.fn(),
}))

import useCapabilities from '../../../hooks/useCapabilities'

afterEach(() => {
  vi.clearAllMocks()
})

describe('RuntimeIdentityPill', () => {
  it('renders runtime name when available', () => {
    useCapabilities.mockReturnValue({ capabilities: null, runtimeName: 'Claude' })

    render(<RuntimeIdentityPill />)

    expect(screen.getByTestId('footer-runtime')).toHaveTextContent('Claude')
  })

  it('renders nothing during the capability-data race', () => {
    useCapabilities.mockReturnValue({ capabilities: null, runtimeName: null })

    const { container } = render(<RuntimeIdentityPill />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('footer-runtime')).toBeNull()
  })

  it('renders the future runtime name as-is', () => {
    useCapabilities.mockReturnValue({ capabilities: null, runtimeName: 'Goose' })

    render(<RuntimeIdentityPill />)

    expect(screen.getByTestId('footer-runtime')).toHaveTextContent('Goose')
  })
})
