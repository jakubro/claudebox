/** Tests for BundlePill - the read-only footer name of a session's bundle and its drift dot. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BundlePill from './BundlePill'

let mockSessionData = {}
let mockDefaults = null

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionData,
}))

vi.mock('../../../hooks/useSessionDefaults', () => ({
  default: () => mockDefaults,
}))

const RESEARCH = {
  bundle_names: ['research'],
  bundles: {
    research: {
      declared: { model: 'claude-opus-5-5', effort_level: 'max' },
      keys: ['effort_level', 'env', 'model'],
    },
  },
}

function session(values) {
  return { bundle: 'research', sessionData: { bundle: 'research', ...values } }
}

beforeEach(() => {
  mockDefaults = RESEARCH
  mockSessionData = session({ model: 'claude-opus-5-5', effort_level: 'max' })
})

describe('BundlePill', () => {
  it('names the bundle the session started under', () => {
    render(<BundlePill />)

    expect(screen.getByTestId('footer-bundle')).toHaveTextContent('research')
    expect(screen.queryByTestId('footer-bundle-drift')).toBeNull()
  })

  it('renders nothing, separator included, for an unbundled session', () => {
    mockSessionData = { bundle: null, sessionData: { model: 'claude-opus-5-5' } }

    const { container } = render(<BundlePill />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the dot once a declared value has changed', () => {
    mockSessionData = session({ model: 'claude-sonnet-5', effort_level: 'max' })

    render(<BundlePill />)

    expect(screen.getByTestId('footer-bundle-drift')).toBeInTheDocument()
  })

  it('lists what the bundle set in its tooltip', () => {
    render(<BundlePill />)

    expect(screen.getByTestId('footer-bundle')).toHaveAttribute(
      'title',
      'Bundle — research\nmodel: claude-opus-5-5\neffort_level: max\nalso sets: env',
    )
  })

  it('opens nothing when clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(<BundlePill />)

    await user.click(screen.getByTestId('footer-bundle'))

    expect(container.querySelector('button, [role="menu"], .footer-picker-dropdown')).toBeNull()
  })

  it('never shows a dot for a bundle that set nothing a session can change', () => {
    mockDefaults = { bundles: { research: { declared: {}, keys: ['env', 'mounts'] } } }
    mockSessionData = session({ model: 'claude-sonnet-5' })

    render(<BundlePill />)

    expect(screen.queryByTestId('footer-bundle-drift')).toBeNull()
  })
})
