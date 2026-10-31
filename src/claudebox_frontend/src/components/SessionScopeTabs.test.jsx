/** Tests for SessionScopeTabs. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SessionScopeTabs from './SessionScopeTabs'

describe('SessionScopeTabs', () => {
  it('marks the tab shown, counts both and reports the tab clicked', () => {
    const onTabChange = vi.fn()

    render(
      <SessionScopeTabs tab="session" onTabChange={onTabChange} sessionCount={2} allCount={5} />,
    )

    const session = screen.getByText('This session').closest('button')
    const all = screen.getByText('All sessions').closest('button')
    expect(session).toHaveClass('active')
    expect(all).not.toHaveClass('active')
    expect(session).toHaveTextContent('2')
    expect(all).toHaveTextContent('5')

    fireEvent.click(all)
    expect(onTabChange).toHaveBeenCalledWith('all')
  })
})
