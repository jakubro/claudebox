/** Tests for MobileLayout component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import MobileLayout from './MobileLayout'

vi.mock('../../../chat', () => ({ default: () => <div data-testid="chat-panel">Chat</div> }))
vi.mock('./DetailsSheet', () => ({
  default: ({ onClose }) => (
    <div data-testid="details-sheet" onClick={onClose}>
      Details
    </div>
  ),
}))
vi.mock('./MobileDrawer', () => ({
  default: ({ onClose }) => (
    <div data-testid="mobile-drawer" onClick={onClose}>
      Drawer
    </div>
  ),
}))
vi.mock('./MobileMenuContext', () => ({
  MobileMenuProvider: ({ children }) => <div>{children}</div>,
}))
vi.mock('./MobileTopBar', () => ({
  default: ({ onHamburger, onToggleDetails }) => (
    <div data-testid="mobile-top-bar">
      <button type="button" data-testid="hamburger" onClick={onHamburger}>
        Menu
      </button>
      <button type="button" data-testid="toggle-details" onClick={onToggleDetails}>
        Details
      </button>
    </div>
  ),
}))
vi.mock('./StatusStrip', () => ({ default: () => <div data-testid="status-strip">Status</div> }))

describe('MobileLayout', () => {
  it('stacks top bar, status strip, and chat area top-to-bottom', () => {
    const { container } = render(<MobileLayout />)

    const layout = container.querySelector('.mobile-layout')
    expect(layout).toBeInTheDocument()

    // All three load-bearing sections present
    expect(screen.getByTestId('mobile-top-bar')).toBeInTheDocument()
    expect(screen.getByTestId('status-strip')).toBeInTheDocument()
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()

    // DOM order matches the claim's "Top to bottom: top bar, status strip, chat area"
    const sectionTestIds = Array.from(layout.children)
      .map(el => el.getAttribute('data-testid') ?? el.className)
      .filter(id =>
        ['mobile-top-bar', 'status-strip', 'mobile-chat-area'].some(k => id.includes(k)),
      )
    expect(sectionTestIds).toEqual(['mobile-top-bar', 'status-strip', 'mobile-chat-area'])
  })

  it('does not show drawer or details sheet initially', () => {
    render(<MobileLayout />)

    expect(screen.queryByTestId('mobile-drawer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('details-sheet')).not.toBeInTheDocument()
  })

  it('clicking hamburger opens drawer', async () => {
    const user = userEvent.setup()

    render(<MobileLayout />)

    await user.click(screen.getByTestId('hamburger'))

    expect(screen.getByTestId('mobile-drawer')).toBeInTheDocument()
  })

  it('clicking drawer onClose closes it', async () => {
    const user = userEvent.setup()

    render(<MobileLayout />)

    await user.click(screen.getByTestId('hamburger'))
    expect(screen.getByTestId('mobile-drawer')).toBeInTheDocument()

    await user.click(screen.getByTestId('mobile-drawer'))
    expect(screen.queryByTestId('mobile-drawer')).not.toBeInTheDocument()
  })

  it('clicking toggle-details opens details sheet', async () => {
    const user = userEvent.setup()

    render(<MobileLayout />)

    await user.click(screen.getByTestId('toggle-details'))

    expect(screen.getByTestId('details-sheet')).toBeInTheDocument()
  })

  it('clicking details onClose closes it', async () => {
    const user = userEvent.setup()

    render(<MobileLayout />)

    await user.click(screen.getByTestId('toggle-details'))
    expect(screen.getByTestId('details-sheet')).toBeInTheDocument()

    await user.click(screen.getByTestId('details-sheet'))
    expect(screen.queryByTestId('details-sheet')).not.toBeInTheDocument()
  })
})
