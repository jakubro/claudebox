/** Tests for BundlePicker - the welcome-screen choice of the next session's bundle. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BundlePicker from './BundlePicker'

let mockDeferredBundle = null
const mockSetDeferredBundle = vi.fn(value => {
  mockDeferredBundle = value
})
let mockDefaults = null

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({ deferredBundle: mockDeferredBundle }),
  useSessionActions: () => ({ setDeferredBundle: mockSetDeferredBundle }),
}))

vi.mock('../../../hooks/useSessionDefaults', () => ({
  default: () => mockDefaults,
}))

beforeEach(() => {
  mockDeferredBundle = null
  mockSetDeferredBundle.mockClear()
  mockDefaults = { bundle_names: ['research', 'ops'] }
})

describe('BundlePicker', () => {
  it('offers no bundle plus every declared bundle in order', async () => {
    const user = userEvent.setup()
    render(<BundlePicker />)

    await user.click(screen.getByTestId('footer-bundle-picker'))

    const options = screen.getByTestId('bundle-dropdown').querySelectorAll('.dropdown-option')
    expect([...options].map(el => el.textContent)).toEqual(['No bundle', 'research', 'ops'])
  })

  it('holds the pick for the next session', async () => {
    const user = userEvent.setup()
    render(<BundlePicker />)

    await user.click(screen.getByTestId('footer-bundle-picker'))
    await user.click(screen.getByText('ops'))

    expect(mockSetDeferredBundle).toHaveBeenCalledWith('ops')
  })

  it('shows the held pick', () => {
    mockDeferredBundle = 'research'

    render(<BundlePicker />)

    expect(screen.getByTestId('footer-bundle-picker')).toHaveTextContent('research')
  })

  it('renders nothing when the workspace declares no bundle', () => {
    mockDefaults = { bundle_names: [] }

    const { container } = render(<BundlePicker />)

    expect(container).toBeEmptyDOMElement()
  })
})
