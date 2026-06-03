/** Tests for HelpOverlay component. */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../help/HelpPanel', () => ({ default: () => <div data-testid="help-panel">Help</div> }))

import HelpOverlay from './HelpOverlay'

describe('HelpOverlay', () => {
  it('renders HelpPanel', () => {
    const { getByTestId } = render(<HelpOverlay onClose={vi.fn()} />)
    expect(getByTestId('help-panel')).toBeDefined()
  })

  it('clicking overlay calls onClose', () => {
    const onClose = vi.fn()
    const { container } = render(<HelpOverlay onClose={onClose} />)
    fireEvent.click(container.querySelector('.help-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking modal content does not call onClose', () => {
    const onClose = vi.fn()
    const { container } = render(<HelpOverlay onClose={onClose} />)
    fireEvent.click(container.querySelector('.help-overlay-modal'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
