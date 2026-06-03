/** Tests for MobileTopBar component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MobileTopBar from './MobileTopBar'

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Menu: () => <span data-testid="icon-menu">&#9776;</span>,
  MoreHorizontal: () => <span data-testid="icon-more">&#8943;</span>,
}))

// Mock contexts
const mockSessionDataCtx = { sessionName: 'Test Session' }
vi.mock('../../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionDataCtx,
}))

describe('MobileTopBar', () => {
  const onHamburger = vi.fn()
  const onToggleDetails = vi.fn()

  beforeEach(() => {
    onHamburger.mockReset()
    onToggleDetails.mockReset()
    mockSessionDataCtx.sessionName = 'Test Session'
  })

  it('renders session name', () => {
    render(
      <MobileTopBar
        onHamburger={onHamburger}
        onToggleDetails={onToggleDetails}
        detailsOpen={false}
      />,
    )

    expect(screen.getByText('Test Session')).toBeInTheDocument()
  })

  it('renders default name when sessionName is empty', () => {
    mockSessionDataCtx.sessionName = ''

    render(
      <MobileTopBar
        onHamburger={onHamburger}
        onToggleDetails={onToggleDetails}
        detailsOpen={false}
      />,
    )

    expect(screen.getByText('claudebox')).toBeInTheDocument()
  })

  it('calls onHamburger when hamburger button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <MobileTopBar
        onHamburger={onHamburger}
        onToggleDetails={onToggleDetails}
        detailsOpen={false}
      />,
    )

    await user.click(screen.getByTitle('Menu'))

    expect(onHamburger).toHaveBeenCalledOnce()
  })

  it('does not render a stop button (stop affordance lives on the chat send button)', () => {
    render(
      <MobileTopBar
        onHamburger={onHamburger}
        onToggleDetails={onToggleDetails}
        detailsOpen={false}
      />,
    )

    expect(screen.queryByTestId('mobile-stop-btn')).not.toBeInTheDocument()
  })

  it('calls onToggleDetails when details button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <MobileTopBar
        onHamburger={onHamburger}
        onToggleDetails={onToggleDetails}
        detailsOpen={false}
      />,
    )

    await user.click(screen.getByTitle('Session details'))

    expect(onToggleDetails).toHaveBeenCalledOnce()
  })
})
